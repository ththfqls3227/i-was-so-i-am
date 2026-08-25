import { expect, test } from "@playwright/test";
import { act, heldForARealBeat, read, startGame, waitInPage, walkInPage } from "./support/fp";

/**
 * 09 and the corridor — the part of the game the whole thing is built to reach.
 *
 * Every door in the campaign latches except this one, and the only way to hold a
 * door open is the thing 02 taught on the third minute. Nothing explains that,
 * so if any of this stops being true the ending stops working and no other test
 * would notice.
 */

test.describe.configure({ mode: "serial" });

test("the last hold keeps him, and the game ends on the key that ended every recording", async ({ page }) => {
  // Twenty-one seconds of it is standing still watching nothing happen, which
  // is the assertion.
  test.setTimeout(300_000);
  await startGame(page);
  expect(await act(page, "switchChamber", "last-hold")).toBe(true);
  await page.waitForTimeout(700);
  await act(page, "start");
  await act(page, "setLook", 0, 0);

  // ① The same approach as 02: the grip is in the same place and still opens
  // the way out. If the walk to it ever changes, the finale stops being the
  // room the player already knows.
  // The pillar is already inside the look raycast from the spawn, so this walks
  // nowhere on purpose. Walking "a little closer" first is what broke it: every
  // command is a round trip, and under tracing those are slow enough that the
  // player sails past the pillar and it ends up behind them.
  await waitInPage(page, "v.focus === 'grip-pillar'", 10000);
  await act(page, "press", "KeyE");
  await waitInPage(page, "s.holds.find((h) => h.id === 'grip-pillar').active === true", 10000);
  expect((await read(page)).exitOpen).toBe(true);
  expect((await read(page)).seal, "what is sealed here is not a record").toBe("rgb(111, 217, 242)");

  // ③ The fold is held, and the crosshair leaves before the freeze — a freeze
  // with no warning reads as the game hanging.
  await heldForARealBeat(page);
  // Both waits are armed before the key is pressed. The hold is eight tenths of
  // a second and every command here is a round trip — start looking afterwards
  // and the whole window can be over before the first poll.
  const sealing = waitInPage(page, "v.sealing === true", 8000);
  const landed = waitInPage(page, 's.phase === "replay"', 12000);
  const startedAt = Date.now();
  await act(page, "fold");
  await sealing;
  expect((await read(page)).crosshairSealing).toBe("true");
  await landed;
  // What this can prove is that the fold was held rather than instant, and that
  // it landed. The exact eight tenths is pinned in the simulation tests, where
  // the measurement is not carrying the harness's round trips with it — so the
  // upper bound here is loose on purpose and only catches a hang.
  const held = (Date.now() - startedAt) / 1000;
  expect(held, "the fold was held, not instant").toBeGreaterThan(0.4);
  expect(held, "and it landed rather than hanging").toBeLessThan(10);
  await act(page, "release", "KeyE");

  // ② Stand still until the replay window has expired and watch nothing happen.
  // Everywhere else he would be gone by now; this is the whole ending.
  await waitInPage(page, "s.holds.find((h) => h.id === 'grip-pillar').active === true", 10000);
  await page.waitForTimeout(21000);
  const after = await read(page);
  expect(after.pastZ, "he is still there after the window expired").not.toBeNull();
  expect(after.holdById["grip-pillar"], "he is still holding it").toBe(true);
  expect(after.doorById["inner-door"], "the door he holds is still open").toBe(true);
  expect(after.exitOpen).toBe(true);
  expect(after.phase, "the room did not fail out from under him").toBe("replay");

  // ④ Rerecord still works here. Only the sentence changes, and it means it.
  expect(after.rerecordNotice).toContain("회수되지 않습니다");

  await walkInPage(page, ["KeyW"], 's.phase === "success"', 60000);
  expect((await read(page)).holdById["grip-pillar"], "he is left there after you have gone").toBe(true);

  // ⑤ Into the corridor, which asks for nothing.
  await act(page, "advanceChamber");
  await page.waitForFunction(
    () => window.__I_WAS_SO_I_AM_FP__?.chamberId() === "ending-corridor",
    null,
    { timeout: 20000 },
  );
  const corridor = await read(page);
  expect(corridor.canFold).toBe(false);
  expect(corridor.plates).toEqual([]);
  expect(corridor.doors).toEqual([]);
});

test("the corridor ends on one line and nothing else", async ({ page }) => {
  test.setTimeout(240_000);
  await startGame(page);
  expect(await act(page, "switchChamber", "ending-corridor")).toBe(true);
  await page.waitForTimeout(700);
  await act(page, "start");
  await act(page, "setLook", 0, 0);

  await walkInPage(page, ["KeyW"], 's.phase === "success"', 90000);
  expect(await act(page, "advanceChamber"), "there is nothing after this").toBe(false);

  const atDoor = await read(page);
  expect(atDoor.finalBeat, "the last door offers the fold key").not.toBeNull();
  expect(
    atDoor.resultHint,
    "and does not offer a next room that is not there",
  ).toBe(atDoor.finalBeat);

  // Stamp, blackout, silence, title. The silence is the point of the sequence:
  // nothing on screen and nothing to press, long enough to be uncomfortable if
  // you were waiting for a menu.
  //
  // Recorded from inside the page rather than sampled from here. The quiet
  // stretch is about a second and a half wide, and every command from the test
  // side is a round trip — checking "is the title absent yet" from out here
  // raced the sequence and sometimes arrived after it had finished.
  await page.evaluate(() => {
    const shown = (selector: string): boolean => {
      const node = document.querySelector<HTMLElement>(selector);
      return node !== null && !node.hidden && node.offsetParent !== null;
    };
    const log: { t: number; finale: boolean; result: boolean; say: boolean }[] = [];
    const started = performance.now();
    const timer = window.setInterval(() => {
      log.push({
        t: performance.now() - started,
        finale: shown(".finale"),
        result: shown(".result"),
        say: document.querySelector(".subtitle")?.getAttribute("data-shown") === "true",
      });
    }, 40);
    Object.assign(window, { __endingLog: log, __endingTimer: timer });
  });

  await act(page, "fold");
  const finale = page.locator(".finale");
  // The archivist speaks into the dark for some twenty seconds before the
  // title answers her — the wait is sized for the goodbye, not for a cut.
  await expect(finale, "the title arrives").toBeVisible({ timeout: 32000 });
  await expect(finale.locator("h1")).toHaveText("I WAS, SO I AM.");

  const timeline = await page.evaluate(() => {
    const w = window as unknown as { __endingLog: { t: number; finale: boolean; result: boolean; say: boolean }[]; __endingTimer: number };
    window.clearInterval(w.__endingTimer);
    return w.__endingLog;
  });

  const firstTitle = timeline.find((frame) => frame.finale);
  expect(firstTitle, "the title was recorded arriving").toBeDefined();
  const spoken = timeline.some((frame) => frame.say && !frame.finale);
  expect(spoken, "the archivist speaks in the dark before the title").toBe(true);
  const quiet = timeline.filter((frame) => !frame.finale && !frame.result && !frame.say);
  expect(quiet.length, "there is a stretch with nothing on screen at all").toBeGreaterThan(0);
  const quietFor = (quiet[quiet.length - 1]?.t ?? 0) - (quiet[0]?.t ?? 0);
  expect(quietFor, "and it lasts long enough to be a silence").toBeGreaterThan(800);
  expect(firstTitle?.t ?? 0, "the title does not cut the goodbye short").toBeGreaterThan(2000);

  // Nothing to press while it stands.
  await expect(page.locator("#advance-button")).toBeHidden();
  await expect(page.locator("#rerecord-button")).toBeHidden();

  // Pressing it again must not restart anything.
  await act(page, "fold");
  await page.waitForTimeout(400);
  await expect(finale).toBeVisible();
  await expect(finale.locator("h1")).toHaveText("I WAS, SO I AM.");
});
