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

function fmtDayLabel(iso: string, today: string, tomorrow: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const base = `${wd}, ${d} ${MONTHS[m - 1]}`;
  if (iso === today)    return `${base} · Today`;
  if (iso === tomorrow) return `${base} · Tomorrow`;
  return base;
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

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef     = useRef<HTMLDivElement>(null);

  // Portal safety: only render after mount (avoids SSR mismatch)
  useEffect(() => setMounted(true), []);

  const { today, tomorrow } = useMemo(() => getQuickDates(), []);

  const updatePosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const style: React.CSSProperties = { position: "fixed", zIndex: 400, width: 308 };
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

  const popover = (
    <div
      ref={popRef}
      style={popStyle}
      className="bg-white border border-gray-200 rounded-[10px] shadow-lg overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Quick pick — Today + Tomorrow */}
      {[today, tomorrow].map((date) => (
        <div key={date} className="flex items-start py-[5px] px-3.5 gap-2 border-b border-gray-50">
          <span className="text-[10px] text-gray-400 font-medium shrink-0 w-[100px] leading-[18px] pt-[2px]">
            {fmtDayLabel(date, today, tomorrow)}
          </span>
          <div className="flex flex-wrap gap-1">
            {windows.map((win) => (
              <button
                key={win.id}
                type="button"
                onClick={() => handleSelect(date, win)}
                className={[
                  "text-[10.5px] font-semibold px-2 py-[2px] rounded-[5px] transition-colors",
                  isSelected(date, win.id)
                    ? "bg-teal-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                ].join(" ")}
              >
                {win.windowTime}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Calendar zone */}
      <div className="px-3.5 py-2.5">
        <button
          type="button"
          onClick={() => setCalOpen((v) => !v)}
          className="flex items-center gap-1 text-[10.5px] text-teal-600 hover:text-teal-700 font-medium"
        >
          <span
            className="inline-block transition-transform duration-150"
            style={{ transform: calOpen ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            ▸
          </span>
          Pick another date…
        </button>

        {calOpen && (
          <div className="mt-2">
            <input
              type="date"
              min={today}
              value={calDate}
              onChange={(e) => setCalDate(e.target.value)}
              className="text-[11px] border border-gray-200 rounded px-2 py-1 w-full focus:outline-none focus:border-teal-400"
            />
            {calDate && (
              <div className="flex flex-wrap gap-1 mt-2">
                {windows.map((win) => (
                  <button
                    key={win.id}
                    type="button"
                    onClick={() => handleSelect(calDate, win)}
                    className={[
                      "text-[10.5px] font-semibold px-2 py-[2px] rounded-[5px] transition-colors",
                      isSelected(calDate, win.id)
                        ? "bg-teal-600 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                    ].join(" ")}
                  >
                    {win.windowTime}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
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
