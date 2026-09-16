"use client";

// Place Order ACTION ticks — carried from the server layout to the client tree.
//
//   place_order_ship_to   the Ship To block in the desktop cart panel
//
// Resolved ONCE, server-side, in app/(place-order)/layout.tsx, off the SAME
// `allPerms` map that layout already computes for buildNavItems — no extra
// query, no client fetch. This provider is only a courier, exactly like
// BillingActionsAccessProvider, so page.tsx keeps its bare `<ComponentName />`
// shape (CORE §3).
//
// 🔴 canEdit IS THE ONLY QUESTION ASKED OF THIS KEY: "may this person set a
// ship-to on the order". Never read canView off it.
//
// Defaults to false, so a component rendered outside the provider offers no
// Ship To at all. Fail-closed, the same stance as every resolver in
// lib/permissions.ts.
//
// ⚠ THIS IS FOR DRAWING THE SCREEN, NOT A SECURITY BOUNDARY. /place-order sends
// by mailto: with no server write to re-check, and the public /po page (which a
// < 1024px window redirects to) keeps its own Ship-to. This hides a control; it
// cannot stop someone typing a ship-to into an email by hand.

import { createContext, useContext, useMemo } from "react";

export interface PlaceOrderAccess {
  /** May set a Ship To on the order (desktop cart panel). */
  canShipTo: boolean;
}

const NONE: PlaceOrderAccess = { canShipTo: false };

const PlaceOrderAccessContext = createContext<PlaceOrderAccess>(NONE);

export function PlaceOrderAccessProvider({
  canShipTo,
  children,
}: {
  canShipTo: boolean;
  children: React.ReactNode;
}) {
  // Memoised on the primitive so a consumer does not re-render on every parent
  // render.
  const value = useMemo<PlaceOrderAccess>(() => ({ canShipTo }), [canShipTo]);
  return (
    <PlaceOrderAccessContext.Provider value={value}>
      {children}
    </PlaceOrderAccessContext.Provider>
  );
}

export function usePlaceOrderAccess(): PlaceOrderAccess {
  return useContext(PlaceOrderAccessContext);
}
