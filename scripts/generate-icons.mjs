// Generate PWA icon PNGs from public/icon-source.svg.
//
// Run once via: node scripts/generate-icons.mjs
// Output PNGs are committed to git — production builds don't re-render.
// Edit icon-source.svg + re-run + commit if the brand mark changes.

import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const sourcePath = join(repoRoot, "public", "icon-source.svg");

const TARGETS = [
  { width: 192, file: "icon-192.png" },
  { width: 512, file: "icon-512.png" },
  { width: 180, file: "apple-touch-icon.png" },
];

const svg = readFileSync(sourcePath, "utf8");

for (const { width, file } of TARGETS) {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width } });
  const png = resvg.render().asPng();
  const outPath = join(repoRoot, "public", file);
  writeFileSync(outPath, png);
  console.log(`✓ ${file}  (${width}×${width}, ${png.length} bytes)`);
}
