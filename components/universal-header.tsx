"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  Keyboard,
  Filter,
  Download,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HeaderStat {
  label: string;
  value: number;
}

export interface HeaderSegment {
  id: number | string;
  label: string;
  count?: number;
}

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterGroup {
  label: string;
  key: string;
  options: FilterOption[];
}

export interface ShortcutItem {
  key: string;
  label: string;
}

export interface UniversalHeaderProps {
  // Row 1
  title: React.ReactNode;
  stats?: HeaderStat[];
  showDownload?: boolean;
  onDownload?: () => void;

  // Row 2 left — segmented control
  segments?: HeaderSegment[];
  activeSegment?: number | string | null;
  onSegmentChange?: (id: number | string | null) => void;
  leftExtra?: React.ReactNode;

  // Row 2 right — extra + filters
  rightExtra?: React.ReactNode;
  filterGroups?: FilterGroup[];
  activeFilters?: Record<string, string[]>;
  onFilterChange?: (filters: Record<string, string[]>) => void;

  // Row 2 right — date
  currentDate?: Date;
  onDateChange?: (date: Date) => void;
  showDatePicker?: boolean;

  // Search
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (query: string) => void;

  // Shortcuts
  shortcuts?: ShortcutItem[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTodayIST(): Date {
  const now = new Date();
  const istStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return new Date(istStr + "T00:00:00+05:30");
}

function toISTDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function formatDateShort(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

function shiftDay(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

// ── Component ────────────────────────────────────────────────────────────────

export function UniversalHeader({
  title,
  stats,
  showDownload,
  onDownload,
  segments,
  activeSegment,
  onSegmentChange,
  leftExtra,
  rightExtra,
  filterGroups,
  activeFilters,
  onFilterChange,
  currentDate,
  onDateChange,
  showDatePicker = true,
  searchPlaceholder = "Search...",
  searchValue,
  onSearchChange,
  shortcuts,
}: UniversalHeaderProps) {
  const [clock, setClock] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);

  const shortcutsRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Clock
  useEffect(() => {
    function tick() {
      setClock(
        new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "Asia/Kolkata",
        }),
      );
    }
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // Close shortcuts on outside click
  useEffect(() => {
    if (!shortcutsOpen) return;
    function handleClick(e: MouseEvent) {
      if (shortcutsRef.current && !shortcutsRef.current.contains(e.target as Node)) {
        setShortcutsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [shortcutsOpen]);

  // Close filter on outside click
  useEffect(() => {
    if (!filterOpen) return;
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [filterOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "Escape") {
        if (searchFocused) {
          onSearchChange?.("");
          searchInputRef.current?.blur();
          return;
        }
        if (shortcutsOpen) { setShortcutsOpen(false); return; }
        if (filterOpen) { setFilterOpen(false); return; }
        return;
      }

      if (inInput) return;

      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (segments && segments.length > 0 && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < segments.length) {
          const seg = segments[idx];
          onSegmentChange?.(activeSegment === seg.id ? null : seg.id);
        }
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchFocused, shortcutsOpen, filterOpen, segments, activeSegment, onSegmentChange, onSearchChange]);

  // Date calculations
  const todayIST = getTodayIST();
  const todayStr = toISTDateStr(todayIST);
  const currentStr = currentDate ? toISTDateStr(currentDate) : todayStr;
  const yesterdayStr = toISTDateStr(shiftDay(todayIST, -1));
  const isToday = currentStr === todayStr;

  const dateLabel = !currentDate
    ? ""
    : isToday
      ? `Today \u00b7 ${formatDateShort(currentDate)}`
      : currentStr === yesterdayStr
        ? `Yesterday \u00b7 ${formatDateShort(currentDate)}`
        : formatDateShort(currentDate);

  const titleDisplay = title;

  // Active filter count
  const activeFilterCount = activeFilters
    ? Object.values(activeFilters).reduce((s, arr) => s + arr.length, 0)
    : 0;

  const handleFilterToggle = useCallback((groupKey: string, value: string) => {
    if (!activeFilters || !onFilterChange) return;
    const current = activeFilters[groupKey] ?? [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onFilterChange({ ...activeFilters, [groupKey]: next });
  }, [activeFilters, onFilterChange]);

  const handleFilterClear = useCallback(() => {
    if (!filterGroups || !onFilterChange) return;
    const empty: Record<string, string[]> = {};
    for (const g of filterGroups) empty[g.key] = [];
    onFilterChange(empty);
  }, [filterGroups, onFilterChange]);

  // Universal shortcuts
  const universalShortcuts: ShortcutItem[] = [
    { key: "/", label: "Focus search" },
    { key: "Esc", label: "Close / clear" },
    ...(segments && segments.length > 0
      ? [{ key: "1-" + Math.min(segments.length, 9), label: "Jump to slot" }]
      : []),
    { key: "\u2191\u2193", label: "Navigate rows" },
    { key: "\u21B5", label: "Expand" },
  ];

  return (
    <>
      {/* ── Row 1 — Title Bar ──────────────────────────────────────────────── */}
      <div className="h-[52px] min-h-[52px] sticky top-0 z-40 bg-white border-b border-gray-200 flex items-center justify-between px-4">
        {/* Left: title + stats */}
        <div className="flex items-center">
          <span className="text-[14px] font-semibold text-gray-900">
            {titleDisplay}
          </span>
          {stats && stats.length > 0 && (
            <span className="text-[11px] text-gray-400 ml-3">
              {stats.map((s, i) => (
                <span key={s.label}>
                  {i > 0 && " \u00b7 "}
                  <span className="text-gray-900 font-semibold">{s.value}</span>{" "}
                  {s.label}
                </span>
              ))}
            </span>
          )}
        </div>

        {/* Right: clock, shortcuts, download, search */}
        <div className="flex items-center gap-2">
          {/* Clock */}
          <span
            suppressHydrationWarning
            className="text-[11px] font-medium text-gray-400"
            style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "0.5px" }}
          >
            {clock}
          </span>

          <div className="w-px h-4 bg-gray-200" />

          {/* Shortcuts */}
          <div className="relative" ref={shortcutsRef}>
            <button
              onClick={() => setShortcutsOpen((v) => !v)}
              className="bg-gray-50 rounded-[5px] p-[4px_8px] cursor-pointer hover:bg-gray-100 transition-colors"
              title="Keyboard shortcuts (?)"
            >
              <Keyboard size={13} className="text-gray-400" />
            </button>
            {shortcutsOpen && (
              <div className="absolute top-full right-0 mt-2 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-[220px] max-h-[calc(100vh-120px)] overflow-y-auto">
                <p className="text-[11px] font-semibold text-gray-900 mb-2">
                  Keyboard shortcuts
                </p>
                {universalShortcuts.map((s) => (
                  <div key={s.key} className="flex items-center justify-between py-[3px]">
                    <span className="text-[11px] text-gray-600">{s.label}</span>
                    <span className="text-[11px] font-mono text-gray-500 bg-gray-50 border border-gray-200 rounded px-[6px] py-[1px]">
                      {s.key}
                    </span>
                  </div>
                ))}
                {shortcuts && shortcuts.length > 0 && (
                  <>
                    <div className="border-t border-gray-100 my-2" />
                    {shortcuts.map((s) => (
                      <div key={s.key} className="flex items-center justify-between py-[3px]">
                        <span className="text-[11px] text-gray-600">{s.label}</span>
                        <span className="text-[11px] font-mono text-gray-500 bg-gray-50 border border-gray-200 rounded px-[6px] py-[1px]">
                          {s.key}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {showDownload && (
            <>
              <div className="w-px h-4 bg-gray-200" />
              <button
                onClick={() => onDownload?.()}
                className="bg-teal-600 hover:bg-teal-700 text-white text-[10px] font-medium rounded-[5px] px-[10px] py-[4px] flex items-center gap-[4px] cursor-pointer"
              >
                <Download size={12} /> Download
              </button>
            </>
          )}

          <div className="w-px h-4 bg-gray-200" />

          {/* Search */}
          <div
            className={`bg-gray-50 rounded-[6px] px-[10px] py-[4px] flex items-center gap-[6px] transition-all duration-200 ${
              searchFocused || searchValue ? "w-[260px]" : "w-[180px]"
            }`}
          >
            <Search size={13} className="text-gray-400 flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={searchPlaceholder}
              value={searchValue ?? ""}
              onChange={(e) => onSearchChange?.(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              className="bg-transparent border-none outline-none text-[11px] text-gray-900 placeholder:text-gray-400 flex-1 w-full"
            />
            {!searchFocused && !searchValue && (
              <span className="text-[9px] text-gray-400 bg-white border border-gray-200 rounded-[3px] px-[4px] py-[1px] flex-shrink-0">
                /
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Row 2 — Filter Bar ─────────────────────────────────────────────── */}
      <div className="h-[40px] min-h-[40px] sticky top-[52px] z-30 bg-white border-b border-gray-200 flex items-center justify-between px-4">
        {/* Left: segmented control + leftExtra */}
        <div className="flex items-center gap-2">
          {segments && segments.length > 0 && (
            <div data-tutorial="slot-segments" className="inline-flex bg-gray-100 rounded-[7px] p-[3px] gap-[2px]">
              {segments.map((seg) => {
                const isActive = activeSegment === seg.id;
                return (
                  <button
                    key={seg.id}
                    onClick={() => onSegmentChange?.(isActive ? null : seg.id)}
                    className={`px-[11px] py-[4px] text-[11px] rounded-[5px] cursor-pointer transition-colors ${
                      isActive
                        ? "bg-teal-600 text-white font-medium"
                        : "text-gray-500 hover:bg-white/60"
                    }`}
                  >
                    {seg.label}{seg.count != null ? ` \u00b7 ${seg.count}` : ""}
                  </button>
                );
              })}
            </div>
          )}
          {leftExtra}
        </div>

        {/* Right: rightExtra + filter + date */}
        <div className="flex items-center gap-2">
          {rightExtra}
          {rightExtra && <div className="w-px h-4 bg-gray-200" />}
          {/* Filter button */}
          {filterGroups && filterGroups.length > 0 && (
            <div className="relative" ref={filterRef}>
              <button
                onClick={() => setFilterOpen((v) => !v)}
                className={`border rounded-[5px] px-[7px] py-[3px] flex items-center gap-[4px] cursor-pointer transition-colors ${
                  activeFilterCount > 0
                    ? "border-gray-900"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <Filter
                  size={11}
                  className={activeFilterCount > 0 ? "text-gray-900" : "text-gray-500"}
                />
                <span
                  className={`text-[10px] ${
                    activeFilterCount > 0
                      ? "font-medium text-gray-900"
                      : "text-gray-500"
                  }`}
                >
                  Filter
                </span>
                {activeFilterCount > 0 && (
                  <span className="bg-gray-900 text-white text-[8px] font-medium min-w-[14px] h-[14px] rounded-full flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              {filterOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-[260px]">
                  {filterGroups.map((group, gi) => (
                    <div key={group.key}>
                      <p
                        className={`text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-[6px] ${
                          gi === 0 ? "" : "mt-[8px]"
                        }`}
                      >
                        {group.label}
                      </p>
                      <div className="flex flex-wrap gap-[4px]">
                        {group.options.map((opt) => {
                          const isActive = activeFilters?.[group.key]?.includes(opt.value);
                          return (
                            <button
                              key={opt.value}
                              onClick={() => handleFilterToggle(group.key, opt.value)}
                              className={`text-[10px] border rounded-[4px] px-[8px] py-[2px] cursor-pointer ${
                                isActive
                                  ? "bg-gray-900 text-white border-gray-900"
                                  : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {activeFilterCount > 0 && (
                    <div className="border-t border-gray-100 pt-[6px] mt-[8px]">
                      <button
                        onClick={handleFilterClear}
                        className="text-[11px] text-gray-400 hover:text-gray-600 cursor-pointer"
                      >
                        Clear all
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Date stepper */}
          {showDatePicker !== false && currentDate && onDateChange && (
            <>
              {filterGroups && filterGroups.length > 0 && (
                <div className="w-px h-4 bg-gray-200" />
              )}
              <div className="inline-flex items-center gap-0">
                <button
                  onClick={() => onDateChange(shiftDay(currentDate, -1))}
                  className="px-[6px] py-[3px] text-[10px] text-gray-400 border border-gray-200 rounded-l-[4px] cursor-pointer hover:bg-gray-50"
                >
                  <ChevronLeft size={12} />
                </button>
                <span className="px-[10px] py-[3px] text-[10px] font-medium text-gray-900 border-t border-b border-gray-200">
                  {dateLabel}
                </span>
                <button
                  onClick={() => !isToday && onDateChange(shiftDay(currentDate, 1))}
                  className={`px-[6px] py-[3px] text-[10px] text-gray-400 border border-gray-200 rounded-r-[4px] ${
                    isToday
                      ? "opacity-40 cursor-not-allowed pointer-events-none"
                      : "cursor-pointer hover:bg-gray-50"
                  }`}
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
