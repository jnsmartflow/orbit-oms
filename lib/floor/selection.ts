// Floor Control — selection state helpers (design §7.8). Pure, no React, no DB.
//
// Selection is a Set of orderIds, so it SURVIVES a re-sort by construction (it
// keys on identity, not row position). It does NOT survive a tab change — the
// page clears it there.
//
// TWO FAMILIES, and which one a surface uses is the whole question:
//
//   isSelectable / selectableIds / isAllSelected / toggleAll
//       Selectable = Waiting OR With-picker only (§7.8: "Checkboxes on Waiting
//       and With picker only. Past that the material is off the shelf.") —
//       i.e. !isDone && !isChecked.
//
//       🔴 THE FLOOR TABLE NO LONGER USES THESE (2026-09-10 d). That rule was
//       written when selecting a bill meant HANDING IT TO A PICKER, where a
//       Done bill is genuinely not a candidate. The desk does not assign
//       pickers any more; selecting a bill means putting it on a TRIP, and trip
//       membership was never stage-gated (schema decision record §2: "a bill
//       can join a trip at ANY workflowStage"). A checked, invoiced bill is the
//       MOST loadable thing on the board, and this rule made it the one thing
//       that could not be loaded.
//
//       They are kept, unchanged and uncalled, rather than widened: their
//       contract is a real one that a future picker-facing surface would want,
//       and turning isSelectable into an always-true test would leave four
//       functions that are duplicates of the two below. Archiving is not this
//       step.
//
//   isAllIdsSelected / toggleAllIds
//       Every row is selectable, by plain id. Written for Hold and Cancelled,
//       which have no "off the shelf" cutoff — and now what the floor table
//       reads too, for the same reason.
//
// ⚠ toggleAll AND toggleAllIds SHARE ONE CONTRACT and it is unchanged by any of
// this: PER GROUP (each table/band owns its own header checkbox and never
// touches another band's ticks) and SELECT-ALL-ON-PARTIAL (a partly-ticked
// group fills, it does not clear). Only the eligibility filter differs.

export type FloorSelection = Set<number>;

type SelectableRow = { orderId: number; isDone: boolean; isChecked: boolean };

export function isSelectable(row: Pick<SelectableRow, "isDone" | "isChecked">): boolean {
  return !row.isDone && !row.isChecked;
}

export function selectableIds(rows: SelectableRow[]): number[] {
  return rows.filter(isSelectable).map((r) => r.orderId);
}

export function toggleOne(sel: FloorSelection, id: number): FloorSelection {
  const next = new Set(sel);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// Header checkbox is "on" only when EVERY selectable row in this table/band is
// selected (and there is at least one) — a band with nothing selectable is not
// "all selected".
export function isAllSelected(sel: FloorSelection, rows: SelectableRow[]): boolean {
  const ids = selectableIds(rows);
  return ids.length > 0 && ids.every((id) => sel.has(id));
}

// Toggle every selectable row in THIS table/band (design §7.8: on All each band
// has its own header checkbox). Adds all when not all-selected, clears them
// otherwise; other tables' selections are untouched (the Set carries them).
export function toggleAll(sel: FloorSelection, rows: SelectableRow[]): FloorSelection {
  const ids = selectableIds(rows);
  const next = new Set(sel);
  if (isAllSelected(sel, rows)) {
    for (const id of ids) next.delete(id);
  } else {
    for (const id of ids) next.add(id);
  }
  return next;
}

// ── The Floor DESK selection: bills AND re-deliveries (2026-10-03) ───────────
//
// 🔴 A RE-DELIVERY ROW IS KEYED `rd:<redeliveryId>`, NEVER BY ITS orderId.
// Its row is the bill's own FloorTable row (lib/trips/queries.ts
// TripRedeliveryRow.row), and that row's orderId / tripDropId / tripNumber
// belong to the bill's FIRST trip. A plain-id tick would reach every bill action
// on the desk — Remove from trip would post it to the FIRST trip and take the
// bill off the load it really went on (plan rev 5 §4.3). Every desk consumer
// resolves ticks against BOARD rows by numeric orderId, so an `rd:` key can
// never match one; only the re-delivery remove path reads them (isRdKey).
//
// Hold, Cancelled, Freight Trips and Billing keep the plain FloorSelection
// above — they never draw a re-delivery.

export type RdKey = `rd:${number}`;
/** One invoice of a SPLIT OBD — `inv:<order_invoices.id>` (P5-3, below). */
export type InvKey = `inv:${number}`;
export type FloorDeskKey = number | RdKey | InvKey;
export type FloorDeskSelection = Set<FloorDeskKey>;

export function rdKey(redeliveryId: number): RdKey {
  return `rd:${redeliveryId}`;
}

export function isRdKey(key: FloorDeskKey): key is RdKey {
  return typeof key === "string" && key.startsWith("rd:");
}

export function invKey(invoiceRowId: number): InvKey {
  return `inv:${invoiceRowId}`;
}

export function isInvKey(key: FloorDeskKey): key is InvKey {
  return typeof key === "string" && key.startsWith("inv:");
}

/** The order_invoices.id inside an `inv:` key. */
export function invIdOf(key: InvKey): number {
  return Number(key.slice(4));
}

/** The trip_redeliveries.id inside an `rd:` key. */
export function rdIdOf(key: RdKey): number {
  return Number(key.slice(3));
}

/** A row's selection key: `rd:<id>` on a re-delivery row, its orderId otherwise. */
export function deskKeyOf(row: { orderId: number; redelivery?: { id: number } | null }): FloorDeskKey {
  return row.redelivery ? rdKey(row.redelivery.id) : row.orderId;
}

export function toggleDeskKey(sel: FloorDeskSelection, key: FloorDeskKey): FloorDeskSelection {
  const next = new Set(sel);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

type DeskRow = {
  orderId: number;
  redelivery?: { id: number } | null;
  /** The invoices DRAWN in this list — narrowed to a place (invoice-rows.ts narrowToPlace). */
  invoiceRows?: ReadonlyArray<{ id: number }>;
  /** Every invoice of the OBD, set only on a narrowed row. */
  invoiceRowsAll?: ReadonlyArray<{ id: number }>;
};

// ── PER-INVOICE TICKS (Add invoices P5-3, 2026-10-17, owner) ────────────────
//
// 🔴 A SPLIT OBD IS TICKED BY INVOICE, `inv:<order_invoices.id>` — never by its
// orderId. The invoice ROW is the dispatch unit (Schema v27.66), so ticking one
// drawn invoice row ticks THAT invoice and nothing else. A header / select-all /
// ship-to block tick takes every invoice DRAWN in that list (the row's
// `invoiceRows`, already narrowed to the place — a ticked invoice the planner
// cannot see is how a van leaves short). An unsplit OBD keeps its orderId key
// and a re-delivery its `rd:` key, exactly as before.
//
// `perInvoice` false = the Phase 4 rule (split OBD ticked by orderId), for a
// FloorTable whose caller does not tick invoices (Freight Trips).

/** Is this a SPLIT OBD (2+ invoices across the whole OBD)? A re-delivery row never is. */
export function isSplitObdRow(row: DeskRow): boolean {
  return !row.redelivery && (row.invoiceRowsAll ?? row.invoiceRows ?? []).length >= 2;
}

/** A row's selection keys: one per drawn invoice on a split OBD, else its one desk key. */
export function deskKeysOf(row: DeskRow, perInvoice = true): FloorDeskKey[] {
  if (perInvoice && isSplitObdRow(row)) return (row.invoiceRows ?? []).map((i) => invKey(i.id));
  return [deskKeyOf(row)];
}

/** isAllIdsSelected, by each row's DESK keys — a re-delivery row counts as its `rd:` key, a split OBD as its drawn invoices. */
export function isAllDeskSelected(sel: ReadonlySet<FloorDeskKey>, rows: DeskRow[], perInvoice = true): boolean {
  const keys = rows.flatMap((r) => deskKeysOf(r, perInvoice));
  return keys.length > 0 && keys.every((k) => sel.has(k));
}

/** toggleAllIds, by DESK keys — the header tick of a stop holding re-deliveries adds `rd:` keys. */
export function toggleAllDesk(sel: FloorDeskSelection, rows: DeskRow[]): FloorDeskSelection {
  const next = new Set(sel);
  const keys = rows.flatMap((r) => deskKeysOf(r));
  if (isAllDeskSelected(sel, rows)) {
    for (const k of keys) next.delete(k);
  } else {
    for (const k of keys) next.add(k);
  }
  return next;
}

/**
 * What a press acts on, per OBD. `invoiceRowIds` null = the WHOLE OBD (an
 * unsplit OBD, or a split one with every invoice ticked); a list = only those
 * invoice rows — the bills route's `invoiceRowIds` (app/api/floor/trips/[id]/bills).
 */
export interface SelectionUnit {
  orderId: number;
  invoiceRowIds: number[] | null;
}

type UnitRow = { orderId: number; invoiceRows?: ReadonlyArray<{ id: number }> };

/**
 * The selection as units, in `rows` order. `rows` are the FULL board rows (every
 * invoice of the OBD — never a narrowed list), so "all ticked" means all of the
 * OBD's invoices. A split OBD found by its orderId key (it was unsplit when
 * ticked) counts as whole. `rd:` keys are never units.
 */
export function selectionUnits(sel: ReadonlySet<FloorDeskKey>, rows: readonly UnitRow[]): SelectionUnit[] {
  const out: SelectionUnit[] = [];
  for (const r of rows) {
    const inv = r.invoiceRows ?? [];
    if (inv.length >= 2 && !sel.has(r.orderId)) {
      const ticked = inv.filter((i) => sel.has(invKey(i.id))).map((i) => i.id);
      if (ticked.length === 0) continue;
      out.push({ orderId: r.orderId, invoiceRowIds: ticked.length === inv.length ? null : ticked });
    } else if (sel.has(r.orderId)) {
      out.push({ orderId: r.orderId, invoiceRowIds: null });
    }
  }
  return out;
}

/** Only some of the OBD's invoices are ticked. */
export const isPartialUnit = (u: SelectionUnit): boolean => u.invoiceRowIds !== null;

/**
 * The bills route's body for these units. `invoiceRowIds` is sent ONLY when a
 * unit is partial — a selection of whole OBDs posts exactly what it always did.
 */
export function billsBodyOf(
  units: readonly SelectionUnit[],
  action: "add" | "remove",
): { orderIds: number[]; action: "add" | "remove"; invoiceRowIds?: Record<number, number[]> } {
  const partial = units.filter(isPartialUnit);
  return {
    orderIds: units.map((u) => u.orderId),
    action,
    ...(partial.length > 0
      ? { invoiceRowIds: Object.fromEntries(partial.map((u) => [u.orderId, u.invoiceRowIds as number[]])) }
      : {}),
  };
}

/**
 * The Hold / Undo body (Add invoices 6.1): every unit's OBD, and for a SPLIT
 * OBD — partial OR whole — the invoice rows it acts on, so the server holds
 * rows (lib/order-invoices/hold.ts). An unsplit OBD sends no rows and acts
 * whole, exactly as before. `rows` = the FULL board rows.
 */
export function holdBodyOf(
  units: readonly SelectionUnit[],
  rows: readonly UnitRow[],
  action: "hold" | "unhold",
): { action: "hold" | "unhold"; orderIds: number[]; invoiceRowIds?: Record<number, number[]> } {
  const rowOf = new Map(rows.map((r) => [r.orderId, r]));
  const perInvoice: Array<[number, number[]]> = [];
  for (const u of units) {
    const inv = rowOf.get(u.orderId)?.invoiceRows ?? [];
    if (inv.length >= 2) perInvoice.push([u.orderId, u.invoiceRowIds ?? inv.map((i) => i.id)]);
  }
  return {
    action,
    orderIds: units.map((u) => u.orderId),
    ...(perInvoice.length > 0 ? { invoiceRowIds: Object.fromEntries(perInvoice) } : {}),
  };
}

/**
 * Owner decision 3 (2026-10-13), narrowed since: only ADD INVOICES still needs
 * every invoice of the OBD ticked, so only it is greyed with this reason while
 * an OBD is partly ticked (floor-bottom-bar.tsx). Hold acts per invoice since
 * 6.1 (holdBodyOf above) and Raise CI since 6.3 (one CI per ticked invoice);
 * Cancel still acts on the whole OBD and the off-floor form offers it only then.
 * (Said "Cancel / Raise CI / Add invoices … disabled" until 2026-10-24.) The
 * reason, or null when nothing is partial. `invoiceCount` = that OBD's invoices.
 */
export function wholeObdReason(partials: ReadonlyArray<{ obdNumber: string; invoiceCount: number }>): string | null {
  if (partials.length === 0) return null;
  if (partials.length === 1) return `Acts on the whole OBD — tick all ${partials[0].invoiceCount} invoices`;
  return `Acts on whole OBDs — tick every invoice of ${partials.map((p) => p.obdNumber).join(", ")}`;
}

/** The orderIds a selection touches — `inv:` keys resolved through `rows` (full board rows). */
export function tickedOrderIds(sel: ReadonlySet<FloorDeskKey>, rows: readonly UnitRow[]): number[] {
  return selectionUnits(sel, rows).map((u) => u.orderId);
}

/**
 * The keys that tick these units back on — what a press leaves ticked (a Hold
 * that failed, a Cancel form's unticked lines, a load-plan card). A split OBD
 * is ticked by its invoices (all of them for a whole unit), anything else by
 * its orderId.
 */
export function unitKeys(units: readonly SelectionUnit[], rows: readonly UnitRow[]): FloorDeskKey[] {
  const byId = new Map(rows.map((r) => [r.orderId, r]));
  return units.flatMap((u): FloorDeskKey[] => {
    const inv = byId.get(u.orderId)?.invoiceRows ?? [];
    if (inv.length < 2) return [u.orderId];
    return (u.invoiceRowIds ?? inv.map((i) => i.id)).map(invKey);
  });
}

/** unitKeys for whole OBDs. */
export function keysForOrders(orderIds: readonly number[], rows: readonly UnitRow[]): FloorDeskKey[] {
  return unitKeys(orderIds.map((orderId) => ({ orderId, invoiceRowIds: null })), rows);
}

/**
 * The ticked OBDs in the order they were TICKED (a Set keeps insertion order) —
 * an `inv:` key counts for its OBD at its first invoice. `rd:` keys and ids not
 * in `rows` are left out. For the "+ New trip" type choice (lib/trips/type-choice.ts).
 */
export function orderIdsInTickOrder(sel: ReadonlySet<FloorDeskKey>, rows: readonly UnitRow[]): number[] {
  const owner = new Map<number, number>();
  const onBoard = new Set<number>();
  for (const r of rows) {
    onBoard.add(r.orderId);
    for (const i of r.invoiceRows ?? []) owner.set(i.id, r.orderId);
  }
  const out: number[] = [];
  for (const key of Array.from(sel)) {
    const id = typeof key === "number" ? key : isInvKey(key) ? owner.get(invIdOf(key)) : undefined;
    if (id !== undefined && onBoard.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

type TickRow = {
  orderId: number;
  invoiceRows?: ReadonlyArray<{ id: number; tripDropId: number | null }>;
};

/**
 * RECONCILE the ticks against fresh rows (live sync, FLOOR §5) — "drop the tick
 * on anything that changed elsewhere". `before` = the rows the ticks were made
 * on (full board rows); `after` = fresh answers by orderId: a row, or null when
 * the bill LEFT the board. An OBD missing from `after` was not asked about and
 * keeps its ticks.
 *   orderId key   dropped when the bill left, or it is split now (its invoices
 *                 are ticked one by one — a whole-OBD tick would hide that)
 *   inv: key      dropped when the bill left, the invoice is gone, or it MOVED
 *                 (its trip stop is not the one it was ticked on)
 *   rd: key       never judged here (the trip detail decides)
 * `dropped` counts OBDs, for the "N selected bills changed elsewhere" toast.
 */
export function reconcileTicks(
  sel: ReadonlySet<FloorDeskKey>,
  before: readonly TickRow[],
  after: ReadonlyMap<number, TickRow | null>,
): { next: FloorDeskSelection; dropped: number } {
  const owner = new Map<number, { orderId: number; tripDropId: number | null }>();
  for (const r of before) for (const i of r.invoiceRows ?? []) owner.set(i.id, { orderId: r.orderId, tripDropId: i.tripDropId });
  const next: FloorDeskSelection = new Set();
  const droppedObds = new Set<number>();
  for (const key of Array.from(sel)) {
    if (isRdKey(key)) {
      next.add(key);
    } else if (isInvKey(key)) {
      const id = invIdOf(key);
      const o = owner.get(id);
      const a = o ? after.get(o.orderId) : undefined;
      if (o === undefined || a === undefined) {
        next.add(key);
        continue;
      }
      const fresh = a === null ? undefined : (a.invoiceRows ?? []).find((i) => i.id === id);
      if (fresh !== undefined && fresh.tripDropId === o.tripDropId) next.add(key);
      else droppedObds.add(o.orderId);
    } else {
      const a = after.get(key);
      if (a === undefined || (a !== null && (a.invoiceRows ?? []).length < 2)) next.add(key);
      else droppedObds.add(key);
    }
  }
  return { next, dropped: droppedObds.size };
}

// ── Hold / Cancelled: every row is selectable ────────────────────────────────
// Those tabs have no "off the shelf" cutoff — a held or cancelled bill is always
// a valid target — so they select by plain id, not the isDone/isChecked rule.

type IdRow = { orderId: number };

export function isAllIdsSelected(sel: FloorSelection, rows: IdRow[]): boolean {
  return rows.length > 0 && rows.every((r) => sel.has(r.orderId));
}

// Toggle every row in THIS band. Adds all when not all-selected, else clears
// them; other bands' selections are carried by the Set.
export function toggleAllIds(sel: FloorSelection, rows: IdRow[]): FloorSelection {
  const next = new Set(sel);
  if (isAllIdsSelected(sel, rows)) {
    for (const r of rows) next.delete(r.orderId);
  } else {
    for (const r of rows) next.add(r.orderId);
  }
  return next;
}

// ── The bottom bar's count, when a selection holds an invoice pair (2026-10-08) ──
//
// "1 invoice · 2 OBDs", "3 invoices · 4 OBDs" — ONLY when the selection holds a
// MULTI-OBD invoice (a row whose invoice names another OBD). Otherwise null and
// the bar keeps its "N selected". Invoices = distinct invoice numbers; OBDs =
// every selected bill. A ticked bill with no invoice yet is not an invoice, so
// it is said apart rather than counted as one: "1 invoice + 1 not invoiced ·
// 3 OBDs". Pure; no size is assumed.

type CountRow = {
  invoiceNo: string | null;
  invoicePartners?: readonly unknown[];
  /** A split OBD's invoices (Add invoices Phase 4) — 2+ entries when split.
   *  On a PARTLY ticked OBD: only the ticked ones (narrowToInvoiceIds). */
  invoiceRows?: ReadonlyArray<{ invoiceNo: string | null; loadRootId?: number }>;
  /** Every invoice of the OBD — set only when `invoiceRows` is narrowed (P5-3). */
  invoiceRowsAll?: ReadonlyArray<{ invoiceNo: string | null; loadRootId?: number }>;
};

/** A row of a Split load group (lib/floor/invoice-rows.ts loadRootId). */
const isLoadRow = (i: { loadRootId?: number }) => i.loadRootId !== undefined;

const isSplitRow = (r: CountRow) => ((r.invoiceRowsAll ?? r.invoiceRows)?.length ?? 0) > 1;
const isPartlyTicked = (r: CountRow) =>
  r.invoiceRowsAll !== undefined && (r.invoiceRows?.length ?? 0) < r.invoiceRowsAll.length;

// ── ADD INVOICES (Phase 4 commit 2, 2026-10-13, owner) ──────────────────────
// When the selection holds a SPLIT OBD (one drawn row per invoice), the bar
// counts OBDs FIRST — "1 OBD · 4 invoices", "3 OBDs · 6 invoices" — because a
// tick in Phase 4 selects the whole OBD. Invoices = distinct numbers: every
// invoice of a split OBD, SAP's of any other bill; a bill with none is said
// apart ("+ 1 not invoiced"). Without a split OBD, the pair label above, unchanged.
//
// P5-3 (2026-10-17): with ONLY SOME invoices of a split OBD ticked the bar says
// how many of how many — "1 OBD · 2 of 4 invoices". Counted by invoice ROW:
// ticked invoices of each split OBD + every other invoiced bill, out of all
// the selected OBDs' invoices; an un-invoiced bill is said apart, as above.
//
// SPLIT LOAD (phase 3, 2026-10-24): the truck parts of one invoice share its
// number, so the distinct-number count would read two ticked parts as
// "1 invoice" and stop there (discovery §4, MERGES SILENTLY). When the
// selection holds a part, the bar ALSO counts parts: "1 OBD · 1 invoice ·
// 2 parts", partly ticked "1 OBD · 1 invoice · 1 of 2 parts". A selection with
// no part takes every branch below exactly as before.
export function selectionCountLabel(rows: readonly CountRow[]): string | null {
  const n = rows.length;
  const obds = `${n} OBD${n === 1 ? "" : "s"}`;
  if (rows.some((r) => (r.invoiceRowsAll ?? r.invoiceRows ?? []).some(isLoadRow))) {
    const numbers = new Set<string>();
    let notInvoiced = 0;
    let parts = 0;
    let allParts = 0;
    for (const r of rows) {
      if (isSplitRow(r)) {
        for (const i of r.invoiceRows ?? []) if (i.invoiceNo !== null) numbers.add(i.invoiceNo);
        parts += (r.invoiceRows ?? []).filter(isLoadRow).length;
        allParts += (r.invoiceRowsAll ?? r.invoiceRows ?? []).filter(isLoadRow).length;
      } else if (r.invoiceNo !== null) numbers.add(r.invoiceNo);
      else notInvoiced++;
    }
    const m = numbers.size;
    const partsText = parts === allParts ? `${parts} part${parts === 1 ? "" : "s"}` : `${parts} of ${allParts} parts`;
    return `${obds} · ${m} invoice${m === 1 ? "" : "s"} · ${partsText}` + (notInvoiced > 0 ? ` + ${notInvoiced} not invoiced` : "");
  }
  if (rows.some(isPartlyTicked)) {
    let ticked = 0;
    let total = 0;
    let notInvoiced = 0;
    for (const r of rows) {
      if (isSplitRow(r)) {
        ticked += r.invoiceRows?.length ?? 0;
        total += (r.invoiceRowsAll ?? r.invoiceRows)?.length ?? 0;
      } else if (r.invoiceNo !== null) {
        ticked++;
        total++;
      } else notInvoiced++;
    }
    return `${obds} · ${ticked} of ${total} invoices` + (notInvoiced > 0 ? ` + ${notInvoiced} not invoiced` : "");
  }
  if (rows.some(isSplitRow)) {
    const numbers = new Set<string>();
    let notInvoiced = 0;
    for (const r of rows) {
      if (isSplitRow(r)) {
        for (const i of r.invoiceRows ?? []) if (i.invoiceNo !== null) numbers.add(i.invoiceNo);
      } else if (r.invoiceNo !== null) numbers.add(r.invoiceNo);
      else notInvoiced++;
    }
    const m = numbers.size;
    return `${obds} · ${m} invoice${m === 1 ? "" : "s"}` + (notInvoiced > 0 ? ` + ${notInvoiced} not invoiced` : "");
  }
  if (!rows.some((r) => r.invoiceNo !== null && (r.invoicePartners?.length ?? 0) > 0)) return null;
  const invoices = new Set(rows.filter((r) => r.invoiceNo !== null).map((r) => r.invoiceNo)).size;
  const notInvoiced = rows.filter((r) => r.invoiceNo === null).length;
  return (
    `${invoices} invoice${invoices === 1 ? "" : "s"}` +
    (notInvoiced > 0 ? ` + ${notInvoiced} not invoiced` : "") +
    ` · ${obds}`
  );
}

// ── THE ON HOLD TAB, PER INVOICE (Add invoices 6.1, 2026-10-19) ─────────────
//
// A split OBD with held invoices draws one row per HELD invoice there
// (getFloorHold: `invoiceRows` = the held ones, `invoiceRowsAll` = every one),
// each ticked by its `inv:` key. Every other hold row is ticked by its orderId,
// exactly as before.

type HoldKeyRow = {
  orderId: number;
  invoiceRows?: ReadonlyArray<{ id: number }>;
  invoiceRowsAll?: ReadonlyArray<{ id: number }>;
};

const isPerInvoiceHoldRow = (r: HoldKeyRow) =>
  (r.invoiceRows?.length ?? 0) > 0 && (r.invoiceRowsAll ?? r.invoiceRows ?? []).length >= 2;

/** The tick keys one hold row draws: its held invoices', or its orderId. */
export function holdKeysOf(r: HoldKeyRow): FloorDeskKey[] {
  return isPerInvoiceHoldRow(r) ? (r.invoiceRows ?? []).map((i) => invKey(i.id)) : [r.orderId];
}

/**
 * The On hold tab's ticks as units, in `rows` order. `invoiceRowIds` null = the
 * WHOLE OBD — an unsplit bill, or a split OBD whose every invoice is held and
 * ticked (it releases through /api/floor/release with the slot, as before).
 * Otherwise the ticked held invoices (released per invoice, no slot).
 */
export function holdUnits(sel: ReadonlySet<FloorDeskKey>, rows: readonly HoldKeyRow[]): SelectionUnit[] {
  const out: SelectionUnit[] = [];
  for (const r of rows) {
    if (!isPerInvoiceHoldRow(r)) {
      if (sel.has(r.orderId)) out.push({ orderId: r.orderId, invoiceRowIds: null });
      continue;
    }
    const ticked = (r.invoiceRows ?? []).filter((i) => sel.has(invKey(i.id))).map((i) => i.id);
    if (ticked.length === 0) continue;
    const all = (r.invoiceRowsAll ?? r.invoiceRows ?? []).length;
    out.push({ orderId: r.orderId, invoiceRowIds: ticked.length === all ? null : ticked });
  }
  return out;
}

/** Tick / untick every key of these hold rows (one band's header box). */
export function toggleAllHoldKeys(sel: ReadonlySet<FloorDeskKey>, rows: readonly HoldKeyRow[]): Set<FloorDeskKey> {
  const keys = rows.flatMap(holdKeysOf);
  const next = new Set(sel);
  const allOn = keys.length > 0 && keys.every((k) => sel.has(k));
  for (const k of keys) {
    if (allOn) next.delete(k);
    else next.add(k);
  }
  return next;
}

/** Every key of these hold rows ticked? */
export function isAllHoldKeysSelected(sel: ReadonlySet<FloorDeskKey>, rows: readonly HoldKeyRow[]): boolean {
  const keys = rows.flatMap(holdKeysOf);
  return keys.length > 0 && keys.every((k) => sel.has(k));
}

/** Toggle one desk key (an orderId or an `inv:` key). */
export function toggleKey(sel: ReadonlySet<FloorDeskKey>, key: FloorDeskKey): Set<FloorDeskKey> {
  const next = new Set(sel);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
