import { test, type Page } from "@playwright/test";
import { goldenFor } from "../src/content/golden";

const ARTIFACT = ".omx/artifacts/visual-ralph/humanoid-redesign/actual-cooperation.png";
const TUTORIAL_ARTIFACT = ".omx/artifacts/visual-ralph/humanoid-redesign/tutorial-crossing.png";

function keysForFrame(frame: number): Set<string> {
  const keys = new Set<string>();
  if (frame & 1) keys.add("ArrowUp");
  if (frame & 2) keys.add("ArrowDown");
  if (frame & 4) keys.add("ArrowLeft");
  if (frame & 8) keys.add("ArrowRight");
  if (frame & 16) keys.add("Space");
  return keys;
}

async function setHeldKeys(page: Page, held: Set<string>, next: Set<string>): Promise<void> {
  for (const key of held) if (!next.has(key)) await page.keyboard.up(key);
  for (const key of next) if (!held.has(key)) await page.keyboard.down(key);
}

test("captures the first actionable Crossing tutorial state", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "One deterministic Chromium capture is sufficient visual evidence.");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.locator("#play-button").click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: TUTORIAL_ARTIFACT, fullPage: true });
});

test("captures the approved Trace Weight cooperation state", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "One deterministic Chromium capture is the Visual Ralph artifact.");
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.locator("#play-button").click();
  await page.evaluate(() => {
    window.__I_WAS_SO_I_AM__.switchChamber("traceWeight");
    window.__I_WAS_SO_I_AM__.loadGolden("traceWeight");
  });

  const frames = goldenFor("traceWeight").present;
  const startTick = await page.evaluate(() => window.__I_WAS_SO_I_AM__.state?.tapeTick ?? 0);
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
      const targetTick = startTick + consumed;
      while (true) {
        const state = await page.evaluate(() => window.__I_WAS_SO_I_AM__.state);
        const present = state?.actors.find((actor) => actor.id === "present");
        const bothPushing = state?.forceObject?.force === state?.forceObject?.threshold;
        const exitOpen = state?.exit.open === true;
        const presentAtWeight = Boolean(present && state?.forceObject && present.x >= state.forceObject.x - 70);
        if (bothPushing && exitOpen && presentAtWeight) {
          await page.waitForTimeout(950);
          await page.screenshot({ path: ARTIFACT, fullPage: true });
          return;
        }
        if (state?.phase === "rerecord" || (state?.tapeTick ?? 0) >= targetTick) break;
        await page.waitForTimeout(10);
      }
    }
    throw new Error("Trace Weight never reached the split-role cooperation state");
  } finally {
    await setHeldKeys(page, held, new Set());
  }
});
