// lib/floor/detail-scope.ts — THE DETAIL PANEL, SCOPED TO ONE INVOICE (Add
// invoices Phase 4 commit 3, 2026-10-13). PURE: no Prisma, no React, no clock.
// Tests: lib/floor/detail-scope.test.ts (npx tsx --test lib/floor/detail-scope.test.ts).
//
// A split OBD draws one Floor row per invoice (floor-table.tsx). Opening the
// panel from one of those rows opens it SCOPED to that invoice — the panel's key
// is (orderId, invoiceSeq). An unsplit OBD, and every panel opened from On hold,
// Cancel & CI or History, has invoiceSeq null: the OBD view, as before.

/** What the panel is open on. invoiceSeq null = the whole OBD. */
export interface DetailKey {
  orderId: number;
  invoiceSeq: number | null;
}

import { drawOrderOf } from "./invoice-rows";

type Walkable = {
  orderId: number;
  /** id / loadRootId: Split load — a part walks right after its paper. */
  invoiceRows?: ReadonlyArray<{ seq: number; id?: number; loadRootId?: number }>;
  /** A NARROWED row's every invoice (the On hold tab's held ones, 6.1). */
  invoiceRowsAll?: ReadonlyArray<{ seq: number }>;
};

const isSplit = (rows: ReadonlyArray<{ seq: number }> | undefined) => (rows?.length ?? 0) > 1;
/** Split by the OBD's own count — a narrowed row with ONE invoice drawn is still split. */
const isSplitRow = (r: Walkable) => isSplit(r.invoiceRowsAll ?? r.invoiceRows);

/**
 * The list Prev / Next walks, in board order: a split OBD gives one key per
 * invoice (seq order — the order the table draws them), anything else one key
 * for the OBD. So 716 → 713 → 714 → 715 → the next bill.
 */
/** The table's draw order (parts under their paper); seq order — the same
 *  array — when the OBD has no Split load row. */
function walkOrder<R extends { seq: number; id?: number; loadRootId?: number }>(rows: readonly R[]): readonly R[] {
  if (!rows.some((i) => i.loadRootId !== undefined)) return rows;
  return drawOrderOf(rows.map((i) => ({ ...i, id: i.id ?? -i.seq })));
}

export function detailWalk(rows: readonly Walkable[], perInvoice = true): DetailKey[] {
  return rows.flatMap((r): DetailKey[] =>
    perInvoice && isSplitRow(r) && (r.invoiceRows?.length ?? 0) > 0
      ? walkOrder(r.invoiceRows ?? []).map((i) => ({ orderId: r.orderId, invoiceSeq: i.seq }))
      : [{ orderId: r.orderId, invoiceSeq: null }],
  );
}

/**
 * The scope the panel really shows. A requested invoice that is not there any
 * more (an undo or an edit removed it, or the bill is no longer split), or a
 * source that never scopes, falls back to the OBD view.
 */
export function resolveScope(
  key: DetailKey,
  invoiceRows: ReadonlyArray<{ seq: number }> | undefined,
  scopable: boolean,
): DetailKey {
  if (!scopable || key.invoiceSeq === null || !isSplit(invoiceRows)) return { orderId: key.orderId, invoiceSeq: null };
  return invoiceRows!.some((i) => i.seq === key.invoiceSeq) ? key : { orderId: key.orderId, invoiceSeq: null };
}

/** Where `key` sits in `list` — exact first, then (an OBD-view key) the OBD's first entry; -1 = not listed. */
export function walkIndex(list: readonly DetailKey[], key: DetailKey): number {
  const exact = list.findIndex((k) => k.orderId === key.orderId && k.invoiceSeq === key.invoiceSeq);
  if (exact >= 0 || key.invoiceSeq !== null) return exact;
  return list.findIndex((k) => k.orderId === key.orderId);
}

/** The panel's "Other invoices" line: every OTHER invoice of the OBD, seq order,
 *  with the last 3 digits as its label (the full number goes on the hover). */
export function otherInvoices(
  invoiceRows: ReadonlyArray<{ seq: number; invoiceNo: string | null }>,
  seq: number,
): Array<{ seq: number; invoiceNo: string | null; label: string }> {
  return invoiceRows
    .filter((i) => i.seq !== seq)
    .map((i) => ({ seq: i.seq, invoiceNo: i.invoiceNo, label: i.invoiceNo ? i.invoiceNo.slice(-3) : `#${i.seq}` }));
}

/** One Items-tab line, the shape the panel already renders (FloorDetailLine). */
export interface ScopableLine {
  /** import_raw_line_items.id — the invoice lines point at it. */
  id: number;
  qty: number;
  litres: number;
}

/**
 * ONE invoice's lines, matched by RAW LINE ID: each OBD line that is on the
 * invoice, with the invoice's tins and its litres pro rata. Board (OBD) line
 * order is kept. `missing` = invoice lines whose raw line is no longer active
 * (SAP removed it) — the "lines changed in SAP" case.
 */
export function scopeItems<L extends ScopableLine>(
  lines: readonly L[],
  invoiceLines: ReadonlyArray<{ rawLineItemId: number; qty: number }>,
): { lines: L[]; missing: number } {
  const qtyById = new Map<number, number>();
  for (const il of invoiceLines) qtyById.set(il.rawLineItemId, (qtyById.get(il.rawLineItemId) ?? 0) + il.qty);
  const known = new Set(lines.map((l) => l.id));
  const out = lines
    .filter((l) => qtyById.has(l.id))
    .map((l) => {
      const qty = qtyById.get(l.id)!;
      return { ...l, qty, litres: l.qty > 0 ? (l.litres * qty) / l.qty : 0 };
    });
  const missing = Array.from(qtyById.keys()).filter((id) => !known.has(id)).length;
  return { lines: out, missing };
}

/**
 * The Activity rule (owner, 2026-10-13): an entry belongs to SOME invoices only
 * when it names their invoice-row ids in a STRUCTURED field (`orderInvoiceIds`,
 * order_status_logs v27.72 — one press of 716 + 714 names both); an entry with
 * none is OBD-wide and shows on every invoice. Never a note match. Writer:
 * lib/order-invoices/hold.ts (6.1).
 */
export function activityForInvoice<E extends { orderInvoiceIds?: readonly number[] }>(entries: readonly E[], invoiceRowId: number): E[] {
  return entries.filter((e) => (e.orderInvoiceIds?.length ?? 0) === 0 || e.orderInvoiceIds!.includes(invoiceRowId));
}

// ── THE PANEL'S HOLD / RELEASE, SCOPED (Add invoices 6.1 fix, 2026-10-19) ───
//
// A panel scoped to ONE invoice of a SPLIT OBD holds / releases THAT invoice
// row only — POST /api/floor/actions hold | unhold with invoiceRowIds
// (lib/order-invoices/hold.ts), the bottom bar's rules, refusals and log. An
// unscoped or unsplit panel acts on the whole OBD exactly as before.

/** The invoice row the panel acts on, or null = the whole OBD. */
export function scopedInvoiceRowId(
  invoiceSeq: number | null,
  invoiceRows: ReadonlyArray<{ id: number; seq: number }>,
): number | null {
  if (invoiceSeq === null || invoiceRows.length < 2) return null;
  return invoiceRows.find((r) => r.seq === invoiceSeq)?.id ?? null;
}

/** The actions-route body for the panel's Hold / Release of a scoped invoice. */
export function scopedHoldBody(
  action: "hold" | "unhold",
  orderId: number,
  invoiceRowId: number,
): { action: "hold" | "unhold"; orderIds: number[]; invoiceRowIds: Record<number, number[]> } {
  return { action, orderIds: [orderId], invoiceRowIds: { [orderId]: [invoiceRowId] } };
}
