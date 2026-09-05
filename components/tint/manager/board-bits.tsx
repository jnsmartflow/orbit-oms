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

/**
 * The four pills, styled to match Floor Control exactly.
 *
 * ⚠ COLOURS ARE COPIED FROM components/floor/status-pill.tsx's `META`, hex for
 * hex — the four washes there are Floor's locked set (design §7.6) and are not
 * exported as tokens, so there is nothing to import. Floor owns them
 * (CLAUDE_FLOOR §1); this is a deliberate copy with the source named, NOT a new
 * palette. If Floor's four ever change, these must be re-copied — they cannot
 * drift silently, but nothing enforces it either.
 *
 * Importing Floor's <StatusPill/> itself was rejected: its `FloorStatus` union
 * is picking's ladder and its labels are "Waiting / With picker / Needs check /
 * Done", which are the wrong words for a tint job.
 *
 * The MAPPING onto Floor's four, so the same colour means the same thing on
 * both boards:
 *   assigned            → Floor "waiting"    grey   — in a queue, nobody working it yet
 *   tinting_in_progress → Floor "withPicker" violet — a named person is on it right now
 *   paused              → Floor "needsCheck" amber  — stalled, wants a human's attention
 *   tinting_done        → Floor "done"       green  — finished
 */
const STATUS_META: Record<BoardRowStatus, { label: string; cls: string }> = {
  assigned:            { label: "Assigned",    cls: "bg-[#f3f4f6] text-[#6b7280]" },
  tinting_in_progress: { label: "In Progress", cls: "bg-[#ede9fe] text-[#6d28d9]" },
  paused:              { label: "Paused",      cls: "bg-[#fef3c7] text-[#b45309]" },
  tinting_done:        { label: "Done",        cls: "bg-[#dcfce7] text-[#15803d]" },
};

export function StatusPill({
  status, at, pauseCount,
}: {
  status:      BoardRowStatus;
  at:          string | null;
  pauseCount:  number;
}) {
  const m = STATUS_META[status];
  // Trailing detail rides inside the pill after a faded dot, exactly as Floor's
  // elapsed time does (§7.7): 9.5px, tabular-nums, 70% opacity. On a paused row
  // the pause COUNT is more use than a clock — the 3-pause cap is the thing the
  // manager is watching — so that is what takes the slot.
  const detail = status === "paused" && pauseCount > 0 ? `${pauseCount}/3` : hhmm(at);
  return (
    <span
      className={cn(
        // Radius 4px — a pill, not a capsule (Floor design §7.6). No border:
        // Floor's four are flat washes.
        "inline-flex items-center rounded-[4px] px-2 py-[2px] text-[10px] font-semibold",
        m.cls,
      )}
      title={
        status === "tinting_done"
          ? "Completed today. This board shows the current day only — older work lives in the Tint Summary report."
          : undefined
      }
    >
      {status === "paused" && <Pause size={9} fill="currentColor" className="mr-1" />}
      {m.label}
      {detail ? (
        <>
          <span className="mx-1 font-normal opacity-40">·</span>
          <span className="text-[9.5px] font-semibold tabular-nums opacity-70">{detail}</span>
        </>
      ) : null}
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
