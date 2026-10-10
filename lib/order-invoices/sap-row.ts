// lib/order-invoices/sap-row.ts — THE SEQ-1 'sap' ROW (Add invoices, Phase 1,
// 2026-10-10, Schema v27.63, sql/2026-10-10-order-invoices-ddl.sql).
//
// MODEL A: EVERY order has an order_invoices row at seq 1, source 'sap', that
// MIRRORS orders.invoiceNo / orders.invoiceDate. This file is the ONE writer of
// that mirror. It is called wherever an order is created and wherever
// orders.invoiceNo / invoiceDate is filled:
//   · createSapInvoiceRows        — lib/import-upsert.ts createPath,
//                                   lib/challan-orders/create.ts
//   · createSapInvoiceRowsForObds — app/api/import/obd/route.ts (manual
//                                   template + auto-import, after createMany)
//   · syncSapInvoiceRow           — patch-headers (route.ts) and
//                                   lib/import-upsert/header.ts applyHeaderPatch
//
// 🔴 THE MIRROR IS READ FROM `orders`, NEVER PASSED IN. Every function here runs
// AFTER the orders write and copies what the database actually holds — so the
// seq-1 row cannot disagree with a value a caller computed but did not store.
//
// 🔴 NULL-ONLY, THE SAME RULE AS ON orders. A field is filled only while the
// seq-1 row's copy is NULL; a non-null number is never overwritten, and a
// 'manual' row is never touched (seq 1 is always 'sap', the source filter
// says so twice).
//
// ⚠ NEVER THROWS. The order is already written when these run; failing the
// import now would strand a live bill with an error response, and the
// PowerShell would not resend an OBD that already exists. A failure is logged
// with the [order-invoices] tag and repaired by re-running PART 3 of the DDL
// file (idempotent). Nothing reads these rows yet in Phase 1.
//
// Sequential awaits only — never prisma.$transaction (CORE §3).

// Relative, like lib/import-upsert/* which imports this file.
import { prisma } from "../prisma";

const SAP_SEQ = 1;
const SOURCE_SAP = "sap";

/** chk_order_invoices_no_not_blank refuses a blank number; store NULL instead. */
function cleanInvoiceNo(v: string | null): string | null {
  if (v === null) return null;
  return v.trim() === "" ? null : v;
}

/**
 * Create the seq-1 row for each order that has none. Re-runnable: an order that
 * already has seq 1 is skipped by the (orderId, seq) unique.
 */
export async function createSapInvoiceRows(orderIds: number[]): Promise<void> {
  if (orderIds.length === 0) return;
  try {
    const orders = await prisma.orders.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, invoiceNo: true, invoiceDate: true },
    });
    await prisma.order_invoices.createMany({
      data: orders.map((o) => ({
        orderId: o.id,
        invoiceNo: cleanInvoiceNo(o.invoiceNo),
        invoiceDate: o.invoiceDate,
        seq: SAP_SEQ,
        source: SOURCE_SAP,
        createdById: null,
      })),
      skipDuplicates: true,
    });
  } catch (err) {
    console.error(`[order-invoices] seq-1 create failed for ${orderIds.length} order(s) — re-run PART 3`, err);
  }
}

/** Same, for a createMany caller that holds OBD numbers, not ids. */
export async function createSapInvoiceRowsForObds(obdNumbers: string[]): Promise<void> {
  if (obdNumbers.length === 0) return;
  try {
    const orders = await prisma.orders.findMany({
      where: { obdNumber: { in: obdNumbers } },
      select: { id: true },
    });
    await createSapInvoiceRows(orders.map((o) => o.id));
  } catch (err) {
    console.error(`[order-invoices] seq-1 create failed for ${obdNumbers.length} OBD(s) — re-run PART 3`, err);
  }
}

/**
 * After orders.invoiceNo / invoiceDate was filled: copy each field into the
 * seq-1 'sap' row where that row's copy is still NULL. Creates the row first if
 * it is missing (an order made before this code deployed).
 */
export async function syncSapInvoiceRow(orderId: number): Promise<void> {
  try {
    await createSapInvoiceRows([orderId]);
    const order = await prisma.orders.findUnique({
      where: { id: orderId },
      select: { invoiceNo: true, invoiceDate: true },
    });
    if (!order) return;
    const invoiceNo = cleanInvoiceNo(order.invoiceNo);
    if (invoiceNo !== null) {
      await prisma.order_invoices.updateMany({
        where: { orderId, seq: SAP_SEQ, source: SOURCE_SAP, invoiceNo: null },
        data: { invoiceNo },
      });
    }
    if (order.invoiceDate !== null) {
      await prisma.order_invoices.updateMany({
        where: { orderId, seq: SAP_SEQ, source: SOURCE_SAP, invoiceDate: null },
        data: { invoiceDate: order.invoiceDate },
      });
    }
  } catch (err) {
    console.error(`[order-invoices] seq-1 sync failed for order ${orderId} — re-run PART 3`, err);
  }
}
