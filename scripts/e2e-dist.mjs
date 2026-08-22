// Runs the browser suite against a real build instead of the dev server.
//
// The test API is compiled out of a plain build, so the gate needs a bundle
// built with VITE_E2E=true. That bundle must never be the one that ships, so it
// is written to `dist-e2e/` and `dist/` is left exactly as the last real build
// left it — the ordering hazard is removed rather than sequenced. Both halves of
// that promise are checked here: the served bundle must carry the test API, and
// `dist/`, if it exists, must still not.
//
// Types are proven by `npm run validate`; this script only builds the bundle it
// serves. Extra arguments are forwarded to Playwright (`--grep`, `--repeat-each`).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
// Overridable so a second gate can run beside a first without either rebuilding
// the directory the other is serving.
const outDir = process.env.DIST_GATE_OUT_DIR || "dist-e2e";
/**
 * What the gate build must expose, and what the shipped build must not.
 *
 * These were one list, and it held the 2D build's names. That broke both jobs
 * at once: the shipped-build guard stopped watching the surface we actually
 * ship, and the gate-build check demanded three names that are no longer in any
 * bundle — so this script threw before it ran a single test.
 *
 * The handle is what VITE_E2E controls today, so it is what proves the flag
 * took effect. The old names stay on the forbidden list only: the legacy entry
 * is still built, and nothing should reintroduce them into what ships.
 */
const REQUIRED_IN_GATE_BUILD = ["__I_WAS_SO_I_AM_FP__"];
const FORBIDDEN_IN_SHIPPED = ["runGolden", "loadGolden", "runTape", "__I_WAS_SO_I_AM_FP__"];

const args = process.argv.slice(2);
const everyBrowser = args.includes("--all");
const forwarded = args.filter((argument) => argument !== "--all");

function run(command, commandArgs, env = {}) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/**
 * Every built script, concatenated — not just the entry. The boot gate made
 * the entry a doorman and moved the game (and its test handle) into a lazy
 * chunk, so a scan of the entry alone both misses the handle it requires and
 * misses the handle it forbids.
 */
async function allBuiltScripts(directory) {
  const assets = join(directory, "assets");
  const files = (await readdir(assets)).filter((file) => file.endsWith(".js"));
  if (files.length === 0) throw new Error(`${directory}/assets has no built scripts`);
  const sources = await Promise.all(files.map((file) => readFile(join(assets, file), "utf8")));
  return sources.join("\n");
}

await rm(join(root, outDir), { recursive: true, force: true });
const build = run("npx", ["--no-install", "vite", "build", "--outDir", outDir], { VITE_E2E: "true" });
if (build !== 0) process.exit(build);

const served = await allBuiltScripts(join(root, outDir));
const absent = REQUIRED_IN_GATE_BUILD.filter((api) => !served.includes(api));
if (absent.length > 0) throw new Error(`${outDir}/ was built without the test API (${absent.join(", ")}); VITE_E2E did not take effect`);

const status = run("npx", [
  "--no-install", "playwright", "test",
  "--config", "playwright.dist.config.ts",
  ...(everyBrowser ? [] : ["--project=chromium"]),
  ...forwarded,
]);

const shipped = join(root, "dist");
if (existsSync(join(shipped, "index.html"))) {
  const script = await allBuiltScripts(shipped);
  const exposed = FORBIDDEN_IN_SHIPPED.filter((api) => script.includes(api));
  if (exposed.length > 0) throw new Error(`dist/ exposes test-only APIs (${exposed.join(", ")}); the shipped build must come from a plain "npm run build"`);
  console.log(`e2e dist: PASS-GUARD (served ${outDir}/ with the test API; dist/ still ships without it)`);
} else {
  console.log(`e2e dist: PASS-GUARD (served ${outDir}/ with the test API; no dist/ to contaminate)`);
}

process.exit(status);
