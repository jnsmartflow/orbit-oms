// lib/tint/manager-bill.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE TINT MANAGER'S ACTION GATE + "TINT BILLS ONLY" — one copy, every route
// ═══════════════════════════════════════════════════════════════════════════
//
// Tint Manager tabs build step 2 (2026-10-01) —
// docs/prompts/drafts/code-discovery-2026-10-01-tint-manager-build-plan.md §B/§C.
//
// The Tint Manager presses the SAME actions Floor does (hold, release, hand,
// slot, ship-to, cancel, CI, pick delete) through its OWN routes, which:
//   1. gate on checkTintAction — `tint_manager` canEdit AND the action's own
//      key canEdit (the billing_* pattern: `mail_orders` canEdit AND
//      `billing_<x>` canEdit, app/api/billing/mail-order/actions);
//   2. refuse anything that is not a tint bill (tintBillRefusal);
//   3. then call the SAME shared function Floor's route calls
//      (lib/floor/bill-actions.ts, lib/floor/ship-to.ts, …). The stage rules
//      are that function's, never re-implemented here.
//
// The layout draws a button with the identical rule
// (app/(tint)/tint/manager/layout.tsx), so a button is never shown for a write
// the route would refuse. Admin / superuser pass inside checkAnyPermission.
//
// ⚠ NOT canSeeAllOperatorRows (CLAUDE_TINT §13.4) — nothing here decides whose
// operator rows a query may touch, and nothing here may ever be used to.

import type { Prisma } from "@prisma/client";
import type { PageKey } from "@/lib/permissions";
import { checkAnyPermission } from "@/lib/permissions";
import { PROJECT_SMU_NAMES } from "@/lib/billing/pick-delete-rule";
import { PICK_ASSIGNED, PICK_DONE } from "@/lib/workflow-stages";

/** Every Tint Manager action that has its own tick. Assign / Re-assign / Send
 *  back / Base bypass are NOT here: they stay on `tint_manager` canEdit alone
 *  (owner decision 7). */
export type TintAction =
  | "hold"
  | "unhold"
  | "hand"
  | "unhand"
  | "change-slot"
  | "ship-to"
  | "cancel"
  | "stop-cancel"
  | "restore"
  | "remove"
  | "ci"
  | "pick-delete"
  | "shop-delivery"
  | "mark-urgent"
  | "ti-bulk";

/** Action → its key. Set and clear share one key, so nobody can create a state
 *  they cannot undo (hold/unhold, hand/unhand, cancel/stop/restore/remove). */
export const TINT_ACTION_KEY: Record<TintAction, PageKey> = {
  hold:          "tint_hold",
  unhold:        "tint_hold",
  hand:          "tint_hand",
  unhand:        "tint_hand",
  "change-slot": "tint_slot",
  "ship-to":     "tint_ship_to",
  cancel:        "tint_cancel",
  "stop-cancel": "tint_cancel",
  restore:       "tint_cancel",
  remove:        "tint_cancel",
  ci:            "tint_ci",
  "pick-delete": "tint_pick_delete",
  // Owner 2026-10-01: its OWN tick, independent of tint_ship_to.
  "shop-delivery": "tint_shop_delivery",
  // Owner 2026-10-02: its OWN tick.
  "mark-urgent":   "tint_urgent",
  // Owner 2026-10-02: its OWN tick. NOT a Base-tab action (BASE_ACTIONS) — it
  // acts on "Base — No Tint" TI rows, a different thing (see base-feed.ts).
  "ti-bulk":       "tint_ti_bulk",
};

/** Human words for the 403, naming what was refused. */
const ACTION_WORDS: Record<TintAction, string> = {
  hold:          "hold",
  unhold:        "release a hold",
  hand:          "mark Hand",
  unhand:        "clear Hand",
  "change-slot": "set the slot",
  "ship-to":     "change the ship-to",
  cancel:        "cancel",
  "stop-cancel": "stop and cancel",
  restore:       "restore",
  remove:        "remove an OBD",
  ci:            "raise a CI",
  "pick-delete": "decide pick deletes",
  "shop-delivery": "send bills to the dealer's shop",
  "mark-urgent":   "mark bills urgent",
  "ti-bulk":       "write bulk Tinter Issue",
};

/**
 * May these roles press this action on the Tint Manager? `tint_manager`
 * canEdit AND the action key's canEdit. Returns the 403 text when refused, or
 * null when allowed — the route answers `{ error }` with status 403.
 */
export async function checkTintAction(roles: string[], action: TintAction): Promise<string | null> {
  const host = await checkAnyPermission(roles, "tint_manager", "canEdit");
  if (!host) return "Permission denied";
  const key = await checkAnyPermission(roles, TINT_ACTION_KEY[action], "canEdit");
  if (!key) return `You don't have permission to ${ACTION_WORDS[action]} on the Tint Manager`;
  return null;
}

/** What tintBillRefusal needs to know about a bill. `smu` and `workflowStage`
 *  are read only by tintManagerBillRefusal (the Base rule); tintBillRefusal
 *  ignores them, so its callers need not select them. */
export interface TintBillFacts {
  orderType: string;
  isRemoved: boolean;
  smu?: string | null;
  workflowStage?: string;
}

/**
 * Why the Tint Manager may NOT act on this bill, or null when it may. Tint bills
 * only — any stage; the stage rules belong to the shared function the route
 * calls next. Removed bills read as not found, as on Floor.
 */
export function tintBillRefusal(order: TintBillFacts | null): string | null {
  if (order === null || order.isRemoved) return "Order not found";
  if (order.orderType !== "tint") return "Not a tint bill — use Floor";
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE BASE TAB'S BILLS — "tint OR Base", one owner (2026-10-01)
// ═══════════════════════════════════════════════════════════════════════════
//
// docs/prompts/drafts/code-discovery-2026-10-01-tint-manager-base-tab.md §D, §I.
// A BASE bill is a NON-tint bill (orderType ≠ "tint") whose SMU is a project SMU
// — 74 Decorative Projects or 77 Retail Offtake. The SMU names come from ONE
// owner, PROJECT_SMU_NAMES (lib/billing/pick-delete-rule.ts, itself derived from
// SMU_CODE_BY_NAME + PROJECT_SMU_CODES), and BOTH forms below are built from it,
// so the Prisma filter and the row predicate cannot describe different sets.
//
// The Tint Manager may act on a Base bill ONLY through BASE_ACTIONS. Every other
// route keeps tintBillRefusal above — tint bills only — so a widening here can
// never leak into assign / cancel / restore / splits / pick delete.

/** Base bills as a Prisma filter — the Base feed, the Hold / CI tabs and the marker. */
export const BASE_BILL_WHERE: Prisma.ordersWhereInput = {
  orderType: { not: "tint" },
  smu: { in: [...PROJECT_SMU_NAMES] },
};

/** Base bills as a row predicate — the same rule as BASE_BILL_WHERE. */
export function isBaseBill(o: { orderType: string; smu?: string | null }): boolean {
  return o.orderType !== "tint" && typeof o.smu === "string" && PROJECT_SMU_NAMES.includes(o.smu);
}

/** What the Tint Manager may do to a Base bill (owner, §I). No Hand (decision 5),
 *  no plain Cancel / Restore / Assign / pick delete (decision 3). */
export const BASE_ACTIONS: readonly TintAction[] = ["hold", "unhold", "change-slot", "shop-delivery", "ship-to", "ci", "mark-urgent"];

/** Decision 1 — a Base bill a picker holds is not held from the Tint Manager. */
export const BASE_PICKER_HOLD_REFUSAL = "A picker has this bill — hold it from Floor if you must";
const BASE_PICKER_STAGES: readonly string[] = [PICK_ASSIGNED, PICK_DONE];

/**
 * Why the Tint Manager may NOT do `action` to this bill, or null when it may.
 *
 *   - removed / missing → "Order not found" (as tintBillRefusal);
 *   - a tint bill → allowed (any action; the shared function's stage rules follow);
 *   - a Base bill → allowed only for BASE_ACTIONS, and hold is refused at
 *     pick_assigned / pick_done (owner decision 1 — a hold there takes the bill
 *     off the picker's list mid-pick, lib/picking/queue.ts pins 'dispatch');
 *   - anything else → "Not a tint or Base bill — use Floor".
 *
 * `smu` and (for hold) `workflowStage` must be selected by the caller; a
 * missing smu reads as not-Base, so a caller that forgets fails closed.
 */
export function tintManagerBillRefusal(order: TintBillFacts | null, action: TintAction): string | null {
  if (order === null || order.isRemoved) return "Order not found";
  if (order.orderType === "tint") return null;
  if (!isBaseBill(order)) return "Not a tint or Base bill — use Floor";
  if (!BASE_ACTIONS.includes(action)) return "Not available on a Base bill — use Floor";
  if (action === "hold" && order.workflowStage !== undefined && BASE_PICKER_STAGES.includes(order.workflowStage)) {
    return BASE_PICKER_HOLD_REFUSAL;
  }
  return null;
}
