"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { MrnDetailLine } from "@/lib/mrn/types";
// ⚠ formatMonthYear() is NOT used here, deliberately. It renders `07/26` — the
// compact form the table and the A4 sheet need to fit a column. The drawer has
// room for the unambiguous `07 / 2026`, and a two-digit year on the one surface
// that exists to remove doubt would be the wrong trade.
import { formatIstTime } from "./format";

// One MRN line, opened from the line-items table — mockup 09-billing-desktop-v9,
// frame "S".
//
// 🔴 READ-ONLY. No fetch, no write, no action, no internal data loading. Every
// value it shows arrives on `line`, already resolved and already derived by
// getMrnDetail() (design §11 OQ-2 — Short and Excess are computed server-side by
// lib/mrn/derive.ts and NOTHING here recomputes them). If a future step wants an
// action in this drawer, that is a new decision: today the pane's own action row
// owns every MRN write, and keeping this surface inert is what makes it safe to
// open from a row click.
//
// ⚠ GEOMETRY BORROWED FROM components/floor/detail-panel.tsx, CODE NOT.
// That file is 754 lines welded to floor: it imports FloorDetail/FloorPicker,
// fetches /api/floor/order/[orderId] itself, and takes a bag of eight write
// handlers. Nothing there is generic. What is copied is the SHAPE — right-hand
// slab, fixed header over a scrolling body, prev/next at the top — the same way
// billing-board borrowed floor-page's two-track grid. Do not import it.
//
// ⚠ AND ONE DELIBERATE DIFFERENCE FROM FLOOR'S SHAPE. Floor's panel is
// `fixed inset-0` with its own scrim, so it covers the whole page. This one is
// ABSOLUTE inside the detail pane's relative container and has NO scrim: the
// rail stays visible and usable beside it, because picking a different truck
// while a line is open is a normal thing to do, not something to block.
//
// ⚠ NO ESCAPE-KEY LISTENER, ON PURPOSE — see the note above onClose in the
// props block. Closing is ✕.

interface LineDrawerProps {
  /** The line to show. Already SKU-resolved and already derived. */
  line: MrnDetailLine;
  /** 1-based index among the OPENABLE lines — not among all lines. Both this
   *  and `total` must be counted with isLineOpenable() (lib/mrn/derive.ts), the
   *  single definition; counting them any other way makes the header lie. */
  position: number;
  /** How many openable lines the MRN has. */
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /**
   * ⚠ THE ONLY WAY OUT, AND THAT IS DELIBERATE. This drawer registers NO
   * window-level Escape listener, because components/mrn/modal-shell.tsx
   * already owns one for the MRN tree (it binds `keydown` on `window` while any
   * MRN modal is mounted). A second one is exactly the race CLAUDE_FLOOR.md
   * §4.6 minted a rule against — "floor-page.tsx is the SINGLE window-level Esc
   * owner … never add a second Esc keydown listener" — and the overlap here is
   * real, not theoretical: lines-table.tsx renders a ModalShell for its
   * remove-line confirm, which can be open while this drawer is. Two listeners
   * would fire in registration order and one surface would close under the
   * other. If Esc is wanted later it belongs in ONE owner for the whole billing
   * tree, guarded branch by branch, never bolted on here.
   */
  onClose: () => void;
}

export function LineDrawer({
  line,
  position,
  total,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
}: LineDrawerProps): React.JSX.Element {
  return (
    <aside
      /* Sits INSIDE the pane's relative box, not over the page. 384px matches
         the mockup; Floor's 472px is a wider panel doing a heavier job. */
      className="absolute bottom-0 right-0 top-0 z-10 flex w-[384px] flex-col border-l border-[#e0e4e8] bg-white shadow-[-16px_0_40px_rgba(16,24,40,0.10)]"
      aria-label={`Line ${line.lineNo} detail`}
    >
      {/* ── Header (fixed) ──────────────────────────────────────────────── */}
      <div className="relative shrink-0 border-b border-[#f0f2f4] px-[18px] pb-[13px] pt-[15px]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-[16px] top-[14px] text-[#b6bcc6] hover:text-gray-600"
        >
          <X size={15} />
        </button>

        <div className="mb-[11px] flex items-center justify-between text-[11.5px] text-gray-400">
          {/* ⚠ `lineNo`, NOT `srNo`. srNo is the TRUCK's number within its
              mrnDate and lives on the MRN header; the line's own number is
              lineNo (lib/mrn/types.ts). They are different facts and a line
              has no srNo at all. */}
          <span>
            Line {line.lineNo} · {position} of {total}
          </span>
          <div className="mr-[30px] flex gap-1.5">
            <ArrowButton label="Previous line" disabled={!hasPrev} onClick={onPrev}>
              <ChevronLeft size={13} />
            </ArrowButton>
            <ArrowButton label="Next line" disabled={!hasNext} onClick={onNext}>
              <ChevronRight size={13} />
            </ArrowButton>
          </div>
        </div>

        <div className="font-mono text-[17px] font-extrabold tracking-[0.02em] text-gray-900">
          {line.skuCode}
        </div>

        <div className="mt-1 text-[12.5px] text-gray-500">
          {line.isCatalogued ? (
            <>
              {line.description}
              {line.pack && ` · pack ${line.pack}`}
            </>
          ) : (
            <span className="text-amber-700">Not in catalog</span>
          )}
        </div>
      </div>

      {/* ── Body (scrolls) ──────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] pb-[18px] pt-[15px]">
        {/* 1 ── KPI tiles. Qty STI and Physical always; the third is whichever
                of Short / Excess is real, or "Matched" when neither is. Only
                ONE of the three can ever apply: Short and Excess are opposite
                sides of the same subtraction, so both cannot be > 0. */}
        <div className="mb-[17px] grid grid-cols-3 gap-2">
          <Kpi label="Qty STI" value={line.qtySti} />
          <Kpi label="Physical" value={line.physicalQty ?? "—"} tone={kpiTone(line)} />
          {line.shortQty > 0 ? (
            <Kpi label="Short" value={`-${line.shortQty}`} tone="bad" />
          ) : line.excessQty > 0 ? (
            <Kpi label="Excess" value={`+${line.excessQty}`} tone="excess" />
          ) : (
            /* "Matched" restates Physical on purpose — the tile's JOB is to
               answer "did this line come in right", and a third number the
               reader has to compare against the second answers it slower than
               the word does. */
            <Kpi label="Matched" value={line.physicalQty ?? "—"} />
          )}
        </div>

        {/* 2 ── Batches. Rendered even for a single batch: the section
                disappearing on some lines and not others makes the drawer feel
                like it is hiding something. batchNo order is the server's
                (queries.ts orders batches ASC) and IS the report's 6a/6b
                order — do not re-sort here. */}
        <SectionLabel>Manufacturing batches</SectionLabel>
        <div className="mb-[17px] overflow-hidden rounded-[9px] border border-[#eceff2]">
          {line.batches.length === 0 ? (
            /* Valid and expected: a line received at zero takes zero batch rows
               (design §11 OQ-4). Nothing arrived, so there is no month. */
            <div className="px-3 py-[9px] text-[12.5px] text-gray-400">
              Nothing received on this line.
            </div>
          ) : (
            line.batches.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between border-b border-[#f4f6f8] px-3 py-[9px] text-[12.5px] last:border-b-0"
              >
                <span className="font-mono text-[#475467]">
                  {String(b.mfgMonth).padStart(2, "0")} / {b.mfgYear}
                </span>
                <span className="font-bold tabular-nums text-gray-900">{b.qty}</span>
              </div>
            ))
          )}
        </div>

        {/* 3 ── ALL EIGHT condition counts, ALWAYS, in the report's order.
                Never filtered to the non-zero ones: an operator checking
                whether a line was damaged needs to see "Damage 0", and a list
                whose ROWS move around between lines cannot be read by
                position. Zeroes grey out instead. */}
        <SectionLabel>Condition counts</SectionLabel>
        <div className="mb-[17px] overflow-hidden rounded-[9px] border border-[#eceff2]">
          {/* SND is `plain`, not `bad` — it is the SOUND count, the tins that
              arrived fine. On a clean line it EQUALS physical. Colouring it red
              would paint the good news as the problem. */}
          <CountRow label="SND" value={line.sndQty} tone="plain" />
          <CountRow label="Leaky" value={line.leakyQty} tone="bad" />
          <CountRow label="Damage" value={line.damageQty} tone="bad" />
          <CountRow label="Empty" value={line.emptyQty} tone="bad" />
          {/* QTD's meaning is genuinely unknown (design §4). Carried because the
              source workbook carries it; never repurposed to mean something
              helpful. */}
          <CountRow label="QTD" value={line.qtdQty} tone="bad" />
          <CountRow label="Rejected" value={line.rejQty} tone="bad" />
          {/* The last two are DERIVED, not stored — no shortQty/excessQty
              column exists and none may be added (design §11 OQ-2). They are
              plain numbers here, never null, because derive.ts already
              resolved them. */}
          <CountRow label="Short" value={line.shortQty} tone="bad" />
          <CountRow label="Excess" value={line.excessQty} tone="excess" />
        </div>

        {/* 4 ── Footer. The whole checked-by line is OMITTED when checkedAt is
                null rather than shown with a dash: on an unchecked line nobody
                has looked at it, and an empty "Checked by —" reads as a missing
                name rather than as work not yet done. */}
        <div className="text-[11.5px] leading-[1.6] text-gray-400">
          {line.checkedAt && (
            <p>
              Checked by{" "}
              <b className="font-semibold text-[#475467]">
                {line.checkedByName ?? "a supervisor"}
              </b>{" "}
              at <b className="font-semibold text-[#475467]">{formatIstTime(line.checkedAt)}</b>
            </p>
          )}
          <p className={line.checkedAt ? "mt-1" : ""}>
            Short and Excess are calculated from Qty STI vs Physical — the supervisor
            does not type them.
          </p>
        </div>
      </div>
    </aside>
  );
}

// ── Bits ────────────────────────────────────────────────────────────────────

/** Physical picks up the third tile's colour so the two read as one statement.
 *  Neutral when the line matched. */
function kpiTone(line: MrnDetailLine): TileTone {
  if (line.shortQty > 0) return "bad";
  if (line.excessQty > 0) return "excess";
  return "plain";
}

type TileTone = "plain" | "bad" | "excess";

function Kpi({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: number | string;
  tone?: TileTone;
}): React.JSX.Element {
  const box =
    tone === "bad"
      ? "border-red-200 bg-red-50"
      : tone === "excess"
        ? "border-[#cfe0f2] bg-[#f8fbff]"
        : "border-[#eceff2] bg-white";
  const num =
    tone === "bad" ? "text-[#b42318]" : tone === "excess" ? "text-[#0369a1]" : "text-gray-900";
  return (
    <div className={`rounded-[9px] border px-2.5 py-[9px] ${box}`}>
      <div className="text-[9px] font-bold uppercase tracking-[0.04em] text-[#a0a7b1]">
        {label}
      </div>
      <div className={`mt-0.5 text-[19px] font-extrabold tabular-nums ${num}`}>{value}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-[9px] text-[9.5px] font-bold uppercase tracking-[0.06em] text-[#a0a7b1]">
      {children}
    </div>
  );
}

/**
 * One condition row.
 *
 * A null count means the supervisor never opened the issue toggle on this line;
 * it renders as 0 and greys out, because "not recorded" and "none" mean the
 * same thing to someone reading a finished MRN. Short and Excess never arrive
 * null — they are derived.
 */
function CountRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone: TileTone;
}): React.JSX.Element {
  const n = value ?? 0;
  const zero = n === 0;

  const row = zero
    ? "bg-white"
    : tone === "bad"
      ? "bg-[#fef2f2]"
      : tone === "excess"
        ? "bg-[#f8fbff]"
        : "bg-white";

  const text = zero
    ? "text-[#d5dae0]"
    : tone === "bad"
      ? "text-[#b42318]"
      : tone === "excess"
        ? "text-[#1d4ed8]"
        : "text-gray-900";

  return (
    <div
      className={`flex items-center justify-between border-b border-[#f4f6f8] px-3 py-[9px] text-[12.5px] last:border-b-0 ${row}`}
    >
      <span className={zero ? text : tone === "plain" ? "text-[#475467]" : text}>{label}</span>
      <span className={`font-bold tabular-nums ${text}`}>{n}</span>
    </div>
  );
}

/** A 24×24 bordered stepper. Disabled is grey and genuinely disabled — at the
 *  first or last openable line there is nowhere to step. */
function ArrowButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={
        "flex h-6 w-6 items-center justify-center rounded-[6px] border " +
        (disabled
          ? "cursor-not-allowed border-[#f0f2f4] text-[#d5dae0]"
          : "border-gray-200 text-[#667085] hover:bg-gray-50")
      }
    >
      {children}
    </button>
  );
}
