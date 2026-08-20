// Art-direction captures: plays each room's golden tape to a representative
// beat and writes unthrottled 1440x900 PNGs for visual review.
// Usage: node scripts/room-captures.mjs [outputDirectory]
// Output defaults to captures/, which is untracked and — unlike test-results/ —
// is not wiped by `playwright test` at the start of every run.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const gameUrl = process.env.GAME_URL ?? "http://127.0.0.1:4173/";
const outputDirectory = process.argv[2] ?? "captures";
const viewport = { width: 1440, height: 900 };

// The scene halves its render rate when it detects automation; captures must
// show what a player sees, so the flag is cleared before the app boots.
const disableAutomationThrottle = () => {
  Object.defineProperty(globalThis.navigator, "webdriver", { configurable: true, get: () => false });
};

const keysForFrame = (frame) => {
  const keys = new Set();
  if (frame & 1) keys.add("ArrowUp");
  if (frame & 2) keys.add("ArrowDown");
  if (frame & 4) keys.add("ArrowLeft");
  if (frame & 8) keys.add("ArrowRight");
  if (frame & 16) keys.add("Space");
  return keys;
};

// Beat predicates run in-page, once per animation frame. Polling them over the
// wire missed narrow windows — Trace Weight's "both pushing while the exit is
// open" can open and close between two round trips.
const beats = {
  crossing: "state.exit.open === true && (state.actors.find(a => a.id === 'present')?.x ?? 0) > (state.door?.rect.x ?? 0) + 40",
  traceWeight: "state.forceObject?.force === state.forceObject?.threshold && state.exit.open === true",
  handoff: "state.handoff?.carriedByPresent === true || state.handoff?.delivered === true",
  lastHold: "state.exit.open === true && (state.actors.find(a => a.id === 'present')?.x ?? 0) >= state.exit.x - 220",
  awakening: "state.door?.open === true",
  secondSelf: "state.door?.open === true",
  handNotBody: "state.exit.open === true",
};

const installBeatWatcher = async (page, expression) => {
  await page.evaluate((source) => {
    const predicate = new Function("state", `return Boolean(${source});`);
    globalThis.__BEAT_HIT__ = false;
    const tick = () => {
      const state = globalThis.__I_WAS_SO_I_AM__?.state;
      if (state && !globalThis.__BEAT_HIT__ && predicate(state)) globalThis.__BEAT_HIT__ = true;
      globalThis.requestAnimationFrame(tick);
    };
    globalThis.requestAnimationFrame(tick);
  }, expression);
};

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport });
await page.addInitScript(disableAutomationThrottle);

const setHeldKeys = async (held, next) => {
  for (const key of held) if (!next.has(key)) await page.keyboard.up(key);
  for (const key of next) if (!held.has(key)) await page.keyboard.down(key);
};

try {
  await page.goto(gameUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => globalThis.__I_WAS_SO_I_AM__?.renderer?.ready === true);

  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${outputDirectory}/title.png` });
  console.log(`${outputDirectory}/title.png`);

  await page.locator("#play-button").click();

  for (const room of Object.keys(beats)) {
    const frames = await page.evaluate(async (id) => {
      const module = await import("/src/content/golden.ts");
      globalThis.__I_WAS_SO_I_AM__.switchChamber(id);
      globalThis.__I_WAS_SO_I_AM__.loadGolden(id);
      return module.goldenFor(id).present;
    }, room);

    await installBeatWatcher(page, beats[room] ?? "false");
    let held = new Set();
    let consumed = 0;
    let captured = false;
    const startTick = await page.evaluate(() => globalThis.__I_WAS_SO_I_AM__.state?.tapeTick ?? 0);
    while (consumed < frames.length && !captured) {
      const mask = (frames[consumed] ?? 0) & 31;
      let runEnd = consumed + 1;
      while (runEnd < frames.length && ((frames[runEnd] ?? 0) & 31) === mask) runEnd += 1;
      const next = keysForFrame(mask);
      await setHeldKeys(held, next);
      held = next;
      consumed = runEnd;
      const targetTick = startTick + consumed;
      for (;;) {
        const progress = await page.evaluate(() => ({
          hit: globalThis.__BEAT_HIT__ === true,
          phase: globalThis.__I_WAS_SO_I_AM__.state?.phase,
          tapeTick: globalThis.__I_WAS_SO_I_AM__.state?.tapeTick ?? 0,
        }));
        if (progress.hit) {
          await setHeldKeys(held, new Set());
          held = new Set();
          await page.waitForTimeout(900);
          await page.screenshot({ path: `${outputDirectory}/${room}.png` });
          console.log(`${outputDirectory}/${room}.png`);
          captured = true;
          break;
        }
        if (progress.phase === "rerecord" || progress.tapeTick >= targetTick) break;
        await page.waitForTimeout(8);
      }
    }
    await setHeldKeys(held, new Set());
    if (!captured) {
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${outputDirectory}/${room}.png` });
      console.log(`${outputDirectory}/${room}.png (fallback: beat never reached)`);
    }
  }
} finally {
  await browser.close();
}
