"use client";

import { ChevronRight, Check, Search, X } from "lucide-react";
import {
  CHEVRON, DIVIDER, INK, MONO_BG, SEARCH_BG, STAR, VIOLET, VIOLET_BG,
  monogram, searchCustomers,
  type ApiCustomer, type V2Recent,
} from "./v2-data";

// The dealer picker, shared by the landing screen and the change-customer
// sheet so the two can never drift apart. Both render the SAME input and the
// SAME rows; the only difference is that the sheet marks the current dealer.
//
// 🔴 CONTAINMENT — imports ./v2-data and node_modules only.

/**
 * The search field. A REAL <input>, so it takes focus and a keyboard.
 *
 * ⚠ 15px is below iOS Safari's 16px zoom threshold, so focusing this field
 * zooms the page on an iPhone. That is the size the design asks for and it is
 * kept; `CLAUDE_UI.md §55` records the same trap on /po, where the qty input
 * was pushed to 16px specifically to stop it. If the zoom is unacceptable on
 * device, 16px here is the whole fix.
 */
export function CustomerSearchInput({
  value, onChange, autoFocus = false,
}: {
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-[12px] px-3" style={{ background: SEARCH_BG }}>
      <Search className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={2.5} />
      <input
        type="text"
        inputMode="search"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search dealer or code"
        className="min-w-0 flex-1 bg-transparent py-3 text-[15px] outline-none placeholder:text-neutral-400"
        style={{ color: INK }}
      />
      {value.length > 0 && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{ background: "#DEDCE3" }}
        >
          <X className="h-3 w-3 text-white" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

/** One flat dealer row. No card — a list divider is the only separator. */
export function CustomerRow({
  name, code, area, current = false, onPick,
}: {
  name: string; code: string; area: string | null;
  /** Marks the dealer already on the order: tinted, with a tick not a chevron. */
  current?: boolean;
  onPick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
      style={{ borderBottom: `1px solid ${DIVIDER}`, background: current ? VIOLET_BG : undefined }}
    >
      <span
        className="flex shrink-0 items-center justify-center rounded-[10px] text-[12px] font-extrabold text-neutral-600"
        style={{ width: 34, height: 34, background: current ? "#fff" : MONO_BG }}
      >
        {monogram(name)}
      </span>
      {/* min-w-0 is what lets the two lines truncate — a flex child defaults to
          min-width:auto and would otherwise push the row past the viewport. */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-bold" style={{ color: INK }}>{name}</span>
        <span className="block truncate font-mono text-[11px] text-neutral-400">
          {code}{area ? ` · ${area}` : ""}
        </span>
      </span>
      {current
        ? <Check className="h-4 w-4 shrink-0" strokeWidth={3} style={{ color: VIOLET }} />
        : <ChevronRight className="h-4 w-4 shrink-0" strokeWidth={2.5} style={{ color: CHEVRON }} />}
    </button>
  );
}

/**
 * The list body: recents + everyone when the query is empty, matches when it
 * is not.
 *
 * The full alphabetical list renders unvirtualised. That is a deliberate,
 * measured choice for ~698 plain rows — no images, no per-row effects — and
 * it is the reason nothing heavier was put in a row. If it stutters on a real
 * phone, paging is the fix, not a card redesign.
 */
export function CustomerListBody({
  customers, recents, query, currentCode, onPick,
}: {
  customers: ApiCustomer[];
  recents: V2Recent[];
  query: string;
  currentCode?: string | null;
  onPick: (c: ApiCustomer) => void;
}): React.JSX.Element {
  const trimmed = query.trim();

  if (trimmed.length > 0) {
    const matches = searchCustomers(customers, trimmed);
    if (matches.length === 0) {
      return (
        <p className="px-4 py-10 text-center text-[13px] text-neutral-400">
          No dealer matches {trimmed}
        </p>
      );
    }
    // Matches only — no headings, by spec.
    return (
      <div>
        {matches.map((c) => (
          <CustomerRow
            key={c.code} name={c.name} code={c.code} area={c.area}
            current={currentCode === c.code} onPick={() => onPick(c)}
          />
        ))}
      </div>
    );
  }

  // Empty query: recents (if any) under a bare star, then everyone by name.
  const byName = [...customers].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div>
      {recents.length > 0 && (
        <>
          {/* The star IS the heading — no word, by spec. */}
          <div className="px-4 pt-3 pb-1.5">
            <StarGlyph />
          </div>
          {recents.map((r) => (
            <CustomerRow
              key={`recent-${r.code}`} name={r.name} code={r.code} area={r.area}
              current={currentCode === r.code}
              onPick={() => onPick({ name: r.name, code: r.code, area: r.area })}
            />
          ))}
          <div className="h-3" />
        </>
      )}
      {byName.map((c) => (
        <CustomerRow
          key={c.code} name={c.name} code={c.code} area={c.area}
          current={currentCode === c.code} onPick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

function StarGlyph(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={STAR} aria-label="Recent dealers">
      <path d="M12 2.5l2.9 5.88 6.49.95-4.7 4.58 1.11 6.46L12 17.33l-5.8 3.05 1.11-6.46-4.7-4.58 6.49-.95L12 2.5z" />
    </svg>
  );
}
