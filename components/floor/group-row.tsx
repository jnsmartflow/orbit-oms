"use client";

// Floor Control — one By-group bundle, in either of the TWO kinds the engine
// produces. The rule and the arithmetic live in lib/floor/grouping.ts; this file
// only renders the answer and never re-decides anything.
//
//   variant="free"  Rule 1 (buildPickGroups) — a MAIN bill plus riders that add
//                   ZERO new SKUs. The bundle is genuinely free: every rider
//                   shelf was already on the main bill's walk. Main/rider is a
//                   true description here, so the row says it.
//   variant="oil"   Rule 2 (buildOilGroups) — 2-4 bills that all sit in the oil
//                   paint end. NO MAIN, NO RIDERS: the saving is one walk to a
//                   family of racks, not one man's walk that others ride. Every
//                   member is a peer and the row must not imply otherwise —
//                   which is why the oil rows carry NO per-row chip at all
//                   (a MAIN BILL or "+N steps · shares M" chip would be a
//                   statement about a relationship that does not exist).
//
// ONE component with a variant, deliberately not two: the mechanics (chevron,
// collapsed summary, FloorTable underneath, per-group selection, the assign
// button) are identical and must stay identical. Forking would let them drift.
//
// ⚠ WHY "OIL PAINT" AND NOT "SMALL WAREHOUSE". The rule is defined by PRODUCT —
// a bill qualifies on what is printed on it, and the operator can check that
// from the row in front of him. Which building the material sits in is OUR
// reasoning, not his evidence, and naming the building would ask him to trust a
// mapping he cannot see. Say "oil paint" everywhere in this file.
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
// the bill you are picking, here is what rides along with it".

import { FloorTable } from "./floor-table";
import { sumLitres } from "./status-pill";
import type { FloorTableVariant } from "./floor-table";
import type { FloorSelection } from "@/lib/floor/selection";
import type { FloorBoardRow, OilGroup, PickGroup } from "@/lib/floor/types";

// Chip tokens. No new hues: grey is the Waiting status-pill's exact pair
// (status-pill.tsx), teal is the screen's existing teal family — the same one
// the active slot tab and the Assign button already use, at a tint light enough
// that it cannot be mistaken for a second primary button (CLAUDE_UI §10 — one
// teal per surface, and that one belongs to the assign bar's Assign).
const CHIP = "mt-0.5 inline-flex items-center rounded-[4px] px-2 py-[2px] text-[10px] font-semibold";
const CHIP_GREY = `${CHIP} bg-[#f3f4f6] text-[#6b7280]`;
const CHIP_TEAL = `${CHIP} bg-teal-50 text-teal-700`;
// ⚠ MOSTLY SAME IS DELIBERATELY NOT TEAL, AND DELIBERATELY NOT FILLED.
// On this screen teal means "costs you nothing" — it is what the SAME MATERIAL
// pill and the per-row FREE chip are, and a SAME MATERIAL bundle earns it: every
// rider SKU was already on the main bill's walk. MOSTLY SAME is a different
// offer — bills that merely live in the same end of the depot, which the
// operator may or may not want to hand to one man. Wearing the teal would answer
// that question for him. Amber on white, outlined not filled, so it stays quiet
// (this is not a warning) and can never be mistaken for the assign bar's teal
// CTA (CLAUDE_UI §10, one teal per surface).
const CHIP_OIL = `${CHIP} border border-amber-300 bg-white text-amber-700`;

function uniqueSorted(values: Array<string | null>, fallback: string): string[] {
  const set = new Set<string>();
  for (const v of values) set.add(v ?? fallback);
  return Array.from(set).sort((a, b) => a.localeCompare(b, "en"));
}

/** Props shared by both kinds. `tableVariant` is the FloorTable live/history
 *  variant — renamed from `variant` (2026-08-18) so the group KIND could take
 *  that name; it is forwarded verbatim and nothing about it changed. */
interface GroupRowCommon {
  /** The group's board rows, MAIN FIRST then riders — see the note above. */
  rows: FloorBoardRow[];
  /** Distinct-SKU count per orderId, for the "· {n} items" tail on each chip. */
  skuCountById: Map<number, number>;
  nowMs: number;
  open: boolean;
  onToggle: () => void;
  tableVariant: FloorTableVariant;
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
}

type GroupRowProps = GroupRowCommon &
  (
    | { variant: "free"; group: PickGroup }
    | { variant: "oil"; group: OilGroup }
  );

export function GroupRow(props: GroupRowProps) {
  const {
    group,
    rows,
    skuCountById,
    nowMs,
    open,
    onToggle,
    tableVariant,
    assignTo = null,
    onAssignGroup,
    selection,
    onToggleRow,
    onToggleAll,
    onMarkUrgent,
    onOpenDetail,
  } = props;

  const litres = sumLitres(rows);
  const routes = uniqueSorted(rows.map((r) => r.route), "No route");
  const slots = uniqueSorted(rows.map((r) => r.windowTime), "No slot");
  const others = rows.length - 1;

  // Select-all is live-only: on a history day there is nothing to hand over.
  const canSelect = tableVariant === "live" && !!onToggleAll;

  // Narrowed off `props.variant` directly (not the destructured copy, which
  // loses the discriminant link). null on a free group, so every oil-only branch
  // below is a single `oil &&`.
  const oil = props.variant === "oil" ? props.group : null;
  const free = props.variant === "free" ? props.group : null;

  // The headline name. For a free group that is the MAIN bill; for an oil group
  // it is simply the first member — a label for the block, never a claim that it
  // leads anything. `rows` is in the engine's order for both.
  const leadName =
    rows[0]?.dealerName ?? (free ? free.main.obdNumber : oil ? oil.members[0].obdNumber : "");

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
            <span className="font-medium text-gray-900">{leadName}</span>
            {others > 0 && <span className="text-gray-400"> + {others} more</span>}
          </span>
          <span className="w-[118px] shrink-0 text-[10.5px] text-gray-400">
            {litres} L &middot; {routes.length} route{routes.length === 1 ? "" : "s"}
          </span>
          <span className="w-[132px] shrink-0 truncate text-[10.5px] text-gray-400" title={slots.join(", ")}>
            {slots.join(" · ")}
          </span>
          {/* THE LABEL — one per group kind, and the SAME THREE WORDS the count
              line and the ungrouped header use. A supervisor should be able to
              read the pill, read the header, and read the count and never have
              to work out that three phrasings mean two things. The third label,
              SINGLE PICKS, belongs to the ungrouped block in floor-board.tsx.

              ⚠ NO NUMBERS IN EITHER PILL. Rule 2 has no arithmetic to offer —
              its old "saves N · costs M" measured riders against a main and
              there is no main any more. Rule 1 still HAS a real number
              (`savedTrips`), but showing it on one pill and not the other would
              make the two kinds look like different sorts of thing rather than
              two answers to the same question. The number still exists on
              PickGroup and still orders Rule 1's groups; it is simply no longer
              drawn. */}
          {free ? (
            <span className={`${CHIP} mt-0 shrink-0 bg-teal-50 text-teal-700`}>SAME MATERIAL</span>
          ) : oil ? (
            <span className={`${CHIP_OIL} mt-0 shrink-0`}>MOSTLY SAME</span>
          ) : null}
        </button>

        {/* The header's one control, in two states.
            WITH a picker chosen — one press hands the whole bundle over. The ids
            go straight to the handler, never via the selection state, so the
            write cannot post a stale set (see bulkAssign's explicitIds note).
            WITHOUT one — select only, routed through the SAME per-group
            toggleAll the table's header checkbox uses (lib/floor/selection.ts),
            so the two controls can never disagree and a second press clears the
            group exactly like the checkbox does.

            IDENTICAL for both kinds on purpose: same explicit-id path, same
            handler, no new write path and no API change for oil groups. */}
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

      {/* THE HONEST LINE. An oil bundle earns its place on the premise that the
          extra shelves are near the ones he is already walking — and sometimes
          they are not. Saying so is the whole point: he decides, and he can only
          decide if he is told. One quiet grey line, no red, no badge, no block —
          this is information, not an error. Rendered collapsed as well as open,
          because the decision to expand is itself a decision. */}
      {oil && oil.hasNonOil && (
        <div
          className={`border-b border-[#f0f0f0] px-3.5 pb-2 pl-[92px] text-[10.5px] leading-relaxed text-gray-500 ${
            open ? "bg-[#fafafa]" : "bg-white"
          }`}
        >
          Some items here are outside the oil paint area
        </div>
      )}

      {open && (
        <FloorTable
          rows={rows}
          nowMs={nowMs}
          variant={tableVariant}
          selection={selection}
          onToggleRow={onToggleRow}
          onToggleAll={onToggleAll}
          onMarkUrgent={onMarkUrgent}
          onOpenDetail={onOpenDetail}
          showSlot
          /* ⚠ NO chipFor ON AN OIL GROUP — `chipFor` is optional on FloorTable,
             so omitting it renders no chip at all, which is the correct answer
             rather than an empty one. Every per-row chip this component can draw
             (MAIN BILL, FREE, "+N steps · shares M") describes a bill's position
             RELATIVE TO A MAIN. An oil group has no main; drawing any of them
             would assert a relationship that does not exist, and "MAIN BILL" on
             an arbitrary first member is the worst of the three because it is
             the one the operator would believe. */
          chipFor={
            free
              ? (row) => {
                  const items = skuCountById.get(row.orderId) ?? 0;
                  const isMain = row.orderId === free.main.orderId;
                  // Exactly ONE chip per row. No "other area" chip — the Route
                  // column already carries that, and a second chip would say it
                  // twice.
                  return (
                    <div>
                      <span className={isMain ? CHIP_GREY : CHIP_TEAL}>
                        {isMain ? "MAIN BILL" : "FREE"} &middot; {items} item{items === 1 ? "" : "s"}
                      </span>
                    </div>
                  );
                }
              : undefined
          }
        />
      )}
    </>
  );
}
