import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_MCP_EXECUTABLE_PATH ?? chromium.executablePath();
const child = spawn("npx", [
  "--no-install",
  "playwright-mcp",
  "--isolated",
  "--headless",
  "--browser",
  "chromium",
  "--executable-path",
  executablePath,
  "--allowed-origins",
  "http://127.0.0.1:4173;http://localhost:4173",
], { stdio: "inherit" });

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
