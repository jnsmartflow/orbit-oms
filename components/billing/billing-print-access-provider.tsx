"use client";

// Billing Print tab access — carried from the server layout to the client tree
// (slice 9, 2026-09-15). The twin of billing-picking-access-provider.tsx, and a
// courier exactly like it: the two booleans are resolved ONCE, server-side, in
// app/(mail-orders)/mail-orders/layout.tsx off the SAME `allPerms` map.
//
// Defaults to all-false, so a component rendered outside the provider sees the
// tab as not granted. Fail-closed.
//
// ⚠ THIS IS FOR DRAWING THE SCREEN, NEVER FOR AUTHORISATION. The three
// /api/billing/print/* routes re-check `billing_print` server-side. If the two
// ever disagree, the ROUTE is right.

import { createContext, useContext, useMemo } from "react";

export interface BillingPrintAccess {
  /** May see the Print pill, its body, and the live count. */
  canView: boolean;
  /** May press the Copy that records itself. Meaningless without canView. */
  canEdit: boolean;
}

const NONE: BillingPrintAccess = { canView: false, canEdit: false };

const BillingPrintAccessContext = createContext<BillingPrintAccess>(NONE);

export function BillingPrintAccessProvider({
  canView,
  canEdit,
  children,
}: {
  canView: boolean;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo<BillingPrintAccess>(() => ({ canView, canEdit }), [canView, canEdit]);
  return <BillingPrintAccessContext.Provider value={value}>{children}</BillingPrintAccessContext.Provider>;
}

export function useBillingPrintAccess(): BillingPrintAccess {
  return useContext(BillingPrintAccessContext);
}
