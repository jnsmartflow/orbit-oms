"use client";

// Floor Control — the floor row table (design §7.5). Fixed layout, colgroup
// percentages summing to 100 (CLAUDE_UI §27). Rendered by the flat slot-tab
// view, inside each slot band (All), inside each route row (By route), and by
// the Upcoming strip — one component, three `variant`s.
//
// Step 5: the checkbox and the ⚡ row action are now LIVE (selection + urgent
// toggle). The ⋯ (details) button stays INERT — the detail panel is a later
// step. On history/upcoming variants everything stays read-only.
//
// COLUMNS: ☐ · OBD+date · Invoice · Ship to · Route · Vol · Article · Status
//  - The # and Picker columns were REMOVED 2026-09-10 with the trip desk. See
//    the width arrays for the before/after counts.
//  - There is NO per-row Slot column: on All the slot is carried by the band
//    header, on a slot tab by the active tab (design §7.1). Matches the mockup.
//  - Vol right-aligned, plain litres. Gift lines are OUT OF SCOPE.
//  - Article reuses formatArticleTag (D/C/T/B), CLAUDE_SUPPORT §4.19.
//  - The ☐ and # columns use NARROW padding so the row number never truncates
//    (Step-5 bug fix — 3% + 28px padding was clipping "1" to "1…").
//  - Invoice (2026-08-31) is SAP's own invoiceNo + invoiceDate, two lines,
//    shaped like the OBD cell and sitting right next to it — the two reference
//    numbers are scanned together. BLANK until SAP stamps the bill; absent
//    entirely on the showSlot (By group) arms. See the cell and `showInvoice`.

import type { ReactNode } from "react";
import { Building2, Droplet, Mail, MoreHorizontal, Zap } from "lucide-react";
// formatDateIST is the SHARED date-only formatter — the same one the detail
// panel's "Invoice date" cell reads (it used to be a private fmtDate in
// detail-details.tsx). One formatter, so the two surfaces cannot disagree.
import { formatArticleTag, formatDateIST } from "@/lib/floor/format";
import { StatusPill, rowStatus, isHeldBack, formatLitres } from "./status-pill";
import { isAllSelected, type FloorSelection } from "@/lib/floor/selection";
// SOFT variant only (2026-08-25). The solid DUP_SO_* tokens are the PICKING
// treatment and are deliberately no longer imported here: under `soft` every
// cell, badge and pill on a duplicate row renders exactly as it does on an
// ordinary row, so there is nothing left to flip. See the two-treatment note at
// the top of duplicate-so-tag.tsx.
import {
  DuplicateSoTag,
  DUP_SO_SOFT_BAR,
  DUP_SO_SOFT_ROW_CLASS,
} from "@/components/shared/duplicate-so-tag";
import type { FloorBoardRow } from "@/lib/floor/types";

export type FloorTableVariant = "live" | "history" | "upcoming";

// Retail Offtake / Decorative Projects = "goes to a site" SMUs (CORE §8; site
// set CONFIRMED against live data 2026-07). "Deco" (9 rows) is a known parked
// data issue — deliberately NOT handled here.
const PROJECT_SMUS = new Set(["Retail Offtake", "Decorative Projects"]);

// Exported so the Hold and Cancelled tabs mark a site bill / a redirect by the
// SAME rule the floor table uses (design §7.5). Shared predicate, not shared
// markup — each table owns its own cell, but the rule can never drift.
export function shipMarkers(row: { smu: string | null; isShipToOverride: boolean }): {
  isSite: boolean;
  isRedirect: boolean;
} {
  return {
    isSite: row.smu !== null && PROJECT_SMUS.has(row.smu) && !row.isShipToOverride,
    isRedirect: row.isShipToOverride,
  };
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function asStr(v: string | Date | null): string | null {
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  return null;
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso)
    .toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
    .replace(",", "");
}
function hhmm(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}
function istDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function diffDays(fromDayIso: string, toDayIso: string): number {
  const [ay, am, ad] = fromDayIso.split("-").map(Number);
  const [by, bm, bd] = toDayIso.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
// Two-char units (design §7.7): 16m / 17h / 2d.
function shortElapsed(fromIso: string | null, nowMs: number): string | null {
  if (!fromIso) return null;
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from)) return null;
  const mins = Math.max(0, Math.floor((nowMs - from) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}
/**
 * The trip tag's SHORT form — "L-260910-02" → "L-02".
 *
 * 🔴 IT EXISTS BECAUSE THE FULL NUMBER TRUNCATED TO NOTHING USEFUL. The tag
 * rides inside the OBD cell (no column was added — see the note at the call
 * site), and that cell already carries the OBD number, a possible duplicate-SO
 * tag and a possible age chip. An eleven-character number ellipsised to "L-26…"
 * tells the reader the type letter and the century, which is no information at
 * all. The type and the sequence are what distinguish one of the day's trips
 * from another, and every band on screen is the same day, so the date is the
 * part that can go.
 *
 * ⚠ THE FULL NUMBER IS STILL REACHABLE — it is the band header above the row,
 * and it is on the tag's `title` for a hover. Nothing is hidden, only shortened.
 *
 * ⚠ FALLS BACK TO THE WHOLE STRING on anything that is not the expected shape.
 * The format is `{T}-{YYMMDD}-{NN}` and `chk_trips_number_shape` enforces it in
 * the database, so the else branch should be unreachable — but a tag is not
 * worth throwing over, and printing the real value is the honest failure.
 */
function shortTripNumber(tripNumber: string): string {
  const m = tripNumber.match(/^([A-Z])-\d{6}-(\d+)$/);
  return m ? `${m[1]}-${m[2]}` : tripNumber;
}

// dispatchTargetDate is date-only — parse the Date.UTC way, never new Date(str).
function fmtDay(dateOnly: string | null): string {
  if (!dateOnly) return "";
  const [y, m, d] = dateOnly.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WD[dt.getUTCDay()]} ${dt.getUTCDate()} ${MON[dt.getUTCMonth()]}`;
}

// Live elapsed by status (design §7.7). Waiting has NO anchor in the payload —
// no release/updated timestamp on FloorBoardRow — so it shows no time; an honest
// blank beats a wrong duration (deferred follow-up needs releasedAt).
function liveTime(row: FloorBoardRow, nowMs: number): string | null {
  const st = rowStatus(row);
  if (st === "done") return hhmm(asStr(row.checkedAt));
  if (st === "needsCheck") return shortElapsed(asStr(row.pickedAt), nowMs);
  if (st === "withPicker") return shortElapsed(asStr(row.assignedAt), nowMs);
  return null;
}

// Ship-to flags (design §7.5). Both markers are exact: the site rule reads the
// SMU set above, and a redirect now prints the real ORIGINAL → REDIRECT pair —
// FloorBoardRow carries `customerName` + `shipToOverrideName` alongside the
// effective `dealerName` (lib/floor/types.ts), the same pair the rail card has
// always shown. (It used to have only the effective dealer and could print a
// nameless "→ ship-to changed" caption — CLAUDE_FLOOR §8b.)
function shipInfo(row: FloorBoardRow) {
  return shipMarkers(row);
}

const HEAD_TH = "h-[31px] border-b border-[#ebebeb] px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const HEAD_TH_NARROW = "h-[31px] border-b border-[#ebebeb] px-1 text-center text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
// ⚠ THE BASE + SKIN SPLIT IS GONE, and its absence is the point. It existed
// because the SOLID duplicate-SO row needed its own border AND text colour, and
// appending `text-white` after `text-[#4b5563]` does not reliably win (Tailwind
// resolves same-property utilities by stylesheet order, not class-string order).
// Under the SOFT variant a duplicate row keeps the standard border and the
// standard text — only its ground and its left bar change — so there is exactly
// one cell class again and no conflicting utility to sequence.
const TD = "px-3.5 py-2 text-[11px] whitespace-nowrap overflow-hidden text-ellipsis border-b border-[#f0f0f0] text-[#4b5563]";
const TD_NARROW = "px-1 py-2 text-center text-[11px] border-b border-[#f0f0f0] text-[#4b5563]";

export function FloorTable({
  rows,
  nowMs,
  variant = "live",
  selection,
  onToggleRow,
  onToggleAll,
  onMarkUrgent,
  onOpenDetail,
  showSlot = false,
  chipFor,
  gateOn = false,
}: {
  rows: FloorBoardRow[];
  nowMs: number;
  variant?: FloorTableVariant;
  // Wired only on the live variant; undefined on history/upcoming.
  selection?: FloorSelection;
  onToggleRow?: (id: number) => void;
  onToggleAll?: (rows: FloorBoardRow[]) => void;
  onMarkUrgent?: (id: number) => void;
  onOpenDetail?: (id: number) => void;
  /**
   * Swap the Picker column for a Slot column (time + date under it). For the
   * By-group view ONLY, where there is no slot tab to carry the time (grouping
   * deliberately spans slots) and no picker to name (every row is Waiting).
   *
   * Default false = every pre-existing call site is untouched: same nine
   * columns, same widths array, same cells.
   */
  showSlot?: boolean;
  /**
   * Is the picking visibility gate ON? (2026-09-09.)
   *
   * ⚠ CHANGES A CELL'S CONTENT, NEVER THE COLUMN SET. It swaps the Status
   * pill's label on held-back waiting rows and does nothing else — no colgroup
   * entry, no <th>, no width array arm. That is the entire point of carrying
   * this fact on an element that is already in every row: the widths map
   * POSITIONALLY (see the warning above `widths`), so a tenth column here would
   * shunt every column right on two of the four arms.
   *
   * Default false = every pre-existing call site is byte-identical, and so is
   * the whole screen whenever the gate is off.
   */
  gateOn?: boolean;
  /**
   * Optional chip rendered under the dealer name in the Ship-to cell. The
   * caller owns the whole element, so no tone/colour vocabulary leaks into this
   * table. Undefined (every pre-existing call site) renders nothing at all.
   */
  chipFor?: (row: FloorBoardRow) => ReactNode;
}) {
  // A live table is interactive only when a caller actually wired selection.
  // Every existing live call site passes onToggleRow (floor-board's selProps),
  // so this is byte-identical for all of them; history/upcoming were already
  // false on `variant` alone. What it BUYS: the By-picker "what he's holding"
  // view (2026-08-11) renders the ordinary live table — live status pills, ⚡
  // and ⋯ still working — simply by omitting the selection handlers, with no
  // new prop threaded through slot-band and route-row to reach here.
  const interactive = variant === "live" && !!onToggleRow;
  // ── THE ONE CONDITION behind the Invoice column ────────────────────────────
  // Derived ONCE and read by the colgroup, the header cell and the body cell.
  // Three separate `!showSlot` tests would be three things that can drift, and
  // the widths map POSITIONALLY (see the warning below) — a header that grew a
  // column the colgroup did not would silently shunt every column right.
  //
  // OWNER DECISION 2026-08-31: NO Invoice column on the showSlot (By group)
  // arms. Those views are WAITING-ONLY, and a waiting bill has no invoice by
  // construction (live check that day: 0 of the 4 still-open rows carried one,
  // against 65 of the 70 at pick_checked) — so the column would be a
  // permanently blank 10% on the one view with the least room to spare.
  //
  // It falls out that Invoice is PRESENT exactly when Picker is. That is a
  // consequence, not the rule — and it is about presence only, not position:
  // the two are not adjacent (Invoice sits up beside OBD, see below). If a
  // future column ever splits them, give Invoice its own flag rather than
  // reusing `!showSlot` again.
  const showInvoice = !showSlot;
  // ☐ 4 · # 4 · OBD 13 · Invoice 10 · Ship 20 · Route 9 · Vol 6 · Article 10 ·
  // Picker 8 · Status 16.
  //
  // ⚠ INVOICE SITS IMMEDIATELY AFTER OBD (owner call 2026-08-31, on the live
  // screen). The OBD number and the invoice number are the two REFERENCE
  // NUMBERS the operator scans together — reading one off the board to find
  // the other is the whole job — so they belong side by side rather than at
  // opposite ends of the row. Same widths as the first cut, reordered only.
  //
  // With showSlot the Picker column is REPLACED by a Slot column sitting after
  // Route, and the Invoice column is absent — so that arm keeps its ORIGINAL
  // nine-entry width array untouched (2026-08-31), while the two showInvoice
  // arms grew a tenth/eighth entry. Every arm still sums to 100 (§27).
  //
  // ⚠ THE WIDTHS MAP POSITIONALLY, and this is exactly the trap: reusing the
  // Picker-ordered array under showSlot would hand Slot the Vol width and shunt
  // the rest along (reachable today — By group is available on a History day),
  // and reusing the showSlot array under showInvoice would leave the tenth
  // column with no <col> at all. Branching on `showInvoice` rather than
  // `showSlot` keeps this ternary on the SAME single condition the header and
  // body cells use — the arms are inverted from what they were, deliberately.
  // Moving the column means moving its <col> width, its <th> and its <td>
  // together; any one left behind shunts every column to its right.
  //
  // ── RECUT 2026-09-10 — TWO COLUMNS REMOVED ────────────────────────────────
  //
  // The trip desk drops the **#** column and the **Picker** column:
  //   #      — a row number is a reading aid for a flat list. The desk now reads
  //            bills under stops and under trips, where the numbering that means
  //            anything is the STOP's visit order, not the row's position.
  //   Picker — the planner watches status, not who is holding it. It stays in
  //            the detail panel with the activity trail. (v3 mockup §04.)
  //
  // 🔴 COUNTS, BEFORE → AFTER, because these arrays map POSITIONALLY and a
  // mismatch shunts every column sideways:
  //   interactive + invoice   10 → 8   (lost # and Picker)
  //   interactive + slot       9 → 8   (lost #; that arm never had Picker)
  //   read-only  + invoice     8 → 7   (lost Picker)
  //   read-only  + slot        7 → 7   (unchanged — had neither)
  // Every arm still sums to 100 (CLAUDE_UI §27).
  //
  //                        ☐  OBD INV Ship Rt Vol Art Status
  const widths = interactive
    ? showInvoice
      ? [4, 15, 12, 26, 11, 7, 11, 14] //                                  = 100
      : [4, 15, 26, 11, 10, 7, 12, 15] //  ☐ OBD Ship Rt Slot Vol Art Status = 100
    : showInvoice
      ? [15, 12, 27, 12, 7, 12, 15] //     OBD INV Ship Rt Vol Art Status   = 100
      : [16, 27, 12, 10, 7, 13, 15]; //    OBD Ship Rt Slot Vol Art Status  = 100
  const allOn = interactive && selection ? isAllSelected(selection, rows) : false;

  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        {widths.map((w, i) => (
          <col key={i} style={{ width: `${w}%` }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {interactive && (
            <th className={HEAD_TH_NARROW}>
              <input
                type="checkbox"
                aria-label="Select all rows in this group"
                className="h-[13px] w-[13px] cursor-pointer align-middle accent-brand-600"
                checked={allOn}
                onChange={() => onToggleAll?.(rows)}
              />
            </th>
          )}
          <th className={HEAD_TH}>OBD</th>
          {showInvoice && <th className={HEAD_TH}>Invoice</th>}
          <th className={HEAD_TH}>Ship to</th>
          <th className={HEAD_TH}>Route</th>
          {showSlot && <th className={HEAD_TH}>Slot</th>}
          <th className={`${HEAD_TH} text-right`}>Vol</th>
          <th className={HEAD_TH}>Article</th>
          <th className={HEAD_TH}>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const st = rowStatus(row);
          const pickable = st === "waiting" || st === "withPicker";
          const { isSite, isRedirect } = shipInfo(row);
          const obd = asStr(row.obdDateTime);
          const target = row.dispatchTargetDate;
          // ── Duplicate-SO, SOFT variant (2026-08-25) ─────────────────────────
          // Applies on every variant (live / history / upcoming) — a twin is a
          // twin whichever view you found it in. Ground + hover come from
          // CLASSES, never an inline background: an inline style would beat the
          // `hover:` rule and silently kill the row hover this board relies on.
          //
          // ⚠ NOTHING ELSE ON THE ROW BRANCHES ON `dup` ANY MORE. Cells, chips,
          // the age badge, the ⚡, the site/tint glyphs and the StatusPill all
          // render exactly as they do on an ordinary row — that is the whole
          // difference between this and the solid treatment, which had to flip
          // every one of them to white so they would not vanish into the fill.
          // The signal is carried by the ground and the 3px bar alone.
          const dup = row.hasDuplicateSo;
          const chipCls =
            "rounded-[4px] bg-[#f3f4f6] px-2 py-[2px] text-[10px] font-semibold text-[#6b7280]";
          // The 3px red-500 left bar, as an inset shadow (never border-left —
          // this table is table-layout:fixed with colgroup percentages, UI §27,
          // and the first column's pl-[10px] pr-[4px] would be eaten by a real
          // border). It rides whichever cell is FIRST, and that changes with
          // `interactive`: the checkbox cell when the table is selectable, the
          // OBD cell when it is not (history / upcoming / the read-only
          // "what he's holding" list).
          const barStyle = dup ? { boxShadow: DUP_SO_SOFT_BAR } : undefined;

          let statusCell: ReactNode;
          if (variant === "upcoming") {
            statusCell = <span className={"inline-flex items-center " + chipCls}>for {fmtDay(target)}</span>;
          } else if (variant === "history") {
            // The day's outcome, plus a ⋯ that opens the READ-ONLY detail panel
            // (2026-08-25). Before this, `onOpenDetail` was passed to this table
            // on every variant (floor-board's selProps) and simply had no
            // trigger here — the prop was wired and unreachable, so a past bill
            // could not be opened at all and its SKU lines and Activity log were
            // on no screen.
            //
            // ⚠ ⋯ ONLY — deliberately NOT the ⚡ the live arm carries. ⚡ is
            // `onMarkUrgent`, a WRITE (/api/floor/actions mark-urgent), and
            // prioritising a bill on a day that has already shipped is
            // meaningless. The panel it opens is view-only: floor-page passes
            // source "history", which suppresses every action (detail-panel's
            // `readOnly`).
            let histBody: ReactNode;
            if (row.isChecked) {
              const cAt = asStr(row.checkedAt);
              const lateDays = cAt && target ? diffDays(target, istDay(cAt)) : 0;
              const timeStr = lateDays > 0 ? fmtDateTime(cAt) : hhmm(cAt);
              histBody = (
                <span className="inline-flex items-center gap-1.5">
                  <StatusPill status="done" time={timeStr} />
                  {lateDays > 0 && (
                    <span
                      className={
                        "rounded-[3px] px-[5px] py-px text-[9.5px] font-bold " +
                        "bg-[#f3f4f6] text-[#6b7280]"
                      }
                    >
                      {lateDays}d late
                    </span>
                  )}
                </span>
              );
            } else {
              histBody = <span className={"inline-flex items-center " + chipCls}>Not completed</span>;
            }
            statusCell = (
              <span className="inline-flex items-center gap-2">
                {histBody}
                <span className="hidden items-center gap-1 group-hover:inline-flex">
                  <button
                    type="button"
                    title="Open details"
                    onClick={() => onOpenDetail?.(row.orderId)}
                    className="inline-flex h-[23px] w-[23px] items-center justify-center rounded-[5px] border border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:text-gray-600"
                  >
                    <MoreHorizontal size={12} />
                  </button>
                </span>
              </span>
            );
          } else {
            // live
            const urgent = row.priorityLevel === 1;
            statusCell = (
              <span className="inline-flex items-center gap-2">
                {/* The pill carries the handover fact — NO NEW COLUMN. The rule
                    is isHeldBack()'s (status-pill.tsx); only the gate state is
                    this table's business. With the gate off this is
                    heldBack={false} on every row, so the cell renders exactly
                    the pill it has always rendered. */}
                <StatusPill
                  status={st}
                  time={liveTime(row, nowMs)}
                  heldBack={gateOn && isHeldBack(row)}
                />
                {/* Row hover actions (design §7.10). ⚡ is LIVE (instant urgent
                    toggle, lights red when urgent); ⋯ is INERT (detail panel is
                    a later step). */}
                <span className="hidden items-center gap-1 group-hover:inline-flex">
                  <button
                    type="button"
                    title={urgent ? "Clear urgent" : "Mark urgent"}
                    onClick={() => onMarkUrgent?.(row.orderId)}
                    className={`inline-flex h-[23px] w-[23px] items-center justify-center rounded-[5px] border ${
                      urgent ? "border-red-200 bg-red-50 text-red-500" : "border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:text-gray-600"
                    }`}
                  >
                    <Zap size={12} />
                  </button>
                  <button
                    type="button"
                    title="Open details"
                    onClick={() => onOpenDetail?.(row.orderId)}
                    className="inline-flex h-[23px] w-[23px] items-center justify-center rounded-[5px] border border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:text-gray-600"
                  >
                    <MoreHorizontal size={12} />
                  </button>
                </span>
              </span>
            );
          }

          return (
            <tr key={row.orderId} className={"group " + (dup ? DUP_SO_SOFT_ROW_CLASS : "hover:bg-[#fafafa]")}>
              {interactive && (
                /* FIRST CELL when the table is selectable — it carries the bar. */
                <td className={TD_NARROW} style={barStyle}>
                  {/* Checkbox on Waiting / With-picker rows only (design §7.8).
                      accent-brand-600 stays: it now sits on a pale wash rather
                      than a red fill, and reads the same on every row either
                      way. */}
                  {pickable && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.obdNumber}`}
                      className="h-[13px] w-[13px] cursor-pointer align-middle accent-brand-600"
                      checked={selection?.has(row.orderId) ?? false}
                      onChange={() => onToggleRow?.(row.orderId)}
                    />
                  )}
                </td>
              )}
              {/* On a NON-interactive table (history / upcoming / the read-only
                  "what he's holding" list) the two narrow columns are not
                  rendered, so THIS is the first cell and the bar lands here
                  instead. `interactive` is the same flag that drives `widths`
                  above, so the two can never disagree about which cell is first. */}
              <td className={TD} style={interactive ? undefined : barStyle}>
                <span className="font-mono text-[11.5px] font-medium text-[#111827]">
                  {row.obdNumber}
                </span>
                {/* The tag rides the OBD cell — first column a reader lands on,
                    and it never displaces the Status column's own meaning. */}
                {dup && <DuplicateSoTag variant="soft" className="ml-1.5 align-[1px]" />}
                {/* THE TRIP TAG (2026-09-09) — INSIDE the OBD cell, never a new
                    column. This table's colgroup, header cells and FOUR width
                    arrays map POSITIONALLY, so a tenth column shunts every
                    column right on two of the four arms; the visibility-gate
                    build made the same call and put its new fact on the status
                    pill for the same reason.

                    It rides the OBD cell because that is where the row's other
                    identifiers already live — the duplicate-SO tag and the age
                    chip are its neighbours — and because a trip number IS a
                    reference number, like the OBD beside it.

                    Renders NOTHING when the bill is on no trip, which is most of
                    the board: no empty space, no dash, no placeholder. */}
                {row.tripNumber && (
                  <span
                    title={`On trip ${row.tripNumber}${row.tripStatus ? ` · ${row.tripStatus}` : ""}`}
                    className="ml-1.5 rounded-[3px] bg-gray-900 px-[5px] py-px align-[1px] font-mono text-[9.5px] font-semibold text-white"
                  >
                    {shortTripNumber(row.tripNumber)}
                  </span>
                )}
                {/* NO SLOT (2026-09-10) — a bill the dispatch engine could not
                    schedule. These reach the board through floorBoardWhere's
                    second arm (lib/floor/queries.ts); before the decision rail
                    was retired they sat on it instead.

                    ⚠ QUIET, AND NOT AN ERROR. No red, no amber. A bill with no
                    slot is waiting for a planner to put it on a trip, which is
                    the ordinary next step and the whole point of the pool. The
                    chip exists so he can see WHICH bills still need that, not
                    to flag a fault. */}
                {row.windowId === null && (
                  <span
                    title="No dispatch slot — putting this bill on a trip gives it one"
                    className="ml-1.5 rounded-[3px] border border-[#e2d7fb] bg-[#f2ecfd] px-[5px] py-px align-[1px] text-[9px] font-bold uppercase tracking-[0.05em] text-[#6d28d9]"
                  >
                    no slot
                  </span>
                )}
                {(row.ageDays ?? 0) > 0 && (
                  <span
                    className="ml-1.5 rounded-[3px] px-[5px] py-px text-[9.5px] font-bold bg-[#f3f4f6] text-[#6b7280]"
                  >
                    {row.ageDays}d
                  </span>
                )}
                <div className="flex items-center gap-1 text-[10px] text-[#9ca3af]">
                  {fmtDateTime(obd)}
                  {row.isEmailTime && (
                    <span title="Email time" className="inline-flex shrink-0">
                      <Mail size={9.5} />
                    </span>
                  )}
                </div>
              </td>
              {/* INVOICE — SAP's own invoiceNo + invoiceDate, shaped like the
                  OBD cell it now sits beside: mono number on line 1, muted 10px
                  date underneath. Adjacent to OBD on purpose (owner call
                  2026-08-31) — these are the two reference numbers the operator
                  scans together, so reading one to find the other is one glance
                  rather than a trip across the row.

                  ⚠ EMPTY WHEN EMPTY. No em dash, no "pending", no placeholder —
                  unlike Route / Picker / Article below, which all print "—" for
                  a value that SHOULD be there and is not. A missing invoice is
                  not a gap in the data: SAP stamps invoices in its own
                  sub-hourly batches, so a bill still being picked simply has
                  none yet (0 of the 4 open rows on 2026-08-31 carried one). A
                  dash would read as "we looked and found nothing", which is a
                  different and wrong claim — and it would put a mark on nearly
                  every row of a busy morning's board.

                  The two lines are independent rather than sharing one guard:
                  patch-headers fills invoiceNo and invoiceDate with separate
                  fill-if-null tests (app/api/import/obd/route.ts), so one can
                  in principle arrive without the other, and each line should
                  tell the truth about its own field.

                  ⚠ NOT THE FIRST CELL, even on a read-only table — the OBD cell
                  above still is, so the duplicate-SO bar (`barStyle`) stays put
                  and must NOT be moved here.

                  formatDateIST is the SHARED formatter the detail panel's
                  "Invoice date" reads — never a second local one. */}
              {showInvoice && (
                <td className={TD}>
                  {row.invoiceNo && (
                    <span className="font-mono text-[11.5px] font-medium text-[#111827]">
                      {row.invoiceNo}
                    </span>
                  )}
                  {row.invoiceDate && (
                    <div className="text-[10px] text-[#9ca3af]">
                      {formatDateIST(row.invoiceDate)}
                    </div>
                  )}
                </td>
              )}
              <td className={TD}>
                <span className="text-[11.5px] font-medium text-[#111827]">
                  {row.dealerName}
                </span>
                {/* ★ amber and ⚡ red now render exactly as on an ordinary row — the
                    soft variant has no fill to eat them, which is why the ⚡ can
                    still carry Urgent on a Same-SO row (see the colour ruling in
                    duplicate-so-tag.tsx). */}
                {row.isKeyCustomer && (
                  <span className="ml-1.5" style={{ color: "#f59e0b" }}>
                    ★
                  </span>
                )}
                {row.priorityLevel === 1 && (
                  <span className="ml-1" style={{ color: "#ef4444" }}>
                    ⚡
                  </span>
                )}
                {isSite && (
                  <Building2
                    size={12}
                    className="ml-1 inline-block align-[-1px]"
                    style={{ color: "#475569" }}
                  />
                )}
                {row.isTint && (
                  <Droplet
                    size={12}
                    className="ml-1 inline-block align-[-1px]"
                    style={{ color: "#0284C7" }}
                  />
                )}
                {isSite && (
                  <div className="text-[10.5px] text-[#9ca3af]">
                    billed to {row.billToName ?? "—"}
                  </div>
                )}
                {/* Ship-to redirect — the ORIGINAL → REDIRECT pair, worded and
                    emphasised like rail-card.tsx's own ship-to line ("Ship to
                    <b>{target}</b>") so the desk table and the rail card describe
                    one bill the same way. Violet is unchanged.

                    ⚠ FIXED-LAYOUT TABLE (CLAUDE_UI §27): this rides INSIDE the
                    existing Ship-to column — no new column, no widened `widths`
                    entry. Two names in one 20% track will overflow, so the line
                    truncates with an ellipsis of its own (the <td>'s overflow
                    rules clip a child but give it no ellipsis) and the full pair
                    is on `title` for a hover.

                    An unmatched bill has no `customer` row, so `customerName` is
                    null — it keeps the old nameless caption rather than printing
                    a blank on one side of the arrow. */}
                {isRedirect && (
                  <div
                    className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-brand-800"
                    title={
                      row.customerName && row.shipToOverrideName
                        ? `${row.customerName} → ship to ${row.shipToOverrideName}`
                        : undefined
                    }
                  >
                    {row.customerName && row.shipToOverrideName ? (
                      <>
                        {row.customerName}
                        <span className="mx-1 opacity-60">→</span>
                        <b className="font-semibold">{row.shipToOverrideName}</b>
                      </>
                    ) : (
                      "→ ship-to changed"
                    )}
                  </div>
                )}
                {chipFor?.(row)}
              </td>
              <td className={TD}>{row.route ?? "—"}</td>
              {showSlot && (
                <td className={TD}>
                  {row.windowTime ?? (
                    <span className="text-[#9ca3af]">
                      No slot
                    </span>
                  )}
                  {row.dispatchTargetDate && (
                    <div className="text-[10px] text-[#9ca3af]">
                      {fmtDay(row.dispatchTargetDate)}
                    </div>
                  )}
                </td>
              )}
              {/* formatLitres, not the raw Float. A single row rarely shows the
                  fault, but the same function everywhere is what keeps a row,
                  its band header and the pool header from disagreeing by a
                  decimal on one screen. Display only — nothing stored moves. */}
              <td className={`${TD} text-right tabular-nums`}>{formatLitres(row.volumeLitres ?? 0)}</td>
              <td className={`${TD} text-[10.5px]`}>
                <span className="text-[#6b7280]">
                  {row.articleTag ? formatArticleTag(row.articleTag) : "—"}
                </span>
              </td>
              <td className={TD}>{statusCell}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
