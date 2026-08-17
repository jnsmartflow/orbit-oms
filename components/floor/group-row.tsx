"use client";

// Floor Control — one By-group bundle: a MAIN bill plus the 1-3 riders that add
// ZERO new SKUs to it. The rule and the arithmetic live in lib/floor/grouping.ts;
// this file only renders the answer and never re-decides anything.
//
// Mechanics are route-row.tsx's, deliberately — same chevron, same collapsed
// summary line, same FloorTable underneath — so a group reads as another kind of
// block on a board the operator already knows, not as a new screen.
//
// ⚠ ONE STRUCTURAL DIFFERENCE from route-row: the header is a <div> whose
// TOGGLE is an inner <button>, rather than one big <button> wrapping everything.
// "Select all" is a second control in the same header, and a <button> nested
// inside a <button> is invalid HTML (React warns, and the inner click target
// behaves differently across browsers).
//
// ROW ORDER inside a group is MAIN FIRST, then the riders in the engine's order.
// FLOOR_SPINE is deliberately NOT applied here: the spine answers "what should
// this picker walk first", and inside a bundle the meaningful order is "here is
// the bill you are picking, here is what rides along with it for free".

import { FloorTable } from "./floor-table";
import { sumLitres } from "./status-pill";
import type { FloorTableVariant } from "./floor-table";
import type { FloorSelection } from "@/lib/floor/selection";
import type { FloorBoardRow, PickGroup } from "@/lib/floor/types";

// Chip tokens. No new hues: grey is the Waiting status-pill's exact pair
// (status-pill.tsx), teal is the screen's existing teal family — the same one
// the active slot tab and the Assign button already use, at a tint light enough
// that it cannot be mistaken for a second primary button (CLAUDE_UI §10 — one
// teal per surface, and that one belongs to the assign bar's Assign).
const CHIP = "mt-0.5 inline-flex items-center rounded-[4px] px-2 py-[2px] text-[10px] font-semibold";
const CHIP_GREY = `${CHIP} bg-[#f3f4f6] text-[#6b7280]`;
const CHIP_TEAL = `${CHIP} bg-teal-50 text-teal-700`;

function uniqueSorted(values: Array<string | null>, fallback: string): string[] {
  const set = new Set<string>();
  for (const v of values) set.add(v ?? fallback);
  return Array.from(set).sort((a, b) => a.localeCompare(b, "en"));
}

export function GroupRow({
  group,
  rows,
  skuCountById,
  nowMs,
  open,
  onToggle,
  variant,
  assignTo = null,
  onAssignGroup,
  selection,
  onToggleRow,
  onToggleAll,
  onMarkUrgent,
  onOpenDetail,
}: {
  group: PickGroup;
  /** The group's board rows, MAIN FIRST then riders — see the note above. */
  rows: FloorBoardRow[];
  /** Distinct-SKU count per orderId, for the "· {n} items" tail on each chip. */
  skuCountById: Map<number, number>;
  nowMs: number;
  open: boolean;
  onToggle: () => void;
  variant: FloorTableVariant;
  /**
   * The picker this bundle would go to, when the operator arrived from a picker
   * card. Set = the header button assigns in one press. null/omitted = it only
   * selects, and the assign bar does the assigning as before.
   */
  assignTo?: { id: number; name: string } | null;
  onAssignGroup?: (orderIds: number[], pickerId: number) => void;
  selection?: FloorSelection;
  onToggleRow?: (id: number) => void;
  onToggleAll?: (rows: FloorBoardRow[]) => void;
  onMarkUrgent?: (id: number) => void;
  onOpenDetail?: (id: number) => void;
}) {
  const litres = sumLitres(rows);
  const routes = uniqueSorted(rows.map((r) => r.route), "No route");
  const slots = uniqueSorted(rows.map((r) => r.windowTime), "No slot");
  const mainName = rows[0]?.dealerName ?? group.main.obdNumber;
  const others = rows.length - 1;

  // Select-all is live-only: on a history day there is nothing to hand over.
  const canSelect = variant === "live" && !!onToggleAll;

  return (
    <>
      <div
        className={`flex w-full items-center gap-2.5 border-b border-[#f0f0f0] px-3.5 py-2.5 ${
          open ? "bg-[#fafafa]" : "bg-white"
        }`}
      >
        {/* Toggle — everything except the Select-all button is the hit area. */}
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <span className="w-2.5 shrink-0 text-[11px] text-gray-300">{open ? "▾" : "▸"}</span>
          <span className="w-[62px] shrink-0 text-[12px] font-semibold text-gray-900">
            {rows.length} bills
          </span>
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-gray-700">
            <span className="font-medium text-gray-900">{mainName}</span>
            {others > 0 && <span className="text-gray-400"> + {others} more</span>}
          </span>
          <span className="w-[118px] shrink-0 text-[10.5px] text-gray-400">
            {litres} L &middot; {routes.length} route{routes.length === 1 ? "" : "s"}
          </span>
          <span className="w-[132px] shrink-0 truncate text-[10.5px] text-gray-400" title={slots.join(", ")}>
            {slots.join(" · ")}
          </span>
          <span className={`${CHIP} mt-0 shrink-0 bg-teal-50 text-teal-700`}>
            saves {group.savedTrips} shelf trip{group.savedTrips === 1 ? "" : "s"}
          </span>
        </button>

        {/* The header's one control, in two states.
            WITH a picker chosen — one press hands the whole bundle over. The ids
            go straight to the handler, never via the selection state, so the
            write cannot post a stale set (see bulkAssign's explicitIds note).
            WITHOUT one — select only, routed through the SAME per-group
            toggleAll the table's header checkbox uses (lib/floor/selection.ts),
            so the two controls can never disagree and a second press clears the
            group exactly like the checkbox does. */}
        {canSelect && assignTo && onAssignGroup && (
          <button
            type="button"
            onClick={() => onAssignGroup(rows.map((r) => r.orderId), assignTo.id)}
            className="ml-1 shrink-0 rounded-md border border-teal-600 bg-teal-600 px-2.5 py-[3px] text-[10.5px] font-semibold text-white hover:bg-teal-700"
          >
            Assign all {rows.length} to {assignTo.name.split(" ")[0]}
          </button>
        )}
        {canSelect && !(assignTo && onAssignGroup) && (
          <button
            type="button"
            onClick={() => onToggleAll?.(rows)}
            className="ml-1 shrink-0 rounded-md border border-gray-300 bg-white px-2.5 py-[3px] text-[10.5px] font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-50"
          >
            Select all {rows.length}
          </button>
        )}
      </div>

      {open && (
        <FloorTable
          rows={rows}
          nowMs={nowMs}
          variant={variant}
          selection={selection}
          onToggleRow={onToggleRow}
          onToggleAll={onToggleAll}
          onMarkUrgent={onMarkUrgent}
          onOpenDetail={onOpenDetail}
          showSlot
          chipFor={(row) => {
            const items = skuCountById.get(row.orderId) ?? 0;
            const isMain = row.orderId === group.main.orderId;
            // Exactly ONE chip per row. No "other area" chip — the Route column
            // already carries that, and a second chip would say it twice.
            return (
              <div>
                <span className={isMain ? CHIP_GREY : CHIP_TEAL}>
                  {isMain ? "MAIN BILL" : "FREE"} &middot; {items} item{items === 1 ? "" : "s"}
                </span>
              </div>
            );
          }}
        />
      )}
    </>
  );
}
