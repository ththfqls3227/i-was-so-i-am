// The server every browser gate runs against.
//
// One rule decides everything here: a gate has to test the thing we ship. The
// judges get a static build, so the gates get a static build — not a dev server
// with hot reload attached, which is a different program with different failure
// modes and, as it turned out, its own way of breaking the runs.
//
// What hot reload did to us: the test handle is assigned once at module scope,
// so any reload wipes it. With two agents in one tree, every file save by the
// other one reloaded the page mid-run and the next read found an empty
// document. It failed at a different place every time, which is exactly what
// made it look like a race in our own code rather than the server.
//
// Three things this owns, all for the same reason — none of them can be left to
// whatever happened to be running:
//
//   1. The build. The test handle only exists when VITE_E2E=true was set at
//      build time, so serving someone else's dist means serving a build with no
//      handle in it.
//   2. The output directory. It must never be dist/. That build has the test
//      API compiled in, and dist/ is what goes to the judges.
//   3. The port. Not the authoring port, so a dev server someone left running
//      cannot be mistaken for this one.
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const VITE_BIN = fileURLToPath(new URL("../../node_modules/vite/bin/vite.js", import.meta.url));

/** Built with the test handle in it. Never dist/ — see the note above. */
export const E2E_OUT_DIR = "dist-e2e";
/** Not 4173. That one belongs to whoever is authoring right now. */
export const E2E_PORT = 4183;

const run = (command, args, label, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false, env });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited ${code}`));
    });
  });

async function answers(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) throw new Error(`No server answered at ${url} within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/**
 * Build the game with the test handle and serve it.
 *
 * Returns the url to point a browser at and a stop() to call when done. Set
 * GAME_URL to skip all of this and use a server you are running yourself —
 * useful while iterating, and the reason every script still honours it.
 */
export async function startGameServer({ label = "gate" } = {}) {
  const provided = process.env.GAME_URL;
  if (provided) {
    console.log(`${label}: using GAME_URL ${provided} (no build, no server started)`);
    return { url: provided, stop: async () => {} };
  }

  // A stale directory would serve a build from before the change under test.
  await rm(E2E_OUT_DIR, { recursive: true, force: true });
  console.log(`${label}: building into ${E2E_OUT_DIR}/ with the test handle …`);
  // The handle only exists when this is set at build time. Without it the page
  // loads fine and every gate fails on the first read with no handle to read.
  await run(
    process.execPath,
    [VITE_BIN, "build", "--outDir", E2E_OUT_DIR, "--logLevel", "error"],
    "vite build",
    { ...process.env, VITE_E2E: "true" },
  );

  const url = `http://127.0.0.1:${E2E_PORT}/`;
  const server = spawn(
    process.execPath,
    [
      VITE_BIN,
      "preview",
      "--outDir",
      E2E_OUT_DIR,
      "--port",
      String(E2E_PORT),
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    { stdio: "ignore", shell: false },
  );

  let exited = null;
  server.on("exit", (code) => {
    exited = code;
  });

  try {
    await answers(url, 30000);
  } catch (error) {
    server.kill("SIGTERM");
    throw new Error(
      `${error.message}${exited === null ? "" : ` (preview exited ${exited})`}`,
      { cause: error },
    );
  }

  console.log(`${label}: serving ${E2E_OUT_DIR}/ at ${url}`);
  return {
    url,
    stop: async () => {
      if (exited !== null) return;
      server.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 200));
    },
  };
}
