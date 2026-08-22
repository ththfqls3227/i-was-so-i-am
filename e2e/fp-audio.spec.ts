import { expect, test } from "@playwright/test";
import { startGame } from "./support/fp";

/**
 * Audio is the one system that can only be proven live.
 *
 * The old suite made this point about the 2D build and it still holds: muting
 * has to move the actual master gain, not just flip a mark on the HUD. A mute
 * that only changes an attribute is a mute that ships with the sound still on.
 */

test("M silences the engine itself, and says so on screen", async ({ page }) => {
  test.setTimeout(180_000);
  await startGame(page);

  const audio = () => page.evaluate(() => {
    const fp = window.__I_WAS_SO_I_AM_FP__;
    if (!fp) throw new Error("The page has no test handle");
    return fp.audio;
  });
  await expect.poll(async () => (await audio()).started, { timeout: 10000 }).toBe(true);

  const loud = await audio();
  expect(loud.muted).toBe(false);
  expect(loud.masterGain).toBeGreaterThan(0);
  await expect(page.locator(".muted-mark")).toBeHidden();

  await page.keyboard.press("KeyM");
  await expect.poll(async () => (await audio()).masterGain, { timeout: 6000 }).toBe(0);
  expect((await audio()).muted).toBe(true);
  await expect(page.locator(".muted-mark")).toBeVisible();

  await page.keyboard.press("KeyM");
  await expect.poll(async () => (await audio()).masterGain, { timeout: 6000 }).toBeGreaterThan(0);
  await expect(page.locator(".muted-mark")).toBeHidden();
});

test("a muted player is still muted after a reload", async ({ page }) => {
  test.setTimeout(180_000);
  await startGame(page);
  await page.keyboard.press("KeyM");
  await expect
    .poll(() => page.evaluate(() => window.__I_WAS_SO_I_AM_FP__?.audio.muted), { timeout: 6000 })
    .toBe(true);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__I_WAS_SO_I_AM_FP__?.renderer?.ready === true, null, { timeout: 60000 });
  expect(await page.evaluate(() => window.__I_WAS_SO_I_AM_FP__?.audio.muted)).toBe(true);
  await expect(page.locator(".muted-mark")).toBeVisible();
});
