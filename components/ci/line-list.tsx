"use client";

import { useMemo } from "react";
import { sortPackLabels } from "@/lib/picking/pack-sort";
import type { CiBillLine } from "@/lib/ci/types";

// The supervisor's line list — COPIED from picking's detail screen, not
// approximated. Every className, padding, radius, size, weight and colour below
// is lifted verbatim from components/picking/picking-board-mobile.tsx's line
// item (its `w-14 shrink-0 bg-[#f8fafa]` pack tile block), so the two screens
// are the same layout rather than two dialects of it.
//
// ⚠ COPIED, NOT IMPORTED — and that is the module convention, not laziness.
// components/mrn/line-list.tsx's header states it: picking does not export its
// row, and MRN carries its own copy for the same reason picker-my-picks-board
// carries one. TOKENS, NOT RULES. MRN's row is additionally module-private and
// typed on MrnDetailLine, so importing it was never an option either.
//
// The one thing that IS imported is `sortPackLabels` — that is a RULE, not a
// token. Alphabetical would put "100ML" before "1L" because "0" < "L".
//
// WHAT CI KEEPS THAT MRN DROPPED:
//   • the DESCRIPTION line under the SKU. Picking has it, MRN removed it (its
//     supervisor matches a code against a pallet); the CI mockup shows it, and
//     a returning dealer's goods are identified by name as often as by code.
//
// WHAT CI ADDS, INSIDE PICKING'S STRUCTURE — never around it:
//   • a tap target and a returned-quantity state, because a CI line is a
//     decision ("did this come back, and how much?") where picking's is a fact.
//     Rendered in the SAME right-hand column picking puts its quantity in — no
//     new column, no new width.
//
// ⚠️ Ordering is the BILL's, which is the order SAP sent the lines. Never sort
// returned rows to the top.

// Duplicated from picking-board-mobile.tsx, which does not export it — the same
// way picker-my-picks-board.tsx and components/mrn/line-list.tsx carry their own
// copies. A token, not a rule.
const SOFT_CARD_SHADOW = "0 1px 2px rgba(16,25,29,0.04), 0 3px 12px rgba(16,25,29,0.05)";
const NO_PACK_KEY = "__no_pack__";

/** Distinct pack keys, ordered by the SHARED sorter — never alphabetically. */
export function useDistinctPackKeys(lines: readonly CiBillLine[]): string[] {
  return useMemo(() => {
    const set = new Set<string>();
    for (const l of lines) set.add(l.pack ?? NO_PACK_KEY);
    const keys = Array.from(set);
    const real = sortPackLabels(keys.filter((k) => k !== NO_PACK_KEY));
    return keys.includes(NO_PACK_KEY) ? [...real, NO_PACK_KEY] : real;
  }, [lines]);
}

export function filterLinesByPack(
  lines: readonly CiBillLine[],
  activePackFilter: string,
): CiBillLine[] {
  if (activePackFilter === "ALL") return [...lines];
  return lines.filter((l) => (l.pack ?? NO_PACK_KEY) === activePackFilter);
}

// ── The pack-chip strip ──────────────────────────────────────────────────────

/**
 * 🔴 PART ONLY. The mockup renders no chip row at all on Full bill, and that is
 * a rule rather than a layout accident: on Full bill every line is already
 * returned at its delivered quantity and nothing is tappable, so a filter would
 * narrow a list the supervisor cannot act on.
 *
 * 🔴 AND ONLY AT 2+ DISTINCT PACKS — CLAUDE_PICKING.md §7's rule, carried over
 * rather than re-derived. A single-pack bill shows no chips, because there is
 * nothing to filter between.
 *
 * ⚠ WRAPS, NEVER SCROLLS. Picking deliberately moved off an overflow-x strip on
 * 2026-08-20 and its source says it "must not go back" — chips past the right
 * edge sat behind a drag the operator had no reason to believe in.
 */
export function CiPackChips({
  lines,
  activePackFilter,
  onPackFilter,
}: {
  lines: readonly CiBillLine[];
  activePackFilter: string;
  onPackFilter: (key: string) => void;
}): React.JSX.Element | null {
  const distinctPackKeys = useDistinctPackKeys(lines);
  if (distinctPackKeys.length < 2) return null;

  return (
    <div className="bg-white border-b border-gray-200 shrink-0 px-3.5 py-2.5 flex items-center flex-wrap gap-1.5">
      <PackChip active={activePackFilter === "ALL"} onClick={() => onPackFilter("ALL")}>
        All
      </PackChip>
      {distinctPackKeys.map((key) => (
        <PackChip
          key={key}
          active={activePackFilter === key}
          onClick={() => onPackFilter(key)}
        >
          {key === NO_PACK_KEY ? "No pack" : key}
        </PackChip>
      ))}
    </div>
  );
}

/** Picking's chip, verbatim. */
function PackChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "text-[12.5px] font-medium px-3 py-[7px] rounded-full border whitespace-nowrap shrink-0 " +
        (active
          ? "bg-[#2a323c] border-[#2a323c] text-white font-semibold"
          : "bg-white border-gray-200 text-[#6b7480]")
      }
    >
      {children}
    </button>
  );
}

// ── The rows ─────────────────────────────────────────────────────────────────

export function CiLineRows({
  lines,
  activePackFilter,
  mode,
  returned,
  onOpenLine,
}: {
  lines: readonly CiBillLine[];
  activePackFilter: string;
  mode: "full" | "part";
  /** rawLineItemId → tins coming back. Empty on Full bill. */
  returned: Map<number, number>;
  onOpenLine: (line: CiBillLine) => void;
}): React.JSX.Element {
  // 🔴 NO PACK FILTER ON FULL BILL. CiPackChips does not render there, so an
  // `activePackFilter` left over from a previous Part session must not silently
  // hide lines the supervisor is about to return in full.
  const visible =
    mode === "full" ? [...lines] : filterLinesByPack(lines, activePackFilter);

  if (lines.length === 0) {
    return (
      <p className="text-[13px] text-gray-400 text-center py-10">
        This bill has no active lines.
      </p>
    );
  }
  if (visible.length === 0) {
    return <p className="text-[13px] text-gray-400 text-center py-10">No lines match.</p>;
  }

  return (
    <>
      {visible.map((line) => (
        <CiLineRow
          key={line.rawLineItemId}
          line={line}
          mode={mode}
          returnedQty={returned.get(line.rawLineItemId) ?? null}
          onClick={() => onOpenLine(line)}
        />
      ))}
    </>
  );
}

/**
 * ONE white rounded card — picking's card, matched:
 *
 *   [ full-height pack panel | divider ] [ mono SKU ] [ qty ]
 *                                        [ description ]
 *
 * ⚠ ON FULL BILL THE ROW IS NOT TAPPABLE and renders as a plain <div>, exactly
 * as picking's does. There is nothing to decide: every line comes back at its
 * delivered quantity, and the SERVER computes that list (the client sends no
 * pairs at all). A tappable row here would be a control that changes nothing.
 *
 * ⚠ ON PART it is a <button>, and:
 *
 * 🔴 `items-stretch` IS LOAD-BEARING, AND IT IS HERE BECAUSE THIS IS A
 * <button> WHERE PICKING USES A <div>. Tailwind's `flex` sets display only; the
 * initial `align-items: stretch` is what makes the pack panel fill the card. A
 * <div> gets that initial value — a <button> does NOT, because the UA stylesheet
 * supplies its own align-items for buttons. That is why the panel rendered short
 * with white above and below it in MRN, which hit this exact bug. CI needs the
 * button for tappability and a11y, so the alignment has to be stated.
 */
function CiLineRow({
  line,
  mode,
  returnedQty,
  onClick,
}: {
  line: CiBillLine;
  mode: "full" | "part";
  returnedQty: number | null;
  onClick: () => void;
}): React.JSX.Element {
  // On Full bill every line is back in full; on Part, only what he entered.
  const qty = mode === "full" ? line.deliveryQty : returnedQty;
  const touched = mode === "full" || returnedQty !== null;
  // Partial return — some came back, not all. The mockup marks this red: it is
  // the one state a checker has to look at twice.
  const partial =
    mode === "part" && returnedQty !== null && returnedQty < line.deliveryQty;

  const inner = (
    <>
      {/* PACK PANEL — picking verbatim. Fixed 56px WIDE, FULL CARD HEIGHT via
          items-stretch above. It carries NO height and NO vertical margin on
          purpose — either would stop it filling. Slate when known, muted
          em-dash when missing; never an error style. This column is what makes
          packs align down the left edge and must not flex. */}
      <span className="w-14 shrink-0 bg-[#f8fafa] border-r border-gray-200 flex items-center justify-center px-1 py-2.5">
        <span
          className="text-[13px] font-bold text-center"
          style={{ color: line.pack !== null ? "#3d4650" : "#9ca3af" }}
        >
          {line.pack ?? "—"}
        </span>
      </span>

      {/* BODY — SKU loudest, product name muted underneath. Picking's exact two
          lines. An unmastered code (~5.9% of active lines) shows the em-dash and
          stays fully returnable — never an error treatment. */}
      <span
        className={
          "flex-1 min-w-0 px-3 py-2.5 flex flex-col justify-center transition-opacity " +
          (mode === "part" && returnedQty === null ? "opacity-55" : "")
        }
      >
        <span className="block font-mono text-[17px] font-bold text-gray-900 truncate">
          {line.skuCode}
        </span>
        <span className="block text-[12px] text-gray-500 truncate mt-0.5">
          {line.description ?? "—"}
        </span>
      </span>

      {/* QTY — picking's column verbatim: shrink-0, px-3.5, ONE centred value.
          Untouched Part lines show the mockup's dash rather than a 0: nothing
          has been decided about them yet, and a 0 would read as "none came
          back", which is a different claim. */}
      <span className="shrink-0 flex flex-col items-center justify-center px-3.5">
        <span
          className={
            "text-[26px] font-extrabold tabular-nums " +
            (partial ? "text-[#b42318]" : touched ? "text-gray-900" : "text-[#b6bcc6]")
          }
        >
          {qty ?? "—"}
        </span>
        {/* "of 8" only where it says something the number above does not — a
            partial return. On a full line it would repeat the same figure. */}
        {partial && (
          <span className="text-[10.5px] font-medium text-[#98a2b3] tabular-nums leading-none mt-[1px]">
            of {line.deliveryQty}
          </span>
        )}
      </span>
    </>
  );

  const shared =
    "flex items-stretch min-h-[64px] bg-white rounded-[14px] overflow-hidden mb-2 w-full text-left";

  if (mode === "full") {
    return (
      <div className={shared} style={{ boxShadow: SOFT_CARD_SHADOW }}>
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={shared + " active:opacity-90"}
      style={{ boxShadow: SOFT_CARD_SHADOW }}
    >
      {inner}
    </button>
  );
}
