// /so-lab FORK of app/po2/v2-email.ts (C.2a, 2026-10-01).
//
// Two changes from /po2, nothing else:
//  1. The mail goes to SO_TEST_ORDER_TO, never the depot (ORDER_TO is NOT
//     imported) — test orders must never reach the mail parser.
//  2. The body ends with "Sent by {SO name}" — /po2's mail has no sender stamp.
// Subject (buildSubject) and body (renderOrderBody) are the shared builders,
// imported read-only from lib/place-order/email.ts and NOT reimplemented, so
// the mail stays byte-identical to /po2's apart from the final line.
import {
  buildSubject, emailLineLabel, renderOrderBody,
  type OrderBodyBill, type OrderBodyLine,
} from "@/lib/place-order/email";
import type { ApiCustomer, V2CartLine, V2Order } from "./v2-data";

// TEST PHASE — phase D replaces this (direct submit into Orbit + a PO number,
// then the mail to the depot). Until then every /so-lab order goes to the
// owner's own inbox so the parser never sees it.
export const SO_TEST_ORDER_TO = "harsh.jnenterprise@outlook.com";

/**
 * Subject + body for the current v2 order, byte-identical to what /po would
 * send for the same menu rows.
 *
 * Field-for-field against po-page.tsx's buildEmailParts:
 *
 *  Bill To  — `${name} (${code})`, exactly its billTo expression.
 *  Ship To  — NULL when shipping to the billing dealer. /po models this as
 *             free text and strips "same as billing" in resolvedShipTo();
 *             v2 models it as a customer-or-null, so the null IS the default
 *             and there is no string to strip. When it is a different dealer
 *             the value is `${name} (${code})` — the shape Parse-AppBody's
 *             SHIPTO branch reads, and the shape the parser test fixtures use.
 *  Dispatch — "Call to " + callTarget when Call; the enum verbatim when
 *             Urgent; NULL on Normal, which drops the line.
 *  Remark   — the four marker literals, Cross carrying its depot. Lowercase,
 *             unlike the subject's capitalised prefix. That split is real.
 *  Note     — notes.trim() || null.
 *  name     — emailLineLabel(product, baseColour, subProduct) off the MENU
 *             ROW. Never our tile label.
 *  packs    — `${label}*${qty}` joined by ", ". An ASTERISK, not the "×" the
 *             review screen displays. packOrder is already in /po's emitted
 *             order: the payload sorts packs with the same KG-last/ML-ascending
 *             comparator (route.ts:21-28) that po-page's sortPackEntries uses.
 *
 * SINGLE BILL, label null — renderOrderBody prints a "Bill n" header only for
 * two or more, so a single bill emits the blank line and the numbered items.
 */
export function buildV2Email(args: {
  dealer: ApiCustomer | null;
  shipTo: ApiCustomer | null;
  lines:  V2CartLine[];
  order:  V2Order;
  /** The logged-in SO — stamped as the body's last line. */
  sentBy: string;
}): { subject: string; body: string; valid: boolean } {
  const { dealer, shipTo, lines, order, sentBy } = args;
  const name = dealer?.name ?? "";
  const code = dealer?.code ?? "";

  const billTo = (name || code)
    ? (name && code ? `${name} (${code})` : (name || code))
    : null;

  const shipToText =
    dealer && shipTo && shipTo.code !== dealer.code
      ? `${shipTo.name} (${shipTo.code})`
      : null;

  const dispatchText =
    order.dispatch === "Call"     ? "Call to " + order.callTarget
    : order.dispatch !== "Normal" ? order.dispatch
    :                               null;

  const crossDepot = order.crossDepot.trim() || null;
  const remarkText =
    order.marker === "Cross Delivery" ? `Cross billing from ${crossDepot ?? ""}`.trim()
    : order.marker === "Truck"        ? "Truck order"
    : order.marker === "Bounce"       ? "Bounce order"
    : order.marker === "DTS"          ? "DTS order"
    :                                   null;

  const note = order.notes.trim() || null;

  const itemLines: OrderBodyLine[] = lines.map((line) => ({
    name: emailLineLabel(line.product, line.baseColour, line.subProduct),
    packString: line.packOrder
      .filter((label) => (line.qtys[label] ?? 0) > 0)
      .map((label) => `${label}*${line.qtys[label]}`)
      .join(", "),
  }));

  const bills: OrderBodyBill[] = itemLines.length > 0
    ? [{ label: null, lines: itemLines }]
    : [];

  const body = renderOrderBody({
    billTo, shipTo: shipToText, dispatch: dispatchText, remark: remarkText, note, bills,
  }) + `\n\nSent by ${sentBy}`;
  const subject = buildSubject(dealer, order.marker, crossDepot);

  return { subject, body, valid: !!dealer && itemLines.length > 0 };
}

/**
 * 🔴 NO CC, and addressed to SO_TEST_ORDER_TO — never ORDER_TO — until phase D.
 */
export function buildV2MailtoUrl(subject: string, body: string): string {
  return `mailto:${SO_TEST_ORDER_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
