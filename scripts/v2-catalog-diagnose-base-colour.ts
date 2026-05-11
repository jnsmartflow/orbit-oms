// Read-only diagnostic — v2 ↔ mo_sku_lookup baseColour string match check.
//
// For three families, dump:
//   (1) all distinct baseColour values in v2 for that (family, subProduct)
//   (2) all distinct baseColour values in mo_sku_lookup for the matching product
//   (3) per-v2-baseColour join row count (exact string match on baseColour)
//
// Families:
//   - PROMISE EXTERIOR — smoke test showed empty cells despite 40 SKU matches
//   - MAX              — control: known to render correctly
//   - GLOSS            — top-level enamel; later we'll cross-check against
//                        LUXURIO/GLOSS / 2K PU/GLOSS / PU PRIME/GLOSS routing
//
// No writes. No source-file edits. Sequential awaits. DATABASE_URL pooler.
// Run: npx tsx scripts/v2-catalog-diagnose-base-colour.ts

import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must be set in environment.");
const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
  log: ["error"],
});

function pad(s: string | number | null | undefined, w: number): string {
  const v = s == null ? "(null)" : String(s);
  return v.length >= w ? v.slice(0, w) : v + " ".repeat(w - v.length);
}

async function dumpFamily(
  family:     string,
  subProduct: string,
  skuProduct: string,
): Promise<void> {
  /* eslint-disable no-console */
  console.log("");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log(`Family: ${family}  |  subProduct: ${subProduct}  |  sku.product: ${skuProduct}`);
  console.log("══════════════════════════════════════════════════════════════════════");

  // ── 1. v2 baseColour values for (family, subProduct) ─────────────────
  const v2Rows = await prisma.mo_order_form_index_v2.findMany({
    where:   { family, subProduct },
    select:  { baseColour: true },
    orderBy: { baseColour: "asc" },
  });
  const v2Bases: Array<string | null> = v2Rows.map((r) => r.baseColour);

  console.log("");
  console.log(`  (1) v2 baseColour values — ${v2Bases.length} row${v2Bases.length === 1 ? "" : "s"}:`);
  console.log("");
  if (v2Bases.length === 0) {
    console.log("      (no v2 rows for this family + subProduct)");
  } else {
    for (const b of v2Bases) console.log(`      ${b ?? "(null)"}`);
  }

  // ── 2. mo_sku_lookup baseColour values for product=skuProduct ────────
  const skuGrp = await prisma.mo_sku_lookup.groupBy({
    by:      ["baseColour"],
    where:   { product: skuProduct },
    _count:  { material: true },
    orderBy: { baseColour: "asc" },
  });
  const totalSkuRows = skuGrp.reduce((acc, g) => acc + g._count.material, 0);

  console.log("");
  console.log(`  (2) mo_sku_lookup baseColour values for product='${skuProduct}' — ${skuGrp.length} distinct, ${totalSkuRows} total SKU rows:`);
  console.log("");
  if (skuGrp.length === 0) {
    console.log("      (no SKU rows with product='" + skuProduct + "')");
  } else {
    console.log("      " + pad("BASE COLOUR", 32) + "  ROWS");
    console.log("      " + "-".repeat(32) + "  ----");
    for (const g of skuGrp) {
      console.log("      " + pad(g.baseColour, 32) + "  " + g._count.material);
    }
  }

  // ── 3. Per-v2-baseColour join count ──────────────────────────────────
  console.log("");
  console.log("  (3) Per-v2-baseColour SKU match count (exact string match on baseColour):");
  console.log("");
  if (v2Bases.length === 0) {
    console.log("      (no v2 rows to check)");
  } else {
    const skuByBase = new Map<string | null, number>();
    for (const g of skuGrp) skuByBase.set(g.baseColour, g._count.material);
    console.log("      " + pad("V2 BASE COLOUR", 32) + "  SKU MATCH COUNT  STATUS");
    console.log("      " + "-".repeat(32) + "  ---------------  ----------");
    for (const v2Base of v2Bases) {
      const count  = skuByBase.get(v2Base) ?? 0;
      const status = count > 0 ? "✓ match" : "✗ NO MATCH";
      console.log("      " + pad(v2Base, 32) + "  " + pad(String(count), 15) + "  " + status);
    }
  }
  /* eslint-enable no-console */
}

async function main(): Promise<void> {
  await dumpFamily("PROMISE EXTERIOR", "PROMISE EXTERIOR", "PROMISE EXTERIOR");
  await dumpFamily("MAX",              "MAX",              "MAX");
  await dumpFamily("GLOSS",            "GLOSS",            "GLOSS");
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
