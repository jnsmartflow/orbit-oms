"use client";

// The CI list card — mockup `.rcard`, shared by BOTH supervisor tabs.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 SHARED, NOT COPIED — AND THAT IS NOT A CONTRADICTION OF THE MODULE RULE.
// ═══════════════════════════════════════════════════════════════════════════
//
// components/ci/line-list.tsx records the convention "COPIED, NOT IMPORTED",
// and that rule is about crossing MODULE lines: picking does not export its
// row, MRN's is module-private and typed on MrnDetailLine, so CI carries its
// own copy of each. Tokens travel between modules; components do not.
//
// This is the other case. The New tab's search result (frame 2) and the
// Submitted tab's return (frame 9) are ONE drawn object inside ONE module —
// same `.rcard` chrome, same three rows, same `.rMeta` shape down to the
// `<b>212</b> L` — differing only in what fills them. components/ci/sheet.tsx
// set the precedent when the two CI sheets were pulled onto one shell.
//
// They had already drifted: this card was rebuilt to the drawn 22px/750 name on
// the New tab in step 7c while the Submitted tab stayed at 13.5px, and the two
// tabs of one screen visibly disagreed. Sharing the component is what stops
// that recurring, since the next change cannot land on one tab only.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE DEALER NAME IS THE SUBJECT OF THIS CARD.
// ═══════════════════════════════════════════════════════════════════════════
//
// 22px/750 on its own line, with the identifier demoted to a grey header row.
// Both faces originally led with the number at 15px bold and put the name third
// at 13.5px, which is a LIST ROW — fine on a desk, wrong in a warehouse. The
// name is the only thing that confirms the right bill: the two OBDs of a split
// invoice differ in their LAST DIGIT, so a number-led card is exactly the
// hardest way to tell them apart at arm's length.

/** The mockup's `--card-sh`, verbatim (supervisor.html:26). Exported because
 *  the search FIELD casts the same shadow — it is the same physical object. */
export const CI_CARD_SHADOW =
  "0 1px 2px rgba(16,25,29,.05), 0 6px 16px rgba(16,25,29,.05)";

/** `.chip`, `.chip.amber`, `.chip.green` — the mockup's three tones. */
export type CiChipTone = "neutral" | "amber" | "green";

const CHIP_TONE: Record<CiChipTone, string> = {
  neutral: "bg-[#EDF1F2] text-[#5C666E]",
  amber: "bg-[#FDF4E3] text-[#A8620A]",
  green: "bg-[#E7F6EE] text-[#0A7C4A]",
};

export function CiResultCard({
  identifier,
  chipLabel,
  chipTone = "neutral",
  name,
  leading,
  litres,
  onClick,
}: {
  /** OBD number on the New tab, CI number on the Submitted tab. */
  identifier: string;
  /** "12 lines" · "With billing" · "Done". */
  chipLabel: string;
  chipTone?: CiChipTone;
  /** The dealer. The reason this card is a card. */
  name: string;
  /** The left half of `.rMeta`: a date on the New tab, "Full bill" or
   *  "Part · 3 lines" on the Submitted tab. */
  leading: string;
  /** The right half. Rendered here rather than passed in as text so the two
   *  tabs cannot drift on how a volume looks — `<b>212</b> L` is one decision,
   *  made once. */
  litres: number;
  /** Omitted ⇒ renders a <div>. ⚠ A pressable card that does nothing is worse
   *  than a flat one: it invites the tap and then ignores it. The Submitted tab
   *  is READ-ONLY and passes nothing; making its cards open a CI is a product
   *  decision (step 7e), not a styling one. */
  onClick?: () => void;
}): React.JSX.Element {
  const body = (
    <>
      {/* `.rTop` */}
      <div className="flex items-center justify-between gap-2.5">
        {/* `.rObd`. Mono is this app's convention for a scannable identifier
            (JetBrains Mono is loaded for exactly this); the mockup's own
            stylesheet leaves it in the body face. Digits over drawing. */}
        <span className="font-mono text-[14.5px] font-medium text-[#8A9299] truncate">
          {identifier}
        </span>
        {/* The status/count WORD, never a colour-only signal — the mockup
            writes "With billing" and "Done", and they say the same thing to a
            reader who cannot tell the two tints apart. */}
        <span
          className={
            "shrink-0 whitespace-nowrap rounded-full px-3 py-[5px] text-[12.5px] font-[650] " +
            CHIP_TONE[chipTone]
          }
        >
          {chipLabel}
        </span>
      </div>

      {/* `.rName` — 22px/750, tracking -.02em, its own line. */}
      <div className="text-[22px] font-[750] tracking-[-0.02em] leading-[1.15] text-[#16191D] mt-[7px] break-words">
        {name}
      </div>

      {/* `.rMeta` */}
      <div className="flex items-center gap-2.5 mt-[9px] text-[15px] text-[#5C666E]">
        <span>{leading}</span>
        <span className="text-[#B7BFC5]">·</span>
        <span>
          <b className="font-[750] text-[#16191D] tabular-nums">{litres}</b>{" "}
          <span className="text-[#8A9299] font-[650]">L</span>
        </span>
      </div>
    </>
  );

  const chrome = "w-full text-left bg-white rounded-[18px] px-[18px] py-[15px] mb-3";

  if (onClick === undefined) {
    return (
      <div className={chrome} style={{ boxShadow: CI_CARD_SHADOW }}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${chrome} active:opacity-90`}
      style={{ boxShadow: CI_CARD_SHADOW }}
    >
      {body}
    </button>
  );
}
