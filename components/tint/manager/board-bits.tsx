"use client";

// Tint Manager board — the small shared presentational pieces: status pill,
// operator avatar, the assign/re-assign operator popover, and the connection
// strip. Kept together because none is big enough to own a file and all four are
// used by both the rail and the table.

import { useEffect, useRef } from "react";
import { Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BoardRowStatus, Operator } from "./types";

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

/** IST wall-clock HH:MM. Every time on this screen is depot-local. */
export function hhmm(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
}

export function istDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })
    + " " + hhmm(iso);
}

/** Days since arrival, IST. null when it landed today. */
export function ageDays(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const IST = 5.5 * 60 * 60 * 1000;
  const now = new Date(Date.now() + IST);
  const then = new Date(d.getTime() + IST);
  const a = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const b = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate());
  const diff = Math.floor((a - b) / 86400000);
  return diff > 0 ? diff : null;
}

// ── Status pill ──────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<BoardRowStatus, string> = {
  assigned:            "Assigned",
  tinting_in_progress: "In Progress",
  paused:              "Paused",
  tinting_done:        "Done",
};

const STATUS_CLASS: Record<BoardRowStatus, string> = {
  assigned:            "bg-teal-50 text-teal-700 border-teal-200",
  tinting_in_progress: "bg-amber-50 text-amber-700 border-amber-200",
  paused:              "bg-amber-50 text-amber-800 border-amber-300",
  tinting_done:        "bg-green-50 text-green-700 border-green-200",
};

export function StatusPill({
  status, at, pauseCount,
}: {
  status:      BoardRowStatus;
  at:          string | null;
  pauseCount:  number;
}) {
  const label = STATUS_LABEL[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-[3px] rounded-full border whitespace-nowrap",
        STATUS_CLASS[status],
      )}
      title={
        status === "tinting_done"
          ? "Completed today. This board shows the current day only — older work lives in the Tint Summary report."
          : undefined
      }
    >
      {status === "paused" && <Pause size={9} fill="currentColor" />}
      {status === "paused" && pauseCount > 0
        ? `${label} ${pauseCount}/3`
        : `${label} · ${hhmm(at)}`}
    </span>
  );
}

// ── Operator avatar ──────────────────────────────────────────────────────────

export function OperatorAvatar({ name, done = false, size = 20 }: { name: string | null; done?: boolean; size?: number }) {
  return (
    <span
      style={{ width: size, height: size, fontSize: size <= 20 ? 9 : 10 }}
      className={cn(
        "rounded-full text-white font-bold inline-flex items-center justify-center flex-shrink-0",
        done ? "bg-green-600" : "bg-teal-600",
      )}
    >
      {initials(name)}
    </span>
  );
}

// ── Operator picker popover ──────────────────────────────────────────────────

/**
 * The "which operator?" list, used by the rail's Assign button and the detail
 * panel's Re-assign button. Closes on outside click and on Esc.
 *
 * ⚠ Esc here is a LOCAL keydown on this popover, deliberately not a window-level
 * listener. Floor learned that the hard way (FLOOR §4.6: two window-level Esc
 * listeners race in registration order); this screen keeps exactly one
 * window-level Esc owner, in tint-manager-content.tsx.
 */
export function OperatorMenu({
  operators, currentId, onPick, onClose, label = "Assign to", className,
}: {
  operators: Operator[];
  currentId?: number | null;
  onPick:    (id: number) => void;
  onClose:   () => void;
  label?:    string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    // Deferred so the click that OPENED this does not immediately close it.
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDown); };
  }, [onClose]);

  return (
    <div
      ref={ref}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
      className={cn(
        "absolute z-[60] w-[200px] bg-white border border-gray-200 rounded-[9px] shadow-lg overflow-hidden",
        className,
      )}
    >
      <p className="text-[9.5px] uppercase tracking-[.05em] text-gray-400 px-2.5 pt-2 pb-1">{label}</p>
      {operators.length === 0 && (
        <p className="px-2.5 py-3 text-[11.5px] text-gray-400">No operators available</p>
      )}
      {operators.map((op) => (
        <button
          key={op.id}
          type="button"
          onClick={() => onPick(op.id)}
          className={cn(
            "w-full flex items-center gap-2 px-2.5 py-2 text-[12px] text-left transition-colors",
            op.id === currentId
              ? "bg-gray-50 text-gray-400 cursor-default"
              : "text-gray-700 hover:bg-teal-50 hover:text-teal-700",
          )}
          disabled={op.id === currentId}
          title={op.id === currentId ? "Already assigned to this operator" : undefined}
        >
          <OperatorAvatar name={op.name} />
          {op.name ?? `Operator ${op.id}`}
          {op.id === currentId && <span className="ml-auto text-[10px]">current</span>}
        </button>
      ))}
    </div>
  );
}

// ── Connection strip ─────────────────────────────────────────────────────────

/**
 * Mirrors components/floor/connection-strip.tsx: a thin strip, NEVER a modal —
 * when the marker probe can't reach the server the board stays fully readable
 * and this only says how stale it is.
 */
export function ConnectionStrip({ connected, lastSyncedAt }: { connected: boolean; lastSyncedAt: Date | null }) {
  if (connected) {
    return (
      <div className="flex items-center gap-1.5 border-b border-gray-100 bg-white px-4 py-[6px] text-[11px] text-gray-500">
        <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
        Live · updated {lastSyncedAt ? hhmm(lastSyncedAt.toISOString()) : "—"}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 border-b border-gray-200 bg-[#f3f4f6] px-4 py-[6px] text-[11px] text-gray-500">
      <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
      Not connected — showing last update {lastSyncedAt ? hhmm(lastSyncedAt.toISOString()) : "—"}
    </div>
  );
}
