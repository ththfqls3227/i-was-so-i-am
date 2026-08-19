import { expect, test } from "@playwright/test";
import { CHAMBERS } from "../src/content/chambers";

// Derived from chamber data, not hand-tuned coordinates: spawn and winch share
// the same y, so walking right enters the winch's acquire radius at this x.
const crossingWinch = CHAMBERS.crossing.hold;
if (!crossingWinch) throw new Error("Crossing chamber must define a winch hold");
const nearWinchX = crossingWinch.x - crossingWinch.radius;

test("teaches the two-pass rule before play and advances only after real achievements", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#intro-copy")).toContainText("같은 방을 두 번 플레이");
  await expect(page.locator("#first-pass-title")).toHaveText("1회차 · 행동 기록");
  await expect(page.locator("#second-pass-title")).toHaveText("2회차 · 과거와 협동");

  await page.getByRole("button", { name: "기억 속으로 들어가기" }).click();
  const card = page.locator("#tutorial-card");
  await expect(card).toHaveAttribute("data-stage", "crossing-move-winch");
  await expect(page.locator("#tutorial-title")).toContainText("황금 표식의 윈치");
  await expect(page.locator("#tutorial-copy")).toBeVisible();
  await expect(page.locator("#fold-prompt")).toBeVisible();
  await expect(page.locator("#fold-prompt")).toBeDisabled();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.tapeTick)).toBe(0);

  await page.keyboard.down("ArrowRight");
  await page.waitForFunction(
    (x) => (window.__I_WAS_SO_I_AM__.state?.actors[0]?.x ?? 0) >= x,
    nearWinchX,
    { polling: 10, timeout: 4_000 },
  );
  await page.keyboard.up("ArrowRight");
  await expect(card).toHaveAttribute("data-stage", "crossing-grab-winch");
  await expect(page.locator("#tutorial-title")).toContainText("Space를 누르고 있으세요");
  await expect(page.locator("#tutorial-action-label")).toHaveText("누르고 있기");

  await page.keyboard.down("Space");
  await expect.poll(() => page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.hold?.active)).toBe(true);
  await expect(card).toHaveAttribute("data-stage", "crossing-fold");
  await expect(page.locator("#tutorial-title")).toContainText("시간을 접으세요");
  await expect(page.locator("#fold-prompt")).toBeEnabled();
  await page.keyboard.up("Space");
  await expect(card).toHaveAttribute("data-stage", "crossing-grab-winch");
});

test("a novice finishes Crossing with the fold key by following the on-screen instructions", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "The physical fold journey runs once; semantic stages run in every engine.");
  test.setTimeout(30_000);
  await page.goto("/");
  await page.getByRole("button", { name: "기억 속으로 들어가기" }).click();

  await page.keyboard.down("ArrowRight");
  await page.waitForFunction(
    (x) => (window.__I_WAS_SO_I_AM__.state?.actors[0]?.x ?? 0) >= x,
    nearWinchX,
    { polling: 10, timeout: 4_000 },
  );
  await page.keyboard.up("ArrowRight");
  await expect(page.locator("#tutorial-card")).toHaveAttribute("data-stage", "crossing-grab-winch");

  await page.keyboard.down("Space");
  await expect(page.locator("#tutorial-card")).toHaveAttribute("data-stage", "crossing-fold");
  await expect(page.locator("#fold-prompt")).toBeEnabled();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.phase), { timeout: 2_000 }).toBe("replay");
  expect(await page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.foldedAtTick)).not.toBeNull();
  await expect(page.locator("#pass-banner")).toBeVisible();
  await page.keyboard.up("Space");
  await expect(page.locator("#tutorial-pass")).toContainText("2회차");

  await page.keyboard.down("ArrowRight");
  await expect.poll(() => page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.success), { timeout: 11_000 }).toBe(true);
  await page.keyboard.up("ArrowRight");
  await expect(page.locator("#success-card")).toBeVisible();
  await expect(page.locator("#tutorial-title")).toContainText("과거의 나와 함께");
});

test("keeps the complete tutorial instruction readable beside mobile controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "기억 속으로 들어가기" }).click();

  const tutorial = page.locator("#tutorial-card");
  const copy = page.locator("#tutorial-copy");
  const controls = page.locator('nav[aria-label="터치 게임 조작"]');
  const action = controls.getByRole("button", { name: "행동 버튼, 길게 누르기" });
  const fold = controls.getByRole("button", { name: "시간 접기" });
  await expect(tutorial).toBeVisible();
  await expect(copy).toBeVisible();
  await expect(copy).toContainText("미래의 나를 도울 행동");
  await expect(action).toBeVisible();
  await expect(fold).toBeVisible();
  await expect(fold).toBeDisabled();

  const tutorialBox = await tutorial.boundingBox();
  const controlsBox = await controls.boundingBox();
  if (!tutorialBox || !controlsBox) throw new Error("Tutorial or mobile controls have no layout box");
  expect(tutorialBox.y + tutorialBox.height).toBeLessThanOrEqual(controlsBox.y + 1);
});
