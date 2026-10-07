"use client";

// Challan orders access — carried from a server layout to the client tree
// (Challan orders slice 5, 2026-10-07). A courier exactly like
// billing-telephonic-access-provider.tsx: the two booleans are resolved ONCE,
// server-side, off the layout's own `allPerms` map — Billing's
// app/(mail-orders)/mail-orders/layout.tsx and Place Order's
// app/(place-order)/layout.tsx. (Floor passes the same two booleans as props from
// app/(floor)/floor/page.tsx, which has no provider stack.)
//
// Defaults to all-false: a component rendered outside the provider sees no tab
// and no link. Fail-closed.
//
// ⚠ FOR DRAWING THE SCREEN, NEVER FOR AUTHORISATION. Every /api/challan-orders/*
// route re-checks challan_orders. If the two ever disagree, the ROUTE is right.

import { createContext, useContext, useMemo } from "react";

export interface ChallanOrdersAccess {
  /** May see the Challan orders tab / link and the screen. */
  canView: boolean;
  /** May paste and unlink SOs. Meaningless without canView. */
  canEdit: boolean;
}

const NONE: ChallanOrdersAccess = { canView: false, canEdit: false };

const ChallanOrdersAccessContext = createContext<ChallanOrdersAccess>(NONE);

export function ChallanOrdersAccessProvider({
  canView,
  canEdit,
  children,
}: {
  canView: boolean;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo<ChallanOrdersAccess>(() => ({ canView, canEdit }), [canView, canEdit]);
  return <ChallanOrdersAccessContext.Provider value={value}>{children}</ChallanOrdersAccessContext.Provider>;
}

export function useChallanOrdersAccess(): ChallanOrdersAccess {
  return useContext(ChallanOrdersAccessContext);
}
