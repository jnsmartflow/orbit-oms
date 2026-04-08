import type { MoOrder } from "./types";
import { smartTitleCase } from "./utils";

/**
 * Build an HTML email summarising a slot's orders for a given SO.
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
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function getFirstName(name: string): string {
    const clean = smartTitleCase(name.replace(/^\([^)]*\)\s*/, "").trim());
    return clean.split(/\s+/)[0] || clean;
  }

  function getPendingNote(order: MoOrder): { text: string; color: string } {
    const combined = [
      order.remarks,
      order.billRemarks,
      order.deliveryRemarks,
    ].filter(Boolean).join(" ").toLowerCase();
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

  // Hairline divider helper
  const divider = '<tr><td style="padding:0 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #f3f4f6;font-size:0;line-height:0;height:1px">&nbsp;</td></tr></table></td></tr>';

  // ── Build HTML ──

  let h = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>';
  h += '<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif">';
  h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4"><tr><td align="center" style="padding:24px 12px">';
  h += '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e8e8e8;border-radius:4px;overflow:hidden">';

  // ═══ 1. TOP ACCENT BAR ═══
  h += '<tr><td style="background:#0d9488;height:3px;font-size:0;line-height:0">&nbsp;</td></tr>';

  // ═══ 2. HEADER ═══
  h += '<tr><td style="padding:26px 32px 22px">';
  h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
  // Left
  h += '<td style="vertical-align:top">';
  h += '<p style="margin:0;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em">JSW Dulux \u2014 Surat Depot</p>';
  h += `<p style="margin:6px 0 0;font-size:18px;font-weight:700;color:#111827;letter-spacing:-0.4px">${slotName} Slot Summary</p>`;
  h += `<p style="margin:4px 0 0;font-size:11px;color:#9ca3af">${longDate}</p>`;
  h += '</td>';
  // Right
  h += '<td style="vertical-align:top;text-align:right;width:70px">';
  h += `<p style="margin:0;font-size:26px;font-weight:700;color:#111827">${totalCount}</p>`;
  h += '<p style="margin:0;font-size:10px;color:#9ca3af">orders</p>';
  h += '</td>';
  h += '</tr></table>';
  h += '</td></tr>';

  // ═══ 3. DIVIDER ═══
  h += divider;

  // ═══ 4. SALUTATION ═══
  h += '<tr><td style="padding:22px 32px 18px">';
  h += `<p style="margin:0;font-size:13px;color:#111827">Dear <strong style="font-weight:700">${firstName}</strong> Sir,</p>`;
  h += `<p style="margin:5px 0 0;font-size:12px;color:#6b7280;line-height:1.7">Please find below the ${slotName} slot summary for today.</p>`;
  h += '</td></tr>';

  // ═══ 5. BILLED ORDERS ═══
  h += '<tr><td style="padding:0 32px 20px">';
  h += `<p style="margin:0 0 14px;font-size:9px;font-weight:700;color:#0d9488;text-transform:uppercase;letter-spacing:0.12em">Billed Orders \u2014 ${processed.length}</p>`;

  if (processed.length === 0) {
    h += '<p style="margin:0;font-size:12px;color:#9ca3af">No billed orders in this slot.</p>';
  } else {
    h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';
    processed.forEach((o, i) => {
      const isLast = i === processed.length - 1;
      const cust = smartTitleCase(o.customerName ?? o.subject);
      const isHold = o.dispatchStatus === "Hold";
      const custColor = isHold ? "#9ca3af" : "#111827";
      const custSuffix = isHold ? " *" : "";
      const splitSuffix = splitPartLabel(o.splitLabel);
      const bb = isLast ? "" : "border-bottom:1px solid #f3f4f6;";

      h += '<tr>';
      // Left col
      h += `<td style="padding:11px 0;vertical-align:top;${bb}">`;
      h += `<p style="margin:0 0 3px;font-size:13px;font-weight:600;color:${custColor}">${cust}${custSuffix}`;
      if (splitSuffix) h += `<span style="color:#9ca3af">${splitSuffix}</span>`;
      h += '</p>';
      h += `<p style="margin:0;font-size:11px;color:#9ca3af">Code <span style="color:#0d9488;font-weight:700;font-family:\'Courier New\',Courier,monospace;font-size:11px">${o.customerCode ?? "\u2014"}</span></p>`;
      h += '</td>';
      // Right col
      h += `<td style="padding:11px 0;vertical-align:top;text-align:right;white-space:nowrap;padding-left:20px;${bb}">`;
      h += `<p style="margin:0;font-size:15px;font-weight:700;color:#111827;font-family:\'Courier New\',Courier,monospace">${o.soNumber}</p>`;
      h += '</td>';
      h += '</tr>';
    });
    h += '</table>';
  }
  h += '</td></tr>';

  // ═══ 6. DIVIDER ═══
  if (flaggedLines.length > 0) h += divider;

  // ═══ 7. COULD NOT SUPPLY ═══
  if (flaggedLines.length > 0) {
    h += '<tr><td style="padding:0 32px 20px">';
    h += `<p style="margin:0 0 14px;font-size:9px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.12em">Could Not Supply \u2014 ${flaggedLines.length}</p>`;

    h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';
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

      h += '<tr>';
      // Left
      h += `<td style="padding:11px 0;vertical-align:middle;${bb}">`;
      const custLine = fl.soNumber
        ? `${fl.customerName} <span style="font-weight:400;font-size:11px;color:#9ca3af">\u00b7 ${fl.soNumber}</span>`
        : fl.customerName;
      h += `<p style="margin:0 0 2px;font-size:12px;font-weight:600;color:#111827">${custLine}</p>`;
      h += `<p style="margin:0;font-size:11px;color:#9ca3af">${product}</p>`;
      h += '</td>';
      // Right
      h += `<td style="padding:11px 0;vertical-align:middle;text-align:right;white-space:nowrap;padding-left:16px;${bb}">`;
      h += `<span style="font-size:10px;font-weight:700;color:${rs.color}">${rs.label}</span>`;
      h += '</td>';
      h += '</tr>';
    });
    h += '</table>';
    h += '</td></tr>';
  }

  // ═══ 8. DIVIDER ═══
  if (pending.length > 0) h += divider;

  // ═══ 9. PROCESSING TOMORROW ═══
  if (pending.length > 0) {
    h += '<tr><td style="padding:0 32px 20px">';
    h += `<p style="margin:0 0 14px;font-size:9px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.12em">Processing Tomorrow \u2014 ${pending.length}</p>`;

    h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';
    pending.forEach((o, i) => {
      const isLast = i === pending.length - 1;
      const bb = isLast ? "" : "border-bottom:1px solid #f3f4f6;";
      const cust = smartTitleCase(o.customerName ?? o.subject);
      const note = getPendingNote(o);

      h += '<tr>';
      // Left
      h += `<td style="padding:11px 0;vertical-align:middle;${bb}">`;
      h += `<p style="margin:0;font-size:12px;font-weight:600;color:#111827">${cust}</p>`;
      h += `<p style="margin:1px 0 0;font-size:11px;color:#9ca3af;font-family:\'Courier New\',Courier,monospace">${o.customerCode ?? "\u2014"}</p>`;
      h += '</td>';
      // Right
      h += `<td style="padding:11px 0;vertical-align:middle;text-align:right;white-space:nowrap;padding-left:16px;${bb}">`;
      h += `<span style="font-size:10px;color:${note.color}">${note.text}</span>`;
      h += '</td>';
      h += '</tr>';
    });
    h += '</table>';

    h += `<p style="margin:14px 0 0;font-size:11px;color:#9ca3af;line-height:1.7">We will process these orders in tomorrow\u2019s first slot. Kindly inform your dealers.</p>`;
    h += '</td></tr>';
  }

  // ═══ 10. DIVIDER ═══
  h += divider;

  // ═══ 11. TOTAL ROW ═══
  h += '<tr><td style="padding:12px 32px">';
  const parts: string[] = [];
  parts.push(`<span style="font-size:11px;color:#9ca3af">${totalCount} order${totalCount !== 1 ? "s" : ""}</span>`);
  parts.push(`<span style="color:#e5e7eb">\u00b7</span>`);
  parts.push(`<span style="font-size:11px;font-weight:600;color:#0d9488">${processed.length} billed</span>`);
  if (pending.length > 0) {
    parts.push(`<span style="color:#e5e7eb">\u00b7</span>`);
    parts.push(`<span style="font-size:11px;color:#9ca3af">${pending.length} pending</span>`);
  }
  if (flaggedLines.length > 0) {
    parts.push(`<span style="color:#e5e7eb">\u00b7</span>`);
    parts.push(`<span style="font-size:11px;font-weight:600;color:#dc2626">${flaggedLines.length} to note</span>`);
  }
  h += `<p style="margin:0">${parts.join(" ")}</p>`;
  h += '</td></tr>';

  // ═══ 12. DIVIDER ═══
  h += divider;

  // ═══ 13. CLOSING + REGARDS ═══
  h += '<tr><td style="padding:16px 32px 20px">';
  h += '<p style="margin:0;font-size:12px;color:#6b7280;line-height:2.1">Please share the SO numbers with your dealers at the earliest.</p>';
  h += '<p style="margin:0;font-size:12px;color:#6b7280">For any queries, call us directly.</p>';
  h += '<br>';
  h += '<p style="margin:0;font-size:12px;color:#6b7280">Regards,</p>';
  h += `<p style="margin:4px 0 0;font-size:13px;font-weight:700;color:#111827">${senderName}</p>`;
  h += '<p style="margin:2px 0 0;font-size:11px;color:#9ca3af">JSW Dulux \u2014 Surat Depot</p>';
  if (senderPhone) {
    h += `<p style="margin:2px 0 0;font-size:11px;font-weight:600;color:#0d9488">${senderPhone}</p>`;
  }
  h += '</td></tr>';

  // ═══ 14. FOOTER ═══
  h += '<tr><td style="background:#fafafa;border-top:1px solid #f3f4f6;padding:12px 32px">';
  h += '<p style="margin:0;font-size:10px;color:#d1d5db;letter-spacing:0.02em">JSW Dulux Ltd \u2014 Surat Depot \u00b7 Do not reply to this email</p>';
  h += '</td></tr>';

  h += '</table>'; // close main 560px table
  h += '</td></tr></table>'; // close centering wrapper
  h += '</body></html>';
  return h;
}
