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
// Per-part ship-to (v27.81) — see the cycle note in the section at the bottom.
import { computeDropKey } from "@/lib/trips/drop-key";

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

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 PER-PART SHIP-TO (Schema v27.81, owner 2026-11-19 — REVERSES Model A for
// ship-to only; do not revert). Plan: docs/prompts/drafts/code-plan-2026-11-19-
// split-load-per-part-ship-to.md §A.6. THE ONE OWNER of "where does this PART
// go": every reader and writer calls these, never the raw columns.
//
//   order_invoices."shipToOverride" is a TRI-STATE:
//     NULL  = INHERIT the OBD's four orders columns (every row at v27.81)
//     TRUE  = the part's own redirect — a dealer id OR a typed name + area
//     FALSE = the part's own reset to SAP's own site, even when the OBD is redirected
//   orders."shipToOverride" is boolean NULLABLE in the live DDL (0 NULL rows on
//   2026-11-19, CORE §13): on the OBD side a NULL reads as FALSE. The two NULLs
//   mean different things — this file is the only place that reads both.
//
// "Same shop" = equal drop key (lib/trips/drop-key.ts computeDropKey over
// effectiveDropInput) — the identity a trip stop uses, so the merge refusal,
// the "2 shops" tag and the stop grouping can never disagree. Never parse a key.
//
// ⚠ IMPORT CYCLE, deliberate and safe: drop-key.ts imports typedDropText from
// here and this imports computeDropKey from there. Both are used only INSIDE
// functions (never at module load), so either load order works.
// ═══════════════════════════════════════════════════════════════════════════


/** The OBD's four ship-to columns (orders). shipToOverride NULL = false. */
export interface ObdShipToCols {
  shipToOverride: boolean | null;
  shipToOverrideCustomerId: number | null;
  shipToText: string | null;
  shipToAreaId: number | null;
}

/** A part's four ship-to columns (order_invoices). shipToOverride NULL = INHERIT. */
export interface PartShipToCols {
  shipToOverride: boolean | null;
  shipToOverrideCustomerId: number | null;
  shipToText: string | null;
  shipToAreaId: number | null;
}

/** The four columns a part actually goes by, and whether they are its own. */
export interface EffectiveShipTo {
  shipToOverride: boolean;
  shipToOverrideCustomerId: number | null;
  shipToText: string | null;
  shipToAreaId: number | null;
  /** true = the part's own value; false = inherited from the OBD (or no part given). */
  own: boolean;
}

/** Rule 1: a part with NULL shipToOverride (or no part at all) inherits. */
export function isInheriting(part: Pick<PartShipToCols, "shipToOverride"> | null | undefined): boolean {
  return part === null || part === undefined || part.shipToOverride === null;
}

/** Rule 1: the part's own columns when it has them, else the OBD's (NULL flag → false). */
export function effectiveShipTo(order: ObdShipToCols, part?: PartShipToCols | null): EffectiveShipTo {
  if (part !== null && part !== undefined && part.shipToOverride !== null) {
    return {
      shipToOverride: part.shipToOverride,
      shipToOverrideCustomerId: part.shipToOverrideCustomerId,
      shipToText: part.shipToText,
      shipToAreaId: part.shipToAreaId,
      own: true,
    };
  }
  return {
    shipToOverride: order.shipToOverride ?? false,
    shipToOverrideCustomerId: order.shipToOverrideCustomerId,
    shipToText: order.shipToText,
    shipToAreaId: order.shipToAreaId,
    own: false,
  };
}

/**
 * The bill as a trip stop sees it for ONE part: every field of `order` kept
 * (customerId, SAP's code, shipToCustomerName …) with the four ship-to columns
 * replaced by the part's effective ones. Feed it to computeDropKey /
 * findOrCreateTripDrop. No part (or an inheriting one) → the OBD's own values.
 */
export function effectiveDropInput<O extends ShipToFacts & { shipToOverride?: boolean | null }>(
  order: O,
  part?: PartShipToCols | null,
): O & { shipToOverride: boolean } {
  const eff = effectiveShipTo(
    {
      shipToOverride: order.shipToOverride ?? null,
      shipToOverrideCustomerId: order.shipToOverrideCustomerId,
      shipToText: order.shipToText,
      shipToAreaId: order.shipToAreaId,
    },
    part,
  );
  return {
    ...order,
    shipToOverride: eff.shipToOverride,
    shipToOverrideCustomerId: eff.shipToOverrideCustomerId,
    shipToText: eff.shipToText,
    shipToAreaId: eff.shipToAreaId,
  };
}

/** The stop identity of one part (drop-key equality is "same shop"). */
export function partShopKey(order: ShipToFacts & { shipToOverride?: boolean | null }, part?: PartShipToCols | null): string {
  return computeDropKey(effectiveDropInput(order, part));
}

/**
 * Rules 5 and 6: how many DIFFERENT shops these parts go to (≥ 1 for any
 * non-empty list, 0 for none). By drop-key equality only — a dealer redirect
 * to the bill's own customer is the same shop as no redirect.
 */
export function partsShopCount(
  order: ShipToFacts & { shipToOverride?: boolean | null },
  parts: ReadonlyArray<PartShipToCols | null | undefined>,
): number {
  return new Set(parts.map((p) => partShopKey(order, p))).size;
}
