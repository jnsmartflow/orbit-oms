"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";

// Billing's CI register, downloaded — the control that drives
// GET /api/ci/export. Mounted in the billing board's header, Row 2 LEFT.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 ONE ENTRY POINT, AND IT IS THIS TRIGGER (owner ruling, 2026-09-03).
// ═══════════════════════════════════════════════════════════════════════════
//
// `UniversalHeader` has a `showDownload` / `onDownload` slot — the teal Download
// button in Row 1 — and this control deliberately does NOT use it. In every
// existing use of that button (components/tint/ti-report-content.tsx is the
// only one) it fires INSTANTLY with whatever range is already chosen. Giving it
// a second meaning on one screen — "opens a popover here, downloads everywhere
// else" — is how a familiar control becomes one nobody trusts. It stays unwired.
//
// ⚠ ROW 2 LEFT (`leftExtra`), NOT `rightExtra`. Row 2's RIGHT holds the board's
// own date stepper, which drives the CLOSED rail and has nothing to do with this
// export. Two date controls sitting side by side would read as one; the filter
// and a divider sit between these slots, so they never do. 🔴 THE STEPPER IS NOT
// TOUCHED AND DOES NOT DRIVE THIS EXPORT — a register is asked for by month, a
// rail is read by day, and conflating them would silently narrow a month's
// register to a day.
//
// ⚠ THE CLASS STRINGS BELOW ARE LIFTED, NOT INVENTED — each names its source
// line. Nothing exports them (TI Report's picker and HeaderFilter's popover both
// hold theirs as literals), so a citation is the closest thing to an import
// available. If any of them is ever promoted to a shared token, this is a call
// site to repoint. Do not nudge one locally: this is the same drift
// components/ci/spine.tsx exists to have already fixed once on this module.

/** components/tint/ti-report-content.tsx:225 — the date-range picker's trigger,
 *  which sits in this exact header slot on TI Report. */
const TRIGGER_BASE =
  "h-7 px-3 flex items-center gap-1.5 rounded-md border text-[11px] font-medium transition-colors";
const TRIGGER_OPEN = "border-teal-500 text-teal-700";
const TRIGGER_IDLE = "border-gray-200 text-gray-700 hover:border-gray-300";

/** components/header-filter.tsx:151 and ti-report-content.tsx:234 — the house
 *  popover shell, identical in both. Left-anchored here because the trigger
 *  sits at the LEFT edge of Row 2; HeaderFilter's is right-anchored for the
 *  mirror-image reason. */
const POPOVER =
  "absolute left-0 top-[calc(100%+6px)] bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-[248px]";

/** ti-report-content.tsx:246 — a preset row inside that shell. */
const PRESET_ROW =
  "w-full text-left px-2.5 py-1.5 rounded-md text-[11px] font-medium text-gray-600 hover:bg-gray-50 transition-colors";

/** The teal action, the app's one download colour (CLAUDE_UI.md §297, and the
 *  same fill components/admin/attendance/export-button.tsx uses). */
const ACTION =
  "w-full h-7 rounded-md bg-teal-600 hover:bg-teal-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-[11px] font-medium transition-colors";

const FIELD_LABEL = "text-[10px] font-medium uppercase tracking-[0.06em] text-gray-400";
const FIELD =
  "w-full h-7 px-2 rounded-md border border-gray-200 text-[11px] text-gray-700 focus:border-teal-500 focus:outline-none";

/**
 * Today's calendar date IN IST, as {y, m} with a 1-based month.
 *
 * ⚠ `en-CA` GIVES YYYY-MM-DD — the same idiom components/ci/billing-board.tsx
 * uses for its `dateParam`, and for the same reason: `toISOString().slice(0,10)`
 * is the UTC day, and after 18:30 IST that is YESTERDAY, which is most of a
 * depot evening. Getting this wrong would make "This month" mean December on
 * the evening of 1 January.
 */
function istYearMonth(): { y: number; m: number } {
  const [y, m] = new Date()
    .toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
    .split("-")
    .map(Number);
  return { y, m };
}

/**
 * The whole calendar month as {from, to}, both YYYY-MM-DD, both inclusive.
 *
 * `Date.UTC(y, m, 0)` is day ZERO of the following month, i.e. the last day of
 * this one — which is how February and every leap year come out right without a
 * table. UTC throughout: this is pure calendar arithmetic on numbers already
 * resolved in IST, so no second timezone may enter here.
 */
function monthRange(y: number, m: number): { from: string; to: string } {
  const mm = String(m).padStart(2, "0");
  const last = String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${last}` };
}

/** The current IST calendar month — the fields' opening state, and what "This
 *  month" resolves to. */
function currentMonthRange(): { from: string; to: string } {
  const now = istYearMonth();
  return monthRange(now.y, now.m);
}

export function CiRegisterExport(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  // ⚠ LAZY INITIALISERS. Without the arrow, `new Date()` would run on every
  // render of a board that polls every 15 seconds — and the value would be
  // computed then thrown away, since useState ignores it after the first call.
  const [from, setFrom] = useState(() => currentMonthRange().from);
  const [to, setTo] = useState(() => currentMonthRange().to);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside to close — ti-report-content.tsx:173's pattern verbatim.
  // `mousedown`, not `click`, so the popover is gone before a click on whatever
  // is underneath lands.
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  /**
   * 🔴 `window.location.assign`, NOT a fetch + blob — the pattern both existing
   * downloads in this app use (components/admin/attendance/export-button.tsx's
   * triggerCsvExport, and MRN's plain `href` to its export route). The response
   * carries `Content-Disposition: attachment`, so the browser SAVES it and this
   * screen never navigates: no blob to create, no object URL to revoke, and the
   * SERVER owns the filename, which is what stops the range-naming rule being
   * written down in two places that can drift.
   */
  function runExport(f: string, t: string): void {
    window.location.assign(
      `/api/ci/export?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`,
    );
    setOpen(false);
  }

  /** A shortcut sets the fields AND fires, in one click — the whole point of
   *  having them. The fields are left showing what was exported, so the operator
   *  can see what he just asked for. */
  function runMonth(offset: 0 | -1): void {
    const now = istYearMonth();
    const m = now.m + offset;
    const range = m === 0 ? monthRange(now.y - 1, 12) : monthRange(now.y, m);
    setFrom(range.from);
    setTo(range.to);
    runExport(range.from, range.to);
  }

  // A backwards range is the one input error worth catching here: it produces a
  // valid but empty workbook, which reads as "there were no CIs" rather than as
  // a typo. String comparison is exact on YYYY-MM-DD.
  const rangeValid = from !== "" && to !== "" && from <= to;

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${TRIGGER_BASE} ${open ? TRIGGER_OPEN : TRIGGER_IDLE}`}
        title="Download the CI register as an .xlsx"
      >
        <Download className="h-3 w-3" />
        Register
        <ChevronDown className="h-3 w-3 text-gray-400" />
      </button>

      {open && (
        <div className={POPOVER}>
          {/* The two shortcuts — one click each, calendar months in IST. */}
          <div className="p-2 border-b border-gray-100 flex flex-col gap-0.5">
            <button type="button" onClick={() => runMonth(0)} className={PRESET_ROW}>
              This month
            </button>
            <button type="button" onClick={() => runMonth(-1)} className={PRESET_ROW}>
              Last month
            </button>
          </div>

          {/* Anything else. Two native date inputs rather than TI Report's
              calendar: that calendar is 120 lines of hover-range state built for
              a picker the operator drives all day, and this is a control he
              opens once a month. A native input is also the one date control
              that never disagrees with his own locale. */}
          <div className="p-3 flex flex-col gap-2">
            <div>
              <div className={FIELD_LABEL}>From</div>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className={FIELD}
              />
            </div>
            <div>
              <div className={FIELD_LABEL}>To</div>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={FIELD}
              />
            </div>
            <button
              type="button"
              disabled={!rangeValid}
              onClick={() => runExport(from, to)}
              className={ACTION}
            >
              Export
            </button>
            {/* Said in words, once, and only when it is true. A disabled button
                with no reason beside it is a dead end. */}
            {!rangeValid && (
              <p className="text-[10px] text-gray-400 leading-[1.4]">
                The From date must be on or before the To date.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
