// lib/billing/pick-delete.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 BILLING "PICK DELETE" — the same-SO decision (2026-09-27, build step 5)
// ═══════════════════════════════════════════════════════════════════════════
//
// Design:  docs/prompts/drafts/web-update-2026-09-27-billing-pick-delete.md
// Plan:    docs/prompts/drafts/code-discovery-2026-09-27-pick-delete-build-plan.md §3
//
// OWNERSHIP. The duplicate-SO RULE is Picking's (lib/picking/duplicate-so.ts).
// The WRITES here (markAllOk, pickDelete) re-read the live group through its
// getTwinIdsBySo. The READS (open groups for the list and the marker) run the
// same rule as ONE SQL statement since 2026-09-30 (openGroupsCte, below) —
// each term copied from duplicate-so.ts, off-floor.ts and live-ci.ts with a
// line citation, and proven against the old two-step read by
// scripts/parity-pick-delete.ts. Change the rule there → change it here too.
// The DECISION is Billing's: only this module writes pick_delete_decisions.
//
// 🔴 TWO DESKS, ONE MODULE (2026-10-01, Tint Manager tabs build step 4 — plan
// docs/prompts/drafts/code-discovery-2026-10-01-tint-manager-build-plan.md §E).
// Every reader and writer below takes an `owner`: a group whose EVERY live twin
// is SMU 74/77 is decided on the Tint Manager ("tint"), every other group in
// Billing ("billing") — ownerOfSmus / PROJECT_SMU_NAMES in pick-delete-rule.ts,
// tm_owned in the SQL. Billing's routes pass "billing", the Tint Manager's
// (app/api/tint/manager/pick-delete/*) "tint". A writer re-reads the twins' SMU
// and refuses (409) a group that belongs to the other desk, so a stale tab on
// either side cannot decide the other's group. Same functions, never a copy.
//
// REUSED, NOT COPIED: offFloorRefusal (lib/floor/off-floor.ts) · findLiveCi +
// liveCiRefusal (lib/ci/live-ci.ts) · buildCancelNote("duplicate_bill")
// (lib/picking/cancel-reasons.ts) · resolveCatalogByCode
// (lib/picking/resolve-lines.ts) · sendToUser (lib/push/send.ts). Floor's and
// Picking's ROUTES are never called — billing staff hold neither tick.
//
// Server-only (Prisma). Sequential awaits, never prisma.$transaction (CORE §3).
// orderIds / keptOrderIds are ALWAYS written sorted ascending — the partial
// unique index pick_delete_decisions_all_ok_live_key depends on it.

import { Prisma } from "@prisma/client";
import { challanCancelRefusal } from "@/lib/challan-orders/cancel-guard";
import { prisma } from "@/lib/prisma";
import { getTwinIdsBySo } from "@/lib/picking/duplicate-so";
import {
  JS_TRIM_CHARS,
  PROJECT_SMU_NAMES,
  compareGroups,
  ownerOfSmus,
  type OpenGroupRow,
  type PickDeleteOwner,
} from "@/lib/billing/pick-delete-rule";
import { offFloorRefusal } from "@/lib/floor/off-floor";
import { findLiveCi, liveCiRefusal } from "@/lib/ci/live-ci";
import { buildCancelNote } from "@/lib/picking/cancel-reasons";
import { resolveCatalogByCode, type CatalogEntry } from "@/lib/picking/resolve-lines";
import { groupPickingDetailLines } from "@/lib/picking/group-lines";
import { sendToUser } from "@/lib/push/send";
import { STAGE_LADDER, SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";
import { istMonthRange } from "@/lib/billing/telephonic";
import type {
  PickDeleteBill,
  PickDeleteBillLines,
  PickDeleteDecidedRow,
  PickDeleteGroup,
  PickDeleteHint,
  PickDeleteLine,
  PickDeleteList,
  PickDeleteMarker,
} from "@/lib/billing/pick-delete-types";

// ── Scope ──────────────────────────────────────────────────────────────────

/** A group shows only while at least one bill is still BEFORE dispatch. */
const AFTER_DISPATCH_STAGES = ["dispatched", "closed"];

/** Waiting for tint — the one tint stage Pick delete can cancel (offFloorRefusal
 *  refuses tint_assigned / tinting_in_progress). Its Undo goes back to the tint
 *  queue, every other bill to pending_picking (owner ruling 2026-09-27). */
const WAITING_FOR_TINT = "pending_tint_assignment";

function sortAsc(ids: readonly number[]): number[] {
  return [...ids].sort((a, b) => a - b);
}

function sameSet(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = sortAsc(a);
  const sb = sortAsc(b);
  return sa.every((v, i) => v === sb[i]);
}

function stageLabel(stage: string): string {
  return STAGE_LADDER.find((s) => s.stage === stage)?.label ?? stage;
}

// ── Open groups — ONE statement (bounded rewrite, 2026-09-30) ─────────────
//
// Plan: docs/prompts/drafts/code-plan-2026-09-30-billing-live-feed.md §C.
// Update: docs/prompts/drafts/code-update-2026-09-30-billing-pick-delete-bounded.md
//
// WAS: fetch every open orders row (Prisma 5 does `distinct` in Node — 1,787
// rows on 2026-09-30), then every twin of those 1,775 SOs (1,791 rows in two
// `IN` chunks), then the bills, then one ci_returns read per candidate bill —
// ≈ 14 statements and ~3,600 rows every 10 s per desk. The old header called
// that "never a scan of the whole orders table"; it was exactly that, done in
// Node. Frozen copy for parity: scripts/parity-pick-delete-legacy.ts.
//
// NOW: the database groups, filters and checks in one statement and returns
// one row per open group (6 on 2026-09-30). It is still one pass over the
// live orders rows (a cached ~5 MB seq scan) — honest wording: bounded in
// round trips and rows shipped, not an index probe.
//
// Each term is the old rule, copied — never re-derived:
//   · twins = not removed, stage ≠ cancelled, SO not blank (the twin rule,
//     lib/picking/duplicate-so.ts getTwinIdsBySo :107-113; blank = JS trim(),
//     nonBlankDistinct :85-89 — JS_TRIM_CHARS makes btrim strip the same set);
//   · a group = ≥ 2 twins (getDuplicateGroups :163) with ≥ 1 bill still before
//     dispatch (the old step 1: stage ∉ cancelled / dispatched / closed);
//   · minus an active All OK set containing every current twin
//     (isAcknowledged :131-133, getActiveAllOkSets :140);
//   · actionable = some bill passes pickDeleteCheck (below): offFloorRefusal
//     (lib/floor/off-floor.ts :65-75 — cancelled, dispatched, on a trip,
//     tint_assigned / tinting_in_progress), legacy closed, and no live FULL CI
//     (lib/ci/live-ci.ts findLiveCi :34-40, predicate copied verbatim).
// Parameterised ($queryRaw tagged template) — no string building.

const OPEN_STAGE_EXCLUDED = ["cancelled", ...AFTER_DISPATCH_STAGES];
/** Stages offFloorRefusal refuses + legacy closed (pickDeleteCheck). */
const NOT_DELETABLE_STAGES = ["cancelled", "dispatched", "closed", "tint_assigned", "tinting_in_progress"];

function openGroupsCte(): Prisma.Sql {
  return Prisma.sql`
    grp AS (
      SELECT "soNumber" AS so, array_agg(id ORDER BY id) AS ids, max("updatedAt") AS latest,
             -- tm_owned: EVERY live twin is SMU 74/77 → the Tint Manager decides
             -- (2026-10-01). 🔴 The coalesce is LOAD-BEARING: bool_and IGNORES
             -- NULLs, so without it a group of (null-SMU bill, 74 bill) would read
             -- TRUE and vanish from Billing. A null SMU must count as "not
             -- project" — the same answer ownerOfSmus gives in JS.
             bool_and(coalesce("smu" = ANY (${PROJECT_SMU_NAMES as string[]}::text[]), false)) AS tm_owned
        FROM orders
       WHERE "isRemoved" = false
         AND "workflowStage" <> 'cancelled'
         AND "soNumber" IS NOT NULL
         AND btrim("soNumber", ${JS_TRIM_CHARS}) <> ''
       GROUP BY "soNumber"
      HAVING count(*) >= 2
         AND bool_or(NOT ("workflowStage" = ANY (${OPEN_STAGE_EXCLUDED}::text[])))
    ),
    open_groups AS (
      SELECT g.so, g.ids, g.latest, g.tm_owned,
             EXISTS (
               SELECT 1 FROM orders o
                WHERE o.id = ANY (g.ids)
                  AND NOT (o."workflowStage" = ANY (${NOT_DELETABLE_STAGES}::text[]))
                  AND o."tripDropId" IS NULL
                  AND NOT EXISTS (
                        SELECT 1 FROM ci_returns c
                         WHERE c."orderId" = o.id
                           AND c."isVoided" = false
                           AND c.status <> 'draft'
                           AND c."returnType" = 'full')
             ) AS actionable
        FROM grp g
       WHERE NOT EXISTS (
               SELECT 1 FROM pick_delete_decisions d
                WHERE d.kind = 'all_ok'
                  AND d."undoneAt" IS NULL
                  AND d."soNumber" = g.so
                  AND d."orderIds" @> g.ids)
    )`;
}

/** Every open (not acknowledged) same-SO group OF THIS OWNER, ONE statement. Ordered by SO. */
async function readOpenGroupRows(owner: PickDeleteOwner): Promise<OpenGroupRow[]> {
  return prisma.$queryRaw<OpenGroupRow[]>`
    WITH ${openGroupsCte()}
    SELECT so, ids, latest, actionable FROM open_groups
     WHERE tm_owned = ${owner === "tint"}
     ORDER BY so`;
}

/**
 * The open groups: SO → sorted live bill ids (≥ 2 live twins, ≥ 1 still before
 * dispatch, not covered by an active All OK). One statement — see above.
 */
export async function getOpenGroups(owner: PickDeleteOwner): Promise<Map<string, number[]>> {
  const rows = await readOpenGroupRows(owner);
  return new Map(rows.map((r) => [r.so, r.ids]));
}

// ── Refusal (Pick delete) ──────────────────────────────────────────────────

interface RefusalBill {
  id: number;
  workflowStage: string;
  tripDropId: number | null;
  tripNumber: string | null;
}

/** The result of pickDeleteCheck — `message` is the route's 409 text, `label`
 *  the few plain words the tab shows on a disabled button. */
export interface PickDeleteCheck {
  canDelete: boolean;
  label: string | null;
  message: string | null;
}

const ALLOWED: PickDeleteCheck = { canDelete: true, label: null, message: null };

function refused(label: string, message: string): PickDeleteCheck {
  return { canDelete: false, label, message };
}

/**
 * 🔴 THE ONE PICK DELETE RULE — used by the tab's list (per bill: canDelete +
 * label) AND by pickDelete() before it writes, so a button and the route can
 * never disagree. Floor cancel's refusals (offFloorRefusal: cancelled,
 * dispatched, on a trip, tint room) PLUS the legacy `closed` stage, no live
 * twin left, and a live CI (owner rulings 2026-09-27; findLiveCi is the rule
 * Picking cancel uses). `twinIds` = the SO's current live bill ids.
 *
 * The allow/refuse decision for the Floor half is offFloorRefusal's alone; the
 * short label is only chosen from the same facts once it has refused.
 */
export async function pickDeleteCheck(bill: RefusalBill, twinIds: readonly number[]): Promise<PickDeleteCheck> {
  const floor = offFloorRefusal({
    workflowStage: bill.workflowStage,
    tripDropId: bill.tripDropId,
    tripNumber: bill.tripNumber,
  });
  if (floor !== null) {
    const label =
      bill.workflowStage === "cancelled" ? "Already cancelled"
      : bill.workflowStage === "dispatched" ? "Dispatched"
      : bill.tripDropId !== null ? "On a trip"
      : "In tint room";
    return refused(label, floor);
  }
  if (bill.workflowStage === "closed") return refused("Old closed bill", "Old closed bill — it cannot be pick deleted");
  if (twinIds.length < 2 || !twinIds.includes(bill.id)) {
    return refused("No other live bill", "No other live bill on this SO");
  }
  const ci = await findLiveCi(bill.id);
  if (ci !== null) return refused("Has a CI", liveCiRefusal(ci, "cancelled"));
  return ALLOWED;
}

/** The route's form of the same rule: the 409 message, or null. */
export async function pickDeleteRefusal(bill: RefusalBill, twinIds: readonly number[]): Promise<string | null> {
  const check = await pickDeleteCheck(bill, twinIds);
  if (!check.canDelete) return check.message;
  return null;
}

// ── Lines (shared by the list and GET bill/[orderId]) ──────────────────────

/** The import_raw_line_items columns a bill's lines table needs. */
const LINE_SELECT = {
  id: true,
  skuCodeRaw: true,
  skuDescriptionRaw: true,
  unitQty: true,
  volumeLine: true,
  netWeight: true,
  totalWeight: true,
  articleTag: true,
  isTinting: true,
} satisfies Prisma.import_raw_line_itemsSelect;

type RawBillLine = Prisma.import_raw_line_itemsGetPayload<{ select: typeof LINE_SELECT }>;

/**
 * One bill's raw lines (lineId order) → the tab's lines. PURE. SAP per-batch
 * split lines are MERGED per SKU (qty summed) by Picking's own grouping
 * (lib/picking/group-lines.ts) — the tab compares bills SKU by SKU, so it must
 * never see raw batch rows. No findings map: this tab records none, so every
 * same-SKU bucket merges and each SKU is exactly one line.
 */
function mergeBillLines(rawLines: readonly RawBillLine[], catalog: Map<string, CatalogEntry>): PickDeleteLine[] {
  const tintingById = new Map(rawLines.map((l) => [l.id, l.isTinting]));
  return groupPickingDetailLines(rawLines, catalog, new Map()).map((l) => ({
    id: l.id,
    sku: l.sku,
    name: l.name,
    pack: l.pack,
    unitQty: l.qty,
    volumeLine: l.litres,
    // Same across a merged bucket (group-lines.ts: isTinting differed in zero
    // live groups), so the head line's value stands for the row.
    isTinting: tintingById.get(l.id) ?? false,
  }));
}

// ── List ───────────────────────────────────────────────────────────────────

const BILL_SELECT = {
  id: true,
  obdNumber: true,
  soNumber: true,
  workflowStage: true,
  obdEmailDate: true,
  orderDateTime: true,
  invoiceNo: true,
  tripDropId: true,
  shipToCustomerName: true,
  updatedAt: true,
  // The SMU name — the decided list's owner filter (ownerOfSmus, 2026-10-01).
  smu: true,
  tripDrop: { select: { trip: { select: { tripNumber: true } } } },
  customer: { select: { customerName: true } },
  shipToOverrideCustomer: { select: { customerName: true } },
  querySnapshot: { select: { totalVolume: true, articleTag: true } },
} satisfies Prisma.ordersSelect;

type BillRow = Prisma.ordersGetPayload<{ select: typeof BILL_SELECT }>;

function dealerOf(o: BillRow): string | null {
  // The board's chain: ship-to override, customer, SAP's own name.
  return o.shipToOverrideCustomer?.customerName ?? o.customer?.customerName ?? o.shipToCustomerName ?? null;
}

function punchedOf(o: BillRow): Date | null {
  return o.obdEmailDate ?? o.orderDateTime ?? null;
}

/** "sku|qty" keys, sorted — two bills with the same multiset read identical. */
function lineSignature(lines: { skuCodeRaw: string; unitQty: number }[]): string {
  return lines
    .map((l) => `${l.skuCodeRaw.trim()}|${l.unitQty}`)
    .sort()
    .join(",");
}

async function readBills(ids: number[]): Promise<Map<number, BillRow>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.orders.findMany({ where: { id: { in: ids } }, select: BILL_SELECT });
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * 🔴 THE ONE "WHICH GROUPS SHOW" RULE — the list AND the marker count both call
 * this, so the pill number always equals the groups on the tab (owner,
 * 2026-09-27). A group shows ONLY when at least one of its bills passes
 * pickDeleteCheck() — a group billing cannot act on (every bill on a trip,
 * dispatched, in the tint room, legacy closed or with a live CI) is not work.
 * A shown group keeps ALL its bills: the one that cannot go is still needed to
 * compare against. Replaced "at least one bill before dispatch" the same day.
 *
 * Picking's red Same SO flag is NOT this rule and does not change
 * (lib/picking/duplicate-so.ts) — a hidden group still flags on the boards.
 */
export async function getActionableGroups(owner: PickDeleteOwner): Promise<{
  /** SO → sorted live bill ids, shown groups only. */
  groups: Map<string, number[]>;
  /** Every open group's bill ids, shown or not — the marker's clock watches all. */
  openIds: number[];
  /** Bills of the SHOWN groups only (since 2026-09-30 — nothing reads the others). */
  billsById: Map<number, BillRow>;
  checks: Map<number, PickDeleteCheck>;
}> {
  // ONE statement finds the groups and which are actionable; the per-bill
  // reads below (bills, and pickDeleteCheck's CI read for a bill that passes
  // the cheap checks) run ONLY for the shown groups — 13 bills on 2026-09-30,
  // not every open bill. pickDeleteCheck still decides each bill's button and
  // label, so the list and the delete route keep sharing one rule; the SQL's
  // `actionable` only chooses which groups to look at.
  const rows = await readOpenGroupRows(owner);
  const openIds = rows.flatMap((r) => r.ids);
  const candidates = rows.filter((r) => r.actionable);
  const billsById = await readBills(candidates.flatMap((r) => r.ids));
  const checks = new Map<number, PickDeleteCheck>();
  const groups = new Map<string, number[]>();
  for (const { so: soNumber, ids } of candidates) {
    let any = false;
    for (const id of ids) {
      const r = billsById.get(id);
      if (!r) continue;
      // Sequential awaits (CORE §3). The CI read only runs for a bill that
      // passed the cheap stage/trip checks first.
      const check = await pickDeleteCheck(
        { id: r.id, workflowStage: r.workflowStage, tripDropId: r.tripDropId, tripNumber: r.tripDrop?.trip.tripNumber ?? null },
        ids,
      );
      checks.set(id, check);
      if (check.canDelete) any = true;
    }
    if (any) groups.set(soNumber, ids);
  }
  return { groups, openIds, billsById, checks };
}

export async function listPickDelete(month: string, owner: PickDeleteOwner): Promise<PickDeleteList> {
  const range = istMonthRange(month);
  if (range === null) throw new Error(`Invalid month "${month}"`);

  // ── Open groups — only those billing can act on (getActionableGroups) ──
  const { groups, billsById, checks } = await getActionableGroups(owner);
  const allIds = Array.from(groups.values()).flat();

  // ONE batched line read for EVERY shown bill (hint, line counts AND the cards'
  // lines tables), then ONE catalog resolution for every SKU — lines ship with
  // the list since 2026-09-27; the per-bill fetch was too slow. lineId order is
  // kept per OBD, which groupPickingDetailLines needs.
  const obds = allIds.map((id) => billsById.get(id)?.obdNumber).filter((o): o is string => Boolean(o));
  const lineRows =
    obds.length > 0
      ? await prisma.import_raw_line_items.findMany({
          where: { obdNumber: { in: obds }, lineStatus: "active" },
          select: { obdNumber: true, ...LINE_SELECT },
          orderBy: [{ obdNumber: "asc" }, { lineId: "asc" }],
        })
      : [];
  const linesByObd = new Map<string, RawBillLine[]>();
  for (const l of lineRows) {
    const list = linesByObd.get(l.obdNumber);
    if (list) list.push(l);
    else linesByObd.set(l.obdNumber, [l]);
  }
  // sku_master_v2 by `material` ONLY — never enrichedLineItem.sku (CORE §13).
  const catalog = await resolveCatalogByCode(lineRows.map((l) => l.skuCodeRaw));

  const out: PickDeleteGroup[] = [];
  const groupEntries = Array.from(groups.entries());
  for (const [soNumber, ids] of groupEntries) {
    const rows = ids.map((id) => billsById.get(id)).filter((r): r is BillRow => r !== undefined);
    if (rows.length < 2) continue;

    const bills: PickDeleteBill[] = [];
    for (const r of rows) {
      // THE SAME rule pickDelete() runs before it writes — one function, already
      // run once per bill by getActionableGroups.
      const check = checks.get(r.id) ?? { canDelete: false, label: null, message: null };
      const punched = punchedOf(r);
      bills.push({
        orderId: r.id,
        obdNumber: r.obdNumber,
        stage: r.workflowStage,
        stageLabel: stageLabel(r.workflowStage),
        punchedAt: punched ? punched.toISOString() : null,
        volume: r.querySnapshot?.totalVolume ?? null,
        articleTag: r.querySnapshot?.articleTag ?? null,
        // DISTINCT SKUs, not raw rows — the count of the tab's lines table, whose
        // SAP batch splits are merged per SKU (mergeBillLines).
        lineCount: new Set((linesByObd.get(r.obdNumber) ?? []).map((l) => l.skuCodeRaw)).size,
        lines: mergeBillLines(linesByObd.get(r.obdNumber) ?? [], catalog),
        invoiceNo: r.invoiceNo,
        tripNumber: r.tripDrop?.trip.tripNumber ?? null,
        canDelete: check.canDelete,
        reason: check.label,
        refusal: check.message,
      });
    }

    const sigs = rows
      .map((r) => linesByObd.get(r.obdNumber) ?? [])
      .filter((ls) => ls.length > 0)
      .map(lineSignature);
    const hint: PickDeleteHint = new Set(sigs).size < sigs.length ? "double_punch" : "split";

    const punches = rows.map(punchedOf).filter((d): d is Date => d !== null).map((d) => d.getTime());
    out.push({
      soNumber,
      customerName: dealerOf(rows[0]),
      firstPunchAt: punches.length > 0 ? new Date(Math.min(...punches)).toISOString() : null,
      hint,
      orderIds: sortAsc(ids),
      bills,
    });
  }
  // Oldest group first; an unknown punch sorts last; then SO number (2026-09-30:
  // a tie no longer falls back on the order the database returned twins in).
  out.sort(compareGroups);

  // ── Decided list, the IST month, newest first ──
  const decisions = await prisma.pick_delete_decisions.findMany({
    where: { decidedAt: { gte: range.start, lt: range.end } },
    orderBy: [{ decidedAt: "desc" }, { id: "desc" }],
    select: {
      id: true, kind: true, soNumber: true, orderIds: true, deletedOrderId: true, keptOrderIds: true,
      decidedAt: true, undoneAt: true,
      decidedBy: { select: { name: true } },
      undoneBy: { select: { name: true } },
    },
  });
  const decidedIds = Array.from(new Set(decisions.flatMap((d) => d.orderIds)));
  const decidedBills = await readBills(decidedIds);
  const obdOf = (id: number) => decidedBills.get(id)?.obdNumber ?? `#${id}`;

  // Only THIS desk's decisions (2026-10-01): a decision belongs to whoever owns
  // its group — ownerOfSmus over the SMU of every bill it was taken against.
  // Derived, never stored; orders.smu does not change after import. A bill that
  // cannot be read reads as no SMU, i.e. Billing — the safe side.
  const mine = decisions.filter(
    (d) => ownerOfSmus(d.orderIds.map((id) => decidedBills.get(id)?.smu ?? null)) === owner,
  );

  const decided: PickDeleteDecidedRow[] = mine.map((d) => {
    const first = decidedBills.get(d.orderIds[0]);
    const deleted = d.deletedOrderId !== null ? decidedBills.get(d.deletedOrderId) : undefined;
    return {
      id: d.id,
      kind: d.kind === "pick_delete" ? "pick_delete" : "all_ok",
      soNumber: d.soNumber,
      customerName: first ? dealerOf(first) : null,
      obdNumbers: d.kind === "pick_delete" && d.deletedOrderId !== null ? [obdOf(d.deletedOrderId)] : d.orderIds.map(obdOf),
      keptObdNumbers: d.keptOrderIds.map(obdOf),
      decidedByName: d.decidedBy?.name ?? null,
      decidedAt: d.decidedAt.toISOString(),
      undoneByName: d.undoneBy?.name ?? null,
      undoneAt: d.undoneAt ? d.undoneAt.toISOString() : null,
      billStillCancelled: d.kind === "pick_delete" ? deleted?.workflowStage === "cancelled" : null,
    };
  });

  return { month, groups: out, decided };
}

// ── Marker ─────────────────────────────────────────────────────────────────

/**
 * ONE statement (2026-09-30). count = the actionable groups (the list's rule —
 * the SQL form of pickDeleteCheck, see openGroupsCte); latest = the later of
 * MAX(pick_delete_decisions.updatedAt) and MAX(orders.updatedAt) over EVERY
 * open group's bills, shown or not, so a hidden group becoming actionable
 * (e.g. a bill taken off a trip) still moves it. Same arithmetic as before
 * (pick-delete-rule.ts markerFromRows does the same in JS), fed by one round
 * trip instead of ≈ 14.
 */
export async function getPickDeleteMarker(owner: PickDeleteOwner): Promise<PickDeleteMarker> {
  // Owner-scoped (2026-10-01): count + group clock over THIS desk's groups only,
  // so a Tint Manager group never moves Billing's pill or blocks its popup. The
  // decisions clock stays global — a false "changed" costs one reload.
  const tm = owner === "tint";
  const res = await prisma.$queryRaw<{ count: number; latest: Date | null; decisions: Date | null }[]>`
    WITH ${openGroupsCte()}
    SELECT (SELECT count(*) FROM open_groups WHERE actionable AND tm_owned = ${tm})::int AS count,
           (SELECT max(latest) FROM open_groups WHERE tm_owned = ${tm}) AS latest,
           (SELECT max("updatedAt") FROM pick_delete_decisions) AS decisions`;
  const r = res[0];
  const times = [r?.latest ?? null, r?.decisions ?? null]
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  return {
    count: r?.count ?? 0,
    latest: times.length > 0 ? new Date(Math.max(...times)).toISOString() : null,
  };
}

// ── Lines for one bill ─────────────────────────────────────────────────────

/** One bill's active lines, SAP batch splits merged per SKU, under this tab's own gate. */
export async function getPickDeleteBillLines(orderId: number): Promise<PickDeleteBillLines | null> {
  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    select: { id: true, obdNumber: true },
  });
  if (!order) return null;

  const rawLines = await prisma.import_raw_line_items.findMany({
    where: { obdNumber: order.obdNumber, lineStatus: "active" },
    select: LINE_SELECT,
    orderBy: { lineId: "asc" },
  });
  // sku_master_v2 by `material` ONLY — never enrichedLineItem.sku (CORE §13).
  const catalog = await resolveCatalogByCode(rawLines.map((l) => l.skuCodeRaw));

  return {
    orderId: order.id,
    obdNumber: order.obdNumber,
    lines: mergeBillLines(rawLines, catalog),
  };
}

// ── Writes ─────────────────────────────────────────────────────────────────

export type WriteResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

function isP2002(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * The desk check every writer runs (2026-10-01): re-read these bills' SMU and,
 * when the group belongs to the OTHER desk, the 409 text — else null. ONE
 * helper, called by markAllOk, pickDelete and undoDecision.
 */
async function ownerRefusal(orderIds: readonly number[], owner: PickDeleteOwner): Promise<string | null> {
  const rows = await prisma.orders.findMany({ where: { id: { in: [...orderIds] } }, select: { smu: true } });
  const actual = ownerOfSmus(rows.map((r) => r.smu));
  if (actual === owner) return null;
  return actual === "tint" ? "This SO is decided on Tint Manager" : "This SO is decided in Billing";
}

/** All OK — saved against the SO's current live set, which must equal `orderIds`. */
export async function markAllOk(args: {
  soNumber: string;
  orderIds: number[];
  userId: number;
  owner: PickDeleteOwner;
}): Promise<WriteResult<{ decisionId: number }>> {
  const twins = (await getTwinIdsBySo([args.soNumber])).get(args.soNumber) ?? [];
  if (twins.length < 2 || !sameSet(twins, args.orderIds)) {
    return { ok: false, status: 409, error: "Group changed — refresh" };
  }
  const wrongDesk = await ownerRefusal(twins, args.owner);
  if (wrongDesk !== null) return { ok: false, status: 409, error: wrongDesk };
  try {
    const row = await prisma.pick_delete_decisions.create({
      data: {
        soNumber: args.soNumber,
        kind: "all_ok",
        orderIds: sortAsc(twins),
        decidedById: args.userId,
      },
      select: { id: true },
    });
    return { ok: true, data: { decisionId: row.id } };
  } catch (err) {
    if (isP2002(err)) return { ok: false, status: 409, error: "Already marked All OK" };
    throw err;
  }
}

/**
 * Pick delete — cancel ONE bill of a same-SO group as a duplicate.
 *
 * 🔴 WRITE ORDER: CLAIM → CANCEL → CLEAN-UP → PUSH (the lib/ci/auto.ts shape:
 * take the unique thing first, then write; a P2002 means someone else did).
 *
 *   1. CLAIM — insert the decision row. The partial unique index
 *      pick_delete_decisions_deleted_live_key ("deletedOrderId" WHERE
 *      kind='pick_delete' AND "undoneAt" IS NULL) makes it the lock: a double
 *      press or a second billing user gets P2002 → 409, and writes nothing.
 *      Because the claim precedes the cancel, there can never be a cancelled
 *      bill with no decision row.
 *   2. CANCEL — ONE orders.updateMany guarded on the stage we read
 *      ({ id, workflowStage: fromStage, isRemoved: false }). Zero rows (the
 *      bill moved under us) or a throw → the claim is REMOVED (it never took
 *      effect, so it is not history) and the answer is 409 / the error. That is
 *      the only path that deletes a decision row. If that delete itself fails,
 *      the orphan claim is logged loudly — and /undo heals it (a decision whose
 *      bill is not cancelled is only stamped undone).
 *   3. CLEAN-UP — pick_assignments.deleteMany (AFTER the stage write, the floor
 *      cancel's orphan fix), then ONE order_status_logs row. The bill is
 *      already cancelled and recorded; a failure here is logged and swallowed.
 *   4. PUSH — to the picker who held it (read BEFORE the assignment delete),
 *      unless that picker pressed it. Awaited, swallowed.
 */
export async function pickDelete(args: {
  orderId: number;
  userId: number;
  owner: PickDeleteOwner;
  /** Is the presser admin (lib/rbac.ts isSuperuser)? A challan (ORB) order is
   *  admin-only (S5-4, 2026-10-07). Omitted = false — fail closed for ORB rows only.
   *  (An ORB order carries no SO, so it never forms a group today — belt and braces.) */
  actorIsAdmin?: boolean;
}): Promise<WriteResult<{ decisionId: number; obdNumber: string; keptObdNumbers: string[]; warning?: string }>> {
  // ── Read (picker FIRST — the assignment row is deleted in step 3) ──
  const order = await prisma.orders.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      obdNumber: true,
      soNumber: true,
      workflowStage: true,
      isRemoved: true,
      isChallanOrder: true,
      tripDropId: true,
      tripDrop: { select: { trip: { select: { tripNumber: true } } } },
      pickAssignment: { select: { pickerId: true } },
    },
  });
  if (!order || order.isRemoved) return { ok: false, status: 404, error: "Bill not found" };
  const challanRefusal = challanCancelRefusal(order.isChallanOrder, args.actorIsAdmin === true);
  if (challanRefusal !== null) return { ok: false, status: 403, error: challanRefusal };
  const soNumber = order.soNumber;
  if (soNumber === null || soNumber.trim() === "") {
    return { ok: false, status: 409, error: "This bill has no SO number" };
  }

  const twins = (await getTwinIdsBySo([soNumber])).get(soNumber) ?? [];
  // The desk check first — the other desk's group is not this desk's to judge.
  // Over the live twins (getTwinIdsBySo includes this bill while it is live).
  if (twins.length > 0) {
    const wrongDesk = await ownerRefusal(twins, args.owner);
    if (wrongDesk !== null) return { ok: false, status: 409, error: wrongDesk };
  }
  const refusal = await pickDeleteRefusal(
    {
      id: order.id,
      workflowStage: order.workflowStage,
      tripDropId: order.tripDropId,
      tripNumber: order.tripDrop?.trip.tripNumber ?? null,
    },
    twins,
  );
  if (refusal !== null) return { ok: false, status: 409, error: refusal };

  const orderIds = sortAsc(twins);
  const keptOrderIds = orderIds.filter((id) => id !== order.id);
  const fromStage = order.workflowStage;
  const pickerId = order.pickAssignment?.pickerId ?? null;

  // ── 1. CLAIM ──
  let decisionId: number;
  try {
    const row = await prisma.pick_delete_decisions.create({
      data: {
        soNumber,
        kind: "pick_delete",
        orderIds,
        deletedOrderId: order.id,
        deletedFromStage: fromStage,
        deletedPickerId: pickerId,
        keptOrderIds,
        decidedById: args.userId,
      },
      select: { id: true },
    });
    decisionId = row.id;
  } catch (err) {
    if (isP2002(err)) return { ok: false, status: 409, error: "This bill is already pick deleted" };
    throw err;
  }

  // ── 2. CANCEL — one orders write, guarded on the stage read above ──
  const releaseClaim = async () => {
    try {
      await prisma.pick_delete_decisions.delete({ where: { id: decisionId } });
    } catch (err) {
      console.error(
        `[pick-delete] OBD ${order.obdNumber}: cancel did not land AND the claim #${decisionId} could not be removed — undo it from the Decided list:`,
        err,
      );
    }
  };
  let cancelled: number;
  try {
    const res = await prisma.orders.updateMany({
      where: { id: order.id, workflowStage: fromStage, isRemoved: false },
      data: { workflowStage: "cancelled", dispatchStatus: null },
    });
    cancelled = res.count;
  } catch (err) {
    await releaseClaim();
    throw err;
  }
  if (cancelled === 0) {
    await releaseClaim();
    return { ok: false, status: 409, error: "The bill changed — refresh" };
  }

  // ── 3. CLEAN-UP — the bill is cancelled and recorded from here on ──
  let warning: string | undefined;
  try {
    await prisma.pick_assignments.deleteMany({ where: { orderId: order.id } });
    await prisma.order_status_logs.create({
      data: {
        orderId: order.id,
        fromStage,
        toStage: "cancelled",
        changedById: args.userId,
        note: buildCancelNote("duplicate_bill"),
      },
    });
  } catch (err) {
    console.error(`[pick-delete] OBD ${order.obdNumber}: cancelled, but the assignment delete or log failed:`, err);
    warning = "The bill was cancelled, but its picker assignment or log line could not be written.";
  }

  // "Correct pick" OBDs — the survivors, read live.
  let keptObdNumbers: string[] = [];
  try {
    const kept = await prisma.orders.findMany({
      where: { id: { in: keptOrderIds } },
      select: { obdNumber: true },
      orderBy: { id: "asc" },
    });
    keptObdNumbers = kept.map((k) => k.obdNumber);
  } catch (err) {
    console.error(`[pick-delete] OBD ${order.obdNumber}: could not read the kept OBDs:`, err);
  }

  // ── 4. PUSH — never fails the action ──
  if (pickerId !== null && pickerId !== args.userId) {
    try {
      await sendToUser(pickerId, {
        title: "Bill pick deleted",
        body: `Bill ${order.obdNumber} pick deleted. Correct pick ${keptObdNumbers.join(", ")}`,
        tag: `pick-deleted-${order.id}`,
        url: "/picking",
      });
    } catch (err) {
      console.error(`[pick-delete] OBD ${order.obdNumber}: push failed (non-fatal):`, err);
    }
  }

  return { ok: true, data: { decisionId, obdNumber: order.obdNumber, keptObdNumbers, ...(warning ? { warning } : {}) } };
}

/**
 * Undo either kind.
 *   all_ok       → stamp undone; the flag returns on the next rule read.
 *   pick_delete  → if the bill is still cancelled: refuse on a live CI, else
 *                  restore it (pending_tint_assignment + null status for a bill
 *                  deleted while waiting for tint; pending_picking + 'dispatch'
 *                  for every other bill — owner rulings 2026-09-27), ONE log,
 *                  then stamp undone. If the bill was already restored elsewhere,
 *                  only stamp undone.
 * Bill first, decision second: if the stamp fails after the restore, a retry
 * finds the bill live and only stamps — it heals itself.
 */
export async function undoDecision(args: {
  decisionId: number;
  userId: number;
  owner: PickDeleteOwner;
}): Promise<WriteResult<{ restored: boolean }>> {
  const d = await prisma.pick_delete_decisions.findUnique({
    where: { id: args.decisionId },
    select: { id: true, kind: true, undoneAt: true, deletedOrderId: true, deletedFromStage: true, orderIds: true },
  });
  if (!d) return { ok: false, status: 404, error: "Decision not found" };
  if (d.undoneAt !== null) return { ok: false, status: 409, error: "Already undone" };
  // The desk check — over every bill the decision was taken against, the same
  // set the decided list's owner filter reads.
  const wrongDesk = await ownerRefusal(d.orderIds, args.owner);
  if (wrongDesk !== null) return { ok: false, status: 409, error: wrongDesk };

  const stamp = async (): Promise<boolean> => {
    const res = await prisma.pick_delete_decisions.updateMany({
      where: { id: d.id, undoneAt: null },
      data: { undoneAt: new Date(), undoneById: args.userId },
    });
    return res.count > 0;
  };

  if (d.kind === "all_ok" || d.deletedOrderId === null) {
    return (await stamp()) ? { ok: true, data: { restored: false } } : { ok: false, status: 409, error: "Already undone" };
  }

  const order = await prisma.orders.findUnique({
    where: { id: d.deletedOrderId },
    select: { id: true, obdNumber: true, workflowStage: true, isRemoved: true },
  });

  let restored = false;
  if (order && !order.isRemoved && order.workflowStage === "cancelled") {
    const ci = await findLiveCi(order.id);
    if (ci !== null) return { ok: false, status: 409, error: liveCiRefusal(ci, "released") };

    const toTint = d.deletedFromStage === WAITING_FOR_TINT;
    const toStage = toTint ? WAITING_FOR_TINT : SUPPORT_DONE_OUTPUT;
    const res = await prisma.orders.updateMany({
      where: { id: order.id, workflowStage: "cancelled", isRemoved: false },
      data: { workflowStage: toStage, dispatchStatus: toTint ? null : "dispatch" },
    });
    if (res.count > 0) {
      restored = true;
      try {
        await prisma.order_status_logs.create({
          data: {
            orderId: order.id,
            fromStage: "cancelled",
            toStage,
            changedById: args.userId,
            note: "Restored — pick delete undone",
          },
        });
      } catch (err) {
        console.error(`[pick-delete] OBD ${order.obdNumber}: restored, but the log line failed:`, err);
      }
    }
  }

  return (await stamp()) ? { ok: true, data: { restored } } : { ok: false, status: 409, error: "Already undone" };
}
