// lib/challan-orders/where.ts
//
// The Prisma where-fragments that keep challan rows OFF a billing surface
// (Challan orders slice 2b, 2026-10-06). One owner each; plain objects, no imports
// beyond the stage owner, so any server module can spread them.
//
//   ORB order        — orders.isChallanOrder = true (the challan itself; nothing to invoice).
//   Linked SAP bill  — workflowStage 'challan_linked' (NOT_CHALLAN_LINKED, lib/workflow-stages.ts).
//
// Both columns are NOT NULL (isChallanOrder DEFAULT false), so neither needs a
// null arm (CORE §13).

import { NOT_CHALLAN_LINKED } from "@/lib/workflow-stages";

/** Not an ORB order. */
export const NOT_CHALLAN_ORDER = { isChallanOrder: false };

/**
 * A bill billing works on: neither an ORB order nor a SAP bill linked to one.
 * Used by the Print tab (lib/billing/print.ts loadPrintTrips). Its raw-SQL twin
 * is written out in getPrintWorkTripIds beside it.
 */
export const BILLABLE_BILL_WHERE = { ...NOT_CHALLAN_ORDER, ...NOT_CHALLAN_LINKED };
