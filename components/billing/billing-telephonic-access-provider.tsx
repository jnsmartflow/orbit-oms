"use client";

// Billing Telephonic tab access — carried from the server layout to the client
// tree (2026-09-22). The twin of billing-print-access-provider.tsx, and a
// courier exactly like it: the two booleans are resolved ONCE, server-side, in
// app/(mail-orders)/mail-orders/layout.tsx off the SAME `allPerms` map.
//
// Defaults to all-false, so a component rendered outside the provider sees the
// tab as not granted. Fail-closed.
//
// ⚠ THIS IS FOR DRAWING THE SCREEN, NEVER FOR AUTHORISATION. The four
// /api/billing/telephonic/* routes re-check `billing_telephonic` server-side.
// If the two ever disagree, the ROUTE is right.

import { createContext, useContext, useMemo } from "react";

export interface BillingTelephonicAccess {
  /** May see the Telephonic pill, its body, and the live count. */
  canView: boolean;
  /** May add and remove tags. Meaningless without canView. */
  canEdit: boolean;
}

const NONE: BillingTelephonicAccess = { canView: false, canEdit: false };

const BillingTelephonicAccessContext = createContext<BillingTelephonicAccess>(NONE);

export function BillingTelephonicAccessProvider({
  canView,
  canEdit,
  children,
}: {
  canView: boolean;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo<BillingTelephonicAccess>(() => ({ canView, canEdit }), [canView, canEdit]);
  return (
    <BillingTelephonicAccessContext.Provider value={value}>{children}</BillingTelephonicAccessContext.Provider>
  );
}

export function useBillingTelephonicAccess(): BillingTelephonicAccess {
  return useContext(BillingTelephonicAccessContext);
}
