// lib/sap-parser/group-rows.ts
//
// Step 2 of the parse pipeline: bucket flat RawSapRow[] by Delivery and
// apply two whole-delivery skip rules:
// - D.1  non-LF returns where Delivery length < 10 AND Delivery Type is not
//        "LF".
// - D.1b other depot's shipping point — every row's Shipping Point (col 2)
//        must be DEPOT_SHIPPING_POINT; anything else (another code, a mix,
//        or blank) skips the WHOLE delivery with a foreign-shipping-point
//        warning naming the value(s). Never row-level: SAP sources carry
//        LINE_AUTHORITY, so a dropped row on a kept bill would be marked
//        removed_by_import.
// The other skip rules — all-ZZRE and no-valid-lines — are applied later in
// apply-rules.ts after per-row filtering, since they depend on what survives
// line-level processing.

import { DEPOT_SHIPPING_POINT, type RawSapRow, type SkippedRow, type Warning } from "./types";

export interface GroupedDelivery {
  delivery: string;
  rows:     RawSapRow[];
}

export interface GroupRowsResult {
  groups:    GroupedDelivery[];
  skipped:   SkippedRow[];
  warnings:  Warning[];
  /** Set of distinct Delivery values seen — including ones later skipped. */
  uniqueDeliveries: Set<string>;
}

/**
 * Bucket rows by Delivery, preserving insertion order. Apply skip rule D.1:
 * non-LF returns are removed from the result and added to `skipped[]`.
 *
 * Detect duplicate-delivery-header conditions (same delivery appearing in
 * non-contiguous row groups) and log `duplicate-delivery-header` warnings —
 * the rows are still merged into a single group.
 */
export function groupRows(rows: RawSapRow[]): GroupRowsResult {
  const groupMap = new Map<string, RawSapRow[]>();
  const seenContiguousEnd = new Map<string, number>(); // last row number we saw contiguously
  const duplicateDeliveries = new Set<string>();

  for (const r of rows) {
    if (!groupMap.has(r.delivery)) {
      groupMap.set(r.delivery, []);
    } else {
      // Already-seen delivery — check if it was contiguous up to now.
      const lastSeen = seenContiguousEnd.get(r.delivery);
      if (lastSeen !== undefined && lastSeen + 1 !== r.rowNumber) {
        duplicateDeliveries.add(r.delivery);
      }
    }
    groupMap.get(r.delivery)!.push(r);
    seenContiguousEnd.set(r.delivery, r.rowNumber);
  }

  const warnings: Warning[] = [];
  for (const dup of Array.from(duplicateDeliveries)) {
    const rowsForDup = groupMap.get(dup)!;
    warnings.push({
      delivery:   dup,
      kind:       "duplicate-delivery-header",
      message:    `delivery ${dup} appears in non-contiguous row groups; merging and using first row's header values`,
      rowNumbers: rowsForDup.map((r: RawSapRow) => r.rowNumber),
    });
  }

  // Apply skip rule D.1 — non-LF return.
  const groups:  GroupedDelivery[] = [];
  const skipped: SkippedRow[]      = [];
  const uniqueDeliveries = new Set<string>();

  for (const [delivery, deliveryRows] of Array.from(groupMap.entries())) {
    uniqueDeliveries.add(delivery);

    // Use the first row's deliveryType as authoritative — all rows of the
    // same delivery share this in well-formed exports.
    const firstRow = deliveryRows[0];
    const deliveryType = firstRow.deliveryType ?? "";

    if (delivery.length < 10 && deliveryType !== "LF") {
      skipped.push({
        delivery,
        reason:     "non-LF return",
        rowNumbers: deliveryRows.map((r: RawSapRow) => r.rowNumber),
      });
      continue;
    }

    // Skip rule D.1b — other depot's shipping point. Checked on EVERY row,
    // not the first: buildObds stores rows[0]'s value, so a mixed delivery
    // would otherwise import under whichever row came first.
    const shippingPoints = Array.from(new Set(
      deliveryRows.map((r: RawSapRow) => (r.warehouse ?? "").trim().toUpperCase() || "(blank)"),
    ));
    if (shippingPoints.length !== 1 || shippingPoints[0] !== DEPOT_SHIPPING_POINT) {
      const rowNumbers = deliveryRows.map((r: RawSapRow) => r.rowNumber);
      const message =
        shippingPoints.length > 1
          ? `mixed shipping points ${shippingPoints.join(", ")} — only ${DEPOT_SHIPPING_POINT} bills are imported`
          : shippingPoints[0] === "(blank)"
            ? `no shipping point — only ${DEPOT_SHIPPING_POINT} bills are imported`
            : `shipping point ${shippingPoints[0]} — only ${DEPOT_SHIPPING_POINT} bills are imported`;
      skipped.push({ delivery, reason: "other depot shipping point", rowNumbers });
      warnings.push({ delivery, kind: "foreign-shipping-point", message, rowNumbers });
      continue;
    }

    groups.push({ delivery, rows: deliveryRows });
  }

  return { groups, skipped, warnings, uniqueDeliveries };
}
