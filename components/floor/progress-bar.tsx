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

const SEGMENTS: Array<{
  key: "dispatched" | "done" | "needsCheck" | "withPicker" | "waiting";
  color: string;
}> = [
  { key: "dispatched", color: "#94a3b8" },
  { key: "done", color: "#22c55e" },
  { key: "needsCheck", color: "#fbbf24" },
  { key: "withPicker", color: "#0284C7" },
  { key: "waiting", color: "#d1d5db" },
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
