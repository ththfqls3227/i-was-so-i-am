import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const packages = Object.entries(lock.packages).filter(([path]) => path !== "");
const missing = packages.filter(([, metadata]) => !metadata.license);
if (missing.length > 0) {
  console.error(missing.map(([path, metadata]) => `${path}@${metadata.version}: missing license metadata`).join("\n"));
  process.exitCode = 1;
} else {
  const counts = packages.reduce((result, [, metadata]) => {
    result[metadata.license] = (result[metadata.license] ?? 0) + 1;
    return result;
  }, {});
  console.log(`license metadata: PASS (${packages.length} direct/transitive package entries)`);
  console.log(JSON.stringify(counts));
}

const manifestUrl = new URL("../docs/prototype/assets-manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const invalidAssets = [];
if (!Array.isArray(manifest.runtimeAssets) || manifest.runtimeAssets.length !== 0) {
  invalidAssets.push("assets-manifest.json must declare zero runtime raster assets");
}
for (const asset of manifest.retiredConceptAssets ?? []) {
  try {
    const contents = await readFile(new URL(`../${asset.path}`, import.meta.url));
    const digest = createHash("sha256").update(contents).digest("hex");
    if (digest !== asset.sha256) invalidAssets.push(`${asset.path}: expected ${asset.sha256}, received ${digest}`);
    if (!asset.purpose) invalidAssets.push(`${asset.path}: incomplete provenance record`);
  } catch (error) {
    invalidAssets.push(`${asset.path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (invalidAssets.length > 0) {
  console.error(invalidAssets.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`art provenance: PASS (0 runtime raster assets; ${manifest.retiredConceptAssets.length} retained concept references)`);
}
