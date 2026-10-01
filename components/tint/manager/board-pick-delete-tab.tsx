"use client";

// Tint Manager — the Pick delete tab: the DECISION HISTORY (2026-10-01, tabs
// build step 8 — plan §A/§E, mockup "pick").
//
// NOT A FORK. It is Billing's own History tab (components/billing/
// billing-pick-delete-tab.tsx BillingPickDeleteTab) pointed at the Tint
// Manager's routes — base /api/tint/manager/pick-delete, owner "tint": only
// same-SO groups whose every bill is SMU 74/77 — with the tint column labels
// (When · SO · Site · Decision · OBD removed · By, and Undo on deleted rows for
// tint_pick_delete canEdit). The deciding itself happens in the blocking popup
// (BillingPickDeletePopup, mounted by tint-manager-content.tsx with the same
// base); an Undo here fires PICK_DELETE_CHECK_EVENT so that popup checks at once.

import { BillingPickDeleteTab } from "@/components/billing/billing-pick-delete-tab";

export const TINT_PICK_DELETE_BASE = "/api/tint/manager/pick-delete";

export function BoardPickDeleteTab({
  canEdit,
  onCount,
}: {
  /** tint_manager canEdit && tint_pick_delete canEdit — draws the Undo column. */
  canEdit: boolean;
  /** The decided-row count for the month shown — the tab badge. */
  onCount: (n: number) => void;
}) {
  return (
    <BillingPickDeleteTab
      canEdit={canEdit}
      base={TINT_PICK_DELETE_BASE}
      columns="tint"
      onCount={onCount}
    />
  );
}
