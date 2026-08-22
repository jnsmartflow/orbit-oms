"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { sortPackLabels } from "@/lib/picking/pack-sort";
import type { MrnDetail, MrnDetailLine } from "@/lib/mrn/types";
import { formatIstTime, formatMonthYear } from "./format";

// The line list inside the supervisor's detail screen.
//
// ⚠️ THIS SUPERSEDES THE APPROVED MOCKUP (docs/mockups/mrn/02-supervisor-mobile.html
// S5). The mockup drew MRN's own row dialect. Hand-testing on a real phone
// replaced it with the PICKING detail row, verbatim — pack tile, mono SKU hero,
// muted description, big right-aligned qty, and the pack-filter chips above the
// list. The floor team already reads that layout every day on /picking, and a
// second dialect for the same job is a cost with no payer. Do NOT restore the
// mockup's row shape; the mockup is stale on this point, deliberately.
//
// ⚠️ THE TRUCK-FACTS CARD IS GONE TOO (mockup S4) — see supervisor-board.tsx.
// The progress strip below is the only header data that survived, because it is
// the only part he uses while counting.
//
// What MRN keeps that picking has no equivalent for:
//   • the TICK CIRCLE, leading the row — picking's tick sits in a right-hand
//     gutter because its rows are tapped to record a finding; here the tick IS
//     the line's state and reads first.
//   • the qty as `32` over `of 32` — physical over STI, red when they differ.
//     Picking shows one number because a bill line has only one.
//   • a ticked row mutes, so his eye skips it. The unmuted rows ARE the
//     remaining work.
//
// ⚠️ Ordering is the STI's, which is the order the pallets come off the truck.
// Never sort ticked rows to the bottom.

// Both duplicated from components/picking/picking-board-mobile.tsx, which does
// not export them — the same way picker-my-picks-board.tsx carries its own
// copies. They are tokens, not rules: the RULE that matters (chips only at 2+
// distinct packs) is CLAUDE_PICKING.md §7's and is applied below, not re-derived.
const SOFT_CARD_SHADOW = "0 1px 2px rgba(16,24,40,0.04), 0 3px 12px rgba(16,24,40,0.05)";
const NO_PACK_KEY = "__no_pack__";

interface LineListProps {
  detail: MrnDetail;
  onOpenLine: (line: MrnDetailLine, index: number) => void;
}

export function LineList({ detail, onOpenLine }: LineListProps): React.JSX.Element {
  const [activePackFilter, setActivePackFilter] = useState<string>("ALL");

  const checked = detail.checkedLineCount;
  const total = detail.lineCount;
  const pct = total === 0 ? 0 : Math.round((checked / total) * 100);

  // Sorted by the SHARED sorter (lib/picking/pack-sort.ts), never alphabetically
  // — "100ML" would otherwise sort before "1L" because "0" < "L".
  const distinctPackKeys = useMemo(() => {
    const set = new Set<string>();
    for (const l of detail.lines) set.add(l.pack ?? NO_PACK_KEY);
    const keys = Array.from(set);
    const real = sortPackLabels(keys.filter((k) => k !== NO_PACK_KEY));
    return keys.includes(NO_PACK_KEY) ? [...real, NO_PACK_KEY] : real;
  }, [detail.lines]);

  const visibleLines = useMemo(() => {
    if (activePackFilter === "ALL") return detail.lines;
    return detail.lines.filter((l) => (l.pack ?? NO_PACK_KEY) === activePackFilter);
  }, [detail.lines, activePackFilter]);

  return (
    <>
      {/* ── Progress strip — the one piece of header data that survived ────
          Count, bar, and the start time: what he glances at between pallets.
          The right slot flips to the issue count once there is one, because by
          then "how many are wrong" outranks "when did I start". */}
      <div className="flex items-center gap-3 px-1 pb-3">
        <div className="shrink-0 text-[12.5px] text-[#667085]">
          <b className="text-[#1d2939]">{checked}</b> of {total}
        </div>
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-green-500 transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
        {detail.issueLineCount > 0 ? (
          <div className="shrink-0 text-[12.5px] font-semibold text-[#b42318]">
            {detail.issueLineCount} issue{detail.issueLineCount === 1 ? "" : "s"}
          </div>
        ) : (
          <div className="shrink-0 text-[12.5px] text-[#667085]">
            started <b className="text-[#1d2939]">{formatIstTime(detail.unloadingStartAt) ?? "—"}</b>
          </div>
        )}
      </div>

      {/* ── Pack filter ─────────────────────────────────────────────────────
          🔴 ONLY AT 2+ DISTINCT PACKS — CLAUDE_PICKING.md §7's rule, carried
          over rather than re-derived. A single-pack MRN shows no chip row at
          all, because there is nothing to filter between. It has been reported
          once on picking as "the pack filter is missing" and was not a bug;
          flipping it to always-show is a deliberate decision, not a patch.
          WRAPS, never scrolls — an overflow-x strip hides chips behind a drag
          the operator has no reason to believe in.
          MRN needs no NO_BILL_SWIPE_ATTR: there is no swipe-between-trucks
          gesture on this screen to protect the chips from. */}
      {distinctPackKeys.length >= 2 && (
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5">
          <PackChip active={activePackFilter === "ALL"} onClick={() => setActivePackFilter("ALL")}>
            All
          </PackChip>
          {distinctPackKeys.map((key) => (
            <PackChip
              key={key}
              active={activePackFilter === key}
              onClick={() => setActivePackFilter(key)}
            >
              {key === NO_PACK_KEY ? "No pack" : key}
            </PackChip>
          ))}
        </div>
      )}

      {visibleLines.map((line) => (
        <LineRow
          key={line.id}
          line={line}
          // Position is the line's place in the WHOLE MRN, not in the filtered
          // view — "line 4 of 36" must mean the same thing whichever chip is on.
          onClick={() => onOpenLine(line, detail.lines.indexOf(line) + 1)}
        />
      ))}

      {detail.lines.length === 0 && (
        <p className="rounded-[13px] bg-white px-3.5 py-4 text-[13px] text-gray-400">
          Billing has not added the lines for this truck yet.
        </p>
      )}
      {detail.lines.length > 0 && visibleLines.length === 0 && (
        <p className="rounded-[13px] bg-white px-3.5 py-4 text-[13px] text-gray-400">
          No lines match.
        </p>
      )}
    </>
  );
}

/**
 * One line — picking's detail row, matched.
 *
 * ── 320px BUDGET (computed, and every column is shrink-0 or min-w-0) ────────
 *   tick    36px  (w-9, holding a 22px circle)
 *   pack    56px  (w-14 — picking's exact tile)
 *   qty     ~72px (px-3 = 24px + ~48px for four digits at 22px)
 *   ────────────
 *   body    320 − 164 = 156px, less px-3 = ~132px of text
 * Both text lines carry `truncate` inside a `min-w-0` flex child, so they
 * ellipsis rather than push; the qty column is `shrink-0` with
 * `whitespace-nowrap`, so it can neither wrap nor be squeezed. At 390px the
 * body gets ~202px.
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

  // A split line shows BOTH batches inline — "06/26 · 9 + 07/26 · 6" — so the
  // split is readable without opening the sheet.
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

  return (
    // Tap ANYWHERE on the row — a 22px circle is not a target on a warehouse
    // floor. Picking's card geometry: flex, rounded-[14px], overflow-hidden.
    <button
      type="button"
      onClick={onClick}
      className="mb-2 flex w-full overflow-hidden rounded-[14px] bg-white text-left active:opacity-90"
      style={{ boxShadow: SOFT_CARD_SHADOW }}
    >
      {/* TICK — MRN's own, leading the row. Full card height so it reads as a
          column rather than a floating dot. */}
      <span className="flex w-9 shrink-0 items-center justify-center border-r border-gray-100">
        <span
          className={
            "flex h-[22px] w-[22px] items-center justify-center rounded-full " +
            (done ? "bg-green-500" : "border-2 border-gray-200")
          }
        >
          {done && <Check size={13} strokeWidth={3.2} className="text-white" />}
        </span>
      </span>

      {/* PACK TILE — picking's exact treatment: 56px, full height, #f8fafa,
          right border, 13px bold, slate when known and a muted em-dash when
          not (never an error style). This column is what makes packs align
          down the left edge — it must not flex. */}
      <span className="flex w-14 shrink-0 items-center justify-center border-r border-gray-200 bg-[#f8fafa] px-1 py-2.5">
        <span
          className="text-center text-[13px] font-bold"
          style={{ color: line.pack !== null ? "#3d4650" : "#9ca3af" }}
        >
          {line.pack ?? "—"}
        </span>
      </span>

      {/* BODY — SKU is the loudest thing on the card; the product name is muted
          confirmation underneath. Mutes once ticked: no ring, no left border,
          just a quiet row. */}
      <span
        className={
          "min-w-0 flex-1 px-3 py-2.5 transition-opacity " + (done ? "opacity-55" : "")
        }
      >
        <span className="block truncate font-mono text-[17px] font-bold text-gray-900">
          {line.skuCode}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-gray-500">
          {line.isCatalogued ? line.description : "Not in catalog"}
        </span>
        {(batchText || issue) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[#98a2b3]">
            {batchText && <span className="tabular-nums">{batchText}</span>}
            {batchText && issue && <span className="text-[#d8dce1]">·</span>}
            {issue && <span className="font-semibold text-[#b42318]">{issue}</span>}
          </span>
        )}
      </span>

      {/* QTY — physical over "of {STI}". Red when the two differ. shrink-0 and
          nowrap so it can never wrap or be squeezed. */}
      <span className="flex shrink-0 flex-col items-center justify-center whitespace-nowrap px-3">
        <span
          className={
            "text-[22px] font-extrabold tabular-nums leading-none " +
            (differs ? "text-[#b42318]" : done ? "text-[#b6bcc6]" : "text-gray-900")
          }
        >
          {line.physicalQty ?? line.qtySti}
        </span>
        <span className="mt-1 text-[11px] tabular-nums text-[#98a2b3]">of {line.qtySti}</span>
      </span>
    </button>
  );
}

/** Picking's chip, matched — same size, same radius, same slate active fill. */
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
        "shrink-0 whitespace-nowrap rounded-full border px-3 py-[7px] text-[12.5px] font-medium " +
        (active
          ? "border-[#2a323c] bg-[#2a323c] font-semibold text-white"
          : "border-gray-200 bg-white text-[#6b7480]")
      }
    >
      {children}
    </button>
  );
}
