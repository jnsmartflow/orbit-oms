"use client";

// Billing v2 rollout flag — carried from the server layout to the client tree.
//
// The flag is resolved ONCE, server-side, in
// app/(mail-orders)/mail-orders/layout.tsx (isBillingV2Enabled → stage +
// per-user). This provider is only a courier: it puts that single answer where
// client components can read it, so nothing below has to re-fetch it and
// page.tsx keeps its bare `<ComponentName />` shape (CORE §3).
//
// Defaults to FALSE, so a component rendered outside the provider — or before
// the flag resolves — sees the feature as off. Fail-closed, same stance as the
// server helper.

import { createContext, useContext } from "react";

const BillingV2Context = createContext(false);

export function BillingV2Provider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return <BillingV2Context.Provider value={enabled}>{children}</BillingV2Context.Provider>;
}

export function useBillingV2(): boolean {
  return useContext(BillingV2Context);
}
