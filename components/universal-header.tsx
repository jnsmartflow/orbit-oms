"use client";

import { useState, useEffect, useRef } from "react";
import {
  Search,
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
// The shortcuts button + popover were extracted 2026-08-01 for the same reason
// and on the same contract: this header uses it CONTROLLED (it owns
// `shortcutsOpen` and the Escape priority chain), the Billing tab row uses it
// bare. Verbatim move — see that file's header.
import { HeaderShortcuts } from "@/components/header-shortcuts";
import type { ShortcutItem } from "@/components/header-shortcuts";

// `ShortcutItem` moved to header-shortcuts.tsx with the control it describes.
// Re-exported here so the consumers that import it from this module keep
// working. Type-only, so this cannot become a runtime circular import.
export type { ShortcutItem } from "@/components/header-shortcuts";

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
   * `"wide-right"` keeps everything `"wide"` does to the BOX, but renders it —
   * and the Import button — at the HEAD of the right-hand cluster instead of
   * after the title, so the row reads `Title … Import search` with the pair
   * pinned to the right edge. Same single `searchBox`/`importButton` nodes, so
   * neither can drift between placements.
   *
   * ⚠ The focus width transition is deliberately NOT applied in either wide
   * mode — a fixed w-[180px]/w-[260px] fights the flex sizing and the bar would
   * jump.
   */
  searchLayout?: "compact" | "wide" | "wide-right";

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

  /**
   * How the Import button looks. Default `"default"` — the small grey chip it
   * has always been, unchanged for every existing caller.
   *
   * `"primary"` makes it the row's one filled call to action: teal-600, 36px
   * tall, white label. Intended for a surface where importing IS the primary
   * action rather than one utility among several. Behaviour, handler and modal
   * are identical either way — this is styling only.
   *
   * ⚠ teal-600 is the brand accent and CLAUDE_UI reserves it for a SINGLE
   * element per surface. A caller passing "primary" is asserting that Import is
   * that element there; do not pass it on a screen that already spends its teal
   * elsewhere.
   */
  importVariant?: "default" | "primary";

  /**
   * Render the keyboard-shortcuts BUTTON and its popover. Default `true`.
   *
   * ⚠ This gates the BUTTON only — never the shortcuts themselves. All three
   * keydown listeners (this component's own at the `useEffect` above, plus the
   * two a consumer page may register) are bound independently of whether this
   * renders, so every shortcut keeps firing when it is hidden. What is lost is
   * the on-screen LIST, i.e. discoverability.
   *
   * Named `showShortcutsButton`, not `showShortcuts`, precisely because
   * `shortcuts` (the extra-items array) sits next to it — the two must not read
   * as a pair that turns each other off.
   */
  showShortcutsButton?: boolean;
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
  importVariant = "default",
  showShortcutsButton = true,
  segmentsDisabled,
}: UniversalHeaderProps) {
  const [clock, setClock] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // filterRef moved into HeaderFilter with the outside-click effect it anchored;
  // shortcutsRef moved into HeaderShortcuts for the same reason (2026-08-01).
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

  // The shortcuts outside-click effect moved into HeaderShortcuts with the
  // control it anchored (2026-08-01), same mousedown/document pairing and the
  // same open-flag dependency. `shortcutsOpen` STAYS here for the same reason
  // `filterOpen` does — see the Escape chain below.

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

  // `wideSearch` governs the BOX's look (both wide modes share it); `wideRight`
  // governs only WHERE that box and the Import button render. Keeping them as
  // two derivations rather than one means the styling arms below never have to
  // know about placement.
  const wideSearch = searchLayout === "wide" || searchLayout === "wide-right";
  const wideRight  = searchLayout === "wide-right";

  // The search box — ONE definition, rendered in one of two positions. Hoisted
  // rather than duplicated so the input, its ref, its handlers and the `/` hint
  // cannot drift between layouts; the Escape-to-clear and `/`-to-focus effect
  // above targets `searchInputRef` and is unaffected by where this lands.
  //
  // COMPACT is the original, character-for-character — grey pill, 11px text,
  // focus width transition. Every non-billing consumer renders this and must
  // keep rendering exactly it.
  //
  // WIDE is a 300×36 grey field on a hairline border that turns WHITE with a
  // teal border and ring on focus — the field itself signals focus rather than a
  // shadow doing it. (This supersedes the borderless shadow-stack version from
  // d08f3870; same box size, different resting state.) The two modes share only
  // the input's identity, never its look. Each element branches on `wideSearch`
  // rather than sharing a base string, so a future tweak to one cannot leak into
  // the other.
  //
  // ⚠ The width is FIXED here (w-[300px]), not inherited from a parent. The
  // wide arm used to be `w-full max-w-[480px]` and relied on a 480px sizing
  // wrapper at its call site; that wrapper is gone. Re-introducing any wrapper
  // with its own width would push this box off the right edge by the
  // difference.
  const searchBox = (
    <div
      className={
        wideSearch
          ? "flex items-center gap-2 w-[300px] max-w-full min-w-0 h-[36px] rounded-[10px] bg-gray-50 border border-gray-200 px-3 transition-colors hover:border-gray-300 focus-within:bg-white focus-within:border-teal-600 focus-within:ring-2 focus-within:ring-teal-600/15"
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
        // Wide: transparent input over the wrapper's fill — giving the input its
        // own background would double up, show a seam at the ends, and defeat the
        // grey→white swap the wrapper does on focus.
        className={
          wideSearch
            ? "flex-1 bg-transparent outline-none border-0 text-[13px] text-gray-900 placeholder:text-gray-400"
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

  // The Import button — ONE definition, rendered in one of two clusters.
  // Compact keeps it leftmost in the RIGHT cluster (unchanged); wide moves it
  // into the LEFT cluster between the title and the search. Same handler, same
  // `importOpen` state, same single ImportModal instance at the bottom of this
  // component — only the render position differs.
  //
  // The trailing divider is NOT part of this: in compact it separates Import
  // from the clock/shortcuts that follow it, and in wide nothing follows it in
  // that cluster. It stays at the compact call site.
  //
  // Two looks, ONE definition — `importVariant` swaps the class strings and the
  // icon size, nothing else. The handler, the `importOpen` state and the single
  // ImportModal below are shared, so the two can never diverge in behaviour.
  // "default" is the original chip character-for-character; every consumer that
  // does not pass the prop gets exactly it.
  const importPrimary = importVariant === "primary";
  const importButton = (
    <button
      type="button"
      title="Import OBDs"
      onClick={() => setImportOpen(true)}
      className={
        importPrimary
          ? "flex items-center gap-1.5 h-[36px] px-3.5 rounded-[10px] bg-teal-600 hover:bg-teal-700 text-white text-[13px] font-medium transition-colors cursor-pointer"
          : "bg-gray-50 rounded-[5px] p-[4px_8px] cursor-pointer hover:bg-gray-100 transition-colors flex items-center gap-[4px]"
      }
    >
      <Upload size={importPrimary ? 15 : 13} className={importPrimary ? "text-white" : "text-gray-400"} />
      <span className={importPrimary ? "text-white" : "text-[10px] text-gray-500 font-medium"}>Import</span>
    </button>
  );

  // The `universalShortcuts` derivation moved into HeaderShortcuts with the
  // popover that was its only consumer (2026-08-01). It now takes a
  // `segmentCount` number instead of reading `segments.length` itself, so the
  // control never has to know what a segment is.

  return (
    <>
      {/* ── Row 1 — Title Bar ──────────────────────────────────────────────── */}
      <div className="h-[52px] min-h-[52px] sticky top-0 z-40 bg-white border-b border-gray-200 flex items-center justify-between px-4">
        {/* Left: title + stats — and in WIDE mode also Import and the search,
            so the row reads Billing · Import · search from the left edge.
            Compact keeps the bare `flex items-center` it has always had. */}
        <div className={wideSearch ? "flex items-center gap-3 min-w-0" : "flex items-center"}>
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

          {/* WIDE only — Import then search, both inside the LEFT cluster.
              Compact renders neither here; its Import stays in the right
              cluster below and its search stays at the end of it.
              WIDE-RIGHT renders neither here either: both move to the head of
              the right cluster below, so the row reads Title … Import search. */}
          {wideSearch && !wideRight && showImport && importButton}
          {/* Sizing wrapper — "wide" ONLY. It exists to give the box a definite
              parent width; the box's own w-[300px] makes it unnecessary in
              wide-right, where adding it back would shove the pair off the
              right edge by the difference. */}
          {wideSearch && !wideRight && <div className="w-[480px] max-w-full min-w-0">{searchBox}</div>}
        </div>

        {/* Spacer — either WIDE mode. The row is already justify-between, so
            this is belt and braces: it guarantees the right cluster holds the
            far right edge however wide the left cluster grows. */}
        {wideSearch && <div className="flex-1" />}

        {/* Right: import, clock, shortcuts, download, search */}
        <div className="flex items-center gap-2">
          {/* WIDE-RIGHT only — Import then search, at the HEAD of this cluster
              so they sit at the far right edge with Import to the LEFT of the
              search (flex order, no extra markup). The search box goes in bare:
              it carries its own w-[300px], and the "wide" sizing wrapper must
              NOT come along.

              No divider between them or after them: in compact the divider
              separates Import from the clock/shortcuts that follow, and here
              the caller that uses this layout hides both. */}
          {wideRight && showImport && importButton}
          {wideRight && searchBox}

          {/* Import — leftmost, only when caller passes showImport=true.
              COMPACT ONLY: in either wide mode it has already rendered — left
              cluster for "wide", head of this one for "wide-right" — and its
              divider goes with it, since nothing would follow the separator. */}
          {!wideSearch && showImport && (
            <>
              {importButton}
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

          {/* Shortcuts — button AND popover together, since the popover is
              absolutely positioned against this div and `shortcutsRef` anchors
              the outside-click effect to it. Gating only the <button> would
              leave an orphan.

              ⚠ This hides the BUTTON, never the shortcuts. The keydown effect
              above (`/`, Escape, 1-9) is a bare useEffect that does not consult
              this flag, and a consumer's own listeners are its own. */}
          {showShortcutsButton && (
            <HeaderShortcuts
              // CONTROLLED. This header owns `shortcutsOpen` because its Escape
              // handler orders search → shortcuts → filter, and only the owner
              // of all three can do that. Passing `open` also suppresses the
              // component's own Escape listener, which is the point.
              open={shortcutsOpen}
              onOpenChange={setShortcutsOpen}
              shortcuts={shortcuts}
              segmentCount={segments?.length}
            />
          )}

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
