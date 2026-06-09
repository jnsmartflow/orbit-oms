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

export function buildEmail(input: EmailInput): EmailOutput {
  const { customer, bills, shipTo, dispatch, callTarget, marker, crossDepot, notes } = input;
  const name = customer?.name ?? "";
  const code = customer?.code ?? "";
  const lines: string[] = [];

  if (name || code) {
    const customerLine = name && code ? `${name} (${code})` : (name || code);
    lines.push("Customer: " + customerLine);
  }
  // Unified /po line formats — this is now the shared builder (decision d).
  // Dispatch: Call → "Call to SO/Dealer"; Urgent → "Urgent"; Normal omits the
  // line, so a plain order stays byte-identical to before.
  if (dispatch === "Call") {
    lines.push("Dispatch: Call to " + (callTarget ?? "SO"));
  } else if (dispatch !== "Normal") {
    lines.push("Dispatch: " + dispatch);
  }
  // Order remark — humanized; Cross carries its source depot.
  if (marker) {
    const remarkText =
      marker === "Cross Delivery" ? `Cross billing from ${crossDepot ?? ""}`.trim()
      : marker === "Truck"        ? "Truck order"
      : marker === "Bounce"       ? "Bounce order"
      : marker === "DTS"          ? "DTS order"
      :                             "";
    if (remarkText) lines.push("Remark: " + remarkText);
  }
  // Ship To only for a real custom address — blank / "same as billing" omitted.
  const shipToTrim = shipTo.trim();
  if (shipToTrim && shipToTrim.toLowerCase() !== "same as billing") {
    lines.push("Ship To: " + shipToTrim);
  }
  // Free-text note.
  if (notes.trim()) lines.push("Note: " + notes.trim());

  // Strip empty bills, then iterate the remaining ones. Multi-bill header
  // ("Bill N") only emitted when more than one bill survives the filter —
  // mirrors mobile /order page line 568-570.
  const activeBills = bills.filter((b) => b.length > 0);
  activeBills.forEach((billLines, idx) => {
    lines.push("");
    if (activeBills.length > 1) lines.push("Bill " + (idx + 1));
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
      const productName = line.product ?? line.subProduct;
      const productText = line.baseColour
        ? `${productName} ${line.baseColour}`
        : productName;
      lines.push(`${productText} ${packStr}`);
    }
  });

  const subject = "Order"
    + (name ? ` — ${name}` : "")
    + (code ? ` ${code}`    : "");
  const valid = !!customer && activeBills.length > 0;

  return { subject, body: lines.join("\n"), valid };
}

export function buildMailtoUrl(subject: string, body: string): string {
  return `mailto:${ORDER_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
