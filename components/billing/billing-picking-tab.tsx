"use client";

// Billing v2 — the "Picking" tab: the invoicing handoff.
// Mockup: docs/mockups/billing/billing-final-mockup.html (PICKING section).
//
// All-dates list of approved-but-uninvoiced bills → tick → Copy OBDs → Mark
// done → Done strip. Deliberately ALL DATES: 11 pending bills on 2026-07-30
// carried target dates of 20/21/22/25 Jul and NONE was today, so a today-fence
// would render an empty tab (verified read-only; see the FINDINGS addendum).
//
// Table follows the fixed-table standard (CLAUDE_UI §27): table-layout fixed,
// <colgroup> percentages, 31px header / 36px rows, ellipsis on overflow — the
// same constants Floor's tables use (components/floor/cancelled-tab.tsx).
//
// TEAL — two roles on this screen, and that is deliberate (confirmed
// 2026-07-30, precedent: the mobile Picking board, CLAUDE_UI §59.3):
//   1. the PRIMARY CTA, Copy OBDs (§10)
//   2. the LIVE count/dot — the Picking tab badge and the "live" pip
// The section-tab active pill stays gray-900 (Floor's tabPill), and row
// checkboxes use accent-teal-600 like every other data table in the app.
//
// A Pending row has TWO click targets (2026-08-08): the checkbox cell ticks it,
// anywhere else opens the detail panel
// (components/billing/billing-order-detail-panel.tsx). See the stopPropagation
// note on that cell — the two intents must not fire together.
//
// …UNLESS THE BILL CARRIES A CONFIRMED FINDING (2026-08-20), in which case it
// has ONE target: the whole row opens the panel, because it renders no checkbox
// at all. A bill the floor has confirmed short is never swept into a Copy OBDs →
// Mark done batch — the operator opens it, sees which line and who confirmed it,
// and marks it done from the panel. That panel's Mark done button is therefore
// the ONLY path to invoicing such a bill, and it works for every pending bill,
// flagged or not.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useBillingMarkerSubscription,
  useBillingMarkerPause,
} from "@/components/billing/billing-marker-provider";
import { getTodayIST } from "@/lib/dates";
import { smartTitleCase } from "@/lib/mail-orders/utils";
import { BillingOrderDetailPanel } from "@/components/billing/billing-order-detail-panel";
import { billingFlags, type BillingPickingList, type BillingPendingRow, type BillingDoneRow } from "@/lib/billing/types";

const LIST_URL = "/api/billing/picking/list";
// (MARKER_URL moved to billing-marker-provider.tsx with the poll itself — this
//  tab no longer talks to the marker endpoint directly.)

// Shared table constants — lifted verbatim from components/floor/cancelled-tab.tsx
// so the two boards cannot drift apart visually.
const HEAD_TH = "h-[31px] border-b border-[#ebebeb] px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const HEAD_TH_C = "h-[31px] border-b border-[#ebebeb] px-1 text-center text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const TD = "border-b border-[#f0f0f0] px-3.5 py-2 text-[11px] text-[#4b5563] whitespace-nowrap overflow-hidden text-ellipsis";
const TD_C = "border-b border-[#f0f0f0] px-1 py-2 text-center text-[11px]";

// ☐ 4 · # 5 · OBD 17 · Ship to 31 · Slot 10 · Vol 9 · Checked 13 · Flags 11 = 100
const PENDING_WIDTHS = [4, 5, 17, 31, 10, 9, 13, 11];
// OBD 17 · Ship to 30 · Slot 9 · Invoice no 20 · By 12 · Time 6 · Undo 6 = 100
const DONE_WIDTHS = [17, 30, 9, 20, 12, 6, 6];

function hhmm(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
}

/** "17h ago" / "2d ago" — the mockup's CHECKED column. */
function ago(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function slotLabel(row: { dispatchWindow: { windowTime: string; label: string | null } | null }): string {
  return row.dispatchWindow?.label ?? row.dispatchWindow?.windowTime ?? "";
}

function shipName(name: string | null): string {
  return name ? smartTitleCase(name) : "—";
}

/** "25 Jul" for the Done heading on a past day. Anchored at IST midnight — the
 *  same `${d}T00:00:00+05:30` construction mail-orders-page.tsx:1126 uses — so
 *  the label cannot slip a day on a machine running UTC. Same en-IN format the
 *  header stepper prints (components/header-date-stepper.tsx). */
function formatDayLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00+05:30`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

export function BillingPickingTab({ date }: { date?: string }) {
  const [data, setData] = useState<BillingPickingList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [doneOpen, setDoneOpen] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  // The bill whose read-only detail panel is open, or null. An ORDER ID, not a
  // row object — the panel fetches its own payload, so a list refetch under an
  // open panel cannot leave it rendering a stale copy of the row.
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);

  const reqRef = useRef(0);

  // Is the tab showing TODAY? Both the "no date given" case (the routes default
  // to today) and an explicit today read as true. Drives the Done heading and
  // the Undo gate below.
  const isToday = !date || date === getTodayIST();

  const load = useCallback(async () => {
    const seq = ++reqRef.current;
    try {
      // `?date=` scopes the DONE area only — Pending stays all-dates, server
      // side. Omitted when the parent passes nothing, which is byte-identical
      // to the request this tab made before the param existed.
      const url = date ? `${LIST_URL}?date=${encodeURIComponent(date)}` : LIST_URL;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        if (seq === reqRef.current) setError(`HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as BillingPickingList;
      if (seq !== reqRef.current) return;
      setData(body);
      setError(null);
    } catch {
      if (seq === reqRef.current) setError("Could not reach the server.");
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
    // `date` in the deps is what makes stepping the header re-fetch: the effect
    // below re-runs on a new `load` identity. The seq guard already discards a
    // slower in-flight response for the previous day.
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live sync — now off the SHARED marker (2026-08-10). This used to run its own
  // usePickingMarker against the same URL as BillingTabBar's, which meant two
  // independent timers probing one endpoint whenever this tab was open. The
  // single poll lives in BillingMarkerProvider, which also owns the `?date=`
  // (passed to it by ReviewView, the same `selectedDate` this tab receives) and
  // therefore the same re-baseline-on-day-change behaviour as before.
  useBillingMarkerSubscription(load);

  // PAUSED while a selection is open or a write is in flight: re-rendering the
  // list under a half-made selection is exactly the "ground moving under the
  // operator" failure the hook's `paused` flag exists for. Held under a named
  // key on the shared marker, and released on unmount, so this tab cannot leave
  // the tab bar's badge frozen after it closes. The deferred change still fires
  // once as soon as the selection clears.
  useBillingMarkerPause("picking-tab-selection", selection.size > 0 || busy);

  const pending = useMemo(() => data?.pending ?? [], [data]);
  const done = useMemo(() => data?.done ?? [], [data]);

  /**
   * The rows a batch may touch: pending MINUS every bill carrying a confirmed
   * finding (2026-08-20).
   *
   * 🔴 A FLAGGED BILL IS NEVER BULK-INVOICED. The floor has confirmed a line
   * short on it, so the operator has to open it, read WHICH line and WHO
   * confirmed it, and mark it done from the panel — a decision per bill, not a
   * sweep. Its row therefore renders no checkbox at all (PendingRow below), and
   * there is no click target left that could add its id.
   *
   * This list is the single source for every selection path — the header
   * checkbox, the per-row toggle and the guard on `selectedRows` — so a flagged
   * id cannot enter the Set through one path after being blocked on another.
   */
  const selectableRows = useMemo(() => pending.filter((r) => !r.hasFinding), [pending]);

  // Selection is a Set of order ids, so it survives a refetch/re-sort by
  // identity. Rows that vanished from the list are dropped here rather than
  // sent to the server as stale ids.
  //
  // ⚠ Derived from `selectableRows`, NOT `pending` — belt-and-braces. Nothing
  // should ever put a flagged id in the Set, but a bill can also acquire a
  // finding WHILE it sits ticked (the supervisor confirms one on the floor, the
  // marker refetches). Filtering here means the next refetch drops it from the
  // count, from Copy OBDs and from Mark done on its own, with no reconcile step.
  const selectedRows = useMemo(
    () => selectableRows.filter((r) => selection.has(r.id)),
    [selectableRows, selection],
  );
  const selectedIds = selectedRows.map((r) => r.id);
  const allOn =
    selectableRows.length > 0 && selectableRows.every((r) => selection.has(r.id));
  const litres = selectedRows.reduce((sum, r) => sum + (r.volume ?? 0), 0);

  const clear = () => setSelection(new Set());

  const toggleOne = (id: number) => {
    // Explicit refusal, not just an absent checkbox. The UI element is gone, so
    // this cannot fire today — it stays because the next caller (a keyboard
    // shortcut, a shift-range select) would otherwise reintroduce the hole
    // silently.
    if (!selectableRows.some((r) => r.id === id)) return;
    setSelection((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Select-all means select all SELECTABLE — a flagged bill is never added, and
  // "all on" is measured against the same list, so the header checkbox still
  // reads ticked on a list whose remaining rows are all flagged.
  const toggleAll = () =>
    setSelection((s) => {
      const next = new Set(s);
      if (selectableRows.every((r) => next.has(r.id))) {
        for (const r of selectableRows) next.delete(r.id);
      } else {
        for (const r of selectableRows) next.add(r.id);
      }
      return next;
    });

  // Newline-joined OBDs — the format SAP's paste box wants.
  const copyObds = async () => {
    if (selectedRows.length === 0) return;
    const text = selectedRows.map((r) => r.obdNumber).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setNotice("Couldn't reach the clipboard — copy blocked by the browser.");
    }
  };

  // POST → refetch. `updated` may be lower than `requested` when someone else
  // marked a bill (or SAP invoiced it) between render and click; that is
  // information, not an error, so it is surfaced rather than swallowed.
  const post = async (url: string, orderIds: number[]) => {
    if (orderIds.length === 0 || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds }),
      });
      const body = (await res.json().catch(() => ({}))) as { updated?: number; error?: string };
      if (!res.ok) {
        setNotice(body.error ?? `Failed (HTTP ${res.status}).`);
        return;
      }
      if (typeof body.updated === "number" && body.updated < orderIds.length) {
        setNotice(
          `${body.updated} of ${orderIds.length} updated — the rest had already moved on.`,
        );
      }
      clear();
      await load();
    } catch {
      setNotice("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const markDone = () => post("/api/billing/picking/mark-done", selectedIds);
  const undo = (id: number) => post("/api/billing/picking/undo", [id]);

  /**
   * The detail panel marked ONE bill done (2026-08-20). The panel owns that
   * write — it holds its own busy state and its own marker pause — so this is
   * only the aftermath: close, forget the id, refetch.
   *
   * `load()` and not `post()`: the write has already happened and been
   * acknowledged, and routing it back through `post()` would fire a second
   * POST. This is the same refresh `post()` ends with, reached directly.
   *
   * The `selection.delete` is tidiness, not correctness — `selectedRows` is
   * derived from the live list, so an id that has left `pending` stops counting
   * the moment the refetch lands either way. Doing it here just keeps the
   * "N selected" reading honest during the fetch. In practice a bill opened
   * from a flagged row was never selectable to begin with.
   */
  const handleDetailMarkedDone = useCallback(
    async (orderId: number) => {
      setDetailOrderId(null);
      setSelection((s) => {
        if (!s.has(orderId)) return s;
        const next = new Set(s);
        next.delete(orderId);
        return next;
      });
      setNotice(null);
      await load();
    },
    [load],
  );

  // The Done area's two halves. `marked` is what the operator did; `invoiced`
  // is what SAP had already done before the floor finished checking — carried
  // for information only (BillingDoneRow.kind, lib/billing/types.ts).
  const markedCount = useMemo(
    () => done.filter((r) => r.kind === "marked").length,
    [done],
  );
  const alreadyInvoicedCount = useMemo(
    () => done.filter((r) => r.kind === "invoiced").length,
    [done],
  );

  // "Deepanshu 19 · Bankim 15" — who invoiced what today.
  //
  // ⚠ MARKED ROWS ONLY. An already-invoiced row has no `invoicedBy` (nobody on
  // this screen acted on it), so counting it here would file every one of them
  // under "Unknown" and make the tally read as a mystery operator's work.
  const doneTally = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of done) {
      if (row.kind !== "marked") continue;
      const who = row.invoicedBy?.name ?? "Unknown";
      counts.set(who, (counts.get(who) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name.split(" ")[0]} ${n}`)
      .join(" · ");
  }, [done]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      {/* Header strip — count + live marker. */}
      <div className="flex items-center gap-3 border-b border-[#f0f0f0] px-[18px] py-[11px]">
        <span className="text-[12.5px] font-bold text-gray-800">
          {loading ? "Loading…" : `${pending.length} bill${pending.length === 1 ? "" : "s"} ready to invoice`}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-teal-700">
          <span className="h-[7px] w-[7px] rounded-full bg-teal-600 ring-[3px] ring-teal-600/15" />
          live
        </span>
      </div>

      {notice && (
        <div className="border-b border-amber-200 bg-amber-50 px-[18px] py-2 text-[11.5px] text-amber-700">
          {notice}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ── Pending ─────────────────────────────────────────────────────── */}
        {error ? (
          <div className="px-5 py-14 text-center text-[11.5px] text-gray-400">
            Couldn&rsquo;t load the billing list. {error}
          </div>
        ) : loading ? (
          <div className="px-5 py-14 text-center text-[11.5px] text-gray-400">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="text-[28px] leading-none text-[#22c55e]">✓</div>
            <h4 className="mt-2 text-[13px] font-semibold text-gray-900">Nothing waiting to be invoiced</h4>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
              Every approved bill has been marked done.
            </p>
          </div>
        ) : (
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              {PENDING_WIDTHS.map((w, i) => (
                <col key={i} style={{ width: `${w}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className={HEAD_TH_C}>
                  {/* Disabled — not hidden — when every pending bill is
                      flagged: the column keeps its header, and a control that
                      cannot do anything does not silently no-op under the
                      cursor. */}
                  <input
                    type="checkbox"
                    aria-label="Select all bills ready to invoice"
                    className="h-[13px] w-[13px] cursor-pointer align-middle accent-teal-600 disabled:cursor-not-allowed disabled:opacity-40"
                    checked={allOn}
                    disabled={selectableRows.length === 0}
                    onChange={toggleAll}
                  />
                </th>
                <th className={HEAD_TH_C}>#</th>
                <th className={HEAD_TH}>OBD</th>
                <th className={HEAD_TH}>Ship to</th>
                <th className={HEAD_TH}>Slot</th>
                <th className={HEAD_TH}>Vol</th>
                <th className={HEAD_TH}>Checked</th>
                <th className={HEAD_TH}>Flags</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((row, i) => (
                <PendingRow
                  key={row.id}
                  row={row}
                  index={i + 1}
                  selected={selection.has(row.id)}
                  onToggle={() => toggleOne(row.id)}
                  onOpen={() => setDetailOrderId(row.id)}
                />
              ))}
            </tbody>
          </table>
        )}

        {/* ── Done strip ──────────────────────────────────────────────────── */}
        <div className="mt-2 border-t border-gray-200">
          <button
            type="button"
            onClick={() => setDoneOpen((v) => !v)}
            className="flex w-full items-center gap-2.5 bg-gray-50 px-[18px] py-[11px] text-left text-[12px] text-gray-600 hover:bg-gray-100"
          >
            <span className="text-[10px] text-gray-400">{doneOpen ? "▾" : "▸"}</span>
            {/* On today this is the original "Done today". On any other day it
                names the day, because the Pending list above it is still
                ALL-DATES — without the label a stepped-back Done area looks
                like the whole tab moved. */}
            <span className="font-bold text-gray-800">
              {isToday ? "Done today" : `Done · ${formatDayLabel(date!)}`}
            </span>
            {/* Two different facts, never added together: what the operator
                marked, and what SAP had already invoiced before the check. The
                second segment is omitted at zero rather than printed as "0
                already invoiced". */}
            <span>&middot; {markedCount} invoiced</span>
            {alreadyInvoicedCount > 0 && (
              <span>&middot; {alreadyInvoicedCount} already invoiced</span>
            )}
            {doneTally && <span className="ml-auto text-[11px] text-gray-400">{doneTally}</span>}
          </button>

          {doneOpen && done.length > 0 && (
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                {DONE_WIDTHS.map((w, i) => (
                  <col key={i} style={{ width: `${w}%` }} />
                ))}
              </colgroup>
              <tbody>
                {done.map((row) => (
                  <DoneRow
                    key={row.id}
                    row={row}
                    busy={busy}
                    isToday={isToday}
                    onUndo={() => undo(row.id)}
                  />
                ))}
              </tbody>
            </table>
          )}
          {doneOpen && done.length === 0 && (
            <div className="px-[18px] py-6 text-center text-[11.5px] text-gray-400">
              {isToday ? "Nothing invoiced yet today." : "Nothing recorded on this day."}
            </div>
          )}
        </div>

        {/* Breathing room so the bulk bar never covers the last row. */}
        {selectedIds.length > 0 && <div className="h-[60px]" />}
      </div>

      {/* ── Bulk bar ──────────────────────────────────────────────────────── */}
      {selectedIds.length > 0 && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex h-[60px] items-center border-t border-gray-200 bg-white px-[18px] shadow-[0_-6px_18px_-12px_rgba(0,0,0,0.25)]">
          <div className="flex min-w-0 items-center gap-[7px]">
            <span className="whitespace-nowrap text-[13px] font-semibold text-gray-900">
              {selectedIds.length} selected
            </span>
            <button
              type="button"
              onClick={clear}
              aria-label="Clear selection"
              title="Clear selection"
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <span className="truncate whitespace-nowrap text-[11px] text-gray-400">
              &middot; {litres.toLocaleString("en-US")} L
            </span>
          </div>

          <div className="ml-auto flex items-center gap-[10px]">
            {/* Copy OBDs is the PRIMARY CTA and therefore teal (CLAUDE_UI §10),
                matching the approved mockup's .btn.primary. Mark done is the
                mockup's .btn.ghost — the operator copies into SAP first, then
                marks done, so copy leads. */}
            <button
              type="button"
              onClick={copyObds}
              className="inline-flex h-[34px] items-center gap-2 rounded-md bg-teal-600 px-[15px] text-[12px] font-semibold text-white transition-colors hover:bg-teal-700"
            >
              {copied ? "Copied" : "Copy OBDs"}
            </button>
            <button
              type="button"
              onClick={markDone}
              disabled={busy}
              className="inline-flex h-[34px] items-center gap-2 rounded-md border border-gray-300 bg-white px-[13px] text-[12px] font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50"
            >
              {busy ? "Marking…" : "Mark done"}
            </button>
          </div>
        </div>
      )}

      {/* ── Detail panel ──────────────────────────────────────────────────── */}
      {/* Mounted OUTSIDE the bulk bar, and CLOSING it still touches nothing:
          the operator returns to exactly the list state they left, half-made
          tick set intact. Its one write — Mark done on a single bill
          (2026-08-20) — reports back through `onMarkedDone` rather than
          reaching into selection itself. Keyed on the order id so opening a
          different bill remounts rather than showing the previous bill's lines
          while the new ones load. */}
      {detailOrderId !== null && (
        <BillingOrderDetailPanel
          key={detailOrderId}
          orderId={detailOrderId}
          onClose={() => setDetailOrderId(null)}
          onMarkedDone={handleDetailMarkedDone}
        />
      )}
    </div>
  );
}

/**
 * One pending row.
 *
 * SHORTAGE TINT (2026-08-08). A bill with a supervisor-CONFIRMED shortage takes
 * a light red wash across the WHOLE row plus a 3px red left edge. The server
 * decides — `row.hasConfirmedShortage`, which means `recordedById IS NOT NULL`
 * and nothing else (lib/billing/types.ts); this component never re-derives it.
 *
 * ⚠ THE TINT LIVES ON EACH `<td>`, NOT ON THE `<tr>`. Every cell here carries
 * its own `border-b` from the TD/TD_C constants, and a background painted on the
 * row sits BEHIND those borders — on a table-layout:fixed table the wash then
 * reads as banded rather than solid. Setting it per cell is what makes it one
 * continuous block. Same reason the left edge is a `border-l` on the FIRST cell
 * rather than an outline on the row.
 *
 * SELECTION STILL WINS. A ticked row keeps its teal wash even when short: the
 * operator is mid-action, and the selection has to stay legible as the thing
 * they are about to copy into SAP. The red left edge survives either way, so the
 * bill never stops announcing itself — it just stops shouting while being acted
 * on. Two washes stacked would muddy into brown and read as neither.
 */
function PendingRow({
  row,
  index,
  selected,
  onToggle,
  onOpen,
}: {
  row: BillingPendingRow;
  index: number;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const flags = billingFlags(row);
  const short = row.hasConfirmedShortage;
  // Server-decided, same batched read as `short` — never re-derived here.
  const flagged = row.hasFinding;
  // Appended to every cell's class. Empty on an ordinary row, so a bill with no
  // finding renders byte-identically to before this feature existed.
  const cell = short && !selected ? " bg-red-50" : "";
  return (
    <tr
      onClick={onOpen}
      className={`cursor-pointer ${selected ? "bg-teal-50/60" : short ? "" : "hover:bg-[#fafafa]"}`}
    >
      {/* ⚠ THE CHECKBOX CELL SWALLOWS THE CLICK — on a SELECTABLE row only.
          Ticking a row and opening a row are different intents, and the tick is
          the one that leads to a WRITE (Copy OBDs → Mark done). Without this
          stop, every tick would also throw a panel over the list the operator is
          working down, and a bulk-select drag would open one bill after another.
          `onClick` on the cell, not the input: the label-sized hit area around a
          13px checkbox is most of what a thumb actually lands on.

          🔴 ON A FLAGGED ROW THE STOP IS REMOVED WITH THE CHECKBOX. There is no
          longer a competing intent in this cell, and leaving the stop behind
          would carve a dead 4%-wide strip out of the only row whose panel the
          operator MUST open — the click would land on the one cell that eats it
          and nothing would happen. `undefined`, not a no-op handler, so the
          click reaches the row's own onOpen by ordinary bubbling. */}
      <td
        onClick={flagged ? undefined : (e) => e.stopPropagation()}
        className={`${TD_C}${cell}${short ? " border-l-[3px] border-l-red-500" : ""}`}
      >
        {flagged ? (
          /* NOT a disabled checkbox — genuinely absent. A greyed tickbox reads
             as "try again later"; this bill is never going into a batch, and the
             control should not exist to be argued with.

             AMBER, per CLAUDE_UI §3's semantic table (Waiting = amber-50 /
             amber-200 / amber-700): this bill is waiting on a person to look at
             it. Not violet — that is the Done strip's "Already invoiced" badge
             in this same tab (§23.4) — and not teal, which here means the
             primary CTA and the live pip.

             Occupies the 13px the checkbox did, so the column, the header tick
             and every other row stay exactly where they were. The `title`
             carries the WHY: a missing control has to explain itself, or it
             reads as a bug. */
          <span
            title="Confirmed finding on this bill — open it and mark it done from the bill"
            aria-label="Not selectable: confirmed finding — mark done from the bill"
            className="inline-flex h-[13px] w-[13px] items-center justify-center rounded-[3px] border border-amber-200 bg-amber-50 align-middle text-[9px] font-bold leading-none text-amber-700"
          >
            !
          </span>
        ) : (
          <input
            type="checkbox"
            aria-label={`Select ${row.obdNumber}`}
            className="h-[13px] w-[13px] cursor-pointer align-middle accent-teal-600"
            checked={selected}
            onChange={onToggle}
          />
        )}
      </td>
      <td className={`${TD_C} text-gray-400${cell}`}>{index}</td>
      <td className={`${TD} font-medium text-gray-800${cell}`} style={{ fontVariantNumeric: "tabular-nums" }}>
        {row.obdNumber}
      </td>
      <td className={`${TD} font-semibold text-gray-900${cell}`}>
        {shipName(row.shipToName)}
        {row.shipToOverridden && (
          <span
            title="Ship-to overridden by Support"
            className="ml-1.5 rounded border border-amber-200 bg-amber-50 px-1 py-px text-[9px] font-bold text-amber-700"
          >
            ⚑
          </span>
        )}
      </td>
      <td className={`${TD}${cell}`}>
        {slotLabel(row) && (
          <span className="rounded border border-gray-200 bg-gray-100 px-1.5 py-px text-[10.5px] font-semibold text-gray-600" style={{ fontVariantNumeric: "tabular-nums" }}>
            {slotLabel(row)}
          </span>
        )}
      </td>
      <td className={`${TD} text-gray-700${cell}`} style={{ fontVariantNumeric: "tabular-nums" }}>
        {row.volume ?? 0} <span className="text-[10px] text-gray-400">L</span>
      </td>
      <td className={`${TD} text-gray-400${cell}`}>{ago(row.checkedAt)}</td>
      <td className={`${TD}${cell}`}>
        {flags.map((f) => (
          <span
            key={f}
            className="mr-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-px text-[9px] font-bold text-amber-700"
          >
            {f}
          </span>
        ))}
        {/* ⚠ ICON ONLY — never a "SHORT" text pill. This column is 11% of a
            table-layout:fixed table and already carries up to two pills
            (TINT + STOCK TFR); a third text pill would push one out through the
            cell's ellipsis and silently lose a flag the operator needs. A bare
            glyph costs ~10px and cannot do that.
            ADDITIVE, never a replacement: it renders ALONGSIDE whatever flags
            are already there, because "this bill is short" and "this bill is a
            stock transfer" are unrelated facts and neither substitutes for the
            other. `title` carries the meaning on hover — the glyph alone is
            recognisable but not self-explaining, and this row has no
            drill-through yet. */}
        {short && (
          <span
            title="Shortage confirmed by the supervisor"
            aria-label="Shortage confirmed"
            className="align-middle text-[11px] font-bold leading-none text-red-600"
          >
            ⚠
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * One row of the Done area, in either of its two kinds.
 *
 *   "marked"   — the operator invoiced it here. Unchanged from before this
 *                component learned about kinds.
 *   "invoiced" — SAP had already invoiced the bill by the time the floor
 *                checked it. INFORMATION ONLY: it is not in `pending`, so it
 *                can never be selected, copied or marked done (selection is
 *                derived from `pending` alone), and it renders NO Undo. It is
 *                here because such a bill used to match neither list and
 *                disappeared from this screen entirely.
 *
 * The kind is read from the server's discriminator, never re-derived from
 * `invoiceNo`/`invoicedAt` — a marked row still awaiting its SAP number looks
 * confusingly similar (lib/billing/types.ts).
 */
function DoneRow({
  row,
  busy,
  isToday,
  onUndo,
}: {
  row: BillingDoneRow;
  busy: boolean;
  /** Undo is a today-only server action — see the Undo cell below. */
  isToday: boolean;
  onUndo: () => void;
}) {
  const info = row.kind === "invoiced";
  return (
    <tr className="bg-gray-50">
      <td className={`${TD} pl-[18px] font-medium text-gray-800`} style={{ fontVariantNumeric: "tabular-nums" }}>
        {row.obdNumber}
      </td>
      <td className={`${TD} font-semibold text-gray-900`}>{shipName(row.shipToName)}</td>
      <td className={TD}>
        {slotLabel(row) && (
          <span className="rounded border border-gray-200 bg-gray-100 px-1.5 py-px text-[10.5px] font-semibold text-gray-600" style={{ fontVariantNumeric: "tabular-nums" }}>
            {slotLabel(row)}
          </span>
        )}
      </td>
      <td className={TD}>
        {info ? (
          <>
            <span className="text-gray-800" style={{ fontVariantNumeric: "tabular-nums" }}>{row.invoiceNo}</span>{" "}
            {/* Violet — the CLAUDE_UI signal-pill token (§ pill table), and
                already this screen's accent family (the instructions strip and
                the Notes button). Distinct from every other state on this row:
                amber is "awaiting SAP", green is done, teal is the CTA and the
                live pip. Same pill geometry as the amber one below, so the two
                read as one family of states. */}
            <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-px text-[9.5px] font-semibold text-violet-700">
              Already invoiced
            </span>
          </>
        ) : row.invoiceNo ? (
          <span className="text-gray-800" style={{ fontVariantNumeric: "tabular-nums" }}>{row.invoiceNo}</span>
        ) : (
          <>
            <span className="tracking-[2px] text-gray-300">———</span>{" "}
            {/* Measured cadence: SAP lands invoice numbers in batches ~every
                30-45 min through the working day, so this is a REAL state a
                bill sits in for tens of minutes — never a flicker. It promises
                no duration on purpose. */}
            <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-px text-[9.5px] font-semibold text-amber-700">
              awaiting SAP
            </span>
          </>
        )}
      </td>
      {/* WHO. On an informational row there is no invoicedBy — nobody here
          acted on it — so it names the supervisor who CHECKED it, which is the
          only person who touched the bill that day. */}
      <td className={`${TD} text-[10.5px] text-gray-500`}>
        {info ? (row.checkedByName ?? "—") : (row.invoicedBy?.name ?? "")}
      </td>
      {/* WHEN. Same hhmm formatter either way — the check time on an
          informational row (its `invoicedAt` is null by predicate), the
          mark-done time on a marked one. */}
      <td className={`${TD} text-gray-400`}>{hhmm(info ? row.checkedAt : row.invoicedAt)}</td>
      <td className={TD_C}>
        {/* Undo is offered ONLY while invoiceNo is still null — mirroring the
            server guard in app/api/billing/picking/undo/route.ts. Once SAP has
            invoiced the bill the action is genuinely unavailable, so the button
            must not be there to click.
            `!info` is belt-and-braces: an informational row always carries an
            invoiceNo, so the existing test already excludes it.
            `isToday` closes the other half. The server's undo window is TODAY
            (undo/route.ts:77) and that scope is deliberate — so on a stepped-
            back day the button would post, match zero rows and report "0 of 1
            updated". A control that cannot work must not be offered. */}
        {!info && isToday && row.invoiceNo === null && (
          <button
            type="button"
            onClick={onUndo}
            disabled={busy}
            className="text-[11px] font-semibold text-teal-700 hover:underline disabled:opacity-50"
          >
            Undo
          </button>
        )}
      </td>
    </tr>
  );
}
