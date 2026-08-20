// Submission stills: the chamber-select screen and 1920x1080 hero shots taken
// in-game, for thumbnails and store art.
// Usage: node scripts/hero-captures.mjs [outputDirectory]
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const gameUrl = process.env.GAME_URL ?? "http://127.0.0.1:4173/";
const outputDirectory = process.argv[2] ?? "captures";

const disableAutomationThrottle = () => {
  Object.defineProperty(globalThis.navigator, "webdriver", { configurable: true, get: () => false });
};

// Every chamber unlocked, so the select grid shows the whole route.
const seedProgress = () => {
  globalThis.localStorage.setItem("i-was-so-i-am:progress:v1", JSON.stringify({
    nextRoom: "lastHold",
    locale: "ko",
    cleared: ["awakening", "secondSelf", "crossing", "handNotBody", "traceWeight", "handoff"],
  }));
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

// Beats chosen for what they say about the game: cooperation, the echo at work,
// and the hand-off that only two selves can finish.
const heroes = [
  {
    name: "hero-trace-weight",
    room: "traceWeight",
    beat: (state) => state.forceObject?.force === state.forceObject?.threshold && state.exit.open === true,
  },
  {
    name: "hero-crossing",
    room: "crossing",
    beat: (state) => state.door?.open === true && (state.actors.find((a) => a.id === "present")?.x ?? 0) > (state.door?.rect.x ?? 0),
  },
  {
    name: "hero-handoff",
    room: "handoff",
    beat: (state) => state.handoff?.carriedByPresent === true || state.handoff?.delivered === true,
  },
];

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});

try {
  // Chamber select, at review size.
  const selectPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await selectPage.addInitScript(disableAutomationThrottle);
  await selectPage.addInitScript(seedProgress);
  await selectPage.goto(gameUrl, { waitUntil: "networkidle" });
  await selectPage.waitForFunction(() => globalThis.__I_WAS_SO_I_AM__?.renderer?.ready === true);
  await selectPage.waitForTimeout(1200);
  await selectPage.screenshot({ path: `${outputDirectory}/select.png` });
  console.log(`${outputDirectory}/select.png`);
  await selectPage.close();

  for (const hero of heroes) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.addInitScript(disableAutomationThrottle);
    await page.goto(gameUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => globalThis.__I_WAS_SO_I_AM__?.renderer?.ready === true);
    await page.locator("#play-button").click();
    const frames = await page.evaluate(async (id) => {
      const module = await import("/src/content/golden.ts");
      globalThis.__I_WAS_SO_I_AM__.switchChamber(id);
      globalThis.__I_WAS_SO_I_AM__.loadGolden(id);
      return module.goldenFor(id).present;
    }, hero.room);

    let held = new Set();
    let consumed = 0;
    let captured = false;
    const startTick = await page.evaluate(() => globalThis.__I_WAS_SO_I_AM__.state?.tapeTick ?? 0);
    const setHeld = async (next) => {
      for (const key of held) if (!next.has(key)) await page.keyboard.up(key);
      for (const key of next) if (!held.has(key)) await page.keyboard.down(key);
      held = next;
    };
    while (consumed < frames.length && !captured) {
      const mask = (frames[consumed] ?? 0) & 31;
      let runEnd = consumed + 1;
      while (runEnd < frames.length && ((frames[runEnd] ?? 0) & 31) === mask) runEnd += 1;
      await setHeld(keysForFrame(mask));
      consumed = runEnd;
      const targetTick = startTick + consumed;
      for (;;) {
        const state = await page.evaluate(() => globalThis.__I_WAS_SO_I_AM__.state);
        if (state && hero.beat(state)) {
          await setHeld(new Set());
          await page.waitForTimeout(900);
          await page.screenshot({ path: `${outputDirectory}/${hero.name}.png` });
          console.log(`${outputDirectory}/${hero.name}.png`);
          captured = true;
          break;
        }
        if (state?.phase === "rerecord" || (state?.tapeTick ?? 0) >= targetTick) break;
        await page.waitForTimeout(8);
      }
    }
    await setHeld(new Set());
    if (!captured) {
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${outputDirectory}/${hero.name}.png` });
      console.log(`${outputDirectory}/${hero.name}.png (fallback: beat never reached)`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
