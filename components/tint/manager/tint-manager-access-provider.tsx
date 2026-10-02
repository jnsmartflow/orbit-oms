"use client";

// Tint Manager ticks — carried from the server layout to the client tree.
//
// Panel TABS (2026-09-17), canView only:
//   tint_panel_items      the Items tab of the job detail panel
//   tint_panel_details    the Details tab (Reference + Audit history)
//   tint_panel_activity   the Activity tab (operator, pause / skip history)
// Three, not one, so an admin can grant any combination per person.
//
// Plus canReports (2026-09-17): canView on ANY of REPORT_PAGE_KEYS, which
// decides whether the header's "Reports" pill is drawn. Same rule as the hub
// door and the sidebar row (canViewAnyReport in lib/permissions.ts).
//
// Plus the ACTION ticks (2026-10-01, tabs build step 2 — plan §B). Each action
// boolean is `tint_manager` canEdit AND the action key's canEdit, the same rule
// the routes enforce (lib/tint/manager-bill.ts checkTintAction). The tab
// booleans are the key's canView. canEdit is the host tick alone — Assign,
// Re-assign, Send back and the Base bypass stay on it (owner decision 7).
// ⚠ NOTHING READS THE ACTION / TAB FIELDS YET — the UI that draws them lands
// in build steps 5-8. They are couriered now so those steps add no layout work.
//
// Resolved ONCE, server-side, in app/(tint)/tint/manager/layout.tsx, off the
// SAME `allPerms` map that layout already computes for buildNavItems — no extra
// query, no client fetch. This provider is only a courier, exactly like
// PlaceOrderAccessProvider, so page.tsx keeps its bare `<ComponentName />` shape
// (CORE §3).
//
// 🔴 The panel-tab keys are asked ONLY canView: "may this person see that tab".
//
// Defaults to all-false, so a component rendered outside the provider shows no
// tab and no action at all. Fail-closed, the same stance as every resolver in
// lib/permissions.ts.
//
// ⚠ THIS IS FOR DRAWING THE SCREEN. Every route a hidden control would call
// re-checks its key itself — /api/orders/[id]/audit-history on
// tint_panel_details, pause-history and skip-history on tint_panel_activity,
// and every tint action route on checkTintAction. The Items tab reads the board
// payload and has no route of its own, so hiding it is UI-only. The Details
// tab's Reference fields likewise come from the board payload, which the table
// itself needs; hiding them is UI-only by design.

import { createContext, useContext, useMemo } from "react";

export interface TintManagerAccess {
  /** May see the Items tab of the job panel. */
  canPanelItems: boolean;
  /** May see the Details tab (Reference + Audit history). */
  canPanelDetails: boolean;
  /** May see the Activity tab (operator, pauses, skips). */
  canPanelActivity: boolean;
  /** Holds canView on any report key — draws the header "Reports" pill. */
  canReports: boolean;
  /** tint_manager canEdit — Assign / Re-assign / Send back / Base bypass. */
  canEdit: boolean;
  /** tint_manager canEdit && tint_hold canEdit — Hold + Release (unhold). */
  canHold: boolean;
  /** tint_manager canEdit && tint_hand canEdit. */
  canHand: boolean;
  /** tint_manager canEdit && tint_slot canEdit — bar Slot, Slot cell, panel chip. */
  canSlot: boolean;
  /** tint_manager canEdit && tint_ship_to canEdit. */
  canShipTo: boolean;
  /** tint_manager canEdit && tint_cancel canEdit — Cancel, Stop & cancel, Restore, Remove OBD. */
  canCancel: boolean;
  /** tint_manager canEdit && tint_ci canEdit. */
  canCi: boolean;
  /** tint_manager canEdit && tint_pick_delete canEdit — the popup + Undo. */
  canPickDelete: boolean;
  /** tint_manager canEdit && tint_shop_delivery canEdit — the bar's Shop delivery
   *  (bulk ship-to = each bill's own bill-to dealer). Independent of canShipTo. */
  canShopDelivery: boolean;
  /** tint_manager canEdit && tint_urgent canEdit — the bar's ⚡ Urgent / Clear urgent. */
  canUrgent: boolean;
  /** tint_manager canEdit && tint_ti_bulk canEdit — the TI tab's WHT 5 / 20 / 25 buttons. */
  canTiBulk: boolean;
  /** tint_hold canView — the Hold tab. */
  canViewHoldTab: boolean;
  /** tint_ci canView || tint_cancel canView — the CI tab. */
  canViewCiTab: boolean;
  /** tint_pick_delete canView — the Pick delete tab. */
  canViewPickDelete: boolean;
}

const NONE: TintManagerAccess = {
  canPanelItems: false, canPanelDetails: false, canPanelActivity: false,
  canReports: false,
  canEdit: false,
  canHold: false, canHand: false, canSlot: false, canShipTo: false,
  canCancel: false, canCi: false, canPickDelete: false, canShopDelivery: false, canUrgent: false, canTiBulk: false,
  canViewHoldTab: false, canViewCiTab: false, canViewPickDelete: false,
};

const TintManagerAccessContext = createContext<TintManagerAccess>(NONE);

export function TintManagerAccessProvider({
  access,
  children,
}: {
  /** Resolved by the layout. A field left out reads as false. */
  access: Partial<TintManagerAccess>;
  children: React.ReactNode;
}) {
  const a = { ...NONE, ...access };
  // Memoised on the primitives so a consumer does not re-render on every parent
  // render.
  const value = useMemo<TintManagerAccess>(
    () => ({
      canPanelItems: a.canPanelItems, canPanelDetails: a.canPanelDetails,
      canPanelActivity: a.canPanelActivity, canReports: a.canReports,
      canEdit: a.canEdit,
      canHold: a.canHold, canHand: a.canHand, canSlot: a.canSlot, canShipTo: a.canShipTo,
      canCancel: a.canCancel, canCi: a.canCi, canPickDelete: a.canPickDelete,
      canShopDelivery: a.canShopDelivery, canUrgent: a.canUrgent, canTiBulk: a.canTiBulk,
      canViewHoldTab: a.canViewHoldTab, canViewCiTab: a.canViewCiTab, canViewPickDelete: a.canViewPickDelete,
    }),
    [
      a.canPanelItems, a.canPanelDetails, a.canPanelActivity, a.canReports,
      a.canEdit,
      a.canHold, a.canHand, a.canSlot, a.canShipTo,
      a.canCancel, a.canCi, a.canPickDelete, a.canShopDelivery, a.canUrgent, a.canTiBulk,
      a.canViewHoldTab, a.canViewCiTab, a.canViewPickDelete,
    ],
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
