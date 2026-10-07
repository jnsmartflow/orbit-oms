"use client";

// components/challan-orders/use-challan-count.ts
//
// The "Challan orders" pill's number on the Billing and Floor tab bars
// (Challan orders slice 5, 2026-10-07) — NOT BILLED, the work outstanding (the
// tab-bar rule: count = work, not rows). Read off /api/challan-orders/marker,
// whose `count` IS that number, through the shared marker hook's onResult — one
// small probe every 30 s, tab-hidden pause, silent failure.
//
// 🔴 A COMPONENT, MOUNTED ONLY FOR A VIEWER WITH challan_orders canView — the
// host writes `{canView && <ChallanCountProbe …/>}`. A viewer without the tick
// never mounts it and so never sends a request (no 403 every 30 s).

import { useState } from "react";
import { usePickingMarker } from "@/lib/hooks/use-picking-marker";

export function ChallanCountProbe({ onCount }: { onCount: (n: number) => void }) {
  usePickingMarker({
    scope: "openPending",
    url: "/api/challan-orders/marker",
    pollMs: 30_000,
    onChange: () => {},
    onResult: (m) => onCount(m.count),
  });
  return null;
}

/** Mount `<ChallanCountProbe>` ONLY when the viewer may see the tab; read `count`. */
export function useChallanCountState(): [number | null, (n: number) => void] {
  const [count, setCount] = useState<number | null>(null);
  return [count, setCount];
}
