"use client";

// Billing ACTION ticks — carried from the server layout to the client tree.
//
// Four independent permissions, one per button on the Billing Orders tab:
//
//   billing_hold      ⚑ Hold
//   billing_slot      🕑 Slot (and its dispatch-slot picker)
//   billing_urgent    ⚡ Urgent
//   billing_ship_to   ✎ the ship-to pencil on the Ship To card
//
// Four, not one, because the owner wants Slot grantable without Hold.
//
// Resolved ONCE, server-side, in app/(mail-orders)/mail-orders/layout.tsx, off
// the SAME `allPerms` map that layout already computes for buildNavItems — no
// extra query, no client fetch, nothing per poll. This provider is only a
// courier, exactly like BillingV2Provider and BillingPickingAccessProvider
// beside it, so page.tsx keeps its bare `<ComponentName />` shape (CORE §3).
//
// 🔴 canEdit IS THE ONLY QUESTION ASKED OF THESE KEYS: "may this person press
// that button". There is no canView meaning — /admin/access draws a View box for
// every key it knows and those four boxes gate nothing (lib/permissions.ts,
// isActionAvailable's known limit). Never read canView off these.
//
// Defaults to all-false, so a component rendered outside the provider offers no
// action at all. Fail-closed, the same stance as the flag provider and as every
// resolver in lib/permissions.ts.
//
// ⚠ THIS IS FOR DRAWING THE SCREEN, NEVER FOR AUTHORISATION.
// POST /api/billing/mail-order/actions re-checks the matching key per action
// before it builds a payload, and THAT is what actually refuses a write. This
// only stops the screen offering a control the server would reject. If the two
// ever disagree, the ROUTE is right. Same rule the Picking provider states.
//
// ⚠ HIDING CHANGES NOTHING THAT IS ALREADY TRUE. A bill held before a tick was
// revoked stays held, keeps its slot, and still reads as held on Floor. These
// booleans decide whether a control renders — never what the data says.

import { createContext, useContext, useMemo } from "react";

export interface BillingActionsAccess {
  /** May put a mail order on hold, or release it. */
  hold: boolean;
  /** May set or clear the dispatch slot. */
  slot: boolean;
  /** May mark or clear urgent. */
  urgent: boolean;
  /** May redirect the delivery dealer, or clear a redirect. */
  shipTo: boolean;
}

const NONE: BillingActionsAccess = {
  hold: false, slot: false, urgent: false, shipTo: false,
};

const BillingActionsAccessContext = createContext<BillingActionsAccess>(NONE);

export function BillingActionsAccessProvider({
  hold,
  slot,
  urgent,
  shipTo,
  children,
}: {
  hold: boolean;
  slot: boolean;
  urgent: boolean;
  shipTo: boolean;
  children: React.ReactNode;
}) {
  // Memoised on the four primitives rather than rebuilt each render, so a
  // consumer reading this context does not re-render on every parent render.
  const value = useMemo<BillingActionsAccess>(
    () => ({ hold, slot, urgent, shipTo }),
    [hold, slot, urgent, shipTo],
  );
  return (
    <BillingActionsAccessContext.Provider value={value}>
      {children}
    </BillingActionsAccessContext.Provider>
  );
}

export function useBillingActionsAccess(): BillingActionsAccess {
  return useContext(BillingActionsAccessContext);
}
