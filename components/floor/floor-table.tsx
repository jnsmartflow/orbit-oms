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
// COLUMNS: ☐ · # · OBD+date · Ship to · Route · Vol · Article · Picker · Status
//  - There is NO per-row Slot column: on All the slot is carried by the band
//    header, on a slot tab by the active tab (design §7.1). Matches the mockup.
//  - Vol right-aligned, plain litres. Gift lines are OUT OF SCOPE.
//  - Article reuses formatArticleTag (D/C/T/B), CLAUDE_SUPPORT §4.19.
//  - The ☐ and # columns use NARROW padding so the row number never truncates
//    (Step-5 bug fix — 3% + 28px padding was clipping "1" to "1…").

import type { ReactNode } from "react";
import { Building2, Droplet, Mail, MoreHorizontal, Zap } from "lucide-react";
import { formatArticleTag } from "@/lib/floor/format";
import { StatusPill, rowStatus } from "./status-pill";
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
  // ☐ 4 · # 4 · OBD 14 · Ship 20 · Route 10 · Vol 7 · Article 12 · Picker 9 · Status 20.
  // With showSlot the Picker column is REPLACED by a Slot column sitting after
  // Route — same column COUNT either way, so both arms keep their length and
  // still sum to 100 (§27). Both the interactive and the read-only arm need
  // their own showSlot variant: the widths map positionally, so reusing the
  // Picker-ordered array would hand Slot the Vol width and shunt the rest along
  // (reachable today — By group is available on a History day).
  const widths = interactive
    ? showSlot
      ? [4, 4, 14, 20, 10, 9, 7, 12, 20]
      : [4, 4, 14, 20, 10, 7, 12, 9, 20]
    : showSlot
      ? [16, 24, 12, 9, 7, 13, 19]
      : [16, 24, 12, 7, 13, 9, 19];
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
                className="h-[13px] w-[13px] cursor-pointer align-middle accent-teal-600"
                checked={allOn}
                onChange={() => onToggleAll?.(rows)}
              />
            </th>
          )}
          {interactive && <th className={HEAD_TH_NARROW}>#</th>}
          <th className={HEAD_TH}>OBD</th>
          <th className={HEAD_TH}>Ship to</th>
          <th className={HEAD_TH}>Route</th>
          {showSlot && <th className={HEAD_TH}>Slot</th>}
          <th className={`${HEAD_TH} text-right`}>Vol</th>
          <th className={HEAD_TH}>Article</th>
          {!showSlot && <th className={HEAD_TH}>Picker</th>}
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
                <StatusPill status={st} time={liveTime(row, nowMs)} />
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
                      accent-teal-600 stays: it now sits on a pale wash rather
                      than a red fill, and reads the same on every row either
                      way. */}
                  {pickable && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.obdNumber}`}
                      className="h-[13px] w-[13px] cursor-pointer align-middle accent-teal-600"
                      checked={selection?.has(row.orderId) ?? false}
                      onChange={() => onToggleRow?.(row.orderId)}
                    />
                  )}
                </td>
              )}
              {interactive && (
                <td className={`${TD_NARROW} text-[10.5px] tabular-nums`}>
                  <span className="text-[#9ca3af]">{i + 1}</span>
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
                    style={{ color: "#7c3aed" }}
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
                    className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-[#6d28d9]"
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
              <td className={`${TD} text-right tabular-nums`}>{row.volumeLitres ?? 0}</td>
              <td className={`${TD} text-[10.5px]`}>
                <span className="text-[#6b7280]">
                  {row.articleTag ? formatArticleTag(row.articleTag) : "—"}
                </span>
              </td>
              {!showSlot && (
                <td className={TD}>
                  {row.assignedToName ?? (
                    <span className="text-[#9ca3af]">
                      —
                    </span>
                  )}
                </td>
              )}
              <td className={TD}>{statusCell}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
