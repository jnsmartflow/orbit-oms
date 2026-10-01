"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// The Reports hub's one date control — shape from docs/mockups/reports/
// reports-popup.html: one field ("Today · 1 Oct 2026"); click opens a popover
// with presets on the left and a one-month calendar on the right.
//
// ⚠ IST DAYS, AND NO Date OBJECT EVER HOLDS ONE. Every day here is a
// "YYYY-MM-DD" string. "Today" is read once in Asia/Kolkata (the en-CA idiom
// components/ci/register-export.tsx uses — toISOString() is the UTC day, which
// after 18:30 IST is yesterday). Everything after that is calendar arithmetic
// on Date.UTC numbers, so the browser's own timezone never enters.
//
// Range mode: a preset fills the range and closes; two calendar clicks set a
// custom range (first click = start, second = end, either order) and mark
// Custom. Single mode: Today / Yesterday, or one calendar click — and closes.
// Weeks start Monday, as the mockup's do.

export type PeriodValue = { from: string; to: string };

type PresetKey = "today" | "yesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "custom";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** Today's calendar day in IST, YYYY-MM-DD. */
export function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** YYYY-MM-DD ↔ a UTC-midnight millisecond count — arithmetic only. */
function toMs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function addDays(iso: string, n: number): string {
  return fromMs(toMs(iso) + n * 86_400_000);
}
/** 0 = Monday … 6 = Sunday. */
function weekdayMon0(iso: string): number {
  return (new Date(toMs(iso)).getUTCDay() + 6) % 7;
}
function monthStart(y: number, m0: number): string {
  return fromMs(Date.UTC(y, m0, 1));
}
function monthEnd(y: number, m0: number): string {
  return fromMs(Date.UTC(y, m0 + 1, 0));
}

function presetRange(key: Exclude<PresetKey, "custom">, today: string): PeriodValue {
  const [y, m] = today.split("-").map(Number);
  const m0 = m - 1;
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const d = addDays(today, -1);
      return { from: d, to: d };
    }
    case "thisWeek":
      return { from: addDays(today, -weekdayMon0(today)), to: today };
    case "lastWeek": {
      const s = addDays(today, -weekdayMon0(today) - 7);
      return { from: s, to: addDays(s, 6) };
    }
    case "thisMonth":
      return { from: monthStart(y, m0), to: today };
    case "lastMonth":
      return { from: monthStart(y, m0 - 1), to: monthEnd(y, m0 - 1) };
  }
}

const RANGE_PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "thisWeek", label: "This week" },
  { key: "lastWeek", label: "Last week" },
  { key: "thisMonth", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "custom", label: "Custom" },
];
const SINGLE_PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "custom", label: "Custom" },
];

/** "1 Oct 2026". */
function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MON[m - 1]} ${y}`;
}

/** Which preset (if any) a value matches — so a value handed in from the URL
 *  still shows "Today ·" when it is today. */
function matchPreset(v: PeriodValue, today: string, single: boolean): PresetKey {
  const list = single ? SINGLE_PRESETS : RANGE_PRESETS;
  for (const p of list) {
    if (p.key === "custom") continue;
    const r = presetRange(p.key as Exclude<PresetKey, "custom">, today);
    if (r.from === v.from && r.to === v.to) return p.key;
  }
  return "custom";
}

export function PeriodPicker({
  value,
  onChange,
  mode = "range",
  id,
}: {
  value: PeriodValue;
  onChange: (v: PeriodValue) => void;
  /** "single" = one day; `from` and `to` are always equal. */
  mode?: "range" | "single";
  id?: string;
}) {
  const single = mode === "single";
  const [today] = useState(istToday);
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<PresetKey>(() => matchPreset(value, today, single));
  // First click of a custom range, waiting for the second.
  const [anchor, setAnchor] = useState<string | null>(null);
  const [view, setView] = useState(() => {
    const [y, m] = value.from.split("-").map(Number);
    return { y, m0: m - 1 };
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    if (open) {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onKey);
    }
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setAnchor(null);
  }

  function pickPreset(key: PresetKey) {
    setPreset(key);
    if (key === "custom") {
      setAnchor(null);
      return;
    }
    const r = presetRange(key, today);
    const [y, m] = r.from.split("-").map(Number);
    setView({ y, m0: m - 1 });
    onChange(r);
    close();
  }

  function pickDay(iso: string) {
    if (single) {
      onChange({ from: iso, to: iso });
      setPreset(matchPreset({ from: iso, to: iso }, today, true));
      close();
      return;
    }
    setPreset("custom");
    if (anchor === null) {
      setAnchor(iso);
      onChange({ from: iso, to: iso });
    } else {
      onChange(iso < anchor ? { from: iso, to: anchor } : { from: anchor, to: iso });
      setAnchor(null);
      close();
    }
  }

  function shiftMonth(n: number) {
    setView(({ y, m0 }) => {
      const t = m0 + n;
      return { y: y + Math.floor(t / 12), m0: ((t % 12) + 12) % 12 };
    });
  }

  // 6×7 grid starting on the Monday on/before the 1st.
  const first = monthStart(view.y, view.m0);
  const gridStart = addDays(first, -weekdayMon0(first));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const inMonth = (iso: string) => Number(iso.slice(5, 7)) - 1 === view.m0;

  const text = value.from === value.to ? fmtDay(value.from) : `${fmtDay(value.from)} – ${fmtDay(value.to)}`;
  const label = preset !== "custom" ? (single ? SINGLE_PRESETS : RANGE_PRESETS).find((p) => p.key === preset)?.label : null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        id={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          "flex h-[38px] w-full items-center justify-between gap-2.5 rounded-lg border bg-white px-3 text-left text-[13px] text-gray-900 transition-colors",
          open ? "border-brand-500 ring-2 ring-brand-500/10" : "border-gray-200 hover:border-gray-300",
        )}
      >
        <span className="truncate">{label ? `${label} · ${text}` : text}</span>
        <CalendarDays size={15} className="flex-shrink-0 text-gray-400" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={single ? "Choose a date" : "Choose period"}
          className="absolute left-0 top-[calc(100%+6px)] z-50 flex overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          <div className="w-[134px] border-r border-gray-200 p-1.5">
            {(single ? SINGLE_PRESETS : RANGE_PRESETS).map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => pickPreset(p.key)}
                className={cn(
                  "block w-full rounded-md px-2.5 py-[7px] text-left text-[12.5px] transition-colors",
                  preset === p.key ? "bg-brand-50 font-semibold text-brand-700" : "text-gray-600 hover:bg-gray-50",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="w-[258px] px-3 pb-3 pt-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => shiftMonth(-1)}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-900"
              >
                <ChevronLeft size={15} />
              </button>
              <span className="text-[12.5px] font-semibold text-gray-900">
                {MONTH[view.m0]} {view.y}
              </span>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => shiftMonth(1)}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-900"
              >
                <ChevronRight size={15} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-px">
              {DOW.map((d) => (
                <div key={d} className="py-[3px] text-center text-[9.5px] font-semibold text-gray-400">
                  {d}
                </div>
              ))}
              {cells.map((iso) => {
                const inRange = iso >= value.from && iso <= value.to;
                const isS = iso === value.from;
                const isE = iso === value.to;
                const edge = inRange && (isS || isE);
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => pickDay(iso)}
                    className={cn(
                      "h-7 text-[12px] transition-colors",
                      edge
                        ? cn(
                            "bg-brand-600 font-semibold text-white",
                            isS && isE ? "rounded-md" : isS ? "rounded-l-md" : "rounded-r-md",
                          )
                        : inRange
                          ? "bg-brand-50 text-gray-700"
                          : cn("rounded-md hover:bg-brand-50", inMonth(iso) ? "text-gray-700" : "text-gray-300"),
                      iso === today && !edge && "shadow-[inset_0_0_0_1px_theme(colors.brand.500)]",
                    )}
                  >
                    {Number(iso.slice(8, 10))}
                  </button>
                );
              })}
            </div>
            {!single && anchor !== null && (
              <div className="mt-2 text-[11px] text-gray-400">Pick the end date.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
