// Shared elapsed-time math for tint assignment displays. Used by:
//   - components/tint/tint-operator-content.tsx (HH:MM:SS live timer)
//   - components/tint/tint-table-view.tsx       ("Xh Ym" badge)
//
// Both surfaces previously read startedAt alone, which broke after a
// pause/resume cycle: the resume route resets startedAt to "now", so
// the displayed elapsed reset to 00:00 — losing all prior accumulated
// time. This helper folds in accumulatedMinutes (the canonical "time
// tinted across prior runs") so the displayed total stays continuous.
//
// Pure function — no React imports, no module-level globals. Safe to
// import from server or client.

interface ComputeElapsedArgs {
  /** tint_assignments.status — "tinting_in_progress", "paused", … */
  status:             string;
  /** ISO string (with or without trailing Z) or Date; null while never started. */
  startedAt:          string | Date | null;
  /** Sum of all prior run deltas, captured at each pause and finalised on done. */
  accumulatedMinutes: number;
  /** Injectable for deterministic tests. Defaults to Date.now(). */
  nowMs?:             number;
}

/**
 * Compute the canonical elapsed milliseconds for a tint assignment.
 *
 * - Running (`tinting_in_progress`): `accumulatedMinutes × 60000 + (now − startedAt)`. Ticks continuously.
 * - Paused: `accumulatedMinutes × 60000`. Frozen — no live tick.
 * - Any other state, or running without `startedAt`: returns `null` (caller hides the display).
 */
export function computeElapsedMs(args: ComputeElapsedArgs): number | null {
  const { status, startedAt, accumulatedMinutes } = args;
  const nowMs         = args.nowMs ?? Date.now();
  const accumulatedMs = Math.max(0, accumulatedMinutes) * 60_000;

  if (status === "paused") return accumulatedMs;

  if (status !== "tinting_in_progress") return null;
  if (!startedAt) return null;

  const startMs = startedAt instanceof Date
    ? startedAt.getTime()
    : new Date(startedAt.endsWith("Z") ? startedAt : startedAt + "Z").getTime();
  if (!Number.isFinite(startMs)) return null;

  const liveMs = Math.max(0, nowMs - startMs);
  return accumulatedMs + liveMs;
}

/** What minutesSinceRunStart needs off a tint_assignments row. */
interface RunStartArgs {
  /** The current run's start — the resume route resets it to "now". */
  startedAt:    Date;
  /** Set by pause, nulled by resume. */
  lastPausedAt: Date | null;
}

/**
 * Whole minutes in the CURRENT run, floored, never negative — the amount a
 * pause (or a Tint Manager Stop & cancel) folds into accumulatedMinutes.
 *
 * Extracted 2026-10-01 (Tint Manager tabs build step 3) from
 * app/api/tint/operator/pause/route.ts, which computed it inline, so pause and
 * lib/tint/stop-work.ts freeze a running timer by ONE rule. The arithmetic is
 * the pause route's, unchanged: baseline = lastPausedAt when it is later than
 * startedAt, else startedAt.
 */
export function minutesSinceRunStart(asg: RunStartArgs, now: Date): number {
  const baseline =
    asg.lastPausedAt && asg.lastPausedAt.getTime() > asg.startedAt.getTime()
      ? asg.lastPausedAt
      : asg.startedAt;
  const elapsedMs = now.getTime() - baseline.getTime();
  return Math.max(0, Math.floor(elapsedMs / 60000));
}
