// components/floor/gift-badge.tsx
//
// The GIFT pill (owner, 2026-09-22) — marks a bill whose SAP material type is
// GIFTS (lib/orders/gift.ts). Its litres and kilos are placeholders, so every
// Floor total leaves it out; this pill is how a planner can SEE why a row's
// figures are not in the card or trip total above it.
//
// Same shape as ColourWorkBadge (components/picking/card-atoms.tsx — pattern
// only, that file is Picking's and is not edited) so it sits beside TINT/BASE
// as a sibling. NEUTRAL `ink`, on purpose: amber is urgency and the ★, pink is
// tint, red is error only, violet is the brand and the data.* colours are
// identities (CLAUDE_UI.md §1-§2). A gift is a fact about the bill, not a state.

export function GiftBadge() {
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-full border border-ink-200 bg-ink-50 px-2 py-[3px] text-[11px] font-bold tracking-[0.04em] text-ink-700"
      aria-label="Gift — not counted in L / kg"
      title="Gift — not counted in L / kg"
    >
      GIFT
    </span>
  );
}
