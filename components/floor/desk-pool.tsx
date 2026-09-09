"use client";

// Floor Control — the "At desk" pool on the By-trip view (mockup §03).
//
// Bills that are going out but sit on NO trip: `tripDropId === null`. It is the
// staging area the Build trip drawer draws from, and it sits above the trip
// bands because that is the direction work moves.
//
// 🔴 THE ONE THING ON THIS SCREEN THAT MAY BRANCH ON THE GATE. With desk control
// ON the pool's bills are genuinely invisible to the supervisor, so the copy
// says so; with it OFF they are already on his board and claiming otherwise
// would be a lie. The decision record's §2.1 is explicit that the trip board
// must otherwise work identically in both states — no other component here
// reads `gateOn` for anything but forwarding it to the status pill.
//
// The dashed border is the mockup's: a staging area, not a container of record.

export function DeskPool({
  count,
  litres,
  gateOn,
  canBuild,
  selectedCount,
  onBuild,
}: {
  /** Bills on no trip, in the currently filtered view. */
  count: number;
  litres: number;
  gateOn: boolean;
  /** False while a write is in flight, so the button cannot be double-fired. */
  canBuild: boolean;
  /** How many of those bills the operator has ticked. */
  selectedCount: number;
  onBuild: () => void;
}) {
  const subject = count === 1 ? "bill" : "bills";

  return (
    <div className="rounded-[11px] border border-dashed border-[#d6d3e2] bg-[#fbfaff] px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <h5 className="m-0 text-[13.5px] font-bold tracking-[-0.01em] text-gray-900">At desk</h5>
        <span className="text-[12px] text-gray-500">
          {count} {subject} · {litres.toLocaleString("en-US")} L ·{" "}
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

      {count === 0 && (
        <p className="mt-1.5 text-[11px] text-gray-400">
          Every bill on the board is on a trip.
        </p>
      )}
    </div>
  );
}
