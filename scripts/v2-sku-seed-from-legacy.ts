// v2 SKU lookup seed — wipes mo_sku_lookup_v2 and inserts a translated copy
// of every legacy mo_sku_lookup row by driving each legacy
// (category, product, baseColour) tuple through
// lib/mail-orders/taxonomy-mapping.ts mapLegacyToNew().
//
// Per locked decisions in this prompt:
//   - First v2 row from each legacy row keeps the original `material` value.
//   - 2nd/3rd v2 rows (cross-listed Promise primers, etc.) get a synthetic
//     suffix: `${material}-${family.replace(/\s+/g, '_')}`.
//   - Hidden families (AUTO/DUCO/M900/SPRAY PAINT/5IN1/TOOLS) and 4 single-
//     row orphans skip when mapLegacyToNew returns null.
//   - newRow.baseColour ?? legacy.baseColour — fall back to legacy when v2
//     translator returns null (PLAIN sub-products with no colour variant).
//   - product = newRow.subProduct, category = newRow.family.
//   - Other columns unchanged from legacy (description, packCode, unit, …).
//
// Per CLAUDE_CORE.md §3:
//   - sequential awaits, no prisma.$transaction([...])
//   - no prisma db push / no prisma migrate (table created via Supabase
//     SQL Editor with scripts/v2-sku-create-table.sql)
//
// Run with: npx tsx scripts/v2-sku-seed-from-legacy.ts
//
// Idempotent on re-run: deleteMany({}) on empty table is a no-op.

import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { mapLegacyToNew, type LegacyKey } from "@/lib/mail-orders/taxonomy-mapping";
import nameOverridesJson from "./data/sku-name-overrides.json";

// DATABASE_URL (transaction pooler, port 6543) — depot network blocks direct port 5432 connections per CLAUDE_CORE.md §3.
const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set in environment.");
}
const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
  log: ["error"],
});

const BATCH_SIZE = 100;
// Mirror v2-catalog-seed-from-preview.ts: DRY_RUN=1 computes everything and
// prints a projected summary, then returns BEFORE the unconditional wipe —
// no deletes, no inserts.
const DRY_RUN    = process.env.DRY_RUN === "1";

// ── WS Max durable cleanup (2026-06-01) ─────────────────────────────────
// mo_sku_lookup_v2 regenerates from legacy on every reseed, so these
// removals + the isPrimary flags MUST live here (CORE durable-source rule),
// not as DB-only edits. Match on the TRANSLATED v2 baseColour so it aligns
// with the menu's base names.
// Post-override base set (see NAME_OVERRIDES). The 4 removed WS Max bases as
// they appear in the LIVE names; "YELLOW BASE" is intentionally absent — its
// single legacy row is corrected to "YELLOW OXIDE" by the override, so the
// YELLOW OXIDE entry covers it.
const EXCLUDE_BASE_WSMAX = new Set<string>([
  "PASTEL BASE", "YELLOW OXIDE", "ROX", "RED OXIDE",
]);
const EXCLUDE_MATERIALS = new Set<string>(["IN46350082"]);

// ── Per-material name override (May-13 renames, baked durable 2026-06-01) ─
// mapLegacyToNew emits the flat pre-May-13 names (e.g. MAX, PROTECT, GLOSS);
// the live catalogue's correct names (WS MAX, GVA, ROOF COAT WHITE, …) were
// set by manual SQL never put in the seed. This snapshot (411 materials,
// keyed on the stable SAP `material`) reproduces the live names EXACTLY on
// every reseed, so a wipe-and-reseed no longer breaks the pack join. Keyed
// on material because some recipe names split into several live products
// (PROTECT → WS PROTECT / WS PROTECT DUSTPROOF / WS PROTECT CLEAR).
const NAME_OVERRIDES = nameOverridesJson as Record<
  string,
  { product: string; category: string; baseColour: string }
>;

// Durable isPrimary home. The table default is `true` and the seed re-inserts
// every row, so the May-30 dedup (130 twins → false) + the 94 BASE 3.6L
// alternate (IN46359471) are re-applied on each reseed from this set.
// Snapshot of the live isPrimary=false set (130) captured 2026-06-01, plus
// IN46359471. Entries that belong to excluded rows are harmless (never inserted).
const SET_FALSE = new Set<string>([
  "5554795", "5554798", "5554802", "5554803", "5554804", "5554805", "5554816",
  "5577377-PROMISE", "5577380-PROMISE", "5577383-PROMISE", "5577386-PROMISE",
  "5580410-PROMISE", "5580412-PROMISE", "5769799", "5771981", "5771985",
  "5771989", "5771990", "5771991", "5771992", "5771993", "5771994", "5771995",
  "5771996", "5771998", "5772002", "5772004", "5772006", "5772007", "5772008",
  "5772017", "5772018", "5772019", "5802250", "5834786", "5834787", "5834798",
  "5834799", "5834800", "5834802", "5834804", "5834827", "5838853-PROMISE",
  "5838854-PROMISE", "5838855-PROMISE", "5838857-PROMISE", "5838858-PROMISE",
  "5838859-PROMISE", "5838860-PROMISE", "5838861-PROMISE", "5838862-PROMISE",
  "5838863-PROMISE", "5838865-PROMISE", "5838872-PROMISE", "5838873-PROMISE",
  "5838874-PROMISE", "5838875-PROMISE", "5838876-PROMISE", "5838877-PROMISE",
  "5838878-PROMISE", "5838879-PROMISE", "5838880-PROMISE", "5838881-PROMISE",
  "5838882-PROMISE", "5838883-PROMISE", "5838885-PROMISE", "5838886-PROMISE",
  "5838887-PROMISE", "5851766", "5853599", "5853599-PROMISE", "5853600-PROMISE",
  "5853604-PROMISE", "5853606", "5853606-PROMISE", "5853607-PROMISE",
  "5867110-PROMISE", "5867111-PROMISE", "5867112-PROMISE", "5867113-PROMISE",
  "5867117-PROMISE", "5867141-PROMISE", "5867142-PROMISE", "5867143-PROMISE",
  "5915413", "5994750-PROMISE_INTERIOR", "5994751-PROMISE_INTERIOR",
  "5994752-PROMISE_INTERIOR", "5994753-PROMISE_INTERIOR", "IN23820023",
  "IN23820081", "IN23820082", "IN23829023", "IN23829071", "IN23829223",
  "IN28085071", "IN28085072", "IN28085081", "IN28085082", "IN30700023",
  "IN30709223", "IN32076823", "IN32316823", "IN32600072", "IN46309872",
  "IN46350049", "IN46350071", "IN46350072", "IN46350082", "IN46359071",
  "IN46359072", "IN46359223", "IN46359271", "IN46359281", "IN46359282",
  "IN46359582", "IN46359671", "IN46359771", "IN46359772", "IN46359781",
  "IN46359782", "IN46359871", "IN46359881", "IN46359882", "IN55009071",
  "IN55009072", "IN84500023-PROMISE", "IN84500023-PROMISE_INTERIOR",
  "IN84500072", "IN84500072-PROMISE_INTERIOR",
  // 94 BASE 3.6L alternate — hide so only the real 4L (5948221) shows.
  "IN46359471",
  // 94/95 BASE leftover fractional twins still rendering on mobile (each has
  // a primary standard-bucket sibling that stays): 94 0.9L, 95 0.9L/3.6L/18L.
  "IN46359423", "IN46359572", "IN46359571", "IN46359581",
]);

// ── CSV-as-source for the 3 WS targets (2026-06-01) ─────────────────────
// The reviewed CSVs in docs/SKU/review/ are the authoritative PRODUCT
// MEMBERSHIP + KEEP/HIDE for these products. Keyed on `material` (unique);
// baseColour / packCode / unit / description / category still come from the
// legacy→v2 translation (authoritative) — so the multi-base collision
// listings auto-collapse and the "Brillant White" typo is irrelevant. A
// material a CSV references but legacy never produces cannot be built —
// collected + reported (rule 5), never fabricated.
const CSV_TARGETS: Array<{ file: string; product: string }> = [
  { file: path.join("docs", "SKU", "review", "ws-Protect_Dustproof-review.csv"), product: "WS PROTECT DUSTPROOF" },
  { file: path.join("docs", "SKU", "review", "ws-Protect_Rainproof-review.csv"), product: "WS PROTECT RAINPROOF" },
  { file: path.join("docs", "SKU", "review", "ws-PowerFlexx-review.csv"),        product: "WS POWERFLEXX" },
];

// Group-B leftovers — DELETE (exclude, never regenerate). The wrong plain
// "WS PROTECT" product is removed entirely: 13 of its materials fold into the
// Dustproof CSV (→ hidden), 10 colours are re-homed via the Dustproof CSV
// (→ KEEP), and these 9 are dropped here → 0 "WS PROTECT" rows remain.
const PROTECT_DELETE = new Set<string>([
  "IN36209274", "IN36209474", "IN36309723", "IN36309771", "IN36209772",
  "IN36309881", "IN36309672", "IN36309671", "IN36309682",
]);

// Powerflexx leftover present only in live (no CSV row) — drop it.
const POWERFLEXX_DROP = new Set<string>(["IN76109271"]);

// KEEP materials with NO legacy source — build the v2 row from the CSV
// instead of skipping (rule: KEEP-only; HIDE-missing stay absent).
const BUILD_FROM_CSV = new Set<string>([
  "IN36409923", // Dustproof 99 BASE 1L
  "IN36409971", // Dustproof 99 BASE 4L
  "5880419",    // Dustproof 95 BASE 1L
  "5769796",    // Powerflexx 93 BASE 4L
]);

// CSV columns: 0 Base · 1 Pack(on screen) · 2 SAP size · 3 material ·
// 4 on-screen · 5 Decision · 6 Notes · 7 isPrimary · 8 SKU Description.
// `pack` (nominal, every row) drives sibling lookup for build-from-CSV;
// base/desc are captured from the KEEP row (the authoritative shown row).
type CsvProductEntry = {
  product: string; isPrimary: boolean; products: Set<string>;
  pack: string; base: string; desc: string;
};

async function loadCsvProductMap(): Promise<Map<string, CsvProductEntry>> {
  const map = new Map<string, CsvProductEntry>();
  for (const t of CSV_TARGETS) {
    const raw = await fs.readFile(t.file, "utf8");
    for (const line of raw.split(/\r?\n/).slice(1)) {
      if (!line.trim()) continue;
      const c = line.split(",");
      const material = (c[3] ?? "").trim();        // SAP code column
      if (!material) continue;
      const keep = (c[5] ?? "").trim().toUpperCase() === "KEEP";  // Decision column
      let e = map.get(material);
      if (!e) { e = { product: t.product, isPrimary: false, products: new Set(), pack: (c[1] ?? "").trim(), base: (c[0] ?? "").trim(), desc: (c[8] ?? "").trim() }; map.set(material, e); }
      e.products.add(t.product);
      if (keep) { e.isPrimary = true; e.base = (c[0] ?? "").trim(); e.pack = (c[1] ?? "").trim(); e.desc = (c[8] ?? "").trim(); }
    }
  }
  return map;
}

// Shape of one row to be inserted into mo_sku_lookup_v2.
type V2Row = {
  material:        string;
  description:     string;
  category:        string;
  product:         string;
  baseColour:      string;
  packCode:        string;
  unit:            string | null;
  refMaterial:     string | null;
  refDescription:  string | null;
  paintType:       string | null;
  materialType:    string | null;
  piecesPerCarton: number | null;
  isPrimary:       boolean;
};

function familySuffix(family: string): string {
  return family.replace(/\s+/g, "_");
}

async function main(): Promise<void> {
  /* eslint-disable no-console */

  // ── 1. Read legacy SKU rows ─────────────────────────────────────────
  const legacyRows = await prisma.mo_sku_lookup.findMany({
    select: {
      material:        true,
      description:     true,
      category:        true,
      product:         true,
      baseColour:      true,
      packCode:        true,
      unit:            true,
      refMaterial:     true,
      refDescription:  true,
      paintType:       true,
      materialType:    true,
      piecesPerCarton: true,
    },
  });
  console.log(`Legacy SKU rows read: ${legacyRows.length}`);

  // CSV-as-source product membership for the 3 WS targets.
  const csvProduct = await loadCsvProductMap();
  console.log(`CSV product map: ${csvProduct.size} distinct materials across 3 target CSVs`);

  // ── 2. Translate each legacy row via mapLegacyToNew ─────────────────
  let skippedNull = 0;
  let crossListed = 0;  // source rows producing >1 v2 row
  let excludedByBase = 0;      // WS Max removed bases
  let excludedByMaterial = 0;  // stray material removals (EXCLUDE_MATERIALS + PROTECT_DELETE)
  let overridden = 0;          // rows whose names came from NAME_OVERRIDES
  let csvAssigned = 0;         // rows whose product came from a target CSV
  const seenMaterials = new Set<string>();  // every material legacy produced (for rule-5 report)
  const v2Rows: V2Row[] = [];

  for (const legacy of legacyRows) {
    const key: LegacyKey = {
      category:   legacy.category,
      product:    legacy.product,
      baseColour: legacy.baseColour,
    };
    const newRows = mapLegacyToNew(key);
    if (newRows === null) {
      skippedNull++;
      continue;
    }
    if (newRows.length > 1) crossListed++;

    for (let i = 0; i < newRows.length; i++) {
      const newRow = newRows[i];
      const material =
        i === 0
          ? legacy.material
          : `${legacy.material}-${familySuffix(newRow.family)}`;
      seenMaterials.add(material);

      // ── Name override (May-13 renames) — applied BEFORE exclusions so
      //    both the exclusions and the inserted rows use the LIVE names. ──
      const ov = NAME_OVERRIDES[material];
      if (ov) overridden++;
      const category   = ov ? ov.category   : newRow.family;
      const ovProduct  = ov ? ov.product    : newRow.subProduct;
      const baseColour = ov ? ov.baseColour : (newRow.baseColour ?? legacy.baseColour);

      // ── CSV-as-source: product membership for the 3 WS targets wins over
      //    the override product. baseColour/category stay from legacy/override.
      const csv = csvProduct.get(material);
      const product = csv ? csv.product : ovProduct;
      if (csv) csvAssigned++;

      // ── Exclusions (post-override keys, 2026-06-01) ──
      //   EXCLUDE_MATERIALS + PROTECT_DELETE (9 group-B) + POWERFLEXX_DROP (IN76109271).
      if (EXCLUDE_MATERIALS.has(material) || PROTECT_DELETE.has(material) || POWERFLEXX_DROP.has(material)) { excludedByMaterial++; continue; }
      if (
        product === "WS MAX" &&
        EXCLUDE_BASE_WSMAX.has((baseColour ?? "").trim().toUpperCase())
      ) { excludedByBase++; continue; }

      v2Rows.push({
        material,
        description:     legacy.description,
        category,
        product,
        baseColour,
        packCode:        legacy.packCode,
        unit:            legacy.unit,
        refMaterial:     legacy.refMaterial,
        refDescription:  legacy.refDescription,
        paintType:       legacy.paintType,
        materialType:    legacy.materialType,
        piecesPerCarton: legacy.piecesPerCarton,
        // CSV KEEP/HIDE wins for target rows; else the existing SET_FALSE rule.
        isPrimary:       csv ? csv.isPrimary : (SET_FALSE.has(material) ? false : true),
      });
    }
  }

  // ── 2b. Build-from-CSV: KEEP materials with NO legacy source ────────
  // Construct the v2 row from CSV fields; copy packCode/unit/category from a
  // sibling of the SAME product + SAME nominal pack so it buckets correctly
  // (exact-match: we copy a real sibling's packCode verbatim — no rounding).
  // KEEP-only — HIDE-missing materials stay absent.
  type BuiltInfo = { material: string; product: string; baseColour: string; packCode: string; unit: string | null; category: string; sibling: string };
  const builtMaterials = new Set<string>();
  const builtRows: BuiltInfo[] = [];
  for (const m of Array.from(BUILD_FROM_CSV)) {
    if (seenMaterials.has(m)) continue;             // produced by legacy after all
    const e = csvProduct.get(m);
    if (!e || !e.isPrimary) continue;               // build only CSV KEEP materials
    const sibling = v2Rows.find((r) => r.product === e.product && csvProduct.get(r.material)?.pack === e.pack);
    if (!sibling) { console.log(`[build] NO SIBLING for ${m} (${e.product} pack "${e.pack}") — cannot build`); continue; }
    v2Rows.push({
      material:        m,
      description:     e.desc,
      category:        sibling.category,
      product:         e.product,
      baseColour:      e.base,
      packCode:        sibling.packCode,
      unit:            sibling.unit,
      refMaterial:     null,
      refDescription:  null,
      paintType:       null,
      materialType:    null,
      piecesPerCarton: null,
      isPrimary:       true,
    });
    builtMaterials.add(m);
    builtRows.push({ material: m, product: e.product, baseColour: e.base, packCode: sibling.packCode, unit: sibling.unit, category: sibling.category, sibling: sibling.material });
  }
  console.log(`Built-from-CSV rows (KEEP, no legacy)   : ${builtRows.length}`);

  console.log(`Skipped (mapLegacyToNew → null)         : ${skippedNull}`);
  console.log(`Source rows expanded into multiple v2  : ${crossListed}`);
  console.log(`Name-override rows (live names applied) : ${overridden}`);
  console.log(`Excluded — WS Max removed bases         : ${excludedByBase}`);
  console.log(`Excluded — stray material list          : ${excludedByMaterial}`);
  console.log(`v2 rows after translation              : ${v2Rows.length}`);
  console.log(`isPrimary=false rows (SET_FALSE applied): ${v2Rows.filter((r) => !r.isPrimary).length}`);
  console.log(`CSV-assigned rows (product from CSV)    : ${csvAssigned}`);

  // Rule 5: CSV materials with no legacy source AND not built-from-CSV.
  // HIDE-missing are expected (already absent = hidden); KEEP-missing should be 0
  // after build-from-CSV.
  const csvMissing     = Array.from(csvProduct.keys()).filter((m) => !seenMaterials.has(m) && !builtMaterials.has(m) && !PROTECT_DELETE.has(m) && !POWERFLEXX_DROP.has(m));
  const csvMissingKeep = csvMissing.filter((m) => csvProduct.get(m)!.isPrimary);
  const csvMultiProduct = Array.from(csvProduct.entries()).filter(([, e]) => e.products.size > 1);
  console.log(`CSV materials with NO legacy source     : ${csvMissing.length} (KEEP=${csvMissingKeep.length}, HIDE=${csvMissing.length - csvMissingKeep.length})`);
  console.log(`CSV materials in >1 target CSV          : ${csvMultiProduct.length}`);

  // ── 3. Dedup on (material, category, product, baseColour, packCode) ─
  // Defensive — the suffix scheme makes material globally unique per
  // (legacy.material, family), so duplicates here would indicate a
  // translator quirk worth surfacing.
  const seen    = new Set<string>();
  const deduped: V2Row[] = [];
  let   dropped = 0;
  for (const row of v2Rows) {
    const key = `${row.material}|||${row.category}|||${row.product}|||${row.baseColour}|||${row.packCode}`;
    if (seen.has(key)) {
      dropped++;
      console.log(`[dedup] ${row.material} | ${row.category} | ${row.product} | ${row.baseColour} | ${row.packCode} (kept first)`);
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  console.log(`v2 rows after dedup                    : ${deduped.length} (dropped ${dropped})`);

  // ── 3.5. DRY-RUN exit — projected summary, NO wipe / NO insert ──────
  // Mirrors the MENU seed (v2-catalog-seed-from-preview.ts): everything is
  // computed above; here we print the projection and RETURN *before* the
  // unconditional wipe + insert below. DRY_RUN=1 → zero DB writes.
  if (DRY_RUN) {
    const falseCount = deduped.filter((r) => !r.isPrimary).length;
    const wsMax      = deduped.filter((r) => r.product === "WS MAX");
    const wsBases    = Array.from(new Set(wsMax.map((r) => r.baseColour))).sort();
    const flip       = deduped.find((r) => r.material === "IN46359471");
    const stray      = deduped.find((r) => r.material === "IN46350082");
    console.log("");
    console.log("════════════════ SKU DRY-RUN SUMMARY ════════════════");
    console.log(`Legacy rows read              : ${legacyRows.length}`);
    console.log(`Skipped (mapLegacyToNew null) : ${skippedNull}`);
    console.log(`Excluded — WS Max bases       : ${excludedByBase}`);
    console.log(`Excluded — stray material     : ${excludedByMaterial} (IN46350082)`);
    console.log(`Excluded — total              : ${excludedByBase + excludedByMaterial}`);
    console.log(`Rows that WOULD be inserted   : ${deduped.length}`);
    console.log(`isPrimary=false (projected)   : ${falseCount}`);
    console.log("");
    console.log(`WS MAX bases kept (${wsBases.length}): ${wsBases.join(", ")}`);
    console.log(`IN46359471 (94 BASE 3.6L)     : ${flip ? `present, isPrimary=${flip.isPrimary}` : "ABSENT"} (expect: present, false)`);
    console.log(`IN46350082 (BW 10L stray)     : ${stray ? "STILL PRESENT (unexpected!)" : "excluded ✓"}`);

    // ── WS RESTRUCTURE REHEARSAL (before vs after) ──────────────────
    const liveRows = await prisma.mo_sku_lookup_v2.findMany({ select: { product: true, isPrimary: true, material: true } });
    const agg = (rows: { product: string; isPrimary: boolean }[], prod: string) => {
      const r = rows.filter((x) => x.product === prod);
      return { n: r.length, pri: r.filter((x) => x.isPrimary).length };
    };
    const TARGETS = ["WS PROTECT DUSTPROOF", "WS PROTECT RAINPROOF", "WS POWERFLEXX", "WS PROTECT HI-SHEEN"];
    console.log("");
    console.log("════════════ WS RESTRUCTURE REHEARSAL (before → after) ════════════");
    for (const t of TARGETS) {
      const b = agg(liveRows, t); const a = agg(deduped, t);
      console.log(`  ${t.padEnd(22)} before n=${b.n} (pri ${b.pri}/hid ${b.n - b.pri})  ->  after n=${a.n} (pri ${a.pri}/hid ${a.n - a.pri})`);
    }
    console.log(`  ${"WS PROTECT (plain WRONG)".padEnd(22)} before n=${agg(liveRows, "WS PROTECT").n}  ->  after n=${agg(deduped, "WS PROTECT").n}  (expect 0)`);
    console.log(`  ${"WS PROTECT CLEAR".padEnd(22)} before n=${agg(liveRows, "WS PROTECT CLEAR").n}  ->  after n=${agg(deduped, "WS PROTECT CLEAR").n}  (untouched)`);
    const COLOURS = ["5819365", "5819366", "5819257", "5819358", "5819369", "5819370", "5819361", "5819362", "5819373", "5819374"];
    const colourRows = deduped.filter((r) => COLOURS.includes(r.material));
    const colourOk = colourRows.filter((r) => r.product === "WS PROTECT DUSTPROOF" && r.isPrimary).length;
    console.log(`  Re-homed colours → DUSTPROOF primary: ${colourOk}/10 (present ${colourRows.length}/10)`);
    const bPresent = deduped.filter((r) => PROTECT_DELETE.has(r.material)).length;
    console.log(`  Group-B (9 deletes) present after: ${bPresent} (expect 0)`);
    const pf = deduped.find((r) => r.material === "IN76109271");
    console.log(`  IN76109271 (Powerflexx, only-in-live): ${pf ? `PRESENT product=${pf.product} isPrimary=${pf.isPrimary}` : "DROPPED"}`);
    console.log(`  Rule-5 CSV materials with no legacy source: ${csvMissing.length} (KEEP=${csvMissingKeep.length}, expect KEEP=0)`);
    if (csvMissingKeep.length) console.log(`     KEEP-but-missing: ${csvMissingKeep.join(", ")}`);
    console.log(`  Built-from-CSV (${builtRows.length}):`);
    for (const b of builtRows) console.log(`     ${b.material} -> ${b.product} | ${b.baseColour} | packCode=${b.packCode}${b.unit ?? ""} | cat=${b.category} | sibling=${b.sibling}`);
    const has = (mat: string) => { const r = deduped.find((x) => x.material === mat); return r ? `present (product=${r.product}, base=${r.baseColour}, primary=${r.isPrimary})` : "ABSENT"; };
    const vred = deduped.filter((r) => r.product === "WS PROTECT DUSTPROOF" && r.baseColour === "99 BASE");
    console.log(`  99 BASE (Vibrant Red) under DUSTPROOF: ${vred.length} rows, primary ${vred.filter((r) => r.isPrimary).length}`);
    console.log(`  5880419 (Dustproof 95 BASE 1L): ${has("5880419")}`);
    console.log(`  5769796 (Powerflexx 93 BASE 4L): ${has("5769796")}`);

    // Dustproof per-base primary breakdown + the 4 rescued 93-Base SKUs.
    const dp = deduped.filter((r) => r.product === "WS PROTECT DUSTPROOF");
    const byBase = new Map<string, { n: number; pri: number }>();
    for (const r of dp) {
      const e = byBase.get(r.baseColour) ?? { n: 0, pri: 0 };
      e.n++; if (r.isPrimary) e.pri++; byBase.set(r.baseColour, e);
    }
    console.log(`  DUSTPROOF per-base (base: primary/total):`);
    for (const b of Array.from(byBase.keys()).sort()) {
      const e = byBase.get(b)!;
      console.log(`     ${b.padEnd(20)} ${e.pri}/${e.n}`);
    }
    const RESCUE93 = ["5880417", "5880390", "5880393", "5880392"];
    console.log(`  Rescued 93-Base SKUs:`);
    for (const m of RESCUE93) console.log(`     ${m}: ${has(m)}`);
    const maxB = agg(liveRows, "WS MAX"); const maxA = agg(deduped, "WS MAX");
    console.log(`  Total rows: before ${liveRows.length}  ->  after ${deduped.length}`);
    console.log(`  WS MAX: before n=${maxB.n}  ->  after n=${maxA.n}  (expect steady)`);

    console.log("");
    console.log("DRY_RUN=1 — NO wipe, NO insert performed.");
    return;
  }

  // ── 4. Wipe v2 SKU table ────────────────────────────────────────────
  const wipeResult = await prisma.mo_sku_lookup_v2.deleteMany({});
  console.log(`Rows wiped from mo_sku_lookup_v2       : ${wipeResult.count}`);

  // ── 5. Insert in batches of 100 via createMany ──────────────────────
  // Sequential awaits — no prisma.$transaction array.
  let inserted = 0;
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const slice  = deduped.slice(i, i + BATCH_SIZE);
    const result = await prisma.mo_sku_lookup_v2.createMany({
      data:           slice,
      skipDuplicates: false,
    });
    inserted += result.count;
    console.log(`  batch ${Math.floor(i / BATCH_SIZE) + 1} inserted ${result.count} rows (running total: ${inserted})`);
  }

  // ── 6. Verification ─────────────────────────────────────────────────
  const finalCount = await prisma.mo_sku_lookup_v2.count();
  const matches    = finalCount === inserted;

  const byFamily = await prisma.mo_sku_lookup_v2.groupBy({
    by:      ["category"],
    _count:  { _all: true },
    orderBy: { category: "asc" },
  });

  const stainerByProduct = await prisma.mo_sku_lookup_v2.groupBy({
    by:      ["product"],
    where:   { category: "STAINER" },
    _count:  { _all: true },
    orderBy: { product: "asc" },
  });

  console.log("\n─── v2 SKU seed result ───");
  console.log(`Legacy rows read       : ${legacyRows.length}`);
  console.log(`Skipped (null)         : ${skippedNull}`);
  console.log(`Source rows cross-listed: ${crossListed}`);
  console.log(`v2 rows after translate: ${v2Rows.length}`);
  console.log(`v2 rows after dedup    : ${deduped.length}`);
  console.log(`Rows inserted          : ${inserted}`);
  console.log(`Verification count     : ${finalCount} (matches inserted: ${matches ? "✓" : "✗"})`);
  console.log(`Families produced      : ${byFamily.length}`);

  console.log("\n─── Family → row count breakdown ───");
  for (const f of byFamily) {
    console.log(`  ${f.category.padEnd(24)} ${f._count._all}`);
  }

  console.log("\n─── STAINER family product breakdown (structural shape check) ───");
  if (stainerByProduct.length === 0) {
    console.log("  (no STAINER rows)");
  } else {
    for (const p of stainerByProduct) {
      console.log(`  ${p.product.padEnd(24)} ${p._count._all}`);
    }
  }

  // Sample translation checks — confirm the translator routed legacy SKUs
  // to the expected v2 (family, subProduct).
  console.log("\n─── Translation samples ───");
  const samples: Array<[string, string]> = [
    ["LUXURIO", "MATT"],
    ["LUXURIO", "GLOSS"],
    ["2K PU",   "MATT"],
    ["DISTEMPER", "MAGIK"],
  ];
  for (const [family, subProduct] of samples) {
    const rows = await prisma.mo_sku_lookup_v2.findMany({
      where: { category: family, product: subProduct },
      select: {
        material:    true,
        description: true,
        baseColour:  true,
        packCode:    true,
      },
      take:    5,
      orderBy: { material: "asc" },
    });
    console.log(`\n  ${family} / ${subProduct} (sample of ${rows.length}):`);
    if (rows.length === 0) {
      console.log("    (no rows)");
    } else {
      for (const r of rows) {
        console.log(`    ${r.material.padEnd(20)} ${r.baseColour.padEnd(20)} pack=${r.packCode.padEnd(6)} ${r.description.slice(0, 50)}`);
      }
    }
  }

  if (!matches) {
    throw new Error(
      `Verification failed: count() returned ${finalCount} but ${inserted} rows were inserted.`,
    );
  }

  /* eslint-enable no-console */
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("✗ v2 SKU seed failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
