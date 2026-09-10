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
