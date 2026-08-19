import { defineConfig, devices } from "@playwright/test";

// The same browser suite as playwright.config.ts, served from a real build
// instead of the dev server. The bundle under test is built by
// scripts/e2e-dist.mjs into `dist-e2e/`, never into the shipped `dist/`, so a
// build that keeps the test API can never become the build that ships. Run it
// through `npm run test:e2e:dist`; starting this config on its own would serve
// whatever `dist-e2e/` happens to hold.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4273",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npx --no-install vite preview --outDir dist-e2e --host 127.0.0.1 --port 4273 --strictPort",
    url: "http://127.0.0.1:4273",
    // Never inherit a stranger's server: this gate is only meaningful when it
    // serves the build this run just made.
    reuseExistingServer: false,
  },
});
