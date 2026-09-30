"use client";

// Picking on the live change feed (4b, 2026-09-30) — shared pieces for the two phone faces.
// Behind app_settings 'live.feed' AND 'live.feed.picking' (absent = OFF).
//
// Plan:   docs/prompts/drafts/code-plan-2026-09-30-picking-live-feed.md §D, §E (all decisions
//         approved; decision 7 — push → instant update — promoted into this build).
// Server: 4a (`dd20a0a0`) — POST /api/picking/sync, /api/live/changes?screen=picking[&face=picker&held=].
// Record: docs/prompts/drafts/code-update-2026-09-30-picking-live-feed-4b.md
//
// What lives here: the hint key, the LEGACY marker components (the old usePickingMarker calls moved
// UNCHANGED into components that are mounted only while the feed is not live — the Floor 7b /
// Billing 2b-ii pattern), the service-worker push listener, and the slim "Changed — Reload" strip.
// The feed itself and the merge live in each face's shell (components/picking/picking-mobile-shell.tsx).
// Debug log: localStorage "orbit.live.debug" = "1" → [live:picking] lines. Never router.refresh().

import { useEffect, useRef } from "react";
import { usePickingMarker, type MarkerResync } from "@/lib/hooks/use-picking-marker";
import { readLiveHint } from "@/lib/live/use-live-feed";
import { parseOrbitPushMessage, type OrbitPushMessage } from "@/lib/push/sw-message";

/** localStorage: "the Picking feed was on last time" on this phone. */
export const PICKING_LIVE_HINT_KEY = "orbit.live.picking";

export function readPickingLiveHint(): boolean {
  return readLiveHint(PICKING_LIVE_HINT_KEY);
}

/**
 * The supervisor board's two legacy polls — the queue marker and the tint-room marker — exactly as
 * SupervisorPickingShell used to call them (same scope, url, paused, onChange). Rendered only while
 * the feed is NOT live. Registers the queue marker's resync where the shell's refetchQueue calls it.
 */
export function LegacySupervisorMarkers({
  paused,
  onQueueChange,
  onTintChange,
  markerResyncRef,
}: {
  paused: boolean;
  onQueueChange: () => void;
  onTintChange: () => void;
  markerResyncRef: React.MutableRefObject<MarkerResync | null>;
}) {
  const markerResync = usePickingMarker({
    scope: "openPending",
    onChange: onQueueChange,
    paused,
  });
  useEffect(() => {
    markerResyncRef.current = markerResync;
    return () => {
      markerResyncRef.current = null;
    };
  }, [markerResync, markerResyncRef]);
  usePickingMarker({
    scope: "openPending",
    url: "/api/picking/tint-workload/marker",
    onChange: onTintChange,
    paused,
  });
  return null;
}

/**
 * The picker face's legacy poll — the narrowed marker exactly as PickerMyPicksBoard used to call it.
 * Rendered only while the feed is NOT live.
 */
export function LegacyPickerMarker({
  pickerId,
  paused,
  onChange,
  markerResyncRef,
}: {
  pickerId: number | undefined;
  paused: boolean;
  onChange: () => void;
  markerResyncRef: React.MutableRefObject<MarkerResync | null>;
}) {
  const markerResync = usePickingMarker({
    scope: "openPending",
    pickerId,
    onChange,
    paused,
  });
  useEffect(() => {
    markerResyncRef.current = markerResync;
    return () => {
      markerResyncRef.current = null;
    };
  }, [markerResync, markerResyncRef]);
  return null;
}

/**
 * Listen for the service worker's `{ type: "orbit-push", tag, kind, orderId }` message (public/sw.js)
 * while `enabled`. The handler is read through a ref, so re-renders never re-subscribe.
 */
export function useOrbitPushMessages(enabled: boolean, onMessage: (m: OrbitPushMessage) => void): void {
  const ref = useRef(onMessage);
  ref.current = onMessage;
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const handler = (e: MessageEvent) => {
      const m = parseOrbitPushMessage(e.data);
      if (m) ref.current(m);
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [enabled]);
}

/**
 * The slim "Changed — Reload" strip over an open bill whose data changed elsewhere (Floor's rule:
 * never swap under the hand; offer the reload). Fixed at the top of the screen so it needs no place
 * inside the detail overlay's own layout; above the overlay (z-[35]) and below sheets.
 */
export function DetailChangedStrip({ onReload }: { onReload: () => void }) {
  return (
    <div
      role="status"
      className="fixed inset-x-0 z-[45] flex items-center gap-2 border-b border-gray-200 bg-white/95 px-4 py-2 text-[12px] text-gray-600 shadow-sm"
      style={{ top: "env(safe-area-inset-top, 0px)" }}
    >
      This bill changed elsewhere
      <button type="button" onClick={onReload} className="ml-auto rounded-md px-2 py-1 font-semibold text-brand-600 active:bg-gray-100">
        Reload
      </button>
    </div>
  );
}
