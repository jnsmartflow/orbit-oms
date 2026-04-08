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
  // Processed = has SO number; Pending = no SO number
  const processed = orders.filter((o) => o.soNumber);
  const pending = orders.filter((o) => !o.soNumber);

  // Flagged lines: lines marked as not found with a reason
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

  // Extract first name for salutation
  const cleanName = smartTitleCase(
    soName.replace(/^\([^)]*\)\s*/, "").trim(),
  );
  const firstName = cleanName.split(/\s+/)[0] || cleanName;

  // Reason helpers
  function reasonLabel(reason: string): string {
    switch (reason) {
      case "out_of_stock": return "Out of Stock";
      case "wrong_pack": return "Wrong Pack";
      case "discontinued": return "Discontinued";
      case "other_depot": return "Other Depot";
      case "other": return "Other";
      default: return reason;
    }
  }

  function reasonBadge(reason: string): string {
    const base = "display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;border:1px solid ";
    switch (reason) {
      case "out_of_stock":
        return `style="${base}#fecaca;background:#fee2e2;color:#991b1b"`;
      case "wrong_pack":
        return `style="${base}#fde68a;background:#fef3c7;color:#92400e"`;
      case "other_depot":
        return `style="${base}#bfdbfe;background:#dbeafe;color:#1e40af"`;
      case "discontinued":
      case "other":
      default:
        return `style="${base}#e2e8f0;background:#f1f5f9;color:#475569"`;
    }
  }

  // Time formatter (IST)
  const fmtTime = (iso: string | null) => {
    if (!iso) return "\u2014";
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  // Pending reason helper
  function getPendingNote(order: MoOrder): string {
    const combined = [
      order.remarks,
      order.billRemarks,
      order.deliveryRemarks,
    ].filter(Boolean).join(" ").toLowerCase();
    if (/truck|transport|lorry|vehicle/.test(combined)) {
      return "Awaiting Transport";
    }
    return "Will Process Tomorrow";
  }

  // ── Build HTML ──

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif">`;
  html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc"><tr><td align="center" style="padding:24px 16px">`;
  html += `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0">`;

  // ── Teal header ──
  html += `<tr><td style="background:#0d9488;padding:24px 32px">`;
  html += `<p style="margin:0;font-size:18px;font-weight:700;color:#ffffff">JSW Dulux \u2014 Surat Depot</p>`;
  html += `<p style="margin:4px 0 0;font-size:13px;color:#ccfbf1">${slotName} Slot \u00b7 ${date}</p>`;
  html += `</td></tr>`;

  // ── Salutation ──
  html += `<tr><td style="padding:24px 32px 16px">`;
  html += `<p style="margin:0;font-size:14px;color:#1f2937">Dear ${firstName} Sir,</p>`;
  html += `<p style="margin:8px 0 0;font-size:13px;color:#6b7280">Please find below the ${slotName} slot summary for today.</p>`;
  html += `</td></tr>`;

  // ── Section 1: Processed Orders table ──
  html += `<tr><td style="padding:0 32px 16px">`;
  html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e5e7eb">`;
  const hdr = "padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6";
  html += `<tr><td colspan="6" style="background:#0d9488;padding:8px 12px;border-radius:4px 4px 0 0"><span style="font-size:11px;font-weight:700;color:#ffffff;letter-spacing:0.06em;text-transform:uppercase">Processed Orders</span></td></tr>`;
  html += `<tr style="background:#f9fafb"><td style="${hdr}">#</td><td style="${hdr}">Customer</td><td style="${hdr}">Code</td><td style="${hdr}">SO No.</td><td style="${hdr}">Received</td><td style="${hdr}">Punched</td></tr>`;

  if (processed.length === 0) {
    html += `<tr><td colspan="6" style="padding:16px 12px;font-size:12px;color:#9ca3af;text-align:center">No processed orders</td></tr>`;
  } else {
    processed.forEach((o, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#f9fafb";
      const isHold = o.dispatchStatus === "Hold";
      const custColor = isHold ? "#94a3b8" : "#1e293b";
      const cust = smartTitleCase(o.customerName ?? o.subject) + (isHold ? " *" : "");
      const bd = "border-bottom:1px solid #f3f4f6";
      html += `<tr style="background:${bg}"><td style="padding:8px 12px;font-size:12px;color:#6b7280;${bd}">${i + 1}</td><td style="padding:8px 12px;font-size:12px;color:${custColor};font-weight:500;${bd}">${cust}</td><td style="padding:8px 12px;font-size:12px;color:#6b7280;font-family:monospace;${bd}">${o.customerCode ?? "\u2014"}</td><td style="padding:9px 10px;font-size:13px;font-weight:700;color:#1e293b;font-family:'Courier New',Courier,monospace;${bd}">${o.soNumber}</td><td style="padding:8px 12px;font-size:11px;color:#6b7280;font-family:monospace;${bd}">${fmtTime(o.receivedAt)}</td><td style="padding:8px 12px;font-size:11px;color:#6b7280;font-family:monospace;${bd}">${fmtTime(o.punchedAt)}</td></tr>`;
    });
  }
  html += `</table></td></tr>`;

  // ── Section 2: Items to Note table (conditional) ──
  if (flaggedLines.length > 0) {
    html += `<tr><td style="padding:0 32px 16px">`;
    html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e5e7eb">`;
    html += `<tr><td colspan="3" style="background:#f1f5f9;padding:10px 16px;font-size:13px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0">\u26a0 Items to Note (${flaggedLines.length})</td></tr>`;
    html += `<tr style="background:#f9fafb"><td style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6">Customer</td><td style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6">Product</td><td style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6">Status</td></tr>`;

    flaggedLines.forEach((fl, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#f9fafb";
      const product = fl.packCode
        ? `${fl.productName} \u00b7 ${fl.packCode}`
        : fl.productName;
      html += `<tr style="background:${bg}"><td style="padding:8px 12px;font-size:12px;color:#1f2937;border-bottom:1px solid #f3f4f6">${fl.customerName}</td><td style="padding:8px 12px;font-size:12px;color:#374151;border-bottom:1px solid #f3f4f6">${product}</td><td style="padding:8px 12px;border-bottom:1px solid #f3f4f6"><span ${reasonBadge(fl.reason)}>${reasonLabel(fl.reason)}</span></td></tr>`;
    });
    html += `</table></td></tr>`;
  }

  // ── Section 3: Pending Orders table (conditional) ──
  if (pending.length > 0) {
    html += `<tr><td style="padding:0 32px 16px">`;
    html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e5e7eb">`;
    html += `<tr><td colspan="4" style="background:#f1f5f9;padding:10px 16px;font-size:13px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0">\u23f3 Pending \u2014 Will Be Processed Tomorrow (${pending.length})</td></tr>`;
    html += `<tr style="background:#f9fafb"><td style="${hdr}">#</td><td style="${hdr}">Customer</td><td style="${hdr}">Code</td><td style="${hdr}">Note</td></tr>`;

    pending.forEach((o, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#f9fafb";
      const cust = smartTitleCase(o.customerName ?? o.subject);
      const note = getPendingNote(o);
      const noteColor = note === "Awaiting Transport" ? "#92400e" : "#64748b";
      const bd = "border-bottom:1px solid #f3f4f6";
      html += `<tr style="background:${bg}"><td style="padding:8px 12px;font-size:12px;color:#6b7280;${bd}">${i + 1}</td><td style="padding:8px 12px;font-size:12px;color:#1f2937;font-weight:500;${bd}">${cust}</td><td style="padding:8px 12px;font-size:12px;color:#6b7280;font-family:monospace;${bd}">${o.customerCode ?? "\u2014"}</td><td style="padding:8px 12px;font-size:11px;color:${noteColor};${bd}">${note}</td></tr>`;
    });

    html += `<tr><td colspan="4" style="padding:12px 12px;font-size:11px;color:#64748b;background:#f8fafc;border-top:1px solid #e5e7eb">These orders could not be processed today and will be taken up in tomorrow\u2019s first slot. Please plan accordingly.</td></tr>`;
    html += `</table></td></tr>`;
  }

  // ── Total row ──
  const totalCount = processed.length + pending.length;
  const totalParts = [
    `${totalCount} order${totalCount !== 1 ? "s" : ""}`,
    `${processed.length} processed`,
  ];
  if (pending.length > 0) {
    totalParts.push(`${pending.length} pending`);
  }
  html += `<tr><td style="padding:0 32px 16px">`;
  html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#f8fafc;padding:12px 16px;border-radius:6px;border:1px solid #e5e7eb;font-size:12px;color:#475569;font-weight:600">Total: ${totalParts.join(" \u00b7 ")}</td></tr></table>`;
  html += `</td></tr>`;

  // ── Closing line ──
  html += `<tr><td style="padding:0 32px 16px">`;
  html += `<p style="margin:0;font-size:13px;color:#374151">Kindly share the SO numbers with your respective dealers.</p>`;
  html += `<p style="margin:4px 0 0;font-size:13px;color:#374151">For any queries, feel free to call.</p>`;
  html += `</td></tr>`;

  // ── Regards ──
  html += `<tr><td style="padding:8px 32px 24px">`;
  html += `<p style="margin:0;font-size:13px;color:#1f2937">Regards,</p>`;
  html += `<p style="margin:4px 0 0;font-size:13px;font-weight:600;color:#1f2937">${senderName}</p>`;
  html += `<p style="margin:2px 0 0;font-size:11px;color:#9ca3af">Billing Operator \u00b7 JSW Dulux Ltd \u2014 Surat Depot</p>`;
  if (senderPhone) {
    html += `<p style="margin:2px 0 0;font-size:11px;color:#9ca3af">${senderPhone}</p>`;
  }
  html += `</td></tr>`;

  // ── Footer ──
  html += `<tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e5e7eb">`;
  html += `<p style="margin:0;font-size:10px;color:#9ca3af;text-align:center">Auto-generated by OrbitOMS \u00b7 Surat Depot Operations \u00b7 Do not reply</p>`;
  html += `</td></tr>`;

  html += `</table></td></tr></table></body></html>`;
  return html;
}
