// lib/challan-orders/types.ts
//
// The wire shape of POST /api/place-order/challan-orders (Challan orders slice 3,
// 2026-10-07). Types only — imported by the route, lib/challan-orders/create.ts
// and the /place-order page, so the three can never drift.

/** Ship-to, phase 1 (owner S3-3): the bill-to dealer, or another dealer from master. Typed site is PARKED. */
export type ChallanShipTo = { mode: "same" } | { mode: "dealer"; customerCode: string };

/** Normal or Urgent only — Call is refused (owner S3-2). */
export type ChallanDispatch = "Normal" | "Urgent";

export type ChallanMarker = "Truck" | "Cross Delivery" | "Bounce" | "DTS" | null;

export interface ChallanLineInput {
  /** mo_order_form_index_v2.id — the grid row the operator keyed. */
  productId: number;
  /** The pack exactly as the grid cell held it (CartLine.packQtys key). */
  packCode: string;
  unit: string | null;
  /** The SAP material the grid's own pack carried (RawPack.material) — re-checked on the server. */
  material: string;
  /** Units (tins / bags / pieces), a positive integer. */
  tins: number;
}

export interface CreateChallanOrderRequest {
  customerCode: string;
  shipTo: ChallanShipTo;
  dispatch: ChallanDispatch;
  marker: ChallanMarker;
  crossDepot: string | null;
  notes: string;
  lines: ChallanLineInput[];
}

export type CreateChallanOrderErrorCode =
  | "BAD_REQUEST"
  | "CALL_NOT_ALLOWED"
  | "CUSTOMER_NOT_FOUND"
  | "SHIP_TO_NOT_FOUND"
  | "NO_LINES"
  | "BAD_QTY"
  | "UNKNOWN_PRODUCT"
  | "UNRESOLVED_LINE"
  | "NUMBER_BUSY"
  | "WRITE_FAILED";

export type CreateChallanOrderResponse =
  | { ok: true; orderId: number; orbNumber: string; lines: number; tins: number; litres: number }
  | { ok: false; code: CreateChallanOrderErrorCode; error: string };
