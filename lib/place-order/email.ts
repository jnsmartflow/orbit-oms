// Mailto body + subject builder for /place-order.
//
// Output shape matches mobile /order page byte-for-byte so the upstream
// PowerShell parser (Parse-MailOrders-v6_5.ps1) accepts both. The parser
// was trained on the mobile body format.
//
// Cell qty on /place-order represents BOXES (per locked decision in the
// project memory note `place_order_cell_vs_email_units.md`). The mobile
// page's qty already represents UNITS. Both pages must emit the email body
// in UNITS, so this builder multiplies cell qty × packStep(label) at
// emission time. Mobile is unchanged.
//
//   Cell column          Cell qty     Email emits
//   ─────────────────────────────────────────────────
//   1L  (box of 6)       6            1L*36
//   4L  (box of 4)       4            4L*16
//   20L (box of 1)       1            20L*1
//   200ML (box of 12)    12           200ML*144

import { formatPack, packStep, sortPacks } from "./pack";

export type EmailCustomer = { name: string; code: string };

export type EmailLine = {
  subProduct:  string;
  baseColour:  string | null;
  packQtys:    Record<string, number>;   // pack-code (raw, e.g. "1") → qty in BOXES
};

export type EmailDispatch = "Normal" | "Hold" | "Urgent";
export type EmailMarker   = "Truck" | "Cross Delivery" | "DTS" | null;

export type EmailInput = {
  customer: EmailCustomer | null;
  bills:    EmailLine[][];               // one inner array per bill (multi-bill is Phase 7)
  shipTo:   string;
  dispatch: EmailDispatch;
  marker:   EmailMarker;
};

export type EmailOutput = {
  subject: string;
  body:    string;
  valid:   boolean;
};

export const ORDER_TO = "surat.order@outlook.com";

export function buildEmail(input: EmailInput): EmailOutput {
  const { customer, bills, shipTo, dispatch, marker } = input;
  const name = customer?.name ?? "";
  const code = customer?.code ?? "";
  const lines: string[] = [];

  if (name || code) {
    const customerLine = name && code ? `${name} (${code})` : (name || code);
    lines.push("Customer: " + customerLine);
  }
  if (dispatch !== "Normal") lines.push("Dispatch: " + dispatch);
  if (marker)                lines.push("Marker: "   + marker);
  if (shipTo.trim())         lines.push("Ship To: "  + shipTo.trim());

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
        const label = formatPack(k);
        const boxes = line.packQtys[k] ?? 0;
        const units = boxes * packStep(label);   // BOXES → UNITS
        return `${label}*${units}`;
      }).join(", ");
      const productText = line.baseColour
        ? `${line.subProduct} ${line.baseColour}`
        : line.subProduct;
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
