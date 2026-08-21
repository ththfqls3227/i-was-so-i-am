// Plays the whole campaign end to end in a real browser, through the real
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
    holdById: Object.fromEntries(state.holds.map((h) => [h.id, h.active])),
    plateById: Object.fromEntries(state.plates.map((p) => [p.id, p.active])),
    doorById: Object.fromEntries(state.doors.map((d) => [d.id, d.open])),
    y: present?.y ?? 0,
    subtitle: globalThis.document.querySelector(".subtitle")?.textContent ?? "",
    sealing: fp.view.sealing === true,
    rerecordNotice: fp.view.rerecordNotice ?? "",
    crosshairSealing: globalThis.document.querySelector(".crosshair")?.dataset.sealing ?? "",
    canFold: fp.view.canFold === true,
    finalBeat: fp.view.finalBeat ?? null,
    resultKind: globalThis.document.querySelector(".result")?.dataset.kind ?? "",
    resultBody: globalThis.document.querySelector(".result p")?.textContent ?? "",
    resultHint: globalThis.document.querySelector(".result .hint")?.textContent ?? "",
    seal: (() => {
      const stamp = globalThis.document.querySelector(".seal");
      return stamp ? globalThis.getComputedStyle(stamp).backgroundColor : "none";
    })(),
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
  check("02 seals a record, in red", (await read()).seal === "rgb(200, 64, 47)", (await read()).seal);
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
  // ---- 04 Two People's Worth
  await act("advanceChamber");
  await page.waitForTimeout(700);
  check("advancing reaches 04", (await read()).chamber === "two-of-us");
  await act("setLook", 0, 0);
  await walkUntil(["KeyW"], (s) => s.z > 5.4);
  await act("press", "KeyE");
  await until((s) => s.holdById["ground-grip"] === true, 8000);
  check("04 the ground grip opens the way up", (await read()).doorById["upper-door"] === true);
  await act("fold");
  await act("release", "KeyE");
  await until((s) => s.phase === "replay");
  await until((s) => s.holdById["ground-grip"] === true, 10000);
  check("04 he holds it below while you climb", true);
  await walkUntil(["KeyW", "KeyD"], (s) => s.x > 3.7);
  const climbed = await walkUntil(["KeyW"], (s) => s.y > 3.3, 20000);
  check("04 the stairs are walked up, not jumped", climbed.y > 3.3, `y ${climbed.y.toFixed(2)}`);
  await walkUntil(["KeyW"], (s) => s.z > 12.9);
  await act("press", "KeyE");
  await until((s) => s.holdById["gallery-grip"] === true, 8000);
  await act("release", "KeyE");
  check("04 the gallery grip latches the way out", (await read()).doorById["way-out"] === true);
  await walkUntil(["KeyW"], (s) => s.phase === "success", 20000);
  check("04 can be finished", true);

  // ---- 05 The One Who Stood a Long Time
  await act("advanceChamber");
  await page.waitForTimeout(700);
  check("advancing reaches 05", (await read()).chamber === "long-standing");
  await act("setLook", 0, 0);
  await walkUntil(["KeyW", "KeyA"], (s) => s.x < -3.6);
  await page.waitForTimeout(5000);
  await act("setLook", Math.PI / 2, 0);
  await walkUntil(["KeyW"], (s) => s.x > 3.6, 20000);
  await page.waitForTimeout(500);
  await act("fold");
  await until((s) => s.phase === "replay");
  await act("setLook", 0, 0);
  await until((s) => s.doorById["way-in"] === true, 10000);
  check("05 his standing opens the way in", true);
  await walkUntil(["KeyW"], (s) => s.z > 11.5, 20000);
  check("05 you get inside while he is standing", (await read()).z > 11.5);
  await until((s) => s.doorById["way-on"] === true, 20000);
  check("05 moving on opens the far end", true);
  await walkUntil(["KeyW"], (s) => s.phase === "success", 20000);
  check("05 can be finished", true);

  // ---- 06 The Hand That Gives Back
  await act("advanceChamber");
  await page.waitForTimeout(700);
  check("advancing reaches 06", (await read()).chamber === "giving-back");
  await act("setLook", 0, 0);
  await walkUntil(["KeyW"], (s) => s.z > 28, 30000);
  await act("fold");
  await until((s) => s.phase === "replay");
  await walkUntil(["KeyW", "KeyD"], (s) => s.plateById["amber-plate"] === true, 15000);
  const waitStart = Date.now();
  await until((s) => s.exitOpen === true, 30000);
  const waited = (Date.now() - waitStart) / 1000;
  check("06 the wait on the plate is about six seconds", waited > 4 && waited < 9, `${waited.toFixed(1)} s`);
  await walkUntil(["KeyW", "KeyD"], (s) => s.x > 4);
  await walkUntil(["KeyW"], (s) => s.phase === "success", 30000);
  check("06 can be finished", true);

  // ---- 07 The Stacks Nobody Keeps
  await act("advanceChamber");
  await page.waitForTimeout(700);
  check("advancing reaches 07", (await read()).chamber === "unkept");
  await act("setLook", 0, 0);
  await act("press", "KeyE");
  await walkUntil(["KeyW"], (s) => s.z > 8.3, 20000);
  await act("release", "KeyE");
  await act("fold");
  await until((s) => s.phase === "replay");
  await walkUntil(["KeyW", "KeyD"], (s) => s.plateById["amber-plate"] === true, 15000);
  await until((s) => s.holdById["slot-grip"] === true, 20000);
  check("07 he walks the slot and takes the grip", (await read()).exitOpen === true);
  // Around the partition, which only spans the middle of the hall.
  await walkUntil(["KeyW", "KeyD"], (s) => s.x > 3.7, 15000);
  await walkUntil(["KeyW"], (s) => s.phase === "success", 25000);
  check("07 can be finished", true);

  // ---- 08 Silence. Nothing is recorded here and nothing can go wrong.
  await act("advanceChamber");
  await page.waitForTimeout(700);
  check("advancing reaches 08", (await read()).chamber === "silence");
  const on08 = await read();
  check("08 offers no recording at all", on08.canFold === false);
  check("08 already has someone standing on the first plate", on08.plateById["old-plate"] === true);
  check("08 the door is shut until you take the other one", on08.doorById["inner-door"] === false);
  await act("setLook", 0, 0);
  await walkUntil(["KeyW", "KeyD"], (s) => s.x > 3.4, 15000);
  await walkUntil(["KeyW"], (s) => s.plateById["your-plate"] === true, 15000);
  check("08 the door opens because two of you are standing on it", (await read()).doorById["inner-door"] === true);
  await walkUntil(["KeyW", "KeyA"], (s) => Math.abs(s.x) < 1, 15000);
  await walkUntil(["KeyW"], (s) => s.phase === "success", 25000);
  check("08 can be finished", true);

  // ---- 09 The Last Hold. 02 again, and the door that does not latch.
  await act("advanceChamber");
  await page.waitForTimeout(700);
  check("advancing reaches 09", (await read()).chamber === "last-hold");
  await act("setLook", 0, 0);
  await hold(["KeyW"], 280);
  await act("press", "KeyE");
  await until((s) => s.holdById["grip-pillar"] === true, 8000);
  check("09 the grip is 02's, and it still opens the way out", (await read()).exitOpen === true);
  // What is sealed here is not a record, and the stamp has to say so.
  check("09 seals in cyan, not red", (await read()).seal === "rgb(111, 217, 242)", (await read()).seal);

  // The fold is held here, and the crosshair leaves before the room stops.
  await act("fold");
  const froze = await until((s) => s.sealing === true, 3000);
  check("09 the fold is held rather than instant", froze.sealing === true);
  check("09 the crosshair goes first, so the freeze is not read as a hang", froze.crosshairSealing === "true");
  const sealStart = Date.now();
  await until((s) => s.phase === "replay", 5000);
  const sealHeld = (Date.now() - sealStart) / 1000;
  check("09 the hold is about eight tenths of a second", sealHeld > 0.4 && sealHeld < 1.6, `${sealHeld.toFixed(2)} s`);
  await act("release", "KeyE");

  // Stand still until the replay window has expired, and watch nothing happen.
  // This is the whole ending: everywhere else he would be gone by now.
  await until((s) => s.holdById["grip-pillar"] === true, 8000);
  await page.waitForTimeout(21000);
  const after = await read();
  check("09 he is still there after the window has expired", after.pastZ !== null);
  check("09 he is still holding it", after.holdById["grip-pillar"] === true);
  check("09 the door he is holding is still open", after.doorById["inner-door"] === true && after.exitOpen === true);
  check("09 the room did not fail out from under him", after.phase === "replay");

  // And rerecord still works — it just says the opposite of what it always said.
  check("09 rerecord says the record is not taken back", after.rerecordNotice.includes("회수되지 않습니다"), after.rerecordNotice);

  await walkUntil(["KeyW"], (s) => s.phase === "success", 40000);
  const finished09 = await read();
  check("09 can be finished", finished09.phase === "success");
  check("09 he is left there after you have gone", finished09.holdById["grip-pillar"] === true);

  // ---- The corridor. Nothing to solve; one window per room, in reverse.
  await act("advanceChamber");
  await page.waitForTimeout(900);
  check("advancing reaches the corridor", (await read()).chamber === "ending-corridor");
  const corridor = await read();
  check("the corridor asks for nothing", corridor.canFold === false && corridor.plates.length === 0 && corridor.doors.length === 0);
  await act("setLook", 0, 0);
  await walkUntil(["KeyW"], (s) => s.phase === "success", 60000);
  check("the corridor can be walked to the end", true);
  check("and there is nothing after it", (await act("advanceChamber")) === false);

  // The last door: the same key, one more time, and it closes the whole thing.
  const atDoor = await read();
  check("the last door offers the fold key", atDoor.finalBeat !== null, String(atDoor.finalBeat));
  check("and does not offer a next room that is not there", atDoor.resultHint === atDoor.finalBeat, atDoor.resultHint);
  await act("fold");
  await page.waitForTimeout(500);
  const ended = await read();
  check("pressing it ends the game", ended.resultKind === "ending", ended.resultKind);
  check("and the last line is the title", ended.resultBody.includes("그래서 지금의 나"), ended.resultBody);
  // Pressing again must not restart anything.
  await act("fold");
  await page.waitForTimeout(300);
  check("pressing it again does nothing", (await read()).resultKind === "ending");
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\nfp journey: FAIL (${failures.length}) — ${failures.join("; ")}`);
  process.exitCode = 1;
} else {
  console.log("\nfp journey: PASS — 00 to 09 and the corridor, played through in a browser");
}
