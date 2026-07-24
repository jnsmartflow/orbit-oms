"use client";

// Floor Control — connection strip (design §13 fact 4). A thin grey strip, NEVER
// a modal: when the server can't be reached the board stays fully readable and
// this just says how stale it is.
//
// Purely presentational. Connection state comes from the SAME /api/floor/marker
// probe the board's live-sync already runs (use-picking-marker's onProbe) — one
// poll drives both. `lastSyncedAt` is the last successful board load, shown as the
// "last update" time. Only rendered in live mode (the Live indicator disappears
// in History).

function hhmm(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}

export function ConnectionStrip({ connected, lastSyncedAt }: { connected: boolean; lastSyncedAt: Date | null }) {
  if (connected) return null;

  return (
    <div className="flex items-center gap-2 border-b border-gray-200 bg-[#f3f4f6] px-4 py-[6px] text-[11px] text-gray-500">
      <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
      Not connected — showing last update {lastSyncedAt ? hhmm(lastSyncedAt) : "—"}
    </div>
  );
}
