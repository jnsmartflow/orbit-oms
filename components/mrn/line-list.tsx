"use client";

import { useMemo } from "react";
import { sortPackLabels } from "@/lib/picking/pack-sort";
import type { MrnDetail, MrnDetailLine } from "@/lib/mrn/types";
import { formatIstTime, formatMonthYear } from "./format";

// The supervisor's line list — COPIED from picking's detail screen, not
// approximated. Every className, padding, radius, size, weight and colour below
// is lifted verbatim from components/picking/picking-board-mobile.tsx's stat
// band and line-item card, so the two screens are the same layout rather than
// two dialects of it.
//
// ⚠️ THIS SUPERSEDES THE APPROVED MOCKUP (02-supervisor-mobile.html S5), which
// drew MRN's own row shape. Hand-testing on a real phone replaced it with
// picking's, which the floor team already reads daily. Do not restore the
// mockup's row; the mockup is stale on this point, deliberately.
//
// WHAT MRN ADDS, INSIDE PICKING'S STRUCTURE — never around it:
//   • the qty goes RED when physical ≠ STI. Picking has one number and so has
//     nothing to disagree with. The column is otherwise picking's exactly: one
//     centred value, no sub-label.
//   • a confirmed row grows a second line under the SKU carrying the
//     manufacturing dates it recorded.
//
// WHAT MRN DROPS FROM PICKING'S ROW, on purpose:
//   • the TICK CIRCLE. A picker can genuinely tick a line from picking's list;
//     a supervisor cannot — confirming an MRN line needs a quantity and
//     manufacturing dates, which only the sheet can take. See LineRow.
//   • the DESCRIPTION. The row is the mono SKU he matches against the shelf;
//     the product name is the sheet's title, where he confirms he opened the
//     right one.
//
// ⚠️ Ordering is the STI's, which is the order the pallets come off the truck.
// Never sort confirmed rows to the bottom.

// Duplicated from picking-board-mobile.tsx, which does not export them — the
// same way picker-my-picks-board.tsx carries its own copies. Tokens, not rules.
const SOFT_CARD_SHADOW = "0 1px 2px rgba(16,24,40,0.04), 0 3px 12px rgba(16,24,40,0.05)";
const NO_PACK_KEY = "__no_pack__";

/** Distinct pack keys, ordered by the SHARED sorter — never alphabetically,
 *  which would put "100ML" before "1L" because "0" < "L". */
export function useDistinctPackKeys(lines: readonly MrnDetailLine[]): string[] {
  return useMemo(() => {
    const set = new Set<string>();
    for (const l of lines) set.add(l.pack ?? NO_PACK_KEY);
    const keys = Array.from(set);
    const real = sortPackLabels(keys.filter((k) => k !== NO_PACK_KEY));
    return keys.includes(NO_PACK_KEY) ? [...real, NO_PACK_KEY] : real;
  }, [lines]);
}

export function filterLinesByPack(
  lines: readonly MrnDetailLine[],
  activePackFilter: string,
): MrnDetailLine[] {
  if (activePackFilter === "ALL") return [...lines];
  return lines.filter((l) => (l.pack ?? NO_PACK_KEY) === activePackFilter);
}

// ── The band ────────────────────────────────────────────────────────────────

/**
 * 🔴 ATTACHED, NOT FLOATING. Picking's stat strip is a SOLID WHITE BAND:
 * full-bleed to both edges, flush under the teal header, no top margin, no
 * rounding, `border-b border-gray-200`, with the grey list starting beneath it.
 * MRN's progress strip and pack chips used to float on the grey page with
 * margins and rounded corners, which is the difference this fixes.
 *
 * It is rendered as a `shrink-0` SIBLING of the scroll area — never inside it —
 * because that is the only way it can be full-bleed while the list below keeps
 * its px-3 gutter. Same arrangement as picking.
 *
 * Picking's band:  bg-white border-b border-gray-200 px-[14px] py-3 flex items-center justify-between gap-3 shrink-0
 * This band:       the same, with the chip row as a second row INSIDE it, so
 *                  the whole thing reads as one white region with one bottom
 *                  border rather than two stacked bands.
 */
export function MrnLineBand({
  detail,
  activePackFilter,
  onPackFilter,
}: {
  detail: MrnDetail;
  activePackFilter: string;
  onPackFilter: (key: string) => void;
}): React.JSX.Element {
  const distinctPackKeys = useDistinctPackKeys(detail.lines);

  const checked = detail.checkedLineCount;
  const total = detail.lineCount;
  const pct = total === 0 ? 0 : Math.round((checked / total) * 100);

  return (
    <div className="bg-white border-b border-gray-200 shrink-0">
      {/* Row 1 — picking's stat-strip padding exactly: px-[14px] py-3. */}
      <div className="px-[14px] py-3 flex items-center justify-between gap-3">
        <div className="text-[15px] font-bold leading-snug shrink-0" style={{ color: "#2a323c" }}>
          {checked}
          <span className="font-semibold" style={{ color: "#8a929c" }}>
            {" "}
            of {total}
          </span>
        </div>
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-green-500 transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
        {detail.issueLineCount > 0 ? (
          <div className="text-[11.5px] font-semibold tabular-nums text-[#b42318] shrink-0">
            {detail.issueLineCount} issue{detail.issueLineCount === 1 ? "" : "s"}
          </div>
        ) : (
          <div className="text-[11.5px] text-gray-400 tabular-nums shrink-0">
            started {formatIstTime(detail.unloadingStartAt) ?? "—"}
          </div>
        )}
      </div>

      {/* Row 2 — the pack filter.
          🔴 ONLY AT 2+ DISTINCT PACKS — CLAUDE_PICKING.md §7's rule, carried
          over rather than re-derived. A single-pack MRN shows no chip row at
          all, because there is nothing to filter between.
          ⚠ WRAPS, NEVER SCROLLS. The brief asked for horizontal scrolling;
          picking deliberately moved OFF that on 2026-08-20 and its source says
          it "must not go back" — an overflow-x strip put chips past the right
          edge behind a drag the operator had no reason to believe in. Copying
          picking means copying that decision, so this wraps. Flag it if the
          scroll was wanted for a reason picking does not share.
          No NO_BILL_SWIPE_ATTR: MRN has no swipe-between-trucks gesture. */}
      {distinctPackKeys.length >= 2 && (
        <div className="px-3.5 pb-2.5 flex items-center flex-wrap gap-1.5">
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
      )}
    </div>
  );
}

/** Picking's chip, verbatim:
 *  text-[12.5px] font-medium px-3 py-[7px] rounded-full border whitespace-nowrap shrink-0
 *  active   bg-[#2a323c] border-[#2a323c] text-white font-semibold
 *  inactive bg-white border-gray-200 text-[#6b7480] */
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

// ── The rows ────────────────────────────────────────────────────────────────

export function MrnLineRows({
  detail,
  activePackFilter,
  onOpenLine,
}: {
  detail: MrnDetail;
  activePackFilter: string;
  onOpenLine: (line: MrnDetailLine, index: number) => void;
}): React.JSX.Element {
  const visible = filterLinesByPack(detail.lines, activePackFilter);

  if (detail.lines.length === 0) {
    return (
      <p className="text-[13px] text-gray-400 text-center py-10">
        Billing has not added the lines for this truck yet.
      </p>
    );
  }
  if (visible.length === 0) {
    return <p className="text-[13px] text-gray-400 text-center py-10">No lines match.</p>;
  }

  return (
    <>
      {visible.map((line) => (
        <LineRow
          key={line.id}
          line={line}
          // Position is the line's place in the WHOLE MRN, not the filtered
          // view — "line 4 of 36" must mean the same thing whichever chip is on.
          onClick={() => onOpenLine(line, detail.lines.indexOf(line) + 1)}
        />
      ))}
    </>
  );
}

/**
 * ONE white rounded card — picking's card, matched:
 *
 *   [ full-height grey gutter | divider ] [ mono SKU ] [ big qty ]
 *                                         [ mfg dates ] [ of {STI} ]
 *
 * ⚠️ THERE IS NO TICK CIRCLE, AND ADDING ONE BACK WOULD BE A LIE. The
 * supervisor cannot mark a line done from this list — confirming needs a
 * quantity and manufacturing dates, which only the sheet can take. A circle
 * here would be a control that does nothing while reading exactly like a
 * checkbox he could tap. The row has ONE action: open me. (Picking's rows DO
 * carry a tick because a picker genuinely can tick a line from the list; the
 * layouts match, the affordances differ, and that difference is deliberate.)
 *
 * ⚠️ NO DESCRIPTION EITHER. The row is the mono SKU code and nothing else —
 * that is what he matches against the shelf. The product name is the sheet's
 * title, which is where he confirms he opened the right one.
 *
 * ⚠️ CHECKED STATE IS CARRIED BY DATA, NOT A BADGE. A confirmed row mutes AND
 * grows a second line showing the manufacturing dates it recorded. An unchecked
 * row has nothing true to put there, so it stays a single line. Row heights
 * therefore differ between the two states — INTENDED, not a layout bug: the
 * taller rows are the finished ones, and scanning the list tells him both what
 * is done and what he actually wrote down.
 *
 * ── 320px budget (every column shrink-0 or min-w-0) ─────────────────────────
 *   pack   56px  (w-14)
 *   qty    ~75px (px-3.5 = 28px + ~47px for three digits at 26px)
 *   body   320 − 131 = 189px outer, ~165px of text after px-3
 * The SKU line `truncate`s inside a `min-w-0` flex child. Dropping the tick
 * column returned 44px to the text, so the longest SAP code (IN28129271, ~102px
 * at 17px mono bold) now clears comfortably at 320px. At 390px: ~235px.
 */
function LineRow({
  line,
  onClick,
}: {
  line: MrnDetailLine;
  onClick: () => void;
}): React.JSX.Element {
  const done = line.isChecked;
  const differs = done && line.physicalQty !== null && line.physicalQty !== line.qtySti;

  // The second line, and the ONLY thing that marks a row as done besides the
  // mute. A split line shows every batch — "06/26 · 30  +  07/26 · 16" — so the
  // split is readable without reopening the sheet.
  const batchText =
    line.batches.length === 0
      ? null
      : line.batches.length === 1
        ? formatMonthYear(line.batches[0].mfgMonth, line.batches[0].mfgYear)
        : line.batches
            .map((b) => `${formatMonthYear(b.mfgMonth, b.mfgYear)} · ${b.qty}`)
            .join("  +  ");

  const issue =
    line.shortQty > 0
      ? `Short ${line.shortQty}`
      : line.excessQty > 0
        ? `Excess ${line.excessQty}`
        : (line.leakyQty ?? 0) > 0
          ? `Leaky ${line.leakyQty}`
          : (line.damageQty ?? 0) > 0
            ? `Damage ${line.damageQty}`
            : (line.emptyQty ?? 0) > 0
              ? `Empty ${line.emptyQty}`
              : null;

  // Only ever populated on a checked row — an unchecked line has no batches and
  // derives no issue, so this is null and the row stays one line high.
  const showSecondLine = done && (batchText !== null || issue !== null);

  return (
    // Picking's card: flex bg-white rounded-[14px] overflow-hidden mb-2 + shadow.
    //
    // 🔴 `items-stretch` IS LOAD-BEARING, AND IT IS HERE BECAUSE THIS IS A
    // <button> WHERE PICKING USES A <div>. Tailwind's `flex` sets display only;
    // the initial `align-items: stretch` is what makes the pack gutter fill the
    // card. A <div> gets that initial value — a <button> does NOT, because the
    // UA stylesheet supplies its own align-items for buttons, and nothing here
    // overrode it. That is why the gutter rendered short with white card above
    // and below it despite the classNames matching picking exactly. MRN needs
    // the button for tappability and a11y, so the alignment has to be stated.
    //
    // min-h-[64px] gives a one-line row presence. Picking's two-line row
    // measures ~66px (py-2.5 = 20px + a 17px SKU at 1.5 = 25.5px + mt-0.5 = 2px
    // + a 12px description at 1.5 = 18px); without a floor an unchecked MRN row
    // is only ~45px and reads squeezed. A CHECKED row grows past this on its
    // own (~65px with the mfg-date line), so the minimum never fights it.
    <button
      type="button"
      onClick={onClick}
      className="flex items-stretch min-h-[64px] bg-white rounded-[14px] overflow-hidden mb-2 w-full text-left active:opacity-90"
      style={{ boxShadow: SOFT_CARD_SHADOW }}
    >
      {/* PACK GUTTER — picking verbatim. Fixed 56px WIDE, FULL CARD HEIGHT via
          the card's items-stretch above. It carries NO height and NO vertical
          margin on purpose — either would stop it filling. `items-center` here
          is a DIFFERENT element from the card's alignment: it centres the pack
          LABEL inside the full-height block. Do not confuse the two.
          Slate when known, muted em-dash when missing — never an error style.
          This column is what makes packs align down the left edge; it must not
          flex. */}
      <span className="w-14 shrink-0 bg-[#f8fafa] border-r border-gray-200 flex items-center justify-center px-1 py-2.5">
        <span
          className="text-[13px] font-bold text-center"
          style={{ color: line.pack !== null ? "#3d4650" : "#9ca3af" }}
        >
          {line.pack ?? "—"}
        </span>
      </span>

      {/* BODY — the SKU, and on a checked row the dates beneath it. Mutes once
          confirmed: no ring, no left border, just a quiet row. */}
      <span
        className={
          "flex-1 min-w-0 px-3 py-2.5 flex flex-col justify-center transition-opacity " +
          (done ? "opacity-55" : "")
        }
      >
        <span className="block font-mono text-[17px] font-bold text-gray-900 truncate">
          {line.skuCode}
        </span>
        {showSecondLine && (
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-gray-500">
            {batchText && <span className="tabular-nums">{batchText}</span>}
            {batchText && issue && <span className="text-[#d8dce1]">·</span>}
            {issue && <span className="font-semibold text-[#b42318]">{issue}</span>}
          </span>
        )}
      </span>

      {/* QTY — picking's column verbatim: shrink-0, px-3.5, ONE centred value.
          ⚠ The "of {STI}" sub-label was dropped (owner's call). On an unchecked
          row it repeated the number directly above it, and on a checked row the
          second line already says "Short 3" whenever the two differ — so the
          STI figure is not lost, it just stops being shouted twice.
          Unchecked shows the STI qty; checked shows what he actually counted,
          red when that differs. `physicalQty` is null until confirmed, so the
          coalesce below IS that switch. */}
      <span className="shrink-0 flex items-center justify-center px-3.5">
        <span
          className={
            "text-[26px] font-extrabold tabular-nums " +
            (differs ? "text-[#b42318]" : done ? "text-[#b6bcc6]" : "text-gray-900")
          }
        >
          {line.physicalQty ?? line.qtySti}
        </span>
      </span>
    </button>
  );
}
