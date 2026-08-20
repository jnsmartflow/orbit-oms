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
import {
  DuplicateSoTag,
  DUP_SO_BADGE_CLASS,
  DUP_SO_MUTED,
  DUP_SO_ROW_CLASS,
  DUP_SO_TEXT,
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

// Ship-to flags (design §7.5) — LIMITED by the payload: FloorBoardRow carries
// only the EFFECTIVE dealer (override ?? customer). So a redirect shows a violet
// marker, not the "Original → Redirect" pair. The site marker is exact.
function shipInfo(row: FloorBoardRow) {
  return shipMarkers(row);
}

const HEAD_TH = "h-[31px] border-b border-[#ebebeb] px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const HEAD_TH_NARROW = "h-[31px] border-b border-[#ebebeb] px-1 text-center text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
// ⚠ SPLIT INTO BASE + SKIN ON PURPOSE. A duplicate-SO row needs a different
// border colour AND text colour, and appending `text-white` after `text-[#4b5563]`
// would NOT reliably win: Tailwind resolves same-property utilities by their
// order in the generated stylesheet, not by their order in the class string.
// Building the two variants from a shared base means the conflicting utility is
// only ever emitted once per cell.
const TD_BASE = "px-3.5 py-2 text-[11px] whitespace-nowrap overflow-hidden text-ellipsis border-b";
const TD = `${TD_BASE} border-[#f0f0f0] text-[#4b5563]`;
const TD_DUP = `${TD_BASE} border-[#b91c1c] text-[#fecaca]`;
const TD_NARROW_BASE = "px-1 py-2 text-center text-[11px] border-b";
const TD_NARROW = `${TD_NARROW_BASE} border-[#f0f0f0] text-[#4b5563]`;
const TD_NARROW_DUP = `${TD_NARROW_BASE} border-[#b91c1c] text-[#fecaca]`;

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
          // ── Duplicate-SO red ────────────────────────────────────────────────
          // Applies on every variant (live / history / upcoming) — a twin is a
          // twin whichever view you found it in. Row fill + hover come from
          // CLASSES, never an inline background: an inline style would beat the
          // `hover:` rule and silently kill the row hover this board relies on.
          const dup = row.hasDuplicateSo;
          const td = dup ? TD_DUP : TD;
          const tdNarrow = dup ? TD_NARROW_DUP : TD_NARROW;
          // Grey chips (upcoming / "Not completed" / "Nd late") flip to the one
          // shared white pill; so does every StatusPill on this row.
          const chipCls = dup
            ? `rounded-[4px] px-2 py-[2px] text-[10px] font-semibold ${DUP_SO_BADGE_CLASS}`
            : "rounded-[4px] bg-[#f3f4f6] px-2 py-[2px] text-[10px] font-semibold text-[#6b7280]";

          let statusCell: ReactNode;
          if (variant === "upcoming") {
            statusCell = <span className={"inline-flex items-center " + chipCls}>for {fmtDay(target)}</span>;
          } else if (variant === "history") {
            if (row.isChecked) {
              const cAt = asStr(row.checkedAt);
              const lateDays = cAt && target ? diffDays(target, istDay(cAt)) : 0;
              const timeStr = lateDays > 0 ? fmtDateTime(cAt) : hhmm(cAt);
              statusCell = (
                <span className="inline-flex items-center gap-1.5">
                  <StatusPill status="done" time={timeStr} onRed={dup} />
                  {lateDays > 0 && (
                    <span
                      className={
                        "rounded-[3px] px-[5px] py-px text-[9.5px] font-bold " +
                        (dup ? DUP_SO_BADGE_CLASS : "bg-[#f3f4f6] text-[#6b7280]")
                      }
                    >
                      {lateDays}d late
                    </span>
                  )}
                </span>
              );
            } else {
              statusCell = <span className={"inline-flex items-center " + chipCls}>Not completed</span>;
            }
          } else {
            // live
            const urgent = row.priorityLevel === 1;
            statusCell = (
              <span className="inline-flex items-center gap-2">
                <StatusPill status={st} time={liveTime(row, nowMs)} onRed={dup} />
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
            <tr key={row.orderId} className={"group " + (dup ? DUP_SO_ROW_CLASS : "hover:bg-[#fafafa]")}>
              {interactive && (
                <td className={tdNarrow}>
                  {/* Checkbox on Waiting / With-picker rows only (design §7.8).
                      accent-teal-600 stays: teal on red is high-contrast, and it
                      keeps "ticked" reading the same on every row. */}
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
                <td className={`${tdNarrow} text-[10.5px] tabular-nums`} style={dup ? { color: DUP_SO_MUTED } : undefined}>
                  <span className={dup ? "" : "text-[#9ca3af]"}>{i + 1}</span>
                </td>
              )}
              <td className={td}>
                <span
                  className={"font-mono text-[11.5px] font-medium " + (dup ? "" : "text-[#111827]")}
                  style={dup ? { color: DUP_SO_TEXT } : undefined}
                >
                  {row.obdNumber}
                </span>
                {/* The tag rides the OBD cell — first column a reader lands on,
                    and it never displaces the Status column's own meaning. */}
                {dup && <DuplicateSoTag className="ml-1.5 align-[1px]" />}
                {(row.ageDays ?? 0) > 0 && (
                  <span
                    className={
                      "ml-1.5 rounded-[3px] px-[5px] py-px text-[9.5px] font-bold " +
                      (dup ? DUP_SO_BADGE_CLASS : "bg-[#f3f4f6] text-[#6b7280]")
                    }
                  >
                    {row.ageDays}d
                  </span>
                )}
                <div
                  className={"flex items-center gap-1 text-[10px] " + (dup ? "" : "text-[#9ca3af]")}
                  style={dup ? { color: DUP_SO_MUTED } : undefined}
                >
                  {fmtDateTime(obd)}
                  {row.isEmailTime && (
                    <span title="Email time" className="inline-flex shrink-0">
                      <Mail size={9.5} />
                    </span>
                  )}
                </div>
              </td>
              <td className={td}>
                <span
                  className={"text-[11.5px] font-medium " + (dup ? "" : "text-[#111827]")}
                  style={dup ? { color: DUP_SO_TEXT } : undefined}
                >
                  {row.dealerName}
                </span>
                {/* ★ amber and ⚡ red are both eaten by the fill — white on a
                    duplicate, glyph shapes unchanged. */}
                {row.isKeyCustomer && (
                  <span className="ml-1.5" style={{ color: dup ? DUP_SO_TEXT : "#f59e0b" }}>
                    ★
                  </span>
                )}
                {row.priorityLevel === 1 && (
                  <span className="ml-1" style={{ color: dup ? DUP_SO_TEXT : "#ef4444" }}>
                    ⚡
                  </span>
                )}
                {isSite && (
                  <Building2
                    size={12}
                    className="ml-1 inline-block align-[-1px]"
                    style={{ color: dup ? DUP_SO_TEXT : "#475569" }}
                  />
                )}
                {row.isTint && (
                  <Droplet
                    size={12}
                    className="ml-1 inline-block align-[-1px]"
                    style={{ color: dup ? DUP_SO_TEXT : "#7c3aed" }}
                  />
                )}
                {isSite && (
                  <div className={"text-[10.5px] " + (dup ? "" : "text-[#9ca3af]")} style={dup ? { color: DUP_SO_MUTED } : undefined}>
                    billed to {row.billToName ?? "—"}
                  </div>
                )}
                {isRedirect && (
                  <div className={"text-[11px] " + (dup ? "" : "text-[#6d28d9]")} style={dup ? { color: DUP_SO_MUTED } : undefined}>
                    → ship-to changed
                  </div>
                )}
                {chipFor?.(row)}
              </td>
              <td className={td}>{row.route ?? "—"}</td>
              {showSlot && (
                <td className={td}>
                  {row.windowTime ?? (
                    <span className={dup ? "" : "text-[#9ca3af]"} style={dup ? { color: DUP_SO_MUTED } : undefined}>
                      No slot
                    </span>
                  )}
                  {row.dispatchTargetDate && (
                    <div className={"text-[10px] " + (dup ? "" : "text-[#9ca3af]")} style={dup ? { color: DUP_SO_MUTED } : undefined}>
                      {fmtDay(row.dispatchTargetDate)}
                    </div>
                  )}
                </td>
              )}
              <td className={`${td} text-right tabular-nums`}>{row.volumeLitres ?? 0}</td>
              <td className={`${td} text-[10.5px]`}>
                <span className={dup ? "" : "text-[#6b7280]"} style={dup ? { color: DUP_SO_MUTED } : undefined}>
                  {row.articleTag ? formatArticleTag(row.articleTag) : "—"}
                </span>
              </td>
              {!showSlot && (
                <td className={td}>
                  {row.assignedToName ?? (
                    <span className={dup ? "" : "text-[#9ca3af]"} style={dup ? { color: DUP_SO_MUTED } : undefined}>
                      —
                    </span>
                  )}
                </td>
              )}
              <td className={td}>{statusCell}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
