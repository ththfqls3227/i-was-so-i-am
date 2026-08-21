// Fixed-pose stills for visual regression.
//
// The play-through captures are choreographed on a wall clock, so where the
// player and the echo end up varies between runs by more than most refactors
// would move them — their run-to-run noise floor is too high to prove anything
// about geometry. These stand still at pinned camera poses instead, which makes
// the only moving thing in frame the plate ring's pulse.
//
// The HUD is hidden for the shot. It turned out to be most of what was left:
// the subtitle cross-fades on a wall clock, so two runs of the same build caught
// it at different opacities and the diff blamed the scene. A regression harness
// for ten rooms cannot spend its signal on a fading caption.
//
// Pair with scripts/image-diff.mjs: shoot before a change, shoot after, diff.
// Usage: node scripts/fp-stills.mjs [outputDirectory]
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { startGameServer } from "./support/serve.mjs";

// Built and served by us, from dist-e2e/, on our own port. See support/serve.mjs
// for why this must not be whatever happens to be listening on the dev port.
const server = await startGameServer({ label: "stills" });
const gameUrl = server.url;
const outputDirectory = process.argv[2] ?? "captures/stills";
/** Which chamber to shoot. Poses are per-chamber because rooms differ in shape. */
const chamberId = process.env.CHAMBER ?? "awakening";
const viewport = { width: 1280, height: 720 };

/**
 * Each pose is a place to stand and a direction to face.
 *
 * `atZ` is a position, not a duration. Walking for a fixed number of
 * milliseconds lands somewhere slightly different every run, and that difference
 * was the entire remaining noise floor once the HUD stopped moving.
 */
const POSES_BY_CHAMBER = {
  // 03 leaves through its own east wall and has a partition across the middle,
  // so the shots that matter are the approach, the doorway, and the dead end.
  "hand-not-body": [
    { name: "01-spawn-forward", atZ: 0, yaw: 0, pitch: 0 },
    { name: "02-spawn-left", atZ: 0, yaw: -1.2, pitch: 0.05 },
    { name: "03-plate-side", atZ: 0, yaw: 1.1, pitch: 0.1 },
    { name: "04-partition", atZ: 6.5, yaw: 0, pitch: 0 },
    { name: "05-partition-up", atZ: 6.5, yaw: 0, pitch: -0.4 },
    { name: "06-doorway", atZ: 8.2, yaw: 0, pitch: 0.05 },
    { name: "07-looking-back", atZ: 8.2, yaw: Math.PI, pitch: 0.05 },
    { name: "08-east-wall", atZ: 8.2, yaw: 1.4, pitch: 0.05 },
  ],
  // 08 is about one thing: somebody is already standing on the west plate, and
  // nobody mentions it. Every shot here is either him or the room refusing to
  // say anything about him.
  silence: [
    { name: "01-spawn-forward", atZ: 0, yaw: 0, pitch: 0 },
    { name: "02-spawn-west", atZ: 0, yaw: -1.0, pitch: 0.05 },
    { name: "03-approach-him", atZ: 4.4, yaw: -1.2, pitch: 0.08 },
    { name: "04-level-with-him", atZ: 7.2, yaw: -Math.PI / 2, pitch: 0.05 },
    { name: "05-his-plate-down", atZ: 7.2, yaw: -Math.PI / 2, pitch: 0.45 },
    { name: "06-your-plate", atZ: 7.2, yaw: Math.PI / 2, pitch: 0.3 },
    { name: "07-the-door", atZ: 9.6, yaw: 0, pitch: 0.05 },
    { name: "08-looking-back", atZ: 9.6, yaw: Math.PI, pitch: 0.05 },
  ],
  // 09 is 02 at a longer walk. The shots worth having are the grip you already
  // know, and the length of the room you have to cross while he holds it.
  "last-hold": [
    { name: "01-spawn-forward", atZ: 0, yaw: 0, pitch: 0 },
    { name: "02-the-open-box", atZ: 0, yaw: -1.25, pitch: 0.1 },
    { name: "03-the-grip", atZ: 2.6, yaw: 0, pitch: 0.15 },
    { name: "04-past-the-pillar", atZ: 5.2, yaw: 0, pitch: 0 },
    { name: "05-the-long-way-out", atZ: 11, yaw: 0, pitch: 0 },
    { name: "06-looking-back-at-him", atZ: 11, yaw: Math.PI, pitch: 0.05 },
    { name: "07-the-doorway", atZ: 18.4, yaw: 0, pitch: 0.05 },
    { name: "08-from-the-doorway", atZ: 18.4, yaw: Math.PI, pitch: 0.05 },
  ],
};

const DEFAULT_POSES = [
  { name: "01-spawn-forward", atZ: 0, yaw: 0, pitch: 0 },
  { name: "02-spawn-left", atZ: 0, yaw: -1.2, pitch: 0.05 },
  { name: "03-spawn-right", atZ: 0, yaw: 1.2, pitch: 0.05 },
  { name: "04-spawn-up", atZ: 0, yaw: 0, pitch: -0.55 },
  { name: "05-midroom-forward", atZ: 5.4, yaw: 0, pitch: 0 },
  { name: "06-midroom-back", atZ: 5.4, yaw: Math.PI, pitch: 0.05 },
  { name: "07-plate-door", atZ: 7.4, yaw: 0, pitch: 0.1 },
  { name: "08-plate-down", atZ: 7.4, yaw: 0, pitch: 0.8 },
];

const POSES = POSES_BY_CHAMBER[chamberId] ?? DEFAULT_POSES;

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
await page.addInitScript(() => {
  Object.defineProperty(globalThis.navigator, "webdriver", { configurable: true, get: () => false });
});

/** The room is the subject; the interface is not. */
const setHudVisible = (visible) =>
  page.evaluate((show) => {
    const hud = globalThis.document.querySelector(".hud");
    if (hud instanceof globalThis.HTMLElement) hud.style.visibility = show ? "" : "hidden";
  }, visible);

await mkdir(outputDirectory, { recursive: true });
try {
  await page.goto(gameUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => globalThis.__I_WAS_SO_I_AM_FP__?.renderer?.ready === true);
  if (chamberId !== "awakening") {
    const switched = await page.evaluate(
      (id) => globalThis.__I_WAS_SO_I_AM_FP__.switchChamber(id),
      chamberId,
    );
    if (!switched) throw new Error(`No chamber called ${chamberId}`);
  }
  await page.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.start());
  await page.waitForTimeout(400);

  const standingZ = () =>
    page.evaluate(
      () => globalThis.__I_WAS_SO_I_AM_FP__.state.actors.find((a) => a.id === "present")?.z ?? 0,
    );

  let reached = 0;
  for (const pose of POSES) {
    if (pose.atZ > reached) {
      await page.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.setLook(0, 0));
      await page.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.press("KeyW"));
      for (let guard = 0; guard < 400; guard += 1) {
        if ((await standingZ()) >= pose.atZ) break;
        await page.waitForTimeout(16);
      }
      await page.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.release("KeyW"));
      reached = pose.atZ;
      // Let the walk speed bleed off so head bob is not in the frame.
      await page.waitForTimeout(900);
    }
    await page.evaluate(
      ([yaw, pitch]) => globalThis.__I_WAS_SO_I_AM_FP__.setLook(yaw, pitch),
      [pose.yaw, pose.pitch],
    );
    await page.waitForTimeout(320);
    await setHudVisible(false);
    await page.screenshot({ path: `${outputDirectory}/${pose.name}.png` });
    await setHudVisible(true);
    console.log(`${outputDirectory}/${pose.name}.png`);
  }
} finally {
  await browser.close();
  await server.stop();
}
