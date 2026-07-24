// Floor Control — detail panel Items tab (design §10.4, mockup 02-detail-panel
// `itemsHTML`). Index · product name · SKU · pack chip · quantity · litres.
// A violet dot marks a tint line. Litre total at the foot — the ONE place a
// total appears (design §10.1 cut the kg/litre header strip). Gift lines are
// OUT OF SCOPE: no gift tag, no gift-excluded total.

import type { FloorDetailLine } from "@/lib/floor/types";

export function DetailItems({ lines, totalLitres }: { lines: FloorDetailLine[]; totalLitres: number }) {
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
              {l.isTint && <span className="ml-1.5 inline-block h-[7px] w-[7px] rounded-full bg-[#7c3aed] align-[1px]" />}
            </div>
            <div className="mt-[3px] font-mono text-[10px] text-[#9ca3af]">
              {l.sku}
              {l.pack && <span className="ml-[5px] rounded-[3px] bg-[#f3f4f6] px-[5px] py-px text-[#6b7280]">{l.pack}</span>}
            </div>
          </div>
          <span className="whitespace-nowrap pt-px text-[12.5px] font-semibold text-[#374151]">{l.qty}×</span>
          <span className="w-[56px] pt-[2px] text-right text-[11px] tabular-nums text-[#9ca3af]">
            {l.litres ? `${l.litres} L` : "—"}
          </span>
        </div>
      ))}
      <div className="flex border-t border-[#f0f0f0] bg-[#fafafa] px-5 py-[11px] text-[12px] font-semibold text-[#374151]">
        <span>{lines.length} lines</span>
        <span className="ml-auto tabular-nums">{totalLitres} L</span>
      </div>
    </div>
  );
}
