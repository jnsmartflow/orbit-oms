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
}

export type SortRule = {
  key: string;
  label: string;
  compare: (a: PickingQueueRow, b: PickingQueueRow) => number;
};
