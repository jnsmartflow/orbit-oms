import type { MoOrder } from "./types";
import { getOrderFlags, smartTitleCase } from "./utils";

/**
 * Build an HTML email summarising a slot's orders for a given SO.
 */
export function buildSlotSummaryHTML(
  soName: string,
  orders: MoOrder[],
  slotName: string,
  date: string,
  senderName: string,
): string {
  // Only punched orders with an SO number
  const eligible = orders.filter((o) => o.soNumber);

  const processed: MoOrder[] = [];
  const onHold: MoOrder[] = [];
  for (const o of eligible) {
    const flags = getOrderFlags(o);
    if (flags.length > 0) {
      onHold.push(o);
    } else {
      processed.push(o);
    }
  }

  // Flagged lines: lines with a lineStatus reason that matters
  const NOTABLE_REASONS = ["out_of_stock", "cross_delivery", "cross_material_available"];
  const flaggedLines: {
    customerName: string;
    productName: string;
    packCode: string | null;
    reason: string;
  }[] = [];

  for (const o of eligible) {
    const custName = smartTitleCase(o.customerName ?? o.subject);
    for (const line of o.lines) {
      if (
        line.lineStatus?.reason &&
        NOTABLE_REASONS.includes(line.lineStatus.reason)
      ) {
        flaggedLines.push({
          customerName: custName,
          productName: smartTitleCase(line.productName) || "Unknown",
          packCode: line.packCode,
          reason: line.lineStatus.reason,
        });
      }
    }
  }

  const displayName = smartTitleCase(
    soName.replace(/^\([^)]*\)\s*/, "").trim(),
  );

  // Reason display labels + badge colors
  function reasonLabel(reason: string): string {
    switch (reason) {
      case "out_of_stock":
        return "Out of Stock";
      case "cross_delivery":
        return "Cross Delivery";
      case "cross_material_available":
        return "Alt. Available";
      default:
        return reason;
    }
  }

  function reasonBadge(reason: string): string {
    switch (reason) {
      case "out_of_stock":
        return 'style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca"';
      case "cross_delivery":
        return 'style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe"';
      case "cross_material_available":
        return 'style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#f5f3ff;color:#7c3aed;border:1px solid #ddd6fe"';
      default:
        return 'style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0"';
    }
  }

  function flagBadge(flag: string): string {
    const colors: Record<string, { bg: string; fg: string; border: string }> = {
      OD: { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca" },
      CI: { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca" },
      Bounce: { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca" },
      Hold: { bg: "#fffbeb", fg: "#b45309", border: "#fde68a" },
    };
    const c = colors[flag] ?? { bg: "#f1f5f9", fg: "#475569", border: "#e2e8f0" };
    return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:${c.bg};color:${c.fg};border:1px solid ${c.border}">${flag}</span>`;
  }

  // ── Build HTML ──

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif">`;
  html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc"><tr><td align="center" style="padding:24px 16px">`;
  html += `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0">`;

  // ── Teal header ──
  html += `<tr><td style="background:#0d9488;padding:24px 32px">`;
  html += `<p style="margin:0;font-size:18px;font-weight:700;color:#ffffff">JSW Dulux — Surat Depot</p>`;
  html += `<p style="margin:4px 0 0;font-size:13px;color:#ccfbf1">${slotName} Slot · ${date}</p>`;
  html += `</td></tr>`;

  // ── Salutation ──
  html += `<tr><td style="padding:24px 32px 16px">`;
  html += `<p style="margin:0;font-size:14px;color:#1f2937">Dear ${displayName},</p>`;
  html += `<p style="margin:8px 0 0;font-size:13px;color:#6b7280">Please find below the summary of orders processed in the <strong>${slotName}</strong> slot.</p>`;
  html += `</td></tr>`;

  // ── Processed Orders table ──
  html += `<tr><td style="padding:0 32px 16px">`;
  html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e5e7eb">`;
  html += `<tr><td colspan="4" style="background:#f0fdfa;padding:10px 16px;font-size:13px;font-weight:700;color:#0d9488;border-bottom:1px solid #ccfbf1">✓ Processed Orders (${processed.length})</td></tr>`;
  html += `<tr style="background:#f9fafb"><td style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6">#</td><td style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6">Customer</td><td style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6">Code</td><td style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6">SO No.</td></tr>`;

  if (processed.length === 0) {
    html += `<tr><td colspan="4" style="padding:16px 12px;font-size:12px;color:#9ca3af;text-align:center">No processed orders</td></tr>`;
  } else {
    processed.forEach((o, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#f9fafb";
      const cust = smartTitleCase(o.customerName ?? o.subject);
      html += `<tr style="background:${bg}"><td style="padding:8px 12px;font-size:12px;color:#6b7280;border-bottom:1px solid #f3f4f6">${i + 1}</td><td style="padding:8px 12px;font-size:12px;color:#1f2937;font-weight:500;border-bottom:1px solid #f3f4f6">${cust}</td><td style="padding:8px 12px;font-size:12px;color:#6b7280;font-family:monospace;border-bottom:1px solid #f3f4f6">${o.customerCode ?? "—"}</td><td style="padding:8px 12px;font-size:12px;color:#1f2937;font-weight:600;font-family:monospace;border-bottom:1px solid #f3f4f6">${o.soNumber}</td></tr>`;
    });
  }
  html += `</table></td></tr>`;

  // ── On Hold table (conditional) ──
  if (onHold.length > 0) {
    html += `<tr><td style="padding:0 32px 16px">`;
    html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e5e7eb">`;
    html += `<tr><td colspan="4" style="background:#fffbeb;padding:10px 16px;font-size:13px;font-weight:700;color:#b45309;border-bottom:1px solid #fde68a">⚠ On Hold (${onHold.length})</td></tr>`;
    html += `<tr style="background:#f9fafb"><td style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6">#</td><td style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6">Customer</td><td style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6">SO No.</td><td style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6">Flags</td></tr>`;

    onHold.forEach((o, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#f9fafb";
      const cust = smartTitleCase(o.customerName ?? o.subject);
      const flags = getOrderFlags(o).map(flagBadge).join(" ");
      html += `<tr style="background:${bg}"><td style="padding:8px 12px;font-size:12px;color:#6b7280;border-bottom:1px solid #f3f4f6">${i + 1}</td><td style="padding:8px 12px;font-size:12px;color:#1f2937;font-weight:500;border-bottom:1px solid #f3f4f6">${cust}</td><td style="padding:8px 12px;font-size:12px;color:#1f2937;font-weight:600;font-family:monospace;border-bottom:1px solid #f3f4f6">${o.soNumber}</td><td style="padding:8px 12px;border-bottom:1px solid #f3f4f6">${flags}</td></tr>`;
    });
    html += `</table></td></tr>`;
  }

  // ── Items to Note table (conditional) ──
  if (flaggedLines.length > 0) {
    html += `<tr><td style="padding:0 32px 16px">`;
    html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e5e7eb">`;
    html += `<tr><td colspan="3" style="background:#f1f5f9;padding:10px 16px;font-size:13px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0">📋 Items to Note (${flaggedLines.length})</td></tr>`;
    html += `<tr style="background:#f9fafb"><td style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6">Customer</td><td style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6">Product</td><td style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6">Status</td></tr>`;

    flaggedLines.forEach((fl, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#f9fafb";
      const product = fl.packCode
        ? `${fl.productName} · ${fl.packCode}`
        : fl.productName;
      html += `<tr style="background:${bg}"><td style="padding:8px 12px;font-size:12px;color:#1f2937;border-bottom:1px solid #f3f4f6">${fl.customerName}</td><td style="padding:8px 12px;font-size:12px;color:#374151;border-bottom:1px solid #f3f4f6">${product}</td><td style="padding:8px 12px;border-bottom:1px solid #f3f4f6"><span ${reasonBadge(fl.reason)}>${reasonLabel(fl.reason)}</span></td></tr>`;
    });
    html += `</table></td></tr>`;
  }

  // ── Total row ──
  const totalParts = [
    `${eligible.length} order${eligible.length !== 1 ? "s" : ""}`,
    `${processed.length} processed`,
    `${onHold.length} on hold`,
  ];
  if (flaggedLines.length > 0) {
    totalParts.push(`${flaggedLines.length} items to note`);
  }
  html += `<tr><td style="padding:0 32px 16px">`;
  html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#f8fafc;padding:12px 16px;border-radius:6px;border:1px solid #e5e7eb;font-size:12px;color:#475569;font-weight:600">Total: ${totalParts.join(" · ")}</td></tr></table>`;
  html += `</td></tr>`;

  // ── Regards ──
  html += `<tr><td style="padding:8px 32px 24px">`;
  html += `<p style="margin:0;font-size:13px;color:#1f2937">Regards,</p>`;
  html += `<p style="margin:4px 0 0;font-size:13px;font-weight:600;color:#1f2937">${senderName}</p>`;
  html += `<p style="margin:2px 0 0;font-size:11px;color:#9ca3af">Billing Operator · JSW Dulux Ltd — Surat Depot</p>`;
  html += `</td></tr>`;

  // ── Footer ──
  html += `<tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e5e7eb">`;
  html += `<p style="margin:0;font-size:10px;color:#9ca3af;text-align:center">Auto-generated by OrbitOMS · Surat Depot Operations · Do not reply</p>`;
  html += `</td></tr>`;

  html += `</table></td></tr></table></body></html>`;
  return html;
}
