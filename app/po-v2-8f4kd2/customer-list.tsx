"use client";

import { ChevronRight, Check, Search, X } from "lucide-react";
import {
  DIVIDER, FAINT, FILL, INK, MUTED, VIOLET, VIOLET_BG,
  searchCustomers,
  type ApiCustomer,
} from "./v2-data";
import type { V2Dealer } from "./v2-storage";

// The dealer picker, shared by the dealer sheet on the board and the ship-to
// sheet on review, so the two can never drift apart. One component, two places.
//
// 🔴 CONTAINMENT — imports ./v2-data, ./v2-storage and node_modules only.

/**
 * The search field. A REAL <input>, so it takes focus and a keyboard.
 *
 * 🔴 16px IS LOAD-BEARING, NOT A STYLE CHOICE. iOS Safari zooms the whole page
 * when a focused input's font-size is below 16px, and it does not zoom back
 * out. `CLAUDE_UI.md §55` records the same trap on /po, where the qty input
 * was pushed to 16px for exactly this reason. Every <input> in v2 is 16px.
 * Do not "tidy" this down to match the 15px text around it.
 */
export function CustomerSearchInput({
  value, onChange, autoFocus = false,
}: {
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-[12px] px-3" style={{ background: FILL }}>
      <Search className="h-4 w-4 shrink-0" strokeWidth={2.5} style={{ color: FAINT }} />
      <input
        type="text"
        inputMode="search"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search dealer or code"
        className="min-w-0 flex-1 bg-transparent py-3 text-[16px] outline-none"
        style={{ color: INK, ["--tw-placeholder-opacity" as string]: 1 }}
      />
      {value.length > 0 && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{ background: FAINT }}
        >
          <X className="h-3 w-3 text-white" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

/**
 * One flat dealer row: the name, then code and area beneath, then a chevron.
 *
 * 🔴 NO INITIALS SQUARE. A monogram used to sit at the head of this row and it
 * has been removed everywhere — "AP" tells a salesman nothing his own dealer's
 * name does not tell him better, and thirty of them down a list is thirty
 * identical grey squares competing with the only thing that identifies a row.
 *
 * The row is a <div> holding buttons rather than a <button>, because a remove
 * control has to sit beside the pick target and a button inside a button is
 * invalid HTML that React will not render predictably.
 */
export function CustomerRow({
  name, code, area, current = false, onPick, onRemove,
}: {
  name: string; code: string; area: string | null;
  /** Marks the dealer already on the order: tinted, with a tick not a chevron. */
  current?: boolean;
  onPick: () => void;
  /** Only on the salesman's own list. Absent everywhere else. */
  onRemove?: () => void;
}): React.JSX.Element {
  return (
    <div
      className="flex items-center"
      style={{ borderBottom: `1px solid ${DIVIDER}`, background: current ? VIOLET_BG : undefined }}
    >
      <button
        type="button" onClick={onPick}
        className="flex min-w-0 flex-1 items-center py-2.5 pl-4 text-left"
      >
        {/* min-w-0 is what lets the two lines truncate — a flex child defaults
            to min-width:auto and would otherwise push the row past the viewport. */}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold" style={{ color: INK }}>{name}</span>
          <span className="block truncate font-mono text-[11.5px]" style={{ color: MUTED }}>
            {code}{area ? ` · ${area}` : ""}
          </span>
        </span>
      </button>

      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${name} from my dealers`}
          onClick={onRemove}
          className="flex shrink-0 items-center justify-center"
          style={{ width: 44, height: 44 }}
        >
          <X className="h-4 w-4" strokeWidth={2.5} style={{ color: FAINT }} />
        </button>
      )}

      <span className="flex shrink-0 items-center pr-4">
        {current
          ? <Check className="h-4 w-4" strokeWidth={3} style={{ color: VIOLET }} />
          : <ChevronRight className="h-4 w-4" strokeWidth={2.5} style={{ color: FAINT }} />}
      </span>
    </div>
  );
}

/** Small uppercase section label. */
function SectionLabel({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="px-4 pt-4 pb-1.5">
      <span className="text-[10px] font-extrabold uppercase" style={{ letterSpacing: "0.1em", color: FAINT }}>
        {text}
      </span>
    </div>
  );
}

/**
 * The list body.
 *
 * EMPTY QUERY: the salesman's OWN dealers, and nothing else.
 *
 * 🔴 THERE IS NO ALL-DEALERS LIST AND NO BROWSE BUTTON, DELIBERATELY. Seven
 * hundred alphabetical rows is not a list anyone reads; it is a wall you scroll
 * past on the way to the search box you were going to use anyway. A dealer who
 * is not on his list is reached by TYPING, which is faster than finding him in
 * an index and always was. Do not add a browse affordance back in.
 *
 * WITH A QUERY: his own list is filtered first and shown under "My dealers",
 * then every other dealer in the master falls through underneath. That
 * fall-through is what makes the missing browse list unnecessary — and it is
 * load-bearing for ship-to, which routinely names a third party the salesman
 * has never ordered FOR. Cross-billing depends on it.
 */
export function CustomerListBody({
  customers, mine, query, currentCode, onPick, onRemove,
}: {
  customers: ApiCustomer[];
  mine: V2Dealer[];
  query: string;
  currentCode?: string | null;
  onPick: (c: ApiCustomer) => void;
  /** Given only where removing from the list makes sense. */
  onRemove?: (code: string) => void;
}): React.JSX.Element {
  const trimmed = query.trim();
  const mineCodes = new Set(mine.map((m) => m.code));

  const row = (c: ApiCustomer, keyPrefix: string, removable: boolean): React.JSX.Element => (
    <CustomerRow
      key={`${keyPrefix}-${c.code}`}
      name={c.name} code={c.code} area={c.area}
      current={currentCode === c.code}
      onPick={() => onPick(c)}
      onRemove={removable && onRemove ? () => onRemove(c.code) : undefined}
    />
  );

  if (trimmed.length > 0) {
    const hits = searchCustomers(customers, trimmed);
    const mineHits = hits.filter((c) => mineCodes.has(c.code));
    const rest = hits.filter((c) => !mineCodes.has(c.code));
    if (hits.length === 0) {
      return (
        <p className="px-4 py-10 text-center text-[13px]" style={{ color: FAINT }}>
          No dealer matches {trimmed}
        </p>
      );
    }
    return (
      <div>
        {mineHits.length > 0 && (
          <>
            <SectionLabel text="My dealers" />
            {mineHits.map((c) => row(c, "mine-hit", false))}
          </>
        )}
        {rest.length > 0 && (
          <>
            {mineHits.length > 0 && <SectionLabel text="All dealers" />}
            {rest.map((c) => row(c, "hit", false))}
          </>
        )}
      </div>
    );
  }

  if (mine.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-[13px] leading-relaxed" style={{ color: FAINT }}>
        Type a dealer name or code.
        <br />
        Whoever you send an order to lands here.
      </p>
    );
  }

  return (
    <div>
      {mine.map((m) => row({ name: m.name, code: m.code, area: m.area }, "mine", true))}
    </div>
  );
}
