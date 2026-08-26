// A draft of the demo video: the storyboard beats, played at a human pace and
// recorded. fp-journey drives the same rooms with the shortest inputs the rules
// accept, which photographs as a robot; this one lingers where a player would —
// on the subtitle, on the echo passing, on the last look back.
//
// Playwright records without audio. The draft is silent by design; the notes
// say so wherever the draft is offered.
//
// Usage: node scripts/demo-video.mjs [outputDirectory]
//   BEATS=00,09,corridor  plays only those beats (a cut list, for trimming).
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { startGameServer } from "./support/serve.mjs";

const server = await startGameServer({ label: "demo-video" });
const outputDirectory = process.argv[2] ?? "captures/submission/video";
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu"] });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: outputDirectory, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
await page.addInitScript(() => {
  Object.defineProperty(globalThis.navigator, "webdriver", { configurable: true, get: () => false });
});
// The test build wears its fps counter, and a handle-driven run never sends a
// real mouse, so the pointer-lock fallback notice would sit on screen for the
// whole film. Neither belongs in the video.
await page.addInitScript(() => {
  const style = globalThis.document.createElement("style");
  style.textContent = ".diagnostic{display:none !important}.notice{display:none !important}";
  globalThis.document.addEventListener("DOMContentLoaded", () => globalThis.document.head.append(style));
});

const startedAt = Date.now();
const stamps = [];
const beat = (name) => {
  stamps.push({ name, at: (Date.now() - startedAt) / 1000 });
  console.log(`beat ${name} at ${stamps.at(-1).at.toFixed(1)}s`);
};

const read = () =>
  page.evaluate(() => {
    const fp = globalThis.__I_WAS_SO_I_AM_FP__;
    const state = fp.state;
    const present = state.actors.find((a) => a.id === "present");
    const past = state.actors.find((a) => a.id === "past");
    return {
      chamber: fp.chamberId(),
      phase: state.phase,
      x: present?.x ?? 0,
      y: present?.y ?? 0,
      z: present?.z ?? 0,
      pastZ: past?.z ?? null,
      doors: state.doors.map((d) => d.open),
      exitOpen: state.exitOpen,
      plates: state.plates.map((p) => p.active),
      plateById: Object.fromEntries(state.plates.map((p) => [p.id, p.active])),
      holdById: Object.fromEntries(state.holds.map((h) => [h.id, h.active])),
      doorById: Object.fromEntries(state.doors.map((d) => [d.id, d.open])),
      finalBeat: fp.view.finalBeat ?? null,
      finaleOn: globalThis.document.querySelector(".finale")?.dataset.on ?? "",
    };
  });
const act = (name, ...args) =>
  page.evaluate(([m, a]) => globalThis.__I_WAS_SO_I_AM_FP__[m](...a), [name, args]);
const until = async (pred, ms = 25000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const s = await read();
    if (pred(s)) return s;
    if (Date.now() > deadline) throw new Error(`timeout; last ${JSON.stringify(s)}`);
    await page.waitForTimeout(20);
  }
};
const walkUntil = async (keys, pred, ms = 25000) => {
  for (const k of keys) await act("press", k);
  try {
    return await until(pred, ms);
  } finally {
    for (const k of keys) await act("release", k);
  }
};
const hold = async (keys, ms) => {
  for (const k of keys) await act("press", k);
  await page.waitForTimeout(ms);
  for (const k of keys) await act("release", k);
};

// The camera never snaps. Whatever the look servo is asked, it gets there in
// small steps over real time, which is the whole difference between a replay
// harness and something watchable.
let lookYaw = 0;
let lookPitch = 0;
const smoothLook = async (yaw, pitch, ms = 900) => {
  const steps = Math.max(6, Math.round(ms / 33));
  const fromYaw = lookYaw;
  const fromPitch = lookPitch;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const ease = t * t * (3 - 2 * t);
    await act("setLook", fromYaw + (yaw - fromYaw) * ease, fromPitch + (pitch - fromPitch) * ease);
    await page.waitForTimeout(ms / steps);
  }
  lookYaw = yaw;
  lookPitch = pitch;
};
/** Steer toward a point, re-aiming while walking. For beats that pause
 *  mid-room and therefore cannot reuse a fixed input recipe. */
const steerTo = async (target) => {
  await act("press", "KeyW");
  try {
    for (let guard = 0; guard < 700; guard += 1) {
      const at = await read();
      const dx = target.x - at.x;
      const dz = target.z - at.z;
      if (Math.hypot(dx, dz) < 0.3) break;
      const yaw = Math.atan2(dx, dz);
      await act("setLook", yaw, 0);
      lookYaw = yaw;
      lookPitch = 0;
      await page.waitForTimeout(16);
    }
  } finally {
    await act("release", "KeyW");
  }
};

const jumpTo = async (id) => {
  await act("switchChamber", id);
  await page.waitForFunction(() => globalThis.__I_WAS_SO_I_AM_FP__?.renderer?.ready === true, null, { timeout: 20000 });
  lookYaw = 0;
  lookPitch = 0;
  // Read the room's line before doing anything in it.
  await page.waitForTimeout(2000);
};

const BEATS = {
  "00": async () => {
    beat("00 awakening");
    await jumpTo("awakening");
    await smoothLook(-0.6, 0.04, 1100);
    await smoothLook(0.6, 0.02, 1600);
    await smoothLook(0, 0, 700);
    await hold(["KeyW"], 1300);
    await until((s) => s.doors[0] === true, 8000);
    await page.waitForTimeout(900);
    await act("fold");
    await until((s) => s.phase === "replay");
    // Watch the echo set off before following it out.
    await smoothLook(-0.35, 0.02, 800);
    await page.waitForTimeout(1200);
    await smoothLook(0, 0, 600);
    await walkUntil(["KeyW"], (s) => s.phase === "success");
    await page.waitForTimeout(1400);
  },

  "02": async () => {
    beat("02 holding hand");
    await jumpTo("holding-hand");
    await hold(["KeyW"], 300);
    await act("press", "KeyE");
    await until((s) => s.holdById["hand-grip"] === true || Object.values(s.holdById)[0] === true, 8000);
    await page.waitForTimeout(1500);
    await act("fold");
    await act("release", "KeyE");
    await until((s) => s.phase === "replay");
    await until((s) => Object.values(s.holdById)[0] === true, 8000);
    // Halfway out, turn and look at him still holding it.
    await walkUntil(["KeyW"], (s) => s.z > 5.2);
    await smoothLook(Math.PI, 0.05, 1100);
    await page.waitForTimeout(1800);
    await smoothLook(0, 0, 900);
    await walkUntil(["KeyW"], (s) => s.phase === "success");
    await page.waitForTimeout(1200);
  },

  "03": async () => {
    beat("03 hand not body");
    await jumpTo("hand-not-body");
    // Establish the room before walking into a wall. W is camera-relative, so
    // the treadmill cannot be filmed from an angle — turning turns the walk —
    // and the old beat spent three of its four seconds on a rectangle of door
    // paper filling the frame. The look happens first, and the press-in is cut
    // to what the lesson needs rather than what the tape can hold.
    await smoothLook(-0.55, 0.05, 900);
    await smoothLook(0, 0.02, 700);
    // Walk into the shut door and keep walking. The treadmill is the lesson.
    await hold(["KeyW"], 3200);
    await page.waitForTimeout(500);
    await act("fold");
    await until((s) => s.phase === "replay");
    await smoothLook(Math.PI / 2, 0, 700);
    await walkUntil(["KeyW"], (s) => s.x >= 3.5);
    await smoothLook(0, 0, 500);
    await walkUntil(["KeyW"], (s) => s.plates[0] === true);
    // From the amber plate, frame the doorway he is about to walk through.
    await smoothLook(-0.7, 0.04, 900);
    await until((s) => s.exitOpen === true, 15000);
    await page.waitForTimeout(1000);
    await smoothLook(0, 0, 700);
    await walkUntil(["KeyW"], (s) => s.phase === "success");
    await page.waitForTimeout(1200);
  },

  "04": async () => {
    beat("04 two of us");
    await jumpTo("two-of-us");
    await walkUntil(["KeyW"], (s) => s.z > 5.4);
    await act("press", "KeyE");
    await until((s) => s.holdById["ground-grip"] === true, 8000);
    await page.waitForTimeout(1400);
    await act("fold");
    await act("release", "KeyE");
    await until((s) => s.phase === "replay");
    await until((s) => s.holdById["ground-grip"] === true, 10000);
    await walkUntil(["KeyW", "KeyD"], (s) => s.x > 3.7);
    await walkUntil(["KeyW"], (s) => s.y > 3.3);
    await walkUntil(["KeyW"], (s) => s.z > 12.9);
    await act("press", "KeyE");
    await until((s) => s.holdById["gallery-grip"] === true, 8000);
    await act("release", "KeyE");
    // The gallery: lean on the rail and look back down at him.
    await smoothLook(-2.83, 0.44, 1300);
    await page.waitForTimeout(2600);
    await smoothLook(0, 0, 900);
    await walkUntil(["KeyW"], (s) => s.phase === "success");
    await page.waitForTimeout(1200);
  },

  "08": async () => {
    beat("08 silence");
    await jumpTo("silence");
    await page.waitForTimeout(800);
    await hold(["KeyW"], 1100);
    // The plate someone never left. Stand with him a moment.
    await smoothLook(-0.9, 0.05, 1100);
    await page.waitForTimeout(2600);
    await smoothLook(0, 0, 800);
    // The pause above moved us off the journey recipe's path, so walk to the
    // plate by where it is (3.4, 7.2), not by a fixed input sequence.
    await steerTo({ x: 3.4, z: 7.2 });
    await until((s) => s.plateById["your-plate"] === true, 6000);
    await page.waitForTimeout(900);
    await steerTo({ x: 0, z: 10.5 });
    await smoothLook(0, 0, 500);
    await walkUntil(["KeyW"], (s) => s.phase === "success");
    await page.waitForTimeout(1400);
  },

  "09": async () => {
    beat("09 last hold");
    await jumpTo("last-hold");
    await hold(["KeyW"], 300);
    await act("press", "KeyE");
    await until((s) => s.holdById["grip-pillar"] === true, 8000);
    await page.waitForTimeout(1800);
    // The held fold. Nothing cuts this.
    await act("fold");
    await until((s) => s.phase === "replay", 5000);
    await act("release", "KeyE");
    await until((s) => s.holdById["grip-pillar"] === true, 8000);
    await page.waitForTimeout(3200);
    await walkUntil(["KeyW"], (s) => s.z > 8.6, 20000);
    // The threshold: one long look back at him, still holding it.
    await smoothLook(Math.PI, 0.06, 1300);
    await page.waitForTimeout(2800);
    await smoothLook(0, 0, 900);
    await walkUntil(["KeyW"], (s) => s.phase === "success", 40000);
    await page.waitForTimeout(1200);
  },

  corridor: async () => {
    beat("corridor");
    await jumpTo("ending-corridor");
    // A steady walk, easing off at the windows.
    for (const stop of [{ z: 9 }, { z: 22.5 }, { z: 40 }]) {
      await walkUntil(["KeyW"], (s) => s.z > stop.z, 40000);
      await smoothLook(-1.5, 0.04, 1000);
      await page.waitForTimeout(1400);
      await smoothLook(0, 0, 800);
    }
    await walkUntil(["KeyW"], (s) => s.phase === "success", 60000);
    await until((s) => s.finalBeat !== null, 10000);
    await page.waitForTimeout(1200);
    beat("last door");
    await act("fold");
    // Blackout, the held silence, the typography. Hold on it.
    await until((s) => s.finaleOn === "true", 8000);
    await page.waitForTimeout(3500);
  },
};

const cut = process.env.BEATS?.split(",").map((p) => p.trim()).filter(Boolean);
const order = ["00", "02", "03", "04", "08", "09", "corridor"];
const selected = cut?.length ? order.filter((b) => cut.includes(b)) : order;

try {
  await page.goto(server.url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => globalThis.__I_WAS_SO_I_AM_FP__?.renderer?.ready === true);
  beat("title");
  await page.waitForTimeout(2200);
  await page.locator("#start-button").click();
  await page.waitForTimeout(600);
  for (const name of selected) await BEATS[name]();
  const total = (Date.now() - startedAt) / 1000;
  console.log(`\ntotal ${total.toFixed(1)}s (${total > 180 ? "OVER 3:00 — cut a beat" : "within 3:00"})`);
  console.log(stamps.map((s) => `  ${s.at.toFixed(1).padStart(6)}s  ${s.name}`).join("\n"));
} finally {
  await page.close();
  const video = page.video();
  if (video) console.log(`video: ${await video.path()}`);
  await context.close();
  await browser.close();
  await server.stop();
}
