// Picking queue row shape — all fields already resolved upstream (route/area/
// key-customer/dealer come from the effective ship-to dealer, per step 1
// discovery). This module does no joining and no DB access.
export interface PickingQueueRow {
  orderId: number;
  obdNumber: string;
  dealerName: string;
  isShipToOverride: boolean;
  windowId: number | null;
  windowTime: string | null;
  windowSortOrder: number | null;
  deliveryType: string | null;
  route: string | null;
  area: string | null;
  priorityLevel: number | null;
  isKeyCustomer: boolean;
  articleTag: string | null;
  volumeLitres: number | null;
  weightKg: number | null;
  obdDateTime: Date | string | null;
  isAssigned: boolean;
  assignedAt: Date | string | null;
  assignedToName: string | null;
  // Vehicle-ready route rule (web-update-2026-07-12-picking-queue-v1-design-locked.md).
  // Computed per (windowId, deliveryType, route) over LOCAL rows only — assigned + waiting
  // both count toward the 950kg threshold. Never true for non-Local or no-route rows.
  isReadyRoute: boolean;
  routeReadyWeightKg: number;
  // Sort-support only, not for direct display — MIN(obdDateTime) across the ready route's
  // rows, used solely to order multiple ready routes FIFO-consistently in sort.ts.
  readyRouteEarliestDateTime: Date | string | null;
}

export type SortRule = {
  key: string;
  label: string;
  compare: (a: PickingQueueRow, b: PickingQueueRow) => number;
};
