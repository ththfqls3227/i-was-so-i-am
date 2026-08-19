import { expect, test } from "@playwright/test";

// The audio engine is the one system that can only be proven live: the mute
// button must move the actual master gain, not just an aria attribute.
test("the SOUND toggle flips aria-pressed and silences the engine's master gain", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "One engine is enough to prove the wiring; WebAudio support varies by headless build.");
  const noise: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    // The headless GL driver emits its own performance chatter about ReadPixels
    // stalls. It predates the audio engine and belongs to the renderer, not to
    // anything this test is about; everything else — an autoplay warning above
    // all — must be absent.
    if (message.text().includes("GL Driver Message")) return;
    noise.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => noise.push(error.message));

  await page.goto("/");
  // Autoplay policy: nothing may build an AudioContext before a gesture.
  expect(await page.evaluate(() => window.__I_WAS_SO_I_AM__.audio.started)).toBe(false);

  await page.locator("#play-button").click();
  expect(await page.evaluate(() => window.__I_WAS_SO_I_AM__.audio.started)).toBe(true);
  // The drone fades in over a couple of seconds rather than snapping on.
  await expect
    .poll(() => page.evaluate(() => window.__I_WAS_SO_I_AM__.audio.masterGain), { timeout: 6_000 })
    .toBeGreaterThan(0);

  const sound = page.locator('[data-setting="mute"]');
  await page.locator("#pause-button").click();
  await expect(sound).toHaveAttribute("aria-pressed", "false");

  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await expect(sound).toContainText("OFF");
  await expect
    .poll(() => page.evaluate(() => window.__I_WAS_SO_I_AM__.audio.masterGain), { timeout: 4_000 })
    .toBe(0);
  expect(await page.evaluate(() => window.__I_WAS_SO_I_AM__.audio.muted)).toBe(true);

  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await expect(sound).toContainText("ON");
  await expect
    .poll(() => page.evaluate(() => window.__I_WAS_SO_I_AM__.audio.masterGain), { timeout: 4_000 })
    .toBeGreaterThan(0);

  expect(noise).toEqual([]);
});

test("remembers a muted player across a reload", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Persistence rides on the same engine the toggle test covers.");
  await page.goto("/");
  await page.locator("#play-button").click();
  await page.locator("#pause-button").click();
  await page.locator('[data-setting="mute"]').click();

  await page.reload();
  const sound = page.locator('[data-setting="mute"]');
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await expect(sound).toContainText("OFF");
  await page.locator("#play-button").click();
  expect(await page.evaluate(() => window.__I_WAS_SO_I_AM__.audio.muted)).toBe(true);
  expect(await page.evaluate(() => window.__I_WAS_SO_I_AM__.audio.masterGain)).toBe(0);
});
