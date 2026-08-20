import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
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
