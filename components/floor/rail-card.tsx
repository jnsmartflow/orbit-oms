"use client";

// Floor Control — the left-rail card. Layout/copy authority:
// docs/mockups/floor-control/04-card-spec.html (+ 01-board.html). Colour is
// carried by ICONS and TEXT only — no paint on the card; status colour is
// reserved for the floor's status pills (design §6.2).
//
// Buttons: [ pick slot ] / Hold / ✕ — every card renders the SAME row.
//  - LIVE this step: the slot picker — picking a slot releases the bill.
//  - INERT this step: Hold and ✕ — Step 5 owns the actions route.
//  - The slot picker is components/support/dispatch-slot-picker.tsx reused AS-IS
//    (its own "pick slot" pill is the whole slot control — not forked).
//  - The render-time "Release to {slot}" suggestion button is DEFERRED to Step 10
//    (see lib/floor/queries.ts RAIL_SUGGESTIONS_ENABLED). No teal/green Release
//    button renders anywhere on the rail now.
//  - A bill is releasable only at pending_support (a non-tint bill, or a tint
//    bill whose shades are all done). On a mid-tint bill the picker is DIMMED
//    (disabled) — that IS the dimmed state; there is no separate greyed button.

import { Droplet } from "lucide-react";
import { DispatchSlotPicker, type DispatchWindow } from "@/components/support/dispatch-slot-picker";
import { TintStrip } from "./tint-strip";
import type { FloorRailCard as RailCardData } from "@/lib/floor/types";

export interface RailReleaseSlot {
  dispatchTargetDate: string;
  dispatchWindowId: number;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso)
    .toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    })
    .replace(",", "");
}

export function RailCard({
  card,
  windows,
  onRelease,
}: {
  card: RailCardData;
  windows: DispatchWindow[];
  onRelease: (orderId: number, slot: RailReleaseSlot) => void;
}) {
  const releasable = card.workflowStage === "pending_support";
  const dropletReady = card.tint?.stage === "ready";

  return (
    <div className="mb-2 rounded-lg border border-gray-200 bg-white px-3 py-[11px] transition-colors hover:border-gray-300">
      {/* OBD · time · icons (fixed order: age → ★ → ⚡ → droplet) */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11.5px] tracking-[-0.01em] text-gray-700">{card.obdNumber}</span>
        <span className="text-[10.5px] text-gray-400">{fmtWhen(card.obdDateTime)}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {card.ageDays > 0 && (
            <span className="rounded-[3px] bg-gray-100 px-[5px] py-px text-[9.5px] font-bold leading-[1.5] text-gray-500">
              {card.ageDays}d
            </span>
          )}
          {card.isKeyCustomer && <span className="text-[12px] leading-none text-[#f59e0b]">★</span>}
          {card.priorityLevel === 1 && <span className="text-[12px] leading-none text-[#ef4444]">⚡</span>}
          {card.isTint && <Droplet size={13} className={dropletReady ? "text-[#16a34a]" : "text-[#7c3aed]"} />}
        </span>
      </div>

      {/* Customer (original ship-to) — largest thing on the card */}
      <div className="mt-1.5 text-[14px] font-bold leading-[1.3] text-gray-900">
        {card.customerName ?? card.dealerName}
      </div>

      {/* Route · Vol */}
      <div className="mt-[3px] text-[11.5px] text-gray-600">
        {card.route ?? "—"} <span className="text-gray-400">&middot; {card.volumeLitres ?? 0} L</span>
      </div>

      {/* Ship-to override line — override only (04-card-spec §4) */}
      {card.isShipToOverride && card.shipToOverrideName && (
        <div className="mt-[3px] text-[11px] text-gray-600">
          Ship to <b className="font-semibold text-gray-700">{card.shipToOverrideName}</b>
        </div>
      )}

      {/* Tint strip (tint bills only) */}
      {card.tint && <TintStrip tint={card.tint} />}

      {/* Actions — every card renders the SAME row: [ pick slot ] [ Hold ] [ ✕ ]
          (design §6.2, 04-card-spec). The render-time "Release to {slot}" button
          is DEFERRED to Step 10 (lib/floor/queries.ts RAIL_SUGGESTIONS_ENABLED),
          so the operator always opens the picker and chooses the slot himself.
          Picking a slot still releases the bill (unchanged). On a mid-tint bill
          whose shades are not ready the picker is DISABLED — that is the dimmed
          state; there is no separate greyed Release button. */}
      <div className="mt-2.5 flex items-center gap-1.5">
        {/* Slot / Set-slot — reused picker; picking a slot releases the bill */}
        <DispatchSlotPicker
          value={null}
          onChange={(v) => {
            if (v) onRelease(card.orderId, { dispatchTargetDate: v.date, dispatchWindowId: v.dispatchWindowId });
          }}
          windows={windows}
          disabled={!releasable}
        />

        {/* Inert this step — Step 5 owns the actions route */}
        <button
          type="button"
          title="Hold — coming in a later step"
          className="h-[30px] rounded-md border border-gray-200 bg-white px-2.5 text-[11px] text-gray-500 hover:border-gray-300"
        >
          Hold
        </button>
        <button
          type="button"
          title="Cancel — coming in a later step"
          className="h-[30px] rounded-md border border-gray-200 bg-white px-2.5 text-[11px] text-gray-500 hover:border-gray-300"
        >
          &#10005;
        </button>
      </div>
    </div>
  );
}
