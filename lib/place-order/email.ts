// Mailto body + subject builder for /place-order.
//
// Output shape matches mobile /order page byte-for-byte so the upstream
// PowerShell parser (Parse-MailOrders-v6_5.ps1) accepts both. The parser
// was trained on the mobile body format.
//
// Cell qty on /place-order represents UNITS (2026-05-12 flip — supersedes
// the prior boxes-semantics decision in memory note
// `place_order_cell_vs_email_units.md`). Mobile already emits units. Both
// pages now store + emit units universally, so this builder is a no-op
// pass-through: `packQtys` values land in the body verbatim. The +/- keys
// in the variant cell are what move qty in box-step multiples.
//
//   Cell column          Cell qty     Email emits
//   ─────────────────────────────────────────────────
//   1L  (box of 6)       36           1L*36
//   4L  (box of 4)       16           4L*16
//   20L (box of 1)       1            20L*1
//   200ML (box of 12)    144          200ML*144

import { formatPack, parsePackKey, sortPacks } from "./pack";

export type EmailCustomer = { name: string; code: string };

export type EmailLine = {
  subProduct:  string;
  // Real product name (Phase 3 taxonomy cutover, 2026-05-13). Null
  // for unmigrated families; rendered text falls back to subProduct
  // via `?? subProduct`. Outgoing format only — does not feed the
  // upstream parser (parser reads inbound dealer mail, not these
  // outgoing depot emails).
  product?:    string | null;
  baseColour:  string | null;
  packQtys:    Record<string, number>;   // pack-code (raw, e.g. "1") → qty in UNITS
};

export type EmailDispatch   = "Normal" | "Urgent" | "Call";
export type EmailCallTarget = "SO" | "Dealer" | null;
export type EmailMarker     = "Truck" | "Cross Delivery" | "Bounce" | "DTS" | null;

export type EmailInput = {
  customer:   EmailCustomer | null;
  bills:      EmailLine[][];             // one inner array per bill
  shipTo:     string;
  dispatch:   EmailDispatch;
  callTarget: EmailCallTarget;
  marker:     EmailMarker;
  crossDepot: string | null;
  notes:      string;
};

export type EmailOutput = {
  subject: string;
  body:    string;
  valid:   boolean;
};

export const ORDER_TO = "surat.depot@akzonobel.com";
// Desktop /place-order CCs the parser inbox so app orders land there too.
// Wired into buildMailtoUrl() ONLY (the desktop send path) — /po and /order
// build their own mailto inline and intentionally do NOT carry this CC.
export const ORDER_CC = "surat.order@outlook.com";

/** One product line in the rendered order body: full name + pack list. */
export type OrderBodyLine = { name: string; packString: string };
/** One bill section: "Bill N" header (null = single-bill, header omitted). */
export type OrderBodyBill = { label: string | null; lines: OrderBodyLine[] };
/** Normalized input for the shared plain-text order-body renderer. */
export type OrderBodyInput = {
  billTo:   string | null;
  shipTo:   string | null;
  dispatch: string | null;
  remark:   string | null;
  note:     string | null;
  bills:    OrderBodyBill[];
};

/**
 * SINGLE SOURCE for the order-email BODY (plain text — mailto, no HTML/bold).
 * All three surfaces (desktop /place-order, mobile /po, mobile /order) call
 * this so the body never diverges. Header lines render only when they carry a
 * value, in the locked sequence: Bill To → Ship To → Dispatch → Remark → Note.
 * Each bill is preceded by a blank line and (multi-bill only) its "Bill N"
 * header; line items are 1-based and RESTART per bill, joined to their pack
 * list by " - " (space-hyphen-space). Pack list ("*", comma-separated) is
 * passed in pre-formatted and emitted verbatim.
 */
// Three-letter tokens that must stay fully uppercase (acronyms / codes that
// would read wrong title-cased — "GVA" not "Gva", "YOX" not "Yox").
const KEEP_CAPS_3 = new Set([
  "GVA", "FBC", "IBC", "WBC", "FFR", "GRN", "LFY",
  "MAG", "OXR", "TBL", "YOX", "NCR", "VAF", "WRP",
]);

/**
 * Proper-case a product NAME for the email body while preserving codes. Splits
 * on runs of non-alphanumeric chars (space, -, /, parens, dot) KEEPING the
 * separators, then per alphanumeric token: keep UPPERCASE when it has a digit
 * (5IN1, M900, 10MM, 2K), or has ≤2 letters (WS, VT, PU), or its uppercase form
 * is in KEEP_CAPS_3; otherwise title-case it. Separators are re-joined verbatim.
 */
export function emailCase(name: string): string {
  // Split keeping separators: alphanumeric runs vs non-alphanumeric runs.
  const tokens = name.split(/([^A-Za-z0-9]+)/);
  return tokens
    .map((tok) => {
      if (!/[A-Za-z0-9]/.test(tok)) return tok;   // separator — keep verbatim
      const letters = (tok.match(/[A-Za-z]/g) ?? []).length;
      if (/[0-9]/.test(tok)) return tok.toUpperCase();
      if (letters <= 2)      return tok.toUpperCase();
      if (KEEP_CAPS_3.has(tok.toUpperCase())) return tok.toUpperCase();
      return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
    })
    .join("");
}

export function renderOrderBody(input: OrderBodyInput): string {
  const out: string[] = [];
  if (input.billTo)   out.push("Bill To: "  + input.billTo);
  if (input.shipTo)   out.push("Ship To: "  + input.shipTo);
  if (input.dispatch) out.push("Dispatch: " + input.dispatch);
  if (input.remark)   out.push("Remark: "   + input.remark);
  if (input.note)     out.push("Note: "     + input.note);

  for (const bill of input.bills) {
    out.push("");
    if (bill.label) out.push(bill.label);
    // Right-align serial numbers within this bill so names line up past 9 items
    // (e.g. " 9." / "10."). padWidth is per-bill, from its own line count.
    const padWidth = String(bill.lines.length).length;
    bill.lines.forEach((line, i) => {
      // Proper-case ONLY the product name — pack string untouched.
      out.push(`${String(i + 1).padStart(padWidth, "\u2007")}. ${emailCase(line.name)} - ${line.packString}`);
    });
  }

  return out.join("\n");
}

/**
 * Full product-name + base label for one email/order line. Shared by the
 * desktop (this file) and mobile (/order page) builders so both stay
 * byte-identical. Scoped special case: PROMISE PRIMER's stored product name
 * overlaps its base ("PROMISE PRIMER" + "Promise Primer" → doubling), so we
 * print the clean variant name only — reproducing the menu displayName
 * ("Promise Primer" / "Promise 2in1 Primer" / "Promise Freedom 2in1 Primer").
 * Every other product is the unchanged `${product ?? subProduct} ${base}`.
 */
export function emailLineLabel(
  product: string | null,
  baseColour: string | null,
  subProduct: string,
): string {
  if (product === "PROMISE PRIMER" && baseColour) {
    return baseColour.startsWith("Promise") ? baseColour : `Promise ${baseColour}`;
  }
  const name = product ?? subProduct;
  // General de-double (2026-06-14): when baseColour already contains the full
  // product name (a Path-A repurpose — e.g. Duwel: product/subProduct
  // "ACRYLIC DISTEMPER" with base "DUWEL ACRYLIC DISTEMPER"), printing
  // `name baseColour` doubles. The base already carries the descriptive name,
  // so print it alone → "DUWEL ACRYLIC DISTEMPER".
  if (baseColour && name && baseColour.toUpperCase().includes(name.toUpperCase())) {
    return baseColour;
  }
  return baseColour ? `${name} ${baseColour}` : name;
}

export function buildEmail(input: EmailInput): EmailOutput {
  const { customer, bills, shipTo, dispatch, callTarget, marker, crossDepot, notes } = input;
  const name = customer?.name ?? "";
  const code = customer?.code ?? "";

  const billTo = (name || code)
    ? (name && code ? `${name} (${code})` : (name || code))
    : null;

  // Dispatch: Call → "Call to SO/Dealer"; Urgent → "Urgent"; Normal omits.
  const dispatchText =
    dispatch === "Call"     ? "Call to " + (callTarget ?? "SO")
    : dispatch !== "Normal" ? dispatch
    :                         null;

  // Order remark — humanized; Cross carries its source depot.
  const remarkText =
    marker === "Cross Delivery" ? `Cross billing from ${crossDepot ?? ""}`.trim()
    : marker === "Truck"        ? "Truck order"
    : marker === "Bounce"       ? "Bounce order"
    : marker === "DTS"          ? "DTS order"
    :                             null;

  // Ship To only for a real custom address — blank / "same as billing" omitted.
  const shipToTrim = shipTo.trim();
  const shipToText =
    shipToTrim && shipToTrim.toLowerCase() !== "same as billing" ? shipToTrim : null;

  const note = notes.trim() || null;

  // Strip empty bills; "Bill N" header only when >1 active bill survives.
  const activeBills = bills.filter((b) => b.length > 0);
  const bodyBills: OrderBodyBill[] = activeBills.map((billLines, idx) => {
    const itemLines: OrderBodyLine[] = [];
    for (const line of billLines) {
      const sortedKeys = sortPacks(
        Object.keys(line.packQtys).filter((k) => (line.packQtys[k] ?? 0) > 0),
      );
      if (sortedKeys.length === 0) continue;     // line had only zero qtys
      const packStr = sortedKeys.map((k) => {
        // Phase 3.5 (2026-05-13): packQtys keys are composite
        // "<packCode>|<unit>" so KG packs render with their real
        // unit ("5KG*4"). parsePackKey also handles legacy bare
        // keys for pre-Phase-3.5 drafts — unit is null in that case
        // and formatPack falls back to magnitude inference.
        const { packCode, unit } = parsePackKey(k);
        const label = formatPack(packCode, unit);
        const units = line.packQtys[k] ?? 0;
        return `${label}*${units}`;
      }).join(", ");
      const productText = emailLineLabel(line.product ?? null, line.baseColour, line.subProduct);
      itemLines.push({ name: productText, packString: packStr });
    }
    return { label: activeBills.length > 1 ? "Bill " + (idx + 1) : null, lines: itemLines };
  });

  const body = renderOrderBody({
    billTo,
    shipTo:   shipToText,
    dispatch: dispatchText,
    remark:   remarkText,
    note,
    bills:    bodyBills,
  });

  const subject = "Order"
    + (name ? ` — ${name}` : "")
    + (code ? ` ${code}`    : "");
  const valid = !!customer && activeBills.length > 0;

  return { subject, body, valid };
}

export function buildMailtoUrl(subject: string, body: string): string {
  // Desktop send path only — carries the CC to the parser inbox.
  return `mailto:${ORDER_TO}`
    + `?cc=${encodeURIComponent(ORDER_CC)}`
    + `&subject=${encodeURIComponent(subject)}`
    + `&body=${encodeURIComponent(body)}`;
}
