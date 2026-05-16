"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TINTER_SHADE_COLORS,
  ACOTONE_SHADE_COLORS,
} from "@/lib/tint/shade-colors";

// ── Types ────────────────────────────────────────────────────────────────────

type Reason =
  | "TINTER_FINISHED"
  | "MACHINE_BREAKDOWN"
  | "MATERIAL_SHORTAGE"
  | "OTHER";

type TinterType = "TINTER" | "ACOTONE";

interface SkipEvent {
  id:                number;
  skippedAt:         string;
  reason:            Reason;
  tinterType:        TinterType | null;
  outOfStockColours: string[];
  remark:            string | null;
  skippedBy:         { id: number; name: string };
  assignment:        { id: number };
}

interface ApiResponseOk {
  ok:    true;
  order: { id: number; obdNumber: string; isRemoved: boolean };
  total: number;
  events: SkipEvent[];
}

export interface SkipHistoryModalProps {
  open:         boolean;
  onClose:      () => void;
  orderId:      number;
  obdNumber:    string;
  customerName: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function reasonLabel(reason: string): string {
  if (reason === "TINTER_FINISHED")   return "Tinter finished";
  if (reason === "MACHINE_BREAKDOWN") return "Machine breakdown";
  if (reason === "MATERIAL_SHORTAGE") return "Material shortage";
  if (reason === "OTHER")             return "Other";
  return reason;
}

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

function shadeTopColor(code: string, tinterType: TinterType | null): string {
  if (tinterType === "ACOTONE") return ACOTONE_SHADE_COLORS[code]?.top ?? "#6b7280";
  return TINTER_SHADE_COLORS[code]?.top ?? "#6b7280";
}

// ── Component ────────────────────────────────────────────────────────────────

export function SkipHistoryModal({
  open,
  onClose,
  orderId,
  obdNumber,
  customerName,
}: SkipHistoryModalProps): React.JSX.Element | null {
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [events,     setEvents]     = useState<SkipEvent[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  // Fetch on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEvents([]);
    setTotalCount(0);
    (async () => {
      try {
        const res = await fetch(
          `/api/tint/manager/orders/${orderId}/skip-history`,
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
            : "Failed to load skip history. Try again.";
          setError(errMsg);
          return;
        }
        const ok = json as ApiResponseOk;
        setEvents(ok.events);
        setTotalCount(ok.total);
      } catch (err) {
        if (cancelled) return;
        console.error("[skip-history] fetch failed", err);
        setError("Failed to load skip history. Try again.");
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
        aria-labelledby="skip-history-title"
        className="bg-white rounded-xl shadow-xl w-[560px] max-h-[90vh] overflow-y-auto p-[22px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <h3 id="skip-history-title" className="text-[16px] font-semibold text-gray-900">
            Skip History
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
            {totalCount} skip event{totalCount === 1 ? "" : "s"}
          </span>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-gray-400 text-[13px]">
            <Loader2 size={16} className="animate-spin" />
            Loading skip history…
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
            No skip events for this order.
          </p>
        )}

        {/* Event list (API already returns newest-first) */}
        {!loading && !error && events.length > 0 && events.map((ev, idx) => {
          // Numbering: oldest = #1, newest = #N. API returns newest-first,
          // so position 0 → number totalCount; position i → totalCount - i.
          const eventNumber = totalCount - idx;
          const isMostRecent = idx === 0;
          const tinterFinished = ev.reason === "TINTER_FINISHED";
          const hasColours = tinterFinished
            && ev.tinterType !== null
            && ev.outOfStockColours.length > 0;
          return (
            <div
              key={ev.id}
              className={cn(
                "border border-gray-100 rounded-lg px-3.5 py-3 mb-2.5 bg-white",
                isMostRecent && "border-l-[3px] border-l-amber-500 pl-[11px]",
              )}
            >
              {/* Event header */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                  Skip #{eventNumber}{isMostRecent ? " · most recent" : ""}
                </span>
                <span className="text-[11px] text-gray-500">
                  {formatIstDateTime(ev.skippedAt)}
                </span>
              </div>

              {/* Operator */}
              <div className="flex items-baseline gap-2 text-[12px] mb-1">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide min-w-[78px]">
                  Operator
                </span>
                <span className="text-gray-700">{ev.skippedBy?.name ?? "—"}</span>
              </div>

              {/* Reason */}
              <div className="flex items-baseline gap-2 text-[12px] mb-1">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide min-w-[78px]">
                  Reason
                </span>
                <span className="text-gray-700">{reasonLabel(ev.reason)}</span>
              </div>

              {/* Tinter type — only when TINTER_FINISHED with a recorded type */}
              {tinterFinished && ev.tinterType && (
                <div className="flex items-baseline gap-2 text-[12px] mb-1">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide min-w-[78px]">
                    Tinter type
                  </span>
                  <span className="text-gray-700">{ev.tinterType}</span>
                </div>
              )}

              {/* Colours — only when TINTER_FINISHED + at least one colour */}
              {/* Belt-and-braces: gates on BOTH tinterType non-null AND colours.length >= 1 */}
              {hasColours && (
                <div className="flex items-start gap-2 text-[12px] mb-1">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide min-w-[78px] mt-[3px]">
                    Colours
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {ev.outOfStockColours.map((code) => (
                      <span
                        key={code}
                        className="inline-block font-mono text-[10px] text-gray-700 bg-gray-100 px-1.5 py-[1px] rounded"
                        style={{
                          borderTop: `2px solid ${shadeTopColor(code, ev.tinterType)}`,
                        }}
                      >
                        {code}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Remark */}
              <div className="flex items-baseline gap-2 text-[12px]">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide min-w-[78px]">
                  Remark
                </span>
                {ev.remark
                  ? <span className="text-gray-700">{ev.remark}</span>
                  : <span className="text-gray-400 italic">—</span>
                }
              </div>
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
