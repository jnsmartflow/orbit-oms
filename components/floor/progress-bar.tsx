"use client";

// Floor Control — FIVE-segment progress bar (design §7.3; the fifth landed
// 2026-09-11 with the Dispatched status). Segments are the locked status colours
// in proportion, so it shows WHERE a route/band is stuck, not just how far
// along: "2 of 6" all violet is fine; the same made of grey means nobody has
// started.
//
// ⚠ A SEGMENT PER BUCKET, OR THE BAR SILENTLY RENDERS SHORT. Each width is that
// bucket over `counts.total`, so a bucket with no segment here contributes
// nothing and the bar stops before its right edge against the grey track — it
// does not fail, it just quietly understates. `dispatched` was added to
// StatusCounts on 2026-09-11 and needed its segment in the same change.
//
// Dispatched anchors the FAR LEFT, left of done: it is the most finished thing
// a bill can be. Slate, matching its pill and deliberately not a second green
// (see status-pill.tsx META for why).
//
// Segment order left→right: dispatched → done → needs-check → with-picker →
// waiting (matches the mockup `bars()` — finished work anchors the left edge).
// These are the
// mockup's lighter segment tones (#22c55e/#fbbf24/#a78bfa/#d1d5db), distinct
// from the pill text/bg colours (status-pill.tsx) — do not merge the two sets.

import type { StatusCounts } from "./status-pill";

// ── EIGHT SEGMENTS SINCE 2026-09-13 ─────────────────────────────────────────
// The three tint buckets joined StatusCounts with the tint pills, and the rule
// at the top of this file applied immediately: a bucket with no segment
// contributes nothing and the bar stops short of its right edge. Added in the
// same change, exactly as `dispatched` was.
//
// ORDER IS THE WORKFLOW, finished at the left edge and least-started at the
// right. The tint states sit to the RIGHT of `waiting` because the tint room
// comes BEFORE picking: a bill on the mixer is further from done than one
// waiting for a picker. `tintDone` sits immediately beside `waiting` because
// they are the same rung — both mean "on the floor, nobody has it" — and then
// `tinting` and `tintPending` trail off as the work gets earlier.
//
// The pinks are the PILL values (status-pill.tsx META), not lightened bar tones
// like the four originals. A 7px sliver has no room to carry a weight
// distinction, so the three would be indistinguishable if they were tinted down
// toward each other; keeping the pill values at least makes the solid `tinting`
// segment read as the loud one it is on the row above.
/**
 * "Picked · needs check" — `pick_done`. ONE value for every floor bar: this
 * one, the trip bar (trip-bar.tsx) and the route cards (route-cards.tsx) all
 * read it from here (2026-09-22). Do not retype it.
 */
export const NEEDS_CHECK_SEGMENT = "#fbbf24";

const SEGMENTS: Array<{
  key: "dispatched" | "done" | "needsCheck" | "withPicker" | "waiting" | "tintDone" | "tinting" | "tintAssigned" | "tintPending";
  color: string;
}> = [
  { key: "dispatched", color: "#94a3b8" },
  { key: "done", color: "#22c55e" },
  { key: "needsCheck", color: NEEDS_CHECK_SEGMENT },
  { key: "withPicker", color: "#0284C7" },
  { key: "waiting", color: "#d1d5db" },
  { key: "tintDone", color: "#fbcfe8" },
  { key: "tinting", color: "#db2777" },
  { key: "tintAssigned", color: "#f9a8d4" },
  { key: "tintPending", color: "#fce7f3" },
];

export function ProgressBar({ counts, className = "" }: { counts: StatusCounts; className?: string }) {
  const total = counts.total || 1;
  return (
    <span className={`flex h-[7px] overflow-hidden rounded-[4px] bg-[#e5e7eb] ${className}`}>
      {SEGMENTS.map((s) => {
        const n = counts[s.key];
        if (!n) return null;
        return <span key={s.key} style={{ width: `${(n / total) * 100}%`, background: s.color }} />;
      })}
    </span>
  );
}
