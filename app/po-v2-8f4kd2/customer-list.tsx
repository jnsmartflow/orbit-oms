"use client";

import { ChevronRight, Check, Search, X } from "lucide-react";
import {
  CHEVRON, DIVIDER, INK, MONO_BG, SEARCH_BG, STAR, VIOLET, VIOLET_BG,
  monogram, searchCustomers,
  type ApiCustomer, type V2Recent,
} from "./v2-data";

// The dealer picker, shared by the landing screen, the change-customer sheet
// and the ship-to sheet so all three can never drift apart. One component,
// three places.
//
// 🔴 CONTAINMENT — imports ./v2-data and node_modules only.

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
        className="min-w-0 flex-1 bg-transparent py-3 text-[16px] outline-none placeholder:text-neutral-400"
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

/** A star, outline or filled. 18px glyph; the tap target around it is 44px. */
function StarGlyph({ filled, size = 18 }: { filled: boolean; size?: number }): React.JSX.Element {
  const d = "M12 2.5l2.9 5.88 6.49.95-4.7 4.58 1.11 6.46L12 17.33l-5.8 3.05 1.11-6.46-4.7-4.58 6.49-.95L12 2.5z";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden
         fill={filled ? STAR : "none"} stroke={filled ? STAR : "#C7C3CE"} strokeWidth={filled ? 0 : 1.8}
         strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/**
 * One flat dealer row. No card — a list divider is the only separator.
 *
 * 🔴 THE ROW IS A <div>, NOT A <button>. It has to hold a second, independent
 * button for the star, and a <button> inside a <button> is invalid HTML that
 * React will not render predictably. The pick target is the inner button that
 * fills the row; the star sits beside it with its own 44px target, because a
 * thumb does not reliably hit an 18px glyph.
 */
export function CustomerRow({
  name, code, area, current = false, isFav, onPick, onToggleFav,
}: {
  name: string; code: string; area: string | null;
  /** Marks the dealer already on the order: tinted, with a tick not a chevron. */
  current?: boolean;
  isFav: boolean;
  onPick: () => void;
  onToggleFav: () => void;
}): React.JSX.Element {
  return (
    <div
      className="flex items-center"
      style={{ borderBottom: `1px solid ${DIVIDER}`, background: current ? VIOLET_BG : undefined }}
    >
      <button
        type="button" onClick={onPick}
        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left"
      >
        <span
          className="flex shrink-0 items-center justify-center rounded-[10px] text-[12px] font-extrabold text-neutral-600"
          style={{ width: 34, height: 34, background: current ? "#fff" : MONO_BG }}
        >
          {monogram(name)}
        </span>
        {/* min-w-0 is what lets the two lines truncate — a flex child defaults
            to min-width:auto and would otherwise push the row past the viewport. */}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-bold" style={{ color: INK }}>{name}</span>
          <span className="block truncate font-mono text-[11px] text-neutral-400">
            {code}{area ? ` · ${area}` : ""}
          </span>
        </span>
      </button>

      {/* Its own button, so the tap CANNOT fall through and open the dealer.
          A separate element rather than a stopPropagation() hack: the two are
          genuinely different actions and the DOM should say so. */}
      <button
        type="button"
        aria-label={isFav ? `Remove ${name} from favourites` : `Add ${name} to favourites`}
        aria-pressed={isFav}
        onClick={onToggleFav}
        className="flex shrink-0 items-center justify-center"
        style={{ width: 44, height: 44 }}
      >
        <StarGlyph filled={isFav} />
      </button>

      <span className="flex shrink-0 items-center pr-4">
        {current
          ? <Check className="h-4 w-4" strokeWidth={3} style={{ color: VIOLET }} />
          : <ChevronRight className="h-4 w-4" strokeWidth={2.5} style={{ color: CHEVRON }} />}
      </span>
    </div>
  );
}

/** Small grey uppercase section label. The favourites heading is the star alone. */
function SectionLabel({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="px-4 pt-4 pb-1.5">
      <span className="text-[10px] font-extrabold uppercase text-neutral-400"
            style={{ letterSpacing: "0.1em" }}>
        {text}
      </span>
    </div>
  );
}

/**
 * The list body.
 *
 * Empty query: FAVOURITES (star heading alone) → RECENT → ALL DEALERS. A
 * favourite is not repeated under Recent — it is already one tap away at the
 * top, and a duplicate row two sections down just costs scroll. It DOES stay
 * under All Dealers, which is the complete list and would be lying otherwise.
 *
 * With a query: matches only, no headings. Stars stay tappable throughout.
 *
 * The full alphabetical list renders unvirtualised. That is a deliberate
 * choice for ~698 plain rows — no images, no per-row effects — and it is the
 * reason nothing heavier was put in a row. If it stutters on a real phone,
 * paging is the fix, not a card redesign.
 */
export function CustomerListBody({
  customers, recents, favs, query, currentCode, onPick, onToggleFav,
}: {
  customers: ApiCustomer[];
  recents: V2Recent[];
  favs: { name: string; code: string; area: string | null }[];
  query: string;
  currentCode?: string | null;
  onPick: (c: ApiCustomer) => void;
  onToggleFav: (c: ApiCustomer) => void;
}): React.JSX.Element {
  const trimmed = query.trim();
  const favCodes = new Set(favs.map((f) => f.code));

  const row = (c: ApiCustomer, keyPrefix: string): React.JSX.Element => (
    <CustomerRow
      key={`${keyPrefix}-${c.code}`}
      name={c.name} code={c.code} area={c.area}
      current={currentCode === c.code}
      isFav={favCodes.has(c.code)}
      onPick={() => onPick(c)}
      onToggleFav={() => onToggleFav(c)}
    />
  );

  if (trimmed.length > 0) {
    const matches = searchCustomers(customers, trimmed);
    if (matches.length === 0) {
      return (
        <p className="px-4 py-10 text-center text-[13px] text-neutral-400">
          No dealer matches {trimmed}
        </p>
      );
    }
    return <div>{matches.map((c) => row(c, "hit"))}</div>;
  }

  // A favourite is pinned to the top, so it does not need a Recent row too.
  const recentRows = recents.filter((r) => !favCodes.has(r.code));
  const byName = [...customers].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      {favs.length > 0 && (
        <>
          {/* The star IS the heading — no word, by spec. */}
          <div className="px-4 pt-3 pb-1.5">
            <StarGlyph filled size={18} />
          </div>
          {favs.map((f) => row({ name: f.name, code: f.code, area: f.area }, "fav"))}
        </>
      )}

      {recentRows.length > 0 && (
        <>
          <SectionLabel text="Recent" />
          {recentRows.map((r) => row({ name: r.name, code: r.code, area: r.area }, "recent"))}
        </>
      )}

      <SectionLabel text="All dealers" />
      {byName.map((c) => row(c, "all"))}
    </div>
  );
}
