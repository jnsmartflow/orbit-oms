// Shared pieces of the Trip Sheets phone screens (2026-10-09) — the live
// Picking card shell (CARD_SHADOW_V2, 16px radius, the grey shelf band with
// FamilyChip pills; components/picking/card-atoms.tsx) re-used, not copied.
// Display only.

import type { ReactNode } from "react";
import { Phone } from "lucide-react";
import { CARD_SHADOW_V2, FamilyChip } from "@/components/picking/card-atoms";

export function fmtNum(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/**
 * The Picking card shell: white, 16px radius, hairline border, the v2 shadow.
 * `roomy` (the trip LIST card, 2026-10-10): no margin of its own — its wrapper
 * carries the 12px gap, so the stretched card link covers exactly the card.
 */
export function CardShell({ children, muted = false, roomy = false }: { children: ReactNode; muted?: boolean; roomy?: boolean }) {
  return (
    <div
      className={`bg-white border border-gray-200 rounded-[16px] overflow-hidden ${roomy ? "" : "mb-2.5"} ${muted ? "opacity-60" : ""}`}
      style={{ boxShadow: CARD_SHADOW_V2 }}
    >
      {children}
    </div>
  );
}

/**
 * The shelf: divider + grey band + one row of pills, an optional right slot.
 * `roomy` (trip list): 18px sides and 12px below the divider, to match the
 * card's 18px padding.
 */
export function CardShelf({
  pills,
  muted = false,
  right,
  roomy = false,
}: {
  pills: string[];
  muted?: boolean;
  right?: ReactNode;
  roomy?: boolean;
}) {
  return (
    <div
      className={`border-t border-[#eef1f4] bg-[#f6f8fa] flex items-center gap-1.5 ${roomy ? "px-[18px] py-3" : "px-[14px] py-[9px]"}`}
    >
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

/** A dial-able form of a stored phone: digits and a leading +, nothing else. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/**
 * TAP-TO-CALL the driver (2026-10-10): a 40px light-green disc with a green
 * phone, inside a 44px touch target (UI §59 touch size). Success tokens — a
 * call is a positive action, not a commit, so never brand. Renders NOTHING
 * without a phone. It stops the tap from reaching anything behind it, so a
 * card's own link never opens from it.
 *
 * `compact` (the SO on a bill card, 2026-10-10): a 30px disc inside a 40px hit
 * area, pulled into the text row with negative margins so a card with a phone
 * is no taller than one without.
 */
export function CallButton({
  phone,
  name,
  compact = false,
}: {
  phone: string | null;
  name: string | null;
  compact?: boolean;
}) {
  if (!phone) return null;
  return (
    <a
      href={telHref(phone)}
      onClick={(e) => e.stopPropagation()}
      aria-label={name ? `Call ${name}` : "Call driver"}
      className={`relative z-[2] flex shrink-0 items-center justify-center ${compact ? "-my-[11px] -mr-1.5 h-10 w-10" : "h-11 w-11"}`}
    >
      <span
        className={`flex items-center justify-center rounded-full bg-ok-bg text-ok active:opacity-70 ${compact ? "h-[30px] w-[30px]" : "h-10 w-10"}`}
      >
        <Phone size={compact ? 15 : 18} strokeWidth={2.2} />
      </span>
    </a>
  );
}
