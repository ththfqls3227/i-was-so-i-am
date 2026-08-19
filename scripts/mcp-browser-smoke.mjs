import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const projectRoot = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const client = new Client({ name: "i-was-so-i-am-mcp-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: "npx",
  args: [
    "--no-install",
    "playwright-mcp",
    "--isolated",
    "--headless",
    "--browser",
    "chromium",
    "--executable-path",
    process.env.PLAYWRIGHT_MCP_EXECUTABLE_PATH ?? chromium.executablePath(),
    "--allowed-origins",
    "http://127.0.0.1:4173;http://localhost:4173",
    "--console-level",
    "error",
    "--output-dir",
    ".playwright-mcp",
  ],
  cwd: projectRoot,
  stderr: "pipe",
});

function textContent(result) {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

async function callTool(name, argumentsObject) {
  const result = await client.callTool({ name, arguments: argumentsObject });
  if (result.isError) throw new Error(`${name} failed: ${textContent(result)}`);
  return { result, text: textContent(result) };
}

function assertIncludes(text, expected, label) {
  if (!text.includes(expected)) throw new Error(`${label}: expected ${JSON.stringify(expected)} in ${text.slice(0, 2000)}`);
}

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const toolNames = tools.map((tool) => tool.name);
  for (const required of [
    "browser_navigate",
    "browser_snapshot",
    "browser_click",
    "browser_evaluate",
    "browser_run_code_unsafe",
    "browser_console_messages",
    "browser_take_screenshot",
  ]) {
    if (!toolNames.includes(required)) throw new Error(`Missing MCP tool: ${required}`);
  }

  await callTool("browser_navigate", { url: "http://127.0.0.1:4173/" });
  await callTool("browser_resize", { width: 1440, height: 1200 });
  await callTool("browser_evaluate", {
    function: "async () => { while (!window.__I_WAS_SO_I_AM__?.renderer?.ready) await new Promise(resolve => setTimeout(resolve, 20)); return window.__I_WAS_SO_I_AM__.renderer; }",
  });
  const initialSnapshot = await callTool("browser_snapshot", { depth: 8, boxes: true });
  assertIncludes(initialSnapshot.text, "I WAS, SO I AM", "initial accessibility snapshot");
  assertIncludes(initialSnapshot.text, "기억 속으로 들어가기", "initial accessibility snapshot");

  const initialState = await callTool("browser_evaluate", {
    function: "() => ({ title: document.title, heading: document.querySelector('h1')?.textContent, phase: window.__I_WAS_SO_I_AM__?.state?.phase, actorCount: window.__I_WAS_SO_I_AM__?.state?.actors?.length })",
  });
  assertIncludes(initialState.text, "I WAS, SO I AM", "initial browser state");
  assertIncludes(initialState.text, "recording", "initial browser state");

  await callTool("browser_click", { target: "#play-button", element: "기억 속으로 들어가기 button" });
  await callTool("browser_evaluate", {
    function: "() => window.__I_WAS_SO_I_AM__.switchChamber('crossing')",
  });
  const crossingSnapshot = await callTool("browser_snapshot", { depth: 8 });
  assertIncludes(crossingSnapshot.text, "건너는 기억", "Crossing accessibility snapshot");
  assertIncludes(crossingSnapshot.text, "다시 기록", "Crossing accessibility snapshot");

  const traceInput = await callTool("browser_run_code_unsafe", {
    code: `async (page) => {
      await page.keyboard.down('ArrowRight');
      await page.waitForFunction(() => (window.__I_WAS_SO_I_AM__?.state?.actors?.[0]?.x ?? 0) >= 240, null, { polling: 10, timeout: 3000 });
      await page.keyboard.up('ArrowRight');
      await page.keyboard.down('Space');
      await page.waitForFunction(() => window.__I_WAS_SO_I_AM__?.state?.phase === 'replay', null, { timeout: 9000 });
      await page.keyboard.up('Space');
      await page.keyboard.down('ArrowRight');
      await page.waitForFunction(() => window.__I_WAS_SO_I_AM__?.state?.phase === 'success', null, { polling: 10, timeout: 11000 });
      await page.keyboard.up('ArrowRight');
      return page.evaluate(() => ({ phase: window.__I_WAS_SO_I_AM__.state?.phase, actors: window.__I_WAS_SO_I_AM__.state?.actors, door: window.__I_WAS_SO_I_AM__.state?.door, tapeTick: window.__I_WAS_SO_I_AM__.state?.tapeTick }));
    }`,
  });
  assertIncludes(traceInput.text, "success", "MCP-driven Crossing completion");

  const screenshot = await callTool("browser_take_screenshot", { type: "png", scale: "css", fullPage: true });
  const imageBlock = screenshot.result.content.find((block) => block.type === "image");
  if (!imageBlock || typeof imageBlock.data !== "string") throw new Error("MCP screenshot did not return image data");
  await mkdir(new URL("../.playwright-mcp/", import.meta.url), { recursive: true });
  await writeFile(new URL("../.playwright-mcp/crossing-success.png", import.meta.url), Buffer.from(imageBlock.data, "base64"));

  const chamberSnapshots = [];
  for (const [id, title] of [["crossing", "건너는 기억"], ["traceWeight", "무게의 흔적"], ["handoff", "이어받은 마음"], ["lastHold", "마지막 붙듦"]]) {
    await callTool("browser_evaluate", { function: `() => window.__I_WAS_SO_I_AM__.switchChamber('${id}')` });
    const snapshot = await callTool("browser_snapshot", { depth: 6 });
    assertIncludes(snapshot.text, title, `${title} accessibility snapshot`);
    chamberSnapshots.push(id);
  }

  const goldenResults = await callTool("browser_evaluate", {
    function: "() => Object.fromEntries(['crossing','traceWeight','handoff','lastHold'].flatMap(id => [[`${id}30`, window.__I_WAS_SO_I_AM__.runGolden(id, 30).success], [`${id}144`, window.__I_WAS_SO_I_AM__.runGolden(id, 144).success]]))",
  });
  for (const marker of ["traceWeight30", "crossing144", "handoff30", "lastHold144", "true"]) {
    assertIncludes(goldenResults.text, marker, "MCP browser golden results");
  }
  if (goldenResults.text.includes("false")) throw new Error("An MCP browser golden path failed");

  const liveJourney = await callTool("browser_run_code_unsafe", {
    code: `async (page) => {
      const route = ['crossing', 'traceWeight', 'handoff', 'lastHold'];
      const solutions = await page.evaluate(async (ids) => {
        const { goldenFor } = await import('/src/content/golden.ts');
        return Object.fromEntries(ids.map(id => {
          const solution = goldenFor(id);
          return [id, { past: solution.past.frames, present: solution.present }];
        }));
      }, route);
      const heldKeys = new Set();
      const keysFor = mask => new Set([
        mask & 1 ? 'ArrowUp' : '', mask & 2 ? 'ArrowDown' : '',
        mask & 4 ? 'ArrowLeft' : '', mask & 8 ? 'ArrowRight' : '', mask & 16 ? 'Space' : '',
      ].filter(Boolean));
      const setHeld = async next => {
        for (const key of heldKeys) if (!next.has(key)) { await page.keyboard.up(key); heldKeys.delete(key); }
        for (const key of next) if (!heldKeys.has(key)) { await page.keyboard.down(key); heldKeys.add(key); }
      };
      const playFrames = async frames => {
        const start = await page.evaluate(() => ({
          tick: window.__I_WAS_SO_I_AM__.state?.tapeTick ?? 0,
          phase: window.__I_WAS_SO_I_AM__.state?.phase,
        }));
        let consumed = 0;
        while (consumed < frames.length) {
          const mask = (frames[consumed] ?? 0) & 31;
          let end = consumed + 1;
          while (end < frames.length && ((frames[end] ?? 0) & 31) === mask) end += 1;
          await setHeld(keysFor(mask));
          consumed = end;
          await page.waitForFunction(({ target, phase }) => {
            const state = window.__I_WAS_SO_I_AM__.state;
            return state?.success || state?.phase === 'rerecord' || state?.phase !== phase || (state?.tapeTick ?? 0) >= target;
          }, { target: start.tick + consumed, phase: start.phase }, { polling: 10, timeout: 15000 });
          if (await page.locator('#success-card').isVisible()) return;
        }
      };
      try {
        await page.evaluate(() => window.__I_WAS_SO_I_AM__.switchChamber('traceWeight'));
        for (const [index, id] of route.entries()) {
          await page.waitForFunction(room => document.querySelector('#chamber-title')?.getAttribute('data-chamber-id') === room, id);
          await playFrames(solutions[id].past);
          await page.waitForFunction(() => window.__I_WAS_SO_I_AM__.state?.phase === 'replay');
          await playFrames(solutions[id].present);
          await setHeld(new Set());
          if (!(await page.locator('#success-card').isVisible())) throw new Error(id + ' live success card missing');
          await page.locator('#next').click();
          const next = route[index + 1];
          if (next) await page.waitForFunction(room => document.querySelector('#chamber-title')?.getAttribute('data-chamber-id') === room, next);
        }
        return { endingVisible: await page.locator('#ending-screen').isVisible(), route };
      } finally {
        await setHeld(new Set());
      }
    }`,
  });
  assertIncludes(liveJourney.text, "endingVisible", "MCP live journey");
  assertIncludes(liveJourney.text, "true", "MCP live journey");
  const endingSnapshot = await callTool("browser_snapshot", { depth: 8 });
  assertIncludes(endingSnapshot.text, "과거는 문을 붙들고 남았다", "ending accessibility snapshot");
  assertIncludes(endingSnapshot.text, "지금 여기에 있다", "ending accessibility snapshot");

  const consoleErrors = await callTool("browser_console_messages", { level: "error", all: true });
  if (!/Errors:\s*0|Total messages:\s*0|No console messages|<no console messages>/i.test(consoleErrors.text)) {
    throw new Error(`Browser console errors were reported: ${consoleErrors.text}`);
  }

  console.log(JSON.stringify({
    verdict: "PASS",
    server: "@playwright/mcp@0.0.78",
    discoveredTools: toolNames.length,
    title: "I WAS, SO I AM",
    accessibilitySnapshots: ["title", "crossing", ...chamberSnapshots, "ending"],
    liveKeyboardCrossing: true,
    completeJourney: true,
    goldenCadences: [30, 144],
    consoleErrors: 0,
    screenshot: ".playwright-mcp/crossing-success.png",
  }, null, 2));
} finally {
  await client.close();
}
