// lib/tint/manual-pull-rules.ts
//
// "+ Add to Tint" — THE RULES, pure (2026-10-24, Add to Tint server build; design
// of the same day). No Prisma, no clock, no I/O, so the lookup, the pull and the
// popup (components/tint/manual-tint-entry-modal.tsx, 2026-10-25) all read ONE
// verdict and ONE set of sentences, and the tests run without a database. The server half — the reads and the writes — is ./manual-pull.ts.
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

/** Why a bill may not be pulled. The SENTENCE is `reason`, written here and
 *  nowhere else — the modal prints it as it comes (mockup add-to-tint-v1 state 7). */
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
    return { verdict: "refused", code: "REMOVED", reason: "Removed bill" };
  }
  // Challan orders are non-tint in Phase 1 (2026-10-06, Challan orders slice 2,
  // design D5) — checked before the tint-type test so the real reason is told.
  if (f.isChallanOrder) {
    return { verdict: "refused", code: "CHALLAN_ORDER", reason: "Challan orders stay non-tint — this bill cannot be pulled" };
  }
  if (f.workflowStage === CHALLAN_LINKED) {
    return {
      verdict: "refused",
      code: "CHALLAN_ORDER",
      reason: "Linked to a challan order — cannot pull",
    };
  }
  // Already tint — refused, never pulled a second time (owner, 2026-10-24).
  if (f.orderType !== "non_tint") {
    return { verdict: "refused", code: "ALREADY_TINT", reason: "Already in tint workflow" };
  }
  if (!f.isActive) {
    return { verdict: "refused", code: "INACTIVE_ORDER", reason: "Inactive order — cannot pull" };
  }
  const stage = manualTintStageVerdict(f.workflowStage);
  if (stage === "refused") {
    return { verdict: "refused", code: "PAST_TINT", reason: stageRefusal(f.workflowStage) };
  }
  if (f.dispatchedInvoice !== null) {
    return {
      verdict: "refused",
      code: "DISPATCHED",
      reason: `Already dispatched (${f.dispatchedInvoice}) — cannot pull`,
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
      return "Already dispatched — cannot pull";
    case "cancelled":
      return "Cancelled bill — cannot pull";
    case "closed":
      return "Closed bill (an old completed one) — cannot pull";
    default:
      return `At stage "${stage}" — cannot pull`;
  }
}

/**
 * The confirm step's warning — the modal's amber banner, printed as it comes
 * (mockup state 3). Names nobody's pronoun: "the pick", "notify Ravi". The
 * push goes only when a picker is on record (pushPickCancelled), so the
 * no-picker sentence promises no notification.
 */
export function pickCancelReason(stage: string, pickerName: string | null): string {
  // No picker on record: a Direct Loading (no picker ever), or a row lost.
  if (pickerName === null) return "This bill is in picking. Pulling it will cancel the pick.";
  const tail = `Pulling it will cancel the pick and notify ${pickerName} and the supervisors.`;
  if (stage === PICK_ASSIGNED) return `${pickerName} is picking this bill. ${tail}`;
  if (stage === "pick_done") return `${pickerName} has picked this bill. ${tail}`;
  return `${pickerName}'s pick of this bill has been checked. ${tail}`;
}

/** "No active lines on this OBD (3 removed, 1 errored)". */
export function noLinesReason(removed: number, errored: number): string {
  const parts: string[] = [];
  if (removed > 0) parts.push(`${removed} removed`);
  if (errored > 0) parts.push(`${errored} errored`);
  return `No active lines on this OBD${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
}

/**
 * "Invoice 2 of 3 on this OBD — the whole OBD moves to tint" — when the term
 * named ONE invoice of a multi-invoice OBD. null otherwise (an OBD term, or an
 * OBD with one invoice). `position`/`total` count the OBD's invoices, not its
 * split-load parts.
 */
export function invoiceOfObdNote(position: number | null, total: number): string | null {
  if (position === null || total <= 1) return null;
  return `Invoice ${position} of ${total} on this OBD — the whole OBD moves to tint`;
}

// ── The warnings ─────────────────────────────────────────────────────────────

/** One banner over a pullable bill. `strong` = the heavier amber. */
export interface PullWarning {
  tone: "info" | "warn";
  strong?: boolean;
  text: string;
}

/**
 * The banners over a pullable bill, in the order the modal stacks them
 * (mockup states 3–6): the pick it will cancel, the trip(s) it comes off, the
 * invoice that stays, the k-of-N note. Pure, so the sentences live here with
 * the refusals and are tested. A refused bill shows only its `reason`.
 */
export function pullWarnings(m: {
  verdict: "ok" | "confirm" | "refused";
  reason: string | null;
  trips: readonly { tripNumber: string; sentToBilling: boolean }[];
  invoiced: boolean;
  invoiceNote: string | null;
}): PullWarning[] {
  if (m.verdict === "refused") return [];
  const out: PullWarning[] = [];
  if (m.verdict === "confirm" && m.reason !== null) out.push({ tone: "warn", text: m.reason });
  if (m.trips.length > 0) {
    const sent = m.trips.filter((t) => t.sentToBilling).map((t) => t.tripNumber);
    const all = m.trips.map((t) => t.tripNumber).join(", ");
    const one = m.trips.length === 1;
    out.push(
      sent.length > 0
        ? {
            tone: "warn",
            strong: true,
            text: `On trip ${all}, already sent to billing — billing papers will need redoing. It will come off the ${one ? "trip" : "trips"}.`,
          }
        : { tone: "info", text: `On trip ${all} — it will come off the ${one ? "trip" : "trips"}.` },
    );
  }
  if (m.invoiced) out.push({ tone: "warn", text: "Already invoiced — the invoice stays as is." });
  if (m.invoiceNote !== null) out.push({ tone: "info", text: m.invoiceNote });
  return out;
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
