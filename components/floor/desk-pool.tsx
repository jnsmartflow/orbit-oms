"use client";

// Floor Control — the "At desk" pool on the By-trip view (mockup §03).
//
// Bills that are going out but sit on NO trip: `tripDropId === null`. It is the
// staging area the Build trip drawer draws from, and it sits above the trip
// bands because that is the direction work moves.
//
// 🔴 IT RENDERS ITS BILLS EXACTLY THE WAY THE BY-ROUTE VIEW DOES — the same
// <RouteRow />, which renders the same <FloorTable />, with the same tick boxes
// and the same selection Set. It IS the By-route rendering filtered to
// `tripDropId === null`.
//
// The first cut of this file was a HEADER ONLY, copied faithfully from the
// mockup, which drew the pool as one summary line. That was a mockup error and
// it made the feature unusable: with no rows there is no way to tick a bill, so
// Build trip could never enable. Recorded because the mockup still shows it that
// way and a later reader may "restore" it.
//
// ⚠ NO SECOND TABLE, NO SECOND ROW COMPONENT, NO SECOND SELECTION MECHANISM.
// Everything below delegates. A parallel implementation is how the pool and the
// By-route view would come to disagree about which rows are selectable, which is
// a rule that lives in lib/floor/selection.ts and must keep one owner.
//
// 🔴 THE ONE THING ON THIS SCREEN THAT MAY BRANCH ON THE GATE. With desk control
// ON the pool's bills are genuinely invisible to the supervisor, so the copy
// says so; with it OFF they are already on his board and claiming otherwise
// would be a lie. The decision record's §2.1 is explicit that the trip board
// must otherwise work identically in both states — no other component here
// reads `gateOn` for anything but forwarding it to the status pill.
//
// The dashed border is the mockup's: a staging area, not a container of record.

import { RouteRow } from "./route-row";
import { countByStatus, sumLitres } from "./status-pill";
import type { FloorTableVariant } from "./floor-table";
import type { FloorSelection } from "@/lib/floor/selection";
import type { FloorBoardRow } from "@/lib/floor/types";

export function DeskPool({
  rows,
  nowMs,
  gateOn,
  canBuild,
  selectedCount,
  onBuild,
  openRoute,
  onToggleRoute,
  variant,
  selection,
  onToggleRow,
  onToggleAll,
  onMarkUrgent,
  onOpenDetail,
}: {
  /** Bills on no trip, in the currently filtered view. Already spine-sorted. */
  rows: FloorBoardRow[];
  nowMs: number;
  gateOn: boolean;
  /** False in History — a past day's pool is a record, not a staging area. */
  canBuild: boolean;
  /** How many of those bills the operator has ticked. */
  selectedCount: number;
  onBuild: () => void;
  /** Which pool route is expanded, or null. Owned by the parent, like By route. */
  openRoute: string | null;
  onToggleRoute: (name: string) => void;
  variant: FloorTableVariant;
  selection?: FloorSelection;
  onToggleRow?: (id: number) => void;
  onToggleAll?: (rows: FloorBoardRow[]) => void;
  onMarkUrgent?: (id: number) => void;
  onOpenDetail?: (id: number) => void;
}) {
  const litres = sumLitres(rows);
  const subject = rows.length === 1 ? "bill" : "bills";

  // Grouped by route and ordered worst-first, the SAME arithmetic the By-route
  // branch applies (floor-board.tsx) — least complete on top, larger group on a
  // tie. Duplicated here rather than shared because the two call sites sort
  // different populations for different reasons; if a third appears, extract it.
  const groups = (() => {
    const map = new Map<string, FloorBoardRow[]>();
    for (const r of rows) {
      const k = r.route ?? "No route";
      const arr = map.get(k) ?? [];
      arr.push(r);
      map.set(k, arr);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const ca = countByStatus(a[1]);
      const cb = countByStatus(b[1]);
      const pa = ca.total ? ca.done / ca.total : 1;
      const pb = cb.total ? cb.done / cb.total : 1;
      if (pa !== pb) return pa - pb;
      return b[1].length - a[1].length;
    });
  })();

  return (
    <div className="overflow-hidden rounded-[11px] border border-dashed border-[#d6d3e2] bg-[#fbfaff]">
      <div className="flex flex-wrap items-center gap-2.5 px-3.5 py-3">
        <h5 className="m-0 text-[13.5px] font-bold tracking-[-0.01em] text-gray-900">At desk</h5>
        <span className="text-[12px] text-gray-500">
          {rows.length} {subject} · {litres.toLocaleString("en-US")} L ·{" "}
          {gateOn
            ? "not on a trip, floor cannot see them"
            : "not on a trip yet — floor can already see them"}
        </span>

        <button
          type="button"
          onClick={onBuild}
          disabled={!canBuild || selectedCount === 0}
          title={
            selectedCount === 0
              ? "Tick the bills you want on the trip first"
              : `Build a trip from ${selectedCount} selected ${selectedCount === 1 ? "bill" : "bills"}`
          }
          className="ml-auto inline-flex h-[30px] items-center rounded-[8px] bg-brand-600 px-3.5 text-[12.5px] font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
        >
          {selectedCount > 0 ? `Build trip · ${selectedCount}` : "Build trip"}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="border-t border-[#ece9f5] px-3.5 py-3 text-[11px] text-gray-400">
          Every bill on the board is on a trip.
        </p>
      ) : (
        // ⚠ COLLAPSED BY DEFAULT — the parent seeds `openRoute` to null and the
        // pool holds ~197 bills on a normal day. A flat list of that length is
        // unusable, which is the whole reason the By-route view groups at all.
        // One route open at a time, matching By route's own contract.
        //
        // ⚠ The route header's checkbox is <FloorTable />'s, driven by the
        // `toggleAll` the parent passes — PER GROUP, and selects-all on a
        // partial selection (lib/floor/selection.ts). That contract is
        // unchanged here: the pool is another group, not a new rule, and the
        // assign bar's ✕ is still the only global clear.
        <div className="border-t border-[#ece9f5] bg-white">
          {groups.map(([name, gr]) => (
            <RouteRow
              key={name}
              name={name}
              rows={gr}
              nowMs={nowMs}
              open={openRoute === name}
              onToggle={() => onToggleRoute(name)}
              variant={variant}
              selection={selection}
              onToggleRow={onToggleRow}
              onToggleAll={onToggleAll}
              onMarkUrgent={onMarkUrgent}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      )}
    </div>
  );
}
