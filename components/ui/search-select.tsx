"use client";

// SearchSelect — a closed field that opens into a search box with a list below
// it (docs/mockups/floor-trips/trip-form-v1.html, the "combobox"). Generic: the
// caller hands over the full list, a match rule and a row renderer. Filtering is
// client-side only — the lists it was built for are already loaded.
//
// ⚠ NO WINDOW-LEVEL KEY LISTENER. Keys are handled on the search input itself.
// Floor's single window Esc owner (floor-page.tsx) ignores an Esc pressed inside
// an INPUT, so Esc here closes the list and nothing else.
//
// ⚠ THE LIST IS NOT PORTALLED. It is absolutely positioned under the field, so
// inside a scrolling drawer it extends the scroll area instead of being clipped,
// and it is scrolled into view on open.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

export interface SearchSelectExtraRow {
  key: string;
  render: ReactNode;
  onPick: () => void;
}

interface SearchSelectProps<T> {
  id?: string;
  items: T[];
  getKey: (item: T) => string | number;
  /** `query` is the raw text in the box; an empty query should match everything. */
  matches: (item: T, query: string) => boolean;
  renderItem: (item: T, query: string) => ReactNode;
  /** Key of the selected item, for the row's selected style. */
  selectedKey?: string | number | null;
  /** What the closed field shows. null → the grey placeholder. */
  value: ReactNode | null;
  placeholder: string;
  searchPlaceholder: string;
  onPick: (item: T) => void;
  onClear: () => void;
  /** An optional last row built from the query (e.g. "Use … as typed plate"). */
  extraRow?: (query: string) => SearchSelectExtraRow | null;
  emptyText?: (query: string) => string;
  disabled?: boolean;
}

export const FIELD_FOCUS = "border-brand-500 ring-2 ring-brand-500/10";

export function SearchSelect<T>({
  id,
  items,
  getKey,
  matches,
  renderItem,
  selectedKey,
  value,
  placeholder,
  searchPlaceholder,
  onPick,
  onClear,
  extraRow,
  emptyText,
  disabled,
}: SearchSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLButtonElement>(null);

  const matched = open ? items.filter((it) => matches(it, query)) : [];
  const extra = open && extraRow ? extraRow(query) : null;
  type Row = { key: string; node: ReactNode; pick: () => void };
  const rows: Row[] = matched.map((it) => ({
    key: `i:${getKey(it)}`,
    node: renderItem(it, query),
    pick: () => onPick(it),
  }));
  if (extra) rows.push({ key: `x:${extra.key}`, node: extra.render, pick: extra.onPick });

  function close(refocus: boolean) {
    setOpen(false);
    setQuery("");
    setActive(0);
    if (refocus) requestAnimationFrame(() => fieldRef.current?.focus());
  }

  function pick(row: Row | undefined) {
    if (!row) return;
    row.pick();
    close(true);
  }

  // Click outside closes. A document mousedown listener, not a key listener.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Bring the list into view when it opens (it may sit low in a drawer).
  useEffect(() => {
    if (open) listRef.current?.parentElement?.scrollIntoView({ block: "nearest" });
  }, [open]);

  // Keep the active row visible while arrowing.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const clampedActive = Math.min(active, Math.max(rows.length - 1, 0));

  return (
    <div ref={rootRef} className="relative">
      {open ? (
        <div className={`flex h-[38px] items-center gap-2 rounded-lg border bg-white pl-3 pr-2.5 ${FIELD_FOCUS}`}>
          <input
            id={id}
            autoFocus
            value={query}
            placeholder={searchPlaceholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive(Math.min(clampedActive + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive(Math.max(clampedActive - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(rows[clampedActive]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                close(true);
              } else if (e.key === "Tab") {
                close(false);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-gray-900 outline-none placeholder:text-gray-400"
          />
          <ChevronUp size={14} className="shrink-0 text-gray-400" />
        </div>
      ) : (
        <div className="relative">
          <button
            ref={fieldRef}
            id={id}
            type="button"
            disabled={disabled}
            onClick={() => setOpen(true)}
            className="flex h-[38px] w-full items-center gap-2 rounded-lg border border-gray-200 bg-white pl-3 pr-2.5 text-left text-[13px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 disabled:cursor-not-allowed disabled:bg-gray-50"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap">
              {value ?? <span className="text-gray-400">{placeholder}</span>}
            </span>
            {/* Room for the clear button, which sits over the field (a button
                cannot hold a button). */}
            {value !== null && <span className="w-5 shrink-0" aria-hidden />}
            <ChevronDown size={14} className="shrink-0 text-gray-400" />
          </button>
          {value !== null && !disabled && (
            <button
              type="button"
              onClick={onClear}
              title="Clear"
              aria-label="Clear"
              className="absolute right-7 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              <X size={13} strokeWidth={2} />
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="absolute left-0 right-0 top-[42px] z-20 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          <div ref={listRef} className="max-h-[264px] overflow-y-auto p-1" role="listbox">
            {rows.length === 0 ? (
              <div className="px-3 py-3.5 text-[13px] text-gray-500">
                {emptyText ? emptyText(query) : "No matches"}
              </div>
            ) : (
              rows.map((r, i) => {
                const isSelected = r.key === `i:${selectedKey}`;
                return (
                  <div
                    key={r.key}
                    data-row={i}
                    role="option"
                    aria-selected={isSelected}
                    // mousedown, not click: the pick must land before the
                    // input's blur/outside-click can close the list.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(r);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] ${
                      i === clampedActive ? "bg-brand-50" : ""
                    } ${isSelected ? "font-semibold text-brand-700" : "text-gray-900"}`}
                  >
                    {r.node}
                  </div>
                );
              })
            )}
          </div>
          {items.length > 0 && (
            <div className="flex justify-end border-t border-gray-100 px-2.5 py-1.5 text-[11.5px] text-gray-400">
              {matched.length} of {items.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Wraps the first case-insensitive occurrence of `query` in `text` in a mark. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-amber-100 text-inherit">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/** Highlight a [start, end) span of `text` — for matches computed on a normalised copy. */
export function HighlightSpan({ text, start, end }: { text: string; start: number; end: number }) {
  if (start < 0 || end <= start) return <>{text}</>;
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded-sm bg-amber-100 text-inherit">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}
