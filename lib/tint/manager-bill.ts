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

import type { PageKey } from "@/lib/permissions";
import { checkAnyPermission } from "@/lib/permissions";

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
  | "pick-delete";

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

/** What tintBillRefusal needs to know about a bill. */
export interface TintBillFacts {
  orderType: string;
  isRemoved: boolean;
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
