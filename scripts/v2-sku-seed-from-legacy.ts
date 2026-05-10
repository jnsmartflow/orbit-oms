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
      const baseColour = newRow.baseColour ?? legacy.baseColour;
      v2Rows.push({
        material,
        description:     legacy.description,
        category:        newRow.family,
        product:         newRow.subProduct,
        baseColour,
        packCode:        legacy.packCode,
        unit:            legacy.unit,
        refMaterial:     legacy.refMaterial,
        refDescription:  legacy.refDescription,
        paintType:       legacy.paintType,
        materialType:    legacy.materialType,
        piecesPerCarton: legacy.piecesPerCarton,
      });
    }
  }

  console.log(`Skipped (mapLegacyToNew → null)         : ${skippedNull}`);
  console.log(`Source rows expanded into multiple v2  : ${crossListed}`);
  console.log(`v2 rows after translation              : ${v2Rows.length}`);

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
