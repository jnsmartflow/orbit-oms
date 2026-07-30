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
// TEAL: the live dot in the tab bar is the one teal element of this screen
// (CLAUDE_UI §1). The primary action here is gray-900, not teal. Row checkboxes
// use accent-teal-600 to match every other data table in the app.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePickingMarker } from "@/lib/hooks/use-picking-marker";
import { smartTitleCase } from "@/lib/mail-orders/utils";
import { billingFlags, type BillingPickingList, type BillingPendingRow, type BillingDoneRow } from "@/lib/billing/types";

const LIST_URL = "/api/billing/picking/list";
const MARKER_URL = "/api/billing/picking/marker";

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

export function BillingPickingTab() {
  const [data, setData] = useState<BillingPickingList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [doneOpen, setDoneOpen] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++reqRef.current;
    try {
      const res = await fetch(LIST_URL, { cache: "no-store" });
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live sync. PAUSED while a selection is open: re-rendering the list under a
  // half-made selection is exactly the "ground moving under the operator"
  // failure the hook's `paused` flag exists for. The deferred change fires once
  // as soon as the selection is cleared.
  usePickingMarker({
    scope: "openPending",
    url: MARKER_URL,
    paused: selection.size > 0 || busy,
    onChange: () => void load(),
  });

  const pending = useMemo(() => data?.pending ?? [], [data]);
  const done = useMemo(() => data?.done ?? [], [data]);

  // Selection is a Set of order ids, so it survives a refetch/re-sort by
  // identity. Rows that vanished from the list are dropped here rather than
  // sent to the server as stale ids.
  const selectedRows = useMemo(
    () => pending.filter((r) => selection.has(r.id)),
    [pending, selection],
  );
  const selectedIds = selectedRows.map((r) => r.id);
  const allOn = pending.length > 0 && pending.every((r) => selection.has(r.id));
  const litres = selectedRows.reduce((sum, r) => sum + (r.volume ?? 0), 0);

  const clear = () => setSelection(new Set());

  const toggleOne = (id: number) =>
    setSelection((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelection((s) => {
      const next = new Set(s);
      if (pending.every((r) => next.has(r.id))) {
        for (const r of pending) next.delete(r.id);
      } else {
        for (const r of pending) next.add(r.id);
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

  // "Deepanshu 19 · Bankim 15" — who invoiced what today.
  const doneTally = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of done) {
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
                  <input
                    type="checkbox"
                    aria-label="Select all bills ready to invoice"
                    className="h-[13px] w-[13px] cursor-pointer align-middle accent-teal-600"
                    checked={allOn}
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
            <span className="font-bold text-gray-800">Done today</span>
            <span>&middot; {done.length} invoiced</span>
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
                  <DoneRow key={row.id} row={row} busy={busy} onUndo={() => undo(row.id)} />
                ))}
              </tbody>
            </table>
          )}
          {doneOpen && done.length === 0 && (
            <div className="px-[18px] py-6 text-center text-[11.5px] text-gray-400">
              Nothing invoiced yet today.
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
            <button
              type="button"
              onClick={copyObds}
              className="inline-flex h-[34px] items-center gap-2 rounded-md border border-gray-300 bg-white px-[13px] text-[12px] font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
            >
              {copied ? "Copied" : "Copy OBDs"}
            </button>
            <button
              type="button"
              onClick={markDone}
              disabled={busy}
              className="inline-flex h-[34px] items-center gap-2 rounded-md bg-gray-900 px-[15px] text-[12px] font-semibold text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
            >
              {busy ? "Marking…" : "Mark done"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PendingRow({
  row,
  index,
  selected,
  onToggle,
}: {
  row: BillingPendingRow;
  index: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const flags = billingFlags(row);
  return (
    <tr className={selected ? "bg-teal-50/60" : "hover:bg-[#fafafa]"}>
      <td className={TD_C}>
        <input
          type="checkbox"
          aria-label={`Select ${row.obdNumber}`}
          className="h-[13px] w-[13px] cursor-pointer align-middle accent-teal-600"
          checked={selected}
          onChange={onToggle}
        />
      </td>
      <td className={`${TD_C} text-gray-400`}>{index}</td>
      <td className={`${TD} font-medium text-gray-800`} style={{ fontVariantNumeric: "tabular-nums" }}>
        {row.obdNumber}
      </td>
      <td className={`${TD} font-semibold text-gray-900`}>
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
      <td className={TD}>
        {slotLabel(row) && (
          <span className="rounded border border-gray-200 bg-gray-100 px-1.5 py-px text-[10.5px] font-semibold text-gray-600" style={{ fontVariantNumeric: "tabular-nums" }}>
            {slotLabel(row)}
          </span>
        )}
      </td>
      <td className={`${TD} text-gray-700`} style={{ fontVariantNumeric: "tabular-nums" }}>
        {row.volume ?? 0} <span className="text-[10px] text-gray-400">L</span>
      </td>
      <td className={`${TD} text-gray-400`}>{ago(row.checkedAt)}</td>
      <td className={TD}>
        {flags.map((f) => (
          <span
            key={f}
            className="mr-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-px text-[9px] font-bold text-amber-700"
          >
            {f}
          </span>
        ))}
      </td>
    </tr>
  );
}

function DoneRow({
  row,
  busy,
  onUndo,
}: {
  row: BillingDoneRow;
  busy: boolean;
  onUndo: () => void;
}) {
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
        {row.invoiceNo ? (
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
      <td className={`${TD} text-[10.5px] text-gray-500`}>{row.invoicedBy?.name ?? ""}</td>
      <td className={`${TD} text-gray-400`}>{hhmm(row.invoicedAt)}</td>
      <td className={TD_C}>
        {/* Undo is offered ONLY while invoiceNo is still null — mirroring the
            server guard in app/api/billing/picking/undo/route.ts. Once SAP has
            invoiced the bill the action is genuinely unavailable, so the button
            must not be there to click. */}
        {row.invoiceNo === null && (
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
