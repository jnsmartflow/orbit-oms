// Floor Control — rail card tint strip (design §6.3, mockup 04-card-spec §2/§4).
// The last thing the operator's eye crosses before deciding; updates itself as
// the tint team works. Colour: violet while tinting, green when ready.
//
// 0-splits case (a tinting_in_progress bill with zero non-cancelled splits —
// anomalous data seen on live): we OMIT the "N of N shades" count and the
// progress bar entirely (a "0 of 0" reads broken), and fall the operator phrase
// back to a neutral "Tinting in progress" / "Assigned to tint operator" when the
// operator is unknown.

import { Droplet } from "lucide-react";
import type { TintState } from "@/lib/floor/types";

export function TintStrip({ tint }: { tint: TintState }) {
  const ready = tint.stage === "ready";
  const hasShades = tint.shadesTotal > 0;

  let label: string;
  if (tint.stage === "waiting") label = "Waiting for tint assignment";
  else if (tint.stage === "assigned") label = tint.operatorName ? `Assigned to ${tint.operatorName}` : "Assigned to tint operator";
  else if (tint.stage === "mixing") label = tint.operatorName ? `${tint.operatorName} is mixing` : "Tinting in progress";
  else label = "All shades ready";

  const pct = hasShades ? Math.round((tint.shadesDone / tint.shadesTotal) * 100) : 0;

  return (
    <>
      <div
        className={`mt-[9px] flex items-center gap-[7px] rounded-md px-[9px] py-[6px] text-[11px] ${
          ready ? "bg-[#f0fdf4] text-[#15803d]" : "bg-[#f5f3ff] text-[#5b21b6]"
        }`}
      >
        <Droplet size={12} className="flex-shrink-0" />
        <span className="font-semibold">{label}</span>
        {hasShades && (
          <span className="ml-auto text-[10.5px] tabular-nums opacity-85">
            {tint.shadesDone} of {tint.shadesTotal} shades
          </span>
        )}
      </div>
      {hasShades && (
        <div className={`mt-[6px] h-[3px] overflow-hidden rounded-sm ${ready ? "bg-[#dcfce7]" : "bg-[#e9e3fb]"}`}>
          <span className={`block h-full ${ready ? "bg-[#22c55e]" : "bg-[#7c3aed]"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </>
  );
}
