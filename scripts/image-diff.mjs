// Compare two directories of PNGs pixel by pixel.
//
// Byte equality is the wrong instrument for these captures: the scene animates
// on a wall clock (light pulse, head bob, echo fade), so two runs of identical
// code never produce identical files. What this reports is how far apart two
// sets are, so a refactor can be measured against the noise floor of running
// the same build twice.
//
// Usage: node scripts/image-diff.mjs <dirA> <dirB>
import { chromium } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const [dirA, dirB] = process.argv.slice(2);
if (!dirA || !dirB) {
  console.error("usage: node scripts/image-diff.mjs <dirA> <dirB>");
  process.exit(2);
}

const names = (await readdir(dirA)).filter((name) => name.endsWith(".png")).sort();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const dataUrl = async (path) => `data:image/png;base64,${(await readFile(path)).toString("base64")}`;

let worstMean = 0;
let worstName = "";
const rows = [];
try {
  for (const name of names) {
    const [a, b] = await Promise.all([dataUrl(join(dirA, name)), dataUrl(join(dirB, name))]);
    const result = await page.evaluate(async ([left, right]) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const image = new globalThis.Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = src;
        });
      const [one, two] = await Promise.all([load(left), load(right)]);
      if (one.width !== two.width || one.height !== two.height) {
        return { sizeMismatch: true, mean: 255, changed: 100, max: 255 };
      }
      const canvas = new globalThis.OffscreenCanvas(one.width, one.height);
      const context = canvas.getContext("2d");
      context.drawImage(one, 0, 0);
      const pixelsA = context.getImageData(0, 0, one.width, one.height).data;
      context.clearRect(0, 0, one.width, one.height);
      context.drawImage(two, 0, 0);
      const pixelsB = context.getImageData(0, 0, one.width, one.height).data;

      let total = 0;
      let max = 0;
      let changed = 0;
      const pixels = one.width * one.height;
      for (let index = 0; index < pixelsA.length; index += 4) {
        const dr = Math.abs(pixelsA[index] - pixelsB[index]);
        const dg = Math.abs(pixelsA[index + 1] - pixelsB[index + 1]);
        const db = Math.abs(pixelsA[index + 2] - pixelsB[index + 2]);
        const worst = dr > dg ? (dr > db ? dr : db) : dg > db ? dg : db;
        total += dr + dg + db;
        if (worst > max) max = worst;
        // Eight levels out of 255 is past what dithering and tone mapping move.
        if (worst > 8) changed += 1;
      }
      return { sizeMismatch: false, mean: total / (pixels * 3), changed: (changed / pixels) * 100, max };
    }, [a, b]);
    rows.push({ name, ...result });
    if (result.mean > worstMean) {
      worstMean = result.mean;
      worstName = name;
    }
  }
} finally {
  await browser.close();
}

for (const row of rows) {
  const flag = row.sizeMismatch ? " SIZE MISMATCH" : "";
  console.log(
    `  ${row.name.padEnd(22)} mean ${row.mean.toFixed(3).padStart(7)}  changed ${row.changed.toFixed(2).padStart(6)}%  max ${String(row.max).padStart(3)}${flag}`,
  );
}
console.log(`\nworst mean difference: ${worstMean.toFixed(3)} (${worstName})`);
