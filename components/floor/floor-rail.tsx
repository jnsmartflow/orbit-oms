"use client";

// Floor Control — the left rail ("Needs your decision"). Header + independently
// scrolling body. Oldest first (carried-over bills float to the top by the
// server sort). Never filtered by search / slot / route — only the header
// delivery-type scope narrows it (design §6.1).

import { FloorSkeleton } from "./floor-skeleton";
import { RailCard, type RailReleaseSlot } from "./rail-card";
import { RailEmpty, type RailEmptyVariant } from "./rail-empty";
import type { FloorRailCard, FloorScope } from "@/lib/floor/types";
import type { DispatchWindow } from "@/components/support/dispatch-slot-picker";

export function FloorRail({
  cards,
  loading,
  error,
  scope,
  floorTotal,
  windows,
  onRelease,
  onHold,
  onCancel,
  onShowAll,
}: {
  cards: FloorRailCard[] | null;
  loading: boolean;
  error: string | null;
  scope: FloorScope;
  floorTotal: number;
  windows: DispatchWindow[];
  onRelease: (orderId: number, slot: RailReleaseSlot) => void;
  onHold: (orderId: number) => void;
  onCancel: (orderId: number) => void;
  onShowAll: () => void;
}) {
  const count = cards?.length ?? 0;
  // Scoped-and-empty vs all-clear vs before-first-import: if the floor is
  // running (has bills) it's "all clear"; if nothing exists anywhere it's
  // "nothing yet today".
  const emptyVariant: RailEmptyVariant =
    scope !== "All" ? "scoped" : floorTotal > 0 ? "all-clear" : "nothing-yet";

  return (
    <div className="flex min-h-0 flex-col border-r border-gray-200 bg-[#fbfbfc]">
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3.5 py-2.5">
        <span className="text-[11.5px] font-bold text-gray-900">Needs your decision</span>
        {!loading && !error && (
          <span className="rounded bg-gray-100 px-[7px] py-px text-[10.5px] font-bold text-gray-700">{count}</span>
        )}
        <span className="ml-auto text-[10px] text-gray-400">oldest first</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <FloorSkeleton variant="rail" />
        ) : error ? (
          <div className="px-5 py-14 text-center text-[11.5px] text-gray-400">Couldn&rsquo;t load the rail. {error}</div>
        ) : count === 0 ? (
          <RailEmpty variant={emptyVariant} scope={scope} onShowAll={onShowAll} />
        ) : (
          <div className="p-2.5">
            {cards!.map((c) => (
              <RailCard key={c.orderId} card={c} windows={windows} onRelease={onRelease} onHold={onHold} onCancel={onCancel} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
