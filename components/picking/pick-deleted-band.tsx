"use client";

// "Pick deleted today" — the read-only band at the FOOT of the supervisor's Done
// tab and of the picker's own Pending tab (2026-09-27, build step 8).
//
// Billing's Pick delete cancels one bill of a same-SO group. A cancelled bill
// leaves the queue and its pick assignment is deleted, so without this the
// picker would lose it with no word. Each card says which bill went and which
// one to pick instead — and nothing else.
//
// 🔴 NO ACTIONS. Not a button, not a link, not tappable: no Mark done, Approve,
// Assign, Undo, finding triangle, detail screen or swipe-pager entry. The cards
// come from PickingQueueResult.pickDeleted — a SIBLING of `rows`, never a row —
// so no tab badge, bundle, selection or pager list can ever count them.
//
// Card GEOMETRY copies the board's own card shell (rounded-[16px], mb-2.5,
// CARD_SHADOW_V2, the 11.5px mono caption and the 16px dealer hero); colours are
// Orbit tokens. The "Pick delete" tag is danger — the bill was cancelled — and
// sits where the Same SO tag used to.

import { CARD_SHADOW_V2, RouteDot } from "@/components/picking/card-atoms";
import type { PickDeletedCard } from "@/lib/picking/types";

export function PickDeleteTag(): React.JSX.Element {
  return (
    <span className="shrink-0 whitespace-nowrap rounded-full border border-danger-bd bg-danger-bg px-2 py-[3px] text-[10.5px] font-semibold text-danger-text">
      Pick delete
    </span>
  );
}

function PickDeletedCardView({ card }: { card: PickDeletedCard }): React.JSX.Element {
  return (
    <div
      className="mb-2.5 w-full overflow-hidden rounded-[16px] border border-ink-100 bg-white"
      style={{ boxShadow: CARD_SHADOW_V2 }}
    >
      <div className="px-4 pb-3.5 pt-3">
        <div className="flex items-center justify-between gap-2 text-[11.5px]">
          <span className="shrink-0 font-mono text-ink-400">{card.obdNumber}</span>
          <PickDeleteTag />
        </div>
        <div className="mt-1 truncate text-[16px] font-semibold leading-[1.25] text-ink-900">{card.dealerName}</div>
        {card.route !== null && (
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-ink-500">
            <RouteDot deliveryType={card.deliveryType} />
            <span className="truncate">{card.route}</span>
          </div>
        )}
        <div className="mt-2 text-[12.5px] text-ink-700">
          Correct pick:{" "}
          <span className="font-mono font-semibold text-ink-900">
            {card.correctObds.length > 0 ? card.correctObds.join(", ") : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Renders nothing when there is nothing to show — no empty heading. */
export function PickDeletedBand({ cards }: { cards: PickDeletedCard[] }): React.JSX.Element | null {
  if (cards.length === 0) return null;
  return (
    <section aria-label="Pick deleted today" className="mt-[18px]">
      <div className="mb-2 px-[2px] text-[11.5px] font-semibold uppercase tracking-wider text-ink-400">
        Pick deleted today<span className="ml-1.5 tabular-nums">{cards.length}</span>
      </div>
      {cards.map((c) => (
        <PickDeletedCardView key={c.decisionId} card={c} />
      ))}
    </section>
  );
}
