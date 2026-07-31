"use client";

// The header Filter control — trigger + count badge + popover panel.
//
// EXTRACTED VERBATIM from components/universal-header.tsx (2026-07-31). This is
// a MOVE, not a rewrite: same markup, same class strings, same toggle/clear
// semantics. UniversalHeader renders it in the exact spot the inline block
// occupied, wired to the same props, so every existing caller is unchanged.
//
// It exists as its own component so a second surface — the Billing tab row —
// can host the SAME filter instead of a lookalike that drifts.
//
// ── OPEN STATE: controlled OR uncontrolled, and the difference matters ──
// UniversalHeader keeps owning `filterOpen` and passes it in (`open` +
// `onOpenChange`). That is deliberate: the header's Escape handler runs a
// PRIORITY CHAIN — search first, then the shortcuts sheet, then the filter —
// and only the owner of all three states can order them. If this component
// installed its own Escape listener while the header also had one, pressing
// Escape with the search focused would clear the search AND close the filter,
// where today it closes the search only.
//
// Used WITHOUT `open` (the tab row), it manages its own state and installs its
// own Escape listener — correct there, because no priority chain exists.

import { useCallback, useEffect, useRef, useState } from "react";
import { Filter } from "lucide-react";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterGroup {
  key: string;
  label: string;
  options: FilterOption[];
}

export function HeaderFilter({
  groups,
  activeFilters,
  onFilterChange,
  open: openProp,
  onOpenChange,
}: {
  groups?: FilterGroup[];
  activeFilters?: Record<string, string[]>;
  onFilterChange?: (filters: Record<string, string[]>) => void;
  /** Omit for self-managed open state. Pass to let a parent own it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openLocal, setOpenLocal] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openLocal;

  const filterRef = useRef<HTMLDivElement>(null);

  const setOpen = useCallback(
    (v: boolean) => {
      if (!controlled) setOpenLocal(v);
      onOpenChange?.(v);
    },
    [controlled, onOpenChange],
  );

  // Close on outside click — moved verbatim from universal-header.tsx:176-186,
  // same dependency (the open flag) and the same mousedown/document pairing.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, setOpen]);

  // Escape — UNCONTROLLED MODE ONLY. See the header note above: when the header
  // owns the state it also owns the Escape priority chain, and a second listener
  // here would close this popover on an Escape the header meant for the search.
  useEffect(() => {
    if (controlled || !open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [controlled, open, setOpen]);

  const activeFilterCount = activeFilters
    ? Object.values(activeFilters).reduce((s, arr) => s + arr.length, 0)
    : 0;

  const handleFilterToggle = useCallback(
    (groupKey: string, value: string) => {
      if (!activeFilters || !onFilterChange) return;
      const current = activeFilters[groupKey] ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      onFilterChange({ ...activeFilters, [groupKey]: next });
    },
    [activeFilters, onFilterChange],
  );

  // Verbatim from the header: clears to a map of EMPTY ARRAYS per group, not to
  // `{}`. The two are not interchangeable — a consumer reading
  // `filters[key].length` without a guard breaks on the absent key.
  const handleFilterClear = useCallback(() => {
    if (!groups || !onFilterChange) return;
    const empty: Record<string, string[]> = {};
    for (const g of groups) empty[g.key] = [];
    onFilterChange(empty);
  }, [groups, onFilterChange]);

  if (!groups || groups.length === 0) return null;

  return (
    <div className="relative" ref={filterRef}>
      <button
        onClick={() => setOpen(!open)}
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

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-[260px]">
          {groups.map((group, gi) => (
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
  );
}
