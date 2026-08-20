import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Both deterministic cores answer to the same rules: the 2D one that still ships
// the old game, and the 3D one the first-person rebuild runs on.
const roots = [new URL("../src/core/", import.meta.url), new URL("../src/sim/", import.meta.url)];
const forbidden = [
  [/from\s+["']phaser["']/g, "Phaser import"],
  [/from\s+["']@babylonjs\//g, "Babylon import"],
  [/\b(document|window|localStorage|sessionStorage|performance)\b/g, "browser state"],
  [/\bDate\b/g, "wall-clock Date"],
  [/Math\.random/g, "Math.random"],
  [/requestAnimationFrame/g, "renderer cadence"],
  // ECMA-262 pins no accuracy for these, so two engines may disagree in the last
  // bits and desynchronise a replayed tape. The sim derives its own from a
  // polynomial in src/sim/trig.ts; Math.sqrt is exempt because IEEE-754 does
  // specify it exactly.
  [/Math\.(sin|cos|tan|asin|acos|atan|atan2|hypot|pow|exp|log|cbrt)\s*\(/g, "unspecified transcendental"],
];

const failures = [];
for (const root of roots) {
  for (const entry of await readdir(root, { recursive: true })) {
    if (!entry.endsWith(".ts")) continue;
    const source = await readFile(join(root.pathname, entry), "utf8");
    for (const [pattern, label] of forbidden) {
      if (pattern.test(source)) failures.push(`${root.pathname}${entry}: forbidden ${label}`);
      pattern.lastIndex = 0;
    }
  }
}
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("pure-core boundary: PASS (src/core, src/sim)");
}
