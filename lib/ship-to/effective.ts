// lib/ship-to/effective.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 ONE RULE FOR "WHERE DOES THIS BILL GO" ONCE A SHIP-TO CAN BE TYPED
// ═══════════════════════════════════════════════════════════════════════════
//
// A bill's ship-to is one of three (Schema v27.73, free-text ship-to step 7):
//   dealer redirect   shipToOverrideCustomerId set
//   typed             shipToText set (a site name, or "As per challan"), with
//                     its own picked area (shipToAreaId — the CHECK requires it)
//   plain             neither — the bill's own customer
//
// Every read site asks THIS file, never the columns:
//   • isRedirected — "dealer id OR typed text". 🔴 NEVER the bare
//     orders.shipToOverride flag: ~174 open bills carry it with no id and no
//     text (legacy email-remark captures). Owner rule, 2026-10-20.
//   • deskShipToName — the typed text, else the dealer name (desk screens).
//   • effectiveArea — the typed area wins over the dealer's; routing follows
//     the typed area everywhere (owner, 2026-10-20).
//   • typedDropText — the trip stop body for the `t:` drop key.
//
// PURE. No Prisma, no clock — lib/trips/drop-key.ts imports it.

import { isAsPerChallanText } from "@/lib/ship-to/copy";
import { dealerDisplayName } from "@/lib/orders/dealer-name";

/** The bill columns these rules read. */
export interface ShipToFacts {
  customerId: number | null;
  shipToOverrideCustomerId: number | null;
  /** orders.shipToCustomerId — SAP's own ship-to code. */
  shipToCustomerId: string;
  shipToText: string | null;
  shipToAreaId: number | null;
}

/** A typed ship-to: non-blank text (the CHECK already refuses blank). */
export function isTypedShipTo(o: Pick<ShipToFacts, "shipToText">): boolean {
  return o.shipToText != null && o.shipToText.trim() !== "";
}

/** Dealer redirect OR typed ship-to. Never the bare flag. */
export function isRedirected(o: Pick<ShipToFacts, "shipToOverrideCustomerId" | "shipToText">): boolean {
  return o.shipToOverrideCustomerId !== null || isTypedShipTo(o);
}

export function isAsPerChallanBill(o: Pick<ShipToFacts, "shipToText">): boolean {
  return isTypedShipTo(o) && isAsPerChallanText(o.shipToText as string);
}

/**
 * The ship-to name a DESK screen (Floor) shows: the typed text exactly as
 * typed ("As per challan" included), else today's dealer ladder — master name
 * of the effective dealer, then SAP's ship-to name, then "(Unmatched)".
 */
export function deskShipToName(
  o: Pick<ShipToFacts, "shipToText">,
  names: { effectiveDealer?: string | null; sap?: string | null },
): string {
  return isTypedShipTo(o) ? (o.shipToText as string) : dealerDisplayName(names.effectiveDealer, names.sap);
}

/** The typed area when the bill is typed, else the dealer's. */
export function effectiveArea<A>(o: Pick<ShipToFacts, "shipToText">, typedArea: A | null, dealerArea: A | null): A | null {
  return isTypedShipTo(o) ? typedArea : dealerArea;
}

/** Longest normalised text kept in a drop key. */
const DROP_TEXT_MAX = 80;

/**
 * The text part of a typed drop key: lower-case, whitespace (newlines too)
 * collapsed to one space, `|` and `#` stripped, trimmed, capped at 80. Two
 * spellings that differ only in case or spacing are one stop. Empty → null.
 */
export function normaliseDropText(text: string): string | null {
  const t = text.toLowerCase().replace(/[|#]/g, "").replace(/\s+/g, " ").trim().slice(0, DROP_TEXT_MAX).trim();
  return t === "" ? null : t;
}

/**
 * The typed stop body `<scope>/<shipToAreaId>/<normalised text>`, or null for
 * a bill that is not typed (→ today's c: / s: key). Stored as
 * trip_drops.shipToText; the key is 't:' + this (live chk_trip_drops_key).
 *
 * scope = the bill's customerId, else SAP's ship-to code — so two dealers'
 * "As per challan" never share a stop. The AREA is in the key (owner,
 * 2026-10-20): the same text in two areas is two stops.
 */
export function typedDropText(o: ShipToFacts): string | null {
  if (!isTypedShipTo(o) || o.shipToAreaId === null) return null;
  const text = normaliseDropText(o.shipToText as string);
  if (text === null) return null;
  const scope = o.customerId !== null ? String(o.customerId) : o.shipToCustomerId;
  return `${scope}/${o.shipToAreaId}/${text}`;
}
