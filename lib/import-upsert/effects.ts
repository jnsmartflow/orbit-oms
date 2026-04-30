// lib/import-upsert/effects.ts
//
// Predicate-driven side-effect builder. Pure: no DB access.
// Caller iterates the returned DownstreamEffect[] and dispatches each effect
// to the appropriate existing function (applyMailOrderEnrichment, challan
// auto-creation, query summary rebuild, etc.). upsertObd never fires effects
// itself — keeps the utility unit-testable and the caller in control of
// ordering/error handling.

import {
  CHALLAN_ELIGIBLE_SMU,
  DownstreamEffect,
  HeaderPatchEntry,
  LinePatchPlan,
} from "./types";

export interface BuildEffectsArgs {
  orderId:                 number;
  obdNumber:               string;
  outcome:                 "created" | "patched";
  headerEntries:           HeaderPatchEntry[];
  linePlan:                LinePatchPlan;
  finalSmu:                string | null;
  finalSoNumber:           string | null;
  finalActiveLineCount:    number;
  customerResolved:        boolean;
  resolvedCustomerId:      number | null;
  existingOrderType:       string | null;
  incomingLinesHasTinting: boolean;
}

/**
 * Inspect the upsert outcome and produce the list of downstream effects the
 * caller should fire. Effects emitted:
 *
 * - mail-order-enrichment   — soNumber transitioned to non-null.
 * - challan-create          — smu transitioned to a challan-eligible value
 *                             AND active-line-count ≥ 1 (carries Step 1's
 *                             GUARD 3 lesson forward).
 * - query-summary-rebuild   — any active line set or header total changed.
 * - customer-resolved       — customerMissing flipped true → false.
 * - order-type-mismatch     — patch path only; informational signal that
 *                             incoming lines suggest a different orderType
 *                             (existing flow does not flip orderType, so the
 *                             caller decides whether to alert/queue/ignore).
 */
export function buildEffects(a: BuildEffectsArgs): DownstreamEffect[] {
  const e: DownstreamEffect[] = [];
  const headerFieldChanged = (field: string) =>
    a.headerEntries.some((entry) => entry.field === field);

  const soNumberChanged = a.outcome === "created" || headerFieldChanged("soNumber");
  if (soNumberChanged && a.finalSoNumber) {
    e.push({ type: "mail-order-enrichment", orderId: a.orderId, payload: { soNumber: a.finalSoNumber } });
  }

  const smuChanged = a.outcome === "created" || headerFieldChanged("smu");
  if (
    smuChanged &&
    a.finalSmu &&
    CHALLAN_ELIGIBLE_SMU.includes(a.finalSmu) &&
    a.finalActiveLineCount > 0
  ) {
    e.push({ type: "challan-create", orderId: a.orderId, payload: { obdNumber: a.obdNumber } });
  }

  const linesChanged =
    a.linePlan.adds.length     > 0 ||
    a.linePlan.patches.length  > 0 ||
    a.linePlan.removes.length  > 0 ||
    a.linePlan.restores.length > 0;
  const headerTotalsChanged = ["grossWeight", "volume", "totalUnitQty"].some(headerFieldChanged);
  if (a.outcome === "created" || linesChanged || headerTotalsChanged) {
    e.push({ type: "query-summary-rebuild", orderId: a.orderId, payload: { obdNumber: a.obdNumber } });
  }

  if (a.customerResolved && a.resolvedCustomerId !== null) {
    e.push({ type: "customer-resolved", orderId: a.orderId, payload: { customerId: a.resolvedCustomerId } });
  }

  if (a.outcome === "patched" && a.existingOrderType) {
    const incomingType = a.incomingLinesHasTinting ? "tint" : "non_tint";
    if (a.existingOrderType !== incomingType) {
      e.push({
        type: "order-type-mismatch", orderId: a.orderId,
        payload: { currentType: a.existingOrderType, incomingType },
      });
    }
  }

  return e;
}
