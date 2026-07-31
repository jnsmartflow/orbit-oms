"use client";

import { useState, useEffect, useRef } from "react";
import {
  Search,
  Keyboard,
  Download,
  Upload,
} from "lucide-react";
import { ImportModal } from "@/components/import/import-modal";
// Row 2's Filter and date stepper were extracted 2026-07-31 so the Billing tab
// row can host the SAME controls rather than lookalikes. Both are verbatim
// moves — see each file's header. This header still owns `filterOpen` and
// passes it down, because its Escape handler runs a priority chain
// (search → shortcuts → filter) that only the state owner can order.
import { HeaderFilter } from "@/components/header-filter";
import { HeaderDateStepper } from "@/components/header-date-stepper";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HeaderStat {
  label: string;
  value: number | string;
  tone?: "success";
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
  segmentsDisabled?: boolean;
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

  /**
   * Suppress Row 2 (the filter bar) entirely — the row, its border, and its
   * 40px of height. Default `false`, i.e. today's behaviour for every caller.
   *
   * Exists for a surface that has relocated Row 2's controls elsewhere and would
   * otherwise be left with an empty 40px strip and a stray bottom rule. This
   * header knows nothing about which surface that is; it just takes the flag.
   *
   * ⚠ Row 2 also hosts `rightExtra` and `leftExtra`. Suppressing it hides those
   * too — a caller that passes either MUST NOT set this at the same time.
   */
  suppressFilterBar?: boolean;

  // Search
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (query: string) => void;

  /**
   * Where the search box sits in Row 1. Default `"compact"` — today's behaviour
   * for every caller: a 180px pill in the right-hand cluster that widens to
   * 260px on focus.
   *
   * `"wide"` promotes it to its OWN middle column — title left, search centred,
   * icon cluster right. The INPUT and every behaviour attached to it are the
   * same in both modes (same ref, same handlers, same `/`-to-focus and
   * Escape-to-clear); only the wrapper's width and its position in the row
   * change.
   *
   * ⚠ The focus width transition is deliberately NOT applied in wide mode — a
   * fixed w-[180px]/w-[260px] fights the flex sizing and the bar would jump.
   */
  searchLayout?: "compact" | "wide";

  /**
   * Render the IST clock (and the divider that follows it). Default `true`.
   *
   * ⚠ Setting this false also stops the 1-second `setInterval` that drives it.
   * Gating only the markup would leave every consumer re-rendering this header
   * once a second to update a string nobody displays.
   */
  showClock?: boolean;

  // Shortcuts
  shortcuts?: ShortcutItem[];

  // Import — when true, renders the Import button leftmost in Row 1 right
  // cluster. Each board page sets this from session role; the header itself
  // does not read session. Open/close is managed internally.
  showImport?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// getTodayIST / toISTDateStr / formatDateShort / shiftDay moved to
// components/header-date-stepper.tsx with the control they served (2026-07-31),
// copied character-for-character. Nothing else in this file used them.

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
  suppressFilterBar = false,
  searchPlaceholder = "Search...",
  searchValue,
  onSearchChange,
  searchLayout = "compact",
  showClock = true,
  shortcuts,
  showImport,
  segmentsDisabled,
}: UniversalHeaderProps) {
  const [clock, setClock] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const shortcutsRef = useRef<HTMLDivElement>(null);
  // filterRef moved into HeaderFilter with the outside-click effect it anchored.
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Clock. Gated on showClock (default true → unchanged for every caller):
  // when the clock is not rendered the interval must not run either, or the
  // header re-renders once a second to update a string nobody sees.
  useEffect(() => {
    if (!showClock) return;
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
  }, [showClock]);

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

  // The outside-click effect moved into HeaderFilter with this component
  // (2026-07-31) — same mousedown/document pairing, same open-flag dependency.
  // `filterOpen` STAYS here: the Escape chain below orders search → shortcuts →
  // filter, and only the owner of all three can do that.

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
  // The date label/isToday derivation moved into HeaderDateStepper with the
  // control itself (2026-07-31) \u2014 it was only ever used by that block.

  const titleDisplay = title;

  // activeFilterCount + the toggle/clear handlers moved into HeaderFilter with
  // the control (2026-07-31), verbatim — including that "clear" writes an EMPTY
  // ARRAY per group rather than `{}`.

  const wideSearch = searchLayout === "wide";

  // The search box — ONE definition, rendered in one of two positions. Hoisted
  // rather than duplicated so the input, its ref, its handlers and the `/` hint
  // cannot drift between layouts; the Escape-to-clear and `/`-to-focus effect
  // above targets `searchInputRef` and is unaffected by where this lands.
  //
  // COMPACT is the original, character-for-character — grey pill, 11px text,
  // focus width transition. Every non-billing consumer renders this and must
  // keep rendering exactly it.
  //
  // WIDE is styled to sit beside Outlook: white fill on a thin border, gentle
  // radius, fixed 38px height, roomier type. Not a pill and not grey-filled —
  // the two modes share only the input's identity, never its look. Each element
  // branches on `wideSearch` rather than sharing a base string, so a future
  // tweak to one cannot leak into the other.
  const searchBox = (
    <div
      className={
        wideSearch
          ? "flex items-center gap-2.5 w-full max-w-[460px] h-[38px] rounded-[7px] bg-white border border-gray-200 px-3.5 transition-colors hover:border-gray-300 focus-within:border-gray-300 focus-within:shadow-[0_1px_2px_rgba(17,24,39,0.06)]"
          : `bg-gray-50 rounded-[6px] px-[10px] py-[4px] flex items-center gap-[6px] transition-all duration-200 ${
              searchFocused || searchValue ? "w-[260px]" : "w-[180px]"
            }`
      }
    >
      <Search size={wideSearch ? 15 : 13} className="text-gray-400 flex-shrink-0" />
      <input
        ref={searchInputRef}
        type="text"
        placeholder={searchPlaceholder}
        value={searchValue ?? ""}
        onChange={(e) => onSearchChange?.(e.target.value)}
        onFocus={() => setSearchFocused(true)}
        onBlur={() => setSearchFocused(false)}
        // Wide: transparent input over the wrapper's white fill — giving the
        // input its own background would double up and show a seam at the ends.
        className={
          wideSearch
            ? "flex-1 bg-transparent outline-none border-0 text-[13.5px] text-gray-900 placeholder:text-gray-500"
            : "bg-transparent border-none outline-none text-[11px] text-gray-900 placeholder:text-gray-400 flex-1 w-full"
        }
      />
      {/* `/` hint — same show/hide rule in both modes, only the chip restyled. */}
      {!searchFocused && !searchValue && (
        <span
          className={
            wideSearch
              ? "text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-[5px] px-1.5 py-0.5 flex-shrink-0"
              : "text-[9px] text-gray-400 bg-white border border-gray-200 rounded-[3px] px-[4px] py-[1px] flex-shrink-0"
          }
        >
          /
        </span>
      )}
    </div>
  );

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
                  {s.tone === "success" ? (
                    <span className="bg-green-50 text-green-600 font-semibold px-1.5 py-0.5 rounded">{s.value} {s.label}</span>
                  ) : (
                    <><span className="text-gray-900 font-semibold">{s.value}</span>{" "}{s.label}</>
                  )}
                </span>
              ))}
            </span>
          )}
        </div>

        {/* MIDDLE column — wide search only. Absent in compact mode, so Row 1
            stays the same two-child justify-between flex it has always been.
            The wrapper (not the box itself) carries flex-1 + the horizontal
            padding, so the bar centres in the free space without an auto-margin
            fighting the row's justify-between. */}
        {wideSearch && (
          <div className="flex flex-1 justify-center px-6">{searchBox}</div>
        )}

        {/* Right: import, clock, shortcuts, download, search */}
        <div className="flex items-center gap-2">
          {/* Import — leftmost, only when caller passes showImport=true */}
          {showImport && (
            <>
              <button
                type="button"
                title="Import OBDs"
                onClick={() => setImportOpen(true)}
                className="bg-gray-50 rounded-[5px] p-[4px_8px] cursor-pointer hover:bg-gray-100 transition-colors flex items-center gap-[4px]"
              >
                <Upload size={13} className="text-gray-400" />
                <span className="text-[10px] text-gray-500 font-medium">Import</span>
              </button>
              <div className="w-px h-4 bg-gray-200" />
            </>
          )}

          {/* Clock — with its TRAILING DIVIDER. The two go together: dropping
              the span alone would leave a separator with nothing before it. */}
          {showClock && (
            <>
              <span
                suppressHydrationWarning
                className="text-[11px] font-medium text-gray-400"
                style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "0.5px" }}
              >
                {clock}
              </span>

              <div className="w-px h-4 bg-gray-200" />
            </>
          )}

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

          {/* Search — compact only. In wide mode the box has already rendered
              as the middle column above, and this divider goes with it: it is
              the separator BEFORE the search, so leaving it would dangle at the
              end of the cluster. */}
          {!wideSearch && (
            <>
              <div className="w-px h-4 bg-gray-200" />
              {searchBox}
            </>
          )}
        </div>
      </div>

      {/* ── Row 2 — Filter Bar ─────────────────────────────────────────────── */}
      {/* `suppressFilterBar` defaults to false, so this renders for every caller
          exactly as before. When set, the whole row goes — including its 40px
          height and bottom border, which is the point: an emptied row would
          otherwise leave a blank strip and a stray rule. */}
      {!suppressFilterBar && (
      <div className="h-[40px] min-h-[40px] sticky top-[52px] z-30 bg-white border-b border-gray-200 flex items-center justify-between px-4">
        {/* Left: segmented control + leftExtra */}
        <div className="flex items-center gap-2">
          {segments && segments.length > 0 && (
            <div
              data-tutorial="slot-segments"
              className={`inline-flex bg-gray-100 rounded-[7px] p-[3px] gap-[2px]${segmentsDisabled ? " opacity-40 pointer-events-none" : ""}`}
            >
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
          {/* Filter — extracted 2026-07-31 (components/header-filter.tsx).
              Same markup and behaviour; this header keeps owning `filterOpen`
              so its Escape priority chain (search -> shortcuts -> filter)
              still orders correctly. */}
          <HeaderFilter
            groups={filterGroups}
            activeFilters={activeFilters}
            onFilterChange={onFilterChange}
            open={filterOpen}
            onOpenChange={setFilterOpen}
          />

          {/* Date stepper + picker — extracted 2026-07-31
              (components/header-date-stepper.tsx). Same gate as before. */}
          {showDatePicker !== false && currentDate && onDateChange && (
            <>
              {filterGroups && filterGroups.length > 0 && (
                <div className="w-px h-4 bg-gray-200" />
              )}
              <HeaderDateStepper currentDate={currentDate} onDateChange={onDateChange} />
            </>
          )}
        </div>
      </div>
      )}

      {/* Import modal — single instance, owned by the header. Only rendered
          when consumer opted in via showImport, to avoid mounting unused
          state on screens that don't expose the button. */}
      {showImport && (
        <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      )}
    </>
  );
}
