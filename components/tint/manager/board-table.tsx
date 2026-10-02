"use client";

// Tint Manager — the flat board table, grouped one section per operator.
//
// ONE table, no tabs and no operator filter chip: every job of a person's sits
// under their own name, in the order "what they're doing now / what's next /
// what's stuck / what's finished" (mockup callout §4). The grouping is a sort,
// not a filter — nothing is hidden by it.
//
// Fixed-table standard, CLAUDE_UI.md §27: table-layout:fixed + <colgroup>
// percentage widths + nowrap/ellipsis cells. Widths come from the locked mockup.

import { Scissors } from "lucide-react";
import { cn } from "@/lib/utils";
import { ObdCode } from "@/components/shared/obd-code";
import { InvoiceLines, ObdDateLine } from "@/components/floor/bill-ref-cells";
// OperatorAvatar is no longer imported here: the Operator column was removed
// 2026-09-05 as redundant — the group header already names the person, and every
// row in a section belongs to them. The avatar still ships in board-bits for the
// rail and the detail panel.
import { StatusPill, formatSmu } from "./board-bits";
import { BoardSlotCell } from "./board-slot-cell";
import { MissingShipToLine, missingRowCls, useMissingCustomers } from "./missing-customer";
import type { DispatchSlotValue, DispatchWindow } from "@/components/floor/dispatch-slot-picker";
import type { BoardGroup, BoardRow } from "./types";

// ── Column widths ────────────────────────────────────────────────────────────
// ☐ 4 · # 4 · OBD 13 · SMU 5 · Bill To 17 · Ship To 20 · Route 9 · Vol 6 ·
// Art. 9 · Status 13  = 100.
//
// Derived from Floor's live table (the interactive+showInvoice arm:
// 4,4,13,10,20,9,6,10,8,16) so the two boards line up where they share a column.
//
// SMU dropped 10 → 5 on 2026-09-05 once the column started showing the short
// ERP code ("74") instead of the descriptive name ("Deco Projects"): two digits
// need nothing like 10%. The 5 freed goes straight back to the two columns that
// paid for SMU in the first place —
//   Bill To 15 → 17 (+2) · Ship To 17 → 20 (+3)
// which restores Ship To to Floor's EXACT 20 and leaves Bill To one point under
// its pre-SMU 18. Both hold long dealer/site names and both ellipsise, so they
// are the right place for the width.
//
// ⚠ WIDTHS MAP POSITIONALLY. Moving a column means moving its <col>, its <th>
// and its <td> together; any one left behind shunts every column to its right.
//
// 2026-10-01 (tabs build step 6): the ☐ column went (a row click selects) and
// two arrived — Slot after Route, and ⋯ (the detail panel) at the row's end:
// # 4 · OBD 12 · SMU 4 · Bill To 15 · Ship To 19 · Route 8 · Slot 11 · Vol 5 ·
// Art. 8 · Status 11 · ⋯ 3  = 100.
//
// 2026-10-02 (owner): the OBD cell gains Floor's date line and an INVOICE column
// arrives right after it (Floor's cells, components/floor/bill-ref-cells.tsx);
// Slot is renamed Due:
// # 4 · OBD 11 · Invoice 9 · SMU 4 · Bill To 13 · Ship To 17 · Route 7 · Due 10 ·
// Vol 5 · Art. 8 · Status 9 · ⋯ 3  = 100.
//
// 2026-10-02 (Tint tab redesign): the ▲▼ grew to 32×21 (mockup v13), so # widens
// 4 → 6, paid by OBD 11 → 10 and Ship To 17 → 16. Same columns, same order:
// # 6 · OBD 10 · Invoice 9 · SMU 4 · Bill To 13 · Ship To 16 · Route 7 · Due 10 ·
// Vol 5 · Art. 8 · Status 9 · ⋯ 3  = 100.
const COLS = ["6%", "10%", "9%", "4%", "13%", "16%", "7%", "10%", "5%", "8%", "9%", "3%"] as const;

// ── Typography, copied from Floor's floor-table.tsx ──────────────────────────
// Floor's four class strings verbatim, so header, cells and pills read
// identically on both boards. Note Floor itself sits a hair off CLAUDE_UI §27's
// stated row sizing — §27 says a 32px header and a 36px data row; Floor uses
// h-[31px] and py-2 (≈33px at 11px text). Floor's actual CSS wins here, because
// matching Floor is the point of this pass; §27's other rules (table-layout
// fixed, colgroup percentages, nowrap/ellipsis) are unchanged and still hold.
const HEAD_TH        = "h-[31px] border-b border-[#ebebeb] px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const HEAD_TH_NARROW = "h-[31px] border-b border-[#ebebeb] px-1 text-center text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const TD             = "px-3.5 py-2 text-[11px] whitespace-nowrap overflow-hidden text-ellipsis border-b border-[#f0f0f0] text-[#4b5563]";
const TD_NARROW      = "px-1 py-2 text-center text-[11px] border-b border-[#f0f0f0] text-[#4b5563]";

export function BoardTable({
  groups, selection, onToggleRow, onOpenRow, onReorder, busyKeys,
  windows, canSlot, slotBusy, onSetSlot, barUp = false,
}: {
  groups:      BoardGroup[];
  selection:   Set<string>;
  /** A row click — selects / deselects a selectable row (step 6). */
  onToggleRow: (row: BoardRow) => void;
  /** The row's ⋯ — opens the detail panel. */
  onOpenRow:   (row: BoardRow) => void;
  onReorder:   (row: BoardRow, direction: "up" | "down") => void;
  /** Rows with a reorder request in flight — arrows go inert so a double-tap
   *  cannot queue two swaps against a list the first one is about to change. */
  busyKeys:    Set<string>;
  /** Active dispatch windows for the Slot cell's picker. */
  windows:     DispatchWindow[];
  /** tint_manager canEdit && tint_slot canEdit — without it the cell is read-only. */
  canSlot:     boolean;
  /** A write is in flight — the slot cells go inert. */
  slotBusy:    boolean;
  onSetSlot:   (row: BoardRow, v: DispatchSlotValue) => void;
  /** The bottom bar is up — pad the scroller so it never covers the last rows. */
  barUp?:      boolean;
}) {
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-baseline gap-2 px-3.5 py-3 bg-white border-b border-gray-200">
        <span className="text-[12px] font-bold text-gray-900">On the floor</span>
        <span className="text-[10.5px] text-gray-400">
          {total} {total === 1 ? "job" : "jobs"} · grouped by operator
        </span>
        <span
          className="text-[10.5px] text-gray-300 ml-auto"
          title="Finished jobs drop off this board at the end of the day. The full history lives in the Tint Summary report."
        >
          finished jobs show for today only
        </span>
      </div>

      <div className={cn("flex-1 overflow-y-auto bg-white", barUp && "pb-[96px]")}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <BoardColGroup />
          <thead>
            <tr>
              <th className={cn(HEAD_TH_NARROW, "sticky top-0 bg-white z-10")}>#</th>
              <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>OBD</th>
              <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Invoice</th>
              <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>SMU</th>
              <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Bill To</th>
              <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Ship To</th>
              <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Route</th>
              <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Due</th>
              <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10 text-right")}>Vol</th>
              <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Art.</th>
              <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Status</th>
              <th className={cn(HEAD_TH_NARROW, "sticky top-0 bg-white z-10")} />
            </tr>
          </thead>
          <tbody>
            {total === 0 && (
              <tr>
                <td colSpan={12} className="text-center text-[11.5px] text-gray-400 py-10">
                  Nothing on the floor. Assign an OBD from the rail to get started.
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <GroupSection
                key={g.operatorId}
                group={g}
                selection={selection}
                onToggleRow={onToggleRow}
                onOpenRow={onOpenRow}
                onReorder={onReorder}
                busyKeys={busyKeys}
                windows={windows}
                canSlot={canSlot}
                slotBusy={slotBusy}
                onSetSlot={onSetSlot}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The board's colgroup — exported (2026-10-02) so the Tint tab's per-operator
 *  tables (board-tint-tab.tsx) use the SAME widths as this table. */
export function BoardColGroup() {
  return <colgroup>{COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>;
}

/** The board's header row — exported (2026-10-02) for the Tint tab's tables. */
export function BoardHeadRow() {
  return (
    <tr>
      <th className={HEAD_TH_NARROW}>#</th>
      <th className={HEAD_TH}>OBD</th>
      <th className={HEAD_TH}>Invoice</th>
      <th className={HEAD_TH}>SMU</th>
      <th className={HEAD_TH}>Bill To</th>
      <th className={HEAD_TH}>Ship To</th>
      <th className={HEAD_TH}>Route</th>
      <th className={HEAD_TH}>Due</th>
      <th className={cn(HEAD_TH, "text-right")}>Vol</th>
      <th className={HEAD_TH}>Art.</th>
      <th className={HEAD_TH}>Status</th>
      <th className={HEAD_TH_NARROW} />
    </tr>
  );
}

function GroupSection({
  group, selection, onToggleRow, onOpenRow, onReorder, busyKeys,
  windows, canSlot, slotBusy, onSetSlot,
}: {
  group:       BoardGroup;
  selection:   Set<string>;
  onToggleRow: (row: BoardRow) => void;
  onOpenRow:   (row: BoardRow) => void;
  onReorder:   (row: BoardRow, direction: "up" | "down") => void;
  busyKeys:    Set<string>;
  windows:     DispatchWindow[];
  canSlot:     boolean;
  slotBusy:    boolean;
  onSetSlot:   (row: BoardRow, v: DispatchSlotValue) => void;
}) {
  return (
    <>
      <tr className="group/hdr">
        {/* Name only. The job count that used to trail it was noise: the rows
            it counted are directly underneath, and the table header already
            carries the board total. */}
        <td colSpan={12} className="bg-gray-50 text-gray-600 text-[10.5px] font-bold px-3.5 py-[5px] border-b border-gray-100">
          {group.operatorName}
        </td>
      </tr>
      {group.rows.map((r) => (
        <TintBoardRow
          key={r.key}
          row={r}
          selected={selection.has(r.key)}
          onToggle={() => onToggleRow(r)}
          onOpen={() => onOpenRow(r)}
          onReorder={onReorder}
          busy={busyKeys.has(r.key)}
          windows={windows}
          canSlot={canSlot}
          slotBusy={slotBusy}
          onSetSlot={(v) => onSetSlot(r, v)}
        />
      ))}
    </>
  );
}

/** One board row — exported (2026-10-02) so the Tint tab renders the SAME cells.
 *  `tall` = the Tint tab's 52px rows (mockup v13); the cells are unchanged. */
export function TintBoardRow({
  row, selected, onToggle, onOpen, onReorder, busy, windows, canSlot, slotBusy, onSetSlot, tall = false, readOnly = false,
}: {
  row:       BoardRow;
  selected:  boolean;
  onToggle:  () => void;
  onOpen:    () => void;
  onReorder: (row: BoardRow, direction: "up" | "down") => void;
  busy:      boolean;
  windows:   DispatchWindow[];
  canSlot:   boolean;
  slotBusy:  boolean;
  onSetSlot: (v: DispatchSlotValue) => void;
  tall?:     boolean;
  /** History (2026-10-02): no selection, no ⋯ — a past day is read-only. */
  readOnly?: boolean;
}) {
  // A ROW CLICK SELECTS (2026-10-01, step 6 — owner decision 5). No checkbox:
  // the selected row fills brand-50 with a brand bar on its first cell (the
  // mockup's tr.row.sel). A row that cannot be selected (a split, a job
  // finished today) does nothing on click; its ⋯ still opens the panel.
  // Missing customer (2026-10-02): amber row + orange bar, ship-to tag below.
  const missingCtx = useMissingCustomers();
  return (
    <tr
      className={cn(
        "group",
        row.selectable && !readOnly ? "cursor-pointer" : "cursor-default",
        selected ? "bg-brand-50 [&>td:first-child]:shadow-[inset_3px_0_0_theme(colors.brand.600)]" : "hover:bg-gray-50",
        !selected && missingRowCls(missingCtx, row.orderId),
        tall && "[&>td]:h-[52px]",
      )}
      onClick={row.selectable && !readOnly ? onToggle : undefined}
      aria-selected={row.selectable && !readOnly ? selected : undefined}
      // Header search (2026-10-02): an opened result scrolls to + flashes this row.
      data-search-key={row.key}
    >

      {/* # — the queue rank.
          ⚠ THE WRAPPER IS THE SAME ON EVERY ROW, and that is the whole point.
          The cell is text-center (TD_NARROW), and a ranked row's content is
          [number][5px gap][14px arrows] centred AS ONE BLOCK — which puts the
          NUMBER about 9.5px left of the cell's true centre. A bare dash centres
          on that true centre, so the two never sat in the same place. Both
          branches now render the identical inline-flex, and the arrows slot
          keeps its w-3.5 whether or not it holds buttons, so the glyph lands in
          exactly one position down the whole column. */}
      <td className={cn(TD_NARROW, "text-[10.5px] tabular-nums")} onClick={(e) => e.stopPropagation()}>
        <span className="inline-flex items-center gap-[5px]">
          {row.status !== "assigned" || row.seqRank === null ? (
            <span className="text-[#9ca3af]">—</span>
          ) : (
            <span className="font-semibold text-[#4b5563]">{row.seqRank}</span>
          )}
          {row.status === "assigned" && row.seqRank !== null ? (
            <span className={cn(
              "flex w-8 flex-col gap-[3px] transition-opacity",
              busy ? "opacity-30" : "opacity-0 group-hover:opacity-100",
            )}>
              <button
                type="button"
                disabled={!row.canMoveUp || busy}
                onClick={() => onReorder(row, "up")}
                title={row.canMoveUp ? `Move up in ${row.operatorName.split(" ")[0]}'s queue` : "Already first"}
                className={cn(
                  // 32×21 (owner 2026-10-02, mockup v13 .mv button): big enough to hit.
                  "flex h-[21px] w-8 items-center justify-center rounded-md border text-[12px] leading-none",
                  row.canMoveUp && !busy
                    ? "border-ink-200 bg-white text-ink-700 hover:border-brand-600 hover:bg-brand-50 hover:text-brand-700"
                    : "border-ink-200 bg-white text-ink-400 opacity-25 cursor-default",
                )}
              >
                ▲
              </button>
              <button
                type="button"
                disabled={!row.canMoveDown || busy}
                onClick={() => onReorder(row, "down")}
                title={row.canMoveDown ? `Move down in ${row.operatorName.split(" ")[0]}'s queue` : "Already last"}
                className={cn(
                  // 32×21 (owner 2026-10-02, mockup v13 .mv button): big enough to hit.
                  "flex h-[21px] w-8 items-center justify-center rounded-md border text-[12px] leading-none",
                  row.canMoveDown && !busy
                    ? "border-ink-200 bg-white text-ink-700 hover:border-brand-600 hover:bg-brand-50 hover:text-brand-700"
                    : "border-ink-200 bg-white text-ink-400 opacity-25 cursor-default",
                )}
              >
                ▼
              </button>
            </span>
          ) : (
            // The arrows' footprint, reserved but empty — this is what keeps the
            // dash under the numbers.
            <span className="w-8" aria-hidden="true" />
          )}
        </span>
      </td>

      {/* OBD (+ split tag) — Floor's OBD treatment: mono 11.5 medium #111827 */}
      <td className={TD}>
        <span className="inline-flex items-center gap-1">
          <ObdCode code={row.obdNumber} />
          {row.type === "split" && (
            <span
              className="inline-flex items-center gap-[2px] rounded-[3px] px-[5px] py-px text-[9.5px] font-bold bg-warn-bg text-warn-text"
              title={`Split #${row.splitNumber} of this OBD`}
            >
              <Scissors size={8} />
              Split
            </span>
          )}
        </span>
        {/* Floor's date line — the same component Floor's OBD cell renders. */}
        <ObdDateLine iso={row.obdDateTime} isEmailTime={row.isEmailTime} />
      </td>

      {/* INVOICE — Floor's cell (empty when SAP has not stamped one yet). */}
      <td className={TD}>
        <InvoiceLines invoiceNo={row.invoiceNo} invoiceDate={row.invoiceDate} />
      </td>

      {/* SMU — the SHORT ERP CODE (import_raw_summary.smuCode), with the full
          descriptive name on hover, the same way Bill To's truncation works.
          Live map, 926/926 covered: 74 Decorative Projects · 77 Retail Offtake ·
          70 Deco Retail.
          Falls back to the abbreviated NAME if a row ever arrives without a
          code, so the column degrades to something readable rather than an em
          dash. Tabular-nums keeps the two digits aligned down the column. */}
      <td className={cn(TD, "tabular-nums")} title={row.smu ?? undefined}>
        {row.smuCode ?? formatSmu(row.smu) ?? "—"}
      </td>

      {/* Bill To — the ORDERING DEALER (import_raw_summary.billToCustomerName),
          a different party from the ship-to site in the next column. It differs
          from ship-to on 873 of 926 live tint OBDs, which is why both are here. */}
      <td className={TD} title={row.billToName ?? undefined}>
        {/* Same treatment as Ship To below, deliberately. These are two parties
            to the same bill, not a field and its footnote — the dealer who
            ordered and the site it goes to — so neither outranks the other
            visually. Inheriting TD's 11px/#4b5563 made this read as a secondary
            field beside Ship To's 11.5px/#111827. */}
        <span className="text-[11.5px] font-medium text-[#111827]">
          {row.billToName ?? "—"}
        </span>
      </td>

      {/* Ship To — the site. Floor's dealer-name treatment, ★/⚡ inline-styled
          to Floor's exact amber/red. OVERRIDE-FIRST since 2026-10-01: siteName
          is the redirected site when the bill has one (rows.ts siteNameOf). */}
      <td
        className={TD}
        title={row.originalSiteName ? `${row.originalSiteName} → ship to ${row.siteName}` : row.siteName}
      >
        <span className="text-[11.5px] font-medium text-[#111827]">{row.siteName}</span>
        {row.isKeyCustomer && <span className="ml-1.5" style={{ color: "#f59e0b" }} title="Key customer">★</span>}
        {row.isUrgent && <span className="ml-1" style={{ color: "#ef4444" }} title="Urgent">⚡</span>}
        {row.skipCount > 0 && (
          <span
            className="ml-1.5 rounded-[3px] px-[5px] py-px text-[9.5px] font-bold bg-[#f3f4f6] text-[#6b7280]"
            title={`Skipped ${row.skipCount}×`}
          >
            ↩{row.skipCount}
          </span>
        )}
        {/* Ship-to redirect — Floor's ORIGINAL → REDIRECT pair, copied from
            components/floor/floor-table.tsx (CLAUDE_FLOOR §4.9): same wording,
            same brand-800, rides inside this column with its own ellipsis
            (fixed layout, CLAUDE_UI §27), full pair on the cell's title. */}
        {row.originalSiteName && (
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-brand-800">
            {row.originalSiteName}
            <span className="mx-1 opacity-60">→</span>
            <b className="font-semibold">{row.siteName}</b>
          </div>
        )}
        <MissingShipToLine orderId={row.orderId} />
      </td>

      <td className={TD}>{row.route ?? "—"}</td>
      {/* Slot — the bill's Floor dispatch window; one click opens Floor's
          picker (board-slot-cell.tsx). Split and finished rows carry no
          window of their own on this board — a dash. */}
      <td className={TD}>
        {row.type === "order" && row.selectable ? (
          <BoardSlotCell
            date={row.slotDate}
            windowId={row.slotWindowId}
            windowTime={row.slotWindowTime}
            windows={windows}
            canSlot={canSlot}
            disabled={slotBusy}
            onPick={onSetSlot}
          />
        ) : (
          <span className="text-[#9ca3af]">—</span>
        )}
      </td>
      <td className={cn(TD, "text-right tabular-nums")}>{row.volumeLitres ?? 0}</td>
      {/* NULL articleTag means UNKNOWN, never zero — only ~40% of live tint OBDs
          carry one at all, so an em dash is the honest render. */}
      <td className={cn(TD, "text-[10.5px]")} title={row.articleTag ?? undefined}>
        <span className="text-[#6b7280]">{row.articleTag ?? "—"}</span>
      </td>

      <td className={TD}>
        <StatusPill status={row.status} at={row.statusAt} pauseCount={row.pauseCount} />
      </td>
      {/* ⋯ — the detail panel. Its own click; it never selects the row. */}
      <td className={TD_NARROW} onClick={(e) => e.stopPropagation()}>
        {!readOnly && <button
          type="button"
          onClick={onOpen}
          title="Bill details"
          className="rounded-md px-1 text-[15px] leading-5 tracking-[1px] text-ink-400 hover:bg-ink-50 hover:text-ink-900"
        >
          ⋯
        </button>}
      </td>
    </tr>
  );
}
