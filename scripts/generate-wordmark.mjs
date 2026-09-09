// Generate public/orbit-wordmark.svg — the Orbit wordmark with the letters
// converted to PATHS.
//
// Run by hand:  node scripts/generate-wordmark.mjs
// The output SVG is committed; production never runs this.
//
// 🔴 WHY THE LETTERS ARE OUTLINED AND NOT <text>. The picker fleet is mixed
// second-hand Android, the depot runs Windows, and the office uses iPhones. Live
// <text> picks a different face on each of them, so the logo would not be the same
// shape twice. The rebrand decision record says it outright: "Until that file
// exists, the logo is not really a logo."
//
// 🔴 THE TYPEFACE IS THE APP'S OWN. Plus Jakarta Sans Bold is already the product's
// --font-sans (app/layout.tsx, next/font), so the wordmark is cut from the same
// face the interface is set in rather than being a stranger laid on top. The TTF is
// vendored at scripts/fonts/ under the SIL Open Font License 1.1 — verified from
// the font's own name table, not assumed.
//
// The fill is `currentColor` so ONE file serves every placement: brand-800 on the
// white sidebar, white on a violet tile, black on a printed challan. The viewBox is
// tight to the ink — callers own the spacing, because a margin baked in here would
// be a margin nobody could remove.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const TEXT = "Orbit";        // sentence case — the locked product name
const TRACKING_EM = -0.046;  // rebrand spec §6
const OUT = join(repoRoot, "public", "orbit-wordmark.svg");

const buf = readFileSync(join(__dirname, "fonts", "PlusJakartaSans-Bold.ttf"));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const upem = font.unitsPerEm;                 // 1000
const tracking = TRACKING_EM * upem;          // -46 units between letters

// Lay the glyphs out at 1:1 with the em square, baseline at y = 0. opentype
// returns SVG-space paths (y grows downward), so ink above the baseline is
// negative — the translate below fixes that once, at the end.
const commands = [];
let penX = 0;
for (const ch of TEXT) {
  const glyph = font.charToGlyph(ch);
  if (!glyph || glyph.index === 0) throw new Error(`No glyph for "${ch}" in this font`);
  const p = glyph.getPath(penX, 0, upem);
  commands.push(...p.commands);
  penX += glyph.advanceWidth + tracking;
}

// Tight bounding box over the real ink, curve control points included — a box
// measured from on-curve points alone clips the overshoot on O, b and t.
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
const see = (x, y) => {
  if (x < minX) minX = x; if (x > maxX) maxX = x;
  if (y < minY) minY = y; if (y > maxY) maxY = y;
};
for (const c of commands) {
  if (c.type === "Z") continue;
  see(c.x, c.y);
  if (c.x1 !== undefined) see(c.x1, c.y1);
  if (c.x2 !== undefined) see(c.x2, c.y2);
}

const w = maxX - minX;
const h = maxY - minY;
const r = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Emit one path, shifted so the ink starts at 0,0.
let d = "";
for (const c of commands) {
  const X = (v) => r(v - minX);
  const Y = (v) => r(v - minY);
  switch (c.type) {
    case "M": d += `M${X(c.x)} ${Y(c.y)}`; break;
    case "L": d += `L${X(c.x)} ${Y(c.y)}`; break;
    case "C": d += `C${X(c.x1)} ${Y(c.y1)} ${X(c.x2)} ${Y(c.y2)} ${X(c.x)} ${Y(c.y)}`; break;
    case "Q": d += `Q${X(c.x1)} ${Y(c.y1)} ${X(c.x)} ${Y(c.y)}`; break;
    case "Z": d += "Z"; break;
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(w)} ${r(h)}" fill="currentColor" role="img" aria-label="Orbit"><title>Orbit</title><path fill-rule="nonzero" d="${d}"/></svg>\n`;

writeFileSync(OUT, svg, "utf8");
console.log(`✓ public/orbit-wordmark.svg`);
console.log(`  viewBox 0 0 ${r(w)} ${r(h)}   aspect ${(w / h).toFixed(4)}  (${svg.length} bytes)`);
console.log(`  glyphs ${TEXT.length}, tracking ${TRACKING_EM}em (${tracking} units @ ${upem} upem)`);

// ── The React component, emitted from THE SAME path string ──────────────────
// The .svg cannot be used via <img> and still take its colour from the caller:
// `currentColor` resolves inside the image's own document, not the page's. Every
// in-app placement needs the mark to inherit — brand-800 on the white rail, white
// on a violet tile — so the app gets an inlined component instead.
//
// It is GENERATED, never hand-edited, so the two artifacts cannot drift: one font,
// one layout pass, one path string, two outputs. Editing the .tsx by hand would
// reintroduce exactly the duplication this avoids.
const ASPECT = w / h;
const tsx = `// GENERATED FILE — do not edit by hand.
// Source: scripts/generate-wordmark.mjs + scripts/fonts/PlusJakartaSans-Bold.ttf
// Regenerate: node scripts/generate-wordmark.mjs
//
// The Orbit wordmark. Letters are OUTLINED PATHS, not text — the picker fleet is
// mixed second-hand Android, the depot is on Windows and the office on iPhones, so
// live <text> would not be the same shape twice.
//
// Colour comes from \`currentColor\`: set it on the element or a parent
// (\`text-brand-800\` on the rail, \`text-white\` on a tile). There is no symbol and
// no tile baked in here — callers own both.
import * as React from "react";

/** Intrinsic aspect ratio (width ÷ height) of the outlined word. */
export const ORBIT_WORDMARK_ASPECT = ${ASPECT.toFixed(4)};

export function OrbitWordmark({
  height,
  className,
}: {
  /** Rendered height in px. Width follows the aspect ratio. */
  height: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 ${r(w)} ${r(h)}"
      height={height}
      width={Math.round(height * ORBIT_WORDMARK_ASPECT)}
      fill="currentColor"
      role="img"
      aria-label="Orbit"
      className={className}
    >
      <path fillRule="nonzero" d="${d}" />
    </svg>
  );
}
`;
const OUT_TSX = join(repoRoot, "components", "shared", "orbit-wordmark.tsx");
writeFileSync(OUT_TSX, tsx, "utf8");
console.log(`✓ components/shared/orbit-wordmark.tsx  (aspect ${ASPECT.toFixed(4)})`);

// ── The app-icon tile, from THE SAME path string ────────────────────────────
// Third artifact, same source. The chain is:
//   generate-wordmark.mjs → public/icon-source.svg → generate-icons.mjs → 3 PNGs
// so the icon cannot drift from the wordmark on the rail.
//
// The gradient is the rebrand spec's, translated from CSS to SVG:
//   radial-gradient(125% 125% at 26% 20%, #A78BFA 0%, #7C3AED 44%, #581C87 100%)
// In objectBoundingBox units that is cx .26 / cy .20 / r 1.25 — the 125% CSS size
// is the ending-shape RADIUS, not its diameter.
//
// 🔴 THE HOT SPOT IS INSET FROM THE CORNER ON PURPOSE. Android maskable icons are
// cropped to a circle and the guaranteed-safe area is the middle 80%. A highlight
// parked at 0%,0% would be cropped away on most launchers; at 26%/20% it survives.
// The wordmark is sized so its own corners stay inside that circle too — see the
// assertion below, which fails the build rather than shipping a clipped logo.
const TILE = 512;
const MARK_W = 300;                       // 58.6% of the tile — generous margin
const MARK_H = MARK_W / ASPECT;           // ≈ 99.6
const markScale = MARK_W / w;
const markX = (TILE - MARK_W) / 2;
const markY = (TILE - MARK_H) / 2;

// Maskable safe zone: a centred circle of diameter 80% of the tile.
const safeR = TILE * 0.8 / 2;             // 204.8
const markCornerR = Math.hypot(MARK_W / 2, MARK_H / 2);
if (markCornerR >= safeR) {
  throw new Error(
    `Wordmark corner ${markCornerR.toFixed(1)}px exceeds the maskable safe radius ` +
    `${safeR.toFixed(1)}px — Android's circular crop would clip the logo. Reduce MARK_W.`
  );
}

const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">
  <!-- GENERATED by scripts/generate-wordmark.mjs — do not edit by hand. -->
  <defs>
    <radialGradient id="orbit-tile" cx="0.26" cy="0.20" r="1.25">
      <stop offset="0" stop-color="#A78BFA"/>
      <stop offset="0.44" stop-color="#7C3AED"/>
      <stop offset="1" stop-color="#581C87"/>
    </radialGradient>
  </defs>
  <rect width="${TILE}" height="${TILE}" fill="url(#orbit-tile)"/>
  <g transform="translate(${r(markX)} ${r(markY)}) scale(${markScale.toFixed(6)})">
    <path fill="#FFFFFF" fill-rule="nonzero" d="${d}"/>
  </g>
</svg>
`;
writeFileSync(join(repoRoot, "public", "icon-source.svg"), icon, "utf8");
console.log(`✓ public/icon-source.svg  ${TILE}x${TILE}, wordmark ${MARK_W}x${MARK_H.toFixed(1)}`);
console.log(`  maskable safe radius ${safeR.toFixed(1)}px, wordmark corner ${markCornerR.toFixed(1)}px — clears by ${(safeR - markCornerR).toFixed(1)}px`);
console.log(`\n  next: node scripts/generate-icons.mjs`);
