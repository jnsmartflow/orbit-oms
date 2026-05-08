"use client";

import { useEffect, useState } from "react";
import { formatDuration, minutesSince } from "@/lib/attendance/format";

interface LiveTimerProps {
  startISO: string;
  className?: string;
}

// 30s tick (Q6) — minute-resolution display, low CPU. Cleanup is
// non-negotiable: a leaked interval lives until full page unload.
const TICK_MS = 30_000;

export function LiveTimer({ startISO, className }: LiveTimerProps) {
  // null pre-mount so SSR + first client paint render the same string,
  // avoiding hydration mismatch. Real value lands within ~16ms.
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  if (nowMs === null) return <span className={className}>—</span>;
  return <span className={className}>{formatDuration(minutesSince(startISO, nowMs))}</span>;
}
