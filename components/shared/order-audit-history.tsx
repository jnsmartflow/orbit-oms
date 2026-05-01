"use client";

// components/shared/order-audit-history.tsx
//
// Audit-history list for an order. Renders the most recent 100 entries
// from order_status_logs as a vertical list with click-to-expand-each-row.
// Lazy-fetches when the parent's section opens (`isOpen` flips true).

import { useEffect, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { getTodayIST } from "@/lib/dates";

interface AuditEntry {
  id:         number;
  createdAt:  string;
  fromStage:  string | null;
  toStage:    string;
  note:       string | null;
  changeType: string;
  changedBy:  { id: number; name: string } | null;
}

interface AuditResponse {
  entries:    AuditEntry[];
  totalCount?: number;
}

interface Props {
  orderId: number;
  isOpen:  boolean;
}

// ─── Pure helpers (kept local — not reusable enough to extract) ───────────

/** Strip the `[change_type]` prefix and the trailing ` via {source} batch X`
 *  suffix from a note. Truncate to 80 chars with ellipsis. Falls back to the
 *  truncated raw note when parsing fails. */
function summarize(note: string | null): string {
  if (!note) return "";
  let s = note.replace(/^\[[^\]]+\]\s*/, "");
  s = s.replace(/\s+via\s+(auto-import|manual-template|manual-sap)\s+batch\s+\S+\.?$/i, "");
  s = s.trim();
  if (s.length > 80) s = s.slice(0, 79) + "…";
  return s;
}

/** Format an ISO timestamp into IST display:
 *  - Today    → "14:32"
 *  - Yesterday → "Yesterday 14:32"
 *  - Older    → "29 Apr 14:32"
 */
function formatAuditTimestamp(iso: string, todayIST: string): string {
  const d = new Date(iso);
  const istDateStr = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const istTime    = d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  if (istDateStr === todayIST) return istTime;

  // Compute yesterday from todayIST.
  const todayParts = todayIST.split("-").map((s) => parseInt(s, 10));
  const todayUtc   = Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2]);
  const yest       = new Date(todayUtc - 24 * 3600 * 1000);
  const yestStr    = yest.toISOString().slice(0, 10);
  if (istDateStr === yestStr) return `Yesterday ${istTime}`;

  // Older: "DD MMM HH:mm" in IST.
  const dayMon = d.toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short",
  });
  return `${dayMon} ${istTime}`;
}

const BADGE_STYLES: Record<string, string> = {
  obd_created:        "bg-green-50 border-green-200 text-green-700",
  header_patched:     "bg-blue-50 border-blue-200 text-blue-700",
  header_overwritten: "bg-amber-50 border-amber-200 text-amber-700",
  line_added:         "bg-green-50 border-green-200 text-green-700",
  line_patched:       "bg-blue-50 border-blue-200 text-blue-700",
  line_removed:       "bg-red-50 border-red-200 text-red-700",
  line_restored:      "bg-teal-50 border-teal-200 text-teal-700",
};

function badgeClass(changeType: string): string {
  return BADGE_STYLES[changeType] ?? "bg-gray-50 border-gray-200 text-gray-500";
}

// ─── Component ────────────────────────────────────────────────────────────

export function OrderAuditHistory({ orderId, isOpen }: Props) {
  const [entries, setEntries]               = useState<AuditEntry[]>([]);
  const [totalCount, setTotalCount]         = useState<number | null>(null);
  const [initialLoading, setInitialLoading] = useState(false);
  const [refreshing, setRefreshing]         = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [expandedId, setExpandedId]         = useState<number | null>(null);
  const [hasFetched, setHasFetched]         = useState(false);

  const todayIST = getTodayIST();

  const load = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") setInitialLoading(true);
    else                    setRefreshing(true);
    setError(null);
    try {
      const res  = await fetch(`/api/orders/${orderId}/audit-history`);
      const data = (await res.json()) as AuditResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load history");
      setEntries(data.entries);
      setTotalCount(data.totalCount ?? null);
      setHasFetched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, [orderId]);

  // Lazy-fetch when section opens for the first time.
  useEffect(() => {
    if (isOpen && !hasFetched && !initialLoading) load("initial");
  }, [isOpen, hasFetched, initialLoading, load]);

  // Reset state when orderId changes.
  useEffect(() => {
    setEntries([]);
    setTotalCount(null);
    setExpandedId(null);
    setHasFetched(false);
    setError(null);
  }, [orderId]);

  if (!isOpen) return null;

  if (initialLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="animate-pulse bg-gray-100 h-8 rounded" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-gray-600">
        <span className="text-red-600">Failed to load history.</span>{" "}
        <button
          type="button"
          onClick={() => load("initial")}
          className="text-teal-600 hover:text-teal-700 underline-offset-2 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (entries.length === 0) {
    return <p className="text-xs text-gray-400 italic">No history yet.</p>;
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] text-gray-500">{entries.length} entries</span>
        <button
          type="button"
          onClick={() => load("refresh")}
          disabled={refreshing}
          className="text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-40"
          aria-label="Refresh history"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      <ul className="border border-gray-100 rounded overflow-hidden">
        {entries.map((e, idx) => {
          const expanded   = expandedId === e.id;
          const summary    = summarize(e.note);
          const actor      = e.changedBy?.name ?? "System";
          const ts         = formatAuditTimestamp(e.createdAt, todayIST);
          return (
            <li
              key={e.id}
              className={
                "border-b border-gray-100 last:border-b-0 " +
                (idx % 2 === 1 ? "bg-gray-50" : "bg-white")
              }
            >
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : e.id)}
                className="w-full px-3 py-1.5 flex items-center gap-3 text-left hover:bg-gray-50/80 transition-colors"
              >
                <span className="text-[11px] text-gray-400 tabular-nums font-mono w-[88px] shrink-0">
                  {ts}
                </span>
                <span className="text-[11px] text-gray-600 w-[80px] truncate shrink-0">
                  {actor}
                </span>
                <span className="text-[11px] text-gray-700 flex-1 truncate">
                  {summary || <span className="text-gray-300 italic">(no detail)</span>}
                </span>
                <span className={"text-[9px] font-semibold px-1.5 py-0.5 rounded border shrink-0 " + badgeClass(e.changeType)}>
                  {e.changeType}
                </span>
              </button>
              {expanded && (
                <div className="px-3 pb-2 pt-1">
                  <pre className="bg-gray-50 rounded p-3 text-xs text-gray-600 font-mono whitespace-pre-wrap break-words">
                    {e.note ?? "(empty note)"}
                  </pre>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {totalCount != null && (
        <p className="text-[10px] text-gray-400 italic mt-2">
          Showing recent {entries.length} of {totalCount} entries
        </p>
      )}
    </div>
  );
}
