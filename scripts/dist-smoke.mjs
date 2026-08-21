import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
};
const retiredRasterArt = [
  "humanoid-sprites.png",
  "humanoid-echo-sprites.png",
  "memory-chamber-background.png",
  "memory-props.png",
];

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  let requested = pathname.replace(/^\//, "").replace(/^game\/?/, "");
  if (!requested) requested = "index.html";
  const safe = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  try {
    const content = await readFile(join(dist, safe));
    response.writeHead(200, { "content-type": types[extname(safe)] ?? "application/octet-stream" });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
});

async function requireAsset(url, label) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${label} is not reachable at ${url}`);
  return response;
}

async function inspectEntry(entryUrl) {
  const response = await requireAsset(entryUrl, "Built entry point");
  const html = await response.text();
  if (!html.includes("I WAS, SO I AM")) throw new Error(`${entryUrl} is not the game entry point`);

  const scriptPath = html.match(/src="([^"]+\.js)"/)?.[1];
  const stylesheetPath = html.match(/href="([^"]+\.css)"/)?.[1];
  if (!scriptPath || !stylesheetPath) throw new Error(`${entryUrl} is missing built JS or CSS`);

  const scriptResponse = await requireAsset(new URL(scriptPath, entryUrl), "Built script");
  await requireAsset(new URL(stylesheetPath, entryUrl), "Built stylesheet");
  const script = await scriptResponse.text();
  for (const file of retiredRasterArt) {
    const assetUrl = new URL(`./assets/${file}`, entryUrl);
    const assetResponse = await fetch(assetUrl);
    if (assetResponse.status !== 404) throw new Error(`Retired flattened art must not ship: ${assetUrl}`);
    if (script.includes(file)) throw new Error(`Production bundle references retired flattened art: ${file}`);
  }
  // The first three are the old 2D surface, still worth guarding while that
  // bundle is in dist. The fourth is the one that matters now: the first-person
  // build exposes it whenever VITE_E2E was set, and the gate builds set it. If a
  // gate build ever lands in dist/ instead of dist-e2e/, this is what says so —
  // and until it was added, nothing did.
  for (const testOnlyApi of ["runGolden", "loadGolden", "runTape", "__I_WAS_SO_I_AM_FP__"]) {
    if (script.includes(testOnlyApi)) throw new Error(`Production bundle exposes test-only API: ${testOnlyApi}`);
  }
  return Buffer.byteLength(script);
}

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Smoke server failed to bind");
try {
  const origin = `http://127.0.0.1:${address.port}`;
  const rootBytes = await inspectEntry(`${origin}/`);
  const subpathBytes = await inspectEntry(`${origin}/game/`);
  if (rootBytes !== subpathBytes) throw new Error("Root and subpath entries resolved different bundles");
  console.log(`dist smoke: PASS (${rootBytes} byte JS; root + /game/; procedural 3D only; 4 retired raster assets absent; no test-only APIs)`);
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
