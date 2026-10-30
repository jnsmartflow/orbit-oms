// scripts/backfill-sticker-2026-10-29.ts
//
// Bring every EXISTING bill with a sticker line (lib/orders/sticker.ts,
// STICKER_SKUS) in line with the owner rule of 2026-10-29 (commit 296e143b):
//   - line unitQty / volumeLine / netWeight / totalWeight: NEVER changed;
//   - sticker line articleTag -> "Sticker", article -> 0;
//   - stored totals recomputed WITHOUT sticker lines:
//       import_raw_summary  volume / grossWeight — ONLY rows the SAP parser
//                           summed from lines ([manual-sap] / [sap-paste] /
//                           [obd-paste], build-obd.ts). A SAP-header row
//                           (auto path) keeps SAP's own figures.
//       orders              volume / grossWeight
//       import_obd_query_summary  totalVolume / totalWeight / articleTag /
//                                 totalArticle
//
// DEFAULT IS A DRY RUN — it writes nothing to the database. It prints the plan,
// saves a CSV and the equivalent UPDATE SQL to the scratchpad dir given by
// --out=<dir> (default: the OS temp dir), and stops. Only --apply writes.
//
// ⚠ rebuildQuerySummaryForOrder (app/api/import/obd/route.ts) is NOT exported
// and cannot be: a Next.js route file may only export the route handlers and
// route config (dynamic, …) — any other named export fails `next build`. So
// queryAfter() below MIRRORS it line for line, reusing the same helpers
// (loadLines, headerKgLessStickers, rollupArticleTagsBySku). If that function
// changes, change this one.
//
// IDEMPOTENT. Every AFTER value is derived from the untouched line data and
// the first import_raw_summary — never from the current orders / summary
// value — so a second run plans zero writes. Same double-subtract guard as the
// route: a SAP-parser summary is a line sum (stickers taken out by re-summing),
// any other is SAP's header (only what sticker lines carry comes off).
//
// No prisma.$transaction (CORE §3) — sequential awaits.
//
// Run:  npx tsx scripts/backfill-sticker-2026-10-29.ts [--out=<dir>] [--apply]

import "dotenv/config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { prisma } from "../lib/prisma";
import { computeArticleInfo, loadPackCatalog, rollupArticleTagsBySku, type PackCatalog } from "../lib/article-tag";
import {
  headerKgLessStickers,
  headerLitresLessStickers,
  isStickerLine,
  isStickerOnly,
  loadLines,
  STICKER_SKUS,
} from "../lib/orders/sticker";

/* eslint-disable no-console */

const APPLY   = process.argv.includes("--apply");
const OUT_DIR = (process.argv.find((a) => a.startsWith("--out=")) ?? "").slice(6) || os.tmpdir();
const FIRST_OBD = "9110462350";

/** Same list as SAP_PARSER_BATCH_PREFIXES in app/api/import/obd/route.ts. */
const SAP_PARSER_BATCH_PREFIXES = ["[manual-sap]", "[sap-paste]", "[obd-paste]"] as const;
const isSapParser = (headerFile: string): boolean =>
  SAP_PARSER_BATCH_PREFIXES.some((p) => headerFile.startsWith(p));

/** Import source, from the batch headerFile marker. */
function sourceOf(headerFile: string): string {
  const m = headerFile.match(/^\[([^\]]+)\]/);
  return m ? m[1] : "template/other";
}

/** build-obd.ts's "sum or null". */
function sumOrNull(values: Array<number | null>): number | null {
  let acc: number | null = null;
  for (const v of values) {
    if (v === null) continue;
    acc = (acc ?? 0) + v;
  }
  return acc;
}

const r3  = (n: number | null): number | null => (n === null ? null : Math.round(n * 1000) / 1000);
const eq  = (a: number | null, b: number | null): boolean => r3(a) === r3(b);
const fmt = (v: unknown): string => (v === null || v === undefined ? "null" : String(v));
const ba  = (b: unknown, a: unknown): string => (fmt(b) === fmt(a) ? fmt(b) : `${fmt(b)} -> ${fmt(a)}`);

interface Line {
  id: number; skuCodeRaw: string; unitQty: number; volumeLine: number | null;
  totalWeight: number | null; isTinting: boolean; lineStatus: string;
  article: number | null; articleTag: string | null;
}
interface RawSummary {
  id: number; grossWeight: number | null; volume: number | null; totalUnitQty: number | null;
  headerFile: string; lines: Line[];
}
interface QueryAfter {
  totalLines: number; totalUnitQty: number; totalWeight: number; totalVolume: number;
  hasTinting: boolean; totalArticle: number; articleTag: string | null;
}

/**
 * MIRROR of rebuildQuerySummaryForOrder (app/api/import/obd/route.ts). `first`
 * is the oldest import_raw_summary WITH ITS AFTER volume/grossWeight — the
 * route reads that row after this backfill has written it.
 */
async function queryAfter(active: Line[], first: RawSummary | null, catalog: PackCatalog): Promise<QueryAfter> {
  const totalLines   = active.length;
  const totalUnitQty = active.reduce((sum, l) => sum + l.unitQty, 0);
  const totalVolume  = loadLines(active).reduce((sum, l) => sum + (l.volumeLine ?? 0), 0);
  const hasTinting   = active.some((l) => l.isTinting);

  const headerFile   = first?.headerFile ?? "";
  const totalWeight  = isSapParser(headerFile)
    ? (first?.grossWeight ?? 0)
    : (headerKgLessStickers(first?.grossWeight ?? null, active) ?? 0);

  const { articleTag, totalArticle } = await rollupArticleTagsBySku(active, catalog);

  return {
    totalLines,
    totalUnitQty: totalLines > 0 ? totalUnitQty : (first?.totalUnitQty ?? 0),
    totalWeight,
    totalVolume:  totalLines > 0 ? totalVolume  : (first?.volume ?? 0),
    hasTinting,
    totalArticle,
    articleTag,
  };
}

function csvCell(v: unknown): string {
  const s = fmt(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function sqlVal(v: number | string | null): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

async function main(): Promise<void> {
  console.log(APPLY ? "MODE: --apply (WRITES)" : "MODE: DRY RUN (no writes)");

  // ── 1. Every sticker line, any lineStatus. contains + isStickerLine so a
  //       padded skuCodeRaw is still found and still matched on the trimmed code.
  const codes = Array.from(STICKER_SKUS);
  const found = await prisma.import_raw_line_items.findMany({
    where:  { OR: codes.map((c) => ({ skuCodeRaw: { contains: c } })) },
    select: { obdNumber: true, skuCodeRaw: true },
  });
  const obdNumbers = Array.from(new Set(found.filter(isStickerLine).map((l) => l.obdNumber)));
  obdNumbers.sort((a, b) => (a === FIRST_OBD ? -1 : b === FIRST_OBD ? 1 : a.localeCompare(b)));
  console.log(`sticker OBDs: ${obdNumbers.length}`);

  // ── 2. Load everything for those OBDs, in chunks.
  const orders = await prisma.orders.findMany({
    where:  { obdNumber: { in: obdNumbers } },
    select: {
      id: true, obdNumber: true, workflowStage: true, materialType: true, isRemoved: true,
      volume: true, grossWeight: true, tripDropId: true, partlyOnTrip: true,
      querySnapshot: { select: {
        id: true, totalLines: true, totalUnitQty: true, totalWeight: true, totalVolume: true,
        hasTinting: true, totalArticle: true, articleTag: true,
      } },
    },
  });
  const orderByObd = new Map(orders.map((o) => [o.obdNumber, o]));

  const summaries = await prisma.import_raw_summary.findMany({
    where:   { obdNumber: { in: obdNumbers } },
    orderBy: { id: "asc" },
    select:  {
      id: true, obdNumber: true, grossWeight: true, volume: true, totalUnitQty: true,
      batch: { select: { headerFile: true } },
      rawLineItems: { select: {
        id: true, skuCodeRaw: true, unitQty: true, volumeLine: true, totalWeight: true,
        isTinting: true, lineStatus: true, article: true, articleTag: true,
      } },
    },
  });
  const summariesByObd = new Map<string, RawSummary[]>();
  for (const s of summaries) {
    const list = summariesByObd.get(s.obdNumber) ?? [];
    list.push({ id: s.id, grossWeight: s.grossWeight, volume: s.volume, totalUnitQty: s.totalUnitQty,
                headerFile: s.batch.headerFile, lines: s.rawLineItems });
    summariesByObd.set(s.obdNumber, list);
  }

  // Active lines exactly as the route reads them (by obdNumber, not by summary).
  const activeAll = await prisma.import_raw_line_items.findMany({
    where:  { obdNumber: { in: obdNumbers }, lineStatus: "active" },
    select: {
      id: true, obdNumber: true, skuCodeRaw: true, unitQty: true, volumeLine: true, totalWeight: true,
      isTinting: true, lineStatus: true, article: true, articleTag: true,
    },
  });
  const activeByObd = new Map<string, Line[]>();
  for (const l of activeAll) {
    const list = activeByObd.get(l.obdNumber) ?? [];
    list.push(l);
    activeByObd.set(l.obdNumber, list);
  }

  const catalog = await loadPackCatalog(Array.from(new Set(activeAll.map((l) => l.skuCodeRaw))));

  // On-trip / dispatched context (per-invoice rows too — Model A).
  const orderIds = orders.map((o) => o.id);
  const invoices = await prisma.order_invoices.findMany({
    where:  { orderId: { in: orderIds } },
    select: { orderId: true, tripDropId: true, isDispatched: true },
  });
  const freight = await prisma.freight_trip_bills.findMany({
    where:  { orderId: { in: orderIds }, removedAt: null },
    select: { orderId: true },
  });
  const freightSet = new Set(freight.map((f) => f.orderId));

  // ── 3. Plan, per bill.
  type Write = { table: string; id: number; data: Record<string, number | string | null>; obd: string };
  const writes: Write[] = [];
  const odd: string[] = [];
  const header = [
    "obdNumber", "source", "workflowStage", "materialType", "isRemoved", "onTrip", "dispatched",
    "stickerLines", "stickerTagBefore", "stickerTagAfter",
    "rs_volume", "rs_grossWeight",
    "orders_volume", "orders_grossWeight",
    "q_totalVolume", "q_totalWeight", "q_articleTag", "q_totalArticle", "q_otherFieldsChange",
  ];
  const csv: string[] = [header.join(",")];
  const bySource = new Map<string, { bills: number; lines: number }>();
  let stickerLineTotal = 0, onTripCount = 0, dispatchedCount = 0, freightCount = 0;

  for (const obd of obdNumbers) {
    const order   = orderByObd.get(obd) ?? null;
    const rsList  = summariesByObd.get(obd) ?? [];
    const firstRs = rsList[0] ?? null;
    const source  = firstRs ? sourceOf(firstRs.headerFile) : "no-raw-summary";
    const active  = activeByObd.get(obd) ?? [];

    // (a) sticker lines — every one of the OBD's, active or removed.
    const allLines: Line[] = [];
    for (const rs of rsList) allLines.push(...rs.lines);
    const stickers = allLines.filter(isStickerLine);
    const tagBefore = Array.from(new Set(stickers.map((l) => `${fmt(l.articleTag)}/${fmt(l.article)}`))).join("|");
    const tagAfterSet = new Set<string>();
    for (const l of stickers) {
      const info = await computeArticleInfo({ material: l.skuCodeRaw, unitQty: l.unitQty, volumeLine: l.volumeLine }, catalog);
      tagAfterSet.add(`${fmt(info.articleTag)}/${fmt(info.article)}`);
      if (info.articleTag === null) odd.push(`${obd}: sticker line ${l.id} qty ${l.unitQty} resolves to a NULL tag (qty <= 0)`);
      if (l.articleTag !== info.articleTag || l.article !== info.article) {
        writes.push({ table: "import_raw_line_items", id: l.id, obd, data: { articleTag: info.articleTag, article: info.article } });
      }
    }
    const tagAfter = Array.from(tagAfterSet).join("|");

    // (b) raw summaries — SAP-parser rows only, re-summed from their own lines.
    const rsAfter = new Map<number, { volume: number | null; grossWeight: number | null }>();
    for (const rs of rsList) {
      if (!isSapParser(rs.headerFile)) { rsAfter.set(rs.id, { volume: rs.volume, grossWeight: rs.grossWeight }); continue; }
      const allSumV = sumOrNull(rs.lines.map((l) => l.volumeLine));
      const allSumW = sumOrNull(rs.lines.map((l) => l.totalWeight));
      // Same as build-obd.ts: a sticker-only delivery totals 0, not null (owner, 2026-10-30).
      const counted = loadLines(rs.lines);
      const stickerOnly = isStickerOnly(rs.lines);
      const v = stickerOnly ? 0 : sumOrNull(counted.map((l) => l.volumeLine));
      const w = stickerOnly ? 0 : sumOrNull(counted.map((l) => l.totalWeight));
      // Was it really build-obd's line sum? Either the all-lines sum (pre-fix)
      // or the sticker-free sum (already right).
      if (!(eq(rs.volume, allSumV) || eq(rs.volume, v)) || !(eq(rs.grossWeight, allSumW) || eq(rs.grossWeight, w))) {
        odd.push(`${obd}: raw summary ${rs.id} (${sourceOf(rs.headerFile)}) vol ${fmt(rs.volume)} / kg ${fmt(rs.grossWeight)} is not the sum of its lines (${fmt(r3(allSumV))} / ${fmt(r3(allSumW))})`);
      }
      rsAfter.set(rs.id, { volume: r3(v), grossWeight: r3(w) });
      if (!eq(rs.volume, v) || !eq(rs.grossWeight, w)) {
        writes.push({ table: "import_raw_summary", id: rs.id, obd, data: { volume: r3(v), grossWeight: r3(w) } });
      }
    }
    const firstAfter: RawSummary | null = firstRs ? { ...firstRs, ...rsAfter.get(firstRs.id)! } : null;

    // (c) orders — derived from the FIRST raw summary (the import that created it).
    let oVolAfter: number | null = order?.volume ?? null;
    let oKgAfter:  number | null = order?.grossWeight ?? null;
    if (order && firstRs) {
      if (!eq(order.volume, firstRs.volume) || !eq(order.grossWeight, firstRs.grossWeight)) {
        // Not a straight copy of the first summary — the line sum after the fix counts as matching too.
        if (!(eq(order.volume, firstAfter!.volume) && eq(order.grossWeight, firstAfter!.grossWeight))) {
          odd.push(`${obd}: orders vol/kg ${fmt(order.volume)}/${fmt(order.grossWeight)} differ from first raw summary ${fmt(firstRs.volume)}/${fmt(firstRs.grossWeight)}`);
        }
      }
      if (isSapParser(firstRs.headerFile)) {
        oVolAfter = firstAfter!.volume;
        oKgAfter  = firstAfter!.grossWeight;
      } else {
        oVolAfter = r3(headerLitresLessStickers(firstRs.volume, firstRs.lines));
        oKgAfter  = r3(headerKgLessStickers(firstRs.grossWeight, firstRs.lines));
      }
      if (!eq(order.volume, oVolAfter) || !eq(order.grossWeight, oKgAfter)) {
        writes.push({ table: "orders", id: order.id, obd, data: { volume: oVolAfter, grossWeight: oKgAfter } });
      }
    }

    // (d) query summary — the route's own rebuild, mirrored.
    const q  = order?.querySnapshot ?? null;
    const qa = await queryAfter(active, firstAfter, catalog);
    qa.totalWeight = r3(qa.totalWeight)!;
    qa.totalVolume = r3(qa.totalVolume)!;
    let otherChange = "";
    if (q) {
      const o: string[] = [];
      if (q.totalLines   !== qa.totalLines)   o.push(`totalLines ${q.totalLines}->${qa.totalLines}`);
      if (q.totalUnitQty !== qa.totalUnitQty) o.push(`totalUnitQty ${q.totalUnitQty}->${qa.totalUnitQty}`);
      if (q.hasTinting   !== qa.hasTinting)   o.push(`hasTinting ${q.hasTinting}->${qa.hasTinting}`);
      otherChange = o.join("; ");
      if (otherChange) odd.push(`${obd}: query summary would also change ${otherChange} (NOT written — out of scope)`);
      const data: Record<string, number | string | null> = {};
      if (!eq(q.totalVolume, qa.totalVolume))   data.totalVolume  = qa.totalVolume;
      if (!eq(q.totalWeight, qa.totalWeight))   data.totalWeight  = qa.totalWeight;
      if (q.articleTag   !== qa.articleTag)     data.articleTag   = qa.articleTag;
      if (q.totalArticle !== qa.totalArticle)   data.totalArticle = qa.totalArticle;
      if (Object.keys(data).length > 0) writes.push({ table: "import_obd_query_summary", id: q.id, obd, data });
      if (qa.totalVolume > q.totalVolume + 0.001) odd.push(`${obd}: totalVolume goes UP ${q.totalVolume} -> ${qa.totalVolume}`);
      if (qa.totalWeight > q.totalWeight + 0.001) odd.push(`${obd}: totalWeight goes UP ${q.totalWeight} -> ${qa.totalWeight}`);
      if (qa.totalArticle > q.totalArticle)       odd.push(`${obd}: totalArticle goes UP ${q.totalArticle} -> ${qa.totalArticle}`);
      if (qa.articleTag === null)                 odd.push(`${obd}: articleTag AFTER is null`);
    } else if (order) {
      odd.push(`${obd}: order ${order.id} has NO query summary row (the route would create one; this script does not)`);
    }
    if (!order) odd.push(`${obd}: no orders row`);
    for (const v of [oVolAfter, oKgAfter, qa.totalVolume, qa.totalWeight]) {
      if (v !== null && v < 0) odd.push(`${obd}: negative AFTER value ${v}`);
    }

    // context
    const inv = invoices.filter((i) => i.orderId === order?.id);
    const onTrip = !!order && (order.tripDropId !== null || order.partlyOnTrip || inv.some((i) => i.tripDropId !== null));
    const dispatched = !!order && (order.workflowStage === "dispatched" || order.workflowStage === "closed" || inv.some((i) => i.isDispatched));
    if (onTrip) onTripCount++;
    if (dispatched) dispatchedCount++;
    if (order && freightSet.has(order.id)) freightCount++;
    const bs = bySource.get(source) ?? { bills: 0, lines: 0 };
    bs.bills++; bs.lines += stickers.length; bySource.set(source, bs);
    stickerLineTotal += stickers.length;

    csv.push([
      obd, source, order?.workflowStage, order?.materialType, order?.isRemoved, onTrip, dispatched,
      stickers.length, tagBefore, tagAfter,
      rsList.map((rs) => `#${rs.id}:${ba(rs.volume, rsAfter.get(rs.id)!.volume)}`).join(" "),
      rsList.map((rs) => `#${rs.id}:${ba(rs.grossWeight, rsAfter.get(rs.id)!.grossWeight)}`).join(" "),
      ba(order?.volume, oVolAfter), ba(order?.grossWeight, oKgAfter),
      ba(q?.totalVolume, qa.totalVolume), ba(q?.totalWeight, qa.totalWeight),
      ba(q?.articleTag, qa.articleTag), ba(q?.totalArticle, qa.totalArticle), otherChange,
    ].map(csvCell).join(","));

    if (obd === FIRST_OBD) {
      console.log(`\n=== ${FIRST_OBD} ===`);
      console.log(header.map((h, i) => `  ${h.padEnd(20)} ${csv[csv.length - 1].split(",")[i] ?? ""}`).join("\n"));
    }
  }

  // ── 4. Copies held elsewhere — REPORT ONLY, never changed here.
  const ids   = orderIds.length > 0 ? orderIds : [-1];
  const obds  = obdNumbers.length > 0 ? obdNumbers : ["-"];
  const lineIds = activeAll.filter(isStickerLine).map((l) => l.id);
  const copies: Array<[string, string, number]> = [];
  copies.push(["order_splits (totalVolume, articleTag)", "split rows on sticker bills",
    await prisma.order_splits.count({ where: { orderId: { in: ids } } })]);
  copies.push(["dispatch_plan_orders -> dispatch_plans (totalVolume, totalWeightKg)", "plan rows on sticker bills",
    await prisma.dispatch_plan_orders.count({ where: { orderId: { in: ids } } })]);
  copies.push(["pick_assignments.articleCount (supervisor-typed)", "rows with a count on sticker bills",
    await prisma.pick_assignments.count({ where: { orderId: { in: ids }, articleCount: { not: null } } })]);
  copies.push(["import_enriched_line_items (volumeLine, lineWeight) — a LINE copy", "rows for sticker lines",
    await prisma.import_enriched_line_items.count({ where: { rawLineItemId: { in: lineIds.length ? lineIds : [-1] } } })]);
  copies.push(["trip_report (NTS mirror: noArticle, volLt, netWeight, totWeight)", "rows whose deliveryNo is a sticker OBD",
    await prisma.tripReport.count({ where: { deliveryNo: { in: obds } } })]);
  copies.push(["ci_return_lines (litresPerTin, returnedQtyLitres)", "CI lines on a sticker SKU",
    await prisma.ci_return_lines.count({ where: { skuCode: { in: codes } } })]);
  const snap = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(DISTINCT s.id) AS n FROM load_plan_snapshot s, jsonb_array_elements(s.cards::jsonb) c,
       jsonb_array_elements(c->'billIds') b WHERE (b)::int = ANY($1::int[])`, ids);
  copies.push(["load_plan_snapshot.cards[].kg", "snapshots holding a sticker bill", Number(snap[0]?.n ?? 0)]);

  // ── 5. Report.
  const byTable = new Map<string, number>();
  for (const w of writes) byTable.set(w.table, (byTable.get(w.table) ?? 0) + 1);

  console.log("\n=== SUMMARY ===");
  console.log(`bills found: ${obdNumbers.length}   sticker lines found: ${stickerLineTotal}`);
  for (const [s, v] of Array.from(bySource.entries())) console.log(`  ${s.padEnd(18)} bills ${v.bills}  lines ${v.lines}`);
  console.log(`dispatched/closed (bill or any invoice row): ${dispatchedCount}   on a Floor trip: ${onTripCount}   on a freight trip: ${freightCount}`);
  console.log(`planned row writes: ${writes.length}`);
  for (const [t, n] of Array.from(byTable.entries())) console.log(`  ${t.padEnd(26)} ${n}`);
  console.log(`\nodd (${odd.length}):`);
  for (const o of odd) console.log("  " + o);
  console.log("\ncopies elsewhere (NOT changed):");
  for (const [t, what, n] of copies) console.log(`  ${String(n).padStart(5)}  ${t} — ${what}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const csvPath = path.join(OUT_DIR, "backfill-sticker-2026-10-29-dryrun.csv");
  fs.writeFileSync(csvPath, csv.join("\n") + "\n");
  const quoteTable: Record<string, string> = {
    import_raw_line_items: "import_raw_line_items", import_raw_summary: "import_raw_summary",
    orders: "orders", import_obd_query_summary: "import_obd_query_summary",
  };
  const sql = writes.map((w) =>
    `UPDATE "${quoteTable[w.table]}" SET ${Object.entries(w.data).map(([k, v]) => `"${k}" = ${sqlVal(v)}`).join(", ")}` +
    (w.table === "orders" ? `, "updatedAt" = now()` : "") +
    ` WHERE id = ${w.id}; -- ${w.obd}`);
  // One read-only check at the end: 9110462350 alone, then all sticker bills.
  // Every value ::text so the UNION ALL columns line up.
  const obdList = obdNumbers.map((o) => sqlVal(o)).join(", ");
  const checkRow = (label: string, where: string): string => `SELECT ${sqlVal(label)}::text AS scope,
  (SELECT COUNT(*) FROM orders o WHERE ${where})::text AS bills,
  (SELECT string_agg(t || ' x' || n, ', ') FROM (SELECT COALESCE(l."articleTag", 'null') AS t, COUNT(*) AS n
     FROM import_raw_line_items l JOIN orders o ON o."obdNumber" = l."obdNumber"
     WHERE ${where} AND l."skuCodeRaw" IN (${codes.map((c) => sqlVal(c)).join(", ")}) GROUP BY 1) x)::text AS sticker_line_tags,
  (SELECT SUM(q."totalVolume") FROM import_obd_query_summary q JOIN orders o ON o.id = q."orderId" WHERE ${where})::text AS q_total_volume,
  (SELECT SUM(q."totalWeight") FROM import_obd_query_summary q JOIN orders o ON o.id = q."orderId" WHERE ${where})::text AS q_total_weight,
  (SELECT string_agg(t || ' x' || n, ', ') FROM (SELECT COALESCE(q."articleTag", 'null') AS t, COUNT(*) AS n
     FROM import_obd_query_summary q JOIN orders o ON o.id = q."orderId" WHERE ${where} GROUP BY 1) x)::text AS q_article_tag,
  (SELECT SUM(q."totalArticle") FROM import_obd_query_summary q JOIN orders o ON o.id = q."orderId" WHERE ${where})::text AS q_total_article,
  (SELECT SUM(o.volume) || ' (nulls ' || COUNT(*) FILTER (WHERE o.volume IS NULL) || ')' FROM orders o WHERE ${where})::text AS orders_volume,
  (SELECT SUM(o."grossWeight") || ' (nulls ' || COUNT(*) FILTER (WHERE o."grossWeight" IS NULL) || ')' FROM orders o WHERE ${where})::text AS orders_gross_weight`;
  const check = `\n-- CHECK (read-only)\n${checkRow(FIRST_OBD, `o."obdNumber" = ${sqlVal(FIRST_OBD)}`)}
UNION ALL
${checkRow(`all ${obdNumbers.length} sticker bills`, `o."obdNumber" IN (${obdList})`)};\n`;

  const sqlPath = path.join(OUT_DIR, "backfill-sticker-2026-10-29.sql");
  fs.writeFileSync(sqlPath,
    `-- Generated by scripts/backfill-sticker-2026-10-29.ts (dry run). Supabase SQL Editor: paste and run start to finish.\n` +
    `${sql.join("\n")}\n${check}`);
  console.log(`\nCSV: ${csvPath}\nSQL: ${sqlPath}`);

  // ── 6. Apply — sequential, row by row, only with --apply.
  if (APPLY) {
    // Order matters: raw summaries before the query summary that reads them.
    const rank: Record<string, number> = { import_raw_line_items: 0, import_raw_summary: 1, orders: 2, import_obd_query_summary: 3 };
    const ordered = writes.slice().sort((a, b) => rank[a.table] - rank[b.table]);
    let done = 0;
    for (const w of ordered) {
      if (w.table === "import_raw_line_items")    await prisma.import_raw_line_items.update({ where: { id: w.id }, data: w.data });
      if (w.table === "import_raw_summary")       await prisma.import_raw_summary.update({ where: { id: w.id }, data: w.data });
      if (w.table === "orders")                   await prisma.orders.update({ where: { id: w.id }, data: w.data });
      if (w.table === "import_obd_query_summary") await prisma.import_obd_query_summary.update({ where: { id: w.id }, data: w.data });
      done++;
    }
    console.log(`\nAPPLIED ${done} row writes.`);
  } else {
    console.log("\nDRY RUN — nothing written.");
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
