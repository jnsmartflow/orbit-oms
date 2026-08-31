"use client";

import { X } from "lucide-react";
import type { MrnDetailLine } from "@/lib/mrn/types";
import { isMrnReceivedFrom } from "@/lib/mrn/types";
import { formatBatchNo } from "@/lib/mrn/derive";
// ⚠ formatMonthYear() is NOT used here, deliberately. It renders `07/26` — the
// compact form the table and the A4 sheet needed to fit a column. The drawer has
// room for the unambiguous `07 / 2026`, and a two-digit year on the one surface
// that exists to remove doubt would be the wrong trade. formatBatchNo() has the
// same rule for the opposite reason: its year is FOUR digits because a batch
// number is an identifier, not a label (lib/mrn/derive.ts).
import { formatIstTime } from "./format";

// One MRN line, opened from the line-items table.
//
// 🔴 READ-ONLY. No fetch, no write, no action, no internal data loading. Every
// value it shows arrives on `line`, already resolved and already derived by
// getMrnDetail() (design §11 OQ-2 — Short and Excess are computed server-side by
// lib/mrn/derive.ts and NOTHING here recomputes them). If a future step wants an
// action in this drawer, that is a new decision: today the pane's own action row
// owns every MRN write, and keeping this surface inert is what makes it safe to
// open from a row click.
//
// ══════════════════════════════════════════════════════════════════════════
// 🔴 THE "NO SCRIM, ABSOLUTE INSIDE THE PANE" SHAPE IS REVERSED (2026-08-26).
//
// Built in 5c91657d as a 384px slab positioned `absolute` inside the detail
// pane's relative root, with NO scrim, on this reasoning: the rail stays
// visible and clickable beside it, because picking a different truck while a
// line is open is a normal thing to do, not something to block.
//
// Smart Flow has now seen this panel and Floor Control's side by side and
// chosen Floor's. So: a full-height FIXED overlay, a scrim that closes on
// click, and Floor's width. The old reasoning is kept above rather than
// deleted — it was not wrong, it was outweighed. If a future session wants
// the rail clickable again, that is a new decision with an owner's name on
// it, not a bug fix.
//
// The values below are READ OFF components/floor/detail-panel.tsx:256-258 and
// :291, not invented, and must move together with it if Floor's ever change:
//   overlay  fixed inset-0 z-[110]
//   scrim    absolute inset-0 bg-black/30           (click closes)
//   panel    absolute right-0 top-0 h-full w-[472px]
//            shadow-[-14px_0_40px_rgba(17,24,39,0.10)]
//   nav bar  border-t px-5 py-2.5 shadow-[0_-4px_14px_rgba(17,24,39,0.05)]
// ══════════════════════════════════════════════════════════════════════════
//
// ⚠ GEOMETRY BORROWED FROM Floor, CODE NOT. That file is 754 lines welded to
// floor: it imports FloorDetail/FloorPicker, fetches /api/floor/order/[orderId]
// itself, and takes a bag of eight write handlers. Nothing there is generic.
// What is copied is the SHAPE — the same way billing-board borrowed floor-page's
// two-track grid. Do not import it.
//
// ⚠ NO CHIPS ROW under the title, although Floor has one. Floor's chips carry
// state (Urgent, Key, status) that has nowhere else to live on its panel; every
// fact MRN's drawer could put in a chip — short, excess, condition counts — is
// already a row in the body below. Two copies of one fact is exactly what this
// module has spent three steps removing.
//
// ⚠ NO ESCAPE-KEY LISTENER, ON PURPOSE — see the note above onClose. Closing is
// ✕ or the scrim.

interface LineDrawerProps {
  /** The line to show. Already SKU-resolved and already derived. */
  line: MrnDetailLine;
  /**
   * `mrn.receivedFrom` off the MRN HEADER — the T/C half of every batch number
   * on this line. Passed in as the plain wire string and narrowed below, rather
   * than pre-narrowed by the pane: this is the only surface that needs it and
   * the guard belongs beside the render that uses it.
   */
  receivedFrom: string;
  /** 1-based index among the OPENABLE lines — not among all lines. Both this
   *  and `total` must be counted with isLineOpenable() (lib/mrn/derive.ts), the
   *  single definition; counting them any other way makes the footer lie. */
  position: number;
  /** How many openable lines the MRN has. */
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /**
   * ✕ and the scrim, and nothing else. This drawer registers NO window-level
   * Escape listener, because components/mrn/modal-shell.tsx:36 already owns one
   * for the MRN tree (it binds `keydown` on `window` while any MRN modal is
   * mounted). A second one is exactly the race CLAUDE_FLOOR.md §4.6 minted a
   * rule against — "floor-page.tsx is the SINGLE window-level Esc owner … never
   * add a second Esc keydown listener" — and the overlap here is real, not
   * theoretical: lines-table.tsx renders a ModalShell for its remove-line
   * confirm, which can be open while this drawer is. Two listeners would fire in
   * registration order and one surface would close under the other. If Esc is
   * wanted later it belongs in ONE owner for the whole billing tree, guarded
   * branch by branch, never bolted on here.
   */
  onClose: () => void;
}

export function LineDrawer({
  line,
  receivedFrom,
  position,
  total,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
}: LineDrawerProps): React.JSX.Element {
  // Narrowed once — see lib/mrn/workbook.ts for the same two lines. null is
  // unreachable while chk_mrn_received_from stands and renders "—" if it is.
  const rf = isMrnReceivedFrom(receivedFrom) ? receivedFrom : null;

  return (
    <div className="fixed inset-0 z-[110]">
      {/* Scrim — click to close. */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <aside
        className="absolute right-0 top-0 flex h-full w-[472px] flex-col bg-white shadow-[-14px_0_40px_rgba(17,24,39,0.10)]"
        aria-label={`Line ${line.lineNo} detail`}
      >
        {/* ── Header (fixed) ────────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-[#f0f2f4] px-5 pb-3 pt-3.5">
          <div className="flex items-start gap-2.5">
            <div className="min-w-0">
              <div className="truncate font-mono text-[19px] font-bold leading-none tracking-[-0.02em] text-gray-900">
                {line.skuCode}
              </div>
              <div className="mt-[7px] truncate text-[12.5px] text-gray-500">
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
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ml-auto shrink-0 text-gray-400 hover:text-gray-600"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* ── Body (the ONLY thing that scrolls) ────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
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
              /* Valid and expected: a line received at zero takes zero batch
                 rows (design §11 OQ-4). Nothing arrived, so there is no month. */
              <div className="px-3 py-[9px] text-[12.5px] text-gray-400">
                Nothing received on this line.
              </div>
            ) : (
              line.batches.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between border-b border-[#f4f6f8] px-3 py-[9px] text-[12.5px] last:border-b-0"
                >
                  {/* Batch number, then the month and year it is BUILT FROM.
                      The repetition is correct on this surface and only this
                      one: the drawer exists to remove doubt, and "T20260801" next
                      to "08 / 2026" is how the reader confirms the identifier
                      says what they think it says. The table and the A4 sheet,
                      which have a width budget, print the batch number alone. */}
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="font-mono font-semibold text-gray-900">
                      {rf ? formatBatchNo(rf, b.mfgMonth, b.mfgYear) : "—"}
                    </span>
                    <span className="font-mono text-[11.5px] text-[#98a2b3]">
                      {String(b.mfgMonth).padStart(2, "0")} / {b.mfgYear}
                    </span>
                  </span>
                  <span className="font-bold tabular-nums text-gray-900">{b.qty}</span>
                </div>
              ))
            )}
          </div>

          {/* 3 ── Condition counts — NON-ZERO ONLY (2026-08-26). */}
          <SectionLabel>Condition counts</SectionLabel>
          <ConditionCounts line={line} />

          {/* 4 ── Footer. The whole checked-by line is OMITTED when checkedAt is
                  null rather than shown with a dash: on an unchecked line nobody
                  has looked at it, and an empty "Checked by —" reads as a missing
                  name rather than as work not yet done. */}
          <div className="mt-[17px] text-[11.5px] leading-[1.6] text-gray-400">
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

        {/* ── Prev / Next — pinned, never scrolls. Floor's arrangement
              (detail-panel.tsx:291), moved out of the header where 5c91657d
              first put it. */}
        <div className="flex shrink-0 items-center gap-2 border-t border-gray-200 bg-white px-5 py-2.5 text-[11.5px] shadow-[0_-4px_14px_rgba(17,24,39,0.05)]">
          <NavButton disabled={!hasPrev} onClick={onPrev} label="Previous line">
            ‹ Previous
          </NavButton>
          {/* The LINE number, then the position among openable lines — "Line 9 ·
              3 of 4". Both halves earn their place: the first says which row you
              are on, the second says how much of the walk is left. */}
          <span className="mx-auto text-[11px] text-gray-400">
            Line {line.lineNo} · {position} of {total}
          </span>
          <NavButton disabled={!hasNext} onClick={onNext} label="Next line">
            Next ›
          </NavButton>
        </div>
      </aside>
    </div>
  );
}

// ── Condition counts ────────────────────────────────────────────────────────

type Tone = "plain" | "bad" | "excess";

/**
 * ALL EIGHT counts are considered; only the NON-ZERO ones render (2026-08-26).
 *
 * They used to all render, with the zeroes greyed out, on the argument that an
 * operator checking whether a line was damaged needs to see "Damage 0" and that
 * a list whose rows move about cannot be read by position. In practice a line
 * with one rejected piece drew eight rows to say one thing, and the seven greys
 * were what the eye had to get past to find it. The section HEADING stays in
 * both cases, so the reader still knows the drawer looked.
 *
 * 🔴 THE FILTER RUNS OVER ALL EIGHT VALUES, NOT THE SIX STORED COLUMNS. Short
 * and Excess are DERIVED (design §11 OQ-2) — a line can be four short with every
 * one of the six stored counts null, and filtering on the stored six alone would
 * render "nothing recorded" over a real shortage. shortQty/excessQty arrive
 * already computed and are never null.
 *
 * SND stays `plain`, not `bad` — it is the SOUND count, the tins that arrived
 * fine. Colouring it red would paint the good news as the problem.
 *
 * QTD's meaning is genuinely unknown (design §4). Carried because the source
 * workbook carries it; never repurposed to mean something helpful.
 */
function ConditionCounts({ line }: { line: MrnDetailLine }): React.JSX.Element {
  // The report's order, and it does not change with what is present.
  const all: { label: string; value: number; tone: Tone }[] = [
    { label: "SND", value: line.sndQty ?? 0, tone: "plain" },
    { label: "Leaky", value: line.leakyQty ?? 0, tone: "bad" },
    { label: "Damage", value: line.damageQty ?? 0, tone: "bad" },
    { label: "Empty", value: line.emptyQty ?? 0, tone: "bad" },
    { label: "QTD", value: line.qtdQty ?? 0, tone: "bad" },
    { label: "Rejected", value: line.rejQty ?? 0, tone: "bad" },
    { label: "Short", value: line.shortQty, tone: "bad" },
    { label: "Excess", value: line.excessQty, tone: "excess" },
  ];

  const shown = all.filter((c) => c.value !== 0);

  if (shown.length === 0) {
    return (
      <div className="rounded-[9px] border border-[#eceff2] px-3 py-[9px] text-[12.5px] text-gray-400">
        No damage, shortage or excess recorded.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[9px] border border-[#eceff2]">
      {shown.map((c) => (
        <CountRow key={c.label} label={c.label} value={c.value} tone={c.tone} />
      ))}
    </div>
  );
}

function CountRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: Tone;
}): React.JSX.Element {
  const row =
    tone === "bad" ? "bg-[#fef2f2]" : tone === "excess" ? "bg-[#f8fbff]" : "bg-white";
  const text =
    tone === "bad"
      ? "text-[#b42318]"
      : tone === "excess"
        ? "text-[#1d4ed8]"
        : "text-gray-900";

  return (
    <div
      className={`flex items-center justify-between border-b border-[#f4f6f8] px-3 py-[9px] text-[12.5px] last:border-b-0 ${row}`}
    >
      <span className={tone === "plain" ? "text-[#475467]" : text}>{label}</span>
      <span className={`font-bold tabular-nums ${text}`}>{value}</span>
    </div>
  );
}

// ── Bits ────────────────────────────────────────────────────────────────────

/** Physical picks up the third tile's colour so the two read as one statement.
 *  Neutral when the line matched. */
function kpiTone(line: MrnDetailLine): Tone {
  if (line.shortQty > 0) return "bad";
  if (line.excessQty > 0) return "excess";
  return "plain";
}

function Kpi({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: number | string;
  tone?: Tone;
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

/** Floor's nav button, verbatim in shape (detail-panel.tsx:292). `disabled:`
 *  opacity is UI §10's disabled treatment — the control exists for this role,
 *  there is simply nowhere further to step. */
function NavButton({
  disabled,
  onClick,
  label,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-[6px] border border-gray-200 px-3 py-[6px] text-[11.5px] text-gray-500 hover:border-gray-300 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
