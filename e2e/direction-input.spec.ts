import { expect, test, type Page } from "@playwright/test";

interface ScreenPoint {
  x: number;
  y: number;
}

async function actorScreenPosition(page: Page): Promise<ScreenPoint> {
  const actorId = await page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.actors[0]?.id);
  if (!actorId) throw new Error("The simulation does not have a controlled actor");
  const point = await page.evaluate((id) => window.__I_WAS_SO_I_AM__.actorScreenPosition(id), actorId);
  if (!point) throw new Error("The controlled actor does not have a rendered screen position");
  return point;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "기억 속으로 들어가기" }).click();
  await expect.poll(() => page.evaluate(() => window.__I_WAS_SO_I_AM__.renderer.ready)).toBe(true);
});

test("ArrowRight moves the controlled actor right on screen", async ({ page }) => {
  const start = await actorScreenPosition(page);
  const startWorldX = await page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.actors[0]?.x ?? 0);

  await page.keyboard.down("ArrowRight");
  await page.waitForFunction(
    (x) => (window.__I_WAS_SO_I_AM__.state?.actors[0]?.x ?? 0) >= x + 48,
    startWorldX,
    { polling: 10 },
  );
  await page.keyboard.up("ArrowRight");

  await expect.poll(async () => (await actorScreenPosition(page)).x).toBeGreaterThan(start.x + 5);
});

test("ArrowDown moves the controlled actor down on screen", async ({ page }) => {
  const start = await actorScreenPosition(page);
  const startWorldY = await page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.actors[0]?.y ?? 0);

  await page.keyboard.down("ArrowDown");
  await page.waitForFunction(
    (y) => (window.__I_WAS_SO_I_AM__.state?.actors[0]?.y ?? 0) >= y + 48,
    startWorldY,
    { polling: 10 },
  );
  await page.keyboard.up("ArrowDown");

  await expect.poll(async () => (await actorScreenPosition(page)).y).toBeGreaterThan(start.y + 5);
});
