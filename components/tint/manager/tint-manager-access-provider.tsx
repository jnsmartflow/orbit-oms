"use client";

// Tint Manager panel TAB ticks — carried from the server layout to the client tree.
//
//   tint_panel_items      the Items tab of the job detail panel
//   tint_panel_details    the Details tab (Reference + Audit history)
//   tint_panel_activity   the Activity tab (operator, pause / skip history)
//
// Three, not one, so an admin can grant any combination per person.
//
// Resolved ONCE, server-side, in app/(tint)/tint/manager/layout.tsx, off the
// SAME `allPerms` map that layout already computes for buildNavItems — no extra
// query, no client fetch. This provider is only a courier, exactly like
// PlaceOrderAccessProvider, so page.tsx keeps its bare `<ComponentName />` shape
// (CORE §3).
//
// 🔴 canView IS THE ONLY QUESTION ASKED OF THESE KEYS: "may this person see that
// tab". Never read canEdit off them.
//
// Defaults to all-false, so a component rendered outside the provider shows no
// tab at all. Fail-closed, the same stance as every resolver in
// lib/permissions.ts.
//
// ⚠ THIS IS FOR DRAWING THE SCREEN. The routes a hidden tab would call re-check
// the matching key themselves — /api/orders/[id]/audit-history on
// tint_panel_details, pause-history and skip-history on tint_panel_activity.
// The Items tab reads the board payload and has no route of its own, so hiding
// it is UI-only. The Details tab's Reference fields likewise come from the board
// payload, which the table itself needs; hiding them is UI-only by design.

import { createContext, useContext, useMemo } from "react";

export interface TintManagerAccess {
  /** May see the Items tab of the job panel. */
  canPanelItems: boolean;
  /** May see the Details tab (Reference + Audit history). */
  canPanelDetails: boolean;
  /** May see the Activity tab (operator, pauses, skips). */
  canPanelActivity: boolean;
}

const NONE: TintManagerAccess = {
  canPanelItems: false, canPanelDetails: false, canPanelActivity: false,
};

const TintManagerAccessContext = createContext<TintManagerAccess>(NONE);

export function TintManagerAccessProvider({
  canPanelItems,
  canPanelDetails,
  canPanelActivity,
  children,
}: {
  canPanelItems: boolean;
  canPanelDetails: boolean;
  canPanelActivity: boolean;
  children: React.ReactNode;
}) {
  // Memoised on the primitives so a consumer does not re-render on every parent
  // render.
  const value = useMemo<TintManagerAccess>(
    () => ({ canPanelItems, canPanelDetails, canPanelActivity }),
    [canPanelItems, canPanelDetails, canPanelActivity],
  );
  return (
    <TintManagerAccessContext.Provider value={value}>
      {children}
    </TintManagerAccessContext.Provider>
  );
}

export function useTintManagerAccess(): TintManagerAccess {
  return useContext(TintManagerAccessContext);
}
