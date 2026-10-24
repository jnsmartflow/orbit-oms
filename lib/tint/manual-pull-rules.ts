// lib/tint/manual-pull-rules.ts
//
// "+ Add to Tint" — THE RULES, pure (2026-10-24, Add to Tint server build; design
// of the same day). No Prisma, no clock, no I/O, so the lookup, the pull and the
// coming modal (step 7) all read ONE verdict, and the tests run without a
// database. The server half — the reads and the writes — is ./manual-pull.ts.
//
// WHAT CHANGED FROM THE OLD manual-entry ROUTES (both re-checked here):
//   - NO SMU GATE and NO 7-DAY WINDOW. Any division's bill can be pulled; the
//     challan step alone keeps its own SMU rule (CHALLAN_ELIGIBLE_SMU — no
//     challan for Deco Retail).
//   - A bill a picker holds, has picked or has had checked may be pulled — the
//     pick is CANCELLED (MANUAL_TINT_PICK_CANCEL_STAGES), and only with the
//     modal's explicit confirmation.
//   - Found by OBD OR by invoice, and the answer is a LIST: one invoice can be
//     on two OBDs.

import type { Prisma } from "@prisma/client";
import { CHALLAN_LINKED, manualTintStageVerdict, PICK_ASSIGNED } from "@/lib/workflow-stages";

// ── The lookup term ──────────────────────────────────────────────────────────

/** A parsed term (lib/trips/find-bill.ts BillLookupTerm's shape — restated, so
 *  this file stays free of that module's Prisma import). */
export interface PullLookupTerm {
  q: string;
  invoiceTerms: string[];
}

/**
 * The bills a term names: the whole OBD number, SAP's invoice on the OBD
 * (orders.invoiceNo, seq 1), or ANY invoice row of an OBD (`invoiceOrderIds`,
 * from invoiceRowMatches — typed invoices seq 2..n included).
 *
 * 🔴 NO isRemoved, hide or challan term, deliberately: billLookupWhere has all
 * three and would answer "not found" for a bill that exists. The verdict says
 * why such a bill cannot be pulled. And no SO arm — the design is OBD or invoice.
 */
export function pullLookupWhere(term: PullLookupTerm, invoiceOrderIds: readonly number[]): Prisma.ordersWhereInput {
  return {
    OR: [
      { obdNumber: term.q },
      ...term.invoiceTerms.map((t) => ({ invoiceNo: t })),
      ...(invoiceOrderIds.length > 0 ? [{ id: { in: [...invoiceOrderIds] } }] : []),
    ],
  };
}

// ── The verdict ──────────────────────────────────────────────────────────────

/** Why a bill may not be pulled — the modal maps each to its sentence. */
export type PullRefusalCode =
  | "REMOVED"
  | "CHALLAN_ORDER"
  | "ALREADY_TINT"
  | "INACTIVE_ORDER"
  | "PAST_TINT"
  | "DISPATCHED"
  | "LIVE_CI"
  | "NO_LINES";

/**
 *   ok       — pull it; nobody has picked it
 *   confirm  — pull it, but the pick is cancelled: the modal asks first and the
 *              POST must carry confirmCancelPick: true
 *   refused  — not pullable; `code` + `reason` say why
 */
export type PullVerdict =
  | { verdict: "ok"; reason: null }
  | { verdict: "confirm"; reason: string }
  | { verdict: "refused"; code: PullRefusalCode; reason: string };

/** Everything the verdict reads about one bill. */
export interface PullFacts {
  obdNumber: string;
  isRemoved: boolean;
  isActive: boolean;
  isChallanOrder: boolean;
  workflowStage: string;
  orderType: string;
  /** The picker holding the bill (pick_assignments), or null. */
  pickerName: string | null;
  /** An invoice row already dispatched — its invoiceNo (or "invoice {seq}"). */
  dispatchedInvoice: string | null;
  /** The live FULL CI's sentence (lib/ci/live-ci.ts liveCiRefusal), or null. */
  liveCiRefusal: string | null;
  /** import_raw_line_items rowStatus valid + lineStatus active. */
  activeLines: number;
  /** When activeLines is 0 — what the OBD's other lines are, for the message. */
  removedLines: number;
  erroredLines: number;
}

/** Refusals in priority order — the FIRST that applies is the one reported. */
export function judgePull(f: PullFacts): PullVerdict {
  if (f.isRemoved) {
    return { verdict: "refused", code: "REMOVED", reason: "This bill has been removed" };
  }
  // Challan orders are non-tint in Phase 1 (2026-10-06, Challan orders slice 2,
  // design D5) — checked before the tint-type test so the real reason is told.
  if (f.isChallanOrder) {
    return { verdict: "refused", code: "CHALLAN_ORDER", reason: "Challan orders are non-tint in Phase 1" };
  }
  if (f.workflowStage === CHALLAN_LINKED) {
    return {
      verdict: "refused",
      code: "CHALLAN_ORDER",
      reason: "This bill is linked to a challan order and cannot be pulled into tinting",
    };
  }
  // Already tint — refused, never pulled a second time (owner, 2026-10-24).
  if (f.orderType !== "non_tint") {
    return { verdict: "refused", code: "ALREADY_TINT", reason: "This OBD is already in the tint workflow" };
  }
  if (!f.isActive) {
    return { verdict: "refused", code: "INACTIVE_ORDER", reason: "This order is inactive and cannot be modified" };
  }
  const stage = manualTintStageVerdict(f.workflowStage);
  if (stage === "refused") {
    return { verdict: "refused", code: "PAST_TINT", reason: stageRefusal(f.workflowStage) };
  }
  if (f.dispatchedInvoice !== null) {
    return {
      verdict: "refused",
      code: "DISPATCHED",
      reason: `${f.dispatchedInvoice} has been dispatched — this bill cannot be pulled into tinting`,
    };
  }
  if (f.liveCiRefusal !== null) {
    return { verdict: "refused", code: "LIVE_CI", reason: f.liveCiRefusal };
  }
  if (f.activeLines === 0) {
    return { verdict: "refused", code: "NO_LINES", reason: noLinesReason(f.removedLines, f.erroredLines) };
  }
  if (stage === "cancel_pick") {
    return { verdict: "confirm", reason: pickCancelReason(f.workflowStage, f.pickerName) };
  }
  return { verdict: "ok", reason: null };
}

/** The sentence for a stage that can never be pulled. */
export function stageRefusal(stage: string): string {
  switch (stage) {
    case "dispatched":
      return "This bill has already been dispatched";
    case "cancelled":
      return "This bill is cancelled";
    case "closed":
      return "This bill is closed (an old completed bill)";
    default:
      return `This bill is at "${stage}" and cannot be pulled into tinting`;
  }
}

/** What the confirm step says about the pick it will cancel. */
export function pickCancelReason(stage: string, pickerName: string | null): string {
  // No picker on record: a Direct Loading (no picker ever), or a row lost.
  const who = pickerName ?? "no picker on record";
  if (stage === PICK_ASSIGNED) return `Being picked (${who}) — the pick will be cancelled`;
  if (stage === "pick_done") return `Picked (${who}), waiting for the check — the pick will be cancelled`;
  return `Picked and checked (${who}) — the pick will be cancelled`;
}

/** "No active lines on this OBD (3 removed, 1 errored)". */
export function noLinesReason(removed: number, errored: number): string {
  const parts: string[] = [];
  if (removed > 0) parts.push(`${removed} removed`);
  if (errored > 0) parts.push(`${errored} errored`);
  return `No active lines on this OBD${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
}

/**
 * "Invoice 2 of 3 on OBD 9105…; the whole OBD moves to tint" — when the term
 * named ONE invoice of a multi-invoice OBD. null otherwise (an OBD term, or an
 * OBD with one invoice). `position`/`total` count the OBD's invoices, not its
 * split-load parts.
 */
export function invoiceOfObdNote(position: number | null, total: number, obdNumber: string): string | null {
  if (position === null || total <= 1) return null;
  return `Invoice ${position} of ${total} on OBD ${obdNumber}; the whole OBD moves to tint`;
}

// ── The bill write ───────────────────────────────────────────────────────────

/**
 * The ONE orders.update of a pull. Pure, so the slot rule is tested.
 *
 * SLOT: the tint bill's slot is decided when its tinting finishes
 * (resolveCompletionSlot, CLAUDE_TINT.md §2), so the current dispatch slot is
 * cleared — UNLESS a person set it (`dispatchSlotSource === "manual"`, Floor's
 * Change slot). A hand-set slot is a planner's decision and survives the pull,
 * the same way the import fallback never overwrites one (CLAUDE_IMPORT.md §2.1);
 * the completion routes then keep it as a pre-set slot. The legacy slot columns
 * (slotId / originalSlotId / dispatchSlot) are cleared either way, as the pull
 * always did.
 *
 * Direct Loading is undone (directLoadedAt/ById null): the bill is going back
 * to the tint room, and back to a picker after it.
 */
export function buildPullData(opts: {
  dispatchSlotSource: string | null;
  /** Set when an operator is chosen: the bill goes straight to tint_assigned. */
  operatorSequenceOrder: number | null;
  markSample: boolean;
  /** Already marked Sample — the mark is kept, never re-stamped. */
  alreadySample: boolean;
  actorId: number;
  now: Date;
}): Prisma.ordersUncheckedUpdateInput {
  const assigned = opts.operatorSequenceOrder !== null;
  return {
    orderType: "tint",
    workflowStage: assigned ? "tint_assigned" : "pending_tint_assignment",
    ...(assigned ? { sequenceOrder: opts.operatorSequenceOrder as number } : {}),
    manualTintEntry: true,
    slotId: null,
    originalSlotId: null,
    dispatchSlot: null,
    ...(opts.dispatchSlotSource !== "manual"
      ? { dispatchTargetDate: null, dispatchWindowId: null, dispatchSlotRuleId: null, dispatchSlotSource: null }
      : {}),
    directLoadedAt: null,
    directLoadedById: null,
    ...(opts.markSample && !opts.alreadySample ? { sampleAt: opts.now, sampleById: opts.actorId } : {}),
  };
}

// ── The audit sentence ───────────────────────────────────────────────────────

/** The pull's ONE order_status_logs note — every part that happened, in order. */
export function pullStatusNote(opts: {
  reasonCode: string;
  reasonNotes: string | null;
  cancelledPickerName: string | null;
  /** True when the bill was in a pick stage, whether or not a picker was on record. */
  pickCancelled: boolean;
  tripNumbers: string[];
  operatorName: string | null;
  markedSample: boolean;
}): string {
  const parts: string[] = [];
  if (opts.markedSample) parts.push("marked Sample");
  if (opts.pickCancelled) {
    parts.push(opts.cancelledPickerName !== null ? `cancelled pick by ${opts.cancelledPickerName}` : "cancelled pick");
  }
  if (opts.tripNumbers.length > 0) parts.push(`off trip ${opts.tripNumbers.join(", ")}`);
  if (opts.operatorName !== null) parts.push(`assigned to ${opts.operatorName}`);
  return (
    `Manual tint pull: ${opts.reasonCode}` +
    (opts.reasonNotes ? ` — ${opts.reasonNotes}` : "") +
    (parts.length > 0 ? `; ${parts.join("; ")}` : "")
  );
}

/** The phrase the pull note uses for the picker — read back by the revert. */
export const PULL_NOTE_PICK_PREFIX = "cancelled pick by ";

/** The cancelled picker's name, read back out of a pull's status-log note (the revert's warning). */
export function cancelledPickerFromNote(note: string | null): string | null {
  if (note === null || !note.startsWith("Manual tint pull:")) return null;
  for (const part of note.split("; ")) {
    if (part.startsWith(PULL_NOTE_PICK_PREFIX)) {
      const name = part.slice(PULL_NOTE_PICK_PREFIX.length).trim();
      return name === "" ? null : name;
    }
  }
  return null;
}

// ── The push ─────────────────────────────────────────────────────────────────

/**
 * Who hears that a pick was cancelled for tint. Only when a picker held the
 * bill: the picker, and every picking supervisor — de-duped, and never the
 * person who pressed the button (CLAUDE_NOTIFICATIONS §2, self-suppression).
 */
export function pullPushRecipients(opts: {
  pickerId: number | null;
  supervisorIds: readonly number[];
  actorId: number;
}): { picker: number | null; supervisors: number[] } {
  if (opts.pickerId === null) return { picker: null, supervisors: [] };
  const picker = opts.pickerId !== opts.actorId ? opts.pickerId : null;
  const supervisors = Array.from(new Set(opts.supervisorIds)).filter(
    (id) => id !== opts.actorId && id !== opts.pickerId,
  );
  return { picker, supervisors };
}
