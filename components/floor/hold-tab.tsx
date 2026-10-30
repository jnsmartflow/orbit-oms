"use client";

// Floor Control — the On-hold tab (design §8, mockup 01-board.html `holdTbl` +
// the hold-pane branch of render()). A TABLE in the main area, not cards in the
// rail: "the list can reach 100+, which is why it is a table … the rail only ever
// holds work he will finish today." (design §8)
//
// DEALER GROUPS (2026-10-30, owner; mockup
// docs/mockups/floor-hold/hold-dealer-groups.html, layout (a)). The age bands
// and the Recent-first / Oldest-first toggle are GONE from this view: the list
// is one group per dealer (stopKey — lib/floor/hold-groups.ts), each under a
// ship-to block header copied from ship-to-blocks.tsx, the dealer with the
// newest hold on top and the newest hold first inside. The toolbar's
// [ All | Today · N ] shows only bills held today (IST) by a recorded hold event.
//
// The rows are drawn by the SHARED held-bills table, components/floor/hold-table.tsx,
// with its OPT-IN floor look (`look="floor"`, the SO / Area / Vol-KG columns,
// `columnWidths`, `showSelectAll={false}`). Freight Trips uses the same table
// with none of those and is unchanged. Everything Floor-only stays HERE: the
// groups, the Today filter, the release bar (bulk selection), row click →
// detail panel, and Export PDF (components/floor/pdf-preview.tsx — it still
// bands by age itself, unchanged).
//
// "Held since" reads FloorHoldRow.heldSince — the real wall-clock hold moment,
// derived on the read side (lib/floor/queries.ts getFloorHold + hold-log.ts), NOT
// orders.heldAt (the arrival date). An approximated value carries a "~" so it can
// never read as a recorded one.

import { useEffect, useMemo, useState } from "react";
import { Building2, FileText } from "lucide-react";
import { FloorSkeleton } from "./floor-skeleton";
import { HoldBar } from "./hold-bar";
import { HoldTable, type HoldColumn } from "./hold-table";
import { PdfPreview } from "./pdf-preview";
import { shipMarkers } from "./floor-table";
import { formatLitres, sumLitres } from "./status-pill";
import {
  holdKeysOf,
  holdUnits,
  isAllHoldKeysSelected,
  isPartialUnit,
  toggleAllHoldKeys,
  toggleKey,
  type FloorDeskKey,
  type SelectionUnit,
} from "@/lib/floor/selection";
import { groupHoldByDealer, isHeldToday, type HoldDealerGroup } from "@/lib/floor/hold-groups";
import { countArticles } from "@/lib/floor/format";
import type { FloorHoldRow } from "@/lib/floor/types";
import type { DispatchWindow } from "@/components/floor/dispatch-slot-picker";

/** The On hold tab's columns (owner 2026-10-30): the dealer is the group
 *  header, so no Ship to; no Type. */
const FLOOR_HOLD_COLUMNS: HoldColumn[] = ["obd", "invoice", "so", "area", "volKg", "article", "heldSince", "heldBy"];
/** Shares of the row after the 3% tick (sum 97) — sized so "1,020 L / 1,356 kg"
 *  and "Ajay Vansia" fit whole at 1,100px. */
const FLOOR_HOLD_WIDTHS: Partial<Record<HoldColumn, number>> = {
  obd: 15,
  invoice: 13,
  so: 13,
  area: 11,
  volKg: 9,
  article: 11,
  heldSince: 11,
  heldBy: 14,
};

export function HoldTab({
  rows,
  loading,
  error,
  scope,
  windows,
  onRelease,
  onOpenDetail,
  menuOpen,
  onMenuOpenChange,
  onOpenOffFloor,
  focusOrderId = null,
}: {
  rows: FloorHoldRow[] | null;
  loading: boolean;
  error: string | null;
  scope: string;
  windows: DispatchWindow[];
  /**
   * PER INVOICE (6.1): units, not ids — a split OBD's ticked held invoices
   * (`invoiceRowIds`, released per invoice, no slot) or a whole bill
   * (`invoiceRowIds` null — the slot release, as before). date / windowId are
   * null only when every unit is per invoice and no slot was picked.
   */
  onRelease: (units: SelectionUnit[], date: string | null, windowId: number | null) => Promise<void>;
  /** With the invoice's seq when a drawn invoice row of a split OBD was clicked (6.1). */
  onOpenDetail: (id: number, invoiceSeq?: number) => void;
  /** The bar's ··· More — owned by floor-page, the single Esc owner. */
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  /**
   * Open the Cancel / Raise CI form on these held bills. `keepTicked` is called
   * once a request goes through, with the bills that did NOT go — the only ones
   * left ticked. The selection is this tab's own, which is why it is handed in.
   */
  onOpenOffFloor: (rows: FloorHoldRow[], keepTicked: (orderIds: number[]) => void, units?: SelectionUnit[]) => void;
  /** The bill a search jump is landing on (floor-page searchFocus). When the
   *  Today filter would hide it, the filter switches back to All. */
  focusOrderId?: number | null;
}) {
  const [todayOnly, setTodayOnly] = useState(false);
  // orderIds, plus `inv:<id>` for a split OBD's held invoices (6.1).
  const [selection, setSelection] = useState<Set<FloorDeskKey>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);

  // A stable clock for this render pass — every age computation on screen agrees.
  const now = useMemo(() => new Date(), [rows]);
  const list = useMemo(() => rows ?? [], [rows]);
  const todayRows = useMemo(() => list.filter((r) => isHeldToday(r, now)), [list, now]);
  // What is ON SCREEN. Selection, the bar and every action read this, never the
  // whole list — a tick hidden by the Today filter must not be released.
  const shown = todayOnly ? todayRows : list;
  const groups = useMemo(() => groupHoldByDealer(shown), [shown]);

  // A search jump onto a bill Today would hide → back to All, so it can be lit.
  useEffect(() => {
    if (focusOrderId !== null && todayOnly && !todayRows.some((r) => r.orderId === focusOrderId)) setTodayOnly(false);
  }, [focusOrderId, todayOnly, todayRows]);

  // Counts stay in OBDs (owner, 2026-10-19): one unit per OBD, whole or part.
  const units = holdUnits(selection, shown);
  const unitIds = new Set(units.map((u) => u.orderId));
  const selectedRows = shown.filter((r) => unitIds.has(r.orderId));
  const selectedIds = selectedRows.map((r) => r.orderId);
  // The bar's figures — the same two helpers' meaning as the Floor tab's bar.
  const selectedArticles = countArticles(selectedRows.map((r) => r.articleTag)).pieces;
  const selectedRoutes = new Set(selectedRows.map((r) => r.route ?? "\u0000unrouted")).size;
  const clear = () => setSelection(new Set());
  // The menu lives on the bar; when the ticks go, the bar goes, and the menu
  // must not come back "open" with the next tick.
  useEffect(() => {
    if (selectedIds.length === 0 && menuOpen) onMenuOpenChange(false);
  }, [selectedIds.length, menuOpen, onMenuOpenChange]);

  // Switching to Today drops the ticks it hides (they could not be seen to be released).
  const showToday = (on: boolean) => {
    setTodayOnly(on);
    if (on) {
      const visible = new Set(todayRows.flatMap(holdKeysOf));
      setSelection((s) => new Set(Array.from(s).filter((k) => visible.has(k))));
    }
  };

  const doRelease = async (date: string | null, windowId: number | null) => {
    if (units.length === 0) return;
    setBusy(true);
    try {
      await onRelease(units, date, windowId);
      clear();
    } finally {
      setBusy(false);
    }
  };

  const segBtn = (on: boolean) => `px-[11px] text-[11px] ${on ? "bg-white font-semibold text-gray-900" : "text-gray-500"}`;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Toolbar — All / Today + Export PDF. */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-[#fcfcfd] px-3.5 py-[7px]">
        {!loading && !error && (
          <span className="text-[11px] text-gray-400">
            {todayOnly ? `${shown.length} of ${list.length} on hold` : `${list.length} on hold`}
            {scope !== "All" ? ` · ${scope}` : ""}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <span className="flex h-[27px] overflow-hidden rounded-[6px] border border-gray-200 bg-gray-50">
            <button type="button" onClick={() => showToday(false)} className={segBtn(!todayOnly)}>
              All
            </button>
            <button
              type="button"
              onClick={() => showToday(true)}
              className={segBtn(todayOnly)}
              title="Put on hold today (IST). Bills with a ~ approximate or unknown hold date are not counted."
            >
              Today · <span className="tabular-nums">{todayRows.length}</span>
            </button>
          </span>
          <button
            type="button"
            onClick={() => setPdfOpen(true)}
            disabled={list.length === 0}
            className="flex h-[27px] items-center gap-1.5 rounded-[6px] border border-gray-200 bg-white px-[10px] text-[11px] text-gray-500 hover:border-gray-300 hover:text-gray-700 disabled:opacity-40"
          >
            <FileText size={12} />
            Export PDF
          </button>
        </span>
      </div>
      {todayOnly && list.length > 0 && (
        <div className="border-b border-[#f0f0f0] bg-ink-25 px-3.5 py-1.5 text-[11px] text-ink-500">
          Only bills held today. ~ dates excluded.
        </div>
      )}

      {/* Body. Room at the bottom while the bar is up, so it never covers the
          last rows. */}
      <div className={`min-h-0 flex-1 overflow-y-auto ${selectedIds.length > 0 ? "pb-[84px]" : ""}`}>
        {loading ? (
          <FloorSkeleton variant="floor" />
        ) : error ? (
          <div className="px-5 py-14 text-center text-[11.5px] text-gray-400">Couldn&rsquo;t load the hold list. {error}</div>
        ) : list.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="text-[28px] leading-none text-[#22c55e]">✓</div>
            <h4 className="mt-2 text-[13px] font-semibold text-gray-900">
              {scope !== "All" ? `Nothing on hold for ${scope}` : "Nothing on hold"}
            </h4>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">Everything is either on the floor or waiting for you.</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="text-[28px] leading-none text-[#22c55e]">✓</div>
            <h4 className="mt-2 text-[13px] font-semibold text-gray-900">Nothing put on hold today.</h4>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
              Bills with a ~ approximate or unknown hold date are never counted as today.
            </p>
            <button
              type="button"
              onClick={() => showToday(false)}
              className="mt-1.5 text-[11.5px] font-semibold text-brand-700 hover:underline"
            >
              Show all {list.length} on hold
            </button>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.key}>
              <DealerHeader
                group={g}
                selection={selection}
                onToggleAll={() => setSelection((s) => toggleAllHoldKeys(s, g.rows))}
              />
              <HoldTable
                rows={g.rows}
                now={now}
                selection={selection}
                perInvoice
                look="floor"
                columns={FLOOR_HOLD_COLUMNS}
                columnWidths={FLOOR_HOLD_WIDTHS}
                showSelectAll={false}
                onToggleKey={(k) => setSelection((s) => toggleKey(s, k))}
                onToggleRow={(id) => setSelection((s) => toggleKey(s, id))}
                onToggleAll={(rs) => setSelection((s) => toggleAllHoldKeys(s, rs))}
                onOpenRow={onOpenDetail}
              />
            </div>
          ))
        )}
      </div>

      {selectedIds.length > 0 && (
        <HoldBar
          count={selectedIds.length}
          articles={selectedArticles}
          routes={selectedRoutes}
          windows={windows}
          busy={busy}
          onRelease={doRelease}
          onClear={clear}
          menuOpen={menuOpen}
          onMenuOpenChange={onMenuOpenChange}
          slotOptional={units.length > 0 && units.every(isPartialUnit)}
          // 6.3: a partial tick raises a CI per held invoice (the form offers
          // no Cancel), so the item is no longer greyed.
          onOffFloor={() =>
            onOpenOffFloor(
              selectedRows,
              (ids) => setSelection(new Set(shown.filter((r) => ids.includes(r.orderId)).flatMap(holdKeysOf))),
              units,
            )
          }
        />
      )}

      {pdfOpen && <PdfPreview rows={list} scope={scope} onClose={() => setPdfOpen(false)} />}
    </div>
  );
}

/**
 * The dealer group's header — ShipToBlockHeader's look (ship-to-blocks.tsx),
 * copied, not imported: that one reads board rows and desk keys, this one hold
 * rows and HOLD keys (holdKeysOf — a split OBD's held invoices only). Tick ·
 * name · ★ · site · → ship-to changed · billed to; on the right only
 * "{n} bills · {L} L" (owner 2026-10-30; gift litres excluded, as sumLitres).
 */
function DealerHeader({
  group,
  selection,
  onToggleAll,
}: {
  group: HoldDealerGroup;
  selection: ReadonlySet<FloorDeskKey>;
  onToggleAll: () => void;
}) {
  const { rows } = group;
  const allOn = isAllHoldKeysSelected(selection, rows);
  const someOn = !allOn && rows.some((r) => holdKeysOf(r).some((k) => selection.has(k)));
  const isKeyCustomer = rows.some((r) => r.isKeyCustomer);
  const isSite = rows.some((r) => shipMarkers(r).isSite);
  const isRedirect = rows.some((r) => r.isShipToOverride);
  // Billed to — said once when every site bill names the same bill-to.
  const billedTos = new Set(rows.filter((r) => shipMarkers(r).isSite).map((r) => r.billToName ?? ""));
  const billedTo = isSite && billedTos.size === 1 ? Array.from(billedTos)[0] || null : null;
  const litres = sumLitres(rows);
  return (
    <div className="flex flex-wrap items-baseline gap-[9px] border-b border-[#e7e7ee] pb-[7px] pl-3.5 pr-[18px] pt-5">
      <input
        type="checkbox"
        aria-label={`Select every held bill for ${group.name}`}
        className="h-[13px] w-[13px] shrink-0 cursor-pointer self-center accent-brand-600"
        checked={allOn}
        ref={(el) => {
          if (el) el.indeterminate = someOn;
        }}
        onChange={onToggleAll}
      />
      <span className="text-[16px] font-semibold text-[#1a1a22]">{group.name}</span>
      {isKeyCustomer && (
        <span className="text-[13px]" style={{ color: "#f59e0b" }} title="Key customer">
          ★
        </span>
      )}
      {isSite && (
        <span title="Site" className="self-center">
          <Building2 size={13} style={{ color: "#475569" }} />
        </span>
      )}
      {isRedirect && (
        <span className="self-center rounded-[5px] bg-[#f3edff] px-[7px] py-[2px] text-[10.5px] font-bold text-[#6d28d9]">
          → ship-to changed
        </span>
      )}
      {billedTo !== null && (
        <span className="text-[12.5px] text-[#96969f]">
          billed to <b className="font-semibold text-[#55556a]">{billedTo}</b>
        </span>
      )}
      <span className="ml-auto whitespace-nowrap text-[12.5px] tabular-nums text-[#96969f]">
        <b className="font-semibold text-[#55556a]">{rows.length}</b> {rows.length === 1 ? "bill" : "bills"} ·{" "}
        <b className="font-semibold text-[#55556a]">{formatLitres(litres)}</b> L
      </span>
    </div>
  );
}
