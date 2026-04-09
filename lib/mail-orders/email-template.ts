import type { MoOrder } from "./types";
import { cleanSubject, smartTitleCase } from "./utils";

/**
 * Build an HTML email summarising a slot's orders for a given SO.
 * Outlook/OWA-safe: nested tables only, zero <div>, zero <p>,
 * zero margin, background-color on <td> only, plain text in
 * innermost <td> with font-family on every text cell.
 */
export function buildSlotSummaryHTML(
  soName: string,
  orders: MoOrder[],
  slotName: string,
  date: string,
  senderName: string,
  senderPhone?: string,
): string {
  // ── Data ──
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
    const custName = smartTitleCase(o.customerName ?? cleanSubject(o.subject));
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

  // ── Constants ──
  const F = "font-family:Arial,Helvetica,sans-serif;";
  const CM = "font-family:'Courier New',Courier,monospace;";

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
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
  }

  function getFirstName(name: string): string {
    const clean = smartTitleCase(name.replace(/^\([^)]*\)\s*/, "").trim());
    return clean.split(/\s+/)[0] || clean;
  }

  function getPendingNote(order: MoOrder): { text: string; bg: string } {
    const combined = [order.remarks, order.billRemarks, order.deliveryRemarks]
      .filter(Boolean).join(" ").toLowerCase();
    if (/truck|transport|lorry|vehicle/.test(combined)) {
      return { text: "Awaiting transport", bg: "#fef3c7" };
    }
    return { text: "Will process tomorrow", bg: "#f1f5f9" };
  }

  function getReasonLabel(reason: string): { text: string; bg: string } {
    switch (reason) {
      case "out_of_stock": return { text: "Out of stock", bg: "#fee2e2" };
      case "wrong_pack": return { text: "Wrong pack", bg: "#fef3c7" };
      case "discontinued": return { text: "Discontinued", bg: "#f1f5f9" };
      case "other_depot": return { text: "Other depot", bg: "#f1f5f9" };
      case "other": return { text: "Other", bg: "#f8fafc" };
      default: return { text: reason, bg: "#f8fafc" };
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

  // Group flaggedLines by soNumber for Not Available
  const flaggedGroups: { customerName: string; soNumber: string | null; items: typeof flaggedLines }[] = [];
  const flaggedMap = new Map<string, typeof flaggedLines>();
  for (const fl of flaggedLines) {
    const key = fl.soNumber ?? "__pending__";
    if (!flaggedMap.has(key)) flaggedMap.set(key, []);
    flaggedMap.get(key)!.push(fl);
  }
  for (const [, items] of Array.from(flaggedMap.entries())) {
    flaggedGroups.push({
      customerName: items[0].customerName,
      soNumber: items[0].soNumber,
      items,
    });
  }

  // ── Build HTML ──

  let h = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>';
  h += `<body style="padding:0;background-color:#f1f5f9;${F}">`;

  // Outer wrapper
  h += `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:32px 16px;"><tr><td align="center">`;
  h += `<table width="560" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border:1px solid #e2e8f0;">`;

  // ═══ TOP TEAL BAR ═══
  h += `<tr><td colspan="2" style="background-color:#0d9488;height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>`;

  // ═══ HEADER — two column ═══
  h += `<tr>`;
  // Left column
  h += `<td style="vertical-align:top;">`;
  h += `<table cellpadding="0" cellspacing="0" border="0">`;
  h += `<tr><td style="font-size:10px;color:#94a3b8;letter-spacing:0.08em;text-transform:uppercase;padding:24px 0 6px 32px;${F}">JSW Dulux \u2014 Surat Depot</td></tr>`;
  h += `<tr><td style="font-size:17px;font-weight:700;color:#0f172a;padding:0 0 4px 32px;${F}">${slotName} Slot Summary</td></tr>`;
  h += `<tr><td style="font-size:11px;color:#94a3b8;padding:0 0 20px 32px;${F}">${longDate}</td></tr>`;
  h += `</table></td>`;
  // Right column
  h += `<td style="vertical-align:top;">`;
  h += `<table cellpadding="0" cellspacing="0" border="0" align="right">`;
  h += `<tr><td style="font-size:10px;color:#94a3b8;text-align:right;padding:24px 32px 3px 16px;${F}">Orders</td></tr>`;
  h += `<tr><td style="font-size:24px;font-weight:700;color:#0f172a;text-align:right;line-height:1;padding:0 32px 20px 16px;${F}">${totalCount}</td></tr>`;
  h += `</table></td>`;
  h += `</tr>`;
  // Header border
  h += `<tr><td colspan="2" style="height:1px;background-color:#e2e8f0;font-size:0;line-height:0;">&nbsp;</td></tr>`;

  // ═══ SALUTATION ═══
  h += `<tr><td colspan="2" style="font-size:13px;color:#334155;padding:18px 32px 4px;${F}">Dear <span style="color:#0f172a;">${firstName}</span> Sir,</td></tr>`;
  h += `<tr><td colspan="2" style="font-size:12px;color:#64748b;padding:0 32px 16px;${F}">Please find below the ${slotName} slot summary for today.</td></tr>`;
  // Salutation border
  h += `<tr><td colspan="2" style="height:1px;background-color:#e2e8f0;font-size:0;line-height:0;">&nbsp;</td></tr>`;

  // ═══ PROCESSED ═══
  // Label row
  h += `<tr><td colspan="2" style="background-color:#d1fae5;border-bottom:2px solid #0d9488;padding:9px 32px;">`;
  h += `<table cellpadding="0" cellspacing="0" border="0"><tr>`;
  h += `<td style="font-size:10px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.08em;${F}">Processed</td>`;
  h += `<td style="font-size:10px;color:#64748b;padding-left:4px;${F}">\u2014 ${processed.length}</td>`;
  h += `</tr></table></td></tr>`;

  if (processed.length === 0) {
    h += `<tr><td colspan="2" style="font-size:11px;color:#94a3b8;padding:12px 32px 16px;${F}">No orders processed in this slot.</td></tr>`;
  } else {
    processed.forEach((o, i) => {
      const isLast = i === processed.length - 1;
      const cust = smartTitleCase(o.customerName ?? cleanSubject(o.subject));
      const isHold = o.dispatchStatus === "Hold";
      const custColor = isHold ? "#cbd5e1" : "#0f172a";
      const codeColor = isHold ? "#e2e8f0" : "#94a3b8";
      const custSuffix = isHold ? " *" : "";
      const splitSuffix = splitPartLabel(o.splitLabel);

      // Row 1 — customer name + SO number
      h += `<tr>`;
      h += `<td style="font-size:13px;color:${custColor};padding:11px 0 3px 32px;${F}">${cust}${custSuffix}${splitSuffix}</td>`;
      h += `<td style="font-size:13px;color:#0f172a;text-align:right;vertical-align:top;white-space:nowrap;padding:11px 32px 3px 16px;${CM}">${o.soNumber}</td>`;
      h += `</tr>`;

      // Row 2 — customer code
      if (o.customerCode) {
        h += `<tr><td colspan="2" style="font-size:11px;color:${codeColor};padding:0 32px 11px;${CM}">${o.customerCode}</td></tr>`;
      }

      // Row 3 — divider between orders
      if (!isLast) {
        h += `<tr><td colspan="2" style="height:1px;background-color:#f1f5f9;font-size:0;line-height:0;">&nbsp;</td></tr>`;
      }
    });

    // Spacing after all billed rows
    h += `<tr><td colspan="2" style="height:5px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
  }

  // ═══ NOT AVAILABLE ═══
  if (flaggedLines.length > 0) {
    // Separator before label
    h += `<tr><td colspan="2" style="height:1px;background-color:#e2e8f0;font-size:0;line-height:0;">&nbsp;</td></tr>`;

    // Label row
    h += `<tr><td colspan="2" style="background-color:#fef3c7;border-bottom:2px solid #d97706;padding:9px 32px;">`;
    h += `<table cellpadding="0" cellspacing="0" border="0"><tr>`;
    h += `<td style="font-size:10px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.08em;${F}">Not Available</td>`;
    h += `<td style="font-size:10px;color:#64748b;padding-left:4px;${F}">\u2014 ${flaggedLines.length} items</td>`;
    h += `</tr></table></td></tr>`;

    flaggedGroups.forEach((group, gi) => {
      const isLastGroup = gi === flaggedGroups.length - 1;

      // Row 1 — customer name
      h += `<tr><td colspan="2" style="font-size:13px;color:#0f172a;padding:10px 32px 2px;${F}">${group.customerName}</td></tr>`;

      // Row 2 — SO number reference
      if (group.soNumber) {
        h += `<tr><td colspan="2" style="font-size:11px;color:#94a3b8;padding:0 32px 4px;${CM}">${group.soNumber}</td></tr>`;
      }

      // Item rows — product + status
      group.items.forEach((fl) => {
        const prodBase = fl.baseColour
          ? `${fl.productName} ${smartTitleCase(fl.baseColour)}`
          : fl.productName;
        const product = fl.packCode
          ? `${prodBase} \u00b7 ${fl.packCode}`
          : prodBase;
        const rs = getReasonLabel(fl.reason);

        h += `<tr>`;
        h += `<td style="font-size:11px;color:#64748b;padding:2px 0 2px 32px;${F}">${product}</td>`;
        h += `<td style="font-size:11px;color:#0f172a;background-color:${rs.bg};text-align:right;white-space:nowrap;padding:2px 32px 2px 16px;${F}">${rs.text}</td>`;
        h += `</tr>`;
      });

      // Divider between groups
      if (!isLastGroup) {
        h += `<tr><td colspan="2" style="height:1px;background-color:#f1f5f9;font-size:0;line-height:0;">&nbsp;</td></tr>`;
      }
    });

    // Spacing after last group
    h += `<tr><td colspan="2" style="height:10px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
  }

  // ═══ PENDING ═══
  if (pending.length > 0) {
    // Label row — dark background
    h += `<tr><td colspan="2" style="background-color:#e2e8f0;border-bottom:2px solid #475569;padding:9px 32px;">`;
    h += `<table cellpadding="0" cellspacing="0" border="0"><tr>`;
    h += `<td style="font-size:10px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.08em;${F}">Pending</td>`;
    h += `<td style="font-size:10px;color:#374151;padding-left:4px;${F}">\u2014 ${pending.length}</td>`;
    h += `</tr></table></td></tr>`;

    pending.forEach((o, i) => {
      const isLast = i === pending.length - 1;
      const cust = smartTitleCase(o.customerName ?? cleanSubject(o.subject));
      const note = getPendingNote(o);

      // Row 1 — customer name + note
      h += `<tr>`;
      h += `<td style="font-size:13px;color:#0f172a;padding:11px 0 3px 32px;${F}">${cust}</td>`;
      h += `<td style="font-size:11px;color:#0f172a;background-color:${note.bg};text-align:right;vertical-align:top;white-space:nowrap;padding:12px 32px 3px 16px;${F}">${note.text}</td>`;
      h += `</tr>`;

      // Row 2 — customer code
      if (o.customerCode) {
        h += `<tr><td colspan="2" style="font-size:11px;color:#94a3b8;padding:0 32px 11px;${CM}">${o.customerCode}</td></tr>`;
      }

      // Divider between orders
      if (!isLast) {
        h += `<tr><td colspan="2" style="height:1px;background-color:#f1f5f9;font-size:0;line-height:0;">&nbsp;</td></tr>`;
      }
    });

    // Pending note
    h += `<tr><td colspan="2" style="font-size:11px;color:#94a3b8;padding:4px 32px 18px;line-height:1.6;${F}">We will process these orders in tomorrow\u2019s first slot. Kindly inform your dealers.</td></tr>`;
  }

  // ═══ TOTAL ROW ═══
  h += `<tr><td colspan="2" style="height:1px;background-color:#e2e8f0;font-size:0;line-height:0;">&nbsp;</td></tr>`;
  h += `<tr><td colspan="2" style="padding:10px 32px;border-bottom:1px solid #e2e8f0;">`;
  h += `<table cellpadding="0" cellspacing="0" border="0"><tr>`;
  h += `<td style="font-size:11px;color:#6b7280;${F}">${totalCount} orders</td>`;
  h += `<td style="font-size:11px;color:#6b7280;padding:0 6px;${F}">\u00b7</td>`;
  h += `<td style="font-size:11px;color:#0f172a;${F}">${processed.length} processed</td>`;
  if (pending.length > 0) {
    h += `<td style="font-size:11px;color:#6b7280;padding:0 6px;${F}">\u00b7</td>`;
    h += `<td style="font-size:11px;color:#0f172a;${F}">${pending.length} pending</td>`;
  }
  if (flaggedLines.length > 0) {
    h += `<td style="font-size:11px;color:#6b7280;padding:0 6px;${F}">\u00b7</td>`;
    h += `<td style="font-size:11px;color:#0f172a;${F}">${flaggedLines.length} not available</td>`;
  }
  h += `</tr></table></td></tr>`;

  // ═══ REGARDS ═══
  h += `<tr><td colspan="2" style="font-size:12px;color:#64748b;padding:18px 32px 3px;${F}">Please share the SO numbers with your dealers at the earliest.</td></tr>`;
  h += `<tr><td colspan="2" style="font-size:12px;color:#64748b;padding:0 32px 14px;${F}">For any queries, call us directly.</td></tr>`;
  h += `<tr><td colspan="2" style="font-size:12px;color:#64748b;padding:0 32px 2px;${F}">Regards,</td></tr>`;
  h += `<tr><td colspan="2" style="font-size:12px;color:#0f172a;padding:0 32px 1px;${F}">${senderName}</td></tr>`;
  h += `<tr><td colspan="2" style="font-size:11px;color:#94a3b8;padding:0 32px 1px;${F}">JSW Dulux \u2014 Surat Depot</td></tr>`;
  if (senderPhone) {
    h += `<tr><td colspan="2" style="font-size:11px;color:#0d9488;padding:0 32px 22px;${F}">${senderPhone}</td></tr>`;
  } else {
    h += `<tr><td colspan="2" style="height:22px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
  }

  // ═══ FOOTER ═══
  h += `<tr><td colspan="2" style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:10px 32px;text-align:center;font-size:9px;color:#cbd5e1;letter-spacing:0.03em;${F}">JSW Dulux Ltd \u2014 Surat Depot&nbsp;\u00b7&nbsp;Do not reply to this email</td></tr>`;

  h += `</table>`; // close 560px
  h += `</td></tr></table>`; // close outer
  h += `</body></html>`;
  return h;
}
