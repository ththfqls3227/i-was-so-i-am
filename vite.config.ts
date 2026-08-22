import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  test: {
    // The sim suites replay hundreds of ticks; under full-suite load the
    // default 5s tripped on machines that pass every test in isolation.
    testTimeout: 15000,
  },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      input: {
        // index is the first-person rebuild; legacy keeps the top-down build
        // reachable and compiling until the new one reaches parity.
        index: resolve(import.meta.dirname, "index.html"),
        legacy: resolve(import.meta.dirname, "legacy.html"),
      },
    },
  },
});
