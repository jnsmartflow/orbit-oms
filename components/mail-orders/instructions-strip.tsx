"use client";

interface InstructionsStripProps {
  delivery: string | null;
  bill: string | null;
  notes: string | null;
}

const DOT_BY_KIND = {
  delivery: "bg-amber-600",
  bill: "bg-blue-700",
  notes: "bg-gray-600",
} as const;

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
}: InstructionsStripProps): JSX.Element | null {
  const rows: { kind: Kind; text: string }[] = [];

  const d = trimmed(delivery);
  const b = trimmed(bill);
  const n = trimmed(notes);

  if (d) rows.push({ kind: "delivery", text: d });
  if (b) rows.push({ kind: "bill", text: b });
  if (n) rows.push({ kind: "notes", text: n });

  if (rows.length === 0) return null;

  return (
    <div className="bg-gray-200 border-t border-gray-100 pt-3 pb-3">
      {rows.map((row) => (
        <div
          key={row.kind}
          className="flex items-start gap-2 px-5 py-1 text-[11.5px] leading-[1.45] text-gray-700"
        >
          <span
            className={`w-[7px] h-[7px] rounded-full flex-shrink-0 mt-1.5 ${DOT_BY_KIND[row.kind]}`}
          />
          <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-500 w-16 flex-shrink-0 pt-0.5">
            {row.kind}
          </span>
          <span className="flex-1 text-gray-700 pt-px">{row.text}</span>
        </div>
      ))}
    </div>
  );
}
