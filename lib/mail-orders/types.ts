export type MatchStatus = "matched" | "partial" | "unmatched";
export type OrderStatus = "pending" | "punched";

export interface MoOrderLine {
  id: number;
  moOrderId: number;
  lineNumber: number;
  rawText: string;
  packCode: string | null;
  quantity: number;
  productName: string | null;
  baseColour: string | null;
  skuCode: string | null;
  skuDescription: string | null;
  refSkuCode: string | null;
  matchStatus: MatchStatus;
  createdAt: string;
}

export interface MoOrder {
  id: number;
  soName: string;
  soEmail: string;
  receivedAt: string;
  subject: string;
  customerName: string | null;
  customerCode: string | null;
  deliveryRemarks: string | null;
  remarks: string | null;
  billRemarks: string | null;
  status: OrderStatus;
  punchedById: number | null;
  punchedAt: string | null;
  punchedBy: { name: string } | null;
  emailEntryId: string;
  totalLines: number;
  matchedLines: number;
  createdAt: string;
  lines: MoOrderLine[];
}

export interface MoOrdersResponse {
  orders: MoOrder[];
  date: string;
  totalOrders: number;
  totalLines: number;
  matchedLines: number;
  punchedOrders: number;
}
