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
]);

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

  // ── 2. Translate each legacy row via mapLegacyToNew ─────────────────
  let skippedNull = 0;
  let crossListed = 0;  // source rows producing >1 v2 row
  let excludedByBase = 0;      // WS Max removed bases
  let excludedByMaterial = 0;  // stray material removals
  let overridden = 0;          // rows whose names came from NAME_OVERRIDES
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

      // ── Name override (May-13 renames) — applied BEFORE exclusions so
      //    both the exclusions and the inserted rows use the LIVE names. ──
      const ov = NAME_OVERRIDES[material];
      if (ov) overridden++;
      const category   = ov ? ov.category   : newRow.family;
      const product    = ov ? ov.product    : newRow.subProduct;
      const baseColour = ov ? ov.baseColour : (newRow.baseColour ?? legacy.baseColour);

      // ── WS Max durable exclusions (post-override keys, 2026-06-01) ──
      if (EXCLUDE_MATERIALS.has(material)) { excludedByMaterial++; continue; }
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
        isPrimary:       SET_FALSE.has(material) ? false : true,
      });
    }
  }

  console.log(`Skipped (mapLegacyToNew → null)         : ${skippedNull}`);
  console.log(`Source rows expanded into multiple v2  : ${crossListed}`);
  console.log(`Name-override rows (live names applied) : ${overridden}`);
  console.log(`Excluded — WS Max removed bases         : ${excludedByBase}`);
  console.log(`Excluded — stray material list          : ${excludedByMaterial}`);
  console.log(`v2 rows after translation              : ${v2Rows.length}`);
  console.log(`isPrimary=false rows (SET_FALSE applied): ${v2Rows.filter((r) => !r.isPrimary).length}`);

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
