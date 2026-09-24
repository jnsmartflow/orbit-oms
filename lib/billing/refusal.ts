// lib/billing/refusal.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 WHICH BILLS A BILLING ACTION MAY TOUCH — ONE RULE, EVERY CALLER
// ═══════════════════════════════════════════════════════════════════════════
//
// Design: docs/prompts/drafts/web-update-2026-09-24-billing-mo-actions.md §6
// (gate G9, re-gate R7). NOT lib/floor/off-floor.ts's offFloorRefusal: that one
// refuses tint-room bills for every action and allows picked ones, which is
// right for Floor's cancel/CI and wrong for billing's Hold/Urgent/Slot.
//
//   Action   | Dispatched / cancelled | On a trip | Tint room | Picked
//   ---------|------------------------|-----------|-----------|--------------------------
//   hold     | refuse (*)             | allow     | allow     | allow
//   urgent   | refuse                 | allow     | allow     | allow
//   slot     | refuse                 | allow     | allow     | allow
//   shipTo   | refuse                 | refuse    | allow     | allow
//   hand     | refuse                 | refuse    | allow     | allow
//   ci       | refuse                 | refuse    | refuse    | allow (caller clears the
//            |                        |           |           |   pick assignment)
//
//   (*) Release — a hold CLEAR — is ALLOWED on a dispatched or cancelled bill:
//       billing has held such bills in the past (the old write-2 had no stage
//       filter) and this is the only way to clean them up. The caller derives
//       the new status from the stage, which gives null for both.
//
//   Tint room = EXACTLY tint_assigned and tinting_in_progress (an operator holds
//   a live tint_assignments row). pending_tint_assignment is NOT the tint room.
//   Removed bills (isRemoved) are refused for every action.
//
// PURE: no Prisma, no clock, no React. Safe to import from the client, so a
// button and the route that serves it can never disagree.
//
// ── Examples (unit-style; mirror these if a test file is added) ─────────────
//   billingRefusal("hold",   { workflowStage: "pick_assigned" })                    → null
//   billingRefusal("hold",   { workflowStage: "dispatched" })                       → "Already dispatched"
//   billingRefusal("hold",   { workflowStage: "dispatched" }, "clear")              → null   (Release)
//   billingRefusal("urgent", { workflowStage: "cancelled" }, "clear")               → "Already cancelled"
//   billingRefusal("slot",   { workflowStage: "pending_picking", tripDropId: 7,
//                              tripNumber: "L-260924-02" })                          → null
//   billingRefusal("shipTo", { workflowStage: "pending_picking", tripDropId: 7,
//                              tripNumber: "L-260924-02" })                          → "On trip L-260924-02 — remove it from the trip first"
//   billingRefusal("hand",   { workflowStage: "tint_assigned" })                    → null
//   billingRefusal("ci",     { workflowStage: "tinting_in_progress" })              → "In the tint room — …"
//   billingRefusal("ci",     { workflowStage: "pending_tint_assignment" })          → null
//   billingRefusal("ci",     { workflowStage: "pick_checked" })                     → null   (caller clears the assignment)
//   billingRefusal("ci",     { workflowStage: "pending_support", isRemoved: true }) → "Bill removed"

export const BILLING_ACTIONS = ["hold", "urgent", "slot", "shipTo", "hand", "ci"] as const;
export type BillingAction = (typeof BILLING_ACTIONS)[number];

/** set = turn the mark on / change it; clear = turn it off (Release, un-Urgent, …). */
export type BillingActionMode = "set" | "clear";

/** What the rule needs to know about a bill. */
export interface BillingRefusalBill {
  workflowStage: string;
  isRemoved?: boolean;
  tripDropId?: number | null;
  /** The trip's number when the bill is on one — for the message. */
  tripNumber?: string | null;
}

/** EXACTLY these two. pending_tint_assignment has no operator yet. */
export const TINT_ROOM_STAGES: readonly string[] = ["tint_assigned", "tinting_in_progress"];

/** Actions refused while the bill is on a trip. */
const REFUSED_ON_TRIP: ReadonlySet<BillingAction> = new Set<BillingAction>(["shipTo", "hand", "ci"]);

/** Actions refused while the bill is in the tint room. */
const REFUSED_IN_TINT_ROOM: ReadonlySet<BillingAction> = new Set<BillingAction>(["ci"]);

/**
 * Why this billing action may NOT touch this bill, or null when it may.
 * Per bill — the caller reports it beside the bills that did change.
 */
export function billingRefusal(
  action: BillingAction,
  bill: BillingRefusalBill,
  mode: BillingActionMode = "set",
): string | null {
  if (bill.isRemoved === true) return "Bill removed";

  const stage = bill.workflowStage;
  if (stage === "cancelled" || stage === "dispatched") {
    // The one exception: a Release that only removes a stale hold.
    if (action === "hold" && mode === "clear") return null;
    return stage === "cancelled" ? "Already cancelled" : "Already dispatched";
  }

  const onTrip = bill.tripDropId !== null && bill.tripDropId !== undefined;
  if (onTrip && REFUSED_ON_TRIP.has(action)) {
    return `On trip ${bill.tripNumber ?? "(unknown)"} — remove it from the trip first`;
  }

  if (TINT_ROOM_STAGES.includes(stage) && REFUSED_IN_TINT_ROOM.has(action)) {
    return "In the tint room — cancel from Tint Manager";
  }

  return null;
}
