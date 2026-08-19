import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../src/core/", import.meta.url);
const forbidden = [
  [/from\s+["']phaser["']/g, "Phaser import"],
  [/from\s+["']@babylonjs\//g, "Babylon import"],
  [/\b(document|window|localStorage|sessionStorage|performance)\b/g, "browser state"],
  [/\bDate\b/g, "wall-clock Date"],
  [/Math\.random/g, "Math.random"],
  [/requestAnimationFrame/g, "renderer cadence"],
];

const failures = [];
for (const entry of await readdir(root)) {
  if (!entry.endsWith(".ts")) continue;
  const source = await readFile(join(root.pathname, entry), "utf8");
  for (const [pattern, label] of forbidden) {
    if (pattern.test(source)) failures.push(`${entry}: forbidden ${label}`);
    pattern.lastIndex = 0;
  }
}
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("pure-core boundary: PASS");
}
