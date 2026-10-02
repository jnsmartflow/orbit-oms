/**
 * scripts/parity-tint-marker.ts — READ-ONLY live watch for the Tint quick win (2026-09-30).
 *
 *   npx tsx scripts/parity-tint-marker.ts [minutes=60] [everySec=15]
 *
 * DATABASE_URL from .env (production). SELECTs only — no writes, no DDL, no env values printed.
 *
 * Every window it computes:
 *   OLD signature  = (count, MAX(orders.updatedAt)) over the marker's exact predicate — the
 *                    body of app/api/tint/manager/marker/route.ts BEFORE the quick win, frozen below;
 *   NEW signature  = (count, GREATEST(orders max, m)) where m = the widened route's one extra
 *                    statement (max updatedAt of tint_assignments, order_splits, delivery_challans);
 *   BOARD fingerprint = count + MAX(updatedAt) over the tint set's orders AND all their
 *                    tint_assignments / order_splits / delivery_challans (a superset of "active").
 * Between windows: fingerprint moved but NEW did not → MISSED (must be 0). Fingerprint moved but
 * OLD did not → the blind 60 s tick's real work. NEW moved, fingerprint did not → false fire.
 *
 * The three reads are not one snapshot (no $transaction, CORE §3), so each window re-reads OLD and
 * NEW after the fingerprint; if either moved in between, the window is re-taken (up to 3 tries).
 * Exit 1 if MISSED > 0.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { getHideExclusion } from "@/lib/hide/visibility";
import { TINT_STATUS_DONE } from "@/lib/tint/assignment-status";
import { getBaseOperatorId } from "@/lib/tint/base-operator";
import { Prisma } from "@prisma/client";
import { getISTDayRange } from "@/lib/dates";
import { floorBoardWhere, floorHoldWhere, getISTTodayDateOnly, getFloorCancelled } from "@/lib/floor/queries";
import { BASE_BILL_WHERE } from "@/lib/tint/manager-bill";
import { PROJECT_SMU_NAMES } from "@/lib/billing/pick-delete-rule";
import { getTintBaseRows } from "@/lib/tint/base-feed";

type Sig = { count: number; latest: string | null };

// ── 2026-10-01 (Base tab — code-discovery-2026-10-01-tint-manager-base-tab.md §F)
// OLD = the step-9 route (tint block arms 1–5 + seven stamps, ci_returns tint-only).
// NEW = the Base route: the tint block OR arm 6 (Floor's floorBoardWhere ∩ Base),
// arm 7 (held Base), arm 8 (Base cancelled today), and the ci_returns stamp widened
// to tint OR project-SMU bills. The FINGERPRINT adds the Base tab (the feed's own
// rows, through the route's builder, cut-off included), the Hold tab's Base rows
// and the CI tab's Base rows + their CIs.

// ── 2026-10-01 (Tint Manager tabs build step 9) ────────────────────────────
// OLD = the marker as it stood before step 9 (arms 1–3 + three stamp tables).
// NEW = the widened route: + arm 4 (held tint bills, any stage), arm 5 (tint
// bills cancelled with an orders write today) and four stamps (tint ci_returns,
// pick_delete_decisions, the placeholder's tinter_issue_entries / _b createdAt).
// The FINGERPRINT is the board PLUS the four tabs' sources — what a person on
// the Tint Manager can see change — so MISSED = "a tab or the board moved and
// the NEW marker did not".

/** The marker's predicate (UTC-midnight "today" kept, as the route). wide = with arms 4–5. */
async function markerWhere(wide: boolean): Promise<Prisma.ordersWhereInput> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const hideExclusion = await getHideExclusion();
  const baseOperatorId = await getBaseOperatorId();
  const notBase = baseOperatorId !== null ? { assignedToId: { not: baseOperatorId } } : {};
  const arms: Prisma.ordersWhereInput[] = [
    { workflowStage: { in: ["pending_tint_assignment", "tint_assigned", "tinting_in_progress"] } },
    { tintAssignments: { some: { status: TINT_STATUS_DONE, completedAt: { gte: startOfToday }, ...notBase } } },
    { splits: { some: { status: TINT_STATUS_DONE, completedAt: { gte: startOfToday }, ...notBase } } },
  ];
  if (wide) {
    arms.push({ dispatchStatus: "hold" });
    arms.push({ workflowStage: "cancelled", updatedAt: { gte: startOfToday } });
  }
  return {
    AND: [
      { orderType: "tint", isRemoved: false, OR: arms },
      hideExclusion,
    ],
  };
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const later = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null ? a : a >= b ? a : b; // ISO strings of one format sort as time

async function oldSig(where: Prisma.ordersWhereInput): Promise<Sig> {
  const agg = await prisma.orders.aggregate({ where, _count: true, _max: { updatedAt: true } });
  return { count: agg._count, latest: iso(agg._max.updatedAt) };
}

/** The Base route's predicate: the step-9 tint block OR arms 6–8, AND hide — the route's, verbatim. */
async function baseRouteWhere(): Promise<Prisma.ordersWhereInput> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const tint = await markerWhere(true); // { AND: [tintBlock, hide] }
  const [tintBlock, hide] = (tint.AND as Prisma.ordersWhereInput[]);
  return {
    AND: [
      { OR: [
        tintBlock,
        { AND: [floorBoardWhere(getISTDayRange(), getISTTodayDateOnly()), BASE_BILL_WHERE] },
        { AND: [floorHoldWhere(), BASE_BILL_WHERE] },
        { AND: [{ isRemoved: false, workflowStage: "cancelled", updatedAt: { gte: startOfToday } }, BASE_BILL_WHERE] },
      ] },
      hide,
    ],
  };
}

/** OLD route: the step-9 statement (arms 1–5 + seven stamps, tint-only CIs). */
async function oldRouteSig(): Promise<Sig> {
  return routeSig(await markerWhere(true), false);
}

/** NEW route: the Base statement (arms 1–8 + seven stamps, tint ∪ project-SMU CIs). */
async function newRouteSig(): Promise<Sig> {
  return routeSig(await baseRouteWhere(), true);
}

async function routeSig(where: Prisma.ordersWhereInput, wideCi: boolean): Promise<Sig> {
  const base = await oldSig(where);
  const ciJoin = wideCi
    ? Prisma.sql`(o."orderType" = 'tint' OR o.smu IN (${Prisma.join([...PROJECT_SMU_NAMES])}))`
    : Prisma.sql`o."orderType" = 'tint'`;
  const baseOperatorId = await getBaseOperatorId();
  const baseTiTerms = baseOperatorId !== null
    ? Prisma.sql`,
      (SELECT max(e."createdAt") FROM tinter_issue_entries e
        WHERE e."tintAssignmentId" IN (SELECT id FROM tint_assignments WHERE "assignedToId" = ${baseOperatorId})),
      (SELECT max(e."createdAt") FROM tinter_issue_entries_b e
        WHERE e."tintAssignmentId" IN (SELECT id FROM tint_assignments WHERE "assignedToId" = ${baseOperatorId}))`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<{ m: Date | null }[]>`
    SELECT GREATEST(
      (SELECT max("updatedAt") FROM tint_assignments),
      (SELECT max("updatedAt") FROM order_splits),
      (SELECT max("updatedAt") FROM delivery_challans),
      (SELECT max(c."updatedAt") FROM ci_returns c
         JOIN orders o ON o.id = c."orderId" AND ${ciJoin}),
      (SELECT max("updatedAt") FROM pick_delete_decisions)${baseTiTerms}) AS m`;
  return { count: base.count, latest: later(base.latest, iso(rows[0]?.m ?? null)) };
}

async function fingerprint(): Promise<string> {
  // The board AND the tabs: the widened tint set (held + cancelled-today
  // included), its child tables, and the four tab sources — counted too, so a
  // row added or removed registers even when no max moves.
  const where = await markerWhere(true);
  const set = await prisma.orders.findMany({ where, select: { id: true, updatedAt: true } });
  const ids = set.map((o) => o.id);
  let max: string | null = null;
  for (const o of set) max = later(max, iso(o.updatedAt));
  if (ids.length > 0) {
    const ta = await prisma.tint_assignments.aggregate({ where: { orderId: { in: ids } }, _max: { updatedAt: true } });
    const os = await prisma.order_splits.aggregate({ where: { orderId: { in: ids } }, _max: { updatedAt: true } });
    const dc = await prisma.delivery_challans.aggregate({ where: { orderId: { in: ids } }, _max: { updatedAt: true } });
    max = later(max, iso(ta._max.updatedAt));
    max = later(max, iso(os._max.updatedAt));
    max = later(max, iso(dc._max.updatedAt));
  }
  // The placeholder by id (lib/tint/base-operator.ts — never retype its email). -1 = none.
  const baseId = (await getBaseOperatorId()) ?? -1;
  const tabs = await prisma.$queryRaw<{ ci: string; ci_n: bigint; pd: string; pd_n: bigint; ti: string; ti_n: bigint }[]>`
    SELECT
      coalesce(max(c."updatedAt")::text, '-') AS ci, count(c.id) AS ci_n,
      (SELECT coalesce(max("updatedAt")::text, '-') FROM pick_delete_decisions) AS pd,
      (SELECT count(*) FROM pick_delete_decisions) AS pd_n,
      (SELECT coalesce(max(x.m)::text, '-') FROM (
          SELECT max(e."createdAt") AS m FROM tinter_issue_entries e
            JOIN tint_assignments a ON a.id = e."tintAssignmentId"
            WHERE a."assignedToId" = ${baseId}
          UNION ALL
          SELECT max(e."createdAt") FROM tinter_issue_entries_b e
            JOIN tint_assignments a ON a.id = e."tintAssignmentId"
            WHERE a."assignedToId" = ${baseId}) x) AS ti,
      (SELECT count(*) FROM tinter_issue_entries e JOIN tint_assignments a ON a.id = e."tintAssignmentId"
          WHERE a."assignedToId" = ${baseId}) AS ti_n
    FROM ci_returns c JOIN orders o ON o.id = c."orderId" AND o."orderType" = 'tint'`;
  const t = tabs[0];

  // ── The Base tab (2026-10-01) — what a person sees there, via the route's own builders.
  const baseRows = await getTintBaseRows();
  const hide = await getHideExclusion();
  const heldBase = await prisma.orders.findMany({ where: { AND: [floorHoldWhere(), BASE_BILL_WHERE, hide] }, select: { id: true } });
  const cancBase = await getFloorCancelled("All", undefined, undefined, BASE_BILL_WHERE);
  const baseIds = Array.from(new Set([...baseRows.map((r) => r.orderId), ...heldBase.map((r) => r.id), ...cancBase.map((r) => r.orderId)]));
  const baseMax = baseIds.length
    ? iso((await prisma.orders.aggregate({ where: { id: { in: baseIds } }, _max: { updatedAt: true } }))._max.updatedAt)
    : null;
  const baseCi = cancBase.length
    ? await prisma.ci_returns.aggregate({ where: { orderId: { in: cancBase.map((r) => r.orderId) } }, _max: { updatedAt: true }, _count: true })
    : null;
  const baseFp = `base ${baseRows.length}/${heldBase.length}/${cancBase.length}|${baseMax ?? "-"}|bci ${iso(baseCi?._max.updatedAt ?? null) ?? "-"}/${baseCi?._count ?? 0}`;

  return `${set.length}|${max ?? "-"}|ci ${t?.ci}/${t?.ci_n}|pd ${t?.pd}/${t?.pd_n}|ti ${t?.ti}/${t?.ti_n}|${baseFp}`;
}

const key = (s: Sig) => `${s.count}|${s.latest ?? "-"}`;

type Window = { at: string; old: string; neu: string; fp: string; tries: number };

async function takeWindow(): Promise<Window> {
  let last: Window | null = null;
  for (let tries = 1; tries <= 3; tries++) {
    const o1 = key(await oldRouteSig());
    const n1 = key(await newRouteSig());
    const fp = await fingerprint();
    const o2 = key(await oldRouteSig());
    const n2 = key(await newRouteSig());
    last = { at: new Date().toISOString(), old: o2, neu: n2, fp, tries };
    if (o1 === o2 && n1 === n2) return last;
  }
  return last!;
}

async function main(): Promise<void> {
  const minutes = Number(process.argv[2] ?? 60);
  const everySec = Number(process.argv[3] ?? 15);
  const total = Math.max(2, Math.round((minutes * 60) / everySec));
  console.log(`[parity-tint-marker] ${total} windows, every ${everySec}s (read-only)`);

  const windows: Window[] = [];
  const started = Date.now();
  for (let i = 0; i < total; i++) {
    const due = started + i * everySec * 1000;
    const wait = due - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      windows.push(await takeWindow());
    } catch (e) {
      console.log(`  window ${i}: read failed (${String(e).slice(0, 120)}) — skipped`);
    }
  }

  let fpChanges = 0, missed = 0, oldMissed = 0, falseFires = 0, unstable = 0;
  const missedDetail: string[] = [];
  const oldMissedDetail: string[] = [];
  for (let i = 1; i < windows.length; i++) {
    const a = windows[i - 1], b = windows[i];
    if (b.tries > 1) unstable++;
    const fpMoved = a.fp !== b.fp, newMoved = a.neu !== b.neu, oldMoved = a.old !== b.old;
    if (fpMoved) fpChanges++;
    if (fpMoved && !newMoved) { missed++; missedDetail.push(`${b.at}  fp ${a.fp} → ${b.fp}  new ${b.neu}`); }
    if (fpMoved && !oldMoved) { oldMissed++; oldMissedDetail.push(`${b.at}  fp ${a.fp} → ${b.fp}  old ${b.old}`); }
    if (newMoved && !fpMoved) falseFires++;
  }

  console.log("");
  console.log("| measure | value |");
  console.log("|---|---|");
  console.log(`| windows taken | ${windows.length} (compared pairs ${Math.max(0, windows.length - 1)}) |`);
  console.log(`| windows re-taken (a write landed mid-read) | ${unstable} |`);
  console.log(`| board + tabs fingerprint changes | ${fpChanges} |`);
  console.log(`| **MISSED** — fingerprint moved, NEW signature did not | **${missed}** |`);
  console.log(`| OLD (step-9, pre-Base) signature missed | ${oldMissed} |`);
  console.log(`| NEW false fires (moved, board did not) | ${falseFires} |`);
  if (missedDetail.length) { console.log("\nMISSED windows:"); missedDetail.forEach((l) => console.log("  " + l)); }
  if (oldMissedDetail.length) { console.log("\nOLD-missed windows:"); oldMissedDetail.forEach((l) => console.log("  " + l)); }
  console.log(missed === 0 ? "\nPASS — 0 missed" : "\nFAIL — missed > 0");
  await prisma.$disconnect();
  process.exit(missed === 0 ? 0 : 1);
}

void main();
