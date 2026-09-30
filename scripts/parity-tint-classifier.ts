/**
 * scripts/parity-tint-classifier.ts — READ-ONLY parity for tint step 3 (2026-09-30).
 *
 *   npx tsx scripts/parity-tint-classifier.ts
 *
 * DATABASE_URL from .env (production). SELECTs only — no writes, no DDL, no env values printed.
 *
 * Replays TODAY's live_changes (IST midnight → now, entities order + config) in 15 s windows through the
 * REAL classifier SQL (lib/tint/live-feed.ts) with held = [] — the strict case; in production `held` only
 * ever keeps MORE. For every window the classifier would DROP ("nothing for you"), it checks that no
 * changed id is on the REAL board, computed with the routes' own Prisma predicates (hide rules, the
 * base-operator exclusion and Set B's stages included — the classifier ignores all three, so it must be
 * a superset):
 *   Manager  — app/api/tint/manager/orders Sets A–E  → a dropped window touching one = MISS (must be 0)
 *   Operator — app/api/tint/operator/my-orders Q1–Q4, per tint operator seen today → MISS (must be 0)
 * A window with a config change is always kept (config passes through), so it can never miss.
 *
 * ⚠ What a replay can and cannot prove. Board membership is evaluated NOW, not at each window's
 * time — history is not stored. So this proves the classifier's predicate is a SUPERSET of both real
 * predicates over every id that changed today (which is what "the fingerprint moved" means: every write
 * to an order, its tint_assignments / order_splits / delivery_challans lands in live_changes against that
 * order id). A bill that was on the board earlier and has LEFT it since is covered in production by the
 * client's `held` ids; windows touching such tint bills are listed as "left-board (held covers)", for
 * information. The marker-side live watch (scripts/parity-tint-marker.ts) is the time-true check.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { getHideExclusion } from "@/lib/hide/visibility";
import { getBaseOperatorId } from "@/lib/tint/base-operator";
import { TINT_STATUS_DONE } from "@/lib/tint/assignment-status";
import { SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";
import { classifyTintManager, filterTintOperatorOrderIds } from "@/lib/tint/live-feed";
import { managerStartOfToday, operatorStartOfToday } from "@/lib/tint/live-feed-rule";

const WINDOW_MS = 15_000;

/** The Manager board's order ids NOW — app/api/tint/manager/orders Sets A–E, verbatim predicates. */
async function realManagerBoard(now: Date): Promise<Set<number>> {
  const startOfToday = managerStartOfToday(now);
  const hideExclusion = await getHideExclusion();
  const baseOperatorId = await getBaseOperatorId();
  const a = await prisma.orders.findMany({
    where: { AND: [{ orderType: "tint", workflowStage: { in: ["pending_tint_assignment", "tint_assigned", "tinting_in_progress"] }, isRemoved: false }, hideExclusion] },
    select: { id: true },
  });
  const b = await prisma.orders.findMany({
    where: {
      AND: [
        {
          orderType: "tint",
          workflowStage: { in: ["pending_support", SUPPORT_DONE_OUTPUT] },
          isRemoved: false,
          tintAssignments: { some: { status: "tinting_done", completedAt: { gte: startOfToday } } },
        },
        hideExclusion,
      ],
    },
    select: { id: true },
  });
  const c = await prisma.order_splits.findMany({
    where: { status: { in: ["tint_assigned", "tinting_in_progress"] }, order: { AND: [{ isRemoved: false }, hideExclusion] } },
    select: { orderId: true },
  });
  const d = await prisma.order_splits.findMany({
    where: { status: "tinting_done", completedAt: { gte: startOfToday }, order: { AND: [{ isRemoved: false }, hideExclusion] } },
    select: { orderId: true },
  });
  const e = await prisma.tint_assignments.findMany({
    where: {
      status: "tinting_done",
      completedAt: { gte: startOfToday },
      order: { AND: [{ isRemoved: false }, hideExclusion] },
      ...(baseOperatorId !== null ? { assignedToId: { not: baseOperatorId } } : {}),
    },
    select: { orderId: true },
  });
  return new Set([...a.map((r) => r.id), ...b.map((r) => r.id), ...c.map((r) => r.orderId), ...d.map((r) => r.orderId), ...e.map((r) => r.orderId)]);
}

/** One operator's my-orders ids NOW — app/api/tint/operator/my-orders Q1–Q4 (non-see-all), verbatim. */
async function realOperatorSet(userId: number, now: Date): Promise<Set<number>> {
  const startOfToday = operatorStartOfToday(now);
  const hideExclusion = await getHideExclusion();
  const q1 = await prisma.orders.findMany({
    where: {
      AND: [
        {
          workflowStage: { in: ["tint_assigned", "tinting_in_progress"] },
          isRemoved: false,
          tintAssignments: { some: { assignedToId: userId, status: { notIn: ["done", "skipped"] } } },
        },
        hideExclusion,
      ],
    },
    select: { id: true },
  });
  const q2 = await prisma.order_splits.findMany({
    where: { assignedToId: userId, status: { in: ["tint_assigned", "tinting_in_progress"] }, order: { AND: [{ isRemoved: false }, hideExclusion] } },
    select: { orderId: true },
  });
  const q3 = await prisma.tint_assignments.findMany({
    where: { assignedToId: userId, status: "tinting_done", completedAt: { gte: startOfToday }, order: { AND: [{ isRemoved: false }, hideExclusion] } },
    select: { orderId: true },
  });
  const q4 = await prisma.order_splits.findMany({
    where: {
      assignedToId: userId,
      status: { in: ["tinting_done", "pending_support", "dispatch_confirmation", "dispatched"] },
      completedAt: { gte: startOfToday },
      order: { AND: [{ isRemoved: false }, hideExclusion] },
    },
    select: { orderId: true },
  });
  return new Set([...q1.map((r) => r.id), ...q2.map((r) => r.orderId), ...q3.map((r) => r.orderId), ...q4.map((r) => r.orderId)]);
}

type Row = { at: Date; entity: string; entityId: string };

async function main(): Promise<void> {
  const now = new Date();
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT "createdAt" AS at, entity, "entityId"
      FROM live_changes
     WHERE entity IN ('order', 'config')
       AND "createdAt" >= (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')) AT TIME ZONE 'Asia/Kolkata'
     ORDER BY "txId", seq`;

  // 15 s windows (by createdAt)
  const windows = new Map<number, { orders: Set<number>; config: boolean }>();
  for (const r of rows) {
    const k = Math.floor(new Date(r.at).getTime() / WINDOW_MS);
    let w = windows.get(k);
    if (!w) { w = { orders: new Set(), config: false }; windows.set(k, w); }
    if (r.entity === "config") w.config = true;
    else if (/^\d+$/.test(r.entityId)) w.orders.add(Number(r.entityId));
  }
  const keys = Array.from(windows.keys()).sort((a, b) => a - b);

  const board = await realManagerBoard(now);
  const allIds = Array.from(new Set(rows.filter((r) => r.entity === "order" && /^\d+$/.test(r.entityId)).map((r) => Number(r.entityId))));
  const tintish = new Set(
    allIds.length === 0
      ? []
      : (await prisma.$queryRaw<{ id: number }[]>`
          SELECT o.id FROM orders o WHERE o.id = ANY(${allIds}::int[])
             AND (o."orderType" = 'tint'
                  OR EXISTS (SELECT 1 FROM tint_assignments a WHERE a."orderId" = o.id)
                  OR EXISTS (SELECT 1 FROM order_splits s WHERE s."orderId" = o.id))`).map((r) => r.id),
  );

  // Operators seen today: anyone assigned a tint_assignments / order_splits row touched today.
  const ops = await prisma.$queryRaw<{ id: number }[]>`
    SELECT DISTINCT "assignedToId" AS id FROM (
      SELECT "assignedToId", "updatedAt" FROM tint_assignments
      UNION ALL SELECT "assignedToId", "updatedAt" FROM order_splits) x
     WHERE "assignedToId" IS NOT NULL
       AND "updatedAt" >= (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')) AT TIME ZONE 'Asia/Kolkata'
     ORDER BY 1`;
  const opSets = new Map<number, Set<number>>();
  for (const o of ops) opSets.set(o.id, await realOperatorSet(o.id, now));

  let kept = 0, dropped = 0, misses = 0, leftBoard = 0, missingTouchedWindows = 0;
  const missDetail: string[] = [];
  const timings: number[] = [];
  const opStats = new Map<number, { kept: number; dropped: number; misses: number; detail: string[] }>();
  for (const id of Array.from(opSets.keys())) opStats.set(id, { kept: 0, dropped: 0, misses: 0, detail: [] });

  for (const k of keys) {
    const w = windows.get(k)!;
    const ids = Array.from(w.orders);
    const at = new Date(k * WINDOW_MS).toISOString();

    const t0 = performance.now();
    const d = await classifyTintManager(ids, [], [], now);
    timings.push(performance.now() - t0);
    if (d.missingTouched) missingTouchedWindows++;
    const keep = d.keep.length > 0 || w.config;
    if (keep) kept++;
    else {
      dropped++;
      const onBoard = ids.filter((id) => board.has(id));
      if (onBoard.length > 0) { misses++; missDetail.push(`${at}  on-board ids dropped: ${onBoard.join(",")}`); }
      else if (ids.some((id) => tintish.has(id))) leftBoard++;
    }

    for (const [opId, set] of Array.from(opSets.entries())) {
      const s = opStats.get(opId)!;
      const mine = await filterTintOperatorOrderIds(ids, opId, false, [], now);
      if (mine.length > 0 || w.config) { s.kept++; continue; }
      s.dropped++;
      const his = ids.filter((id) => set.has(id));
      if (his.length > 0) { s.misses++; s.detail.push(`${at}  his ids dropped: ${his.join(",")}`); }
    }
  }

  timings.sort((a, b) => a - b);
  const med = timings.length ? timings[Math.floor(timings.length / 2)].toFixed(0) : "-";

  console.log(`[parity-tint-classifier] today's live_changes: ${rows.length} rows (order + config), ${allIds.length} distinct order ids`);
  console.log(`  real Manager board now: ${board.size} orders · tint operators seen today: ${ops.map((o) => o.id).join(", ") || "none"}`);
  console.log("");
  console.log("| Manager | value |");
  console.log("|---|---|");
  console.log(`| 15 s windows with a change | ${keys.length} |`);
  console.log(`| kept (tint id or config) | ${kept} |`);
  console.log(`| dropped ("nothing for you") | ${dropped} |`);
  console.log(`| **MISS** — dropped, but a changed id is on the real board | **${misses}** |`);
  console.log(`| dropped windows touching a tint bill not on the board now (left it; \`held\` covers) | ${leftBoard} |`);
  console.log(`| windows with missingTouched | ${missingTouchedWindows} |`);
  console.log(`| classifier statement, median (dev PC, incl. round trip) | ${med} ms |`);
  console.log("");
  console.log("| Operator | kept | dropped | **MISS** |");
  console.log("|---|---|---|---|");
  for (const [opId, s] of Array.from(opStats.entries())) console.log(`| ${opId} (${opSets.get(opId)!.size} in my-orders now) | ${s.kept} | ${s.dropped} | **${s.misses}** |`);
  const opMisses = Array.from(opStats.values()).reduce((n, s) => n + s.misses, 0);
  if (missDetail.length) { console.log("\nManager MISS windows:"); missDetail.forEach((l) => console.log("  " + l)); }
  for (const [opId, s] of Array.from(opStats.entries())) if (s.detail.length) { console.log(`\nOperator ${opId} MISS windows:`); s.detail.forEach((l) => console.log("  " + l)); }
  const pass = misses === 0 && opMisses === 0;
  console.log(pass ? "\nPASS — 0 misses" : "\nFAIL — misses > 0");
  await prisma.$disconnect();
  process.exit(pass ? 0 : 1);
}

void main();
