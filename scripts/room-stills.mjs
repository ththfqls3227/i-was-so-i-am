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
  // The three plate states at one framing, for reading the colour language
  // side by side: brass takes anyone, cyan is his alone, amber is mine alone.
  { chamber: "awakening", name: "00-plate-brass", to: { x: 0, z: 5.0 }, yaw: 0, pitch: 0.34 },
  { chamber: "second-self", name: "01-plate-cyan", to: { x: 0, z: 5.0 }, yaw: 0, pitch: 0.34 },

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
  { chamber: "hand-not-body", name: "03-plate-amber", to: { x: 3.5, z: 5.0 }, yaw: 0.03, pitch: 0.34 },
  // Standing on the amber plate is the only way the doorway is open, so it is
  // also the only pose that can photograph the alcove.
  { chamber: "hand-not-body", name: "03-alcove", to: { x: 3.6, z: 6.5 }, yaw: -0.96, pitch: 0.06 },
  { chamber: "hand-not-body", name: "03-threshold", to: { x: 4.7, z: 9.4 }, yaw: 0.04, pitch: 0.16 },

  // 04 is the first room with an upstairs. The gallery shot is the beat the
  // room is built around: you lean on the rail and look back down at him.
  { chamber: "two-of-us", name: "04-entry", to: { x: 0, z: 2.4 }, yaw: 0.2, pitch: -0.06 },
  { chamber: "two-of-us", name: "04-grip", to: { x: 0, z: 4.4 }, yaw: 0, pitch: 0.06 },
  { chamber: "two-of-us", name: "04-stairs", to: { x: 4.6, z: 4.2 }, yaw: 0.06, pitch: -0.02 },
  {
    chamber: "two-of-us",
    name: "04-gallery-wide",
    play: true,
    via: [{ x: 4.75, z: 4.4 }, { x: 4.75, z: 10.8 }, { x: 4.0, z: 12.4 }],
    to: { x: 2.3, z: 14.2 },
    yaw: -2.9,
    pitch: 0.18,
  },
  {
    chamber: "two-of-us",
    name: "04-gallery",
    play: true,
    via: [{ x: 4.75, z: 4.4 }, { x: 4.75, z: 10.8 }, { x: 4.0, z: 12.4 }],
    to: { x: 2.15, z: 13.0 },
    yaw: -2.83,
    pitch: 0.44,
  },

  {
    chamber: "two-of-us",
    name: "04-view-of-01",
    play: true,
    via: [{ x: 4.75, z: 4.4 }, { x: 4.75, z: 10.8 }, { x: 4.0, z: 12.4 }],
    to: { x: 3.1, z: 13.9 },
    yaw: 1.55,
    pitch: 0.03,
  },

  { chamber: "long-standing", name: "05-entry", to: { x: 0, z: 2.4 }, yaw: 0, pitch: 0 },
  { chamber: "long-standing", name: "05-plates", to: { x: 0, z: 4.0 }, yaw: -0.85, pitch: 0.2 },
  { chamber: "long-standing", name: "05-passage", to: { x: 0, z: 6.6 }, yaw: 0, pitch: 0.02 },

  // 06's subject is the length of the hall, so one shot has to be the length.
  { chamber: "giving-back", name: "06-entry", to: { x: 0, z: 2.4 }, yaw: 0, pitch: 0 },
  { chamber: "giving-back", name: "06-plate-wait", to: { x: 3, z: 4 }, yaw: -0.1, pitch: 0.02 },
  { chamber: "giving-back", name: "06-long-hall", to: { x: 0, z: 14 }, yaw: 0, pitch: 0 },
  { chamber: "giving-back", name: "06-partition", to: { x: 0, z: 25.5 }, yaw: 0, pitch: 0.02 },

  // The board each room wears. 05, 06 and 07 have no corridor, so they can all
  // repeat 03's problem: a sign on the far wall behind a partition, on the side
  // away from the exit, that play never puts in frame.
  { chamber: "long-standing", name: "05-inside", play: true, via: [{ x: 0, z: 9.0 }], to: { x: 0, z: 12.4 }, yaw: -1.15, pitch: 0.02 },
  { chamber: "long-standing", name: "05-sign", via: [{ x: -3, z: 8 }], to: { x: -3, z: 15.4 }, yaw: 0, pitch: -0.05 },
  { chamber: "giving-back", name: "06-sign", via: [{ x: 4.6, z: 26 }, { x: 4.6, z: 31 }], to: { x: 1.6, z: 31.4 }, yaw: -0.55, pitch: -0.05 },
  { chamber: "unkept", name: "07-sign", via: [{ x: 4.4, z: 5.5 }, { x: 4.4, z: 13 }], to: { x: 3.4, z: 15.2 }, yaw: -0.2, pitch: -0.06 },

  { chamber: "unkept", name: "07-entry", to: { x: 0, z: 2.4 }, yaw: 0, pitch: 0 },
  { chamber: "unkept", name: "07-lean", to: { x: -3.2, z: 5.6 }, yaw: -1.3, pitch: -0.08 },
  { chamber: "unkept", name: "07-torn-door", to: { x: 0, z: 7.2 }, yaw: 0, pitch: 0.03 },
  { chamber: "unkept", name: "07-slot", to: { x: 0, z: 7.4 }, yaw: 0, pitch: 0.02 },
  { chamber: "ending-corridor", name: "e1-first-windows", to: { x: 0.8, z: 2.4 }, yaw: -0.5, pitch: 0.02 },
  { chamber: "ending-corridor", name: "e2-down-the-corridor", to: { x: 1.1, z: 11 }, yaw: 0.02, pitch: 0.0 },
  { chamber: "ending-corridor", name: "e3-window-close", to: { x: -1.3, z: 22.5 }, yaw: -1.5, pitch: 0.04 },
  // 08's window is empty on purpose and the test pins it that way. Photograph
  // it so the emptiness is reviewable rather than assumed.
  { chamber: "ending-corridor", name: "e4-empty-window", to: { x: -1.3, z: 9 }, yaw: -1.5, pitch: 0.04 },
  { chamber: "ending-corridor", name: "e5-last-window-00", to: { x: -1.3, z: 45 }, yaw: -1.5, pitch: 0.04 },
  { chamber: "unkept", name: "07-plate", to: { x: 3.6, z: 3.4 }, yaw: 0.06, pitch: 0.34 },
];

// ONLY=04,05 shoots just those rooms. Re-shooting thirteen frames to look at one
// room is most of the cost of a dressing pass.
const only = process.env.ONLY?.split(",").map((part) => part.trim()).filter(Boolean);
const SELECTED = only?.length ? SHOTS.filter((shot) => only.some((p) => shot.name.startsWith(p))) : SHOTS;

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
    const state = globalThis.__I_WAS_SO_I_AM_FP__.state;
    const actor = state.actors.find((a) => a.id === "present");
    return { x: actor?.x ?? 0, y: actor?.y ?? 0, z: actor?.z ?? 0, phase: state.phase };
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

const act = (method, ...args) =>
  page.evaluate(([m, a]) => globalThis.__I_WAS_SO_I_AM_FP__[m](...a), [method, args]);

const until = async (predicate, budgetMs = 12000) => {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (predicate(await here())) return true;
    await page.waitForTimeout(50);
  }
  return false;
};

/**
 * Getting a room into the state worth photographing.
 *
 * The frames that matter in these rooms are the ones with him in them, and he
 * only exists after a tape has been recorded and folded. Walking to a spot and
 * pointing the camera photographs an empty room doing nothing — 04's gallery is
 * behind a door that is shut until he is holding the grip downstairs, so there
 * is no pose that reaches it without playing the room first.
 */
const PLAYS = {
  // 05's passage is shut until he is standing on the first plate, so the inside
  // of it — which is the whole room — cannot be photographed from any pose.
  // Record the long stand, fold, and walk in while he holds the door for you.
  "long-standing": async () => {
    await walkTo({ x: -4, z: 6 });
    // The stand is the recording. Four seconds of nothing is the point of it.
    await page.waitForTimeout(4600);
    await walkTo({ x: 4, z: 6 });
    await page.waitForTimeout(400);
    await act("fold");
    await until((s) => s.phase === "replay");
    await until(() => true, 200);
    await page.waitForTimeout(1600);
  },

  "two-of-us": async () => {
    await walkTo({ x: 0, z: 5.6 });
    await act("press", "KeyE");
    await until((s) => s.z > 5.4);
    await page.waitForTimeout(400);
    await act("fold");
    await act("release", "KeyE");
    await until((s) => s.phase === "replay");
    // Let him get back to the grip before starting the climb.
    await page.waitForTimeout(1400);
  },
};

await mkdir(outputDirectory, { recursive: true });
try {
  await page.goto(gameUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => globalThis.__I_WAS_SO_I_AM_FP__?.renderer?.ready === true);
  await page.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.start());
  await page.waitForTimeout(400);

  let current = null;
  let played = false;
  for (const shot of SELECTED) {
    if (shot.chamber !== current) {
      const moved = await page.evaluate(
        (id) => globalThis.__I_WAS_SO_I_AM_FP__.switchChamber(id),
        shot.chamber,
      );
      if (!moved) throw new Error(`No chamber called ${shot.chamber}`);
      current = shot.chamber;
      await page.waitForTimeout(500);
      played = false;
    }
    if (shot.play && !played) {
      await PLAYS[shot.chamber]?.();
      played = true;
    }
    // Waypoints, because a straight line into a staircase is a wall. 04 is the
    // first room where the shot is upstairs and the route is not the aim.
    for (const leg of shot.via ?? []) await walkTo(leg);
    await walkTo(shot.to);
    await page.evaluate(
      ([yaw, pitch]) => globalThis.__I_WAS_SO_I_AM_FP__.setLook(yaw, pitch),
      [shot.yaw, shot.pitch],
    );
    await page.waitForTimeout(320);
    await setHudVisible(false);
    await page.screenshot({ path: `${outputDirectory}/${shot.name}.png` });
    await setHudVisible(true);
    const at = await here();
    // Where it actually stood, not where it was asked to: a pose that silently
    // fell short is a frame of the wrong room.
    console.log(
      `${outputDirectory}/${shot.name}.png  at ${at.x.toFixed(2)},${at.y.toFixed(2)},${at.z.toFixed(2)} ${at.phase}`,
    );
  }
} finally {
  await browser.close();
}
