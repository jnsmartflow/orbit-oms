"use client";

import { useEffect, useRef, useState } from "react";

interface MonthPickerProps {
  // YYYY-MM
  currentMonth: string;
  // Current IST month (YYYY-MM) — used to compute disabled-future and 24-month-back bounds.
  currentIstMonth: string;
  onChange(month: string): void;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const MAX_MONTHS_BACK = 24; // mirrors backend bound

export function MonthPicker({
  currentMonth,
  currentIstMonth,
  onChange,
}: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  // Year being viewed in the dropdown — independent of currentMonth so
  // user can browse adjacent years before committing.
  const [viewYear, setViewYear] = useState<number>(() => {
    const [y] = currentMonth.split("-").map(Number);
    return Number.isFinite(y) ? y : new Date().getUTCFullYear();
  });
  const popoverRef = useRef<HTMLDivElement>(null);

  const [curY, curM] = currentIstMonth.split("-").map(Number);
  const [selY, selM] = currentMonth.split("-").map(Number);

  // Outside-click + Esc dismissal.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleSelect(monthIndex: number) {
    const y = viewYear;
    const m = monthIndex + 1;
    if (isMonthDisabled(y, m, curY, curM)) return;
    const monthStr = `${y}-${String(m).padStart(2, "0")}`;
    setOpen(false);
    onChange(monthStr);
  }

  // Year navigation
  const minYear = Math.floor(((curY ?? 0) * 12 + (curM ?? 0) - MAX_MONTHS_BACK - 1) / 12);
  const canGoPrev = viewYear > minYear;
  const canGoNext = viewYear < (curY ?? viewYear);

  const triggerLabel = `${MONTH_LABELS[(selM ?? 1) - 1]} ${selY}`;

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex items-center rounded-md px-3 py-1.5 text-xs transition-colors ${
          open
            ? "border border-gray-300 bg-gray-50 text-gray-900"
            : "border border-gray-200 bg-white text-gray-900 hover:bg-gray-50"
        }`}
      >
        {triggerLabel}
        <span className="text-[9px] text-gray-400 ml-1" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div
          role="dialog"
          className="absolute top-full right-0 mt-1 z-30 bg-white shadow-lg rounded-md p-2 w-64 border border-gray-200"
        >
          <div className="flex items-center justify-between px-2 py-1 mb-1">
            <button
              type="button"
              onClick={() => canGoPrev && setViewYear((y) => y - 1)}
              disabled={!canGoPrev}
              className={`text-[12px] px-1 ${
                canGoPrev
                  ? "text-gray-600 hover:text-gray-900"
                  : "text-gray-300 cursor-not-allowed"
              }`}
              aria-label="Previous year"
            >
              ‹
            </button>
            <span className="text-[12px] font-semibold text-gray-900 tabular-nums">
              {viewYear}
            </span>
            <button
              type="button"
              onClick={() => canGoNext && setViewYear((y) => y + 1)}
              disabled={!canGoNext}
              className={`text-[12px] px-1 ${
                canGoNext
                  ? "text-gray-600 hover:text-gray-900"
                  : "text-gray-300 cursor-not-allowed"
              }`}
              aria-label="Next year"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MONTH_LABELS.map((label, i) => {
              const monthNum = i + 1;
              const isSelected = viewYear === selY && monthNum === selM;
              const disabled = isMonthDisabled(viewYear, monthNum, curY, curM);
              const stateClass = isSelected
                ? "bg-gray-900 text-white font-semibold"
                : disabled
                  ? "text-gray-300 cursor-not-allowed"
                  : "text-gray-700 hover:bg-gray-50";
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => handleSelect(i)}
                  disabled={disabled}
                  className={`text-[12px] py-1.5 rounded ${stateClass}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-400 mt-2 text-center leading-snug">
            Months older than {MAX_MONTHS_BACK} months ago are disabled.
          </p>
        </div>
      )}
    </div>
  );
}

function isMonthDisabled(
  y: number,
  m: number,
  curY: number | undefined,
  curM: number | undefined,
): boolean {
  if (!curY || !curM) return true;
  const target = y * 12 + m;
  const current = curY * 12 + curM;
  if (target > current) return true; // future
  if (target < current - MAX_MONTHS_BACK) return true; // beyond 24 months back
  return false;
}
