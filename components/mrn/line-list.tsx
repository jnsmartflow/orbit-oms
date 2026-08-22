"use client";

import { Check } from "lucide-react";
import type { MrnDetail, MrnDetailLine } from "@/lib/mrn/types";
import { formatIstTime, formatMonthYear } from "./format";

// S5 / S6 — the line list inside the detail screen.
//
// ⚠️ A TICKED LINE MUTES so his eye skips it. That is the whole navigation
// model on a 36-line truck: the unmuted rows ARE the remaining work, and he
// never has to hunt for what is left. Do not "improve" this by sorting ticked
// rows to the bottom — the line order is the STI's order, which is the order
// the pallets come off the truck.
//
// ⚠️ THE RIGHT-HAND NUMBER IS physical over "of {qtySti}", and goes red only
// when the two differ. On an unchecked line it shows the STI figure greyed,
// because that is what he is about to confirm.

interface LineListProps {
  detail: MrnDetail;
  onOpenLine: (line: MrnDetailLine, index: number) => void;
  /** Rendered under the list; the End CTA lives in the parent so it can float. */
}

export function LineList({ detail, onOpenLine }: LineListProps): React.JSX.Element {
  const checked = detail.checkedLineCount;
  const total = detail.lineCount;
  const pct = total === 0 ? 0 : Math.round((checked / total) * 100);

  return (
    <>
      {/* ── Progress strip ─────────────────────────────────────────────────
          Count, bar, and the start time — the three things he glances at
          between pallets. The right slot flips to the issue count once there
          is one, because by then "how many are wrong" outranks "when did I
          start". */}
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

      <div className="overflow-hidden rounded-[13px] bg-white">
        {detail.lines.map((line, i) => (
          <LineRow
            key={line.id}
            line={line}
            onClick={() => onOpenLine(line, i + 1)}
            last={i === detail.lines.length - 1}
          />
        ))}
        {detail.lines.length === 0 && (
          <p className="px-3.5 py-4 text-[13px] text-gray-400">
            Billing has not added the lines for this truck yet.
          </p>
        )}
      </div>
    </>
  );
}

function LineRow({
  line,
  onClick,
  last,
}: {
  line: MrnDetailLine;
  onClick: () => void;
  last: boolean;
}): React.JSX.Element {
  const done = line.isChecked;
  const differs = done && line.physicalQty !== null && line.physicalQty !== line.qtySti;

  // The meta line: pack · batches · the loudest issue. A split line shows BOTH
  // batches inline — "06/26 · 9 + 07/26 · 6" — so he can see the split without
  // opening the sheet, which is the only reason the list is worth reading.
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
    // Tap ANYWHERE on the row — a 13px tick circle is not a target on a floor.
    <button
      type="button"
      onClick={onClick}
      className={
        "flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-gray-50 " +
        (last ? "" : "border-b border-[#f2f4f6] ") +
        (done ? "bg-[#fbfcfc]" : "")
      }
    >
      <span
        className={
          "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full " +
          (done ? "bg-green-500" : "border-2 border-gray-200")
        }
      >
        {done && <Check size={13} strokeWidth={3.2} className="text-white" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className={"block font-mono text-[11px] " + (done ? "text-[#c2c8d0]" : "text-[#98a0aa]")}>
          {line.skuCode}
        </span>
        <span
          className={
            "mt-px block truncate text-[14px] font-medium leading-[1.3] " +
            (done ? "text-[#b6bcc6]" : line.isCatalogued ? "text-[#1d2939]" : "text-[#b6bcc6]")
          }
        >
          {line.isCatalogued ? line.description : "Not in catalog"}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[#98a2b3]">
          {line.pack && <span>{line.pack}</span>}
          {line.pack && batchText && <span className="text-[#d8dce1]">·</span>}
          {batchText && <span className="tabular-nums">{batchText}</span>}
          {issue && <span className="text-[#d8dce1]">·</span>}
          {issue && <span className="font-semibold text-[#b42318]">{issue}</span>}
        </span>
      </span>

      <span className="shrink-0 text-right">
        <span
          className={
            "block text-[17px] font-bold tabular-nums " +
            (differs ? "text-[#b42318]" : done ? "text-[#b6bcc6]" : "text-[#1d2939]")
          }
        >
          {line.physicalQty ?? line.qtySti}
        </span>
        <span className="block text-[11px] text-[#98a2b3]">of {line.qtySti}</span>
      </span>
    </button>
  );
}
