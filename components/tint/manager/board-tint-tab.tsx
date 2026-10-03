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
// PAUSES (2026-10-03): the payload now carries each job's work and pause
// segments (row.track, lib/tint/job-track.ts), so the Operators card draws two
// tracks per operator — work on top, pauses below — instead of one striped block
// from the last resume to now. The tables gain a FORMULA column (TI values).

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { formulaRows, type PauseSegment, type WorkSegment } from "@/lib/tint/job-track";
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
// Litres / articles are TINT LINES ONLY since 2026-10-02: every row's
// volumeLitres + articleTag come from lib/tint/tint-lines.ts (via rows.ts).
const litresOf = (rows: BoardRow[]) => rows.reduce((n, r) => n + (r.volumeLitres ?? 0), 0);
const isDone = (r: BoardRow) => r.status === "tinting_done";
const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

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
  // History: the clock is pinned to the last minute of day D, so the lanes / the
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
    showFormula: true,
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
                      <BoardColGroup formula />
                      <thead><BoardHeadRow formula /></thead>
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
                  <BoardColGroup formula />
                  <thead><BoardHeadRow formula /></thead>
                  <tbody>
                    {open.length === 0 ? (
                      <tr><td colSpan={13} className="py-7 text-center text-[11.5px] text-ink-400">Nothing waiting</td></tr>
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
                <BoardColGroup formula />
                <thead><BoardHeadRow formula /></thead>
                <tbody>
                  {done.length === 0 ? (
                    <tr><td colSpan={13} className="py-7 text-center text-[11.5px] text-ink-400">Nothing finished yet today</td></tr>
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

/**
 * PACE — ONE rule for the top card and each operator (2026-10-02): tint litres
 * of the finished jobs ÷ hours from the FIRST job start on the day (any status)
 * to now — on a history day, to the LAST finish. Null with no start or no time.
 */
function paceOf(rows: BoardRow[], nowMs: number, history: boolean) {
  const done = rows.filter(isDone);
  const day = istDay(nowMs);
  const starts = rows.map((r) => ms(r.startedAt)).filter((t) => !Number.isNaN(t) && istDay(t) === day);
  const first = starts.length > 0 ? Math.min(...starts) : null;
  const finishes = done.map((r) => ms(r.completedAt)).filter((t) => !Number.isNaN(t));
  const until = history && finishes.length > 0 ? Math.max(...finishes) : nowMs;
  const hours = first !== null ? (until - first) / 3_600_000 : 0;
  const pace = first !== null && hours > 0 ? litresOf(done) / hours : null;
  return { pace, first, until };
}

// ── 1. Summary ───────────────────────────────────────────────────────────────

function SummaryCard({ groups, nowMs, history = false }: { groups: BoardGroup[]; nowMs: number; history?: boolean }) {
  const s = useMemo(() => {
    const rows = groups.flatMap((g) => g.rows);
    const done = rows.filter(isDone);
    const open = rows.filter((r) => !isDone(r));
    const doneL = litresOf(done);
    // Pace: tint litres done per hour since the FIRST job start (paceOf).
    const { pace, first, until } = paceOf(rows, nowMs, history);
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
              {s.open.length} {s.open.length === 1 ? "job" : "jobs"} · {artsOf(s.open)} · {s.openOps} {s.openOps === 1 ? "operator" : "operators"}
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
//
// TWO TRACKS PER OPERATOR (2026-10-03, owner; mockup
// docs/mockups/tint-manager/tint-manager-operators-compact-mockup.html), like a
// video editor, inside ONE very light block 08:00–20:00 with faint hour lines:
//   top    — WORK segments: green = a finished job, blue = the job tinting now
//            (to the now line). A paused-and-resumed job shows each of its runs.
//            The runs a still-PAUSED job has done so far draw blue at 40%.
//   bottom — PAUSE segments: orange stripes, pausedAt → resumedAt (or now). Drawn
//            only when the operator has one in view; the block keeps the same
//            height either way, so every operator row lines up.
// Segments come from the payload (row.track — lib/tint/job-track.ts). A split
// never pauses, so it has no track: its one run is startedAt → completedAt/now.
// Hover any block → a card that follows the cursor (HoverCard below): a WORK
// block shows that stretch + the job's total worked, a PAUSE block the pause.
// Hovering any piece of a job outlines EVERY piece of it, on both tracks
// (2026-10-03 round 3), so the pieces read as one bill.
// Drawing: each block is inset 1px a side (a 2px gap between touching blocks;
// times never shift) and is at least 6px wide, centred on its real time.

/** The five reason labels, as the owner worded them for this board (2026-10-03).
 *  lib/tint/pause-reasons.ts keeps its own wording for the operator screens. */
const REASON_LABEL: Record<string, string> = {
  lunch_break:       "Lunch break",
  shift_end:         "Shift end",
  machine_breakdown: "Machine breakdown",
  material_shortage: "Material shortage",
  urgent_priority:   "Urgent priority",
};

const STRIPES = "repeating-linear-gradient(135deg, #D97706 0 5px, #FDE7C2 5px 9px)";

type BlockKind = "done" | "tinting" | "pausedWork" | "pause";
interface Block {
  key:   string;
  kind:  BlockKind;
  /** Minutes of the day, fractional, already clipped to 08:00–20:00. */
  a:     number;
  b:     number;
  row:   BoardRow;
  pause: PauseSegment | null;
  /** The real (unclipped) work stretch, for a work block. */
  work:  WorkSegment | null;
}
interface Hover { row: BoardRow; pause: PauseSegment | null; work: WorkSegment | null; x: number; y: number }

/** Minutes since IST midnight of the lane's day, or null when outside that day. */
function clipToDay(fromIso: string, toIso: string | null, nowMs: number): { a: number; b: number } | null {
  const dayStart = istDay(nowMs) * DAY_MS - IST_MS;
  const s = ms(fromIso);
  const e = toIso ? ms(toIso) : nowMs;
  if (Number.isNaN(s) || Number.isNaN(e) || e < dayStart || s > dayStart + DAY_MS) return null;
  const a = Math.max(T0, (Math.max(s, dayStart) - dayStart) / 60000);
  const b = Math.min(T1, (Math.min(e, dayStart + DAY_MS) - dayStart) / 60000);
  return b >= a ? { a, b } : null;
}

/** A row's work runs — the payload's track, or a split's single run. */
function workOf(r: BoardRow): WorkSegment[] {
  if (r.track) return r.track.work;
  if (!r.startedAt || r.status === "assigned" || r.status === "paused") return [];
  return [{ from: r.startedAt, to: isDone(r) ? r.completedAt : null }];
}

function blocksOf(rows: BoardRow[], nowMs: number): { work: Block[]; pauses: Block[] } {
  const work: Block[] = [];
  const pauses: Block[] = [];
  for (const r of rows) {
    const kind: BlockKind = isDone(r) ? "done" : r.status === "tinting_in_progress" ? "tinting" : "pausedWork";
    workOf(r).forEach((s, i) => {
      const c = clipToDay(s.from, s.to, nowMs);
      if (c) work.push({ key: `${r.key}-w${i}`, kind, ...c, row: r, pause: null, work: s });
    });
    (r.track?.pauses ?? []).forEach((p, i) => {
      const c = clipToDay(p.from, p.to, nowMs);
      if (c) pauses.push({ key: `${r.key}-p${i}`, kind: "pause", ...c, row: r, pause: p, work: null });
    });
  }
  return { work, pauses };
}

function OperatorsCard({
  groups, nowMs, focusedId, onFocus, history = false,
}: {
  groups:    BoardGroup[];
  nowMs:     number;
  focusedId: number | null;
  onFocus:   (operatorId: number | null) => void;
  /** A past day: no now pill / line. */
  history?:  boolean;
}) {
  const nowM = istMinutes(nowMs);
  const ticks: number[] = [];
  for (let m = T0; m <= T1; m += 120) ticks.push(m);
  const [hover, setHover] = useState<Hover | null>(null);

  return (
    <section className="overflow-hidden rounded-[14px] border border-ink-100 bg-white">
      <div className="flex items-center justify-between border-b border-[#EEEDF3] px-5 py-3.5">
        <h3 className="text-[14px] font-bold tracking-[-.01em] text-ink-900">Operators</h3>
        <div className="flex gap-4 text-[11.5px] text-ink-500">
          <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-[3px] bg-ok" />Done</span>
          <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-[3px] bg-tint-600" />Tinting</span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: "repeating-linear-gradient(135deg, #D97706 0 3px, #FDE7C2 3px 5px)" }} />
            Paused
          </span>
        </div>
      </div>

      {/* Header row — the time axis, 08:00–20:00 every 2 h, and the now pill. */}
      <div className="grid h-[30px] grid-cols-[240px_1fr_130px] items-center border-b border-[#EEEDF3] bg-ink-25 text-[11px] text-ink-400">
        <div className="pl-5 font-semibold uppercase tracking-[.05em]">Operator</div>
        <div className="relative mx-2.5 h-full">
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
              "relative grid cursor-pointer grid-cols-[240px_1fr_130px] items-center border-b border-[#EEEDF3] py-3 transition-colors last:border-b-0",
              on ? "bg-brand-50 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-brand-600" : "hover:bg-ink-25",
            )}
          >
            {/* left — who, and ONE status word */}
            <div className="flex min-w-0 items-center gap-2.5 px-5">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-ink-50 text-[12px] font-bold text-ink-600">
                {initials}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-bold text-ink-900">{g.operatorName}</div>
                <div className={cn(
                  "mt-0.5 flex items-center gap-1.5 text-[12px]",
                  kind === "tinting" ? "font-semibold text-tint-600" : kind === "paused" ? "font-semibold text-warn" : "text-ink-500",
                )}>
                  <i className={cn(
                    "inline-block h-[7px] w-[7px] rounded-full",
                    kind === "tinting" ? "bg-tint-600" : kind === "paused" ? "bg-warn" : "bg-ink-200",
                  )} />
                  {kind === "tinting" ? "Tinting" : kind === "paused" ? "Paused" : "Idle"}
                </div>
              </div>
            </div>

            {/* middle — the two tracks */}
            <Tracks rows={g.rows} nowMs={nowMs} showNow={!history} onHover={setHover} activeKey={hover?.row.key ?? null} />

            {/* right — this operator's tinted litres (tint lines only) + their own
                pace (paceOf, the top card's rule). "—" before a finished job. */}
            <div className="flex flex-col items-end justify-center pr-5 text-right" title={artsOf(done)}>
              <b className="text-[15px] tracking-[-.01em] tabular-nums text-ink-900">{fmtL(litresOf(done))} L</b>
              <span className="text-[11px] text-ink-500">
                {(() => {
                  const p = done.length > 0 ? paceOf(g.rows, nowMs, history).pace : null;
                  return p !== null ? `avg ${fmtL(Math.round(p))} L/hr` : "—";
                })()}
              </span>
            </div>
          </div>
        );
      })}
      {hover && <HoverCard hover={hover} nowMs={nowMs} />}
    </section>
  );
}

function Tracks({
  rows, nowMs, showNow, onHover, activeKey,
}: {
  rows:    BoardRow[];
  nowMs:   number;
  showNow: boolean;
  onHover: (h: Hover | null) => void;
  /** The hovered job's row key — every piece of it is outlined. */
  activeKey: string | null;
}) {
  const { work, pauses } = useMemo(() => blocksOf(rows, nowMs), [rows, nowMs]);
  const nowM = istMinutes(nowMs);
  const hours: number[] = [];
  for (let m = T0 + 60; m < T1; m += 60) hours.push(m);

  const block = (b: Block) => {
    const w = pct(b.b) - pct(b.a);
    const mid = (pct(b.a) + pct(b.b)) / 2;
    const active = b.row.key === activeKey;
    // SHORT (real duration under 5 min, 2026-10-03): same colour, at least 10px
    // wide, centred on its time, drawn ABOVE its neighbours with a 3px ring in
    // the track's own background (ink-25) — clear space either side, so a short
    // job between two pieces of another same-colour job reads without hover.
    const seg = b.pause ?? b.work;
    const realMin = seg ? ((seg.to ? ms(seg.to) : nowMs) - ms(seg.from)) / 60000 : Infinity;
    const short = realMin < 5;
    const minPx = short ? 10 : 6;
    return (
      <div
        key={b.key}
        className={cn(
          "absolute inset-y-0 rounded-[3px]",
          short && "z-[4]",
          active && (short ? "z-[5] brightness-110" : "z-[3] brightness-110 shadow-[0_0_0_2px_#fff,0_0_0_3px_#1B1826]"),
          b.kind === "done" ? "bg-ok" : b.kind === "tinting" ? "bg-tint-600" : b.kind === "pausedWork" ? "bg-tint-600/40" : undefined,
        )}
        style={{
          // Inset 1px a side (the 2px gap), never under 6px (10px if short), centred on its time.
          width: `max(${minPx}px, calc(${w}% - 2px))`,
          left:  `calc(${mid}% - max(${minPx / 2}px, calc(${w / 2}% - 1px)))`,
          ...(b.kind === "pause" ? { background: STRIPES } : {}),
          // The ring (and, when its job is hovered, the same dark outline outside it).
          ...(short ? { boxShadow: active ? "0 0 0 3px #FAFAFC, 0 0 0 4px #1B1826" : "0 0 0 3px #FAFAFC" } : {}),
        }}
        onMouseMove={(e) => onHover({ row: b.row, pause: b.pause, work: b.work, x: e.clientX, y: e.clientY })}
        onMouseLeave={() => onHover(null)}
      />
    );
  };

  return (
    <div className="relative mx-2.5 h-[44px] rounded-md bg-ink-25">
      {hours.map((m) => (
        <span key={m} className="absolute inset-y-0 w-px bg-[#F0EFF5]" style={{ left: `${pct(m)}%` }} />
      ))}
      {/* top track — work */}
      <div className="absolute inset-x-0 top-[6px] h-4">{work.map(block)}</div>
      {/* bottom track — pauses, only when there is one */}
      {pauses.length > 0 && <div className="absolute inset-x-0 top-[27px] h-2.5">{pauses.map(block)}</div>}
      {showNow && nowM >= T0 && nowM <= T1 && (
        <span className="pointer-events-none absolute -top-2 -bottom-2 z-[2] w-0.5 -translate-x-px bg-ink-900" style={{ left: `${pct(nowM)}%` }} />
      )}
    </div>
  );
}

// ── Hover card ───────────────────────────────────────────────────────────────

/** "1 h 38 min" / "32 min" / "under 1 min" (never "0 min"). */
function fmtDur(min: number): string {
  if (!(min >= 1)) return "under 1 min";
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
/** "11:55", or "15 Sep 11:55" when not on the lane's day. */
function atOf(iso: string, nowMs: number): string {
  if (istDay(ms(iso)) === istDay(nowMs)) return hhmm(iso);
  const d = new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
  return `${d} ${hhmm(iso)}`;
}

function HoverCard({ hover, nowMs }: { hover: Hover; nowMs: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { row, x, y } = hover;
  // Follow the cursor, never off screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(x + 14, window.innerWidth - w - 10))}px`;
    el.style.top  = `${Math.max(8, Math.min(y + 16, window.innerHeight - h - 10))}px`;
  });

  // A PAUSE block shows the pause card; every WORK block — green, blue or a
  // paused job's faded blue — shows the work card, its pill the job's state.
  const pause = hover.pause;
  const state: "done" | "tinting" | "paused" = isDone(row) ? "done" : row.status === "paused" ? "paused" : "tinting";
  const tint = `${fmtL(row.volumeLitres ?? 0)} L · ${row.articleTag?.replace(/, /g, " · ") ?? "—"}`;
  const minsOf = (seg: WorkSegment) => ((seg.to ? ms(seg.to) : nowMs) - ms(seg.from)) / 60000;

  const label = "text-ink-400";
  const grid  = "mt-2.5 grid grid-cols-[84px_1fr] gap-x-2 gap-y-1 border-t border-[#EEEDF3] pt-2.5 text-[12px]";

  let body: ReactNode;
  if (pause) {
    const forMin = ((pause.to ? ms(pause.to) : nowMs) - ms(pause.from)) / 60000;
    body = (
      <>
        <div className="mt-2 inline-block rounded-[5px] border border-[#FDE68A] bg-warn-bg px-2 py-0.5 text-[11.5px] font-bold text-warn-text">
          ⏸ {REASON_LABEL[pause.reason] ?? pause.reason}
        </div>
        {pause.remark && <div className="mt-1 text-[12px] italic text-ink-600">“{pause.remark}”</div>}
        <div className={grid}>
          <span className={label}>Tint</span><b>{tint}</b>
          <span className={label}>Paused</span>
          <b>{pause.to ? `${atOf(pause.from, nowMs)} – ${atOf(pause.to, nowMs)}` : `since ${atOf(pause.from, nowMs)}`}</b>
          <span className={label}>For</span><b>{fmtDur(forMin)}</b>
          <span className={label}>Progress</span>
          <b>{pause.progress ? `${pause.progress.done} of ${pause.progress.total} ${pause.progress.unit} done` : "—"}</b>
        </div>
      </>
    );
  } else {
    // Total worked: a finished job's accumulatedMinutes (its canonical total,
    // pauses excluded); otherwise the sum of its work stretches (open one to now).
    const sumMin = workOf(row).reduce((n, seg) => n + minsOf(seg), 0);
    const totalMin = state === "done" ? (row.accumulatedMinutes ?? sumMin) : sumMin;
    const seg = hover.work;
    const lines = formulaRows(row.formula);
    body = (
      <>
        <div className={grid}>
          <span className={label}>Tint</span><b>{tint}</b>
          <span className={label}>Worked</span>
          <b>{seg ? `${atOf(seg.from, nowMs)} – ${seg.to ? atOf(seg.to, nowMs) : "now"} · ${fmtDur(minsOf(seg))}` : "—"}</b>
          <span className={label}>Total worked</span>
          <b>{fmtDur(totalMin)}{state === "tinting" ? " so far" : ""}</b>
        </div>
        {state !== "paused" && (
          <div className="mt-2.5 border-t border-[#EEEDF3] pt-2.5">
            <div className="mb-1 text-[10.5px] font-bold uppercase tracking-[.05em] text-ink-400">Formula</div>
            {lines.length === 0 ? (
              <div className="text-[12px] text-ink-400">No TI saved yet</div>
            ) : (
              lines.map((t, i) => (
                <div key={i} className="font-mono text-[12.5px] font-semibold text-ink-900">{t}</div>
              ))
            )}
          </div>
        )}
      </>
    );
  }

  return createPortal(
    <div
      ref={ref}
      className="pointer-events-none fixed z-[60] w-[330px] rounded-xl border border-ink-100 bg-white px-3.5 py-3 text-ink-900 shadow-[0_14px_32px_rgba(27,24,38,.16)]"
      style={{ left: x + 14, top: y + 16 }}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <b className="font-mono text-[12.5px]">{row.obdNumber}</b>
        <span className={cn(
          "rounded-[5px] px-[7px] py-0.5 text-[10.5px] font-bold",
          state === "done" ? "bg-ok-bg text-ok-text" : state === "tinting" ? "bg-tint-bg text-tint-700" : "bg-warn-bg text-warn-text",
        )}>
          {state === "done" ? "Done" : state === "tinting" ? "Tinting" : "Paused"}
        </span>
      </div>
      <div className="text-[13.5px] font-bold">{row.siteName}</div>
      <div className="mt-px text-[12px] text-ink-500">billed to {row.billToName ?? "—"}</div>
      {body}
    </div>,
    document.body,
  );
}

/** "Wed · 30 Sep" for an IST day "YYYY-MM-DD" — the stepper's history label. */
function historyLabel(date: string): string {
  const d = new Date(`${date}T12:00:00+05:30`);
  const wd = d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" });
  const dm = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
  return `${wd} · ${dm}`;
}
