// Floor Control — selection state helpers (design §7.8). Pure, no React, no DB.
//
// Selectable = Waiting OR With-picker only (§7.8: "Checkboxes on Waiting and
// With picker only. Past that the material is off the shelf."). That is exactly
// "not yet picked and not yet checked" → !isDone && !isChecked. Done and
// Needs-check rows are never selectable.
//
// Selection is a Set of orderIds, so it SURVIVES a re-sort by construction (it
// keys on identity, not row position). It does NOT survive a tab change — the
// page clears it there.

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
