/**
 * READ-ONLY smoke test (2026-08-10) — pack-filter chip ORDER on the picking
 * detail screen.
 *
 * Builds the chip list exactly as both boards do (distinct `pack` across the
 * bill's grouped lines, NO_PACK_KEY forced last) and shows the OLD ordering
 * (localeCompare) beside the NEW one from the shipped lib/picking/pack-sort.ts.
 * SELECTs only — no INSERT/UPDATE/DELETE/ALTER.
 *
 * Run: npx tsx scripts/_smoke-pack-chip-order.ts [orderId ...]
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { formatPack } from "../lib/place-order/pack";
import { sortPackLabels } from "../lib/picking/pack-sort";

for (const f of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const NO_PACK_KEY = "__no_pack__";

/** The chip list, exactly as both boards build it. */
function chips(packs: (string | null)[], sorter: (l: readonly string[]) => string[]): string[] {
  const set = new Set(packs.map((p) => p ?? NO_PACK_KEY));
  const keys = Array.from(set);
  const real = sorter(keys.filter((k) => k !== NO_PACK_KEY));
  return keys.includes(NO_PACK_KEY) ? [...real, NO_PACK_KEY] : real;
}

const oldSort = (l: readonly string[]): string[] => [...l].sort((a, b) => a.localeCompare(b));

async function packsForOrder(orderId: number): Promise<{ obd: string; packs: (string | null)[] } | null> {
  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    select: { obdNumber: true },
  });
  if (!order) return null;
  const rawLines = await prisma.import_raw_line_items.findMany({
    where: { obdNumber: order.obdNumber, lineStatus: "active" },
    select: { skuCodeRaw: true },
  });
  const codes = Array.from(new Set(rawLines.map((l) => l.skuCodeRaw).filter(Boolean)));
  const cat = await prisma.sku_master_v2.findMany({
    where: { material: { in: codes } },
    select: { material: true, packCode: true, unit: true },
  });
  const byCode = new Map(cat.map((r) => [r.material, formatPack(r.packCode, r.unit)]));
  return { obd: order.obdNumber, packs: rawLines.map((l) => byCode.get(l.skuCodeRaw) ?? null) };
}

(async () => {
  const argv = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  let targets = argv;

  if (!targets.length) {
    // Find live bills whose lines resolve to the MOST distinct pack sizes.
    const rows = await prisma.$queryRawUnsafe<{ id: number; obdNumber: string; n: number }[]>(`
      SELECT o.id, o."obdNumber", COUNT(DISTINCT s."packCode" || COALESCE(s.unit,''))::int AS n
      FROM orders o
      JOIN import_raw_line_items r ON r."obdNumber" = o."obdNumber" AND r."lineStatus" = 'active'
      JOIN sku_master_v2 s ON s.material = r."skuCodeRaw"
      WHERE o."isRemoved" = false
      GROUP BY o.id, o."obdNumber"
      HAVING COUNT(DISTINCT s."packCode" || COALESCE(s.unit,'')) >= 4
      ORDER BY n DESC, o.id DESC
      LIMIT 5
    `);
    targets = rows.map((r) => r.id);
    console.log(`auto-picked bills with the most distinct packs: ${rows.map((r) => `${r.id}(${r.obdNumber}, ${r.n})`).join(", ")}`);
  }

  for (const id of targets) {
    const got = await packsForOrder(id);
    if (!got) {
      console.log(`\norder ${id}: NOT FOUND`);
      continue;
    }
    const before = chips(got.packs, oldSort);
    const after = chips(got.packs, sortPackLabels);
    console.log(`\n──── order ${id} · OBD ${got.obd} ────`);
    console.log(`  BEFORE (localeCompare): All  ${before.join("  ")}`);
    console.log(`  AFTER  (pack-sort)    : All  ${after.join("  ")}`);
    console.log(`  changed: ${before.join(",") !== after.join(",") ? "YES" : "no"}`);
  }

  // Unit-ish check of the helper against every shape formatPack emits, plus junk.
  const shapes = ["50ML", "100ML", "200ML", "400 ml", "500ML", "1L", "4L", "10L", "20L", "30L",
                  "400GM", "5KG", "25KG", "40KG", "1 pc", "__no_pack__", "WEIRDCODE", ""];
  console.log(`\n──── helper over every formatPack shape + junk ────`);
  console.log(`  in : ${shapes.join("  ")}`);
  console.log(`  out: ${sortPackLabels(shapes).join("  ")}`);

  await prisma.$disconnect();
})();
