// Cross-engine determinism check for the 3D core.
//
// The whole rebuild rests on one claim: a tape means the same thing everywhere.
// This runs the committed replay corpus through the real simulation in Chromium,
// Firefox and WebKit and holds all three to the same checksums that
// tests/sim-corpus.test.ts holds Node to.
//
// It is the reason src/sim/trig.ts builds its own sine tables. ECMA-262 pins no
// accuracy for Math.sin, so a core that called it could disagree with itself
// across engines — and nobody would notice until someone else's replay quietly
// failed on their machine.
//
// Usage: node scripts/fp-cross-engine.mjs   (needs the dev server on 4173)
import { chromium, firefox, webkit } from "@playwright/test";
import { readFile } from "node:fs/promises";

const gameUrl = process.env.GAME_URL ?? "http://127.0.0.1:4173/";
const golden = JSON.parse(await readFile(new URL("../src/sim/corpus-checksums.json", import.meta.url), "utf8"));

const collect = (page) =>
  page.evaluate(async () => {
    const { runCorpus } = await import("/src/sim/corpus.ts");
    const { AWAKENING } = await import("/src/world/room.ts");
    return runCorpus(AWAKENING);
  });

const engines = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];

const failures = [];
for (const [name, launcher] of engines) {
  let browser;
  try {
    browser = await launcher.launch({ headless: true });
  } catch (error) {
    console.log(`  SKIP  ${name} — not installed (${error.message.split("\n")[0]})`);
    continue;
  }
  try {
    const page = await browser.newPage();
    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    const checksums = await collect(page);
    if (checksums.length !== golden.length) {
      console.log(`  FAIL  ${name} — ${checksums.length} ticks, expected ${golden.length}`);
      failures.push(name);
      continue;
    }
    const diverged = golden.findIndex((value, index) => value !== checksums[index]);
    if (diverged === -1) {
      console.log(`  PASS  ${name} — ${checksums.length} ticks identical to the committed corpus`);
    } else {
      console.log(`  FAIL  ${name} — diverged at tick ${diverged}: expected ${golden[diverged]}, got ${checksums[diverged]}`);
      failures.push(name);
    }
  } finally {
    await browser.close();
  }
}

if (failures.length > 0) {
  console.error(`\ncross-engine determinism: FAIL — ${failures.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("\ncross-engine determinism: PASS — the browsers agree with Node, tick for tick");
}
