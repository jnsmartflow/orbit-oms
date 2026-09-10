"use client";

import { ChevronRight, Check } from "lucide-react";
import {
  DIVIDER, FAINT, INK, MUTED, STAR, VIOLET, VIOLET_BG,
  searchCustomers,
  type ApiCustomer,
} from "./v2-data";
import type { V2Star } from "./v2-storage";
import V2SearchInput from "./v2-search-input";

// The dealer list, shared by the two picker SCREENS — choose-a-dealer and
// ship-to — so the two can never drift apart. One component, two places.
//
// 🔴 CONTAINMENT — imports ./v2-data, ./v2-storage, ./v2-search-input and
// node_modules only. (v2-search-input arrived when this file's own search
// markup was retired in favour of the board's — see CustomerSearchInput.)

/**
 * The dealer search field, shared by both pickers.
 *
 * 🔴 IT USED TO BE ITS OWN MARKUP AND IT DID NOT MATCH THE BOARD'S. A grey
 * FILL block, a 12px radius, a 16px icon at stroke 2.5, no focus state — beside
 * the board's white 52px field with a 14px radius, an 18px icon at 1.8 and a
 * violet focus ring. One control, two appearances, depending on which screen a
 * salesman happened to be standing on, and only one of them showed focus.
 *
 * The board's won and lives in ./v2-search-input now. What is left here is the
 * placeholder, which is the only part that was ever specific to dealers.
 */
export function CustomerSearchInput({
  value, onChange, autoFocus = false,
}: {
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
}): React.JSX.Element {
  return (
    <V2SearchInput
      value={value} onChange={onChange} autoFocus={autoFocus}
      placeholder="Search dealer or code"
    />
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
        {/* 🔴 THE NAME IS 14px AND NOT BOLD, which is v1's hierarchy and reads
            calmer down a long list — §60's refinement principle is that exactly
            ONE line in a card carries weight, and in a LIST of names none of
            them can be the hero. Bold at 15px made thirty rows shout at once.
            INK rather than a grey scale: v2 has no gray-900 and is not
            importing one for a single row.

            ⚠ NO LEADING VIOLET DOT. v1 has one; it is decoration in a list
            where every row would carry it, so it identifies nothing.

            The sub-line is ONE mono run at 12px. v1 switches to font-sans
            mid-string for the area, which makes the middot and the area sit on
            a different baseline rhythm from the code beside them. */}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px]" style={{ color: INK }}>{name}</span>
          <span className="block truncate font-mono text-[12px]" style={{ color: MUTED }}>
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
 * EMPTY QUERY: his STARRED dealers, A to Z. Nothing else.
 *
 * 🔴 ALPHABETICAL, NOT NEWEST-FIRST. Recency is the order they were STARRED in,
 * which is a fact about a day months ago and tells him nothing about where to
 * look now. A list he reads every day should be in the order he can predict.
 * Search results keep their relevance order — that ordering is an answer to
 * what he typed, and sorting it would throw the answer away.
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
  // null when nothing is starred and nothing typed — see the note below.
}): React.JSX.Element | null {
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

  // 🔴 NOTHING STARRED YET RENDERS NOTHING. No illustration, no instruction
  // line, no placeholder block — the search box is directly above and is the
  // only thing to do, so a paragraph explaining that would be telling a
  // salesman what he can already see. White space is the honest answer.
  if (starred.length === 0) return null;

  return (
    <div>
      {[...starred]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => row({ name: s.name, code: s.code, area: s.area }, "star"))}
    </div>
  );
}
