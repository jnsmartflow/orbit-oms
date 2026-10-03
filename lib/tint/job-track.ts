// lib/tint/job-track.ts — a tint job's WORK and PAUSE segments, and a bill's
// FORMULA lines, for the Tint Manager's Tint tab (2026-10-03).
//
// PURE — no prisma, no clock. The orders route reads the rows (batched) and
// calls these; the operator board and the Formula column read the result.
//
// ── Segments: what is stored, and how a job's timeline is rebuilt ───────────
// tint_assignments.startedAt is RESET to "now" on every resume (resume route,
// CLAUDE_TINT §3.8), so on a resumed job it is the LAST run's start. The rest
// comes from tint_pause_events, one row per pause:
//   pausedAt              — the run ends / the pause starts (exact)
//   resumedAt             — the pause ends / the next run starts (exact; null = still paused)
//   elapsedMinutesAtPause — minutes of THAT run only, floored
//                           (pause route: minutesSinceRunStart — NOT cumulative,
//                           whatever CLAUDE_TINT §5 step 5 says; the code wins)
// The FIRST run's start is not on either row once a job has paused. It IS on
// tint_logs (action "started", written once by the start route); the route
// passes that in. Without it, it is derived as first pausedAt −
// elapsedMinutesAtPause (floored, so up to a minute late).
//
//   work  = [firstStart → pause1], [resume1 → pause2], …, [last start → done / now]
//   pause = [pause1 → resume1], …, [pauseN → resumeN or now]

export interface WorkSegment {
  from: string;
  /** null = still running (draw to now). */
  to:   string | null;
}

export interface PauseProgress {
  done:  number;
  total: number;
  /** "Drum" when every line's article tag counts the same thing as its units; else "tins". */
  unit:  string;
}

export interface PauseSegment {
  from:     string;
  /** null = still paused (draw to now). */
  to:       string | null;
  reason:   string;
  remark:   string | null;
  progress: PauseProgress | null;
}

export interface JobTrack {
  work:   WorkSegment[];
  pauses: PauseSegment[];
}

export interface PauseEventLike {
  pausedAt:              Date;
  resumedAt:             Date | null;
  elapsedMinutesAtPause: number;
  pauseReason:           string;
  pauseRemark:           string | null;
  progressSnapshot:      unknown;
}

export interface LineUnitLike {
  unitQty:    number;
  articleTag: string | null;
}

/** "6 of 20 Drum" from a pause's progressSnapshot ({ items: [{ skuId, doneQty }] },
 *  skuId = import_raw_line_items.id). Null when the snapshot has no items. */
export function progressOf(snapshot: unknown, lineById: Map<number, LineUnitLike>): PauseProgress | null {
  const items = (snapshot as { items?: Array<{ skuId: number; doneQty: number }> } | null)?.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  let done = 0, total = 0;
  const units = new Set<string>();
  let unitsOk = true;
  for (const it of items) {
    done += Number(it.doneQty) || 0;
    const line = lineById.get(it.skuId);
    if (!line) { unitsOk = false; continue; }
    total += line.unitQty;
    // "80 Drum" counts drums; use the word only when that count IS the unit qty.
    const m = /^\s*([\d.]+)\s+(.+?)\s*$/.exec(line.articleTag ?? "");
    if (m && Number(m[1]) === line.unitQty) units.add(m[2]);
    else unitsOk = false;
  }
  if (total === 0) return null;
  return { done, total, unit: unitsOk && units.size === 1 ? Array.from(units)[0] : "tins" };
}

/**
 * Rebuild one whole-OBD assignment's segments.
 * `firstStartLog` = the tint_logs "started" time for this assignment, if known.
 */
export function buildJobTrack(
  asg: { status: string; startedAt: Date | null; completedAt: Date | null },
  events: readonly PauseEventLike[],
  firstStartLog: Date | null,
  lineById: Map<number, LineUnitLike>,
): JobTrack | null {
  if (!asg.startedAt) return null;
  const sorted = [...events].sort((a, b) => a.pausedAt.getTime() - b.pausedAt.getTime());
  const work: WorkSegment[] = [];
  const pauses: PauseSegment[] = [];

  let runStart: Date | null = sorted.length === 0
    ? asg.startedAt
    : firstStartLog && firstStartLog.getTime() <= sorted[0].pausedAt.getTime()
      ? firstStartLog
      : new Date(sorted[0].pausedAt.getTime() - sorted[0].elapsedMinutesAtPause * 60_000);

  for (const e of sorted) {
    if (runStart) work.push({ from: runStart.toISOString(), to: e.pausedAt.toISOString() });
    pauses.push({
      from:     e.pausedAt.toISOString(),
      to:       e.resumedAt ? e.resumedAt.toISOString() : null,
      reason:   e.pauseReason,
      remark:   e.pauseRemark?.trim() || null,
      progress: progressOf(e.progressSnapshot, lineById),
    });
    runStart = e.resumedAt;
  }

  // The last run — startedAt IS its start (the resume reset it).
  if (asg.status === "tinting_done" && asg.completedAt) {
    work.push({ from: asg.startedAt.toISOString(), to: asg.completedAt.toISOString() });
  } else if (asg.status === "tinting_in_progress") {
    work.push({ from: asg.startedAt.toISOString(), to: null });
  }
  return { work, pauses };
}

// ── Formula ──────────────────────────────────────────────────────────────────
// Pigment columns in REGISTER order (CLAUDE_TINT §3.5 / §11 — the same arrays as
// components/tint/ti-report-content.tsx). TINTER = tinter_issue_entries,
// ACOTONE = tinter_issue_entries_b.
export const TINTER_REGISTER  = ["YOX", "LFY", "GRN", "TBL", "WHT", "MAG", "FFR", "BLK", "OXR", "HEY", "HER", "COB", "COG"] as const;
export const ACOTONE_REGISTER = ["WH1", "NO1", "NO2", "YE1", "YE2", "XY1", "RE1", "RE2", "XR1", "MA1", "OR1", "GR1", "BU1", "BU2"] as const;

export interface FormulaLine {
  rawLineItemId: number | null;
  /** Non-zero pigments in register order: [code, value]. */
  pigments:      Array<[string, number]>;
}

/** Non-zero pigment values of one TI row, in register order. */
export function pigmentsOf(row: Record<string, unknown>, register: readonly string[]): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const code of register) {
    const v = Number(row[code] ?? 0);
    if (Number.isFinite(v) && v !== 0) out.push([code, v]);
  }
  return out;
}

/** "OXR 100 · WHT 20" — values only, no sampling number, shade or SKU. */
export function formulaText(line: FormulaLine): string {
  return line.pigments.map(([c, v]) => `${c} ${Math.round(v * 100) / 100}`).join(" · ");
}
