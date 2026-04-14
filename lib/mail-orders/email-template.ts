import type { MoOrder } from "./types";
import { cleanSubject, smartTitleCase, getBillLabel } from "./utils";

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
    const custNameBase = smartTitleCase(o.customerName ?? cleanSubject(o.subject));
    const custBillLabel = getBillLabel(o);
    const custName = custBillLabel ? `${custNameBase} \u00b7 ${custBillLabel}` : custNameBase;
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

  function zwsp(n: string): string {
    if (!n) return "";
    return n.slice(0, 4) + "&#8203;" + n.slice(4);
  }

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

  function getPendingNote(order: MoOrder): string {
    const combined = [order.remarks, order.billRemarks, order.deliveryRemarks]
      .filter(Boolean).join(" ").toLowerCase();
    if (/truck|transport|lorry|vehicle/.test(combined)) {
      return "Awaiting transport";
    }
    return "Will process tomorrow";
  }

  function getReasonLabel(reason: string): string {
    switch (reason) {
      case "out_of_stock": return "Out of stock";
      case "wrong_pack": return "Wrong pack";
      case "discontinued": return "Discontinued";
      case "other_depot": return "Other depot";
      case "other": return "Other";
      default: return reason;
    }
  }

  function fmtTime(iso: string): string {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}&#8203;:${mm}`;
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

  let h = '<!DOCTYPE html><html><head><meta charset="utf-8">';
  h += '<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">';
  h += '<meta name="x-apple-disable-message-reformatting">';
  h += '</head>';
  h += `<body style="padding:0;background-color:#f1f5f9;${F}">`;

  // Outer wrapper
  h += `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:32px 16px;"><tr><td align="center">`;
  h += `<table width="560" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border:1px solid #e2e8f0;border-top:3px solid #0d9488;">`;

  // ═══ HEADER — two column ═══
  h += `<tr>`;
  // Left column
  h += `<td style="vertical-align:middle;padding:20px 16px 20px 32px;">`;
  h += `<table cellpadding="0" cellspacing="0" border="0">`;
  h += `<tr><td style="font-size:10px;color:#94a3b8;letter-spacing:0.08em;text-transform:uppercase;padding-bottom:6px;${F}">JSW Dulux \u2014 Surat Depot</td></tr>`;
  h += `<tr><td style="font-size:17px;font-weight:700;color:#0f172a;padding-bottom:4px;${F}">${slotName} Order Summary</td></tr>`;
  h += `<tr><td style="font-size:11px;color:#94a3b8;${F}">${longDate}</td></tr>`;
  h += `</table></td>`;
  // Right column — teal panel, flush right, full height
  h += `<td style="vertical-align:middle;padding:0;width:110px;background-color:#0d9488;">`;
  h += `<table width="100%" cellpadding="0" cellspacing="0" border="0">`;
  h += `<tr><td style="text-align:center;vertical-align:middle;padding:20px;background-color:#0d9488;">`;
  h += `<table cellpadding="0" cellspacing="0" border="0" align="center">`;
  h += `<tr><td style="font-size:32px;font-weight:700;color:#ffffff;text-align:center;line-height:1;${F}">${totalCount}</td></tr>`;
  h += `<tr><td style="font-size:9px;color:#ccfbf1;text-align:center;text-transform:uppercase;letter-spacing:0.08em;padding-top:5px;${F}">ORDERS</td></tr>`;
  h += `</table></td></tr></table></td>`;
  h += `</tr>`;
  // Header border
  h += `<tr><td colspan="2" style="height:1px;background-color:#e2e8f0;font-size:0;line-height:0;">&nbsp;</td></tr>`;

  // ═══ SALUTATION ═══
  h += `<tr><td colspan="2" style="font-size:13px;color:#334155;padding:18px 32px 4px;${F}">Dear <span style="color:#0f172a;">${firstName}</span> Sir,</td></tr>`;
  h += `<tr><td colspan="2" style="font-size:12px;color:#64748b;padding:0 32px 16px;${F}">Please find your ${slotName} slot order summary below.</td></tr>`;
  // Salutation border
  h += `<tr><td colspan="2" style="height:1px;background-color:#e2e8f0;font-size:0;line-height:0;">&nbsp;</td></tr>`;

  // ═══ PROCESSED ═══
  // Label row
  h += `<tr><td colspan="2" style="background-color:#f8fafc;border-bottom:2px solid #0d9488;padding:9px 32px;">`;
  h += `<table cellpadding="0" cellspacing="0" border="0"><tr>`;
  h += `<td style="font-size:10px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.08em;${F}">Processed</td>`;
  h += `<td style="font-size:10px;color:#64748b;padding-left:4px;${F}">\u2014 ${processed.length}</td>`;
  h += `</tr></table></td></tr>`;

  if (processed.length === 0) {
    h += `<tr><td colspan="2" style="font-size:11px;color:#94a3b8;padding:12px 32px 16px;${F}">No orders processed in this slot.</td></tr>`;
  } else {
    // Sort by punchedAt descending (most recent first)
    const sortedProcessed = [...processed].sort((a, b) => {
      if (!a.punchedAt) return 1;
      if (!b.punchedAt) return -1;
      return new Date(b.punchedAt).getTime() - new Date(a.punchedAt).getTime();
    });

    // 3-column table for processed orders
    h += `<tr><td colspan="2" style="padding:0 32px;">`;
    h += `<table width="100%" cellpadding="0" cellspacing="0" border="0">`;
    sortedProcessed.forEach((o, i) => {
      const isLast = i === sortedProcessed.length - 1;
      const cust = smartTitleCase(o.customerName ?? cleanSubject(o.subject));
      const billLabel = getBillLabel(o);
      const isHold = o.dispatchStatus === "Hold";
      const custColor = isHold ? "#cbd5e1" : "#0f172a";
      const codeColor = isHold ? "#e2e8f0" : "#94a3b8";
      const custSuffix = isHold ? " *" : "";
      const splitSuffix = splitPartLabel(o.splitLabel);
      const billSuffix = billLabel ? ` \u00b7 ${billLabel}` : "";
      const bb = isLast ? "" : "border-bottom:1px solid #f1f5f9;";

      // Row 1 — serial + name + SO number
      h += `<tr>`;
      h += `<td width="24" style="font-size:11px;color:#9ca3af;padding:11px 0 2px 0;vertical-align:top;${F}">${i + 1}.</td>`;
      h += `<td style="font-size:13px;color:${custColor};padding:11px 0 2px 4px;vertical-align:top;${F}">${cust}${custSuffix}${splitSuffix}${billSuffix}</td>`;
      h += `<td width="120" style="font-size:13px;color:#0f172a;text-align:right;vertical-align:top;white-space:nowrap;padding:11px 0 2px 16px;${CM}">${zwsp(o.soNumber!)}</td>`;
      h += `</tr>`;

      // Row 2 — code + punched time
      if (o.customerCode || o.punchedAt) {
        h += `<tr>`;
        h += `<td style="font-size:0;line-height:0;">&nbsp;</td>`;
        if (o.customerCode) {
          h += `<td style="font-size:11px;color:${codeColor};padding:0 0 10px 4px;${bb}${CM}">${zwsp(o.customerCode)}</td>`;
        } else {
          h += `<td style="padding:0 0 10px 4px;font-size:0;line-height:0;${bb}">&nbsp;</td>`;
        }
        if (o.punchedAt) {
          h += `<td width="120" style="font-size:10px;color:#9ca3af;text-align:right;white-space:nowrap;padding:0 0 10px 16px;${bb}${F}">${fmtTime(o.punchedAt)}</td>`;
        } else {
          h += `<td style="padding:0 0 10px 16px;font-size:0;line-height:0;${bb}">&nbsp;</td>`;
        }
        h += `</tr>`;
      } else if (bb) {
        h += `<tr><td colspan="3" style="height:1px;font-size:0;line-height:0;${bb}">&nbsp;</td></tr>`;
      }
    });
    h += `</table></td></tr>`;

    // Spacing after all billed rows
    h += `<tr><td colspan="2" style="height:5px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
  }

  // ═══ NOT AVAILABLE ═══
  if (flaggedLines.length > 0) {
    // Separator before label
    h += `<tr><td colspan="2" style="height:1px;background-color:#e2e8f0;font-size:0;line-height:0;">&nbsp;</td></tr>`;

    // Label row
    h += `<tr><td colspan="2" style="background-color:#f8fafc;border-bottom:2px solid #b45309;padding:9px 32px;">`;
    h += `<table cellpadding="0" cellspacing="0" border="0"><tr>`;
    h += `<td style="font-size:10px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.08em;${F}">Not Available</td>`;
    h += `<td style="font-size:10px;color:#64748b;padding-left:4px;${F}">\u2014 ${flaggedLines.length} items</td>`;
    h += `</tr></table></td></tr>`;

    // 3-column table for flagged groups
    h += `<tr><td colspan="2" style="padding:0 32px;">`;
    h += `<table width="100%" cellpadding="0" cellspacing="0" border="0">`;
    flaggedGroups.forEach((group, gi) => {
      const isLastGroup = gi === flaggedGroups.length - 1;

      // Group header — serial + customer name (span cols 2+3)
      h += `<tr>`;
      h += `<td width="24" style="font-size:11px;color:#9ca3af;padding:10px 0 2px 0;vertical-align:top;${F}">${gi + 1}.</td>`;
      h += `<td colspan="2" style="font-size:13px;color:#0f172a;padding:10px 0 2px 4px;${F}">${group.customerName}</td>`;
      h += `</tr>`;

      // SO number reference
      if (group.soNumber) {
        h += `<tr>`;
        h += `<td style="font-size:0;line-height:0;">&nbsp;</td>`;
        h += `<td colspan="2" style="font-size:11px;color:#94a3b8;padding:0 0 4px 4px;${CM}">${zwsp(group.soNumber!)}</td>`;
        h += `</tr>`;
      }

      // Item rows — product + status
      group.items.forEach((fl, fi) => {
        const isLastItem = fi === group.items.length - 1;
        const itemPb = isLastItem ? "10px" : "2px";
        const prodBase = fl.baseColour
          ? `${fl.productName} ${smartTitleCase(fl.baseColour)}`
          : fl.productName;
        const product = fl.packCode
          ? `${prodBase} \u00b7 ${fl.packCode}`
          : prodBase;
        const rs = getReasonLabel(fl.reason);

        h += `<tr>`;
        h += `<td style="font-size:0;line-height:0;">&nbsp;</td>`;
        h += `<td style="font-size:11px;color:#374151;padding:2px 0 ${itemPb} 4px;${F}">${product}</td>`;
        h += `<td width="120" style="font-size:11px;color:#0f172a;text-align:right;white-space:nowrap;padding:2px 0 ${itemPb} 16px;${F}">${rs}</td>`;
        h += `</tr>`;
      });

      // Divider between groups
      if (!isLastGroup) {
        h += `<tr><td colspan="3" style="height:1px;background-color:#f1f5f9;font-size:0;line-height:0;">&nbsp;</td></tr>`;
      }
    });
    h += `</table></td></tr>`;

    // Spacing after last group
    h += `<tr><td colspan="2" style="height:10px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
  }

  // ═══ PENDING ═══
  if (pending.length > 0) {
    // Label row — slate background, consistent with other sections
    h += `<tr><td colspan="2" style="background-color:#f8fafc;border-bottom:2px solid #334155;padding:9px 32px;">`;
    h += `<table cellpadding="0" cellspacing="0" border="0"><tr>`;
    h += `<td style="font-size:10px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.08em;${F}">Pending</td>`;
    h += `<td style="font-size:10px;color:#374151;padding-left:4px;${F}">\u2014 ${pending.length}</td>`;
    h += `</tr></table></td></tr>`;

    // 3-column table for pending orders
    h += `<tr><td colspan="2" style="padding:0 32px;">`;
    h += `<table width="100%" cellpadding="0" cellspacing="0" border="0">`;
    pending.forEach((o, i) => {
      const isLast = i === pending.length - 1;
      const cust = smartTitleCase(o.customerName ?? cleanSubject(o.subject));
      const billLabel = getBillLabel(o);
      const billSuffix = billLabel ? ` \u00b7 ${billLabel}` : "";
      const note = getPendingNote(o);
      const bb = isLast ? "" : "border-bottom:1px solid #f1f5f9;";

      // Row 1 — serial + name + note
      h += `<tr>`;
      h += `<td width="24" style="font-size:11px;color:#9ca3af;padding:11px 0 2px 0;vertical-align:top;${F}">${i + 1}.</td>`;
      h += `<td style="font-size:13px;color:#0f172a;padding:11px 0 2px 4px;vertical-align:top;${F}">${cust}${billSuffix}</td>`;
      h += `<td width="120" style="font-size:11px;color:#0f172a;text-align:right;vertical-align:top;white-space:nowrap;padding:11px 0 2px 16px;${F}">${note}</td>`;
      h += `</tr>`;

      // Row 2 — customer code
      if (o.customerCode) {
        h += `<tr>`;
        h += `<td style="font-size:0;line-height:0;">&nbsp;</td>`;
        h += `<td colspan="2" style="font-size:11px;color:#94a3b8;padding:0 0 10px 4px;${bb}${CM}">${zwsp(o.customerCode)}</td>`;
        h += `</tr>`;
      } else if (bb) {
        h += `<tr><td colspan="3" style="height:1px;font-size:0;line-height:0;${bb}">&nbsp;</td></tr>`;
      }
    });
    h += `</table></td></tr>`;

    // Pending note
    h += `<tr><td colspan="2" style="font-size:11px;color:#94a3b8;padding:4px 32px 18px;line-height:1.6;${F}">These orders will be processed in tomorrow\u2019s first slot. We will keep you updated.</td></tr>`;
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
  h += `<tr><td colspan="2" style="font-size:12px;color:#64748b;padding:18px 32px 3px;${F}">Kindly note the order numbers for any future communication regarding these orders.</td></tr>`;
  h += `<tr><td colspan="2" style="font-size:12px;color:#64748b;padding:0 32px 14px;${F}">For any order-related queries, feel free to reach out to us.</td></tr>`;
  h += `<tr><td colspan="2" style="font-size:12px;color:#64748b;padding:14px 32px 2px;${F}">Thanks &amp; regards,</td></tr>`;
  h += `<tr><td colspan="2" style="font-size:12px;color:#0f172a;padding:0 32px 1px;${F}">${senderName}</td></tr>`;
  h += `<tr><td colspan="2" style="font-size:11px;color:#94a3b8;padding:0 32px 1px;${F}">Billing Team</td></tr>`;
  h += `<tr><td colspan="2" style="font-size:11px;color:#94a3b8;padding:0 32px 1px;${F}">JSW Dulux \u2014 Surat Depot</td></tr>`;
  h += `<tr><td colspan="2" style="font-size:11px;color:#0d9488;padding:0 32px 22px;${F}">+91 ${zwsp("7435065023")}</td></tr>`;

  // ═══ FOOTER ═══
  h += `<tr><td colspan="2" style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:10px 32px;text-align:center;font-size:9px;color:#cbd5e1;letter-spacing:0.03em;${F}">JSW Dulux Ltd \u2014 Surat Depot&nbsp;\u00b7&nbsp;Do not reply to this email</td></tr>`;

  h += `</table>`; // close 560px
  h += `</td></tr></table>`; // close outer
  h += `</body></html>`;
  return h;
}
