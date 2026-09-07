"use client";

import { ChevronRight, Check, Search, X } from "lucide-react";
import {
  DIVIDER, FAINT, FILL, INK, MUTED, STAR, VIOLET, VIOLET_BG,
  searchCustomers,
  type ApiCustomer,
} from "./v2-data";
import type { V2Star } from "./v2-storage";

// The dealer picker, shared by the dealer sheet on review and the ship-to sheet
// beside it, so the two can never drift apart. One component, two places.
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
        className="min-w-0 flex-1 bg-transparent py-3 text-[16px] outline-none placeholder:text-[#9C99AC]"
        style={{ color: INK }}
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
 * The star. Filled amber when starred, a grey outline when not.
 *
 * Drawn rather than imported so the filled and hollow states are the same
 * shape — a stroked icon and a filled icon from a set are usually two slightly
 * different silhouettes, and the wobble shows when one sits above the other in
 * a list.
 */
function StarGlyph({ filled }: { filled: boolean }): React.JSX.Element {
  return (
    <svg width={19} height={19} viewBox="0 0 24 24" aria-hidden
         fill={filled ? STAR : "none"}
         stroke={filled ? STAR : "#C9C6D6"}
         strokeWidth={filled ? 0 : 1.9} strokeLinejoin="round">
      <path d="M12 2.6l2.9 5.87 6.48.95-4.69 4.57 1.11 6.46L12 17.4l-5.8 3.05 1.11-6.46-4.69-4.57 6.48-.95L12 2.6z" />
    </svg>
  );
}

/**
 * One flat dealer row: the name, then code and area beneath, then the star,
 * then a chevron.
 *
 * 🔴 NO INITIALS SQUARE. A monogram used to sit at the head of this row and it
 * has been removed everywhere — "AP" tells a salesman nothing his own dealer's
 * name does not tell him better, and thirty of them down a list is thirty
 * identical grey squares competing with the only thing that identifies a row.
 *
 * The row is a <div> holding buttons rather than a <button>, because the star
 * has to sit beside the pick target and a button inside a button is invalid
 * HTML that React will not render predictably. The star gets its own 44px
 * target: a thumb does not reliably hit a 19px glyph, and a miss here would
 * open the dealer instead of starring him.
 */
export function CustomerRow({
  name, code, area, current = false, starred, onPick, onToggleStar,
}: {
  name: string; code: string; area: string | null;
  /** Marks the dealer already on the order: tinted, with a tick not a chevron. */
  current?: boolean;
  starred: boolean;
  onPick: () => void;
  onToggleStar: () => void;
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

      {/* Its own button, so a tap CANNOT fall through and open the dealer. A
          separate element rather than a stopPropagation() hack: starring and
          choosing are genuinely different actions and the DOM should say so. */}
      <button
        type="button"
        aria-label={starred ? `Unstar ${name}` : `Star ${name}`}
        aria-pressed={starred}
        onClick={onToggleStar}
        className="flex shrink-0 items-center justify-center"
        style={{ width: 44, height: 44 }}
      >
        <StarGlyph filled={starred} />
      </button>

      <span className="flex shrink-0 items-center pr-4">
        {current
          ? <Check className="h-4 w-4" strokeWidth={3} style={{ color: VIOLET }} />
          : <ChevronRight className="h-4 w-4" strokeWidth={2.5} style={{ color: FAINT }} />}
      </span>
    </div>
  );
}

/**
 * The list body. A search box above it, starred first, results below — and no
 * other sections.
 *
 * EMPTY QUERY: his STARRED dealers, in the order he starred them. Nothing else.
 *
 * 🔴 THERE IS NO ALL-DEALERS LIST AND NO BROWSE BUTTON, DELIBERATELY. Seven
 * hundred alphabetical rows is not a list anyone reads; it is a wall you scroll
 * past on the way to the search box you were going to use anyway. A dealer who
 * is not starred is reached by TYPING, which is faster than finding him in an
 * index and always was. Do not add a browse affordance back in.
 *
 * WITH A QUERY: matches from the FULL master, flat, every row carrying its own
 * star so he can star somebody the moment he finds them. That fall-through is
 * what makes the missing browse list unnecessary — and it is load-bearing for
 * ship-to, which routinely names a third party the salesman has never ordered
 * FOR. Cross-billing depends on it.
 */
export function CustomerListBody({
  customers, starred, query, currentCode, onPick, onToggleStar,
}: {
  customers: ApiCustomer[];
  starred: V2Star[];
  query: string;
  currentCode?: string | null;
  onPick: (c: ApiCustomer) => void;
  onToggleStar: (c: ApiCustomer) => void;
}): React.JSX.Element {
  const trimmed = query.trim();
  const starCodes = new Set(starred.map((s) => s.code));

  const row = (c: ApiCustomer, keyPrefix: string): React.JSX.Element => (
    <CustomerRow
      key={`${keyPrefix}-${c.code}`}
      name={c.name} code={c.code} area={c.area}
      current={currentCode === c.code}
      starred={starCodes.has(c.code)}
      onPick={() => onPick(c)}
      onToggleStar={() => onToggleStar(c)}
    />
  );

  if (trimmed.length > 0) {
    const hits = searchCustomers(customers, trimmed);
    if (hits.length === 0) {
      return (
        <p className="px-4 py-10 text-center text-[13px]" style={{ color: FAINT }}>
          No dealer matches {trimmed}
        </p>
      );
    }
    return <div>{hits.map((c) => row(c, "hit"))}</div>;
  }

  if (starred.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-[13px] leading-relaxed" style={{ color: FAINT }}>
        Type a dealer name or code.
        <br />
        Tap the star to keep one here.
      </p>
    );
  }

  return (
    <div>
      {starred.map((s) => row({ name: s.name, code: s.code, area: s.area }, "star"))}
    </div>
  );
}
