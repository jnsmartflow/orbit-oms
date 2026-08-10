// ── Pack-size ordering for the picking detail screen's filter chips ─────────
// ONE implementation, both picking faces. picking-board-mobile.tsx (supervisor)
// and picker-my-picks-board.tsx (picker) build the same chip row from the same
// payload, and they have drifted from each other before — this module exists so
// the two can never disagree about what order sizes go in. Same seam
// card-atoms.tsx, use-bill-pager.ts and finding-recorder.tsx already occupy.
//
// ⚠ THIS TAKES THE RENDERED PACK LABEL, not packCode + unit. The picking wire
// format carries `pack` as an ALREADY-FORMATTED string: formatPack(packCode,
// unit) runs server-side in lib/picking/resolve-lines.ts, so by the time either
// board sees a line, "500" + "ML" has become "500ML" and the raw pair is gone.
// Parsing the label back is therefore the only option that does not mean
// widening the API payload for a cosmetic sort. The label vocabulary is closed —
// formatPack has exactly five output shapes and they are all handled below.
//
// WHAT THIS REPLACED (2026-08-10): both boards sorted the chips with
// `a.localeCompare(b)`, which is alphabetical on the label text. On a bill
// carrying 100ML / 1L / 20L / 4L / 500ML that produced exactly that order —
// "100ML" before "1L" because "0" < "L", and "20L" before "4L" because "2" <
// "4". A picker reading the strip has no way to find the size he wants except
// by scanning every chip. Sorting on the numeric packCode alone would not fix
// it either: it would put 1 (as in 1L) before 500 (as in 500ML).

/**
 * A pack's position in the ordering, as (tier, size).
 *
 * `tier` groups incomparable kinds so a weight is never ranked against a
 * volume; `size` orders within a tier in that tier's own base unit. Compare
 * tier first, then size — comparePackLabels() below is the one place that
 * does it, and callers should go through it rather than reading these fields.
 */
export interface PackSortKey {
  /** 0 volume · 1 weight · 2 pieces · 3 unrecognised (always last). */
  tier: number;
  /** Millilitres in tier 0, grams in tier 1, pieces in tier 2, 0 in tier 3. */
  size: number;
}

export const PACK_TIER_VOLUME = 0;
export const PACK_TIER_WEIGHT = 1;
export const PACK_TIER_PIECES = 2;
export const PACK_TIER_UNKNOWN = 3;

/**
 * Parse a rendered pack label into a comparable (tier, size).
 *
 * Handles every shape formatPack() emits:
 *   "50ML" "100ML" "500ML"  → volume, millilitres
 *   "400 ml"                → volume (the spray-can special case — note the
 *                             lower case and the SPACE; both are stripped)
 *   "1L" "4L" "20L"         → volume, ×1000 into millilitres
 *   "5KG" "40KG" / "400GM"  → weight, grams. Kept in their OWN tier rather than
 *                             folded into the volume scale: 5KG is not 5L, and
 *                             a putty bag ranked between two paint tins would
 *                             be a confident lie. Mirrors the KG-anchored-last
 *                             rule lib/place-order/pack.ts sortPacks() already
 *                             follows for the ordering /po shows.
 *   "1 pc"                  → pieces (tools). No magnitude worth comparing.
 *
 * ⚠ NEVER THROWS. An unrecognised label — the "__no_pack__" sentinel, a raw
 * unmastered SAP string that formatPack passed through untouched, a future unit
 * nobody has added here yet — lands in PACK_TIER_UNKNOWN and sorts to the end.
 * A chip that cannot be placed must still be reachable; dropping it would hide
 * lines from the picker, and guessing a size for it would file it under the
 * wrong one.
 */
export function packLabelSortKey(label: string | null | undefined): PackSortKey {
  if (!label) return { tier: PACK_TIER_UNKNOWN, size: 0 };

  // Upper-case and strip whitespace so "400 ml" and "1 pc" normalise onto the
  // same path as "400ML" / "1PC".
  const norm = label.toUpperCase().replace(/\s+/g, "");
  const m = /^([0-9]*\.?[0-9]+)([A-Z]*)$/.exec(norm);
  if (!m) return { tier: PACK_TIER_UNKNOWN, size: 0 };

  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return { tier: PACK_TIER_UNKNOWN, size: 0 };
  const unit = m[2];

  switch (unit) {
    case "ML":
      return { tier: PACK_TIER_VOLUME, size: num };
    case "L":
    case "LT":
    case "LTR":
      return { tier: PACK_TIER_VOLUME, size: num * 1000 };
    case "GM":
      return { tier: PACK_TIER_WEIGHT, size: num };
    case "KG":
      return { tier: PACK_TIER_WEIGHT, size: num * 1000 };
    case "PC":
      return { tier: PACK_TIER_PIECES, size: num };
    default:
      // A bare number with no unit at all. formatPack only emits this when
      // parseFloat(packCode) was NaN — i.e. it returned the raw code — so the
      // digits here are not a size anyone has vouched for. Unknown, not a
      // guessed volume.
      return { tier: PACK_TIER_UNKNOWN, size: 0 };
  }
}

/**
 * Order two pack labels smallest-first. Unrecognised labels sort last, and tie
 * on the label text so the order stays stable rather than depending on which
 * line of the bill happened to come first.
 */
export function comparePackLabels(a: string | null | undefined, b: string | null | undefined): number {
  const ka = packLabelSortKey(a);
  const kb = packLabelSortKey(b);
  if (ka.tier !== kb.tier) return ka.tier - kb.tier;
  if (ka.size !== kb.size) return ka.size - kb.size;
  return (a ?? "").localeCompare(b ?? "");
}

/** Non-mutating smallest-first sort of a pack-label list. */
export function sortPackLabels(labels: readonly string[]): string[] {
  return [...labels].sort(comparePackLabels);
}
