"use client";

// ── The detail header's symbol run — BOTH FACES ────────────────────────────
// (2026-08-22) Replaces the second header row that carried these same facts as
// frosted word-pills, then as 26px coloured circles. They are now bare glyphs
// riding at the end of the subtitle line, which is what lets the header collapse
// from two rows to one and hand the dealer name the whole of row 1.
//
// ⚠ WHY THIS IS ITS OWN FILE — same reasoning as bill-band.tsx. Both detail
// headers render it, and it encodes a colour per flag plus an exact geometry:
// the pair that drifts the day someone edits one copy.
//
// 🔴 EVERY GLYPH CARRIES BOTH aria-label AND title. There is no text on any of
// them any more — the words that used to sit in the pill are now ONLY in those
// two attributes, so dropping either makes the fact unreachable to a screen
// reader and unrecoverable by a long press. A symbol with no accessible name is
// a regression however clean it looks. If you restyle these, the labels go with
// them.
//
// ⚠ THE RUN NEVER TRUNCATES. It is `shrink-0`; the OBD/time text beside it is
// what gives way, and on row 1 the dealer name gives way before either. That
// ordering is deliberate: a name is recoverable by opening the bill, a flag you
// cannot see is not.

import { DUP_SO_MUTED, DuplicateSoTag } from "@/components/shared/duplicate-so-tag";
import { isSmuBadged } from "./card-atoms";

/** The five fields the run reads — narrow, not the whole PickingQueueRow. */
export interface BillSymbolSource {
  hasDuplicateSo: boolean;
  isKeyCustomer: boolean;
  priorityLevel: number | null;
  isTint: boolean;
  smuCode: string | null;
}

/** Does this bill put ANYTHING in the run? Exported so a caller can decide
 *  whether to render the separator before it. */
export function hasBillSymbols(row: BillSymbolSource): boolean {
  return (
    row.hasDuplicateSo ||
    row.isKeyCustomer ||
    row.priorityLevel === 1 ||
    row.isTint ||
    isSmuBadged(row.smuCode)
  );
}

// Pastels chosen to sit on the teal header without competing with the white
// dealer name above them.
const KEY_COLOR   = "#fcd34d"; // ★ key dealer
const URGENT_COLOR = "#fca5a5"; // ⚡ urgent
const TINT_COLOR  = "#e9d5ff"; // 🎨 tint
const SMU_COLOR   = "#c7d2fe"; // the bare SMU number

/**
 * ⚠ ON A DUPLICATE-SO BILL THE WHOLE RUN GOES #fecaca. The header is a solid
 * #dc2626 fill there, and #fca5a5 on #dc2626 is barely a shape — the same
 * problem components/shared/duplicate-so-tag.tsx documents for every other
 * badge ("each of those has to flip … or it vanishes into the fill"). Flipping
 * to the established muted-on-red token is that rule applied to bare glyphs.
 * The colour coding is what is spent; the GLYPH and its label still carry the
 * meaning, which is the half that matters.
 */
export function BillSymbols({ row }: { row: BillSymbolSource }): React.JSX.Element | null {
  if (!hasBillSymbols(row)) return null;
  const dup = row.hasDuplicateSo;
  const tone = (normal: string): string => (dup ? DUP_SO_MUTED : normal);
  return (
    <span className="shrink-0 flex items-center gap-[7px] leading-none">
      {/* LEADS THE RUN. It is the only item here that means "stop and check
          something" — the other four are standing facts about the bill — so it
          must not sit behind three decorations.
          ⚠ IT KEEPS ITS WORDS. "Same SO" cannot reduce to a glyph: there is no
          conventional symbol for "another live order shares this SO number",
          and colour cannot carry it on a header that is already red. It is
          UNPILLED here (bare text) only because the red header has already
          announced the state — do not copy this treatment onto a white card,
          where the pill is what makes it visible. Never renders the SO number
          (duplicate-so-tag.tsx's standing rule); the title is the instruction. */}
      {dup && (
        <span
          title="Another live order shares this SO number — open both and check"
          aria-label="Same SO — another live order shares this SO number"
          className="text-[11px] font-bold uppercase tracking-[0.03em] whitespace-nowrap"
          style={{ color: DUP_SO_MUTED }}
        >
          Same SO
        </span>
      )}
      {row.isKeyCustomer && (
        <span role="img" aria-label="Key dealer" title="Key dealer" style={{ color: tone(KEY_COLOR) }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" className="block">
            <path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z" />
          </svg>
        </span>
      )}
      {row.priorityLevel === 1 && (
        <span role="img" aria-label="Urgent" title="Urgent" style={{ color: tone(URGENT_COLOR) }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" className="block">
            <path d="M13 2L3 14h7l-1 8 10-12h-7z" />
          </svg>
        </span>
      )}
      {row.isTint && (
        <span
          role="img"
          aria-label="Tint"
          title="Tint"
          className="text-[14px] leading-none"
          style={{ color: tone(TINT_COLOR) }}
        >
          🎨
        </span>
      )}
      {/* ⚠ THE NUMBER, WITHOUT SmuBadge's PILL — and SmuBadge itself is NOT
          touched. It still renders its indigo/cyan pill on both CARD where-rows
          (picking-board-mobile.tsx + picker-my-picks-board.tsx), which is the
          only other place it appears in this module. Here the header is teal or
          red and a pale pill would read as one more chip in a row that no
          longer has any; the bare number in the run's own type is the same fact
          at the weight the rest of the run carries.
          ⚠ Gated by isSmuBadged — the SAME 74/77 rule, imported, never re-typed
          as literals. A code outside that set renders nothing, exactly as the
          badge would. */}
      {isSmuBadged(row.smuCode) && (
        <span
          aria-label={`SMU ${row.smuCode}`}
          title={`SMU ${row.smuCode}`}
          className="text-[12px] font-bold tabular-nums leading-none"
          style={{ color: tone(SMU_COLOR) }}
        >
          {row.smuCode}
        </span>
      )}
    </span>
  );
}

// Re-exported so a call site that needs the pilled tag (a CARD, not a header)
// still reaches it through the one owner rather than a second import path.
export { DuplicateSoTag };
