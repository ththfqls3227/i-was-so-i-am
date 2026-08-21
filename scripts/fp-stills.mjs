// Fixed-pose stills for visual regression.
//
// The play-through captures are choreographed on a wall clock, so where the
// player and the echo end up varies between runs by more than most refactors
// would move them — their run-to-run noise floor is too high to prove anything
// about geometry. These stand still at pinned camera poses instead, which makes
// the only moving thing in frame the plate ring's pulse.
//
// Pair with scripts/image-diff.mjs: shoot before a change, shoot after, diff.
// Usage: node scripts/fp-stills.mjs [outputDirectory]
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const gameUrl = process.env.GAME_URL ?? "http://127.0.0.1:4173/";
const outputDirectory = process.argv[2] ?? "captures/stills";
const viewport = { width: 1280, height: 720 };

/** Each pose is a place to stand and a direction to face. */
const POSES = [
  { name: "01-spawn-forward", walk: 0, yaw: 0, pitch: 0 },
  { name: "02-spawn-left", walk: 0, yaw: -1.2, pitch: 0.05 },
  { name: "03-spawn-right", walk: 0, yaw: 1.2, pitch: 0.05 },
  { name: "04-spawn-up", walk: 0, yaw: 0, pitch: -0.55 },
  { name: "05-midroom-forward", walk: 1200, yaw: 0, pitch: 0 },
  { name: "06-midroom-back", walk: 1200, yaw: Math.PI, pitch: 0.05 },
  { name: "07-plate-door", walk: 2000, yaw: 0, pitch: 0.1 },
  { name: "08-plate-down", walk: 2000, yaw: 0, pitch: 0.8 },
];

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
await page.addInitScript(() => {
  Object.defineProperty(globalThis.navigator, "webdriver", { configurable: true, get: () => false });
});

await mkdir(outputDirectory, { recursive: true });
try {
  await page.goto(gameUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => globalThis.__I_WAS_SO_I_AM_FP__?.renderer?.ready === true);
  await page.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.start());
  await page.waitForTimeout(400);

  let walked = 0;
  for (const pose of POSES) {
    if (pose.walk > walked) {
      await page.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.setLook(0, 0));
      await page.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.press("KeyW"));
      await page.waitForTimeout(pose.walk - walked);
      await page.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.release("KeyW"));
      walked = pose.walk;
      // Let the walk speed bleed off so head bob is not in the frame.
      await page.waitForTimeout(700);
    }
    await page.evaluate(
      ([yaw, pitch]) => globalThis.__I_WAS_SO_I_AM_FP__.setLook(yaw, pitch),
      [pose.yaw, pose.pitch],
    );
    await page.waitForTimeout(320);
    await page.screenshot({ path: `${outputDirectory}/${pose.name}.png` });
    console.log(`${outputDirectory}/${pose.name}.png`);
  }
} finally {
  await browser.close();
}
