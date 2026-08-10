/**
 * READ-ONLY smoke test (2026-08-10) — the split-SKU merge on the picking
 * detail screen.
 *
 * Replays app/api/picking/order/[orderId]/route.ts's two SELECTs verbatim and
 * feeds them to the REAL lib/picking/group-lines.ts, so this exercises the
 * shipped function rather than a copy of it. SELECTs only — no INSERT/UPDATE/
 * DELETE/ALTER anywhere, and the route itself writes nothing either.
 *
 * Run: npx tsx scripts/_smoke-picking-split-sku.ts [orderId ...]
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { groupPickingDetailLines } from "../lib/picking/group-lines";
import { formatPack } from "../lib/place-order/pack";
import { resolveFamily } from "../lib/picking/family-groups";
import type { CatalogEntry } from "../lib/picking/resolve-lines";
import type { PickingLineFinding } from "../lib/picking/types";

for (const f of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

async function report(orderId: number): Promise<void> {
  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    select: { obdNumber: true },
  });
  if (!order) {
    console.log(`order ${orderId}: NOT FOUND (or removed)`);
    return;
  }

  const rawLines = await prisma.import_raw_line_items.findMany({
    where: { obdNumber: order.obdNumber, lineStatus: "active" },
    select: {
      id: true, skuCodeRaw: true, skuDescriptionRaw: true, unitQty: true,
      volumeLine: true, netWeight: true, totalWeight: true, articleTag: true,
    },
    orderBy: { lineId: "asc" },
  });

  // Same resolution the route does (resolve-lines.ts), inlined to keep this
  // script free of the "@/..." path alias tsx would have to be taught.
  const codes = Array.from(new Set(rawLines.map((l) => l.skuCodeRaw).filter(Boolean)));
  const catRows = await prisma.sku_master_v2.findMany({
    where: { material: { in: codes } },
    select: {
      material: true, description: true, packCode: true, unit: true,
      // Added 2026-08-10b when CatalogEntry gained `family`. scripts/_*.ts is
      // EXCLUDED from tsconfig, so nothing would have flagged this going stale.
      category: true, displayCategory: true,
    },
  });
  const catalogByCode = new Map<string, CatalogEntry>(
    catRows.map((r) => [
      r.material,
      { name: r.description, pack: formatPack(r.packCode, r.unit), family: resolveFamily(r) },
    ]),
  );

  const findingRows = rawLines.length
    ? await prisma.pick_findings.findMany({
        where: { rawLineItemId: { in: rawLines.map((l) => l.id) } },
        select: {
          rawLineItemId: true, qtyFound: true, reason: true, remarks: true,
          mfgMonth: true, mfgYear: true, reportedById: true, reportedAt: true,
          recordedById: true, recordedAt: true,
        },
      })
    : [];
  const findingByLineId = new Map<number, PickingLineFinding>(
    findingRows.map((f) => [
      f.rawLineItemId,
      {
        qtyFound: f.qtyFound, reason: f.reason, remarks: f.remarks,
        mfgMonth: f.mfgMonth, mfgYear: f.mfgYear,
        reportedById: f.reportedById, reportedAt: f.reportedAt?.toISOString() ?? null,
        recordedById: f.recordedById, recordedAt: f.recordedAt?.toISOString() ?? null,
      },
    ]),
  );

  const lines = groupPickingDetailLines(rawLines, catalogByCode, findingByLineId);

  const rawQtyTotal = rawLines.reduce((s, l) => s + l.unitQty, 0);
  const rowQtyTotal = lines.reduce((s, r) => s + r.qty, 0);
  const coveredIds = lines.flatMap((r) => r.lineIds);

  console.log(`\n──── order ${orderId} · OBD ${order.obdNumber} ────`);
  console.log(`rows BEFORE (raw active lines): ${rawLines.length}`);
  console.log(`rows AFTER  (grouped)         : ${lines.length}`);
  console.log(`qty total  before / after     : ${rawQtyTotal} / ${rowQtyTotal}  ${rawQtyTotal === rowQtyTotal ? "OK" : "MISMATCH"}`);
  console.log(`lineIds cover every raw line  : ${coveredIds.length === rawLines.length && new Set(coveredIds).size === rawLines.length ? "OK" : "MISMATCH"}`);
  console.log(`lineIds[0] === id on every row: ${lines.every((r) => r.lineIds[0] === r.id) ? "OK" : "MISMATCH"}`);
  console.log(`findings preserved            : ${lines.filter((r) => r.finding).length} of ${findingRows.length}`);
  console.log(`merged rows have null tag     : ${lines.every((r) => r.lineIds.length === 1 || r.articleTag === null) ? "OK" : "MISMATCH"}`);
  console.log(`merged rows carry no finding  : ${lines.every((r) => r.lineIds.length === 1 || r.finding === null) ? "OK" : "MISMATCH"}`);

  const merged = lines.filter((r) => r.lineIds.length > 1);
  if (merged.length) {
    console.log(`\nmerged rows (${merged.length}):`);
    for (const r of merged) {
      console.log(
        `  ${r.sku}  pack=${r.pack ?? "—"}  qty=${r.qty}  lines=${r.lineIds.length} [${r.lineIds.join(",")}]  litres=${r.litres}  net=${r.netWeight}  total=${r.totalWeight}  tag=${r.articleTag}`,
      );
    }
  }
}

(async () => {
  const argv = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  // Default: the worst live case (OBD 9108587550, IN60000676 × 8 lines) plus
  // two all-null-batch multi-split bills and one same-batch pair.
  const targets = argv.length ? argv : [10869];
  for (const id of targets) await report(id);
  await prisma.$disconnect();
})();
