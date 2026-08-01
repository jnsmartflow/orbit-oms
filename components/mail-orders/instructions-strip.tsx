"use client";

interface InstructionsStripProps {
  delivery: string | null;
  bill: string | null;
  notes: string | null;
  /**
   * Colour treatment for the band. Default `"default"` — the grey strip this
   * has always been, unchanged for every caller that does not pass it.
   *
   * `"violet"` swaps the grey for Floor's light-purple instruction treatment.
   * ⚠ The values below are COPIED from components/floor/tint-strip.tsx (:30 for
   * the bg/text pair, :43 for the dot) — the same shade Floor uses on its
   * "Assigned to tint operator" strip. Do not substitute a Tailwind `purple-*`
   * here: one owner for the shade, so the two screens cannot drift apart.
   */
  tone?: "default" | "violet";
}

// Per-kind dots. delivery/bill are SEMANTIC (amber = delivery instruction, blue
// = billing) and stay themselves in both tones — recolouring them would erase
// the distinction the dots exist to make. Only `notes`, the neutral grey one,
// follows the band.
const DOT_BY_KIND = {
  delivery: "bg-amber-600",
  bill: "bg-blue-700",
  notes: "bg-gray-600",
} as const;

const VIOLET_NOTES_DOT = "bg-[#7c3aed]";

type Kind = keyof typeof DOT_BY_KIND;

function trimmed(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

export function InstructionsStrip({
  delivery,
  bill,
  notes,
  tone = "default",
}: InstructionsStripProps): JSX.Element | null {
  const violet = tone === "violet";
  const rows: { kind: Kind; text: string }[] = [];

  const d = trimmed(delivery);
  const b = trimmed(bill);
  const n = trimmed(notes);

  if (d) rows.push({ kind: "delivery", text: d });
  if (b) rows.push({ kind: "bill", text: b });
  if (n) rows.push({ kind: "notes", text: n });

  if (rows.length === 0) return null;

  // The whole class string branches rather than appending to a shared base: the
  // violet arm needs SIDE-SPECIFIC border colours (border-t-gray-100 +
  // border-l-[#7c3aed]) because a bare `border-gray-100` would set all four
  // sides and the left accent would inherit grey. Splitting them keeps the
  // default arm's `border-t border-gray-100` byte-identical.
  // #7c3aed is the notes dot's violet (VIOLET_NOTES_DOT above) — same shade, not
  // a second one.
  return (
    <div
      className={
        violet
          ? "bg-[#f5f3ff] border-t border-t-gray-100 border-l-[3px] border-l-[#7c3aed] pt-3 pb-3"
          : "bg-gray-200 border-t border-gray-100 pt-3 pb-3"
      }
    >
      {rows.map((row) => (
        <div
          key={row.kind}
          className={`flex items-start gap-2 px-5 py-1 text-[11.5px] leading-[1.45] ${violet ? "text-[#5b21b6]" : "text-gray-700"}`}
        >
          <span
            className={`w-[7px] h-[7px] rounded-full flex-shrink-0 mt-1.5 ${
              violet && row.kind === "notes" ? VIOLET_NOTES_DOT : DOT_BY_KIND[row.kind]
            }`}
          />
          <span
            className={`text-[10px] font-semibold uppercase tracking-[0.05em] w-16 flex-shrink-0 pt-0.5 ${
              violet ? "text-[#7c3aed]" : "text-gray-500"
            }`}
          >
            {row.kind}
          </span>
          <span className={`flex-1 pt-px ${violet ? "text-[#5b21b6]" : "text-gray-700"}`}>{row.text}</span>
        </div>
      ))}
    </div>
  );
}
