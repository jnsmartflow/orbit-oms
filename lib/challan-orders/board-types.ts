// lib/challan-orders/board-types.ts
//
// The wire shapes of the shared Challan orders screen (Challan orders slice 5,
// 2026-10-07). Types + one pure helper only — imported by the server loaders
// (lib/challan-orders/board.ts), the routes and the client component, so the
// three can never drift.

/** One SO pasted against a challan (challan_order_so_links). */
export interface ChallanLinkRow {
  id: number;
  soNumber: string;
  /** 'waiting' | 'linked' | 'unlinked' (chk_challan_order_so_links_status). */
  status: "waiting" | "linked" | "unlinked";
  linkedAt: string;
  linkedByName: string | null;
  /** When the SAP OBD was linked (slice 6); null while waiting. */
  obdLinkedAt: string | null;
  /** The linked SAP OBD (slice 6); null while waiting. */
  obdNumber: string | null;
  invoiceNo: string | null;
  tins: number | null;
  unlinkedAt: string | null;
  unlinkedByName: string | null;
}

/** History's status chip — first match wins (plan §1.2). */
export type ChallanStatus = "cancelled" | "billed" | "waiting" | "sent" | "in_picking";

/** A SAP bill billed against this challan (orders.challanOrderId — slice 6). Every OBD of
 *  every SO, so part-billing (M6) lists them all; a cancelled one stays as history. */
export interface ChallanLinkedObd {
  orderId: number;
  obdNumber: string;
  soNumber: string | null;
  invoiceNo: string | null;
  /** 'challan_linked' (live) or 'cancelled'. */
  workflowStage: string;
  tins: number | null;
}

export interface ChallanRow {
  orderId: number;
  orbNumber: string;
  billToName: string;
  billToCode: string;
  billToArea: string | null;
  /** The dealer the truck goes to when it is not the bill-to; null = same as billing. */
  shipToName: string | null;
  shipToCode: string | null;
  shipToArea: string | null;
  tins: number | null;
  litres: number | null;
  workflowStage: string;
  /** On a NON-cancelled trip: its number and date (YYYY-MM-DD). */
  tripNumber: string | null;
  tripDate: string | null;
  createdAt: string;
  /** Days since the trip date (else creation), IST calendar days (M7). Never negative. */
  ageDays: number;
  ageAnchor: "trip" | "created";
  status: ChallanStatus;
  /** Working tabs: waiting + linked only. History: every row, unlinked included. */
  links: ChallanLinkRow[];
  /** The SAP bills linked to this challan (slice 6). */
  linkedObds: ChallanLinkedObd[];
  /** The live line match (slice 7) — set on BILLED rows only; null = no chip
   *  (not billed, waiting / part-billed, cancelled). lib/challan-orders/line-match.ts. */
  match: ChallanLineMatch | null;
}

/** One material of the line match (slice 7). diff = sapTins − challanTins. */
export interface ChallanMatchLine {
  material: string;
  product: string;
  challanTins: number;
  sapTins: number;
  diff: number;
}

/** Challan lines vs the SAP lines of every live linked OBD, by material code + tins (D12). */
export interface ChallanLineMatch {
  /** ✅ — every material's tins are equal. */
  ok: boolean;
  /** Materials whose tins differ (the "⚠ N lines differ" count). */
  differing: number;
  challanTins: number;
  sapTins: number;
  /** The SAP OBDs summed (workflowStage 'challan_linked'). */
  obdNumbers: string[];
  lines: ChallanMatchLine[];
}

export interface ChallanBoard {
  notBilled: ChallanRow[];
  waiting: ChallanRow[];
  billed: ChallanRow[];
  counts: { notBilled: number; waiting: number; billed: number };
  /** The oldest Not billed row's age, or null when none. */
  oldestNotBilledDays: number | null;
}

export interface ChallanHistory {
  rows: ChallanRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** F3: neutral < 3 days, amber 3–6, red ≥ 7. One owner for every mount. */
export function ageTone(days: number): "neutral" | "amber" | "red" {
  if (days >= 7) return "red";
  if (days >= 3) return "amber";
  return "neutral";
}

/** POST /api/challan-orders/links body. */
export interface PasteSoRequest {
  orbOrderId: number;
  soNumber: string;
  /** S5-2: true on the second request, after the user pressed "Link anyway". */
  confirmDealerMismatch?: boolean;
  /** S6-5: true after "Link anyway" on the Telephonic-tag warning. */
  confirmTelephonic?: boolean;
}

export type PasteSoResponse =
  | {
      ok: true;
      linkId: number;
      /** The late-paste safety net's result (slice 6). */
      reconcile: {
        caught: string[];
        held: string[];
        touched: { obdNumber: string; reason: string }[];
        failed: { obdNumber: string; error: string }[];
      } | null;
    }
  | { ok: false; warning: true; code: "DEALER_MISMATCH" | "TELEPHONIC_TAG"; error: string }
  | { ok: false; warning?: false; code: string; error: string };
