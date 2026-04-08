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
    productName: string;
    packCode: string | null;
    reason: string;
  }[] = [];

  for (const o of orders) {
    const custName = smartTitleCase(o.customerName ?? o.subject);
    for (const line of o.lines) {
      if (line.lineStatus?.reason && line.lineStatus.found === false) {
        flaggedLines.push({
          customerName: custName,
          productName: smartTitleCase(line.productName) || "Unknown",
          packCode: line.packCode,
          reason: line.lineStatus.reason,
        });
      }
    }
  }

  // ── Helpers ──

  function fmtTime(iso: string | null): string {
    if (!iso) return "\u2014";
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function fmtDate(d: string): string {
    // d comes in as "9 Apr 2026" or similar from toLocaleDateString
    // We want "Wednesday, 9 April 2026"
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
      return { text: "Awaiting transport", color: "#b45309" };
    }
    return { text: "Will process tomorrow", color: "#64748b" };
  }

  function getReasonBadge(reason: string): { label: string; bg: string; color: string; border?: string } {
    switch (reason) {
      case "out_of_stock":
        return { label: "Out of Stock", bg: "#fef2f2", color: "#b91c1c" };
      case "wrong_pack":
        return { label: "Wrong Pack", bg: "#fffbeb", color: "#b45309", border: "#fde68a" };
      case "discontinued":
        return { label: "Discontinued", bg: "#f1f5f9", color: "#475569" };
      case "other_depot":
        return { label: "Other Depot", bg: "#eff6ff", color: "#1d4ed8" };
      case "other":
        return { label: "Other", bg: "#f1f5f9", color: "#475569" };
      default:
        return { label: reason, bg: "#f1f5f9", color: "#475569" };
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

  // ── Build HTML ──

  let h = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>';
  h += '<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif">';
  h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc"><tr><td align="center" style="padding:16px 8px">';
  h += '<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">';

  // ═══ HEADER ═══
  h += '<tr><td>';
  h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px 10px 0 0;overflow:hidden">';
  // Top accent bar
  h += '<tr><td style="background:#0f766e;height:4px;font-size:0;line-height:0">&nbsp;</td></tr>';
  // Main header
  h += '<tr><td style="background:#0d9488;padding:20px 24px 18px">';
  h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
  // Left side
  h += '<td style="vertical-align:top">';
  h += `<p style="margin:0;font-size:9px;font-weight:700;color:#99f6e4;text-transform:uppercase;letter-spacing:0.12em">JSW Dulux \u2014 Surat Depot</p>`;
  h += `<p style="margin:6px 0 0;font-size:19px;font-weight:700;color:#ffffff">${slotName} Slot Summary</p>`;
  h += `<p style="margin:4px 0 0;font-size:11px;color:#ccfbf1">${longDate}</p>`;
  h += '</td>';
  // Right side — order count pill
  h += '<td style="vertical-align:top;text-align:right;width:80px">';
  h += `<div style="display:inline-block;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:6px;padding:8px 14px;text-align:center">`;
  h += `<p style="margin:0;font-size:20px;font-weight:700;color:#ffffff">${totalCount}</p>`;
  h += '<p style="margin:2px 0 0;font-size:8px;color:#99f6e4;text-transform:uppercase;letter-spacing:0.06em">Orders</p>';
  h += '</div>';
  h += '</td>';
  h += '</tr></table>';
  h += '</td></tr>';
  h += '</table>';
  h += '</td></tr>';

  // ═══ BODY WRAPPER ═══
  h += '<tr><td>';
  h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #ccfbf1;border-top:none;border-radius:0 0 10px 10px;overflow:hidden">';

  // ═══ SALUTATION ═══
  h += '<tr><td style="padding:20px 24px 16px;border-bottom:1px solid #f0fdfa">';
  h += `<p style="margin:0;font-size:14px;color:#134e4a">Dear <strong style="color:#0f172a">${firstName}</strong> Sir,</p>`;
  h += `<p style="margin:5px 0 0;font-size:12px;color:#64748b;line-height:1.6">Please find below the ${slotName} slot summary for today.</p>`;
  h += '</td></tr>';

  // ═══ SECTION 1 — BILLED ORDERS ═══
  h += '<tr><td>';
  h += `<p style="margin:0;padding:14px 24px 4px;font-size:9px;font-weight:700;color:#0d9488;text-transform:uppercase;letter-spacing:0.1em">\u2713 Billed \u2014 ${processed.length} order${processed.length !== 1 ? "s" : ""}</p>`;

  if (processed.length === 0) {
    h += '<p style="margin:0;padding:8px 24px 16px;font-size:12px;color:#94a3b8">No billed orders in this slot.</p>';
  } else {
    processed.forEach((o, i) => {
      const cust = smartTitleCase(o.customerName ?? o.subject);
      const isHold = o.dispatchStatus === "Hold";
      const custColor = isHold ? "#94a3b8" : "#0f172a";
      const custSuffix = isHold ? " *" : "";
      const splitSuffix = splitPartLabel(o.splitLabel);
      const mb = i === processed.length - 1 ? "16px" : "0";

      h += `<div style="margin:8px 16px ${mb};border-radius:8px;border:1px solid #e2e8f0;overflow:hidden">`;
      // Card top row
      h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
      // Left: customer + code
      h += '<td style="padding:12px 16px;vertical-align:top">';
      h += `<p style="margin:0;font-size:13px;font-weight:700;color:${custColor}">${cust}${custSuffix}`;
      if (splitSuffix) {
        h += `<span style="font-weight:700;color:#64748b">${splitSuffix}</span>`;
      }
      h += '</p>';
      h += `<p style="margin:3px 0 0;font-size:10px;color:#64748b">Code <span style="color:#0d9488;font-weight:700;font-family:'Courier New',Courier,monospace;font-size:11px">${o.customerCode ?? "\u2014"}</span></p>`;
      h += '</td>';
      // Right: SO number
      h += '<td style="padding:12px 16px;vertical-align:top;text-align:right">';
      h += `<p style="margin:0;font-size:14px;font-weight:700;color:#0f172a;font-family:'Courier New',Courier,monospace">${o.soNumber}</p>`;
      h += '<p style="margin:2px 0 0;font-size:8px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em">SO Number</p>';
      h += '</td>';
      h += '</tr></table>';
      // Card bottom strip — times
      h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#f0fdfa;border-top:1px solid #ccfbf1;padding:6px 16px">';
      h += '<table role="presentation" cellpadding="0" cellspacing="0"><tr>';
      h += `<td style="font-size:10px;color:#64748b;padding-right:4px">Recd.</td>`;
      h += `<td style="font-size:10px;font-weight:700;color:#334155;padding-right:8px">${fmtTime(o.receivedAt)}</td>`;
      h += `<td style="font-size:10px;color:#a7f3d0;padding-right:8px">\u2192</td>`;
      h += `<td style="font-size:10px;color:#64748b;padding-right:4px">Punched</td>`;
      const pTime = fmtTime(o.punchedAt);
      const pColor = o.punchedAt ? "#0d9488" : "#94a3b8";
      h += `<td style="font-size:10px;font-weight:700;color:${pColor}">${pTime}</td>`;
      h += '</tr></table>';
      h += '</td></tr></table>';
      h += '</div>';
    });
  }
  h += '</td></tr>';

  // ═══ SECTION 2 — COULD NOT SUPPLY ═══
  if (flaggedLines.length > 0) {
    h += '<tr><td style="background:#fffbeb;border-top:1px solid #fde68a;border-bottom:1px solid #fde68a">';
    h += `<p style="margin:0;padding:14px 24px 4px;font-size:9px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:0.1em">\u26a0 Could Not Supply \u2014 ${flaggedLines.length} item${flaggedLines.length !== 1 ? "s" : ""}</p>`;

    // Single card for all flagged lines
    h += '<div style="margin:8px 16px 16px;border-radius:8px;border:1px solid #fde68a;overflow:hidden">';
    flaggedLines.forEach((fl, i) => {
      const isLast = i === flaggedLines.length - 1;
      const bg = i % 2 === 0 ? "#fffbeb" : "#ffffff";
      const bb = isLast ? "" : "border-bottom:1px solid #fef3c7;";
      const product = fl.packCode
        ? `${fl.productName} \u00b7 ${fl.packCode}`
        : fl.productName;
      const badge = getReasonBadge(fl.reason);
      const borderStyle = badge.border ? `border:1px solid ${badge.border};` : "";

      h += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>`;
      // Left: customer + product
      h += `<td style="padding:10px 16px;vertical-align:top;background:${bg};${bb}">`;
      h += `<p style="margin:0;font-size:12px;font-weight:700;color:#0f172a">${fl.customerName}</p>`;
      h += `<p style="margin:1px 0 0;font-size:11px;color:#92400e">${product}</p>`;
      h += '</td>';
      // Right: badge
      h += `<td style="padding:10px 16px;vertical-align:top;text-align:right;background:${bg};${bb}white-space:nowrap">`;
      h += `<span style="display:inline-block;font-size:9px;font-weight:700;padding:3px 8px;border-radius:4px;white-space:nowrap;background:${badge.bg};color:${badge.color};${borderStyle}margin-left:10px">${badge.label}</span>`;
      h += '</td>';
      h += '</tr></table>';
    });
    h += '</div>';
    h += '</td></tr>';
  }

  // ═══ SECTION 3 — TOMORROW ═══
  if (pending.length > 0) {
    h += '<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0">';
    h += `<p style="margin:0;padding:14px 24px 4px;font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.1em">\u23f3 Tomorrow \u2014 ${pending.length} order${pending.length !== 1 ? "s" : ""}</p>`;

    // Single card for all pending
    h += '<div style="margin:8px 16px 0;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden">';
    pending.forEach((o, i) => {
      const isLast = i === pending.length - 1;
      const bg = i % 2 === 0 ? "#f8fafc" : "#ffffff";
      const bb = isLast ? "" : "border-bottom:1px solid #e2e8f0;";
      const cust = smartTitleCase(o.customerName ?? o.subject);
      const note = getPendingNote(o);

      h += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>`;
      // Left: customer + code
      h += `<td style="padding:10px 16px;vertical-align:top;background:${bg};${bb}">`;
      h += `<p style="margin:0;font-size:12px;font-weight:700;color:#0f172a">${cust}</p>`;
      h += `<p style="margin:1px 0 0;font-size:10px;color:#0d9488;font-weight:700;font-family:'Courier New',Courier,monospace">${o.customerCode ?? "\u2014"}</p>`;
      h += '</td>';
      // Right: note
      h += `<td style="padding:10px 16px;vertical-align:top;text-align:right;background:${bg};${bb}white-space:nowrap">`;
      h += `<span style="font-size:10px;color:${note.color};margin-left:12px">${note.text}</span>`;
      h += '</td>';
      h += '</tr></table>';
    });
    h += '</div>';

    // Note below card
    h += `<p style="margin:0;padding:10px 24px 16px;font-size:10px;color:#94a3b8;line-height:1.6;background:#f8fafc">We will process these orders in tomorrow\u2019s first slot. Kindly inform your dealers.</p>`;
    h += '</td></tr>';
  }

  // ═══ TOTAL ROW ═══
  h += '<tr><td style="border-top:1px solid #e2e8f0;padding:12px 24px">';
  const parts: string[] = [];
  parts.push(`<span style="font-size:12px;font-weight:700;color:#0f172a">${totalCount} order${totalCount !== 1 ? "s" : ""}</span>`);
  parts.push(`<span style="color:#cbd5e1">\u00b7</span>`);
  parts.push(`<span style="font-size:12px;font-weight:700;color:#0d9488">${processed.length} billed</span>`);
  if (pending.length > 0) {
    parts.push(`<span style="color:#cbd5e1">\u00b7</span>`);
    parts.push(`<span style="font-size:12px;font-weight:700;color:#64748b">${pending.length} pending</span>`);
  }
  if (flaggedLines.length > 0) {
    parts.push(`<span style="color:#cbd5e1">\u00b7</span>`);
    parts.push(`<span style="font-size:12px;font-weight:700;color:#b91c1c">${flaggedLines.length} to note</span>`);
  }
  h += `<p style="margin:0">${parts.join(" ")}</p>`;
  h += '</td></tr>';

  // ═══ CLOSING + REGARDS ═══
  h += '<tr><td style="padding:16px 24px 20px;border-top:1px solid #f0fdfa">';
  h += '<p style="margin:0;font-size:12px;color:#475569;line-height:2.1">Please share the SO numbers with your dealers at the earliest.</p>';
  h += '<p style="margin:0;font-size:12px;color:#475569">For any queries, call us directly.</p>';
  h += '<p style="margin:14px 0 0;font-size:12px;color:#475569">Regards,</p>';
  h += `<p style="margin:4px 0 0;font-size:13px;font-weight:700;color:#0f172a">${senderName}</p>`;
  h += '<p style="margin:2px 0 0;font-size:11px;color:#64748b">JSW Dulux \u2014 Surat Depot</p>';
  if (senderPhone) {
    h += `<p style="margin:2px 0 0;font-size:11px;font-weight:700;color:#0d9488">${senderPhone}</p>`;
  }
  h += '</td></tr>';

  // ═══ FOOTER ═══
  h += '</table>'; // close body wrapper
  h += '</td></tr>';

  h += '<tr><td>';
  h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdfa;border-top:1px solid #ccfbf1;border-radius:0 0 10px 10px;overflow:hidden">';
  h += '<tr><td style="padding:10px 24px">';
  h += '<p style="margin:0;font-size:9px;color:#94a3b8;letter-spacing:0.02em">JSW Dulux Ltd \u2014 Surat Depot \u00b7 Do not reply to this email</p>';
  h += '</td></tr>';
  h += '</table>';
  h += '</td></tr>';

  h += '</table>'; // close outer 520px table
  h += '</td></tr></table>'; // close centering wrapper
  h += '</body></html>';
  return h;
}
