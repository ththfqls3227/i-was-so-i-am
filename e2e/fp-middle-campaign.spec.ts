import { expect, test } from "@playwright/test";
import {
  act,
  advanceTo,
  heldForARealBeat,
  read,
  startGame,
  waitInPage,
  walkUntil,
} from "./support/fp";

/**
 * The part of the campaign that used to live only in scripts/fp-journey.mjs.
 *
 * The opening suite stops after 03 and the finale suite starts at 09. These
 * five rooms carry the campaign's largest role reversals, so a built-browser
 * gate has to prove both that they finish and that the HUD does not coach a
 * losing recording.
 */
test.describe.configure({ mode: "serial" });
// This spec polls player state while keys are held. Playwright tracing takes a
// DOM snapshot for each poll and can starve the WebGL render loop until a short
// plate contact is skipped. The spec owns explicit console/page/asset gates
// below, so keep the high-frequency drive path untraced.
test.use({ trace: "off" });

test("multi-key browser input stops on release", async ({ page }) => {
  await startGame(page);
  expect(await act(page, "switchChamber", "long-standing")).toBe(true);
  await waitInPage(page, 'window.__I_WAS_SO_I_AM_FP__?.renderer?.ready === true');
  await act(page, "setLook", 0, 0);
  await walkUntil(page, ["KeyW", "KeyA"], (state) => state.x < -3.6);
  // One already-queued simulation frame may land after key-up — and on a
  // loaded machine, two. Settle first, then prove the drift has STOPPED
  // rather than that it never happened: continuing held-input drift covers
  // metres in this window, while a late queued tick covers at most 0.16 m.
  await page.waitForTimeout(600);
  const stopped = await read(page);
  await page.waitForTimeout(800);
  const after = await read(page);
  expect(Math.hypot(after.x - stopped.x, after.z - stopped.z)).toBeLessThan(0.16);
});

test("rooms 04 through 08 stay playable and tell the truth about each pass", async ({ page }) => {
  test.setTimeout(360_000);

  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    browserErrors.push(`request: ${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "failed"}`);
  });

  const prompts = page.locator(".prompts");
  const expectPrompt = async (text: string): Promise<void> => {
    await expect(prompts).toContainText(text, { timeout: 15_000 });
  };

  await startGame(page);
  expect(await act(page, "switchChamber", "two-of-us")).toBe(true);
  await waitInPage(page, 'window.__I_WAS_SO_I_AM_FP__?.renderer?.ready === true');

  // ---- 04 Two People's Worth: one hand below, one hand above.
  expect((await read(page)).chamber).toBe("two-of-us");
  await act(page, "setLook", 0, 0);
  await act(page, "press", "KeyE");
  await walkUntil(page, ["KeyW"], (state) => state.holdById["ground-grip"] === true, 15_000);
  expect((await read(page)).doorById["upper-door"]).toBe(true);
  await expect(page.locator(".subtitle")).toContainText("위층 문이 열립니다", { timeout: 10_000 });
  await heldForARealBeat(page);
  await act(page, "fold");
  await act(page, "release", "KeyE");
  await waitInPage(page, 's.phase === "replay"');
  await waitInPage(page, "s.holds.find((h) => h.id === 'ground-grip')?.heldBy.includes('past') === true", 12_000);
  await expect(page.locator(".subtitle")).toContainText("잔상이 손잡이를 잡았습니다", { timeout: 10_000 });
  await expectPrompt("계단으로 올라가세요");
  // Enter the wide middle of the stair mouth on one axis. A diagonal threshold
  // can overshoot the 3..6.5 m flight before the key-up round trip lands.
  await act(page, "setLook", Math.PI / 2, 0);
  await walkUntil(page, ["KeyW"], (state) => state.x > 4);
  await act(page, "setLook", 0, 0);
  await walkUntil(page, ["KeyW"], (state) => state.y > 3.3, 25_000);
  await expectPrompt("난간 곁의 손잡이를 잡으세요");
  await act(page, "setLook", -Math.PI / 2, 0);
  await walkUntil(page, ["KeyW"], (state) => state.x < 3.2);
  await act(page, "setLook", 0, 0);
  await act(page, "press", "KeyE");
  try {
    await walkUntil(page, ["KeyW"], (state) => state.holdById["gallery-grip"] === true, 15_000);
  } finally {
    await act(page, "release", "KeyE");
  }
  expect((await read(page)).doorById["way-out"]).toBe(true);
  await walkUntil(page, ["KeyW"], (state) => state.phase === "success", 25_000);

  // ---- 05 Long Standing: the tape is a two-stop schedule, not a sprint.
  await advanceTo(page, "long-standing");
  await act(page, "setLook", 0, 0);
  await expectPrompt("왼쪽 푸른 발판으로");
  await walkUntil(page, ["KeyW"], (state) => state.z > 5.7);
  await act(page, "setLook", -Math.PI / 2, 0);
  await walkUntil(page, ["KeyW"], (state) => state.x < -3.6);
  await expectPrompt("그대로 서 계세요");
  await page.waitForTimeout(5_000);
  await act(page, "setLook", Math.PI / 2, 0);
  await walkUntil(page, ["KeyW"], (state) => state.x > -2.5);
  await expectPrompt("오른쪽 발판으로");
  await walkUntil(page, ["KeyW"], (state) => state.x > 3.6, 25_000);
  await expectPrompt("충분하다 싶으면");
  await page.waitForTimeout(500);
  await act(page, "fold");
  await waitInPage(page, 's.phase === "replay"');
  await act(page, "setLook", 0, 0);
  await expectPrompt("열리면 바로 안으로");
  await waitInPage(page, "s.doors.find((d) => d.id === 'way-in')?.open === true", 12_000);
  await walkUntil(page, ["KeyW"], (state) => state.z > 11.5, 25_000);
  await expectPrompt("안에서 기다리세요");
  await waitInPage(page, "s.doors.find((d) => d.id === 'way-on')?.open === true", 25_000);
  await walkUntil(page, ["KeyW"], (state) => state.phase === "success", 25_000);

  // ---- 06 Giving Back: the plate belongs to the second pass.
  await advanceTo(page, "giving-back");
  await act(page, "setLook", 0, 0);
  await expectPrompt("오렌지 발판은 2회차에 밟습니다");
  await expectPrompt("닫힌 문 쪽으로 걸어 두세요");
  await walkUntil(page, ["KeyW"], (state) => state.z > 28, 35_000);
  await act(page, "press", "KeyW");
  try {
    await page.waitForTimeout(1_000);
    await act(page, "fold");
  } finally {
    await act(page, "release", "KeyW");
  }
  await waitInPage(page, 's.phase === "replay"');
  await expectPrompt("직접 밟으세요");
  const takeAmberPlate = async (): Promise<void> => {
    await act(page, "setLook", Math.PI / 2, 0);
    await walkUntil(page, ["KeyW"], (state) => state.x > 2.8, 20_000);
    await act(page, "setLook", 0, 0);
    await walkUntil(page, ["KeyW"], (state) => state.z > 3.8, 20_000);
    await waitInPage(page, "s.plates.find((p) => p.id === 'amber-plate')?.active === true", 10_000);
  };
  await takeAmberPlate();
  // The long walk ends on his light and the room ends with it: the player
  // holds the amber plate and never walks the corridor back.
  await waitInPage(page, 's.phase === "success"', 45_000);

  // ---- 07 Unkept: the final recorded frame must keep walking and holding E.
  await advanceTo(page, "unkept");
  await act(page, "setLook", 0, 0);
  await expectPrompt("E를 누른 채 닫힌 문으로 걸어가세요");
  await expectPrompt("멈추지 말고");
  await act(page, "press", "KeyE");
  await act(page, "press", "KeyW");
  try {
    await waitInPage(page, "s.actors.find((a) => a.id === 'present').z > 8.3", 25_000);
    await act(page, "fold");
  } finally {
    await act(page, "release", "KeyW");
    await act(page, "release", "KeyE");
  }
  await waitInPage(page, 's.phase === "replay"');
  await expectPrompt("직접 밟으세요");
  await takeAmberPlate();
  await waitInPage(page, "s.holds.find((h) => h.id === 'slot-grip')?.heldBy.includes('past') === true", 25_000);
  expect((await read(page)).exitOpen).toBe(true);
  // The tape's tail carries him through the door and into the light, and his
  // arrival ends the room — the player does not move at all.
  await waitInPage(page, 's.phase === "success"', 30_000);

  // ---- 08 Silence: no new tape, just accept the person already standing.
  await advanceTo(page, "silence");
  const silence = await read(page);
  expect(silence.canFold).toBe(false);
  expect(silence.plateById["old-plate"]).toBe(true);
  expect(silence.doorById["inner-door"]).toBe(false);
  await expectPrompt("빈 발판에 올라서세요");
  await expect(prompts).not.toContainText("기록 끝내기");
  await expect(prompts).not.toContainText("다시 기록");
  await act(page, "setLook", 0, 0);
  await walkUntil(page, ["KeyW", "KeyD"], (state) => state.x > 3.4, 20_000);
  // The plate contact is intentionally brief, while the door it opens latches.
  // Wait on that monotonic authored consequence so an 8 fps browser cannot
  // step across the plate between two Playwright polls and hide a real success.
  await walkUntil(page, ["KeyW"], (state) => state.doorById["inner-door"] === true, 20_000);
  expect((await read(page)).doorById["inner-door"]).toBe(true);
  await expectPrompt("빛으로 나가세요");
  await walkUntil(page, ["KeyW", "KeyA"], (state) => Math.abs(state.x) < 1, 20_000);
  await walkUntil(page, ["KeyW"], (state) => state.phase === "success", 30_000);

  expect(browserErrors).toEqual([]);
});
