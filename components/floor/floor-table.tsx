"use client";

// Floor Control — the floor row table (design §7.5). Fixed layout, colgroup
// percentages summing to 100 (CLAUDE_UI §27). Rendered by the flat slot-tab
// view, inside each slot band (All), inside each route row (By route), and by
// the Upcoming strip — one component, three `variant`s.
//
// READ-ONLY this step. The checkbox and the ⚡/⋯ row actions are RENDERED but
// wired to NOTHING — Step 5 owns the assignment bar and the actions route.
//
// COLUMNS: ☐ · # · OBD+date · Ship to · Route · Vol · Article · Picker · Status
//  - There is NO per-row Slot column: on All the slot is carried by the band
//    header, on a slot tab by the active tab — a per-row column would repeat one
//    value on every row (design §7.1's own reasoning). This matches the mockup,
//    which never renders a Slot column. See the Step-4 handoff notes.
//  - Vol right-aligned, plain litres. Gift lines are OUT OF SCOPE — no gift icon,
//    no gift-excluded total.
//  - Article reuses formatArticleTag (D/C/T/B), CLAUDE_SUPPORT §4.19.

import type { ReactNode } from "react";
import { Building2, Droplet, MoreHorizontal, Zap } from "lucide-react";
import { formatArticleTag } from "@/components/support/shared/table-cells";
import { StatusPill, rowStatus } from "./status-pill";
import type { FloorBoardRow } from "@/lib/floor/types";

export type FloorTableVariant = "live" | "history" | "upcoming";

// Retail Offtake / Decorative Projects = "goes to a site" SMUs (CORE §8 challan
// eligibility). ⚠ design §7.5 flags these exact strings for build confirmation —
// they are the DIVISION_TO_SMU values (77 / 74) from the import parser.
const PROJECT_SMUS = new Set(["Retail Offtake", "Decorative Projects"]);

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
// there is no release/updated timestamp on FloorBoardRow — so it shows no time;
// an honest blank beats a wrong duration (see Step-4 handoff notes).
function liveTime(row: FloorBoardRow, nowMs: number): string | null {
  const st = rowStatus(row);
  if (st === "done") return hhmm(asStr(row.checkedAt));
  if (st === "needsCheck") return shortElapsed(asStr(row.pickedAt), nowMs);
  if (st === "withPicker") return shortElapsed(asStr(row.assignedAt), nowMs);
  return null;
}

// Ship-to flags/sub-line (design §7.5) — LIMITED by the payload: FloorBoardRow
// carries only the EFFECTIVE dealer (override ?? customer), not the original
// ship-to. So a redirect shows a violet marker, not the "Original → Redirect"
// name pair the mockup draws. The site marker + "billed to {dealer}" is exact.
function shipInfo(row: FloorBoardRow) {
  const isSite = row.smu !== null && PROJECT_SMUS.has(row.smu) && !row.isShipToOverride;
  return { isSite, isRedirect: row.isShipToOverride };
}

const HEAD_TH = "h-[31px] border-b border-[#ebebeb] px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const TD = "border-b border-[#f0f0f0] px-3.5 py-2 text-[11px] text-[#4b5563] whitespace-nowrap overflow-hidden text-ellipsis";

export function FloorTable({
  rows,
  nowMs,
  variant = "live",
}: {
  rows: FloorBoardRow[];
  nowMs: number;
  variant?: FloorTableVariant;
}) {
  const interactive = variant === "live";
  const widths = interactive ? [3, 3, 15, 21, 11, 7, 12, 9, 19] : [16, 24, 12, 7, 13, 9, 19];

  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        {widths.map((w, i) => (
          <col key={i} style={{ width: `${w}%` }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {interactive && <th className={`${HEAD_TH} text-center`} />}
          {interactive && <th className={`${HEAD_TH} text-center`}>#</th>}
          <th className={HEAD_TH}>OBD</th>
          <th className={HEAD_TH}>Ship to</th>
          <th className={HEAD_TH}>Route</th>
          <th className={`${HEAD_TH} text-right`}>Vol</th>
          <th className={HEAD_TH}>Article</th>
          <th className={HEAD_TH}>Picker</th>
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

          // Status cell content by variant.
          let statusCell: ReactNode;
          if (variant === "upcoming") {
            statusCell = (
              <span className="inline-flex items-center rounded-[4px] bg-[#f3f4f6] px-2 py-[2px] text-[10px] font-semibold text-[#6b7280]">
                for {fmtDay(target)}
              </span>
            );
          } else if (variant === "history") {
            if (row.isChecked) {
              const cAt = asStr(row.checkedAt);
              const lateDays = cAt && target ? diffDays(target, istDay(cAt)) : 0;
              const timeStr = lateDays > 0 ? fmtDateTime(cAt) : hhmm(cAt);
              statusCell = (
                <span className="inline-flex items-center gap-1.5">
                  <StatusPill status="done" time={timeStr} />
                  {lateDays > 0 && (
                    <span className="rounded-[3px] bg-[#f3f4f6] px-[5px] py-px text-[9.5px] font-bold text-[#6b7280]">{lateDays}d late</span>
                  )}
                </span>
              );
            } else {
              statusCell = (
                <span className="inline-flex items-center rounded-[4px] bg-[#f3f4f6] px-2 py-[2px] text-[10px] font-semibold text-[#6b7280]">
                  Not completed
                </span>
              );
            }
          } else {
            // live
            statusCell = (
              <span className="inline-flex items-center gap-2">
                <StatusPill status={st} time={liveTime(row, nowMs)} />
                {/* Row hover actions (design §7.10) — INERT this step. */}
                <span className="hidden items-center gap-1 group-hover:inline-flex">
                  <button
                    type="button"
                    title="Mark urgent — coming in a later step"
                    className="inline-flex h-[23px] w-[23px] items-center justify-center rounded-[5px] border border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:text-gray-600"
                  >
                    <Zap size={12} />
                  </button>
                  <button
                    type="button"
                    title="Details — coming in a later step"
                    className="inline-flex h-[23px] w-[23px] items-center justify-center rounded-[5px] border border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:text-gray-600"
                  >
                    <MoreHorizontal size={12} />
                  </button>
                </span>
              </span>
            );
          }

          return (
            <tr key={row.orderId} className="group hover:bg-[#fafafa]">
              {interactive && (
                <td className={`${TD} text-center`}>
                  {/* INERT checkbox — waiting/with-picker only (design §7.8). */}
                  {pickable && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.obdNumber}`}
                      className="h-[13px] w-[13px] cursor-pointer align-middle accent-teal-600"
                    />
                  )}
                </td>
              )}
              {interactive && (
                <td className={`${TD} text-center text-[10.5px] text-[#9ca3af] tabular-nums`}>{st === "waiting" ? i + 1 : ""}</td>
              )}
              <td className={TD}>
                <span className="font-mono text-[11.5px] font-medium text-[#111827]">{row.obdNumber}</span>
                {(row.ageDays ?? 0) > 0 && (
                  <span className="ml-1.5 rounded-[3px] bg-[#f3f4f6] px-[5px] py-px text-[9.5px] font-bold text-[#6b7280]">{row.ageDays}d</span>
                )}
                <div className="text-[10px] text-[#9ca3af]">{fmtDateTime(obd)}</div>
              </td>
              <td className={TD}>
                <span className="text-[11.5px] font-medium text-[#111827]">{row.dealerName}</span>
                {row.isKeyCustomer && <span className="ml-1.5 text-[#f59e0b]">★</span>}
                {row.priorityLevel === 1 && <span className="ml-1 text-[#ef4444]">⚡</span>}
                {isSite && <Building2 size={12} className="ml-1 inline-block align-[-1px] text-[#475569]" />}
                {row.isTint && <Droplet size={12} className="ml-1 inline-block align-[-1px] text-[#7c3aed]" />}
                {isSite && <div className="text-[10.5px] text-[#9ca3af]">billed to {row.billToName ?? "—"}</div>}
                {isRedirect && <div className="text-[11px] text-[#6d28d9]">→ ship-to changed</div>}
              </td>
              <td className={TD}>{row.route ?? "—"}</td>
              <td className={`${TD} text-right tabular-nums`}>{row.volumeLitres ?? 0}</td>
              <td className={`${TD} text-[10.5px] text-[#6b7280]`}>{row.articleTag ? formatArticleTag(row.articleTag) : "—"}</td>
              <td className={TD}>{row.assignedToName ?? <span className="text-[#9ca3af]">—</span>}</td>
              <td className={TD}>{statusCell}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
