// Plays all four chambers end to end in a real browser, through the real
// controls, and advances between them the way a player does. A golden tape that
// passes in Node still has to survive a renderer, a HUD, and a room teardown.
// Usage: node scripts/fp-journey.mjs
import { chromium } from "@playwright/test";

const gameUrl = process.env.GAME_URL ?? "http://127.0.0.1:4173/";
const failures = [];
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(label);
};

const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => {
  Object.defineProperty(globalThis.navigator, "webdriver", { configurable: true, get: () => false });
});

const read = () => page.evaluate(() => {
  const fp = globalThis.__I_WAS_SO_I_AM_FP__;
  const state = fp.state;
  const present = state.actors.find((a) => a.id === "present");
  const past = state.actors.find((a) => a.id === "past");
  return {
    chamber: fp.chamberId(),
    phase: state.phase,
    x: present?.x ?? 0, z: present?.z ?? 0,
    pastZ: past?.z ?? null,
    doors: state.doors.map((d) => d.open),
    exitOpen: state.exitOpen,
    plates: state.plates.map((p) => p.active),
    holds: state.holds.map((h) => h.active),
    subtitle: globalThis.document.querySelector(".subtitle")?.textContent ?? "",
  };
});
const act = (name, ...args) => page.evaluate(([m, a]) => globalThis.__I_WAS_SO_I_AM_FP__[m](...a), [name, args]);
const hold = async (keys, ms) => {
  for (const k of keys) await act("press", k);
  await page.waitForTimeout(ms);
  for (const k of keys) await act("release", k);
};
/** Hold keys until the world says to stop, rather than for a guessed duration. */
const walkUntil = async (keys, pred, ms = 15000) => {
  for (const k of keys) await act("press", k);
  try {
    return await until(pred, ms);
  } finally {
    for (const k of keys) await act("release", k);
  }
};
const until = async (pred, ms = 20000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const s = await read();
    if (pred(s)) return s;
    if (Date.now() > deadline) throw new Error(`timeout; last ${JSON.stringify(s)}`);
    await page.waitForTimeout(20);
  }
};

try {
  await page.goto(gameUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => globalThis.__I_WAS_SO_I_AM_FP__?.renderer?.ready === true);
  await page.locator("#start-button").click();
  await page.waitForTimeout(500);

  // ---- 00 Awakening: walk on, wait for the door, fold, walk out.
  check("00 is where the archive starts", (await read()).chamber === "awakening");
  const entry00 = (await read()).subtitle;
  check("00 says its line on the way in", entry00.includes("기억 보관소에 오신 것을"), entry00);
  await act("setLook", 0, 0);
  await hold(["KeyW"], 1300);
  await until((s) => s.plates[0] === true);
  await until((s) => s.doors[0] === true);
  check("00 door waits, then opens on the plate", true);
  await act("fold");
  await until((s) => s.phase === "replay");
  await hold(["KeyW"], 4200);
  await until((s) => s.phase === "success");
  check("00 can be finished", true);

  // ---- advance to 01
  await act("advanceChamber");
  await page.waitForTimeout(700);
  check("advancing reaches 01", (await read()).chamber === "second-self");
  const entry01 = (await read()).subtitle;
  check("01 says its line", entry01.includes("메아리"), entry01);

  // 01: stand on the plate that ignores you, fold, then walk through his door.
  await act("setLook", 0, 0);
  // Walk on and STOP. Folding mid-stride is the failure this room teaches: he
  // would walk straight over the plate and hold nothing open.
  await hold(["KeyW"], 1300);
  await page.waitForTimeout(800);
  const on01 = await read();
  check("01 plate ignores the living player", on01.plates[0] === false && on01.doors[0] === false);
  await act("fold");
  await until((s) => s.phase === "replay");
  await until((s) => s.doors[0] === true, 12000);
  check("01 door opens once the echo is standing there", true);
  await hold(["KeyW"], 4500);
  await until((s) => s.phase === "success");
  check("01 can be finished", true);

  // ---- 02
  await act("advanceChamber");
  await page.waitForTimeout(700);
  check("advancing reaches 02", (await read()).chamber === "holding-hand");
  await act("setLook", 0, 0);
  await hold(["KeyW"], 280);
  await act("press", "KeyE");
  await until((s) => s.holds[0] === true, 8000);
  check("02 grip can be taken", true);
  const held02 = await read();
  check("02 exit opens while it is held", held02.exitOpen === true);
  await act("fold");
  await act("release", "KeyE");
  await until((s) => s.phase === "replay");
  const replay02 = await until((s) => s.holds[0] === true, 8000);
  check("02 echo is holding it in the second pass", replay02.exitOpen === true);
  await hold(["KeyW"], 6000);
  await until((s) => s.phase === "success", 15000);
  check("02 can be finished", true);

  // ---- 03
  await act("advanceChamber");
  await page.waitForTimeout(700);
  check("advancing reaches 03", (await read()).chamber === "hand-not-body");
  await act("setLook", 0, 0);
  await hold(["KeyW"], 2600);
  const blocked = await read();
  check("03 the shut doorway stops the recording", blocked.z < 9 && blocked.doors[0] === false, `z ${blocked.z.toFixed(2)}`);
  await act("fold");
  await until((s) => s.phase === "replay");
  // Step onto the amber plate and stay there while he walks through. Steered by
  // where the plate actually is, because the plate is 1.9 m across and a guessed
  // walk duration is not.
  await act("setLook", Math.PI / 2, 0);
  await walkUntil(["KeyW"], (s) => s.x >= 3.5);
  await act("setLook", 0, 0);
  await walkUntil(["KeyW"], (s) => s.plates[0] === true);
  check("03 amber plate opens the doorway for him", (await read()).doors[0] === true);
  const through = await until((s) => s.exitOpen === true, 15000);
  check("03 he reaches the alcove and opens the way out", through.pastZ !== null && through.pastZ > 9.6);
  await hold(["KeyW"], 4500);
  await until((s) => s.phase === "success", 15000);
  const done = await read();
  check("03 can be finished", true);
  check("03 the doorway shut behind him", done.doors[0] === false);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\nfp journey: FAIL (${failures.length}) — ${failures.join("; ")}`);
  process.exitCode = 1;
} else {
  console.log("\nfp journey: PASS — 00 to 03 played through in a browser");
}
