"use client";

import { useMemo } from "react";
import { sortPackLabels } from "@/lib/picking/pack-sort";
import { CARD_PAD, CARD_SURFACE, MUTED_NOTE, ROW_HAIRLINE, UNIT_SUFFIX } from "./spine";
import type { CiBillLine, CiDetailLine } from "@/lib/ci/types";

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
      <p className={MUTED_NOTE + " text-center py-10"}>
        This bill has no active lines.
      </p>
    );
  }
  if (visible.length === 0) {
    return <p className={MUTED_NOTE + " text-center py-10"}>No lines match.</p>;
  }

  return (
    <div className={CARD_SURFACE}>
      {visible.map((line, i) => {
        // On Full bill every line is back in full; on Part, only what he entered.
        const qty = mode === "full" ? line.deliveryQty : (returned.get(line.rawLineItemId) ?? null);
        return (
          <CiLineRow
            key={line.rawLineItemId}
            skuCode={line.skuCode}
            description={line.description}
            pack={line.pack}
            qty={qty}
            deliveryQty={line.deliveryQty}
            // ⚠ ON FULL BILL THE ROW IS NOT TAPPABLE — omitting onClick renders
            // a <div>. There is nothing to decide: every line comes back at its
            // delivered quantity and the SERVER computes that list, so a
            // tappable row would be a control that changes nothing.
            onClick={mode === "full" ? undefined : () => onOpenLine(line)}
            last={i === visible.length - 1}
          />
        );
      })}
    </div>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE ONE CI LINE ROW. THERE WAS A SECOND ONE; IT IS GONE (step 14).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Until now the same CI line rendered two different ways: this file drew a
 * FLOATING WHITE CARD with a 56px pack gutter down its left edge, while
 * components/ci/submitted-detail.tsx drew a full-bleed row with the pack folded
 * into the description line. Same data, two components, and they had already
 * drifted — the gutter version also sat inset from the screen edge while every
 * other row on the screen ran to the 16px gutter, so the line list visibly did
 * not line up with the card above it.
 *
 * 🔴 THE FULL-BLEED ROW SURVIVED, and the reason is not preference. These
 * screens are made of ROWS on a spine (spine.tsx): one card surface, hairlines
 * between, every label on one left edge and every value ending on one right
 * edge. A floating card with its own shadow, its own radius and its own gutter
 * is a different KIND of object — it was picking's card, correctly copied into a
 * screen that has since stopped being picking's board. The pack moved inline
 * beside the description, where it reads as what it is: a qualifier on the SKU,
 * not a column.
 *
 * ⚠ TAPPABLE IS A PROP, NOT A SECOND COMPONENT. `onClick` omitted renders a
 * <div>; supplied renders a <button>. That is the ONLY structural difference
 * between an editable line and a read one, and it is the whole of it.
 *
 * ⚠ WHAT SURVIVED FROM THE CARD, because it is behaviour and not decoration:
 *   • the untouched dash — an unpicked Part line shows "—", never "0". Nothing
 *     has been decided about it, and 0 claims "none came back", which is a
 *     different statement.
 *   • the PARTIAL treatment — red, with "of 8" underneath. Some came back and
 *     not all is the one state a checker has to look at twice, and the "of N"
 *     appears ONLY there, where it says something the number above does not.
 *   • the 26px/800 quantity. Picking's, and one of the only two things in this
 *     module that carries real weight.
 */
export function CiLineRow({
  skuCode,
  description,
  pack,
  qty,
  deliveryQty,
  litres,
  onClick,
  last = false,
}: {
  skuCode: string;
  /** Null is NORMAL — ~5.9% of active lines resolve in neither catalog table.
   *  The bare code stands and the name is absent; never an error treatment. */
  description: string | null;
  pack: string | null;
  /** null = UNTOUCHED (a Part line he has not picked). Renders the dash. */
  qty: number | null;
  /** What SAP delivered. Enables the partial treatment when qty is below it;
   *  pass null where the comparison is meaningless. */
  deliveryQty: number | null;
  /** Shown under the quantity when present. The submitted screens carry it
   *  (it is stored on the line); the bill screen has nothing to show yet. */
  litres?: number | null;
  /** Omitted ⇒ a <div>. Supplied ⇒ a <button>. */
  onClick?: () => void;
  last?: boolean;
}): React.JSX.Element {
  const touched = qty !== null;
  const partial = qty !== null && deliveryQty !== null && qty < deliveryQty;

  const cls =
    CARD_PAD +
    " py-2.5 flex items-center gap-3 w-full text-left " +
    (last ? "" : ROW_HAIRLINE);

  const inner = (
    <>
      <span className={"min-w-0 flex-1 " + (touched ? "" : "opacity-55")}>
        {/* The SKU is the loudest thing in the list — picking's mono 17/700. */}
        <span className="block font-mono text-[17px] font-bold text-gray-900 truncate">
          {skuCode}
        </span>
        {/* PACK INLINE, ahead of the name: it is a qualifier on the code, and a
            56px column of it was competing with the code it qualifies. */}
        <span className="block text-[12px] text-gray-500 truncate mt-0.5">
          {[pack, description].filter(Boolean).join(" · ") || "—"}
        </span>
      </span>
      <span className="shrink-0 flex flex-col items-end">
        <span
          className={
            "text-[26px] font-extrabold tabular-nums leading-none " +
            (partial ? "text-[#b42318]" : touched ? "text-gray-900" : "text-[#b6bcc6]")
          }
        >
          {qty ?? "—"}
        </span>
        {partial ? (
          <span className="text-[10.5px] font-medium text-[#98a2b3] tabular-nums leading-none mt-[3px]">
            of {deliveryQty}
          </span>
        ) : (
          litres !== undefined &&
          litres !== null && (
            /* ZERO renders "0 L" — brushes and rollers have a real volume of
               nothing, and blanking those would claim "unknown" about a known
               thing. Only a NULL litresPerTin is genuinely unknown. */
            <span className={UNIT_SUFFIX + " tabular-nums leading-none mt-[3px]"}>
              {litres} L
            </span>
          )
        )}
      </span>
    </>
  );

  if (onClick === undefined) return <div className={cls}>{inner}</div>;
  return (
    <button type="button" onClick={onClick} className={cls + " active:bg-gray-50"}>
      {inner}
    </button>
  );
}

/** The rows of a SAVED CI — its stored snapshot, not the bill behind it. */
export function CiDetailLineRows({
  lines,
}: {
  lines: readonly CiDetailLine[];
}): React.JSX.Element {
  return (
    <div className={CARD_SURFACE}>
      {lines.map((l, i) => (
        <CiLineRow
          key={l.id}
          skuCode={l.skuCode}
          description={l.skuDescription}
          pack={l.packCode}
          qty={l.returnedQty}
          // ⚠ NO PARTIAL TREATMENT ON A SAVED CI. `deliveryQty` is passed as null
          // deliberately: "3 of 8" is a decision being made, and on a submitted
          // return the decision is finished. The litres take that slot instead.
          deliveryQty={null}
          litres={l.returnedQtyLitres}
          last={i === lines.length - 1}
        />
      ))}
    </div>
  );
}
