"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { humaniseReason } from "@/lib/tint/pause-reasons";

// ── Types ────────────────────────────────────────────────────────────────────

interface ProgressSnapshot {
  items?: Array<{ skuId: number; doneQty: number }>;
  capturedAt?: string;
}

interface PauseEvent {
  id:                    number;
  assignmentId:          number;
  pausedAt:              string;
  reason:                string;
  remark:                string | null;
  progress:              ProgressSnapshot | null;
  elapsedMinutes:        number;
  resumedAt:             string | null;
  resumeRemark:          string | null;
  pausedBy:              { id: number; name: string | null } | null;
  resumedBy:             { id: number; name: string | null } | null;
}

interface SkuLookupRow {
  skuCode:     string;
  shadeName:   string;
  assignedQty: number;
}

interface ApiResponseOk {
  ok:        true;
  order:     { id: number; obdNumber: string; isRemoved: boolean };
  total:     number;
  events:    PauseEvent[];
  skuLookup: Record<string, SkuLookupRow>;
}

export interface PauseHistoryModalProps {
  open:         boolean;
  onClose:      () => void;
  orderId:      number;
  obdNumber:    string;
  customerName: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatIstDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const dateStr = d.toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
  });
  const timeStr = d.toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
  return `${dateStr} · ${timeStr} IST`;
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  const h  = Math.floor(minutes / 60);
  const mr = minutes % 60;
  return mr === 0 ? `${h}h` : `${h}h ${mr}m`;
}

// ── Component ────────────────────────────────────────────────────────────────

export function PauseHistoryModal({
  open,
  onClose,
  orderId,
  obdNumber,
  customerName,
}: PauseHistoryModalProps): React.JSX.Element | null {
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [events,     setEvents]     = useState<PauseEvent[]>([]);
  const [skuLookup,  setSkuLookup]  = useState<Record<string, SkuLookupRow>>({});
  const [totalCount, setTotalCount] = useState(0);

  // Fetch on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEvents([]);
    setSkuLookup({});
    setTotalCount(0);
    (async () => {
      try {
        const res = await fetch(
          `/api/tint/manager/orders/${orderId}/pause-history`,
          { credentials: "include" },
        );
        const json = (await res.json().catch(() => ({}))) as
          | ApiResponseOk
          | { ok: false; error?: string };
        if (cancelled) return;
        if (!res.ok || ("ok" in json && json.ok === false)) {
          const errRaw = (json as { error?: unknown }).error;
          const errMsg = typeof errRaw === "string"
            ? errRaw
            : "Failed to load pause history. Try again.";
          setError(errMsg);
          return;
        }
        const ok = json as ApiResponseOk;
        setEvents(ok.events);
        setSkuLookup(ok.skuLookup);
        setTotalCount(ok.total);
      } catch (err) {
        if (cancelled) return;
        console.error("[pause-history] fetch failed", err);
        setError("Failed to load pause history. Try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, orderId]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-history-title"
        className="bg-white rounded-xl shadow-xl w-[580px] max-h-[90vh] overflow-y-auto p-[22px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <h3 id="pause-history-title" className="text-[16px] font-semibold text-gray-900">
            Pause History
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-md text-gray-400 hover:text-gray-600 inline-flex items-center justify-center"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Order summary row */}
        <div className="flex items-center gap-2 pb-3 mb-3.5 border-b border-gray-100">
          <span className="font-mono text-[12px] text-gray-900 font-medium">
            {obdNumber}
          </span>
          <span className="text-gray-400 text-[11px]">·</span>
          <span className="text-[12px] text-gray-900 font-medium">
            {customerName ?? "—"}
          </span>
          <span className="text-gray-400 text-[11px]">·</span>
          <span className="text-[11px] text-gray-500">
            {totalCount} pause event{totalCount === 1 ? "" : "s"}
          </span>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-gray-400 text-[13px]">
            <Loader2 size={16} className="animate-spin" />
            Loading pause history…
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 text-[12px] text-red-700">
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && events.length === 0 && (
          <p className="text-[14px] italic text-gray-400 text-center py-8">
            No pause events for this order.
          </p>
        )}

        {/* Event list — API returns oldest-first (asc); numbering starts at #1. */}
        {!loading && !error && events.length > 0 && events.map((ev, idx) => {
          const eventNumber  = idx + 1;
          const isOpen       = ev.resumedAt === null;
          const items        = ev.progress?.items ?? [];
          const trimmedNote  = ev.remark?.trim() ?? "";
          const resumeMs     = ev.resumedAt && ev.pausedAt
            ? new Date(ev.resumedAt).getTime() - new Date(ev.pausedAt).getTime()
            : 0;
          const resumeMins   = Math.max(0, Math.floor(resumeMs / 60000));
          return (
            <div
              key={ev.id}
              className={cn(
                "border border-gray-100 rounded-lg px-3.5 py-3 mb-2.5 bg-white",
                isOpen && "border-l-[3px] border-l-amber-500 pl-[11px] bg-amber-50/40",
              )}
            >
              {/* Event header */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                  Pause #{eventNumber}{isOpen ? " · currently paused" : ""}
                </span>
                <span className="text-[11px] text-gray-500">
                  {formatIstDateTime(ev.pausedAt)}
                </span>
              </div>

              {/* Operator */}
              <div className="flex items-baseline gap-2 text-[12px] mb-1">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide min-w-[78px]">
                  Paused by
                </span>
                <span className="text-gray-700">{ev.pausedBy?.name ?? "—"}</span>
              </div>

              {/* Reason */}
              <div className="flex items-baseline gap-2 text-[12px] mb-1">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide min-w-[78px]">
                  Reason
                </span>
                <span className="text-gray-700">{humaniseReason(ev.reason)}</span>
              </div>

              {/* Remark (only when non-empty after trim) */}
              {trimmedNote && (
                <div className="flex items-baseline gap-2 text-[12px] mb-1">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide min-w-[78px]">
                    Remark
                  </span>
                  <span className="text-gray-700 italic">&ldquo;{trimmedNote}&rdquo;</span>
                </div>
              )}

              {/* Elapsed before pause */}
              <div className="flex items-baseline gap-2 text-[12px] mb-1">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide min-w-[78px]">
                  Elapsed
                </span>
                <span className="text-gray-700">{formatDuration(ev.elapsedMinutes)} before pause</span>
              </div>

              {/* Progress snapshot per SKU */}
              {items.length > 0 && (
                <div className="flex items-start gap-2 text-[12px] mt-1.5">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide min-w-[78px] mt-[3px]">
                    Progress
                  </span>
                  <div className="flex flex-col gap-1 flex-1">
                    {items.map((p) => {
                      const sku = skuLookup[String(p.skuId)];
                      if (!sku) {
                        return (
                          <div key={p.skuId} className="text-[11px] text-gray-500">
                            <span className="font-mono">#{p.skuId}</span>
                            <span className="ml-1">· {p.doneQty} tins done</span>
                          </div>
                        );
                      }
                      return (
                        <div key={p.skuId} className="flex items-center gap-2 text-[11px]">
                          <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                          <span className="font-mono text-gray-600">{sku.skuCode}</span>
                          <span className="text-gray-700 truncate flex-1">{sku.shadeName}</span>
                          <span className="text-gray-700 font-semibold tabular-nums flex-shrink-0">
                            {p.doneQty} of {sku.assignedQty} tins
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Resume / currently-paused footer */}
              {isOpen ? (
                <div className="mt-3 pt-2 border-t border-dashed border-amber-200 text-[11.5px] font-semibold text-amber-700">
                  ⏸ Currently paused — no resume yet
                </div>
              ) : (
                <div className="mt-3 pt-2 border-t border-dashed border-gray-200 text-[11.5px] text-gray-600">
                  ── Resumed: {formatIstDateTime(ev.resumedAt)} by {ev.resumedBy?.name ?? "—"}
                  <span className="text-gray-400"> ({formatDuration(resumeMins)} paused)</span>
                </div>
              )}
            </div>
          );
        })}

        {/* Footer */}
        <div className="flex items-center justify-end mt-3">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3.5 text-[13px] text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
