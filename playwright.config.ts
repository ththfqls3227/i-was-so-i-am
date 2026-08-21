import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT } from "./scripts/support/serve.mjs";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    // The built bundle, not a dev server. A gate has to test what we ship, and
    // what we ship is static — a dev server is a different program with hot
    // reload attached, which wipes the test handle on every save.
    //
    // reuseExistingServer is off on purpose: with it on, a dev server someone
    // left running on the authoring port would be adopted and this whole change
    // would silently do nothing.
    command: `npm run build:e2e && npx vite preview --outDir dist-e2e --port ${E2E_PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${E2E_PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
