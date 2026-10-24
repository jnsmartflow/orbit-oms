// components/shared/sample-badge.tsx
//
// The SAMPLE pill (2026-10-24, Schema v27.77) — the bill is a sample. The mark
// is orders.sampleAt (set = not null); it is set and cleared by the sample /
// unsample bill actions (lib/floor/bill-actions.ts) from Floor and the Tint
// Manager, and it rides the bill through the tint room and back to picking.
//
// `sample` is its OWN token (tailwind.config.ts + the --sample variable in
// app/globals.css, CLAUDE_UI.md §2.1): no data.* colour was free. A tint of it
// for the ground and border, the token itself for the text — HandBadge's
// shape exactly (components/shared/hand-badge.tsx), so the two sit side by side
// as siblings of ColourWorkBadge.
//
// Shared by Floor (table, Hold, Cancel & CI, detail header), Picking (the card,
// the detail header, the picker's face) and the Tint Manager + Operator screens.

// `onBrand`: the pill sits on a SOLID brand fill (the Tint Operator's current-
// job chip, bg-brand-600), where the pale ground would vanish — a white ground,
// the token as text (7.6:1).
export function SampleBadge({ label = "SAMPLE", onBrand = false }: { label?: string; onBrand?: boolean }) {
  return (
    <span
      className={
        "shrink-0 whitespace-nowrap rounded-full border px-2 py-[3px] text-[11px] font-bold tracking-[0.04em] text-sample " +
        (onBrand ? "border-white bg-white" : "border-sample/30 bg-sample/10")
      }
      aria-label="Sample bill"
      title="Sample — this bill is a sample."
    >
      {label}
    </span>
  );
}
