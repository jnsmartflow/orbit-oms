import type { PickingQueueRow, SortRule } from "./types";

// Fixed locale so alphabetical ordering is identical on the depot PC and on
// Vercel, regardless of either machine's OS locale.
const LOCALE = "en";

function compareNullableNumberAsc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function compareNullableStringAsc(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b, LOCALE, { sensitivity: "base" });
}

// Locked. Delivery type is NOT a Postgres enum and its role_master-style ids
// are not sort order — this is the deliberate depot-priority ranking.
export const DELIVERY_TYPE_ORDER: Record<string, number> = {
  Local: 1,
  Upcountry: 2,
  Cross: 3,
  IGT: 4,
};
const UNKNOWN_DELIVERY_TYPE_ORDER = 9;

function deliveryTypeRank(deliveryType: string | null): number {
  if (deliveryType === null) return UNKNOWN_DELIVERY_TYPE_ORDER;
  return DELIVERY_TYPE_ORDER[deliveryType] ?? UNKNOWN_DELIVERY_TYPE_ORDER;
}

const DEFAULT_PRIORITY_LEVEL = 3;

export const byWindow: SortRule = {
  key: "window",
  label: "Dispatch window",
  compare: (a, b) => compareNullableNumberAsc(a.windowSortOrder, b.windowSortOrder),
};

export const byDeliveryType: SortRule = {
  key: "deliveryType",
  label: "Delivery type",
  compare: (a, b) => deliveryTypeRank(a.deliveryType) - deliveryTypeRank(b.deliveryType),
};

export const byRoute: SortRule = {
  key: "route",
  label: "Route",
  compare: (a, b) => compareNullableStringAsc(a.route, b.route),
};

export const byArea: SortRule = {
  key: "area",
  label: "Area",
  compare: (a, b) => compareNullableStringAsc(a.area, b.area),
};

export const byPriority: SortRule = {
  key: "priority",
  label: "Priority",
  compare: (a, b) => {
    const pa = a.priorityLevel ?? DEFAULT_PRIORITY_LEVEL;
    const pb = b.priorityLevel ?? DEFAULT_PRIORITY_LEVEL;
    return pa - pb;
  },
};

export const byKeyCustomer: SortRule = {
  key: "keyCustomer",
  label: "Key customer",
  compare: (a, b) => Number(b.isKeyCustomer) - Number(a.isKeyCustomer),
};

export const PICKING_SPINE: SortRule[] = [
  byWindow,
  byDeliveryType,
  byRoute,
  byArea,
  byPriority,
  byKeyCustomer,
];

/**
 * Pure sort — copies before sorting, never mutates `rows`. Walks `rules` in
 * order; the first non-zero comparison wins. Falls back to obdNumber ASC so
 * the result is always fully deterministic. Callers can pass any rule list
 * (add/remove/reorder) with no change needed here.
 */
export function sortPickingQueue(
  rows: PickingQueueRow[],
  rules: SortRule[] = PICKING_SPINE,
): PickingQueueRow[] {
  return [...rows].sort((a, b) => {
    for (const rule of rules) {
      const result = rule.compare(a, b);
      if (result !== 0) return result;
    }
    return a.obdNumber.localeCompare(b.obdNumber, LOCALE, { sensitivity: "base" });
  });
}
