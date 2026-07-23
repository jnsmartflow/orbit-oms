"use client";

// Floor Control — the left-rail card. Layout/copy authority:
// docs/mockups/floor-control/04-card-spec.html (+ 01-board.html). Colour is
// carried by ICONS and TEXT only — no paint on the card; status colour is
// reserved for the floor's status pills (design §6.2).
//
// Buttons: Release / Slot / Hold / ✕.
//  - LIVE this step: Release (suggested slot) and the slot picker (pick + release).
//  - INERT this step: Hold and ✕ — Step 5 owns the actions route.
//  - The slot picker is components/support/dispatch-slot-picker.tsx reused AS-IS
//    (its own "pick slot" pill is the Slot / Set-slot control — not forked).
//  - A bill is releasable only at pending_support (a non-tint bill, or a tint
//    bill whose shades are all done). A mid-tint bill's Release is DIMMED and
//    its picker is disabled this step (pre-set is Step 5).

import { Droplet } from "lucide-react";
import { DispatchSlotPicker, type DispatchWindow } from "@/components/support/dispatch-slot-picker";
import { TintStrip } from "./tint-strip";
import type { FloorRailCard as RailCardData } from "@/lib/floor/types";

export interface RailReleaseSlot {
  dispatchTargetDate: string;
  dispatchWindowId: number;
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function todayIstIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function releaseLabel(windowTime: string, targetDate: string): string {
  if (targetDate === todayIstIso()) return `Release to ${windowTime}`;
  const [y, m, d] = targetDate.split("-").map(Number);
  return `Release to ${WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${windowTime}`;
}

function resolveWindowId(windowTime: string, windows: DispatchWindow[]): number {
  return windows.find((w) => w.windowTime === windowTime)?.id ?? -1;
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
  const sug = card.suggestion;
  const sugWindowId = sug ? resolveWindowId(sug.windowTime, windows) : -1;

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

      {/* Actions */}
      <div className="mt-2.5 flex items-center gap-1.5">
        {releasable && sug ? (
          <button
            type="button"
            disabled={sugWindowId < 0}
            onClick={() => onRelease(card.orderId, { dispatchTargetDate: sug.targetDate, dispatchWindowId: sugWindowId })}
            className="h-[30px] flex-1 rounded-md bg-teal-600 text-[11.5px] font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {releaseLabel(sug.windowTime, sug.targetDate)}
          </button>
        ) : !releasable ? (
          <button
            type="button"
            disabled
            title="Release opens once the shade is ready"
            className="h-[30px] flex-1 cursor-not-allowed rounded-md border border-gray-100 bg-gray-50 text-[11.5px] font-medium text-gray-300"
          >
            Release
          </button>
        ) : null}

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
