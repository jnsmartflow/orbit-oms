// Read-only diagnostic — three open questions surfaced by v2 catalog join failure.
// Section 1: STAINER colour-inversion (is product=colour-shade, category=stainer-line?).
// Section 2: PROMISE EXTERIOR pack mystery (40 SKU matches but rendered grid empty).
// Section 3: GLOSS brand-prefix collision (LUXURIO/2K PU/PU PRIME all → product=GLOSS?).
// No writes. No source-file edits. Sequential awaits. DATABASE_URL pooler.
// Run: npx tsx scripts/v2-catalog-diagnose-stainer-promise.ts

import { promises as fs } from "node:fs";
import path from "node:path";
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
function trunc(s: string | null | undefined, w: number): string {
  const v = s == null ? "(null)" : s;
  return v.length > w ? v.slice(0, w - 1) + "…" : v;
}

type SkuRow = {
  material:    string;
  description: string | null;
  category:    string;
  product:     string;
  baseColour:  string | null;
  packCode:    string | null;
};

function printSkuRowTable(rows: SkuRow[]): void {
  if (rows.length === 0) { console.log("  (no rows)"); return; }
  console.log("  " + pad("MATERIAL", 12) + "  " + pad("CATEGORY", 18) + "  " + pad("PRODUCT", 22)
    + "  " + pad("BASE COLOUR", 22) + "  " + pad("PACK", 6) + "  DESCRIPTION");
  console.log("  " + "-".repeat(12) + "  " + "-".repeat(18) + "  " + "-".repeat(22)
    + "  " + "-".repeat(22) + "  " + "-".repeat(6) + "  " + "-".repeat(50));
  for (const r of rows) {
    console.log("  " + pad(r.material, 12) + "  " + pad(r.category, 18) + "  " + pad(r.product, 22)
      + "  " + pad(r.baseColour, 22) + "  " + pad(r.packCode, 6) + "  " + trunc(r.description, 50));
  }
}

function header(title: string): void {
  console.log("");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log(title);
  console.log("══════════════════════════════════════════════════════════════════════");
}

const SKU_SELECT = {
  material: true, description: true, category: true,
  product: true, baseColour: true, packCode: true,
} as const;

async function main(): Promise<void> {
  /* eslint-disable no-console */

  // ─── SECTION 1 — STAINER colour-inversion ──────────────────────────
  header("SECTION 1 — STAINER colour-inversion check");

  console.log("\n1a. Sample 15 SKU rows where category matches TINTER / STAINER / COLORANT:\n");
  printSkuRowTable(await prisma.mo_sku_lookup.findMany({
    where: {
      OR: [
        { category: { contains: "TINTER",   mode: "insensitive" } },
        { category: { contains: "STAINER",  mode: "insensitive" } },
        { category: { contains: "COLORANT", mode: "insensitive" } },
      ],
    },
    select: SKU_SELECT,
    take: 15,
  }));

  console.log("\n1b. All distinct mo_sku_lookup.category values:\n");
  const cats = await prisma.mo_sku_lookup.findMany({
    select: { category: true }, distinct: ["category"], orderBy: { category: "asc" },
  });
  for (const c of cats) console.log(`  ${c.category}`);
  console.log(`  (${cats.length} distinct categories total)`);

  console.log("\n1c. Distinct products that are short codes (length <= 3) — likely colour codes:\n");
  const allProducts = await prisma.mo_sku_lookup.findMany({
    select: { product: true }, distinct: ["product"],
  });
  const shortCodes = allProducts.map((r) => r.product).filter((p) => p.length <= 3).sort();
  if (shortCodes.length === 0) {
    console.log("  (no short-code products)");
  } else {
    console.log(`  ${shortCodes.length} distinct: ${shortCodes.slice(0, 80).join(", ")}${shortCodes.length > 80 ? ", …" : ""}`);
    console.log("\n  Sample 12 rows for those short-code products:\n");
    printSkuRowTable(await prisma.mo_sku_lookup.findMany({
      where: { product: { in: shortCodes } },
      select: SKU_SELECT, take: 12, orderBy: { product: "asc" },
    }));
  }

  console.log("\n1d. Sample 25 rows where description mentions stainer product names:\n");
  printSkuRowTable(await prisma.mo_sku_lookup.findMany({
    where: {
      OR: [
        { description: { contains: "Acotone",           mode: "insensitive" } },
        { description: { contains: "Universal Stainer", mode: "insensitive" } },
        { description: { contains: "Machine Tinter",    mode: "insensitive" } },
        { description: { contains: "PU Stainer",        mode: "insensitive" } },
        { description: { contains: "HP Colorant",       mode: "insensitive" } },
      ],
    },
    select: SKU_SELECT, take: 25,
  }));

  // ─── SECTION 2 — PROMISE EXTERIOR pack mystery ─────────────────────
  header("SECTION 2 — PROMISE EXTERIOR pack mystery");

  console.log("\n2a. Sample 15 SKU rows for product=PROMISE EXTERIOR, baseColour=BRILLIANT WHITE:\n");
  printSkuRowTable(await prisma.mo_sku_lookup.findMany({
    where: { product: "PROMISE EXTERIOR", baseColour: "BRILLIANT WHITE" },
    select: SKU_SELECT, take: 15, orderBy: { packCode: "asc" },
  }));

  console.log("\n2b. Distinct packCode values for product=PROMISE EXTERIOR (any baseColour):\n");
  const packs2b = await prisma.mo_sku_lookup.findMany({
    where: { product: "PROMISE EXTERIOR" },
    select: { packCode: true }, distinct: ["packCode"], orderBy: { packCode: "asc" },
  });
  for (const p of packs2b) console.log(`  "${p.packCode}"`);
  console.log(`  (${packs2b.length} distinct packCodes)`);

  console.log("\n2c. Distinct packCode values for product=MAX (comparison — renders correctly):\n");
  const packs2c = await prisma.mo_sku_lookup.findMany({
    where: { product: "MAX" },
    select: { packCode: true }, distinct: ["packCode"], orderBy: { packCode: "asc" },
  });
  for (const p of packs2c) console.log(`  "${p.packCode}"`);
  console.log(`  (${packs2c.length} distinct packCodes)`);

  console.log("\n2d. PACK_ORDER constant from app/api/place-order/data/route.ts:\n");
  try {
    const routePath = path.join("app", "api", "place-order", "data", "route.ts");
    const routeRaw  = await fs.readFile(routePath, "utf8");
    const match     = routeRaw.match(/const PACK_ORDER:\s*ReadonlyArray<string>\s*=\s*\[([\s\S]*?)\];/);
    if (match) {
      console.log(`  source: ${routePath}`);
      console.log("  PACK_ORDER = [");
      for (const line of match[1].split("\n")) {
        const t = line.trim();
        if (t) console.log(`    ${t}`);
      }
      console.log("  ];");
    } else {
      console.log("  (could not extract PACK_ORDER from route.ts — file shape changed?)");
    }
  } catch (err) {
    console.log(`  (could not read route.ts: ${err})`);
  }

  // ─── SECTION 3 — GLOSS brand-prefix collision ──────────────────────
  header("SECTION 3 — GLOSS brand-prefix collision check");

  console.log("\n3a. SKU rows where product=GLOSS, grouped by baseColour:\n");
  const grp3a = await prisma.mo_sku_lookup.groupBy({
    by: ["baseColour"], where: { product: "GLOSS" },
    _count: { material: true }, orderBy: { baseColour: "asc" },
  });
  if (grp3a.length === 0) {
    console.log("  (no rows with product=GLOSS)");
  } else {
    console.log("  " + pad("BASE COLOUR", 32) + "  ROWS");
    console.log("  " + "-".repeat(32) + "  ----");
    for (const g of grp3a) console.log("  " + pad(g.baseColour, 32) + "  " + g._count.material);
    console.log(`  (${grp3a.length} distinct baseColour values for product=GLOSS)`);
  }

  console.log("\n3b. Sample 10 SKU rows for product=GLOSS, baseColour=BRILLIANT WHITE:\n");
  printSkuRowTable(await prisma.mo_sku_lookup.findMany({
    where: { product: "GLOSS", baseColour: "BRILLIANT WHITE" },
    select: SKU_SELECT, take: 10,
  }));

  console.log("\n3c. Sample 15 SKU rows where product contains 'LUXURIO':\n");
  printSkuRowTable(await prisma.mo_sku_lookup.findMany({
    where: { product: { contains: "LUXURIO" } },
    select: SKU_SELECT, take: 15, orderBy: { product: "asc" },
  }));

  /* eslint-enable no-console */
}

main()
  .catch((err) => { console.error("✗ Diagnostic failed:", err); process.exit(1); })
  .finally(() => { void prisma.$disconnect(); });
