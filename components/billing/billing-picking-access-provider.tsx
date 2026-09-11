"use client";

// Billing Picking tab access — carried from the server layout to the client tree.
//
// The two booleans are resolved ONCE, server-side, in
// app/(mail-orders)/mail-orders/layout.tsx, off the SAME `allPerms` map that
// layout already computes for buildNavItems. No extra query, no client fetch.
// This provider is only a courier, exactly like BillingV2Provider next door —
// it puts one answer where client components can read it so page.tsx keeps its
// bare `<ComponentName />` shape (CORE §3).
//
// 🔴 `billing_picking` IS NOT THE FLOOR BOARD'S `picking`. That one gates
// /picking and is held by two dozen pickers and supervisors. These two keys
// share a word and nothing else — never read one to decide the other.
//
// Defaults to all-false, so a component rendered outside the provider sees the
// tab as not granted. Fail-closed, the same stance as the flag provider and as
// every permission resolver in lib/permissions.ts.
//
// ⚠ THIS IS FOR DRAWING THE SCREEN, NEVER FOR AUTHORISATION. The five
// /api/billing/picking/* routes re-check the permission server-side and that is
// what actually stops a read or a write. This only stops the screen offering a
// control the server would refuse. If the two ever disagree, the ROUTE is
// right. Same rule app/mrn/page.tsx states for MrnPerms.

import { createContext, useContext, useMemo } from "react";

export interface BillingPickingAccess {
  /** May see the Picking pill, its body, and the live count. */
  canView: boolean;
  /** May Mark done and Undo. Meaningless without canView. */
  canEdit: boolean;
}

const NONE: BillingPickingAccess = { canView: false, canEdit: false };

const BillingPickingAccessContext = createContext<BillingPickingAccess>(NONE);

export function BillingPickingAccessProvider({
  canView,
  canEdit,
  children,
}: {
  canView: boolean;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  // Memoised on the two primitives rather than rebuilt each render, so a
  // consumer reading this context does not re-render on every parent render.
  const value = useMemo<BillingPickingAccess>(
    () => ({ canView, canEdit }),
    [canView, canEdit],
  );
  return (
    <BillingPickingAccessContext.Provider value={value}>
      {children}
    </BillingPickingAccessContext.Provider>
  );
}

export function useBillingPickingAccess(): BillingPickingAccess {
  return useContext(BillingPickingAccessContext);
}
