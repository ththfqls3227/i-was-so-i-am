// Rewrite src/sim/corpus-checksums.json from the simulation as it stands.
//
// Run this ONLY for a deliberate change to the deterministic core, and read
// what it prints before committing the result. The file it writes is what
// scripts/fp-cross-engine.mjs holds Chromium, Firefox and WebKit to: a value
// that moves here has moved everywhere, and one that moves only in a browser
// is the engine disagreement this whole corpus exists to catch. Regenerating
// to make a red test green would erase exactly that signal.
//
// Usage: node scripts/regen-corpus-checksums.mjs [--write]
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { runCorpus } = await server.ssrLoadModule("/src/sim/corpus.ts");
const { AWAKENING } = await server.ssrLoadModule("/src/world/room.ts");

const first = runCorpus(AWAKENING);
const second = runCorpus(AWAKENING);
await server.close();

if (JSON.stringify(first) !== JSON.stringify(second)) {
  console.error("NOT REPRODUCIBLE within one run. Refusing to write.");
  process.exit(1);
}

const path = new URL("../src/sim/corpus-checksums.json", import.meta.url);
const golden = JSON.parse(await readFile(path, "utf8"));
let firstMoved = -1;
for (let i = 0; i < Math.max(golden.length, first.length); i += 1) {
  if (golden[i] !== first[i]) { firstMoved = i; break; }
}
const moved = first.filter((c, i) => c !== golden[i]).length;
console.log(`length ${golden.length} -> ${first.length}`);
console.log(`checksums moved: ${moved}, first at tick ${firstMoved}`);
if (process.argv.includes("--write")) {
  await writeFile(path, `${JSON.stringify(first, null, 2)}\n`);
  console.log("written");
} else {
  console.log("dry run; pass --write to commit the new values");
}
