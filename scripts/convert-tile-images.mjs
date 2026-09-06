// Converts the salesman board's tile art into one <slug>.webp per product.
//
//   node scripts/convert-tile-images.mjs [--force] [--contact-sheet]
//
// WHY THIS EXISTS. The board renders 32 tiles at 84 CSS px in a 4-across grid.
// Source art arrives from a dozen places — supplier sites, phone photos, a
// screenshot or two — at wildly different sizes, formats and framings, and with
// a different amount of white margin baked into each one. Dropped in raw, one
// tin fills its tile while the next floats in the middle of it, and the board
// reads as thrown together rather than designed.
//
// So the fix is not "resize everything to 600px". Resizing to a common CANVAS
// keeps every difference in margin; the tins still come out different sizes. We
// trim each image down to the tin's own bounding box and then rebuild the
// square around it, so what is uniform is the tin's SHARE of the frame. Every
// output lands in an identically sized tile, so an equal share is what actually
// reads as an equal size on the phone.
//
// 🔴 NOT A BUILD STEP. Run by hand when new art arrives, and the .webp results
// are committed. Nothing at runtime imports this, and `sharp` is a
// devDependency for exactly that reason — a one-time conversion must not put a
// native binary into the deploy.

import { readdir, stat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR  = path.join(HERE, "..", "public", "category-images");
const SHEET = path.join(HERE, "tile-contact-sheet.png");

/** The tin's longest side, as a share of the square it sits in. */
const TIN_SHARE = 0.84;
/** Preferred output edge. A source is never upscaled to reach it. */
const CANVAS = 600;
/** White, the board's own tile ground before the family tint goes behind it. */
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

const TARGET_BYTES = 40 * 1024;   // aim under this
const LOUD_BYTES   = 60 * 1024;   // above this the run says so, by name
const QUALITY_STEPS = [82, 76, 70, 64, 58, 52, 46];

const force = process.argv.includes("--force");
const wantSheet = process.argv.includes("--contact-sheet");

/** "gloss.webp.png" -> "gloss".  Strips EVERY trailing extension, not one. */
function slugOf(filename) {
  let base = filename;
  while (/\.[A-Za-z0-9]{2,5}$/.test(base)) base = base.replace(/\.[A-Za-z0-9]{2,5}$/, "");
  return base;
}

/**
 * Everything in the folder that is not already a finished output.
 *
 * Deliberately reads the DIRECTORY rather than carrying a list of slugs: eight
 * products still have no art, and the whole point of this script is that they
 * are a re-run and not an edit.
 */
async function findSources() {
  const names = await readdir(DIR);
  const out = [];
  for (const name of names) {
    const full = path.join(DIR, name);
    const st = await stat(full);
    if (!st.isFile()) continue;
    const slug = slugOf(name);
    if (name === `${slug}.webp`) continue;          // already an output
    out.push({ name, full, slug, out: path.join(DIR, `${slug}.webp`), mtime: st.mtimeMs, bytes: st.size });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Encode at the best quality that fits the budget; never below the floor. */
async function encode(pipeline) {
  let last = null;
  for (const quality of QUALITY_STEPS) {
    const buf = await pipeline.clone().webp({ quality, effort: 6 }).toBuffer();
    last = { buf, quality };
    if (buf.length <= TARGET_BYTES) break;
  }
  return last;
}

async function convertOne(src) {
  const input = await readFile(src.full);
  const before = await sharp(input).metadata();

  // 1. TRIM to the tin. sharp compares against the border colour it finds, so
  //    a white studio background collapses to the product's own bounding box.
  //    A generous threshold copes with JPEG ringing and off-white paper.
  let trimmed, tin;
  try {
    trimmed = await sharp(input).flatten({ background: WHITE })
      .trim({ background: "#ffffff", threshold: 12 }).toBuffer();
    tin = await sharp(trimmed).metadata();
  } catch {
    trimmed = null;
  }
  // An image with no white border at all trims to nothing. Keep the original
  // rather than emitting an empty tile.
  if (!trimmed || !tin?.width || !tin?.height || tin.width < 16 || tin.height < 16) {
    trimmed = await sharp(input).flatten({ background: WHITE }).toBuffer();
    tin = await sharp(trimmed).metadata();
  }

  // 2. SIZE THE SQUARE so the tin occupies TIN_SHARE of it, capped at CANVAS
  //    and never larger than the source can fill. That cap is the whole
  //    no-upscale rule: a 160px source simply gets a smaller square, and its
  //    tin still takes up the same share of it as a 1500px source's does.
  const longest = Math.max(tin.width, tin.height);
  const canvas = Math.min(CANVAS, Math.round(longest / TIN_SHARE));
  const box = Math.round(canvas * TIN_SHARE);
  const upscaleAvoided = canvas < CANVAS;

  // 3. FIT the tin inside that box, then pad back out to the full square.
  const fitted = await sharp(trimmed)
    .resize({ width: box, height: box, fit: "inside", withoutEnlargement: true,
              background: WHITE, kernel: "lanczos3" })
    .toBuffer();
  const f = await sharp(fitted).metadata();
  const padX = canvas - f.width, padY = canvas - f.height;
  const squared = sharp(fitted).extend({
    top: Math.floor(padY / 2), bottom: Math.ceil(padY / 2),
    left: Math.floor(padX / 2), right: Math.ceil(padX / 2),
    background: WHITE,
  }).flatten({ background: WHITE });

  const { buf, quality } = await encode(squared);
  await writeFile(src.out, buf);

  // 4. VERIFY THE OUTPUT BEFORE ANYONE TRUSTS IT. Re-open from disk — an
  //    encode that silently produced nothing must not be reported as a success.
  const check = await sharp(await readFile(src.out)).metadata();
  if (!check.width || !check.height || check.format !== "webp") {
    throw new Error(`output did not re-open as webp: ${src.out}`);
  }
  const onDisk = (await stat(src.out)).size;
  if (onDisk === 0) throw new Error(`output is zero bytes: ${src.out}`);

  return {
    slug: src.slug, source: src.name,
    srcFormat: before.format, srcW: before.width, srcH: before.height, srcBytes: src.bytes,
    tinW: tin.width, tinH: tin.height,
    outW: check.width, outH: check.height, outBytes: onDisk,
    quality, upscaleAvoided,
  };
}

// ── the contact sheet ──────────────────────────────────────────────────────
// The one check a table of byte counts cannot make: are the tins actually the
// same size as each other? Rendered 4-across at roughly the device pixel size
// the board uses, a tin that came out big or small is obvious at a glance.
async function contactSheet(results) {
  const CELL = 168, GAP = 10, LABEL = 26, COLS = 4, PAD = 20;
  const rows = Math.ceil(results.length / COLS);
  const W = PAD * 2 + COLS * CELL + (COLS - 1) * GAP;
  const H = PAD * 2 + rows * (CELL + LABEL) + (rows - 1) * GAP;

  const layers = [];
  for (const [i, r] of results.entries()) {
    const c = i % COLS, row = Math.floor(i / COLS);
    const x = PAD + c * (CELL + GAP);
    const y = PAD + row * (CELL + LABEL + GAP);
    layers.push({
      input: await sharp(path.join(DIR, `${r.slug}.webp`))
        .resize(CELL, CELL, { fit: "contain", background: WHITE }).png().toBuffer(),
      left: x, top: y,
    });
    const caption = `${r.slug}  ${r.outW}px  ${(r.outBytes / 1024).toFixed(0)}KB`;
    layers.push({
      input: Buffer.from(
        `<svg width="${CELL}" height="${LABEL}" xmlns="http://www.w3.org/2000/svg">` +
        `<text x="${CELL / 2}" y="16" font-family="Segoe UI, Arial, sans-serif" font-size="11"` +
        ` fill="#3A3646" text-anchor="middle">${caption}</text></svg>`),
      left: x, top: y + CELL,
    });
    // A hairline round each cell, so an off-centre or oversized tin reads
    // against a frame instead of against nothing.
    layers.push({
      input: Buffer.from(
        `<svg width="${CELL}" height="${CELL}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect x="0.5" y="0.5" width="${CELL - 1}" height="${CELL - 1}" fill="none" stroke="#E4E2E9"/></svg>`),
      left: x, top: y,
    });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: WHITE } })
    .composite(layers).png().toFile(SHEET);
  return { path: SHEET, W, H };
}

// ── run ────────────────────────────────────────────────────────────────────
const sources = await findSources();
if (sources.length === 0) console.log("No source files found in " + DIR);

const done = [], skipped = [], failed = [];
for (const src of sources) {
  // Idempotent: an output newer than its source is already correct. New art in
  // the folder converts; everything else is left exactly as it is.
  let fresh = false;
  try {
    const o = await stat(src.out);
    fresh = o.mtimeMs >= src.mtime && o.size > 0;
  } catch { /* no output yet */ }
  if (fresh && !force) { skipped.push(src); continue; }

  // 🔴 ONE BAD FILE MUST NOT TAKE THE RUN DOWN. A corrupt source is reported
  // by name and the other twenty-three still convert.
  try {
    done.push(await convertOne(src));
  } catch (err) {
    failed.push({ slug: src.slug, source: src.name, message: err.message });
    console.error(`  FAILED  ${src.name}: ${err.message}`);
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log("");
console.log("slug              source                        src fmt  src px      src KB   out px      out KB   q    no-upscale");
for (const r of done.sort((a, b) => a.slug.localeCompare(b.slug))) {
  console.log("  " + pad(r.slug, 18) + pad(r.source, 30) + pad(r.srcFormat, 9) +
    pad(`${r.srcW}x${r.srcH}`, 12) + pad((r.srcBytes / 1024).toFixed(1), 9) +
    pad(`${r.outW}x${r.outH}`, 12) + pad((r.outBytes / 1024).toFixed(1), 9) +
    pad(r.quality, 5) + (r.upscaleAvoided ? "YES" : "no"));
}
if (skipped.length) console.log("\n  skipped (output already newer than source): " +
  skipped.map((s) => s.slug).join(", "));
if (failed.length) console.log("\n  FAILED: " + failed.map((f) => `${f.slug} (${f.message})`).join("; "));

const loud = done.filter((r) => r.outBytes > LOUD_BYTES);
if (loud.length) console.log("\n  ABOVE " + LOUD_BYTES / 1024 + " KB even at the lowest quality step: " +
  loud.map((r) => `${r.slug} ${(r.outBytes / 1024).toFixed(1)}KB`).join(", "));

if (wantSheet && done.length + skipped.length > 0) {
  const all = await findSources();
  const sheetRows = [];
  for (const s of all) {
    try {
      const m = await sharp(s.out).metadata();
      const st = await stat(s.out);
      sheetRows.push({ slug: s.slug, outW: m.width, outH: m.height, outBytes: st.size });
    } catch { /* no output for this source */ }
  }
  const sheet = await contactSheet(sheetRows.sort((a, b) => a.slug.localeCompare(b.slug)));
  console.log(`\n  contact sheet: ${sheet.path}  (${sheet.W}x${sheet.H})`);
}

console.log(`\n  ${done.length} converted, ${skipped.length} skipped, ${failed.length} failed.`);
console.log("  Sources are NOT deleted by this script. Remove them by hand once the");
console.log("  contact sheet has been looked at.");
