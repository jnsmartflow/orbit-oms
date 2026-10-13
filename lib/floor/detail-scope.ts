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

type Walkable = { orderId: number; invoiceRows?: ReadonlyArray<{ seq: number }> };

const isSplit = (rows: ReadonlyArray<{ seq: number }> | undefined) => (rows?.length ?? 0) > 1;

/**
 * The list Prev / Next walks, in board order: a split OBD gives one key per
 * invoice (seq order — the order the table draws them), anything else one key
 * for the OBD. So 716 → 713 → 714 → 715 → the next bill.
 */
export function detailWalk(rows: readonly Walkable[], perInvoice = true): DetailKey[] {
  return rows.flatMap((r): DetailKey[] =>
    perInvoice && isSplit(r.invoiceRows)
      ? (r.invoiceRows ?? []).map((i) => ({ orderId: r.orderId, invoiceSeq: i.seq }))
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
 * The Activity rule (owner, 2026-10-13): an entry belongs to ONE invoice only
 * when it carries an invoice-row id in a STRUCTURED field (`orderInvoiceId`);
 * everything else is OBD-wide and shows on every invoice. Never a note match.
 * (No writer sets the field yet — every entry is OBD-wide today.)
 */
export function activityForInvoice<E extends { orderInvoiceId?: number | null }>(entries: readonly E[], invoiceRowId: number): E[] {
  return entries.filter((e) => e.orderInvoiceId === undefined || e.orderInvoiceId === null || e.orderInvoiceId === invoiceRowId);
}
