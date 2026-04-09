import type { MoOrder } from "./types";
import { cleanSubject, smartTitleCase } from "./utils";

/**
 * Build an HTML email summarising a slot's orders for a given SO.
 * Outlook-safe: nested tables only, zero <div>, zero <p>,
 * all styles on immediate <td> or <span>, no margin anywhere.
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
    const custName = smartTitleCase(o.customerName ? o.customerName : cleanSubject(o.subject));
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
    return { text: "Will process tomorrow", color: "#6b7280", bg: "#f1f5f9" };
  }

  function getReasonLabel(reason: string): { text: string; color: string; bg: string } {
    switch (reason) {
      case "out_of_stock": return { text: "Out of stock", color: "#991b1b", bg: "#fee2e2" };
      case "wrong_pack": return { text: "Wrong pack", color: "#92400e", bg: "#fef3c7" };
      case "discontinued": return { text: "Discontinued", color: "#6b7280", bg: "#f1f5f9" };
      case "other_depot": return { text: "Other depot", color: "#6b7280", bg: "#f1f5f9" };
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

  function sectionLabel(text: string, count: number, color: string): string {
    return `<tr><td colspan="2" style="padding:20px 28px 12px;${F}"><span style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.08em;${F}">${text}</span><span style="font-size:10px;color:#9ca3af;font-weight:400;${F}">&nbsp;\u2014 ${count}</span></td></tr>`;
  }

  const firstName = getFirstName(soName);
  const longDate = fmtDate(date);
  const totalCount = orders.length;

  // Divider
  const divider = `<tr><td colspan="2" style="padding:0 28px;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="height:1px;background-color:#f3f4f6;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>`;

  // Group flaggedLines by soNumber for Could Not Supply
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
  h += `<body style="padding:0;background-color:#f4f4f4;${F}">`;

  // Outer wrapper
  h += `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f4;padding:32px 16px;"><tr><td align="center">`;
  h += `<table width="560" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border:1px solid #e8e8e8;">`;

  // ═══ TOP TEAL BAR ═══
  h += `<tr><td colspan="2" style="background-color:#0d9488;height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>`;

  // ═══ HEADER ═══
  h += `<tr><td colspan="2" style="padding:24px 28px 20px;border-bottom:1px solid #f3f4f6;">`;
  h += `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>`;
  // Left
  h += `<td style="vertical-align:top;${F}">`;
  h += `<table cellpadding="0" cellspacing="0" border="0">`;
  h += `<tr><td style="font-size:10px;font-weight:400;color:#9ca3af;letter-spacing:0.08em;text-transform:uppercase;padding-bottom:6px;${F}">JSW Dulux \u2014 Surat Depot</td></tr>`;
  h += `<tr><td style="font-size:18px;font-weight:700;color:#111827;letter-spacing:-1px;padding-bottom:4px;${F}">${slotName} Slot Summary</td></tr>`;
  h += `<tr><td style="font-size:11px;color:#9ca3af;${F}">${longDate}</td></tr>`;
  h += `</table></td>`;
  // Right
  h += `<td style="vertical-align:top;text-align:right;padding-left:20px;white-space:nowrap;${F}">`;
  h += `<table cellpadding="0" cellspacing="0" border="0" align="right">`;
  h += `<tr><td style="font-size:10px;color:#9ca3af;text-align:right;padding-bottom:4px;${F}">Orders</td></tr>`;
  h += `<tr><td style="font-size:26px;font-weight:700;color:#111827;text-align:right;line-height:1;${F}">${totalCount}</td></tr>`;
  h += `</table></td>`;
  h += `</tr></table></td></tr>`;

  // ═══ SALUTATION ═══
  h += `<tr><td colspan="2" style="padding:20px 28px 18px;border-bottom:1px solid #f3f4f6;">`;
  h += `<table cellpadding="0" cellspacing="0" border="0">`;
  h += `<tr><td style="padding-bottom:5px;${F}"><span style="font-size:13px;font-weight:400;color:#374151;${F}">Dear </span><span style="font-size:13px;font-weight:400;color:#111827;${F}">${firstName} Sir,</span></td></tr>`;
  h += `<tr><td style="font-size:12px;color:#6b7280;line-height:1.7;${F}">Please find below the ${slotName} slot summary for today.</td></tr>`;
  h += `</table></td></tr>`;

  // ═══ BILLED ORDERS ═══
  h += sectionLabel("Billed Orders", processed.length, "#0d9488");

  if (processed.length === 0) {
    h += `<tr><td colspan="2" style="font-size:12px;color:#9ca3af;padding:0 28px 20px;${F}">No billed orders in this slot.</td></tr>`;
  } else {
    h += `<tr><td colspan="2" style="padding:0 28px;">`;
    h += `<table width="100%" cellpadding="0" cellspacing="0" border="0">`;
    processed.forEach((o, i) => {
      const isLast = i === processed.length - 1;
      const cust = smartTitleCase(o.customerName ? o.customerName : cleanSubject(o.subject));
      const isHold = o.dispatchStatus === "Hold";
      const custColor = isHold ? "#9ca3af" : "#111827";
      const custSuffix = isHold ? " *" : "";
      const splitSuffix = splitPartLabel(o.splitLabel);
      const bb = isLast ? "" : "border-bottom:1px solid #f3f4f6;";

      h += `<tr>`;
      // Left — nested table: name row + code row
      h += `<td style="padding:10px 0;vertical-align:top;${bb}">`;
      h += `<table cellpadding="0" cellspacing="0" border="0">`;
      if (splitSuffix) {
        h += `<tr><td style="padding-bottom:2px;${F}"><span style="font-size:13px;font-weight:400;color:${custColor};${F}">${cust}${custSuffix}</span><span style="font-size:11px;font-weight:400;color:#9ca3af;${F}">${splitSuffix}</span></td></tr>`;
      } else {
        h += `<tr><td style="font-size:13px;font-weight:400;color:${custColor};padding-bottom:2px;${F}">${cust}${custSuffix}</td></tr>`;
      }
      if (o.customerCode) {
        h += `<tr><td style="font-size:11px;font-weight:400;color:#6b7280;${CM}padding:0 0 10px 0;">${o.customerCode}</td></tr>`;
      }
      h += `</table></td>`;
      // Right — SO number
      h += `<td style="font-size:14px;font-weight:400;color:#111827;${CM}padding:10px 0 10px 16px;vertical-align:top;text-align:right;white-space:nowrap;${bb}">${o.soNumber}</td>`;
      h += `</tr>`;
    });
    h += `</table></td></tr>`;
    // Bottom spacing
    h += `<tr><td colspan="2" style="height:10px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
  }

  // ═══ DIVIDER ═══
  if (flaggedLines.length > 0) h += divider;

  // ═══ COULD NOT SUPPLY — grouped by order ═══
  if (flaggedLines.length > 0) {
    h += sectionLabel("Could Not Supply", flaggedLines.length, "#6b7280");

    flaggedGroups.forEach((group, gi) => {
      const isLastGroup = gi === flaggedGroups.length - 1;
      const gpb = isLastGroup ? "padding:0 28px 20px;" : "padding:0 28px 16px;";

      h += `<tr><td colspan="2" style="${gpb}">`;
      h += `<table width="100%" cellpadding="0" cellspacing="0" border="0">`;

      // Group header — customer + SO
      h += `<tr>`;
      h += `<td style="font-size:12px;font-weight:400;color:#6b7280;padding-bottom:7px;${F}">${group.customerName}</td>`;
      if (group.soNumber) {
        h += `<td style="font-size:11px;font-weight:400;color:#9ca3af;${CM}text-align:right;padding-bottom:7px;">${group.soNumber}</td>`;
      }
      h += `</tr>`;

      // Item rows
      group.items.forEach((fl, fi) => {
        const isLastItem = fi === group.items.length - 1;
        const ibb = isLastItem ? "" : "border-bottom:1px solid #f9fafb;";
        const prodBase = fl.baseColour
          ? `${fl.productName} ${smartTitleCase(fl.baseColour)}`
          : fl.productName;
        const product = fl.packCode
          ? `${prodBase} \u00b7 ${fl.packCode}`
          : prodBase;
        const rs = getReasonLabel(fl.reason);

        h += `<tr>`;
        h += `<td style="font-size:11px;font-weight:400;color:#9ca3af;padding:4px 0;${ibb}${F}">${product}</td>`;
        h += `<td style="text-align:right;white-space:nowrap;padding:4px 0 4px 12px;${ibb}"><span style="font-size:10px;font-weight:400;color:${rs.color};background-color:${rs.bg};padding:2px 7px;border-radius:3px;${F}">${rs.text}</span></td>`;
        h += `</tr>`;
      });

      h += `</table></td></tr>`;
    });
  }

  // ═══ DIVIDER ═══
  if (pending.length > 0) h += divider;

  // ═══ PROCESSING TOMORROW ═══
  if (pending.length > 0) {
    h += sectionLabel("Processing Tomorrow", pending.length, "#9ca3af");

    h += `<tr><td colspan="2" style="padding:0 28px;">`;
    h += `<table width="100%" cellpadding="0" cellspacing="0" border="0">`;
    pending.forEach((o, i) => {
      const isLast = i === pending.length - 1;
      const bb = isLast ? "" : "border-bottom:1px solid #f3f4f6;";
      const cust = smartTitleCase(o.customerName ? o.customerName : cleanSubject(o.subject));
      const note = getPendingNote(o);

      h += `<tr>`;
      // Left — nested table for name + code
      h += `<td style="padding:11px 0;vertical-align:middle;${bb}">`;
      h += `<table cellpadding="0" cellspacing="0" border="0">`;
      h += `<tr><td style="font-size:13px;font-weight:400;color:#111827;padding:0;${F}">${cust}</td></tr>`;
      if (o.customerCode) {
        h += `<tr><td style="font-size:11px;font-weight:400;color:#6b7280;${CM}padding:1px 0 0 0;">${o.customerCode}</td></tr>`;
      }
      h += `</table></td>`;
      // Right — note
      h += `<td style="padding:11px 0 11px 12px;vertical-align:middle;text-align:right;white-space:nowrap;${bb}"><span style="font-size:10px;font-weight:400;color:${note.color};background-color:${note.bg};padding:2px 7px;border-radius:3px;${F}">${note.text}</span></td>`;
      h += `</tr>`;
    });
    h += `</table></td></tr>`;

    // Note below
    h += `<tr><td colspan="2" style="padding:12px 28px 20px;">`;
    h += `<table cellpadding="0" cellspacing="0" border="0"><tr>`;
    h += `<td style="font-size:11px;color:#9ca3af;line-height:1.7;${F}">We will process these orders in tomorrow\u2019s first slot. Kindly inform your dealers.</td>`;
    h += `</tr></table></td></tr>`;
  }

  // ═══ DIVIDER ═══
  h += divider;

  // ═══ TOTAL ROW ═══
  h += `<tr><td colspan="2" style="padding:14px 28px;border-bottom:1px solid #f3f4f6;${F}">`;
  h += `<span style="font-size:11px;color:#9ca3af;${F}">${totalCount} orders</span>`;
  h += `<span style="font-size:11px;color:#e5e7eb;padding:0 6px;${F}">\u00b7</span>`;
  h += `<span style="font-size:11px;font-weight:400;color:#0d9488;${F}">${processed.length} billed</span>`;
  if (pending.length > 0) {
    h += `<span style="font-size:11px;color:#e5e7eb;padding:0 6px;${F}">\u00b7</span>`;
    h += `<span style="font-size:11px;font-weight:400;color:#9ca3af;${F}">${pending.length} pending</span>`;
  }
  if (flaggedLines.length > 0) {
    h += `<span style="font-size:11px;color:#e5e7eb;padding:0 6px;${F}">\u00b7</span>`;
    h += `<span style="font-size:11px;font-weight:400;color:#dc2626;${F}">${flaggedLines.length} to note</span>`;
  }
  h += `</td></tr>`;

  // ═══ REGARDS ═══
  h += `<tr><td colspan="2" style="padding:20px 28px 24px;">`;
  h += `<table cellpadding="0" cellspacing="0" border="0">`;
  h += `<tr><td style="font-size:12px;color:#6b7280;padding-bottom:3px;${F}">Please share the SO numbers with your dealers at the earliest.</td></tr>`;
  h += `<tr><td style="font-size:12px;color:#6b7280;padding-bottom:16px;${F}">For any queries, call us directly.</td></tr>`;
  h += `<tr><td style="font-size:12px;color:#6b7280;padding-bottom:2px;${F}">Regards,</td></tr>`;
  h += `<tr><td style="font-size:13px;font-weight:400;color:#111827;padding-bottom:2px;${F}">${senderName}</td></tr>`;
  h += `<tr><td style="font-size:11px;color:#9ca3af;padding-bottom:2px;${F}">JSW Dulux \u2014 Surat Depot</td></tr>`;
  if (senderPhone) {
    h += `<tr><td style="font-size:11px;font-weight:400;color:#0d9488;${F}">${senderPhone}</td></tr>`;
  }
  h += `</table></td></tr>`;

  // ═══ FOOTER ═══
  h += `<tr><td colspan="2" style="background-color:#fafafa;border-top:1px solid #f3f4f6;padding:12px 28px;text-align:center;">`;
  h += `<span style="font-size:10px;color:#d1d5db;letter-spacing:0.02em;${F}">JSW Dulux Ltd \u2014 Surat Depot&nbsp;\u00b7&nbsp;Do not reply to this email</span>`;
  h += `</td></tr>`;

  h += `</table>`; // close 560px
  h += `</td></tr></table>`; // close outer
  h += `</body></html>`;
  return h;
}
