import { expect, test, type Page } from "@playwright/test";
import type { ChamberId } from "../src/core/types";
import { CHAMBERS } from "../src/content/chambers";
import { FOUR_ROOM_ROUTE } from "../src/content/manifests";

const heldBits = { up: 1, down: 2, left: 4, right: 8, action: 16 } as const;

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

async function playAuthoredFrames(page: Page, frames: number[]): Promise<void> {
  const startTick = await page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.tapeTick ?? 0);
  const startPhase = await page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.phase);
  let held = new Set<string>();
  let consumed = 0;
  try {
    while (consumed < frames.length) {
      const mask = (frames[consumed] ?? 0) & 31;
      let runEnd = consumed + 1;
      while (runEnd < frames.length && ((frames[runEnd] ?? 0) & 31) === mask) runEnd += 1;
      const next = keysForFrame(mask);
      await setHeldKeys(page, held, next);
      held = next;
      consumed = runEnd;
      await page.waitForFunction(
        ({ target, startPhase }) => {
          const state = window.__I_WAS_SO_I_AM__.state;
          return state?.success || state?.phase === "rerecord" || state?.phase !== startPhase || (state?.tapeTick ?? 0) >= target;
        },
        { target: startTick + consumed, startPhase },
        { polling: 10, timeout: 15_000 },
      );
      if (await page.locator("#success-card").isVisible()) return;
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
  await expect(page.locator("#chamber-title")).toHaveText("건너는 기억");

  await page.evaluate(() => localStorage.setItem("i-was-so-i-am:progress:v1", JSON.stringify({ nextRoom: "handoff", locale: "en" })));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Enter the memory" }).click();
  await expect(page.locator("#chamber-title")).toHaveText("Handoff");
  await expect(page.locator("#room-ordinal")).toHaveText("03 / 04");
});

test("presents every authored room in manifest order with a passing golden path", async ({ page, browserName }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Boolean(window.__I_WAS_SO_I_AM__.state))).toBe(true);
  for (const [index, chamberId] of FOUR_ROOM_ROUTE.entries()) {
    const result = await page.evaluate(({ id }) => {
      window.__I_WAS_SO_I_AM__.switchChamber(id);
      return window.__I_WAS_SO_I_AM__.runGolden(id, 60).success;
    }, { id: chamberId });
    expect(result, `${browserName} ${chamberId} golden`).toBe(true);
    await expect(page.locator("#chamber-title")).toHaveAttribute("data-chamber-id", chamberId);
    await expect(page.locator("#room-ordinal")).toHaveText(`${String(index + 1).padStart(2, "0")} / 04`);
  }
});

test("records and replays all four rooms through public controls into the authored ending", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "A full physical keyboard journey runs once; cross-engine core/UI routes are covered separately.");
  test.setTimeout(150_000);
  await page.goto("/");
  await page.getByRole("button", { name: "기억 속으로 들어가기" }).click();
  const golden = await import("../src/content/golden");
  for (const [index, chamberId] of FOUR_ROOM_ROUTE.entries()) {
    await expect(page.locator("#chamber-title")).toHaveAttribute("data-chamber-id", chamberId);
    await expect(page.locator("#room-ordinal")).toHaveText(`${String(index + 1).padStart(2, "0")} / 04`);
    const solution = golden.goldenFor(chamberId);
    await expect.poll(() => page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.phase)).toBe("recording");
    await playAuthoredFrames(page, solution.past.frames);
    await expect.poll(() => page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.phase)).toBe("replay");
    await playAuthoredFrames(page, solution.present);
    await expect(page.locator("#success-card")).toBeVisible();
    await expect(page.locator("#success-title")).toHaveText(CHAMBERS[chamberId].name);
    await page.locator("#next").click();
    const next = FOUR_ROOM_ROUTE[index + 1];
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
  for (const chamberId of FOUR_ROOM_ROUTE) {
    await page.evaluate((id: ChamberId) => window.__I_WAS_SO_I_AM__.switchChamber(id), chamberId);
    await expect(page.locator("#chamber-title")).toHaveAttribute("data-chamber-id", chamberId);
    const success = await page.evaluate((id: ChamberId) => window.__I_WAS_SO_I_AM__.runGolden(id, 144).success, chamberId);
    expect(success).toBe(true);
  }
  await page.locator("#pause-button").click();
  await page.locator("#resume-button").click();
  expect(errors).toEqual([]);
});
