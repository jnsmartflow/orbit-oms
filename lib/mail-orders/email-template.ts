import type { MoOrder } from "./types";
import { smartTitleCase } from "./utils";

/**
 * Build an HTML email summarising a slot's orders for a given SO.
 * Outlook-safe: nested tables only, no <div>, no <p>, no margin,
 * all styles on immediate <td> or <span>.
 */
export function buildSlotSummaryHTML(
  soName: string,
  orders: MoOrder[],
  slotName: string,
  date: string,
  senderName: string,
  senderPhone?: string,
): string {
  // ── Data partitions ──
  const processed = orders.filter((o) => o.soNumber);
  const pending = orders.filter((o) => !o.soNumber);

  const flaggedLines: {
    customerName: string;
    soNumber: string | null;
    productName: string;
    baseColour: string | null;
    packCode: string | null;
    reason: string;
  }[] = [];

  for (const o of orders) {
    const custName = smartTitleCase(o.customerName ?? o.subject);
    for (const line of o.lines) {
      if (line.lineStatus?.reason && line.lineStatus.found === false) {
        flaggedLines.push({
          customerName: custName,
          soNumber: o.soNumber ?? null,
          productName: smartTitleCase(line.productName) || "Unknown",
          baseColour: line.baseColour,
          packCode: line.packCode,
          reason: line.lineStatus.reason,
        });
      }
    }
  }

  // ── Helpers ──

  const F = "font-family:Arial,Helvetica,sans-serif;";
  const CM = "font-family:'Courier New',Courier,monospace;";

  function fmtDate(d: string): string {
    const parts = d.match(/(\d+)\s+(\w+)\s+(\d+)/);
    if (!parts) return d;
    const months: Record<string, number> = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    const mo = months[parts[2]];
    if (mo === undefined) return d;
    const dt = new Date(Number(parts[3]), mo, Number(parts[1]));
    return dt.toLocaleDateString("en-GB", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
  }

  function getFirstName(name: string): string {
    const clean = smartTitleCase(name.replace(/^\([^)]*\)\s*/, "").trim());
    return clean.split(/\s+/)[0] || clean;
  }

  function getPendingNote(order: MoOrder): { text: string; color: string } {
    const combined = [order.remarks, order.billRemarks, order.deliveryRemarks]
      .filter(Boolean).join(" ").toLowerCase();
    if (/truck|transport|lorry|vehicle/.test(combined)) {
      return { text: "Awaiting transport", color: "#d97706" };
    }
    return { text: "Will process tomorrow", color: "#9ca3af" };
  }

  function getReasonStyle(reason: string): { label: string; color: string } {
    switch (reason) {
      case "out_of_stock": return { label: "Out of Stock", color: "#dc2626" };
      case "wrong_pack": return { label: "Wrong Pack", color: "#d97706" };
      case "discontinued": return { label: "Discontinued", color: "#6b7280" };
      case "other_depot": return { label: "Other Depot", color: "#6b7280" };
      case "other": return { label: "Other", color: "#9ca3af" };
      default: return { label: reason, color: "#9ca3af" };
    }
  }

  function splitPartLabel(label: string | null | undefined): string {
    if (!label) return "";
    if (label === "A") return " (Part 1 of 2)";
    if (label === "B") return " (Part 2 of 2)";
    return ` (${label})`;
  }

  const firstName = getFirstName(soName);
  const longDate = fmtDate(date);
  const totalCount = orders.length;

  // Hairline divider — full-width row
  const divider = `<tr><td style="padding:0 32px;${F}"><table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="border-top:1px solid #f3f4f6;font-size:1px;line-height:1px;height:1px">&nbsp;</td></tr></table></td></tr>`;

  // ── Build HTML ──

  let h = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>';
  h += `<body style="margin:0;padding:0;background-color:#f4f4f4;${F}">`;
  h += `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f4f4"><tr><td align="center" style="padding:24px 12px">`;
  h += `<table cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;background-color:#ffffff;border:1px solid #e8e8e8;border-radius:4px;">`;

  // ═══ 1. ACCENT BAR ═══
  h += `<tr><td style="background-color:#0d9488;height:3px;font-size:1px;line-height:1px">&nbsp;</td></tr>`;

  // ═══ 2. HEADER ═══
  h += `<tr><td style="padding:26px 32px 22px;${F}">`;
  h += `<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>`;
  // Left
  h += `<td style="vertical-align:top;${F}">`;
  h += `<table cellpadding="0" cellspacing="0" border="0" width="100%">`;
  h += `<tr><td style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;padding:0;${F}">JSW Dulux \u2014 Surat Depot</td></tr>`;
  h += `<tr><td style="font-size:18px;font-weight:700;color:#111827;letter-spacing:-0.4px;padding:6px 0 0 0;${F}">${slotName} Slot Summary</td></tr>`;
  h += `<tr><td style="font-size:11px;color:#9ca3af;padding:4px 0 0 0;${F}">${longDate}</td></tr>`;
  h += `</table></td>`;
  // Right
  h += `<td style="vertical-align:top;text-align:right;width:70px;${F}">`;
  h += `<table cellpadding="0" cellspacing="0" border="0">`;
  h += `<tr><td style="font-size:26px;font-weight:700;color:#111827;text-align:right;padding:0;${F}">${totalCount}</td></tr>`;
  h += `<tr><td style="font-size:10px;color:#9ca3af;text-align:right;padding:0;${F}">orders</td></tr>`;
  h += `</table></td>`;
  h += `</tr></table></td></tr>`;

  // ═══ 3. DIVIDER ═══
  h += divider;

  // ═══ 4. SALUTATION ═══
  h += `<tr><td style="padding:22px 32px 18px;${F}">`;
  h += `<table cellpadding="0" cellspacing="0" border="0" width="100%">`;
  h += `<tr><td style="font-size:13px;color:#111827;padding:0 0 5px 0;${F}">Dear <span style="font-weight:700;color:#111827">${firstName}</span> Sir,</td></tr>`;
  h += `<tr><td style="font-size:12px;color:#6b7280;line-height:1.7;padding:0;${F}">Please find below the ${slotName} slot summary for today.</td></tr>`;
  h += `</table></td></tr>`;

  // ═══ 5. BILLED ORDERS ═══
  // Section label
  h += `<tr><td style="font-size:9px;font-weight:700;color:#0d9488;text-transform:uppercase;letter-spacing:0.12em;padding:20px 32px 14px 32px;${F}">Billed Orders \u2014 ${processed.length}</td></tr>`;

  if (processed.length === 0) {
    h += `<tr><td style="font-size:12px;color:#9ca3af;padding:0 32px 20px 32px;${F}">No billed orders in this slot.</td></tr>`;
  } else {
    h += `<tr><td style="padding:0 32px 20px 32px">`;
    h += `<table cellpadding="0" cellspacing="0" border="0" width="100%">`;
    processed.forEach((o, i) => {
      const isLast = i === processed.length - 1;
      const cust = smartTitleCase(o.customerName ?? o.subject);
      const isHold = o.dispatchStatus === "Hold";
      const custColor = isHold ? "#9ca3af" : "#111827";
      const custSuffix = isHold ? " *" : "";
      const splitSuffix = splitPartLabel(o.splitLabel);
      const bb = isLast ? "" : "border-bottom:1px solid #f3f4f6;";

      h += `<tr>`;
      // Left col — nested table for name + code
      h += `<td style="padding:11px 0 11px 0;vertical-align:top;${bb}">`;
      h += `<table cellpadding="0" cellspacing="0" border="0" width="100%">`;
      h += `<tr><td style="font-size:13px;font-weight:600;color:${custColor};padding:0 0 3px 0;${F}">${cust}${custSuffix}`;
      if (splitSuffix) h += `<span style="color:#9ca3af">${splitSuffix}</span>`;
      h += `</td></tr>`;
      h += `<tr><td style="font-size:11px;color:#9ca3af;padding:0;${F}">Code <span style="color:#0d9488;font-weight:700;${CM}font-size:11px">${o.customerCode ?? "\u2014"}</span></td></tr>`;
      h += `</table></td>`;
      // Right col — SO number
      h += `<td style="padding:11px 0 11px 20px;vertical-align:top;text-align:right;white-space:nowrap;${bb}">`;
      h += `<table cellpadding="0" cellspacing="0" border="0"><tr><td style="font-size:15px;font-weight:700;color:#111827;${CM}text-align:right;padding:0">${o.soNumber}</td></tr></table>`;
      h += `</td>`;
      h += `</tr>`;
    });
    h += `</table></td></tr>`;
  }

  // ═══ 6. DIVIDER ═══
  if (flaggedLines.length > 0) h += divider;

  // ═══ 7. COULD NOT SUPPLY ═══
  if (flaggedLines.length > 0) {
    // Section label
    h += `<tr><td style="font-size:9px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.12em;padding:20px 32px 14px 32px;${F}">Could Not Supply \u2014 ${flaggedLines.length}</td></tr>`;

    h += `<tr><td style="padding:0 32px 20px 32px">`;
    h += `<table cellpadding="0" cellspacing="0" border="0" width="100%">`;
    flaggedLines.forEach((fl, i) => {
      const isLast = i === flaggedLines.length - 1;
      const bb = isLast ? "" : "border-bottom:1px solid #f3f4f6;";
      const prodBase = fl.baseColour
        ? `${fl.productName} ${smartTitleCase(fl.baseColour)}`
        : fl.productName;
      const product = fl.packCode
        ? `${prodBase} \u00b7 ${fl.packCode}`
        : prodBase;
      const rs = getReasonStyle(fl.reason);

      h += `<tr>`;
      // Left — nested table for customer+ref and product
      h += `<td style="padding:11px 0 11px 0;vertical-align:middle;${bb}">`;
      h += `<table cellpadding="0" cellspacing="0" border="0" width="100%">`;
      // Customer + SO ref
      h += `<tr><td style="font-size:12px;font-weight:600;color:#111827;padding:0 0 2px 0;${F}">${fl.customerName}`;
      if (fl.soNumber) {
        h += `<span style="font-weight:400;font-size:11px;color:#9ca3af">&nbsp;\u00b7&nbsp;${fl.soNumber}</span>`;
      }
      h += `</td></tr>`;
      // Product
      h += `<tr><td style="font-size:11px;color:#9ca3af;padding:0;${F}">${product}</td></tr>`;
      h += `</table></td>`;
      // Right — status text
      h += `<td style="padding:11px 0 11px 16px;vertical-align:middle;text-align:right;white-space:nowrap;${bb}">`;
      h += `<span style="font-size:10px;font-weight:700;color:${rs.color};${F}">${rs.label}</span>`;
      h += `</td>`;
      h += `</tr>`;
    });
    h += `</table></td></tr>`;
  }

  // ═══ 8. DIVIDER ═══
  if (pending.length > 0) h += divider;

  // ═══ 9. PROCESSING TOMORROW ═══
  if (pending.length > 0) {
    // Section label
    h += `<tr><td style="font-size:9px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.12em;padding:20px 32px 14px 32px;${F}">Processing Tomorrow \u2014 ${pending.length}</td></tr>`;

    h += `<tr><td style="padding:0 32px 0 32px">`;
    h += `<table cellpadding="0" cellspacing="0" border="0" width="100%">`;
    pending.forEach((o, i) => {
      const isLast = i === pending.length - 1;
      const bb = isLast ? "" : "border-bottom:1px solid #f3f4f6;";
      const cust = smartTitleCase(o.customerName ?? o.subject);
      const note = getPendingNote(o);

      h += `<tr>`;
      // Left — nested table for customer + code
      h += `<td style="padding:11px 0 11px 0;vertical-align:middle;${bb}">`;
      h += `<table cellpadding="0" cellspacing="0" border="0" width="100%">`;
      h += `<tr><td style="font-size:12px;font-weight:600;color:#111827;padding:0;${F}">${cust}</td></tr>`;
      h += `<tr><td style="font-size:11px;color:#9ca3af;${CM}padding:1px 0 0 0">${o.customerCode ?? "\u2014"}</td></tr>`;
      h += `</table></td>`;
      // Right — note
      h += `<td style="padding:11px 0 11px 16px;vertical-align:middle;text-align:right;white-space:nowrap;${bb}">`;
      h += `<span style="font-size:10px;color:${note.color};${F}">${note.text}</span>`;
      h += `</td>`;
      h += `</tr>`;
    });
    h += `</table></td></tr>`;

    // Note text
    h += `<tr><td style="font-size:11px;color:#9ca3af;line-height:1.7;padding:14px 32px 20px 32px;${F}">We will process these orders in tomorrow\u2019s first slot. Kindly inform your dealers.</td></tr>`;
  }

  // ═══ 10. DIVIDER ═══
  h += divider;

  // ═══ 11. TOTAL ROW ═══
  h += `<tr><td style="padding:12px 32px;font-size:11px;color:#9ca3af;${F}">`;
  h += `<span style="font-size:11px;color:#9ca3af;${F}">${totalCount} order${totalCount !== 1 ? "s" : ""}</span>`;
  h += ` <span style="color:#e5e7eb">\u00b7</span> `;
  h += `<span style="font-size:11px;font-weight:600;color:#0d9488;${F}">${processed.length} billed</span>`;
  if (pending.length > 0) {
    h += ` <span style="color:#e5e7eb">\u00b7</span> `;
    h += `<span style="font-size:11px;color:#9ca3af;${F}">${pending.length} pending</span>`;
  }
  if (flaggedLines.length > 0) {
    h += ` <span style="color:#e5e7eb">\u00b7</span> `;
    h += `<span style="font-size:11px;font-weight:600;color:#dc2626;${F}">${flaggedLines.length} to note</span>`;
  }
  h += `</td></tr>`;

  // ═══ 12. DIVIDER ═══
  h += divider;

  // ═══ 13. CLOSING + REGARDS ═══
  h += `<tr><td style="padding:16px 32px 20px 32px;${F}">`;
  h += `<table cellpadding="0" cellspacing="0" border="0" width="100%">`;
  h += `<tr><td style="font-size:12px;color:#6b7280;line-height:2.1;padding:0;${F}">Please share the SO numbers with your dealers at the earliest.</td></tr>`;
  h += `<tr><td style="font-size:12px;color:#6b7280;padding:0;${F}">For any queries, call us directly.</td></tr>`;
  h += `<tr><td style="font-size:1px;line-height:1px;height:12px;padding:0">&nbsp;</td></tr>`;
  h += `<tr><td style="font-size:12px;color:#6b7280;padding:0;${F}">Regards,</td></tr>`;
  h += `<tr><td style="font-size:13px;font-weight:700;color:#111827;padding:4px 0 0 0;${F}">${senderName}</td></tr>`;
  h += `<tr><td style="font-size:11px;color:#9ca3af;padding:2px 0 0 0;${F}">JSW Dulux \u2014 Surat Depot</td></tr>`;
  if (senderPhone) {
    h += `<tr><td style="font-size:11px;font-weight:600;color:#0d9488;padding:2px 0 0 0;${F}">${senderPhone}</td></tr>`;
  }
  h += `</table></td></tr>`;

  // ═══ 14. FOOTER ═══
  h += `<tr><td style="background-color:#fafafa;border-top:1px solid #f3f4f6;padding:12px 32px;font-size:10px;color:#d1d5db;letter-spacing:0.02em;${F}">JSW Dulux Ltd \u2014 Surat Depot \u00b7 Do not reply to this email</td></tr>`;

  h += `</table>`; // close 560px table
  h += `</td></tr></table>`; // close centering
  h += `</body></html>`;
  return h;
}
