"use client";

// Floor Control — the band between a trip and the pool while bills are being
// added to ONE named trip (2026-09-16, owner's add-to-trip design).
//
// 🔴 A DIVIDER SINCE 2026-09-18. It used to head a pool that had REPLACED the
// trip. Now the trip stays on screen above it (trip-desk.tsx) and the pool
// opens below it, so it carries a border on BOTH edges: it separates the truck
// from what can go on it.
//
// 🔴 IT EXISTS SO THE SCREEN NEVER ASKS AGAIN. Pressing "+ Add bills" inside a
// trip used to drop the planner in the pool with no memory of what he had come
// from, and the old dropdown then asked him which trip he meant — a question he
// had just answered by standing in it. The trip is written across the top
// instead, and the bar's one button is named after it.
//
// ⚠ THE RAIL IS NOT A PICKER IN THIS MODE. Add mode's pink hint and "+" marks
// (trip-rail.tsx) belong to the OTHER flow, where no trip has been chosen yet.
// Here one has, so a second way to choose would undo the point; the trip's card
// simply stays selected so the planner can see what he is filling.
//
// ⚠ NO TOAST ON EACH ADD (owner). This band is the receipt: its counts move with
// every press, which is quieter than a popup every few seconds while bucketing.
// The one thing a toast carried is kept — a brief "· N added · Undo" on this
// line, for ten seconds after each add.
//
// Pink is add mode's colour throughout: #fce7f3 fill, #f9a8d4 border, #be185d
// text, the tint pills' pink. Violet already means SELECTED on this screen.

export function TripAddBand({
  tripNumber,
  routeName,
  routeExtraCount,
  bills,
  litres,
  lastAddCount,
  busy,
  onUndo,
  onDone,
}: {
  tripNumber: string;
  /** The trip's route, for the same reason the rail card leads with it. */
  routeName: string | null;
  routeExtraCount: number;
  /** The trip's CURRENT counts — they move after every add. */
  bills: number;
  /** Already formatted by the caller through formatLitres. */
  litres: string;
  /** Bills the last press added, or 0. Drives the brief Undo. */
  lastAddCount: number;
  busy: boolean;
  onUndo: () => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-y border-[#f9a8d4] bg-[#fce7f3] px-4 py-2.5">
      <span className="text-[13px] font-bold text-[#be185d]">Adding bills to</span>
      {/* The number on WHITE, so it reads as the label it is even on pink. */}
      <span className="rounded-[5px] border border-[#f9a8d4] bg-white px-[6px] py-px font-mono text-[11.5px] font-semibold text-[#be185d]">
        {tripNumber}
      </span>
      <span className="text-[12.5px] tabular-nums text-[#9d174d]">
        {routeName ? (
          <>
            {routeName}
            {routeExtraCount > 0 ? ` +${routeExtraCount}` : ""} ·{" "}
          </>
        ) : null}
        {bills} bill{bills === 1 ? "" : "s"} · {litres} L
      </span>

      {lastAddCount > 0 && (
        <span className="flex items-center gap-2 text-[12px] font-semibold text-[#15773a]">
          · {lastAddCount} added
          <button
            type="button"
            onClick={onUndo}
            disabled={busy}
            className="rounded-[6px] border border-[#b6e6c8] bg-white px-2 py-px text-[11.5px] font-semibold text-[#12622f] hover:bg-[#e2f6e9] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Undo
          </button>
        </span>
      )}

      <button
        type="button"
        onClick={onDone}
        className="ml-auto rounded-[6px] border border-[#f9a8d4] bg-white px-2.5 py-[3px] text-[12px] font-semibold text-[#be185d] hover:bg-[#fdeff7]"
      >
        Done
      </button>
    </div>
  );
}
