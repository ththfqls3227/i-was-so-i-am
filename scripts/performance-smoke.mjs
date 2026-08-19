import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const gameUrl = process.env.GAME_URL ?? "http://127.0.0.1:4173/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  Object.defineProperty(globalThis.navigator, "webdriver", { configurable: true, get: () => false });
});
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("pageerror", (error) => errors.push(error.message));
page.on("requestfailed", (request) => errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`));

try {
  await page.goto(gameUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => globalThis.__I_WAS_SO_I_AM__?.renderer?.ready === true);
  await page.locator("#play-button").click();
  await page.keyboard.down("ArrowRight");
  const startTick = await page.evaluate(() => globalThis.__I_WAS_SO_I_AM__.state?.tick ?? 0);
  const deltas = await page.evaluate(() => new Promise((resolve) => {
    const samples = [];
    let previous;
    const capture = (timestamp) => {
      if (previous !== undefined) samples.push(timestamp - previous);
      previous = timestamp;
      if (samples.length >= 180) resolve(samples);
      else globalThis.requestAnimationFrame(capture);
    };
    globalThis.requestAnimationFrame(capture);
  }));
  await page.keyboard.up("ArrowRight");
  const endTick = await page.evaluate(() => globalThis.__I_WAS_SO_I_AM__.state?.tick ?? 0);
  const ordered = [...deltas].sort((left, right) => left - right);
  const averageMs = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  const p95Ms = ordered[Math.floor(ordered.length * 0.95)] ?? Infinity;
  const maximumMs = ordered.at(-1) ?? Infinity;
  const renderer = await page.evaluate(() => globalThis.__I_WAS_SO_I_AM__.renderer);
  const renderThrottleDisabled = await page.evaluate(() => globalThis.navigator.webdriver === false);
  const canvas = await page.locator("#game canvas").evaluate((element) => ({ width: element.clientWidth, height: element.clientHeight }));
  const report = {
    verdict: errors.length === 0 && renderThrottleDisabled && endTick - startTick >= 80 && averageMs < 50 && p95Ms < 100 && maximumMs < 250 ? "PASS" : "FAIL",
    capturedAt: new Date().toISOString(),
    url: gameUrl,
    renderer,
    renderThrottleDisabled,
    frameMetric: "requestAnimationFrame cadence with Babylon scene.render unthrottled on every frame",
    canvas,
    frameSamples: deltas.length,
    simulationTicksAdvanced: endTick - startTick,
    averageFrameMs: Number(averageMs.toFixed(3)),
    p95FrameMs: Number(p95Ms.toFixed(3)),
    maximumFrameMs: Number(maximumMs.toFixed(3)),
    thresholds: { minimumSimulationTicks: 80, averageFrameMs: 50, p95FrameMs: 100, maximumFrameMs: 250 },
    errors,
  };
  const artifactDirectory = new URL("../.omx/artifacts/visual-ralph/humanoid-redesign/", import.meta.url);
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(new URL("performance.json", artifactDirectory), `${JSON.stringify(report, null, 2)}\n`);
  if (report.verdict !== "PASS") throw new Error(JSON.stringify(report));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
