"use client";

// Tint Manager — the Tint tab (2026-10-02, owner; locked mockup
// docs/mockups/tint-manager/tint-manager-tinting-tab-mockup.html v13).
//
// Top to bottom, one scroll, 24/28 padding, 20px between cards:
//   1. SUMMARY  — Tinted today · Still to tint · Pace · Average job (no bar).
//   2. OPERATORS — one row per operator the table groups by: avatar + status
//      dot, name, "N in queue", live line · a day lane 08:00–20:00 (one block
//      per job of today; done green, tinting tint, paused striped amber; now
//      line) · litres done today + articles. Click a row = focus that operator
//      (violet edge + brand-50); click again or Esc (the page owns Esc) = all.
//   3. NOW & NEXT — one card; per operator a name line then that operator's
//      open rows (in progress → assigned queue → paused, the order rows.ts
//      already sorts), a grey band between operators.
//   4. DONE TODAY · {name} — only while an operator is focused; today's
//      finished jobs, first finished first.
//
// 🔴 THE TABLE IS THE LIVE BOARD'S, NOT THE MOCKUP'S (owner decision 1). Every
// row is board-table.tsx TintBoardRow — the same cells, Due cell, selection,
// rank rule (orders and splits are separate sequences, CLAUDE_TINT §1.3), the
// ▲▼ reorder (same route + queueSignature check, in the page) and ⋯. Only the
// row height (52px) differs. The mockup's columns and data are demo.
//
// Everything here is computed CLIENT-SIDE from the board payload's rows — no
// new query, no write. "Today" is the payload's own: completed rows are the
// ones the orders route returns for its start-of-today (unchanged basis).
//
// HISTORY (2026-10-02, round 2 step 3): with `historyDate` (a past IST day D)
// the payload holds only D's COMPLETED jobs (orders?date=D). The summary reads
// for D (tinted, jobs, pace first start → last finish, average job), the lanes
// draw D's done blocks with no now line, and Now & next is replaced by
// "Completed on {D}" — the same rows, read-only (no ▲▼, no ⋯, no selection).
//
// ⚠ PAUSES: the payload carries only the LATEST pause per order
// (pauseSummary), not the pause intervals, so a paused job is drawn as one
// striped amber block from startedAt to now, and finished jobs draw solid (any
// pauses inside them are not shown). And startedAt is RESET on resume
// (CLAUDE_TINT §3.8), so a resumed job's block starts at its last resume.

import { useEffect, useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { aggregateArticleTags } from "@/lib/article-tag-parse";
import type { DispatchSlotValue, DispatchWindow } from "@/components/floor/dispatch-slot-picker";
import { BoardColGroup, BoardHeadRow, TintBoardRow } from "./board-table";
import { hhmm } from "./board-bits";
import type { BoardGroup, BoardRow } from "./types";

// ── Clock helpers (IST — every time on this screen is depot-local) ───────────
const IST_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = 8 * 60;   // 08:00
const T1 = 20 * 60;  // 20:00

/** Minutes since IST midnight. */
function istMinutes(ms: number): number {
  return Math.floor((((ms + IST_MS) % DAY_MS) + DAY_MS) % DAY_MS / 60000);
}
/** IST calendar day index (for "is this today"). */
function istDay(ms: number): number {
  return Math.floor((ms + IST_MS) / DAY_MS);
}
function hm(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
const pct = (m: number) => Math.min(100, Math.max(0, ((m - T0) / (T1 - T0)) * 100));
const fmtL = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
/** "2 Drum, 3 Tin" → "2 Drum · 3 Tin"; NULL article tags never become zero. */
const artsOf = (rows: BoardRow[]) => aggregateArticleTags(rows.map((r) => r.articleTag))?.replace(/, /g, " · ") ?? "—";
const litresOf = (rows: BoardRow[]) => rows.reduce((n, r) => n + (r.volumeLitres ?? 0), 0);
const isDone = (r: BoardRow) => r.status === "tinting_done";
const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

/** A job's block on today's lane, in minutes-of-day, clipped to today. */
function blockOf(r: BoardRow, nowMs: number): { a: number; b: number } | null {
  const s = ms(r.startedAt);
  if (Number.isNaN(s)) return null;
  const today = istDay(nowMs);
  const e = isDone(r) ? ms(r.completedAt) : nowMs;
  if (Number.isNaN(e) || istDay(e) < today) return null;            // finished before today
  const a = istDay(s) < today ? 0 : istMinutes(s);                   // carried over → from midnight
  const b = istMinutes(e);
  return b >= a ? { a, b } : null;
}

export function BoardTintTab({
  groups, selection, onToggleRow, onOpenRow, onReorder, busyKeys,
  windows, canSlot, slotBusy, onSetSlot, barUp = false,
  focusedOperatorId, onFocusOperator, historyDate = null,
}: {
  groups:      BoardGroup[];
  selection:   Set<string>;
  onToggleRow: (row: BoardRow) => void;
  onOpenRow:   (row: BoardRow) => void;
  onReorder:   (row: BoardRow, direction: "up" | "down") => void;
  busyKeys:    Set<string>;
  windows:     DispatchWindow[];
  canSlot:     boolean;
  slotBusy:    boolean;
  onSetSlot:   (row: BoardRow, v: DispatchSlotValue) => void;
  barUp?:      boolean;
  /** The operator focused on the Operators card, or null for everyone. */
  focusedOperatorId: number | null;
  onFocusOperator:   (operatorId: number | null) => void;
  /** A past IST day "YYYY-MM-DD" — read-only history of that day. null = live. */
  historyDate?: string | null;
}) {
  // A minute clock for the now line, running blocks and the pace.
  const [liveNowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  // History: the clock is pinned to the last minute of day D, so blockOf / the
  // summary treat D as "today" and every block is a finished one.
  const nowMs = historyDate ? Date.parse(`${historyDate}T23:59:00+05:30`) : liveNowMs;
  const dayLabel = historyDate ? historyLabel(historyDate) : null;

  const focused = focusedOperatorId !== null ? groups.find((g) => g.operatorId === focusedOperatorId) ?? null : null;
  const shown = focused ? [focused] : groups;

  const rowProps = (r: BoardRow) => ({
    row:       r,
    selected:  selection.has(r.key),
    onToggle:  () => onToggleRow(r),
    onOpen:    () => onOpenRow(r),
    onReorder,
    busy:      busyKeys.has(r.key),
    windows,
    canSlot,
    slotBusy,
    onSetSlot: (v: DispatchSlotValue) => onSetSlot(r, v),
    tall:      true,
    readOnly:  historyDate !== null,
  });

  const openOf = (g: BoardGroup) => g.rows.filter((r) => !isDone(r));
  const nnJobs = shown.reduce((n, g) => n + openOf(g).length, 0);
  const nnL    = shown.reduce((n, g) => n + litresOf(openOf(g)), 0);

  return (
    <div className={cn("flex-1 overflow-y-auto bg-white", barUp && "pb-[96px]")}>
      {/* Full pane width, like the Base / Hold / CI tabs (no max-width cap,
          2026-10-02); the 24/28 gutter is the mockup's page padding. */}
      <div className="flex flex-col gap-5 px-7 pt-6 pb-12">
        <SummaryCard groups={groups} nowMs={nowMs} history={historyDate !== null} />
        <OperatorsCard groups={groups} nowMs={nowMs} focusedId={focused?.operatorId ?? null} onFocus={onFocusOperator} history={historyDate !== null} />

        {/* ── History: Completed on D (replaces Now & next) ─────────────────── */}
        {historyDate !== null && (() => {
          const doneOf = (g: BoardGroup) => g.rows.filter(isDone).sort((a, b) => (ms(a.completedAt) || 0) - (ms(b.completedAt) || 0));
          const all = shown.flatMap(doneOf);
          return (
            <section className="overflow-hidden rounded-[14px] border border-ink-100 bg-white">
              <div className="flex items-center justify-between border-b border-[#EEEDF3] px-5 py-3.5">
                <h3 className="text-[14px] font-bold tracking-[-.01em] text-ink-900">Completed on {dayLabel}</h3>
                <span className="text-[12px] text-ink-500">
                  {all.length} {all.length === 1 ? "job" : "jobs"} · {fmtL(litresOf(all))} L · first finished first
                </span>
              </div>
              {shown.length === 0 && (
                <p className="px-5 py-7 text-center text-[12px] text-ink-400">No job finished on {dayLabel}.</p>
              )}
              {shown.map((g, i) => {
                const done = doneOf(g);
                return (
                  <div key={g.operatorId}>
                    {i > 0 && <div className="h-[18px] border-y border-ink-100 bg-ink-25" />}
                    <div className="flex items-baseline gap-2.5 px-5 pt-3.5 pb-1 text-[13.5px] font-bold text-ink-900">
                      <span>{g.operatorName}</span>
                      <span className="text-[12px] font-medium text-ink-500">
                        {done.length} {done.length === 1 ? "job" : "jobs"} · {fmtL(litresOf(done))} L
                      </span>
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                      <BoardColGroup />
                      <thead><BoardHeadRow /></thead>
                      <tbody>{done.map((r) => <TintBoardRow key={r.key} {...rowProps(r)} />)}</tbody>
                    </table>
                  </div>
                );
              })}
            </section>
          );
        })()}

        {/* ── Now & next ───────────────────────────────────────────────────── */}
        {historyDate === null && <section className="overflow-hidden rounded-[14px] border border-ink-100 bg-white">
          <div className="flex items-center justify-between border-b border-[#EEEDF3] px-5 py-3.5">
            <h3 className="text-[14px] font-bold tracking-[-.01em] text-ink-900">Now &amp; next</h3>
            <span className="text-[12px] text-ink-500">
              {nnJobs} {nnJobs === 1 ? "job" : "jobs"} · {fmtL(nnL)} L · hover a row for ▲▼
            </span>
          </div>
          {shown.length === 0 && (
            <p className="px-5 py-7 text-center text-[12px] text-ink-400">Nothing on the floor. Assign an OBD from the rail to get started.</p>
          )}
          {shown.map((g, i) => {
            const open = openOf(g);
            return (
              <div key={g.operatorId}>
                {i > 0 && <div className="h-[18px] border-y border-ink-100 bg-ink-25" />}
                <div className="flex items-baseline gap-2.5 px-5 pt-3.5 pb-1 text-[13.5px] font-bold text-ink-900">
                  <span>{g.operatorName}</span>
                  <span className="text-[12px] font-medium text-ink-500">
                    {open.length} {open.length === 1 ? "job" : "jobs"} · {fmtL(litresOf(open))} L
                  </span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                  <BoardColGroup />
                  <thead><BoardHeadRow /></thead>
                  <tbody>
                    {open.length === 0 ? (
                      <tr><td colSpan={12} className="py-7 text-center text-[11.5px] text-ink-400">Nothing waiting</td></tr>
                    ) : (
                      open.map((r) => <TintBoardRow key={r.key} {...rowProps(r)} />)
                    )}
                  </tbody>
                </table>
              </div>
            );
          })}
        </section>}

        {/* ── Done today · {name} — only while focused (live only) ─────────── */}
        {historyDate === null && focused && (() => {
          const done = focused.rows
            .filter(isDone)
            .sort((a, b) => (ms(a.completedAt) || 0) - (ms(b.completedAt) || 0));
          return (
            <section className="overflow-hidden rounded-[14px] border border-ink-100 bg-white">
              <div className="flex items-center justify-between border-b border-[#EEEDF3] px-5 py-3.5">
                <h3 className="text-[14px] font-bold tracking-[-.01em] text-ink-900">Done today · {focused.operatorName}</h3>
                <span className="text-[12px] text-ink-500">
                  {done.length} {done.length === 1 ? "job" : "jobs"} · {fmtL(litresOf(done))} L · first finished first
                </span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                <BoardColGroup />
                <thead><BoardHeadRow /></thead>
                <tbody>
                  {done.length === 0 ? (
                    <tr><td colSpan={12} className="py-7 text-center text-[11.5px] text-ink-400">Nothing finished yet today</td></tr>
                  ) : (
                    done.map((r) => <TintBoardRow key={r.key} {...rowProps(r)} />)
                  )}
                </tbody>
              </table>
            </section>
          );
        })()}
      </div>
    </div>
  );
}

// ── 1. Summary ───────────────────────────────────────────────────────────────

function SummaryCard({ groups, nowMs, history = false }: { groups: BoardGroup[]; nowMs: number; history?: boolean }) {
  const s = useMemo(() => {
    const rows = groups.flatMap((g) => g.rows);
    const done = rows.filter(isDone);
    const open = rows.filter((r) => !isDone(r));
    const doneL = litresOf(done);
    const today = istDay(nowMs);
    // Pace: litres done per hour since the FIRST job start today (any status).
    const starts = rows.map((r) => ms(r.startedAt)).filter((t) => !Number.isNaN(t) && istDay(t) === today);
    const first = starts.length > 0 ? Math.min(...starts) : null;
    // History: pace runs to the LAST finish on D, not to the end of the day.
    const finishes = done.map((r) => ms(r.completedAt)).filter((t) => !Number.isNaN(t));
    const until = history && finishes.length > 0 ? Math.max(...finishes) : nowMs;
    const hours = first !== null ? (until - first) / 3_600_000 : 0;
    const pace = first !== null && hours > 0 ? doneL / hours : null;
    // Average job: start → done minutes over today's finished jobs that carry both.
    const spans = done
      .map((r) => (ms(r.completedAt) - ms(r.startedAt)) / 60000)
      .filter((m) => Number.isFinite(m) && m >= 0);
    const avg = spans.length > 0 ? spans.reduce((a, b) => a + b, 0) / spans.length : null;
    const openOps = new Set(open.map((r) => r.operatorId)).size;
    const doneOps = new Set(done.map((r) => r.operatorId)).size;
    return { done, open, doneL, openL: litresOf(open), first, pace, avg, spans: spans.length, openOps, doneOps, until };
  }, [groups, nowMs, history]);

  const cell = "px-[22px] py-[18px] border-l border-[#EEEDF3] first:border-l-0";
  const label = "text-[11px] font-semibold uppercase tracking-[.05em] text-ink-400";
  const value = "mt-1.5 text-[26px] font-bold leading-none tracking-[-.02em] tabular-nums text-ink-900";
  const unit = "ml-[3px] text-[13px] font-medium tracking-normal text-ink-500";
  const sub = "mt-2 text-[12px] text-ink-500";

  return (
    <section className="overflow-hidden rounded-[14px] border border-ink-100 bg-white">
      <div className="grid grid-cols-4">
        <div className={cell}>
          <div className={label}>{history ? "Tinted that day" : "Tinted today"}</div>
          <div className={value}>{fmtL(s.doneL)}<small className={unit}>L</small></div>
          <div className={sub}>{s.done.length} {s.done.length === 1 ? "job" : "jobs"} · {artsOf(s.done)}</div>
        </div>
        {history ? (
          <div className={cell}>
            <div className={label}>Jobs</div>
            <div className={value}>{s.done.length}<small className={unit}>done</small></div>
            <div className={sub}>across {s.doneOps} {s.doneOps === 1 ? "operator" : "operators"}</div>
          </div>
        ) : (
          <div className={cell}>
            <div className={label}>Still to tint</div>
            <div className={value}>{fmtL(s.openL)}<small className={unit}>L</small></div>
            <div className={sub}>
              {s.open.length} {s.open.length === 1 ? "job" : "jobs"} across {s.openOps} {s.openOps === 1 ? "operator" : "operators"}
            </div>
          </div>
        )}
        <div className={cell}>
          <div className={label}>Pace</div>
          <div className={value}>{s.pace !== null ? fmtL(Math.round(s.pace)) : "—"}<small className={unit}>L / hr</small></div>
          <div className={sub}>
            {s.first === null ? (history ? "no job started that day" : "no job started today")
              : history ? `${hhmm(new Date(s.first).toISOString())} → ${hhmm(new Date(s.until).toISOString())}`
              : `since first job at ${hhmm(new Date(s.first).toISOString())}`}
          </div>
        </div>
        <div className={cell}>
          <div className={label}>Average job</div>
          <div className={value}>{s.avg !== null ? Math.round(s.avg) : "—"}<small className={unit}>min</small></div>
          <div className={sub}>start to done · {s.spans} {s.spans === 1 ? "job" : "jobs"}</div>
        </div>
      </div>
    </section>
  );
}

// ── 2. Operators ─────────────────────────────────────────────────────────────

function OperatorsCard({
  groups, nowMs, focusedId, onFocus, history = false,
}: {
  groups:    BoardGroup[];
  nowMs:     number;
  focusedId: number | null;
  onFocus:   (operatorId: number | null) => void;
  /** A past day: no now pill / line, "N done" instead of the queue, a done line. */
  history?:  boolean;
}) {
  const patternId = `paused-${useId().replace(/:/g, "")}`;
  const nowM = istMinutes(nowMs);
  const ticks: number[] = [];
  for (let m = T0; m <= T1; m += 120) ticks.push(m);

  return (
    <section className="overflow-hidden rounded-[14px] border border-ink-100 bg-white">
      {/* The striped "paused" fill, defined once for every lane on the card. */}
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" className="fill-warn-bg" />
            <rect width="3" height="6" className="fill-warn" />
          </pattern>
        </defs>
      </svg>

      <div className="flex items-center justify-between border-b border-[#EEEDF3] px-5 py-3.5">
        <h3 className="text-[14px] font-bold tracking-[-.01em] text-ink-900">Operators</h3>
        <div className="flex gap-4 text-[11.5px] text-ink-500">
          <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-[3px] bg-ok" />Done</span>
          <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-[3px] bg-tint-600" />Tinting</span>
          <span className="flex items-center gap-1.5">
            <svg width="10" height="10" aria-hidden="true"><rect width="10" height="10" rx="3" fill={`url(#${patternId})`} /></svg>
            Paused
          </span>
        </div>
      </div>

      {/* Header row — the time axis, 08:00–20:00 every 2 h, and the now pill. */}
      <div className="grid h-[30px] grid-cols-[300px_1fr_132px] items-center border-b border-[#EEEDF3] bg-ink-25 text-[11px] text-ink-400">
        <div className="pl-5 font-semibold uppercase tracking-[.05em]">Operator</div>
        <div className="relative mx-2 h-full">
          {ticks.map((m) => (
            <span key={m} className="absolute top-2 -translate-x-1/2" style={{ left: `${pct(m)}%` }}>{hm(m)}</span>
          ))}
          {!history && nowM >= T0 && nowM <= T1 && (
            <span
              className="absolute top-[5px] z-[2] -translate-x-1/2 rounded-[5px] bg-ink-900 px-1.5 py-px text-[10.5px] font-semibold text-white"
              style={{ left: `${pct(nowM)}%` }}
            >
              {hm(nowM)}
            </span>
          )}
        </div>
        <div className="pr-5 text-right font-semibold uppercase tracking-[.05em]">{history ? "That day" : "Today"}</div>
      </div>

      {groups.length === 0 && (
        <p className="px-5 py-6 text-center text-[12px] text-ink-400">No operator has a job on the board.</p>
      )}
      {groups.map((g) => {
        const running = g.rows.find((r) => r.status === "tinting_in_progress") ?? null;
        const paused  = running ? null : g.rows.find((r) => r.status === "paused") ?? null;
        const kind: "tinting" | "paused" | "idle" = running ? "tinting" : paused ? "paused" : "idle";
        const done = g.rows.filter(isDone);
        const queue = g.rows.filter((r) => !isDone(r)).length;
        const initials = g.operatorName.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
        const on = focusedId === g.operatorId;
        return (
          <div
            key={g.operatorId}
            role="button"
            tabIndex={0}
            aria-pressed={on}
            onClick={() => onFocus(on ? null : g.operatorId)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFocus(on ? null : g.operatorId); } }}
            className={cn(
              "relative grid min-h-[84px] cursor-pointer grid-cols-[300px_1fr_132px] border-b border-[#EEEDF3] transition-colors last:border-b-0",
              on ? "bg-brand-50 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-brand-600" : "hover:bg-ink-25",
            )}
          >
            {/* left — who */}
            <div className="flex min-w-0 items-center gap-3 py-3.5 pl-5 pr-4">
              <div className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-ink-100 bg-ink-50 text-[12.5px] font-bold text-ink-600">
                {initials}
                <span className={cn(
                  "absolute -bottom-px -right-px h-[11px] w-[11px] rounded-full border-2 border-white",
                  kind === "tinting" ? "bg-tint-600" : kind === "paused" ? "bg-warn" : "bg-ink-200",
                )} />
              </div>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2 text-[14.5px] font-bold text-ink-900">
                  <span className="truncate">{g.operatorName}</span>
                  <span className="flex-shrink-0 rounded-[5px] bg-ink-50 px-[7px] py-px text-[11.5px] font-semibold text-ink-500">
                    {history ? `${done.length} done` : `${queue} in queue`}
                  </span>
                </div>
                <div className={cn(
                  "mt-1 max-w-[220px] truncate text-[12px]",
                  kind === "tinting" ? "text-tint-700" : kind === "paused" ? "text-warn-text" : "text-ink-500",
                )}>
                  {history ? (
                    <>Last finished · {hhmm(done.reduce<string | null>((m, r) => (r.completedAt && (!m || r.completedAt > m) ? r.completedAt : m), null))}</>
                  ) : kind === "tinting" && running ? (
                    <><b className="font-bold">Tinting</b> · {running.siteName} · since {hhmm(running.startedAt)}</>
                  ) : kind === "paused" && paused ? (
                    <><b className="font-bold">Paused</b> · {paused.siteName} · {hhmm(paused.pausedAt)}</>
                  ) : (
                    <><b className="font-bold">Idle</b> · nothing running</>
                  )}
                </div>
              </div>
            </div>

            {/* middle — the day lane */}
            <div className="relative flex h-full items-center px-2">
              <DayLane rows={g.rows} nowMs={nowMs} patternId={patternId} showNow={!history} />
            </div>

            {/* right — today's output */}
            <div className="flex flex-col items-end justify-center pr-5 text-right">
              <b className="text-[18px] tracking-[-.01em] tabular-nums text-ink-900">{fmtL(litresOf(done))} L</b>
              <span className="text-[11.5px] text-ink-500">{artsOf(done)}</span>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function DayLane({ rows, nowMs, patternId, showNow = true }: { rows: BoardRow[]; nowMs: number; patternId: string; showNow?: boolean }) {
  const W = 1000, H = 36;
  const x = (m: number) => (pct(m) / 100) * W;
  const nowM = istMinutes(nowMs);
  const grid: number[] = [];
  for (let m = T0 + 60; m < T1; m += 60) grid.push(m);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" className="block overflow-visible">
      <rect x="0" y="4" width={W} height={H - 8} rx="8" className="fill-ink-25 stroke-ink-50" vectorEffect="non-scaling-stroke" />
      {grid.map((m) => (
        <line key={m} x1={x(m)} x2={x(m)} y1="4" y2={H - 4} className={(m / 60) % 2 === 0 ? "stroke-ink-100" : "stroke-ink-50"} vectorEffect="non-scaling-stroke" />
      ))}
      {rows.map((r) => {
        const blk = blockOf(r, nowMs);
        if (!blk || blk.b < T0 || blk.a > T1) return null;
        const a = Math.max(blk.a, T0), b = Math.min(blk.b, T1);
        const width = Math.max(6, x(b) - x(a) - 3);
        const mins = blk.b - blk.a;
        const tip = `${r.obdNumber} · ${r.siteName}\n${fmtL(r.volumeLitres ?? 0)} L · ${r.articleTag ?? "—"}\n` +
          `${hm(blk.a)} → ${isDone(r) ? hm(blk.b) : "now"} · ${mins} min` +
          (r.status === "paused" ? "\nPaused — drawn from the last start (pause intervals are not on the board)" : "");
        return (
          <rect
            key={r.key}
            x={x(a) + 1.5}
            y="9"
            width={width}
            height={H - 18}
            rx="4"
            className={isDone(r) ? "fill-ok" : r.status === "tinting_in_progress" ? "fill-tint-600" : undefined}
            fill={r.status === "paused" ? `url(#${patternId})` : undefined}
          >
            <title>{tip}</title>
          </rect>
        );
      })}
      {showNow && nowM >= T0 && nowM <= T1 && (
        <line x1={x(nowM)} x2={x(nowM)} y1="0" y2={H} className="stroke-ink-900" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

/** "Wed · 30 Sep" for an IST day "YYYY-MM-DD" — the stepper's history label. */
function historyLabel(date: string): string {
  const d = new Date(`${date}T12:00:00+05:30`);
  const wd = d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" });
  const dm = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
  return `${wd} · ${dm}`;
}
