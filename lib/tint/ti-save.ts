// lib/tint/ti-save.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 ONE OWNER FOR "SAVE A TINTER ISSUE" — every TI write path calls this
// ═══════════════════════════════════════════════════════════════════════════
//
// Extracted 2026-10-02 (bulk TI step 0 — docs/prompts/drafts/
// code-discovery-2026-10-02-bulk-tinter-issue.md §D, §G, §I) from the per-entry
// block that sat inline, twice, in app/api/tint/operator/tinter-issue (TINTER)
// and tinter-issue-b (ACOTONE). Callers:
//   - app/api/tint/operator/tinter-issue/route.ts      (TINTER, operator + manager arm)
//   - app/api/tint/operator/tinter-issue-b/route.ts    (ACOTONE, same arms)
//   - app/api/tint/manager/ti-bulk/route.ts            (TINTER white shots, one entry per call)
//
// 🔴 GATES STAY IN THE ROUTES. This function trusts that its caller already
// decided WHO may write against WHICH assignment (the operator arm, the
// manager-only placeholder arm, canSeeAllOperatorRows — CLAUDE_TINT §13.4, which
// is never touched here). It only performs the writes.
//
// Writes, per call — sequential awaits, never $transaction (CORE §3):
//   1. per entry: resolveSamplingForEntry (Scenario 1 / 2 / 3 — sampling-
//      resolution.ts), then ONE tinter_issue_entries[_b].create;
//   2. tiSubmitted = true on the split or assignment;
//   3. syncChallanFormulasFromTi(orderId) — try/catch, never fails the save.
//      🔴 BEHAVIOUR CHANGE 2026-10-02 (owner §I-6): the ACOTONE path runs it too.
//      It used to run on the TINTER route only, so an ACOTONE-only bill's
//      challan Formula column never filled (TINT §9.10 said "every TI submit").
//   4. 🔴 BEHAVIOUR CHANGE 2026-10-02 (owner §I-5): on a "Base — No Tint"
//      assignment (placeholder-owned, CLAUDE_TINT §1.12), once its LAST owed
//      line is covered, write its sampling_usage_log ONCE (writeUsageLogs-
//      ForAssignment, the Mark Done writer) — closing the base-bill usage gap
//      (TINT §14). Guarded so it can never double-write; try/catch, never fails
//      the save. Operator jobs are untouched: Mark Done still writes theirs.

import { Prisma, type PackCode, type TinterType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getBaseOperatorId } from "@/lib/tint/base-operator";
import { syncChallanFormulasFromTi } from "@/lib/tint/sync-challan-formulas";
import {
  getIstYearPrefix,
  resolveSamplingForEntry,
} from "@/app/api/tint/operator/_lib/sampling-resolution";
import {
  getIstUsageDate,
  writeUsageLogsForAssignment,
  type UsageLogResult,
} from "@/app/api/tint/operator/_lib/usage-log-writer";

export const TINTER_PIGMENT_CODES = [
  "YOX", "LFY", "GRN", "TBL", "WHT", "MAG", "FFR", "BLK", "OXR", "HEY",
  "HER", "COB", "COG",
] as const;

export const ACOTONE_PIGMENT_CODES = [
  "YE2", "YE1", "XY1", "XR1", "WH1", "RE2", "RE1", "OR1",
  "NO2", "NO1", "MA1", "GR1", "BU2", "BU1",
] as const;

/** The pigment columns a TI row of this type carries. */
export function pigmentCodesFor(tinterType: TinterType): readonly string[] {
  return tinterType === "TINTER" ? TINTER_PIGMENT_CODES : ACOTONE_PIGMENT_CODES;
}

/** Read this type's pigment values off a request body entry (missing → 0) —
 *  the routes' former inline loop, verbatim. */
export function pigmentsFromBody(tinterType: TinterType, entry: Record<string, unknown>): Record<string, number> {
  const pigments: Record<string, number> = {};
  for (const code of pigmentCodesFor(tinterType)) pigments[code] = Number(entry[code] ?? 0);
  return pigments;
}

/** One already-validated entry. */
export interface TiSaveEntry {
  baseSku:       string;
  packCode:      PackCode;
  tinQty:        number;
  rawLineItemId: number | null;
  samplingNo:    string | null;
  shadeName:     string | null;
  /** This tinter type's pigment columns only. */
  pigments:      Record<string, number>;
}

export interface TiSaveEntryResult {
  tiEntryId:           number;
  allocatedSamplingNo: string;
  isNewSampling:       boolean;
  isNewVariant:        boolean;
}

export type TiSaveResult =
  | {
      ok: true;
      entries: TiSaveEntryResult[];
      formulaSync: Awaited<ReturnType<typeof syncChallanFormulasFromTi>> | null;
      /** Set only when this save covered a Base bill's last owed line and the log was written. */
      usageLog: UsageLogResult | null;
    }
  | { ok: false; status: 400; error: string };

/**
 * Save one Tinter Issue — N entries against ONE split or assignment of ONE
 * order. `orderId` and the split / assignment are already gated by the caller.
 * Exactly one of `splitId` / `tintAssignmentId` is non-null.
 *
 * Returns { ok:false, status:400 } only for "Sampling number X not found" (the
 * routes' former 400). Any other failure throws — the routes answer 500, as
 * before. ⚠ Entries written before a mid-loop failure stay written (no
 * $transaction — CORE §3), exactly as the inline loop behaved.
 */
export async function saveTinterIssue(args: {
  tinterType:       TinterType;
  orderId:          number;
  splitId:          number | null;
  tintAssignmentId: number | null;
  userId:           number;
  entries:          TiSaveEntry[];
  /** Log prefix, so a sync failure still names its route. */
  logTag:           string;
}): Promise<TiSaveResult> {
  const { tinterType, orderId, splitId, tintAssignmentId, userId, entries, logTag } = args;

  // Load order for siteId + obdNumber.
  const order = await prisma.orders.findUnique({
    where:  { id: orderId },
    select: { obdNumber: true, customerId: true, shipToCustomerName: true },
  });
  const siteId = order?.customerId ?? null;

  // Best-effort dealer name lookup (only used when allocating new sampling rows
  // in Scenario 1).
  let dealerNameRaw: string | null = null;
  if (order?.obdNumber) {
    const summary = await prisma.import_raw_summary.findFirst({
      where:  { obdNumber: order.obdNumber },
      select: { billToCustomerName: true },
    });
    dealerNameRaw = summary?.billToCustomerName ?? null;
  }

  const yearPrefix = getIstYearPrefix();
  const results: TiSaveEntryResult[] = [];

  // Per-entry routing + writes (sequential).
  for (const entry of entries) {
    let resolution;
    try {
      resolution = await resolveSamplingForEntry({
        tinterType,
        bodySamplingNo: entry.samplingNo,
        bodyShadeName:  entry.shadeName,
        baseSku:        entry.baseSku,
        packCode:       entry.packCode,
        userId,
        siteId,
        dealerName:     dealerNameRaw,
        yearPrefix,
        pigments:       entry.pigments,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("Sampling number ") && msg.endsWith(" not found")) {
        return { ok: false, status: 400, error: msg };
      }
      throw err;
    }

    const data = {
      orderId,
      splitId,
      tintAssignmentId,
      rawLineItemId:    entry.rawLineItemId,
      submittedById:    userId,
      baseSku:          entry.baseSku,
      tinQty:           new Prisma.Decimal(entry.tinQty),
      packCode:         entry.packCode,
      samplingNo:       resolution.resolvedSamplingNo,
      shadeName:        resolution.resolvedShadeName,
      ...entry.pigments,
    };
    const ti = tinterType === "TINTER"
      ? await prisma.tinter_issue_entries.create({ data })
      : await prisma.tinter_issue_entries_b.create({ data });

    results.push({
      tiEntryId:           ti.id,
      allocatedSamplingNo: resolution.resolvedSamplingNo,
      isNewSampling:       resolution.isNewSampling,
      isNewVariant:        resolution.isNewVariant,
    });
  }

  // Mark parent submitted.
  if (splitId !== null) {
    await prisma.order_splits.update({ where: { id: splitId }, data: { tiSubmitted: true } });
  } else if (tintAssignmentId !== null) {
    await prisma.tint_assignments.update({ where: { id: tintAssignmentId }, data: { tiSubmitted: true } });
  }

  // Auto-fill the delivery challan formula column from the latest TI shade data
  // (both TI tables — sync-challan-formulas.ts). Opportunistic: a failure here
  // never blocks the TI response. Both tinter types since 2026-10-02 (§I-6).
  let formulaSync: Awaited<ReturnType<typeof syncChallanFormulasFromTi>> | null = null;
  try {
    formulaSync = await syncChallanFormulasFromTi(orderId);
  } catch (err) {
    console.error(`[${logTag}] syncChallanFormulasFromTi failed`, {
      orderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Base bill fully covered → usage log, once (§I-5). Never fails the save.
  let usageLog: UsageLogResult | null = null;
  if (tintAssignmentId !== null && order) {
    try {
      usageLog = await writeBaseUsageOnLastLine({
        tintAssignmentId,
        obdNumber:          order.obdNumber,
        shipToCustomerName: order.shipToCustomerName,
        siteId,
        userId,
      });
    } catch (err) {
      console.error(`[${logTag}] base usage-log write failed`, {
        orderId,
        tintAssignmentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ok: true, entries: results, formulaSync, usageLog };
}

/**
 * The active tinting lines of an OBD a TI is owed for, and which of them this
 * assignment has covered — base-pending's rule (app/api/tint/manager/base-
 * pending/route.ts, itself done/route.ts's filters): isTinting, lineStatus
 * "active", coverage keyed on tintAssignmentId across BOTH TI tables, a row
 * with no rawLineItemId covering nothing.
 */
export async function owedLinesForAssignment(tintAssignmentId: number, obdNumber: string) {
  const lines = await prisma.import_raw_line_items.findMany({
    where:   { obdNumber, isTinting: true, lineStatus: "active" },
    select:  { id: true, skuCodeRaw: true, skuDescriptionRaw: true, unitQty: true, volumeLine: true },
    orderBy: { id: "asc" },
  });
  const a = await prisma.tinter_issue_entries.findMany({
    where:  { tintAssignmentId, rawLineItemId: { not: null } },
    select: { rawLineItemId: true },
  });
  const b = await prisma.tinter_issue_entries_b.findMany({
    where:  { tintAssignmentId, rawLineItemId: { not: null } },
    select: { rawLineItemId: true },
  });
  const covered = new Set<number>();
  for (const e of [...a, ...b]) if (e.rawLineItemId !== null) covered.add(e.rawLineItemId);
  return { lines, covered };
}

/**
 * §I-5 — write a Base bill's sampling_usage_log once its last owed line is
 * covered. Returns the writer's counters when it wrote, null when it did not
 * (not a Base bill, lines still owed, nothing to tint, or already written).
 *
 * The guard (idempotency): any sampling_usage_log row for this OBD created at
 * or after this assignment was created means the log is already written — the
 * writer logs EVERY TI row on the assignment, so a second call would duplicate
 * all of them. A bypassed bill has no operator Mark Done, so no other writer
 * produces rows for it in that window.
 */
async function writeBaseUsageOnLastLine(args: {
  tintAssignmentId:   number;
  obdNumber:          string;
  shipToCustomerName: string | null;
  siteId:             number | null;
  userId:             number;
}): Promise<UsageLogResult | null> {
  const baseOperatorId = await getBaseOperatorId();
  if (baseOperatorId === null) return null;
  const assignment = await prisma.tint_assignments.findUnique({
    where:  { id: args.tintAssignmentId },
    select: { assignedToId: true, createdAt: true },
  });
  if (!assignment || assignment.assignedToId !== baseOperatorId) return null; // operator jobs: Mark Done owns it

  const { lines, covered } = await owedLinesForAssignment(args.tintAssignmentId, args.obdNumber);
  if (lines.length === 0) return null;
  if (lines.some((l) => !covered.has(l.id))) return null; // still owes a line

  const already = await prisma.sampling_usage_log.count({
    where: { deliveryNumber: args.obdNumber, createdAt: { gte: assignment.createdAt } },
  });
  if (already > 0) return null;

  return writeUsageLogsForAssignment({
    tintAssignmentId:   args.tintAssignmentId,
    obdNumber:          args.obdNumber,
    shipToCustomerName: args.shipToCustomerName,
    operatorId:         args.userId,
    usageDate:          getIstUsageDate(),
    // orders.customerId = the ship-to site FK (TINT §14 / SAMPLING §9).
    siteId:             args.siteId,
  });
}
