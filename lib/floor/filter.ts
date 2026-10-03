// Floor Control — client-side filter (design §5.3, mockup 01-board.html
// fSheet/applyFilter). Pure: no DB, no React. Only offers what is NOT already a
// visible control (scope, slot, route get no duplicate) — so: Status (floor only)
// + Flags. Multiple options AND together, matching the mockup's `.every`.

export type FloorFilterStatus = "waiting" | "withPicker" | "needsCheck" | "done" | "direct";
export type FloorFilterFlag = "key" | "urgent" | "tint" | "site" | "carried" | "redirect";

export interface FloorFilters {
  status: FloorFilterStatus[];
  flags: FloorFilterFlag[];
}
export const EMPTY_FILTERS: FloorFilters = { status: [], flags: [] };

export function filterCount(f: FloorFilters): number {
  return f.status.length + f.flags.length;
}

// Locked option order + labels for the sheet (design §5.3 wording).
export const STATUS_OPTIONS: Array<[FloorFilterStatus, string]> = [
  ["waiting", "Waiting"],
  ["withPicker", "With picker"],
  ["needsCheck", "Needs check"],
  ["done", "Done"],
  // Direct Loading (2026-10-03) — pick_checked with no picker. Its own option:
  // "Done" no longer matches these bills, exactly as the pill no longer says Done.
  ["direct", "Direct Loading"],
];
export const FLAG_OPTIONS: Array<[FloorFilterFlag, string]> = [
  ["key", "Key dealer"],
  ["urgent", "Urgent"],
  ["tint", "Tint"],
  ["site", "Site delivery"],
  ["carried", "Carried over"],
  ["redirect", "Ship-to changed"],
];

const PROJECT_SMUS = new Set(["Retail Offtake", "Decorative Projects"]);

// Fields a flag can key off. `ageDays` is floor-only (undefined on hold /
// cancelled rows) — a "carried over" filter simply can't match a row that has no
// age, which is correct: a held bill has no dispatch date to be carried past.
interface FlaggableRow {
  isKeyCustomer: boolean;
  priorityLevel: number | null; // FloorBoardRow (via PickingQueueRow) is nullable
  isTint: boolean;
  /** Picking's TINT/BASE answer (lib/picking/colour-work.ts) — optional so a
   *  hand-built row without it reads as "unknown", never as base. */
  colourWork?: "tint" | "base" | null;
  smu: string | null;
  isShipToOverride: boolean;
  ageDays?: number | null;
}

function matchesFlag(r: FlaggableRow, flag: FloorFilterFlag): boolean {
  switch (flag) {
    case "key":
      return r.isKeyCustomer;
    case "urgent":
      return r.priorityLevel === 1;
    case "tint":
      // A "Base — No Tint" bill is NOT tint (2026-10-02): the colour rule wins
      // over orderType, the same answer the TINT/BASE badge shows.
      return r.isTint && r.colourWork !== "base";
    case "site":
      return r.smu !== null && PROJECT_SMUS.has(r.smu) && !r.isShipToOverride;
    case "carried":
      return (r.ageDays ?? 0) > 0;
    case "redirect":
      return r.isShipToOverride;
  }
}

export function matchesFlags(r: FlaggableRow, flags: FloorFilterFlag[]): boolean {
  return flags.every((f) => matchesFlag(r, f));
}

interface StatusRow {
  isAssigned: boolean;
  isDone: boolean;
  isChecked: boolean;
  /** Direct Loading (v27.52). Optional: a hand-built row without it is not Direct Loaded. */
  directLoadedAt?: Date | string | null;
}
function rowFilterStatus(r: StatusRow): FloorFilterStatus {
  // Before the generic checked arm — the same order status-pill.tsx's rowStatus uses.
  if (r.isChecked && r.directLoadedAt != null) return "direct";
  if (r.isChecked) return "done";
  if (r.isDone) return "needsCheck";
  if (r.isAssigned) return "withPicker";
  return "waiting";
}
function matchesStatus(r: StatusRow, statuses: FloorFilterStatus[]): boolean {
  return statuses.length === 0 || statuses.includes(rowFilterStatus(r));
}

/** Floor rows — Status AND Flags. */
export function applyFloorFilters<T extends FlaggableRow & StatusRow>(rows: T[], f: FloorFilters): T[] {
  if (f.status.length === 0 && f.flags.length === 0) return rows;
  return rows.filter((r) => matchesStatus(r, f.status) && matchesFlags(r, f.flags));
}

/** Hold / Cancelled rows — Flags only (Status is a floor-only concept, and those
 *  rows carry no picking stage). */
export function applyFlagFilters<T extends FlaggableRow>(rows: T[], f: FloorFilters): T[] {
  if (f.flags.length === 0) return rows;
  return rows.filter((r) => matchesFlags(r, f.flags));
}
