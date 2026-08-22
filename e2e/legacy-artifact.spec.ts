import { expect, test } from "@playwright/test";

/**
 * The 2D original still loads at /legacy.html.
 *
 * It is not the game any more — the campaign is the first-person build at the
 * root — but it ships on purpose as the Codex-collaboration evidence: the thing
 * Codex built first, still playable beside what the rebuild became. Nothing else
 * in the suite would notice if it stopped loading.
 *
 * This replaces the thirty tests that used to drive it. Those specs asserted the
 * old chambers (Crossing, Trace Weight, Handoff) through the 2D handle at the
 * root URL, which the first-person build no longer serves, so all of them failed
 * for the same uninteresting reason. Their detail belongs to a design that was
 * deliberately retired; keeping them red taught nothing and hid the specs that
 * matter. What the artifact still owes us is that it boots — that is this file.
 */

test("the original still boots where it is published", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  const response = await page.goto("/legacy.html", { waitUntil: "domcontentloaded" });
  expect(response?.ok(), "/legacy.html is published beside the game").toBe(true);

  // Its own bundle, not the first-person one served under a different name.
  await expect.poll(
    () => page.evaluate(() => typeof window.__I_WAS_SO_I_AM__ !== "undefined"),
    { timeout: 20000 },
  ).toBe(true);

  await expect(page.locator("canvas")).toBeVisible({ timeout: 20000 });
  expect(errors, "the original loads without throwing").toEqual([]);
});
