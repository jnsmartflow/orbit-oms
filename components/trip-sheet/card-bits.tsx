// Shared pieces of the Trip Sheets phone screens (2026-10-09) — the live
// Picking card shell (CARD_SHADOW_V2, 16px radius, the grey shelf band with
// FamilyChip pills; components/picking/card-atoms.tsx) re-used, not copied.
// Display only.

import type { ReactNode } from "react";
import { CARD_SHADOW_V2, FamilyChip } from "@/components/picking/card-atoms";

export function fmtNum(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** The Picking card shell: white, 16px radius, hairline border, the v2 shadow. */
export function CardShell({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <div
      className={`bg-white border border-gray-200 rounded-[16px] overflow-hidden mb-2.5 ${muted ? "opacity-60" : ""}`}
      style={{ boxShadow: CARD_SHADOW_V2 }}
    >
      {children}
    </div>
  );
}

/** The shelf: divider + grey band + one row of pills, an optional right slot. */
export function CardShelf({ pills, muted = false, right }: { pills: string[]; muted?: boolean; right?: ReactNode }) {
  return (
    <div className="border-t border-[#eef1f4] bg-[#f6f8fa] px-[14px] py-[9px] flex items-center gap-1.5">
      <div className="flex flex-1 min-w-0 flex-wrap gap-1.5">
        {pills.map((p, i) => (
          <FamilyChip key={`${i}-${p}`} label={p} muted={muted} />
        ))}
      </div>
      {right}
    </div>
  );
}

/** Ready (ok) / Picking (warn) — STATUS colours, never brand (UI §59.9). */
export function ReadyChip({ ready }: { ready: boolean }) {
  return ready ? (
    <span className="shrink-0 rounded-full bg-ok-bg px-[9px] py-[3px] text-[11px] font-bold text-ok-text">Ready</span>
  ) : (
    <span className="shrink-0 rounded-full bg-warn-bg px-[9px] py-[3px] text-[11px] font-bold text-warn-text">Picking</span>
  );
}

/** Hand — the dealer collects (data.brown, UI §2.1). */
export function HandChip() {
  return (
    <span className="shrink-0 rounded-full border border-data-brown/30 px-[9px] py-[2px] text-[11px] font-bold text-data-brown">
      Hand
    </span>
  );
}
