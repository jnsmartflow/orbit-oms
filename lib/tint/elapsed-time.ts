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
