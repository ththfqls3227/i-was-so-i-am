import { defineConfig, devices } from "@playwright/test";

// The same browser suite as playwright.config.ts, served from a real build
// instead of the dev server. The bundle under test is built by
// scripts/e2e-dist.mjs into `dist-e2e/`, never into the shipped `dist/`, so a
// build that keeps the test API can never become the build that ships. Run it
// through `npm run test:e2e:dist`; starting this config on its own would serve
// whatever `dist-e2e/` happens to hold.
// Port and output directory are overridable so two gates can run at once. They
// both rebuild the directory they serve, so sharing one would mean each run
// clobbering the other's bundle — which is a failure with nothing to do with
// what either was testing.
const port = Number(process.env.DIST_GATE_PORT) || 4273;
const outDir = process.env.DIST_GATE_OUT_DIR || "dist-e2e";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `npx --no-install vite preview --outDir ${outDir} --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    // Never inherit a stranger's server: this gate is only meaningful when it
    // serves the build this run just made.
    reuseExistingServer: false,
  },
});
