// The last command before the build is handed to judges.
//
// It runs the two gates that can prove themselves unattended — the full
// validate chain, then the browser suite against a real build — and stops at the
// first failure. Everything that needs a server this gate does not own is
// printed at the end rather than skipped quietly, so "the gate passed" never
// means "the parts that need a terminal were forgotten".
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const gates = [
  ["validate", "the pure-core, corpus, level, licence, build and served-dist gates"],
  ["test:e2e:dist", "the browser suite against the built bundle, in Chromium"],
];

for (const [script, what] of gates) {
  console.log(`\ngate:submission — npm run ${script} (${what})`);
  const result = spawnSync("npm", ["run", script], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`\ngate:submission FAILED at "npm run ${script}". Nothing below it was run.`);
    process.exit(result.status ?? 1);
  }
}

console.log(`
gate:submission PASS — validate and the built-bundle browser suite are green.

Still owed by hand, each needing a dev server this gate does not start:

  npm run dev -- --host 127.0.0.1 --port 4173   # leave running in another terminal
  npm run test:performance                      # WebGL2 cadence receipt under .omx/artifacts/
  npm run test:mcp                              # protocol-level browser smoke
  npm run test:e2e:dist:all                     # the built bundle in Firefox and WebKit too

The human gates — fresh-eyes playtest, public URL, OG image and description — are
tracked in docs/prototype/gate-report.md.`);
