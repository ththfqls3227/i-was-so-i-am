import { expect, test, type Page } from "@playwright/test";
import { TICK_RATE, type ChamberId, type SimulationState } from "../src/core/types";
import { CHAMBERS } from "../src/content/chambers";
import { CHAMBER_ROUTE } from "../src/content/manifests";

const heldBits = { up: 1, down: 2, left: 4, right: 8, action: 16 } as const;
const TICK_MS = 1000 / TICK_RATE;
const ROUTE_LENGTH = String(CHAMBER_ROUTE.length).padStart(2, "0");

/** The HUD counter for a route position, e.g. "03 / 07". */
function roomOrdinal(index: number): string {
  return `${String(index + 1).padStart(2, "0")} / ${ROUTE_LENGTH}`;
}

function keysForFrame(frame: number): Set<string> {
  const keys = new Set<string>();
  if (frame & heldBits.up) keys.add("ArrowUp");
  if (frame & heldBits.down) keys.add("ArrowDown");
  if (frame & heldBits.left) keys.add("ArrowLeft");
  if (frame & heldBits.right) keys.add("ArrowRight");
  if (frame & heldBits.action) keys.add("Space");
  return keys;
}

async function setHeldKeys(page: Page, held: Set<string>, next: Set<string>): Promise<void> {
  for (const key of held) if (!next.has(key)) await page.keyboard.up(key);
  for (const key of next) if (!held.has(key)) await page.keyboard.down(key);
}

interface TapeProbe {
  tapeTick: number;
  phase: SimulationState["phase"] | undefined;
  success: boolean;
  lastError: SimulationState["lastError"] | undefined;
}

function readTape(page: Page): Promise<TapeProbe> {
  return page.evaluate(() => {
    const state = window.__I_WAS_SO_I_AM__.state;
    return {
      tapeTick: state?.tapeTick ?? 0,
      phase: state?.phase,
      success: state?.success === true,
      lastError: state?.lastError,
    };
  });
}

/**
 * Lets the presentation catch up with the simulation. Nothing in the page moves
 * unless this test advances the clock, so a card, a HUD field or a storage write
 * that lands on the frame after a beat needs a few ticks of room to appear.
 */
function settle(page: Page): Promise<void> {
  return page.clock.runFor(Math.round(6 * TICK_MS));
}

/**
 * Plays an authored tape through the real keyboard on a clock this test owns.
 *
 * Under wall-clock time the run lengths were only a request. The browser steps
 * the fixed 30 Hz loop up to four times inside one animation frame — the 8 Hz
 * render throttle headless runs use makes a double step ordinary — so a run
 * could take a tick or two more than it was authored for. Nothing in the test
 * could give those ticks back: a 46-tick walk that ran 48 left the present self
 * two ticks past the junction it had to stand on, and Handoff, whose two selves
 * meet in a four-tick window, failed about one run in six that way.
 *
 * So the clock is faked and advanced by exactly the milliseconds a run is worth.
 * Every rAF then sees a 16 ms delta, the loop steps at most once per frame, and
 * a run gets the ticks it asked for and no others. The tick budget is fractional
 * — 30 Hz does not divide a millisecond — so a run that lands a tick short is
 * topped up rather than allowed to drift, and one that would run long fails the
 * test rather than silently distorting the tape.
 *
 * Playback ends on a phase change: the recording closes itself at the chamber's
 * tape length, and both tick counters restart at that boundary.
 */
async function playAuthoredFrames(page: Page, frames: number[]): Promise<void> {
  const startPhase = (await readTape(page)).phase;
  let held = new Set<string>();
  let consumed = 0;
  try {
    while (consumed < frames.length) {
      const mask = (frames[consumed] ?? 0) & 31;
      let runEnd = consumed + 1;
      while (runEnd < frames.length && ((frames[runEnd] ?? 0) & 31) === mask) runEnd += 1;
      const authored = runEnd - consumed;
      const next = keysForFrame(mask);

      await setHeldKeys(page, held, next);
      held = next;
      const before = await readTape(page);
      if (before.phase !== startPhase || before.success) return;

      // Time is spent in two parts so the run can never be handed a tick it was
      // not authored for: one jump that is a whole tick short of the run however
      // the fractional budget rounds, then half-tick steps, each of which can
      // carry the loop at most one tick further, until the count is exact.
      const wanted = before.tapeTick + authored;
      if (authored > 1) await page.clock.runFor(Math.floor((authored - 1) * TICK_MS));
      let settled = await readTape(page);
      for (let step = 0; settled.tapeTick < wanted && settled.phase === startPhase && !settled.success; step += 1) {
        expect(step, `the simulation stopped stepping at tick ${settled.tapeTick} of the run at frame ${consumed}`).toBeLessThan(8 * authored + 16);
        await page.clock.runFor(Math.floor(TICK_MS / 6));
        settled = await readTape(page);
      }
      if (settled.phase === startPhase && !settled.success) {
        expect(settled.tapeTick, `the run at frame ${consumed} was held for ${settled.tapeTick - before.tapeTick} ticks, not ${authored}`).toBe(wanted);
      }
      consumed = runEnd;
      if (settled.phase !== startPhase || settled.success) return;
    }
  } finally {
    await setHeldKeys(page, held, new Set());
  }
}

test("exposes an accessible title, start action, game surface, and controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "I WAS, SO I AM" })).toBeVisible();
  await expect(page.getByRole("button", { name: "기억 속으로 들어가기" })).toBeVisible();
  await expect(page.getByLabel("I WAS, SO I AM 게임 화면")).toBeVisible();
  await expect(page.locator("#pause-button")).toBeHidden();
  await expect(page.locator('nav[aria-label="터치 게임 조작"]')).toBeAttached();
  await expect(page.locator("#intro-controls")).toContainText("Space / E");
  await expect(page.locator("#intro-controls")).toContainText("시간 접기");
  await page.getByRole("button", { name: "기억 속으로 들어가기" }).click();
  await expect(page.getByRole("button", { name: "일시정지" })).toBeVisible();
  await expect(page.locator("#fold-prompt")).toBeVisible();
  await expect(page.locator("#fold-prompt")).toBeDisabled();
});

test("exposes operable pause settings in both supported locales", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "기억 속으로 들어가기" }).click();
  await page.getByRole("button", { name: "일시정지" }).click();
  await expect(page.locator("#pause-screen")).toBeVisible();
  const contrast = page.locator('[data-setting="contrast"]');
  await contrast.click();
  await expect(contrast).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("body")).toHaveClass(/high-contrast/);
  await page.locator('[data-setting="locale"]').click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
});

test("exposes labeled touch controls on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "기억 속으로 들어가기" }).click();
  const touchControls = page.locator('nav[aria-label="터치 게임 조작"]');
  await expect(touchControls).toBeVisible();
  for (const label of ["위", "왼쪽", "아래", "오른쪽"]) {
    await expect(touchControls.getByRole("button", { name: label })).toBeVisible();
  }
  await expect(touchControls.getByRole("button", { name: "행동 버튼, 길게 누르기" })).toContainText("길게");
});

test("touch hold moves, release stops, and touch rerecord resets safely", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "기억 속으로 들어가기" }).click();
  const right = page.locator('[data-control="right"]');
  const box = await right.boundingBox();
  if (!box) throw new Error("Right touch control has no hit target");
  const startX = await page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.actors[0]?.x ?? 0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForFunction((x) => (window.__I_WAS_SO_I_AM__.state?.actors[0]?.x ?? 0) > x, startX, { polling: 10 });
  await page.mouse.up();
  const released = await page.evaluate(() => ({
    x: window.__I_WAS_SO_I_AM__.state?.actors[0]?.x,
    tick: window.__I_WAS_SO_I_AM__.state?.tick,
  }));
  await page.waitForTimeout(140);
  expect(await page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.actors[0]?.x)).toBe(released.x);
  expect(await page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.tick)).toBeGreaterThan(released.tick ?? 0);
  await page.locator("#touch-rerecord").click();
  await expect.poll(() => page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.tick)).toBe(0);
  expect(await page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.actors)).toHaveLength(1);
});

test("pause clears held input, freezes state, and resumes movement", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "기억 속으로 들어가기" }).click();
  await page.keyboard.down("ArrowRight");
  await page.waitForFunction(() => (window.__I_WAS_SO_I_AM__.state?.tick ?? 0) >= 3, null, { polling: 10 });
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause-button")).toHaveAttribute("aria-expanded", "true");
  const frozen = await page.evaluate(() => ({
    tick: window.__I_WAS_SO_I_AM__.state?.tick,
    checksum: window.__I_WAS_SO_I_AM__.checksum,
    x: window.__I_WAS_SO_I_AM__.state?.actors[0]?.x,
  }));
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => ({
    tick: window.__I_WAS_SO_I_AM__.state?.tick,
    checksum: window.__I_WAS_SO_I_AM__.checksum,
    x: window.__I_WAS_SO_I_AM__.state?.actors[0]?.x,
  }))).toEqual(frozen);
  await page.keyboard.up("ArrowRight");
  await page.locator("#resume-button").click();
  await expect(page.locator("#pause-button")).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.down("ArrowRight");
  await page.waitForFunction((x) => (window.__I_WAS_SO_I_AM__.state?.actors[0]?.x ?? 0) > x, frozen.x ?? 0, { polling: 10 });
  await page.keyboard.up("ArrowRight");
});

test("keeps gameplay HUD hidden on the title and resumes failure-safe local progress", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".mission")).toBeHidden();
  await expect(page.locator('nav[aria-label="터치 게임 조작"]')).toBeHidden();

  await page.evaluate(() => localStorage.setItem("i-was-so-i-am:progress:v1", "{corrupt"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await page.getByRole("button", { name: "기억 속으로 들어가기" }).click();
  await expect(page.locator("#chamber-title")).toHaveText("깨어남");

  await page.evaluate(() => localStorage.setItem("i-was-so-i-am:progress:v1", JSON.stringify({ nextRoom: "handoff", locale: "en" })));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Enter the memory" }).click();
  await expect(page.locator("#chamber-title")).toHaveText("Handoff");
  await expect(page.locator("#room-ordinal")).toHaveText(roomOrdinal(CHAMBER_ROUTE.indexOf("handoff")));
});

test("presents every authored room in manifest order with a passing golden path", async ({ page, browserName }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Boolean(window.__I_WAS_SO_I_AM__.state))).toBe(true);
  for (const [index, chamberId] of CHAMBER_ROUTE.entries()) {
    const result = await page.evaluate(({ id }) => {
      window.__I_WAS_SO_I_AM__.switchChamber(id);
      return window.__I_WAS_SO_I_AM__.runGolden(id, 60).success;
    }, { id: chamberId });
    expect(result, `${browserName} ${chamberId} golden`).toBe(true);
    await expect(page.locator("#chamber-title")).toHaveAttribute("data-chamber-id", chamberId);
    await expect(page.locator("#room-ordinal")).toHaveText(roomOrdinal(index));
  }
});

test("records and replays every authored room through public controls into the authored ending", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "A full physical keyboard journey runs once; cross-engine core/UI routes are covered separately.");
  test.setTimeout(240_000);
  // The keys are real and so is everything they drive; only time is this test's
  // to give, so a slow frame can no longer hand a beat more ticks than it was
  // written for. Whether the game keeps up in real time is the performance
  // smoke's question, not this one's.
  await page.clock.install();
  await page.goto("/");
  // Boot on borrowed time, then stop the clock: installing alone leaves it
  // running against the wall, and the ticks that slip through between two
  // advances are exactly the ones this test exists to control.
  await page.clock.pauseAt(Date.now() + 2_000);
  await page.getByRole("button", { name: "기억 속으로 들어가기" }).click();
  await settle(page);
  const golden = await import("../src/content/golden");
  for (const [index, chamberId] of CHAMBER_ROUTE.entries()) {
    await expect(page.locator("#chamber-title")).toHaveAttribute("data-chamber-id", chamberId);
    await expect(page.locator("#room-ordinal")).toHaveText(roomOrdinal(index));
    const solution = golden.goldenFor(chamberId);
    expect(await readTape(page), `${chamberId} did not open in recording`).toMatchObject({ phase: "recording" });
    await playAuthoredFrames(page, solution.past.frames);
    expect(await readTape(page), `${chamberId} did not fold into replay`).toMatchObject({ phase: "replay" });
    await playAuthoredFrames(page, solution.present);
    // A room that does not finish is reported with the core's own account of
    // why, read at the moment playback ended: "the card never appeared" alone
    // cannot tell a mistimed key from a tape that never opened the door.
    const outcome = await readTape(page);
    await settle(page);
    await expect(page.locator("#success-card"), `${chamberId} ended ${JSON.stringify(outcome)}`).toBeVisible();
    await expect(page.locator("#success-title")).toHaveText(CHAMBERS[chamberId].name);
    // The clear is banked on the success card, not on the button after it.
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("i-was-so-i-am:progress:v1") ?? "null")?.cleared))
      .toContain(chamberId);
    await page.locator("#next").click();
    await settle(page);
    const next = CHAMBER_ROUTE[index + 1];
    if (next) {
      await expect(page.locator("#chamber-title")).toHaveAttribute("data-chamber-id", next);
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("i-was-so-i-am:progress:v1") ?? "null")?.nextRoom)).toBe(next);
    }
  }
  await expect(page.locator("#ending-screen")).toBeVisible();
  await expect(page.getByRole("heading", { name: "과거는 문을 붙들고 남았다." })).toBeVisible();
  await expect(page.locator("#ending-copy")).toContainText("지금 여기에 있다");
  await page.locator("#title-button").click();
  expect(await page.evaluate(() => localStorage.getItem("i-was-so-i-am:progress:v1"))).toBeNull();
});

test("keeps the primary journey free of console and page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`));
  await page.goto("/");
  await page.locator("#play-button").click();
  for (const chamberId of CHAMBER_ROUTE) {
    await page.evaluate((id: ChamberId) => window.__I_WAS_SO_I_AM__.switchChamber(id), chamberId);
    await expect(page.locator("#chamber-title")).toHaveAttribute("data-chamber-id", chamberId);
    const success = await page.evaluate((id: ChamberId) => window.__I_WAS_SO_I_AM__.runGolden(id, 144).success, chamberId);
    expect(success).toBe(true);
  }
  await page.locator("#pause-button").click();
  await page.locator("#resume-button").click();
  expect(errors).toEqual([]);
});

test("unlocks the chamber select up to the next room and enters the one that is clicked", async ({ page }) => {
  const cleared = [CHAMBER_ROUTE[0], CHAMBER_ROUTE[1]];
  const next = CHAMBER_ROUTE[2];
  const locked = CHAMBER_ROUTE[3];
  await page.goto("/");
  await page.evaluate((progress) => localStorage.setItem("i-was-so-i-am:progress:v1", JSON.stringify(progress)), {
    nextRoom: next,
    locale: "ko",
    cleared,
  });
  await page.reload();

  const select = page.locator("#chamber-select");
  await expect(select).toBeVisible();
  for (const id of cleared) {
    await expect(select.locator(`button[data-chamber="${id}"]`)).toBeEnabled();
  }
  await expect(select.locator(`button[data-chamber="${next}"]`)).toHaveAttribute("data-state", "next");
  await expect(select.locator(`button[data-chamber="${locked}"]`)).toBeDisabled();

  await select.locator(`button[data-chamber="${next}"]`).click();
  await expect(page.locator("#intro-screen")).toBeHidden();
  await expect(page.locator("#chamber-title")).toHaveAttribute("data-chamber-id", next);
  await expect(page.locator("#room-ordinal")).toHaveText(roomOrdinal(2));
});

test("keeps an older progress record loadable and re-derives what it cleared", async ({ page }) => {
  // Records written before the cleared list existed carry only the next room.
  const next = CHAMBER_ROUTE[3];
  await page.goto("/");
  await page.evaluate((nextRoom) => localStorage.setItem("i-was-so-i-am:progress:v1", JSON.stringify({ nextRoom, locale: "ko" })), next);
  await page.reload();
  const select = page.locator("#chamber-select");
  await expect(select.locator(`button[data-chamber="${CHAMBER_ROUTE[0]}"]`)).toHaveAttribute("data-state", "cleared");
  await expect(select.locator(`button[data-chamber="${next}"]`)).toHaveAttribute("data-state", "next");
  await expect(select.locator(`button[data-chamber="${CHAMBER_ROUTE[4]}"]`)).toBeDisabled();
  await expect(page.locator("#chamber-title")).toHaveAttribute("data-chamber-id", next);
});
