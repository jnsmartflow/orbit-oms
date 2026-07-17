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
  // True at exactly PICK_DONE. Added 2026-07-17 for the picker "My Picks"
  // Done tab — NOT part of the byAssigned sort signal (isAssigned above is
  // unchanged, still strictly PICK_ASSIGNED-only). See queue.ts's WHERE
  // clause comment for the known gap this leaves in the desktop board,
  // the mobile Assign/Check tabs, and lib/picking/sort.ts once PICK_DONE
  // starts being written.
  isDone: boolean;
  assignedAt: Date | string | null;
  // Numeric FK, added 2026-07-17 for server-side "my bills only" scoping
  // (picker "My Picks") — a display-name match is not a scope boundary.
  // null when the row has no pick_assignments row at all.
  pickerId: number | null;
  assignedToName: string | null;
  assignedByName: string | null;
}

export type SortRule = {
  key: string;
  label: string;
  compare: (a: PickingQueueRow, b: PickingQueueRow) => number;
};
