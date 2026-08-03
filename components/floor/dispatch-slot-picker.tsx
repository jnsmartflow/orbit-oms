"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { getTodayIST } from "@/lib/dates";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DispatchWindow {
  id: number;
  windowTime: string;
  label: string | null;
}

export interface DispatchSlotValue {
  date: string;            // YYYY-MM-DD
  dispatchWindowId: number;
  windowTime: string;      // e.g. "16:00" — kept for display
}

interface Props {
  value: DispatchSlotValue | null;
  onChange: (v: DispatchSlotValue | null) => void;
  windows: DispatchWindow[];
  popoverDir?: "down" | "up";
  popoverAlign?: "left" | "right";
  disabled?: boolean;
  forceOpenGen?: number;
  // HIGHLIGHT ONLY — a slot the host is PROPOSING (the rail's engine suggestion),
  // which is NOT a committed value. Read in exactly two places, both inside the
  // popover: the highlightDate fallback and the isSelected comparison. It is
  // deliberately never read near the trigger, because the filled/committed
  // trigger look means "this bill HAS a slot" and a suggestion has written
  // nothing — `value` alone owns that. Omit it and every existing call site
  // behaves exactly as before.
  suggested?: DispatchSlotValue | null;
  // The HOST draws the visible control (the rail's teal split button) and opens
  // this picker through forceOpenGen. The trigger button is still RENDERED —
  // invisible, non-interactive, stretched to fill the host's box — because
  // updatePosition() measures triggerRef to anchor the body-portalled popover;
  // omitting the element entirely would leave the popover unpositioned. The host
  // must therefore supply a `relative` wrapper for it to stretch into. This is
  // the same overlay the assign bar and detail panel already build by hand in
  // CSS, expressed as a prop instead. Default false = today's behaviour.
  hideTrigger?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSlot(v: DispatchSlotValue): string {
  const [, m, d] = v.date.split("-");
  return `${d}-${m} · ${v.windowTime}`;
}

function getQuickDates(): { today: string; tomorrow: string } {
  const today = getTodayIST();
  const [y, m, d] = today.split("-").map(Number);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  const tomorrow = `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
  return { today, tomorrow };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS   = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function getRailDates(anchor: string): Array<{ iso: string; wd: string; d: string; m: string }> {
  const [y, m, d] = anchor.split("-").map(Number);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return Array.from({ length: 6 }, (_, i) => {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    return {
      iso: `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`,
      wd:  WEEKDAYS[dt.getUTCDay()],
      d:   String(dt.getUTCDate()),
      m:   MONTHS[dt.getUTCMonth()],
    };
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DispatchSlotPicker({
  value,
  onChange,
  windows,
  popoverDir = "down",
  popoverAlign = "left",
  disabled,
  forceOpenGen,
  suggested,
  hideTrigger,
}: Props) {
  const [open, setOpen]           = useState(false);
  const [calOpen, setCalOpen]     = useState(false);
  const [calDate, setCalDate]     = useState("");
  const [mounted, setMounted]     = useState(false);
  const [popStyle, setPopStyle]   = useState<React.CSSProperties>({});
  const [selDate, setSelDate]     = useState("");

  const triggerRef    = useRef<HTMLButtonElement>(null);
  const popRef        = useRef<HTMLDivElement>(null);
  const lastForcedGen = useRef<number | undefined>(undefined);

  // Portal safety: only render after mount (avoids SSR mismatch)
  useEffect(() => setMounted(true), []);

  // forceOpenGen: increments each time the Status menu requests this picker to open.
  useEffect(() => {
    if (forceOpenGen !== undefined && forceOpenGen !== lastForcedGen.current) {
      lastForcedGen.current = forceOpenGen;
      setCalOpen(false);
      setCalDate("");
      setSelDate("");
      setOpen(true);
    }
  }, [forceOpenGen]);

  const { today } = useMemo(() => getQuickDates(), []);

  // Position the (body-portalled, position:fixed) popover, measured at open time.
  // popoverDir is a PREFERENCE, not a command: open in the preferred direction if
  // it fits, flip to the opposite if it doesn't, else use the roomier side and cap
  // the height with internal scroll. Horizontal prefers popoverAlign, then clamps
  // to the viewport. Re-run on scroll/resize/height-change keeps it glued.
  const updatePosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const WIDTH = 284;
    const OFFSET = 5; // gap between trigger and popover (unchanged)
    const EDGE = 8;   // min gap from the viewport edge

    // Natural (uncapped) height — scrollHeight so a previously-capped measure can't
    // feed back; estimate before first paint.
    const h = popRef.current?.scrollHeight || 200;

    const style: React.CSSProperties = { position: "fixed", zIndex: 400, width: WIDTH };

    // ── Vertical: preferred dir if it fits, else flip, else the roomier side ──
    const roomBelow = vh - r.bottom - OFFSET - EDGE;
    const roomAbove = r.top - OFFSET - EDGE;
    const fitsBelow = h <= roomBelow;
    const fitsAbove = h <= roomAbove;
    const openUp =
      popoverDir === "up"
        ? fitsAbove ? true : fitsBelow ? false : roomAbove >= roomBelow
        : fitsBelow ? false : fitsAbove ? true : roomBelow < roomAbove;

    if (openUp) {
      style.bottom = vh - r.top + OFFSET;
      if (h > roomAbove) { style.maxHeight = Math.max(0, roomAbove); style.overflowY = "auto"; }
    } else {
      style.top = r.bottom + OFFSET;
      if (h > roomBelow) { style.maxHeight = Math.max(0, roomBelow); style.overflowY = "auto"; }
    }

    // ── Horizontal: prefer the aligned edge, clamp so it never crosses out ──
    const anchorLeft = popoverAlign === "right" ? r.right - WIDTH : r.left;
    style.left = Math.min(Math.max(EDGE, anchorLeft), vw - WIDTH - EDGE);

    setPopStyle(style);
  }, [popoverDir, popoverAlign]);

  useEffect(() => {
    if (!open) return;
    updatePosition();

    function reposition() {
      updatePosition();
    }
    function onMousedown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onMousedown);
    // capture:true so scrolling ANY ancestor scroller (rail, table, panel) — not
    // just window — keeps the portalled popover glued to its trigger.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onMousedown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, updatePosition]);

  // The far-date input changes the popover height — re-measure when it toggles so
  // the flip/cap decision stays correct.
  useEffect(() => {
    if (open) updatePosition();
  }, [calOpen, open, updatePosition]);

  function handleToggle() {
    if (disabled) return;
    if (open) {
      setOpen(false);
    } else {
      setCalOpen(false);
      setCalDate("");
      setSelDate("");
      setOpen(true);
    }
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange(null);
  }

  function handleSelect(date: string, win: DispatchWindow) {
    onChange({ date, dispatchWindowId: win.id, windowTime: win.windowTime });
    setOpen(false);
    setCalDate("");
    setCalOpen(false);
  }

  // What the popover HIGHLIGHTS. A committed `value` always wins; `suggested` is
  // only consulted when there is none, so a bill that already has a slot can
  // never have it visually overridden by a proposal. With `suggested` omitted
  // this is just `value`, so existing call sites are unaffected.
  const highlightSource = value ?? suggested ?? null;

  const isSelected = (date: string, winId: number) =>
    highlightSource?.date === date && highlightSource?.dispatchWindowId === winId;

  // ── Trigger ──────────────────────────────────────────────────────────────

  const triggerCls = [
    "inline-flex items-center gap-1.5 h-[22px] px-[9px] rounded-full border text-[11px] font-medium whitespace-nowrap transition-all select-none",
    disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
    value
      ? "border-gray-300 bg-gray-100 text-gray-800"
      : open
      ? "border-gray-900 shadow-[0_0_0_3px_rgba(17,24,39,0.06)] text-gray-500"
      : "border-gray-200 bg-white text-gray-400",
  ].join(" ");

  // ── Popover markup ────────────────────────────────────────────────────────

  const rail = getRailDates(today);
  const railFirstMonth = rail[0]?.m;
  // Highlight the bill's own slot day (or, absent one, the host's suggested day)
  // ONLY when it is visible in the rail; never fall back to today — highlighting
  // today for a bill sitting on an off-rail date (or with no slot) is a guess
  // dressed as a fact. "" ⇒ nothing highlighted.
  const highlightDate =
    selDate ||
    (highlightSource != null && rail.some((r) => r.iso === highlightSource.date) ? highlightSource.date : "");
  // The day a bare window-tap commits to: the highlight if any, else today (a
  // fresh pick defaults to today). handleSelect / commit-on-tap are unchanged.
  const activeDate = highlightDate || today;

  const popover = (
    <div
      ref={popRef}
      // Behaviour-neutral marker: present only while the popover is open (it is
      // rendered only when open). Lets a host Esc handler detect an open picker
      // and skip its own action — no effect on this component or /support.
      data-slot-popover="open"
      style={{ ...popStyle, boxShadow: "0 8px 24px rgba(0,0,0,.11), 0 1px 4px rgba(0,0,0,.05)" }}
      className="bg-white border border-gray-200 rounded-xl p-[13px]"
      onClick={(e) => e.stopPropagation()}
    >
      {/* DAY STRIP — one hairline-bordered container, days flush edge to edge,
          calendar escape hatch at the right end. Variant A of
          docs/mockups/floor-control/slot-picker-v2.html. */}
      <div className="flex items-stretch overflow-hidden rounded-lg border border-gray-200">
        {rail.map(({ iso, wd, d, m }, i) => {
          const on = highlightDate === iso;
          const isLast = i === rail.length - 1;
          // Month tag only on tiles in a NEW month (the 6-day range crossed a
          // boundary), so "1 Aug" reads unambiguously; first-month tiles show
          // the number alone.
          const showMonth = m !== railFirstMonth;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => setSelDate(iso)}
              className={[
                "flex-1 flex flex-col items-center py-[7px] text-center transition-colors outline-none",
                isLast ? "" : "border-r border-gray-100",
                on ? "bg-gray-900" : "bg-white hover:bg-gray-50",
              ].join(" ")}
            >
              <span className={`text-[9px] font-medium uppercase tracking-wide leading-[1.2] ${on ? "text-white/55" : "text-gray-400"}`}>{wd}</span>
              <span className="flex items-baseline gap-[3px] leading-[1.1]">
                <span className={`text-[14.5px] font-semibold tabular-nums ${on ? "text-white" : "text-gray-800"}`}>{d}</span>
                {showMonth && <span className={`text-[9px] ${on ? "text-white/55" : "text-gray-400"}`}>{m}</span>}
              </span>
            </button>
          );
        })}
        {/* Calendar icon — toggles the far-date input (unchanged behaviour). */}
        <button
          type="button"
          onClick={() => setCalOpen((v) => !v)}
          className={[
            "flex-none self-stretch flex w-[34px] items-center justify-center border-l border-gray-200 transition-colors outline-none",
            calOpen ? "bg-gray-100 text-gray-700" : "bg-gray-50 text-gray-400 hover:text-gray-700",
          ].join(" ")}
          title="Pick another date"
        >
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </button>
      </div>

      {/* FAR DATE INPUT — the calendar escape hatch (unchanged behaviour). */}
      {calOpen && (
        <div className="mt-2 rounded-lg bg-gray-50 px-2.5 py-2">
          <input
            type="date"
            min={today}
            value={calDate}
            onChange={(e) => {
              setCalDate(e.target.value);
              if (e.target.value) setSelDate(e.target.value);
            }}
            className="w-full rounded-[6px] border border-gray-200 bg-white px-2 py-[3px] text-[11px] focus:border-gray-400 focus:outline-none"
          />
        </div>
      )}

      {/* WINDOW ROW — no caps label; selected pill is near-black, not teal. */}
      <div className="mt-[10px] flex gap-1.5">
        {windows.map((win) => (
          <button
            key={win.id}
            type="button"
            onClick={() => handleSelect(activeDate, win)}
            className={[
              "flex-1 flex items-center justify-center h-[31px] rounded-md border text-[11.5px] tabular-nums transition-colors outline-none",
              isSelected(highlightDate, win.id)
                ? "bg-gray-900 border-gray-900 text-white font-semibold"
                : "border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-900",
            ].join(" ")}
          >
            {win.windowTime}
          </button>
        ))}
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={hideTrigger ? "absolute inset-0" : "relative inline-block"}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        // hideTrigger: kept in the tree purely as the popover's measuring anchor
        // (see the prop comment). Invisible, unclickable, unfocusable, and hidden
        // from assistive tech — the host's own control is the real one.
        aria-hidden={hideTrigger || undefined}
        tabIndex={hideTrigger ? -1 : undefined}
        className={hideTrigger ? "pointer-events-none h-full w-full opacity-0" : triggerCls}
      >
        {value ? (
          <>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-gray-500 shrink-0">
              <path d="M1.5 5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{fmtSlot(value)}</span>
            <span
              onClick={handleClear}
              className="ml-0.5 text-gray-400 hover:text-gray-600 cursor-pointer leading-none"
            >
              ×
            </span>
          </>
        ) : (
          <>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>pick slot</span>
          </>
        )}
      </button>

      {open && mounted && createPortal(popover, document.body)}
    </div>
  );
}
