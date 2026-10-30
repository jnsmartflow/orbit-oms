// Floor Control — detail panel Items tab (design §10.4, mockup 02-detail-panel
// `itemsHTML`). Index · product name · SKU · pack chip · quantity · litres.
// A violet dot marks a tint line. Litre total at the foot — the ONE place a
// total appears (design §10.1 cut the kg/litre header strip). The gift rule
// lives in lib/orders/gift.ts (a whole bill, materialType GIFTS); sticker lines
// in lib/orders/sticker.ts (left out of the litre total).

import { formatLitres, formatWeightKg } from "./status-pill";
import type { FloorDetailLine } from "@/lib/floor/types";

export function DetailItems({
  lines,
  totalLitres,
  kg,
}: {
  lines: FloorDetailLine[];
  totalLitres: number;
  /** ONE INVOICE's footer kg (Add invoices Phase 4 — the panel scoped to an
   *  invoice): "~" when shared from the OBD's kg by litres. Omitted on the OBD
   *  view, whose footer is unchanged. */
  kg?: { kg: number | null; exact: boolean };
}) {
  const kgStr = kg ? formatWeightKg(kg.kg) : null;
  if (lines.length === 0) {
    return <div className="px-5 py-10 text-center text-[11.5px] text-gray-400">No line items on this bill.</div>;
  }
  return (
    <div>
      {lines.map((l, i) => (
        <div key={l.id} className="flex items-start gap-[11px] border-b border-[#f5f5f5] px-5 py-[9px] hover:bg-[#fcfcfd]">
          <span className="w-[14px] pt-[3px] text-[10px] tabular-nums text-[#d1d5db]">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium leading-[1.4] text-[#111827]">
              {l.name ?? <span className="italic text-[#9ca3af]">{l.sku}</span>}
              {l.isTint && <span className="ml-1.5 inline-block h-[7px] w-[7px] rounded-full bg-tint-600 align-[1px]" />}
            </div>
            <div className="mt-[3px] font-mono text-[10px] text-[#9ca3af]">
              {l.sku}
              {l.pack && <span className="ml-[5px] rounded-[3px] bg-[#f3f4f6] px-[5px] py-px text-[#6b7280]">{l.pack}</span>}
            </div>
          </div>
          <span className="whitespace-nowrap pt-px text-[12.5px] font-semibold text-[#374151]">{l.qty}×</span>
          <span className="w-[56px] pt-[2px] text-right text-[11px] tabular-nums text-[#9ca3af]">
            {l.litres ? `${formatLitres(l.litres)} L` : "—"}
          </span>
        </div>
      ))}
      <div className="flex border-t border-[#f0f0f0] bg-[#fafafa] px-5 py-[11px] text-[12px] font-semibold text-[#374151]">
        <span>{lines.length} lines</span>
        <span className="ml-auto tabular-nums">
          {formatLitres(totalLitres)} L
          {kgStr !== null && (
            <span title={kg && !kg.exact ? "Approximate — the OBD's kg shared by litres" : undefined}>
              {" · "}
              {kg && !kg.exact ? "~" : ""}
              {kgStr} kg
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
