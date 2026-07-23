"use client";

// Floor Control — four-segment progress bar (design §7.3). Segments are the
// four locked status colours in proportion, so it shows WHERE a route/band is
// stuck, not just how far along: "2 of 6" all violet is fine; the same made of
// grey means nobody has started.
//
// Segment order left→right: done → needs-check → with-picker → waiting (matches
// the mockup `bars()` — finished work anchors the left edge). These are the
// mockup's lighter segment tones (#22c55e/#fbbf24/#a78bfa/#d1d5db), distinct
// from the pill text/bg colours (status-pill.tsx) — do not merge the two sets.

import type { StatusCounts } from "./status-pill";

const SEGMENTS: Array<{ key: "done" | "needsCheck" | "withPicker" | "waiting"; color: string }> = [
  { key: "done", color: "#22c55e" },
  { key: "needsCheck", color: "#fbbf24" },
  { key: "withPicker", color: "#a78bfa" },
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
