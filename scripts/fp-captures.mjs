// First-person slice captures: plays the room through the record / fold / replay
// loop and writes unthrottled 1600x900 PNGs for art review.
// Usage: node scripts/fp-captures.mjs [outputDirectory]
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { startGameServer } from "./support/serve.mjs";

// Built and served by us, from dist-e2e/, on our own port. See support/serve.mjs
// for why this must not be whatever happens to be listening on the dev port.
const server = await startGameServer({ label: "captures" });
const gameUrl = server.url;
const outputDirectory = process.argv[2] ?? "captures/g0";
const viewport = { width: 1600, height: 900 };
const HALF_PI = Math.PI / 2;

// Captures have to show what a player sees, so the automation flag the scene
// could throttle on is cleared before the app boots.
const clearAutomationFlag = () => {
  Object.defineProperty(globalThis.navigator, "webdriver", { configurable: true, get: () => false });
};

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--force-device-scale-factor=1"],
});
const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
await page.addInitScript(clearAutomationFlag);

const api = () => page.evaluateHandle(() => globalThis.__I_WAS_SO_I_AM_FP__);
const read = () =>
  page.evaluate(() => {
    const fp = globalThis.__I_WAS_SO_I_AM_FP__;
    const state = fp.state;
    const present = state.actors.find((actor) => actor.id === "present");
    const past = state.actors.find((actor) => actor.id === "past");
    return {
      phase: state.phase,
      tapeTick: state.tapeTick,
      present: present ? { x: present.x, z: present.z } : null,
      past: past ? { x: past.x, z: past.z } : null,
      doorOpen: state.doors[0]?.open ?? false,
      canFold: fp.view.canFold,
      fps: fp.view.fps,
    };
  });

const act = (name, ...args) =>
  page.evaluate(
    ([method, params]) => globalThis.__I_WAS_SO_I_AM_FP__[method](...params),
    [name, args],
  );

const until = async (predicate, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = await read();
    if (predicate(snapshot)) return snapshot;
    if (Date.now() > deadline) throw new Error(`Timed out waiting; last: ${JSON.stringify(snapshot)}`);
    await page.waitForTimeout(12);
  }
};

const shot = async (name, note) => {
  await page.screenshot({ path: `${outputDirectory}/${name}.png` });
  console.log(`${outputDirectory}/${name}.png — ${note}`);
};

await mkdir(outputDirectory, { recursive: true });

try {
  await page.goto(gameUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => globalThis.__I_WAS_SO_I_AM_FP__?.renderer?.ready === true);
  await api();
  await page.waitForTimeout(1600);
  await shot("01-title", "title card over the live room");

  await act("start");
  await page.waitForTimeout(500);

  // --- recording pass: walk to the plate ---
  await act("press", "KeyW");
  await until((snapshot) => (snapshot.present?.z ?? 0) > 4.2);
  await shot("02-recording", "first pass, walking the room");
  await until((snapshot) => (snapshot.present?.z ?? 0) > 7.2);
  await act("release", "KeyW");
  await until((snapshot) => snapshot.doorOpen && snapshot.canFold);
  await page.waitForTimeout(500);
  await shot("03-plate", "standing on the plate, the door open behind it");

  // --- fold ---
  await act("fold");
  await page.waitForTimeout(240);
  await shot("04-fold", "the recording ends in the posture being held");

  // --- second pass: step aside and walk beside the echo ---
  await act("press", "KeyD");
  await until((snapshot) => (snapshot.present?.x ?? 0) > 1.9);
  await act("release", "KeyD");
  // Face across the room and a little forward, so the echo sits in frame rather
  // than sliding off the edge of it.
  await act("setLook", -HALF_PI + 0.5, 0.05);
  await act("press", "KeyD");
  await until((snapshot) => (snapshot.past?.z ?? 0) > 4.4);
  await shot("05-echo-passby", "walking beside the echo, mid-stride");
  await until((snapshot) => (snapshot.past?.z ?? 0) > 6.4);
  await shot("06-echo-alongside", "the echo still ahead, closing on the plate");
  await act("release", "KeyD");

  // --- face to face on the plate ---
  // Walk past the plate, turn around, and look back at the self standing on it.
  await until((snapshot) => (snapshot.past?.z ?? 0) > 7.3 && snapshot.doorOpen);
  await act("setLook", 0, 0.04);
  await act("press", "KeyW");
  await until((snapshot) => (snapshot.present?.z ?? 0) > 9.6);
  await act("release", "KeyW");
  await page.waitForTimeout(300);
  // Aim back down the room at the plate, from the right of it.
  const standing = await read();
  const dx = 0 - (standing.present?.x ?? 0);
  const dz = (standing.past?.z ?? 7.6) - (standing.present?.z ?? 9.8);
  await act("setLook", Math.atan2(dx, dz), 0.16);
  await page.waitForTimeout(700);
  await shot("07-echo-face", "looking back at the self that opened the door");

  // --- out through the corridor ---
  // Line up with the doorway first: it is narrower than the room, and walking
  // at it from the side is walking at a wall.
  await act("setLook", -HALF_PI, 0.02);
  await act("press", "KeyW");
  await until((snapshot) => Math.abs(snapshot.present?.x ?? 9) < 0.45);
  await act("release", "KeyW");
  await act("setLook", 0, 0.02);
  await act("press", "KeyW");
  await until((snapshot) => (snapshot.present?.z ?? 0) > 12.6);
  await shot("08-corridor", "through the door, into the corridor");
  await until((snapshot) => (snapshot.present?.z ?? 0) > 14.4);
  await shot("09-exit", "the corridor, and the way out");
  await until((snapshot) => snapshot.phase === "success");
  await act("release", "KeyW");
  await page.waitForTimeout(700);
  await shot("10-success", "chamber cleared");

  const final = await read();
  console.log(`frame rate at the end: ${final.fps.toFixed(1)} fps`);
} finally {
  await browser.close();
  await server.stop();
}
