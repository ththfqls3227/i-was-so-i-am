import { expect, test } from "@playwright/test";
import { Simulation } from "../src/core/simulation";
import type { ChamberId } from "../src/core/types";
import { CHAMBERS } from "../src/content/chambers";
import { buildReplayCorpus } from "../src/content/corpus";
import { FOUR_ROOM_ROUTE } from "../src/content/manifests";

function nodeChecksums(chamberId: ChamberId, tape: ReturnType<typeof buildReplayCorpus>[number]["tape"], presentFrames: number[]): string[] {
  const simulation = new Simulation(CHAMBERS[chamberId]);
  const error = simulation.loadTape(tape);
  if (error) throw new Error(error);
  const checksums = [simulation.checksum()];
  for (const frame of presentFrames) {
    if (simulation.state.phase !== "replay") break;
    simulation.step(frame);
    checksums.push(simulation.checksum());
  }
  return checksums;
}

test("loads without login and exposes the playable production journey", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "I WAS, SO I AM" })).toBeVisible();
  await expect(page.locator("#game canvas#memory-canvas")).toBeVisible();
  await expect(page.locator("#game canvas#memory-canvas")).toHaveAttribute("aria-label", "I WAS, SO I AM 3D 게임 화면");
  await expect.poll(() => page.evaluate(() => window.__I_WAS_SO_I_AM__.renderer)).toEqual({
    name: "babylon",
    ready: true,
    context: expect.stringMatching(/^webgl[12]$/),
  });
  await expect(page.getByText(/과거의 나와 함께/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.phase)).toBe("recording");
});

test("pure core golden checksums are cadence-invariant in the browser adapter", async ({ page, browserName }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Boolean(window.__I_WAS_SO_I_AM__.state))).toBe(true);
  const result = await page.evaluate((route) => {
    const cadences = [30, 60, 144];
    return route.map((id) => {
      const runs = cadences.map((cadence) => window.__I_WAS_SO_I_AM__.runGolden(id, cadence));
      return {
        id,
        successes: runs.map((run) => run.success),
        parity: runs.every((run) => JSON.stringify(run.checksums) === JSON.stringify(runs[0]?.checksums)),
        finalChecksum: runs[0]?.checksums.at(-1),
      };
    });
  }, FOUR_ROOM_ROUTE);
  expect(result, `${browserName} browser core parity`).toEqual(FOUR_ROOM_ROUTE.map((id) =>
    expect.objectContaining({ id, successes: [true, true, true], parity: true }),
  ));
});

test("all 100 replay tapes match pure Node at every tick", async ({ page, browserName }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Boolean(window.__I_WAS_SO_I_AM__.state))).toBe(true);
  const corpus = buildReplayCorpus();
  const expected = corpus.map((entry) => nodeChecksums(entry.chamberId, entry.tape, entry.presentFrames));
  const actual = await page.evaluate((entries) => entries.map((entry) =>
    window.__I_WAS_SO_I_AM__.runTape(entry.chamberId, entry.tape, entry.presentFrames).checksums,
  ), corpus);
  expect(actual, `${browserName} full replay corpus`).toEqual(expected);
});

test("Rerecord recovers immediately without a reload", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Boolean(window.__I_WAS_SO_I_AM__.state))).toBe(true);
  await page.evaluate(() => window.__I_WAS_SO_I_AM__.switchChamber("traceWeight"));
  await page.evaluate(() => window.__I_WAS_SO_I_AM__.rerecord());
  const state = await page.evaluate(() => window.__I_WAS_SO_I_AM__.state);
  expect(state?.phase).toBe("recording");
  expect(state?.tick).toBe(0);
  expect(state?.actors).toHaveLength(1);
});

test("keyboard input completes the live Crossing record-reset-cooperate loop", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "One live input smoke is sufficient; parity is covered in every engine above.");
  test.setTimeout(25_000);
  await page.goto("/");
  await page.evaluate(() => window.__I_WAS_SO_I_AM__.switchChamber("crossing"));
  await expect.poll(() => page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.phase)).toBe("recording");
  await page.keyboard.down("ArrowRight");
  await page.waitForFunction(
    () => (window.__I_WAS_SO_I_AM__.state?.actors[0]?.x ?? 0) >= 240,
    null,
    { polling: 10, timeout: 3_000 },
  );
  await page.keyboard.up("ArrowRight");
  await page.keyboard.down("Space");
  await expect.poll(() => page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.hold?.active)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.phase), { timeout: 9_000 }).toBe("replay");
  await page.keyboard.up("Space");
  await page.keyboard.down("ArrowRight");
  await expect.poll(() => page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.phase), { timeout: 11_000 }).toBe("success");
  await page.keyboard.up("ArrowRight");
  await expect(page.locator("#success-card")).toBeVisible();
  await expect(page.locator("#success-title")).toHaveText("CROSSING");
});
