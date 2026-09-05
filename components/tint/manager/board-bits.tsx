"use client";

// Tint Manager board — the small shared presentational pieces: status pill,
// operator avatar, the assign/re-assign operator popover, and the connection
// strip. Kept together because none is big enough to own a file and all four are
// used by both the rail and the table.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

/**
 * SMU, shortened to fit a table column.
 *
 * Only three values exist on live tint OBDs (verified 2026-09-05): "Decorative
 * Projects" 688, "Retail Offtake" 230, "Deco Retail" 8. Just the first is too
 * long for the column, and the abbreviation is NOT invented here — it is the
 * one already used by the missing-customer popover in tint-manager-content.tsx
 * ("Decorative Projects" → "Deco Projects"), so the two surfaces spell the same
 * SMU the same way. ⚠ That popover still carries its own copy of this ternary;
 * if a third spelling is ever needed, collapse both onto this helper rather than
 * adding one.
 *
 * The full value always rides along in the cell's `title`, so nothing is lost.
 */
export function formatSmu(smu: string | null | undefined): string | null {
  if (!smu) return null;
  return smu === "Decorative Projects" ? "Deco Projects" : smu;
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
 * panel's Assign / Re-assign buttons.
 *
 * ── WHY THIS IS PORTALLED (fixed 2026-09-05) ─────────────────────────────────
 * It used to be an `absolute` div with `z-[60]`, rendered INSIDE the rail card
 * and pinned upward with `bottom-[calc(100%+6px)]`. That fails two ways at once,
 * and z-index cannot save it:
 *
 *   1. CLIPPING. The rail is `overflow-hidden` and its list is
 *      `overflow-y-auto`, so both are clipping contexts. An absolutely
 *      positioned DESCENDANT that extends past them is clipped — and z-index
 *      does NOT escape an overflow clip, it only orders what is already
 *      painted. (`overflow-y: auto` also makes the x-axis clip, per spec: when
 *      one axis is not `visible`, a `visible` other axis computes to `auto`.)
 *      So the menu was cut off horizontally too.
 *   2. THE HARD-CODED DIRECTION. `bottom-[calc(100%+6px)]` always opened
 *      UPWARD. For the FIRST card in the rail there is nothing above it but the
 *      "Needs assignment" header, so the menu was drawn straight over that
 *      header — and then clipped by (1). That is exactly the case that broke.
 *
 * THE FIX, copied from Floor's dispatch-slot-picker (FLOOR §4.6): render into
 * `document.body` and position `fixed` from the trigger's own
 * getBoundingClientRect(). Being no descendant of either scroller, NOTHING can
 * clip it — clipping only applies to descendants — and `fixed` means the rail's
 * scroll offset cannot shift it either.
 *
 * DIRECTION IS A PREFERENCE, NOT A COMMAND: prefer BELOW the button; flip above
 * only if it does not fit below; if neither fits, take the roomier side and cap
 * the height with internal scroll. For the first card that resolves to "below"
 * — there is a whole rail's worth of room under it — so the menu opens away
 * from the header rather than across it.
 *
 * Position is measured in a LAYOUT effect, after the portal has rendered, so
 * `scrollHeight` is the real height rather than a guess; the menu paints hidden
 * for that one frame so it never flashes at the wrong spot. It re-measures on
 * scroll (capture:true, so scrolling the RAIL counts, not just the window) and
 * on resize, which keeps it glued to its card.
 *
 * ⚠ Esc here is a LOCAL keydown, deliberately not a window-level listener. Floor
 * learned that the hard way (FLOOR §4.6: two window-level Esc listeners race in
 * registration order); this screen keeps exactly one window-level Esc owner, in
 * tint-manager-content.tsx.
 */
const MENU_WIDTH = 200;

/**
 * Which way the menu opens. Extracted as a pure function so the decision can be
 * checked directly instead of only by eye — the first-card case (nothing above
 * the trigger but the rail header) is precisely the one that broke before.
 *
 * Preference is BELOW. Flip above only if it does not fit below; if it fits
 * neither way take the roomier side, and the caller caps that side's height with
 * internal scroll so the menu is never cut off.
 */
export function pickMenuDirection(roomBelow: number, roomAbove: number, height: number): "down" | "up" {
  if (height <= roomBelow) return "down";
  if (height <= roomAbove) return "up";
  return roomBelow >= roomAbove ? "down" : "up";
}

export function OperatorMenu({
  anchor, operators, currentId, onPick, onClose, label = "Assign to",
}: {
  /** The trigger element. Position is measured from this, every time. */
  anchor:    HTMLElement | null;
  operators: Operator[];
  currentId?: number | null;
  onPick:    (id: number) => void;
  onClose:   () => void;
  label?:    string;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed", top: 0, left: 0, visibility: "hidden",
  });

  const update = useCallback(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const OFFSET = 6; // gap between trigger and menu
    const EDGE = 8;   // min gap from the viewport edge

    // Real height — the portal has rendered by the time this runs.
    const h = popRef.current?.scrollHeight ?? 160;

    const s: React.CSSProperties = { position: "fixed", zIndex: 60, width: MENU_WIDTH };
    const roomBelow = vh - r.bottom - OFFSET - EDGE;
    const roomAbove = r.top - OFFSET - EDGE;

    // Prefer BELOW. This is what keeps the first card's menu off the header.
    const openUp = pickMenuDirection(roomBelow, roomAbove, h) === "up";

    if (openUp) {
      s.bottom = vh - r.top + OFFSET;
      if (h > roomAbove) { s.maxHeight = Math.max(0, roomAbove); s.overflowY = "auto"; }
    } else {
      s.top = r.bottom + OFFSET;
      if (h > roomBelow) { s.maxHeight = Math.max(0, roomBelow); s.overflowY = "auto"; }
    }
    // Left-aligned to the trigger, then clamped so it can never cross an edge.
    s.left = Math.min(Math.max(EDGE, r.left), vw - MENU_WIDTH - EDGE);
    setStyle(s);
  }, [anchor]);

  // LAYOUT effect: measure and place before the browser paints, so the menu is
  // never seen at its placeholder position.
  useLayoutEffect(() => { update(); }, [update]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (anchor?.contains(t) || popRef.current?.contains(t)) return;
      onClose();
    }
    document.addEventListener("mousedown", onDown);
    // capture:true — scrolling ANY ancestor scroller (the rail, the panel body)
    // must reposition it, not just the window.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchor, onClose, update]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={popRef}
      style={style}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
      className="bg-white border border-gray-200 rounded-[9px] shadow-lg overflow-hidden"
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
    </div>,
    document.body,
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
