import type { MoOrder } from "./types";
import { cleanSubject, smartTitleCase } from "./utils";

/**
 * Build an HTML email summarising a slot's orders for a given SO.
 * Outlook-safe: nested tables only, zero <div>, zero <p>,
 * all styles on immediate <td>, no margin anywhere.
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

  function getPendingNote(order: MoOrder): { text: string; color: string; bg: string } {
    const combined = [order.remarks, order.billRemarks, order.deliveryRemarks]
      .filter(Boolean).join(" ").toLowerCase();
    if (/truck|transport|lorry|vehicle/.test(combined)) {
      return { text: "Awaiting transport", color: "#92400e", bg: "#fef3c7" };
    }
    return { text: "Will process tomorrow", color: "#475569", bg: "#e2e8f0" };
  }

  function getReasonLabel(reason: string): { text: string; color: string; bg: string } {
    switch (reason) {
      case "out_of_stock": return { text: "Out of stock", color: "#991b1b", bg: "#fee2e2" };
      case "wrong_pack": return { text: "Wrong pack", color: "#92400e", bg: "#fef3c7" };
      case "discontinued": return { text: "Discontinued", color: "#475569", bg: "#f1f5f9" };
      case "other_depot": return { text: "Other depot", color: "#1d4ed8", bg: "#eff6ff" };
      case "other": return { text: "Other", color: "#6b7280", bg: "#f1f5f9" };
      default: return { text: reason, color: "#6b7280", bg: "#f1f5f9" };
    }
  }

  function splitPartLabel(label: string | null | undefined): string {
    if (!label) return "";
    if (label === "A") return " (Part 1 of 2)";
    if (label === "B") return " (Part 2 of 2)";
    return ` (${label})`;
  }

  function pill(text: string, color: string, bg: string): string {
    return `<table cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:${bg};font-size:10px;color:${color};padding:2px 8px;${F}">${text}</td></tr></table>`;
  }

  const firstName = getFirstName(soName);
  const longDate = fmtDate(date);
  const totalCount = orders.length;

  // Spacer row
  const spacer = `<tr><td colspan="2" style="height:1px;font-size:0;line-height:0;">&nbsp;</td></tr>`;

  // Divider — full width 1px #e2e8f0
  const divider = `<tr><td colspan="2" style="font-size:0;line-height:0;height:1px;background-color:#e2e8f0;">&nbsp;</td></tr>`;

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
  h += `<body style="padding:0;background-color:#f8fafc;${F}">`;

  // Outer wrapper
  h += `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;padding:32px 16px;"><tr><td align="center">`;
  h += `<table width="560" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border:1px solid #e2e8f0;">`;

  // ═══ TOP TEAL BAR ═══
  h += `<tr><td colspan="2" style="background-color:#0d9488;height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>`;

  // ═══ HEADER ═══
  h += `<tr><td colspan="2" style="padding:24px 32px 20px;border-bottom:1px solid #e2e8f0;">`;
  h += `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>`;
  // Left
  h += `<td style="vertical-align:top;${F}">`;
  h += `<table cellpadding="0" cellspacing="0" border="0">`;
  h += `<tr><td style="font-size:10px;font-weight:400;color:#94a3b8;letter-spacing:0.08em;text-transform:uppercase;padding-bottom:6px;${F}">JSW Dulux \u2014 Surat Depot</td></tr>`;
  h += `<tr><td style="font-size:17px;font-weight:700;color:#0f172a;letter-spacing:-1px;padding-bottom:4px;${F}">${slotName} Slot Summary</td></tr>`;
  h += `<tr><td style="font-size:11px;color:#94a3b8;${F}">${longDate}</td></tr>`;
  h += `</table></td>`;
  // Right
  h += `<td style="vertical-align:top;text-align:right;padding-left:20px;white-space:nowrap;${F}">`;
  h += `<table cellpadding="0" cellspacing="0" border="0" align="right">`;
  h += `<tr><td style="font-size:10px;color:#94a3b8;text-align:right;padding-bottom:4px;${F}">Orders</td></tr>`;
  h += `<tr><td style="font-size:24px;font-weight:700;color:#0f172a;text-align:right;line-height:1;${F}">${totalCount}</td></tr>`;
  h += `</table></td>`;
  h += `</tr></table></td></tr>`;

  // ═══ SALUTATION ═══
  h += `<tr><td colspan="2" style="padding:18px 32px 16px;border-bottom:1px solid #e2e8f0;">`;
  h += `<table cellpadding="0" cellspacing="0" border="0">`;
  h += `<tr><td style="padding-bottom:5px;${F}"><span style="font-size:13px;font-weight:400;color:#334155;${F}">Dear </span><span style="font-size:13px;font-weight:400;color:#0f172a;${F}">${firstName} Sir,</span></td></tr>`;
  h += `<tr><td style="font-size:12px;color:#64748b;line-height:1.6;${F}">Please find below the ${slotName} slot summary for today.</td></tr>`;
  h += `</table></td></tr>`;

  // ═══ PROCESSED ═══
  h += `<tr><td colspan="2" style="padding:9px 32px;background-color:#f8fafc;border-bottom:2px solid #0d9488;${F}"><span style="font-size:10px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.08em;${F}">Processed</span><span style="font-size:10px;color:#64748b;font-weight:400;${F}">&nbsp;\u2014 ${processed.length}</span></td></tr>`;

  if (processed.length === 0) {
    h += `<tr><td colspan="2" style="font-size:11px;color:#94a3b8;padding:12px 32px 16px;${F}">No orders processed in this slot.</td></tr>`;
  } else {
    h += `<tr><td colspan="2" style="padding:0 32px;">`;
    h += `<table width="100%" cellpadding="0" cellspacing="0" border="0">`;
    processed.forEach((o, i) => {
      const isLast = i === processed.length - 1;
      const cust = smartTitleCase(o.customerName ?? cleanSubject(o.subject));
      const isHold = o.dispatchStatus === "Hold";
      const custColor = isHold ? "#94a3b8" : "#0f172a";
      const codeColor = isHold ? "#cbd5e1" : "#94a3b8";
      const custSuffix = isHold ? " *" : "";
      const splitSuffix = splitPartLabel(o.splitLabel);
      const bb = isLast ? "" : "border-bottom:1px solid #e2e8f0;";

      h += `<tr>`;
      // Left — nested table: name row + code row
      h += `<td style="padding:11px 0;vertical-align:top;${bb}">`;
      h += `<table cellpadding="0" cellspacing="0" border="0">`;
      if (splitSuffix) {
        h += `<tr><td style="padding-bottom:2px;${F}"><span style="font-size:12px;font-weight:400;color:${custColor};${F}">${cust}${custSuffix}</span><span style="font-size:10px;font-weight:400;color:#94a3b8;${F}">${splitSuffix}</span></td></tr>`;
      } else {
        h += `<tr><td style="font-size:12px;font-weight:400;color:${custColor};padding-bottom:2px;${F}">${cust}${custSuffix}</td></tr>`;
      }
      if (o.customerCode) {
        h += `<tr><td style="font-size:10px;font-weight:400;color:${codeColor};${CM}padding:0;">${o.customerCode}</td></tr>`;
      }
      h += `</table></td>`;
      // Right — SO number
      h += `<td style="font-size:13px;font-weight:400;color:#0f172a;${CM}padding:11px 0 11px 16px;vertical-align:top;text-align:right;white-space:nowrap;${bb}">${o.soNumber}</td>`;
      h += `</tr>`;
    });
    h += `</table></td></tr>`;
    h += spacer;
  }

  // ═══ NOT AVAILABLE — grouped by order ═══
  if (flaggedLines.length > 0) {
    h += `<tr><td colspan="2" style="padding:9px 32px;background-color:#f8fafc;border-top:1px solid #e2e8f0;border-bottom:2px solid #dc2626;${F}"><span style="font-size:10px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.08em;${F}">Not Available</span><span style="font-size:10px;color:#64748b;font-weight:400;${F}">&nbsp;\u2014 ${flaggedLines.length}</span></td></tr>`;

    flaggedGroups.forEach((group, gi) => {
      const isLastGroup = gi === flaggedGroups.length - 1;

      // Row 1 — Customer name
      h += `<tr>`;
      h += `<td colspan="2" style="font-size:12px;font-weight:400;color:#0f172a;padding:10px 32px 2px;${F}">${group.customerName}</td>`;
      h += `</tr>`;

      // Row 2 — SO number (if exists)
      if (group.soNumber) {
        h += `<tr>`;
        h += `<td colspan="2" style="font-size:10px;font-weight:400;color:#94a3b8;${CM}padding:0 32px 3px;">${group.soNumber}</td>`;
        h += `</tr>`;
      }

      // Row 3 per item — Product + status pill
      group.items.forEach((fl, fi) => {
        const isLastItem = fi === group.items.length - 1;
        const groupBorder = (isLastItem && !isLastGroup) ? "border-bottom:1px solid #e2e8f0;" : "";
        const bottomPad = isLastItem ? "padding:3px 0 16px;" : "padding:3px 0;";

        const prodBase = fl.baseColour
          ? `${fl.productName} ${smartTitleCase(fl.baseColour)}`
          : fl.productName;
        const product = fl.packCode
          ? `${prodBase} \u00b7 ${fl.packCode}`
          : prodBase;
        const rs = getReasonLabel(fl.reason);

        h += `<tr>`;
        h += `<td style="font-size:11px;font-weight:400;color:#94a3b8;${bottomPad}${groupBorder}${F}padding-left:32px;">${product}</td>`;
        h += `<td style="text-align:right;white-space:nowrap;padding-left:16px;vertical-align:top;${bottomPad}${groupBorder}padding-right:32px;">${pill(rs.text, rs.color, rs.bg)}</td>`;
        h += `</tr>`;
      });
    });
  }

  // ═══ PENDING ═══
  if (pending.length > 0) {
    h += `<tr><td colspan="2" style="padding:9px 32px;background-color:#f8fafc;border-top:1px solid #e2e8f0;border-bottom:2px solid #94a3b8;${F}"><span style="font-size:10px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.08em;${F}">Pending</span><span style="font-size:10px;color:#64748b;font-weight:400;${F}">&nbsp;\u2014 ${pending.length}</span></td></tr>`;

    h += `<tr><td colspan="2" style="padding:0 32px;background-color:#ffffff;">`;
    h += `<table width="100%" cellpadding="0" cellspacing="0" border="0">`;
    pending.forEach((o, i) => {
      const isLast = i === pending.length - 1;
      const bb = isLast ? "" : "border-bottom:1px solid #e2e8f0;";
      const cust = smartTitleCase(o.customerName ?? cleanSubject(o.subject));
      const note = getPendingNote(o);

      h += `<tr>`;
      // Left — nested table for name + code
      h += `<td style="padding:11px 0 4px;vertical-align:middle;${bb}">`;
      h += `<table cellpadding="0" cellspacing="0" border="0">`;
      h += `<tr><td style="font-size:12px;font-weight:400;color:#0f172a;padding:0;${F}">${cust}</td></tr>`;
      if (o.customerCode) {
        h += `<tr><td style="font-size:10px;font-weight:400;color:#94a3b8;${CM}padding:1px 0 0 0;">${o.customerCode}</td></tr>`;
      }
      h += `</table></td>`;
      // Right — note pill
      h += `<td style="padding:11px 0 4px 16px;vertical-align:top;text-align:right;white-space:nowrap;${bb}">${pill(note.text, note.color, note.bg)}</td>`;
      h += `</tr>`;
    });
    h += `</table></td></tr>`;

    // Note below
    h += `<tr><td colspan="2" style="padding:6px 32px 18px;">`;
    h += `<table cellpadding="0" cellspacing="0" border="0"><tr>`;
    h += `<td style="font-size:11px;color:#94a3b8;line-height:1.6;${F}">We will process these orders in tomorrow\u2019s first slot. Kindly inform your dealers.</td>`;
    h += `</tr></table></td></tr>`;
  }

  // ═══ DIVIDER ═══
  h += divider;

  // ═══ TOTAL ROW ═══
  h += `<tr><td colspan="2" style="padding:10px 32px;border-bottom:1px solid #e2e8f0;">`;
  h += `<table cellpadding="0" cellspacing="0" border="0"><tr>`;
  h += `<td style="font-size:11px;color:#94a3b8;${F}">${totalCount} orders</td>`;
  h += `<td style="font-size:11px;color:#cbd5e1;padding:0 6px;${F}">\u00b7</td>`;
  h += `<td style="padding:0;">${pill(`${processed.length} billed`, "#0f766e", "#ccfbf1")}</td>`;
  if (pending.length > 0) {
    h += `<td style="font-size:11px;color:#cbd5e1;padding:0 6px;${F}">\u00b7</td>`;
    h += `<td style="font-size:11px;font-weight:400;color:#94a3b8;${F}">${pending.length} pending</td>`;
  }
  if (flaggedLines.length > 0) {
    h += `<td style="font-size:11px;color:#cbd5e1;padding:0 6px;${F}">\u00b7</td>`;
    h += `<td style="padding:0;">${pill(`${flaggedLines.length} to note`, "#991b1b", "#fee2e2")}</td>`;
  }
  h += `</tr></table>`;
  h += `</td></tr>`;

  // ═══ REGARDS ═══
  h += `<tr><td colspan="2" style="padding:18px 32px 22px;">`;
  h += `<table cellpadding="0" cellspacing="0" border="0">`;
  h += `<tr><td style="font-size:12px;color:#64748b;padding-bottom:3px;${F}">Please share the SO numbers with your dealers at the earliest.</td></tr>`;
  h += `<tr><td style="font-size:12px;color:#64748b;padding-bottom:16px;${F}">For any queries, call us directly.</td></tr>`;
  h += `<tr><td style="font-size:12px;color:#64748b;padding-bottom:2px;${F}">Regards,</td></tr>`;
  h += `<tr><td style="font-size:12px;font-weight:400;color:#0f172a;padding-bottom:2px;${F}">${senderName}</td></tr>`;
  h += `<tr><td style="font-size:11px;color:#94a3b8;padding-bottom:2px;${F}">JSW Dulux \u2014 Surat Depot</td></tr>`;
  if (senderPhone) {
    h += `<tr><td style="font-size:11px;font-weight:400;color:#0d9488;${F}">${senderPhone}</td></tr>`;
  }
  h += `</table></td></tr>`;

  // ═══ FOOTER ═══
  h += `<tr><td colspan="2" style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:10px 32px;text-align:center;">`;
  h += `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-size:9px;color:#cbd5e1;letter-spacing:0.02em;text-align:center;${F}">JSW Dulux Ltd \u2014 Surat Depot&nbsp;\u00b7&nbsp;Do not reply to this email</td></tr></table>`;
  h += `</td></tr>`;

  h += `</table>`; // close 560px
  h += `</td></tr></table>`; // close outer
  h += `</body></html>`;
  return h;
}
