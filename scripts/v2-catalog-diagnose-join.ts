// Read-only diagnostic for the v2 catalog ↔ mo_sku_lookup join failure.
//
// /api/place-order/data joins mo_order_form_index_v2.subProduct against
// mo_sku_lookup.product (exact string match, optionally with baseColour
// composite). Smoke testing /place-order showed many more empty pack
// panels than the locked Option A scope of LUXURIO / 2K PU / PU PRIME —
// e.g. STAINER, PROMISE ENAMEL, METALLIC, RAINPROOF.
//
// This script does not write to either table. It only counts matches and
// prints a report so we can see the mismatch pattern before choosing a fix.
//
// Run with: npx tsx scripts/v2-catalog-diagnose-join.ts
//
// Per CLAUDE_CORE.md §3:
//   - sequential awaits, no prisma.$transaction([...])
//   - DATABASE_URL (transaction pooler, port 6543) — depot network blocks 5432.

import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set in environment.");
}
const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
  log: ["error"],
});

async function main(): Promise<void> {
  /* eslint-disable no-console */

  // ── 1. Pull v2 catalog and mo_sku_lookup ────────────────────────────
  const v2Rows = await prisma.mo_order_form_index_v2.findMany({
    select: { family: true, subProduct: true, baseColour: true },
    orderBy: [{ family: "asc" }, { subProduct: "asc" }],
  });
  const skuRows = await prisma.mo_sku_lookup.findMany({
    select: { product: true, baseColour: true, packCode: true },
  });

  // ── 2. Distinct sets ────────────────────────────────────────────────
  const v2SubProductsSet = new Set<string>();
  for (const r of v2Rows) v2SubProductsSet.add(r.subProduct);
  const v2SubProducts = Array.from(v2SubProductsSet).sort();

  const skuProductsSet = new Set<string>();
  for (const r of skuRows) skuProductsSet.add(r.product);
  const skuProducts = Array.from(skuProductsSet).sort();

  // ── 3. Count mo_sku_lookup rows per exact subProduct match ─────────
  // Keyed by v2 subProduct string. Counts how many mo_sku_lookup rows
  // have product === subProduct (exact match, no normalization).
  const matchCount = new Map<string, number>();
  for (const sp of v2SubProducts) matchCount.set(sp, 0);
  for (const sku of skuRows) {
    if (matchCount.has(sku.product)) {
      matchCount.set(sku.product, matchCount.get(sku.product)! + 1);
    }
  }

  const zeroMatch: string[] = [];
  const someMatch: Array<[string, number]> = [];
  for (const [sp, n] of Array.from(matchCount)) {
    if (n === 0) zeroMatch.push(sp);
    else         someMatch.push([sp, n]);
  }
  zeroMatch.sort();
  someMatch.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));

  // ── 4. Family-specific drilldowns ───────────────────────────────────
  function dumpFamily(familyName: string): void {
    const rows = v2Rows.filter((r) => r.family === familyName);
    if (rows.length === 0) {
      console.log(`(no rows in v2 for family ${familyName})`);
      return;
    }
    console.log(`Family: ${familyName} — ${rows.length} v2 rows`);
    console.log("  v2 subProduct                                       baseColour                v1 SKU.product match?");
    console.log("  ------------------------------------------------    ----------------------    ----------------------");
    for (const row of rows) {
      const skuExact = skuProductsSet.has(row.subProduct) ? "EXACT MATCH" : "no match";
      const skuCount = matchCount.get(row.subProduct) ?? 0;
      const baseDisplay = row.baseColour ?? "(null)";
      console.log(
        `  ${row.subProduct.padEnd(48).slice(0, 48)}    ${baseDisplay.padEnd(22).slice(0, 22)}    ${skuExact} (${skuCount} SKU rows)`,
      );
    }
  }

  // ── 5. Print the report ─────────────────────────────────────────────
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log("v2 catalog ↔ mo_sku_lookup join diagnosis");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log(`Total v2 catalog rows                   : ${v2Rows.length}`);
  console.log(`Total mo_sku_lookup rows                : ${skuRows.length}`);
  console.log(`Distinct v2.subProduct values           : ${v2SubProducts.length}`);
  console.log(`Distinct mo_sku_lookup.product values   : ${skuProducts.length}`);
  console.log(`v2 sub-products with ZERO SKU matches   : ${zeroMatch.length}`);
  console.log(`v2 sub-products with >=1 SKU match      : ${someMatch.length}`);

  console.log("");
  console.log("──────────────────────────────────────────────────────────────────────");
  console.log(`Zero-match sub-products (first 30 of ${zeroMatch.length}):`);
  console.log("──────────────────────────────────────────────────────────────────────");
  for (const sp of zeroMatch.slice(0, 30)) console.log(`  ${sp}`);
  if (zeroMatch.length > 30) console.log(`  …and ${zeroMatch.length - 30} more`);

  console.log("");
  console.log("──────────────────────────────────────────────────────────────────────");
  console.log(`Matched sub-products (first 30 of ${someMatch.length}, ascending by match count):`);
  console.log("──────────────────────────────────────────────────────────────────────");
  for (const [sp, n] of someMatch.slice(0, 30)) {
    console.log(`  ${sp.padEnd(48)} ${n} SKU rows`);
  }
  if (someMatch.length > 30) console.log(`  …and ${someMatch.length - 30} more`);

  console.log("");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log("STAINER family drilldown (v2)");
  console.log("══════════════════════════════════════════════════════════════════════");
  dumpFamily("STAINER");

  console.log("");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log("PROMISE EXTERIOR family drilldown (v2)");
  console.log("══════════════════════════════════════════════════════════════════════");
  dumpFamily("PROMISE EXTERIOR");

  // Bonus drilldown — locked-decision empty-pack-panel families to confirm.
  console.log("");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log("LUXURIO / 2K PU / PU PRIME drilldowns (locked-Option-A families)");
  console.log("══════════════════════════════════════════════════════════════════════");
  dumpFamily("LUXURIO");
  console.log("");
  dumpFamily("2K PU");
  console.log("");
  dumpFamily("PU PRIME");

  // ── 6. Sample mo_sku_lookup.product values to eyeball naming patterns ─
  console.log("");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log("Sample mo_sku_lookup.product values (40 random samples)");
  console.log("══════════════════════════════════════════════════════════════════════");
  const sample = skuProducts.slice(0, 40);
  for (const p of sample) console.log(`  ${p}`);
  if (skuProducts.length > 40) console.log(`  …and ${skuProducts.length - 40} more (total ${skuProducts.length})`);

  /* eslint-enable no-console */
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("✗ Diagnostic failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
