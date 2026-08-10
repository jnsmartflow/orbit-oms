/**
 * READ-ONLY smoke test (2026-08-10) — family grouping on the picker's detail
 * screen.
 *
 * Replays the route's reads verbatim and feeds them to the REAL shipped
 * functions — resolveFamily / groupPickingDetailLines / groupLinesByFamily — so
 * this exercises the shipped path, not a copy of it. Prints BEFORE (flat, as the
 * picker sees it today) and AFTER (grouped), plus the pack-filter behaviour from
 * point 5 of the brief. SELECTs only; no INSERT/UPDATE/DELETE/ALTER.
 *
 * Run: npx tsx scripts/_smoke-picking-family-groups.ts [orderId ...]
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { formatPack } from "../lib/place-order/pack";
import { groupPickingDetailLines } from "../lib/picking/group-lines";
import { groupLinesByFamily, resolveFamily, buildFamilyByCode } from "../lib/picking/family-groups";
import type { CatalogEntry } from "../lib/picking/resolve-lines";
import type { PickingDetailLine, PickingLineFinding } from "../lib/picking/types";

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

async function run(orderId: number): Promise<void> {
  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    select: { obdNumber: true },
  });
  if (!order) { console.log(`\norder ${orderId}: NOT FOUND`); return; }

  const rawLines = await prisma.import_raw_line_items.findMany({
    where: { obdNumber: order.obdNumber, lineStatus: "active" },
    select: {
      id: true, skuCodeRaw: true, skuDescriptionRaw: true, unitQty: true,
      volumeLine: true, netWeight: true, totalWeight: true, articleTag: true,
    },
    orderBy: { lineId: "asc" },
  });

  const codes = Array.from(new Set(rawLines.map((l) => l.skuCodeRaw).filter(Boolean)));
  const catRows = await prisma.sku_master_v2.findMany({
    where: { material: { in: codes } },
    select: {
      material: true, description: true, packCode: true, unit: true,
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
    findingRows.map((f) => [f.rawLineItemId, {
      qtyFound: f.qtyFound, reason: f.reason, remarks: f.remarks,
      mfgMonth: f.mfgMonth, mfgYear: f.mfgYear,
      reportedById: f.reportedById, reportedAt: f.reportedAt?.toISOString() ?? null,
      recordedById: f.recordedById, recordedAt: f.recordedAt?.toISOString() ?? null,
    }]),
  );

  const lines = groupPickingDetailLines(rawLines, catalogByCode, findingByLineId);

  console.log(`\n════ order ${orderId} · OBD ${order.obdNumber} ════`);
  console.log(`raw active lines: ${rawLines.length}  →  merged rows: ${lines.length}`);

  console.log(`\n── BEFORE (flat, today) ──`);
  for (const li of lines) {
    console.log(`   ${(li.pack ?? "—").padEnd(7)} ${li.sku.padEnd(12)} x${String(li.qty).padEnd(4)} ${(li.name ?? "").slice(0, 40)}`);
  }

  const groups = groupLinesByFamily(lines);
  console.log(`\n── AFTER (grouped) ── ${groups.length} groups`);
  for (const g of groups) {
    console.log(`  ┌ ${g.label.toUpperCase()}  (${g.lines.length})`);
    for (const li of g.lines) {
      console.log(`  │  ${(li.pack ?? "—").padEnd(7)} ${li.sku.padEnd(12)} x${String(li.qty).padEnd(4)} ${(li.name ?? "").slice(0, 38)}`);
    }
  }

  // ── Invariants ──
  const flatFromGroups = groups.flatMap((g) => g.lines);
  const otherIdx = groups.findIndex((g) => g.family === null);
  console.log(`\n  every row appears exactly once : ${flatFromGroups.length === lines.length && new Set(flatFromGroups.map((l) => l.id)).size === lines.length ? "OK" : "MISMATCH"}`);
  console.log(`  line order preserved in-group  : ${groups.every((g) => g.lines.every((l, i) => i === 0 || lines.indexOf(g.lines[i - 1]) < lines.indexOf(l))) ? "OK" : "MISMATCH"}`);
  console.log(`  "Other" is last (or absent)    : ${otherIdx === -1 || otherIdx === groups.length - 1 ? "OK" : "MISMATCH"}`);
  console.log(`  no empty groups                : ${groups.every((g) => g.lines.length > 0) ? "OK" : "MISMATCH"}`);

  // ── Point 5: a pack chip empties (and therefore hides) some families ──
  const packs = Array.from(new Set(lines.map((l) => l.pack ?? NO_PACK_KEY)));
  if (packs.length >= 2) {
    const pick = packs[0];
    const filtered = lines.filter((l) => (l.pack ?? NO_PACK_KEY) === pick);
    const fg = groupLinesByFamily(filtered);
    console.log(`\n  pack chip "${pick}" → ${fg.length} of ${groups.length} groups survive: ${fg.map((g) => g.label).join(", ")}`);
  }

  // ── Card-vs-detail agreement: same helper, so families must match ──
  const familyByCode = buildFamilyByCode(catRows);
  const cardFamilies = new Set<string>();
  let cardUnresolved = 0;
  for (const l of rawLines) {
    const f = familyByCode.get(l.skuCodeRaw);
    if (f !== undefined) cardFamilies.add(f); else cardUnresolved++;
  }
  const detailFamilies = new Set(groups.filter((g) => g.family !== null).map((g) => g.family as string));
  const same =
    cardFamilies.size === detailFamilies.size &&
    Array.from(cardFamilies).every((f) => detailFamilies.has(f));
  console.log(`  card chips vs detail groups    : ${same ? "AGREE" : "DIFFER"}  (card: ${Array.from(cardFamilies).sort().join(", ") || "—"})`);
  console.log(`  card unresolvedLineCount=${cardUnresolved}  ·  detail "Other" rows=${groups.find((g) => g.family === null)?.lines.length ?? 0}`);
}

(async () => {
  const argv = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  for (const id of argv.length ? argv : [8125]) await run(id);
  await prisma.$disconnect();
})();
