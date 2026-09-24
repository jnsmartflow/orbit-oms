// components/shared/hand-badge.tsx
//
// The ✋ HAND pill (2026-09-24, design web-update-2026-09-24-billing-mo-actions.md
// §4) — the dealer collects this bill from the depot, so it rides no truck: it is
// planned on a Hand trip and left out of every truck total.
//
// `data.brown` is Hand's IDENTITY colour (CLAUDE_UI.md §2.1, owner 2026-09-24):
// a tint of it for the ground and border, the token itself for the text. Same
// size and shape as ColourWorkBadge (TINT / BASE, components/picking/card-atoms.tsx)
// so it sits beside it as a sibling.
//
// Shared by Floor (table, Hold, Cancel & CI, detail header, trip rail) and
// Picking (the card and the detail header) — one pill, one look.

export function HandBadge({ label = "✋ HAND" }: { label?: string }) {
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-full border border-data-brown/30 bg-data-brown/10 px-2 py-[3px] text-[11px] font-bold tracking-[0.04em] text-data-brown"
      aria-label="Hand — the dealer collects"
      title="Hand — the dealer collects from the depot. Plan it on a Hand trip."
    >
      {label}
    </span>
  );
}
