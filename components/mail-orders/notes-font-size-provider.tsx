"use client";

// Notes-band text size — carried from the server layout to the client tree.
//
// The value is resolved ONCE, server-side, in
// app/(mail-orders)/mail-orders/layout.tsx (getNotesFontSize). This provider is
// only a courier, exactly like BillingV2Provider: it puts that single answer
// where client components can read it, so nothing below has to re-fetch it and
// page.tsx keeps its bare `<ComponentName />` shape (CORE §3).
//
// ⚠ Deliberately SEPARATE from BillingV2Provider rather than a second value on
// it. That provider is a rollout FLAG whose fail-closed `false` default is the
// point; this is a user PREFERENCE that applies on both faces (only the stepper
// control is billing-gated, not the size itself). One context per concern, so
// neither default has to explain the other.
//
// Defaults to 11 — the column's own default and the size the band has always
// rendered at — so a component outside the provider looks like today.

import { createContext, useContext } from "react";
import { DEFAULT_NOTES_FONT_PX } from "@/lib/mail-orders/notes-font-size";

const NotesFontSizeContext = createContext<number>(DEFAULT_NOTES_FONT_PX);

export function NotesFontSizeProvider({
  size,
  children,
}: {
  size: number;
  children: React.ReactNode;
}) {
  return (
    <NotesFontSizeContext.Provider value={size}>{children}</NotesFontSizeContext.Provider>
  );
}

/** The size resolved server-side for this user, in px. Seeds page state; it is
 *  NOT the live value once the operator starts stepping — mail-orders-page.tsx
 *  owns that. */
export function useInitialNotesFontSize(): number {
  return useContext(NotesFontSizeContext);
}
