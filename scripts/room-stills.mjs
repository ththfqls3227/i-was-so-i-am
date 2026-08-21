// Per-chamber art stills.
//
// fp-stills.mjs walks a straight line down chamber 00. From 03 onward the thing
// worth photographing is off that line — an alcove behind a partition, a plate
// set to one side — so this one aims and walks to a point before it shoots.
//
// Usage: node scripts/room-stills.mjs [outputDirectory]
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const gameUrl = process.env.GAME_URL ?? "http://127.0.0.1:4173/";
const outputDirectory = process.argv[2] ?? "captures/g2-d1";
const viewport = { width: 1600, height: 900 };

/** Where to stand, where to look, in each room worth looking at. */
const SHOTS = [
  { chamber: "second-self", name: "01-entry", to: { x: 0, z: 2.2 }, yaw: 0, pitch: 0.02 },
  { chamber: "second-self", name: "01-plate", to: { x: 0, z: 5.6 }, yaw: 0, pitch: 0.16 },
  { chamber: "second-self", name: "01-sign", to: { x: 0, z: 9.4 }, yaw: -0.42, pitch: -0.06 },

  { chamber: "holding-hand", name: "02-grip", to: { x: 0, z: 1.9 }, yaw: 0, pitch: 0.08 },
  { chamber: "holding-hand", name: "02-long-walk", to: { x: 0, z: 4.4 }, yaw: 0, pitch: 0.02 },
  { chamber: "holding-hand", name: "02-open-box", to: { x: -3.6, z: 8.4 }, yaw: -1.42, pitch: 0.05 },

  { chamber: "hand-not-body", name: "03-entry", to: { x: 0, z: 1.9 }, yaw: 0, pitch: 0 },
  { chamber: "hand-not-body", name: "03-sign", to: { x: -2.1, z: 6.4 }, yaw: 0, pitch: -0.1 },
  { chamber: "hand-not-body", name: "03-partition", to: { x: 0, z: 4.6 }, yaw: 0, pitch: 0.03 },
  // Nose to the paper: 03 asks you to walk into this door and keep walking, so
  // how it reads at arm's length is a gameplay frame, not a detail shot.
  { chamber: "hand-not-body", name: "03-contact", to: { x: 0, z: 8.6 }, yaw: 0, pitch: 0.02 },
  { chamber: "hand-not-body", name: "03-amber-plate", to: { x: 3.5, z: 3.9 }, yaw: 0.03, pitch: 0.34 },
  // Standing on the amber plate is the only way the doorway is open, so it is
  // also the only pose that can photograph the alcove.
  { chamber: "hand-not-body", name: "03-alcove", to: { x: 3.6, z: 6.5 }, yaw: -0.96, pitch: 0.06 },
  { chamber: "hand-not-body", name: "03-threshold", to: { x: 4.7, z: 9.4 }, yaw: 0.04, pitch: 0.16 },
];

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
await page.addInitScript(() => {
  Object.defineProperty(globalThis.navigator, "webdriver", { configurable: true, get: () => false });
});

const setHudVisible = (visible) =>
  page.evaluate((show) => {
    const hud = globalThis.document.querySelector(".hud");
    if (hud instanceof globalThis.HTMLElement) hud.style.visibility = show ? "" : "hidden";
  }, visible);

const here = () =>
  page.evaluate(() => {
    const actor = globalThis.__I_WAS_SO_I_AM_FP__.state.actors.find((a) => a.id === "present");
    return { x: actor?.x ?? 0, z: actor?.z ?? 0 };
  });

/** Aim at the target and walk, re-aiming as you go. Good enough to stand still in. */
const walkTo = async (target) => {
  await page.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.press("KeyW"));
  for (let guard = 0; guard < 600; guard += 1) {
    const at = await here();
    const dx = target.x - at.x;
    const dz = target.z - at.z;
    if (Math.hypot(dx, dz) < 0.22) break;
    await page.evaluate((yaw) => globalThis.__I_WAS_SO_I_AM_FP__.setLook(yaw, 0), Math.atan2(dx, dz));
    await page.waitForTimeout(16);
  }
  await page.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.release("KeyW"));
  // Let the walk speed bleed off, or head bob lands in the frame.
  await page.waitForTimeout(700);
};

await mkdir(outputDirectory, { recursive: true });
try {
  await page.goto(gameUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => globalThis.__I_WAS_SO_I_AM_FP__?.renderer?.ready === true);
  await page.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.start());
  await page.waitForTimeout(400);

  let current = null;
  for (const shot of SHOTS) {
    if (shot.chamber !== current) {
      const moved = await page.evaluate(
        (id) => globalThis.__I_WAS_SO_I_AM_FP__.switchChamber(id),
        shot.chamber,
      );
      if (!moved) throw new Error(`No chamber called ${shot.chamber}`);
      current = shot.chamber;
      await page.waitForTimeout(500);
    }
    await walkTo(shot.to);
    await page.evaluate(
      ([yaw, pitch]) => globalThis.__I_WAS_SO_I_AM_FP__.setLook(yaw, pitch),
      [shot.yaw, shot.pitch],
    );
    await page.waitForTimeout(320);
    await setHudVisible(false);
    await page.screenshot({ path: `${outputDirectory}/${shot.name}.png` });
    await setHudVisible(true);
    console.log(`${outputDirectory}/${shot.name}.png`);
  }
} finally {
  await browser.close();
}
