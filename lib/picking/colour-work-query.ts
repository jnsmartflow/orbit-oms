import { prisma } from "@/lib/prisma";
import { TINT_STATUS_DONE } from "@/lib/tint/assignment-status";
import { getBaseOperatorId } from "@/lib/tint/base-operator";
import { SMU_CODE_BY_NAME } from "@/lib/import-upsert/types";
import { isProjectSmu, resolveColourWork, type ColourWork } from "./colour-work";

// ── The batched read behind ColourWork ──────────────────────────────────────
//
// 🔴 ONE OWNER, FIVE CALLERS. The picking queue (lib/picking/queue.ts), Floor's
// board, hold and cancelled feeds (lib/floor/queries.ts) and Floor's detail
// payload (app/api/floor/order/[orderId]/route.ts) all ask THIS function. The
// rule itself is one step further out, in ./colour-work.ts, so a caller can
// neither re-ask it differently nor re-answer it.
//
// ⚠ A POST-FETCH ENRICHMENT OF ROWS THE CALLER ALREADY HAS — it adds NO term to
// any predicate. `buildPickingWhere` is shared by the picking queue and the
// 15-second picking marker, so a term added for this would change the set the
// marker watches (PICKING §10 — "Marker ⊇ queue, never ⊂") and could move the
// Assign badge. Same shape as getDuplicateSoNumbers, the dealer/user maps and
// the family catalog lookup that already sit beside it.
//
// ⚠ SEQUENTIAL AWAITS, never prisma.$transaction (CORE §3). SELECT-only: no
// `orders.update` anywhere near it, or every board in the depot sees a false
// "changed" (CORE §3, the marker landmine).

/**
 * What one bill has to tell us before it can be classified. Deliberately the
 * NAME (`orders.smu`), not a code: Floor's hold and cancelled rows carry the
 * name, and resolving it here means one conversion instead of four.
 */
export interface ColourWorkBill {
  orderId: number;
  smu: string | null;
  orderType: string;
}

/**
 * ColourWork for every bill that has one, keyed by orderId.
 *
 * A bill with NO entry is `null` — read it as `map.get(id) ?? null`. Callers get
 * the same answer whether the bill was skipped for its division or simply has
 * not been tinted yet, which is correct: both mean "say nothing".
 *
 * COST: zero queries when no project-division TINT bill is loaded, which is the
 * ordinary case on a Deco-Retail-heavy board (1,530 of 1,703 bills in the 14
 * days to 2026-09-17). Otherwise exactly three: the placeholder lookup (one
 * indexed hit on a UNIQUE column) plus one batched read of each table that can
 * carry a completion.
 */
export async function getColourWorkByOrder(
  bills: readonly ColourWorkBill[],
): Promise<Map<number, ColourWork>> {
  const out = new Map<number, ColourWork>();

  // Resolve the division once per bill and drop everything that cannot carry
  // the signal. `SMU_CODE_BY_NAME` is the importer's own inverse map — imported
  // rather than re-declared for the same reason queue.ts imports it for smuCode.
  const candidates: Array<ColourWorkBill & { smuCode: string }> = [];
  for (const bill of bills) {
    const smuCode = bill.smu !== null ? (SMU_CODE_BY_NAME[bill.smu] ?? null) : null;
    if (!isProjectSmu(smuCode)) continue;
    candidates.push({ ...bill, smuCode });
  }
  if (candidates.length === 0) return out;

  // A non-tint project bill needs no completion evidence at all — it was never
  // going to be mixed. Answered without touching the database.
  const tintBills = candidates.filter((c) => c.orderType === "tint");
  for (const c of candidates) {
    if (c.orderType !== "tint") out.set(c.orderId, "base");
  }
  if (tintBills.length === 0) return out;

  const tintIds = Array.from(new Set(tintBills.map((c) => c.orderId)));

  // The placeholder worker. NOT cached in module scope — a serverless instance
  // can outlive a reseed and a stale id would mis-attribute every bypass
  // (lib/tint/base-operator.ts states the rule).
  //
  // ⚠ ABSENT ⇒ EVERY COMPLETION READS AS REAL. That is the read-side
  // degradation base-operator.ts documents: it shows a bypassed bill as TINT,
  // which overstates one bill, rather than hiding real tinting work behind a
  // missing row.
  const baseOperatorId = await getBaseOperatorId();

  // 🔴 KEYED ON `tinting_done`, NEVER ON "HAS AN ASSIGNMENT ROW". Five rows with
  // a live-looking status (4 `assigned`, 1 `paused`) sit on bills that were
  // dispatched or cancelled long ago (SELECT 2026-09-17) — treating those as
  // possession would label a finished bill from a job nobody is doing. The
  // literal comes from lib/tint/assignment-status.ts, which owns the vocabulary:
  // `"done"` has never existed in this column and matched nothing for a year
  // (CORE §3, the status-string rule).
  //
  // `splitId: null` is the WHOLE-ORDER assignment — the same boundary the
  // bypass writes on and the Floor detail panel draws.
  const doneWholeObd = await prisma.tint_assignments.findMany({
    where: { orderId: { in: tintIds }, splitId: null, status: TINT_STATUS_DONE },
    select: { orderId: true, assignedToId: true },
  });

  // The splits arm. A split is only ever tinted by a real operator — the bypass
  // writes whole-OBD rows exclusively — so a finished split is real colour work
  // however its parent's own assignment row reads.
  const doneSplits = await prisma.order_splits.findMany({
    where: { orderId: { in: tintIds }, status: TINT_STATUS_DONE },
    select: { orderId: true },
  });

  const realDone = new Set<number>();
  const baseDone = new Set<number>();
  for (const row of doneWholeObd) {
    if (baseOperatorId !== null && row.assignedToId === baseOperatorId) {
      baseDone.add(row.orderId);
    } else {
      realDone.add(row.orderId);
    }
  }
  for (const row of doneSplits) realDone.add(row.orderId);

  for (const bill of tintBills) {
    const work = resolveColourWork({
      smuCode: bill.smuCode,
      orderType: bill.orderType,
      finishedByRealOperator: realDone.has(bill.orderId),
      finishedByBaseOperator: baseDone.has(bill.orderId),
    });
    if (work !== null) out.set(bill.orderId, work);
  }

  return out;
}
