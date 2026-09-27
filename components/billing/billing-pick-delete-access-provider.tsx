"use client";

// Billing Pick delete tab access — carried from the server layout to the client
// tree (2026-09-27). The twin of billing-telephonic-access-provider.tsx, and a
// courier exactly like it: the two booleans are resolved ONCE, server-side, in
// app/(mail-orders)/mail-orders/layout.tsx off the SAME `allPerms` map.
//
// Defaults to all-false, so a component rendered outside the provider sees the
// tab as not granted. Fail-closed.
//
// ⚠ THIS IS FOR DRAWING THE SCREEN, NEVER FOR AUTHORISATION. The six
// /api/billing/pick-delete/* routes re-check `billing_pick_delete` server-side.
// If the two ever disagree, the ROUTE is right.

import { createContext, useContext, useMemo } from "react";

export interface BillingPickDeleteAccess {
  /** May see the Pick delete pill, its body, and the live count. */
  canView: boolean;
  /** May press All OK, Pick delete and Undo. Meaningless without canView. */
  canEdit: boolean;
}

const NONE: BillingPickDeleteAccess = { canView: false, canEdit: false };

const BillingPickDeleteAccessContext = createContext<BillingPickDeleteAccess>(NONE);

export function BillingPickDeleteAccessProvider({
  canView,
  canEdit,
  children,
}: {
  canView: boolean;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo<BillingPickDeleteAccess>(() => ({ canView, canEdit }), [canView, canEdit]);
  return (
    <BillingPickDeleteAccessContext.Provider value={value}>{children}</BillingPickDeleteAccessContext.Provider>
  );
}

export function useBillingPickDeleteAccess(): BillingPickDeleteAccess {
  return useContext(BillingPickDeleteAccessContext);
}
