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
}: Props) {
  const [open, setOpen]           = useState(false);
  const [calOpen, setCalOpen]     = useState(false);
  const [calDate, setCalDate]     = useState("");
  const [mounted, setMounted]     = useState(false);
  const [popStyle, setPopStyle]   = useState<React.CSSProperties>({});
  const [selDate, setSelDate]     = useState("");

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef     = useRef<HTMLDivElement>(null);

  // Portal safety: only render after mount (avoids SSR mismatch)
  useEffect(() => setMounted(true), []);

  const { today } = useMemo(() => getQuickDates(), []);

  const updatePosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const style: React.CSSProperties = { position: "fixed", zIndex: 400, width: 284 };
    if (popoverAlign === "right") {
      style.right = window.innerWidth - r.right;
    } else {
      style.left = r.left;
    }
    if (popoverDir === "up") {
      style.bottom = window.innerHeight - r.top + 5;
    } else {
      style.top = r.bottom + 5;
    }
    setPopStyle(style);
  }, [popoverDir, popoverAlign]);

  useEffect(() => {
    if (!open) return;
    updatePosition();

    function onMousedown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onMousedown);
    return () => document.removeEventListener("mousedown", onMousedown);
  }, [open, updatePosition]);

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

  const isSelected = (date: string, winId: number) =>
    value?.date === date && value?.dispatchWindowId === winId;

  // ── Trigger ──────────────────────────────────────────────────────────────

  const triggerCls = [
    "inline-flex items-center gap-1.5 h-[22px] px-[9px] rounded-full border text-[11px] font-medium whitespace-nowrap transition-all select-none",
    disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
    value
      ? "border-teal-200 bg-teal-50 text-gray-800"
      : open
      ? "border-teal-600 shadow-[0_0_0_3px_rgba(13,148,136,0.07)] text-gray-500"
      : "border-gray-200 bg-white text-gray-400",
  ].join(" ");

  // ── Popover markup ────────────────────────────────────────────────────────

  const activeDate = selDate || today;

  const popover = (
    <div
      ref={popRef}
      style={{ ...popStyle, boxShadow: "0 8px 24px rgba(0,0,0,.11), 0 1px 4px rgba(0,0,0,.05)" }}
      className="bg-white border border-slate-200 rounded-[11px] overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {/* DATE RAIL */}
      <div
        className="flex items-stretch gap-[3px] px-2.5 py-[8px] border-b border-gray-100 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {getRailDates(today).map(({ iso, wd, d, m }) => (
          <button
            key={iso}
            type="button"
            onClick={() => setSelDate(iso)}
            className={[
              "flex-shrink-0 flex flex-col items-center px-[9px] py-[5px] min-w-[38px]",
              "rounded-[7px] text-center transition-colors border-0 outline-none",
              activeDate === iso ? "bg-teal-600" : "bg-gray-100 hover:bg-gray-200",
            ].join(" ")}
          >
            <span className={`text-[8.5px] font-medium leading-[1.2] ${activeDate === iso ? "text-white/70" : "text-gray-400"}`}>{wd}</span>
            <span className={`text-[15px] font-bold leading-[1.1] ${activeDate === iso ? "text-white" : "text-gray-800"}`}>{d}</span>
            <span className={`text-[8.5px] leading-[1.2] ${activeDate === iso ? "text-white/70" : "text-gray-400"}`}>{m}</span>
          </button>
        ))}
        {/* Calendar icon — tap to toggle far-date input */}
        <button
          type="button"
          onClick={() => setCalOpen((v) => !v)}
          className={[
            "flex-shrink-0 self-stretch flex items-center justify-center w-[30px]",
            "rounded-[7px] border transition-colors outline-none",
            calOpen
              ? "border-teal-500 text-teal-500 bg-teal-50"
              : "border-gray-200 text-gray-400 hover:border-teal-500 hover:text-teal-500",
          ].join(" ")}
          title="Pick another date"
        >
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </button>
      </div>

      {/* FAR DATE INPUT */}
      {calOpen && (
        <div className="px-2.5 py-2 bg-gray-50 border-b border-gray-100">
          <input
            type="date"
            min={today}
            value={calDate}
            onChange={(e) => {
              setCalDate(e.target.value);
              if (e.target.value) setSelDate(e.target.value);
            }}
            className="text-[11px] border border-gray-200 rounded-[6px] px-2 py-[3px] w-full focus:outline-none focus:border-teal-400 bg-white"
          />
        </div>
      )}

      {/* WINDOW PILLS */}
      <div className="px-2.5 pt-[7px] pb-[10px]">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-[6px]">
          Window
        </p>
        <div className="flex gap-[5px]">
          {windows.map((win) => (
            <button
              key={win.id}
              type="button"
              onClick={() => handleSelect(activeDate, win)}
              className={[
                "flex-1 flex items-center justify-center h-[32px] rounded-[7px]",
                "text-[12px] font-bold transition-colors border outline-none",
                isSelected(activeDate, win.id)
                  ? "bg-teal-600 border-teal-600 text-white shadow-sm"
                  : "bg-white border-gray-200 text-gray-700 hover:border-teal-500 hover:text-teal-500",
              ].join(" ")}
            >
              {win.windowTime}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        className={triggerCls}
      >
        {value ? (
          <>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-teal-500 shrink-0">
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
