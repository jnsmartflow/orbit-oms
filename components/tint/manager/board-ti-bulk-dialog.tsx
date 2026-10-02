"use client";

// Tint Manager — the bulk white-shot confirm (2026-10-02, docs/prompts/drafts/
// code-discovery-2026-10-02-bulk-tinter-issue.md §G step 3, §I; locked mockup
// docs/mockups/tint-manager/tint-manager-ti-bulk-mockup.html "confirm").
//
// Opened by a WHT 5 / 20 / 25 button on the TI tab's bottom bar. Shows EXACTLY
// what will be written, grouped by bill: a grey header row per OBD (number +
// ship-to, tins on the right), then its owed lines — SKU · Description · Pack ·
// Shot · Sampling · Qty — and a Total row. The data is the TI list's own
// payload (GET /api/tint/manager/base-pending — the lines it already carries),
// so what is shown is what the list shows; the SERVER re-derives every line and
// re-verifies the shot before writing (app/api/tint/manager/ti-bulk).
//
// The shot's number comes from lib/tint/white-shots.ts — never retyped here.
// Write TI posts once; the toast names what happened per bill, in the server's
// words. Two stages, the CLAUDE_UI §13 pattern: the bar button is the first,
// this dialog's Write TI the second.
//
// ⚠ NO KEY LISTENER — tint-manager-content.tsx is the single Esc owner; it
// closes this through onClose (refused while busy, via onBusyChange).
// ⚠ A modal over the whole page (fixed, bg-black/40, z-[120]) like the other
// bar dialogs, so the bar's buttons are under the scrim.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BAR_PRIMARY, BAR_SECONDARY } from "@/components/floor/floor-action-bar";
import { whiteShotFor, type WhiteShotDose } from "@/lib/tint/white-shots";
import { owedLines } from "./board-ti-tab";
import type { BasePendingOrder } from "./types";

export function BoardTiBulkDialog({
  bills,
  dose,
  onDone,
  onBusyChange,
  onClose,
}: {
  bills:        BasePendingOrder[];
  dose:         WhiteShotDose;
  /** Something was written — the page clears the selection and reloads. */
  onDone:       () => void;
  onBusyChange: (busy: boolean) => void;
  onClose:      () => void;
}) {
  const [busy, setBusyState] = useState(false);
  const [error, setError]    = useState<string | null>(null);
  const setBusy = (b: boolean) => { setBusyState(b); onBusyChange(b); };
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const shot = whiteShotFor(dose);
  const groups = bills
    .map((b) => ({ bill: b, lines: owedLines(b) }))
    .filter((g) => g.lines.length > 0);
  const lineCount = groups.reduce((n, g) => n + g.lines.length, 0);
  const tins = groups.reduce((n, g) => n + g.lines.reduce((m, l) => m + l.unitQty, 0), 0);
  const obdOf = (orderId: number) => bills.find((b) => b.orderId === orderId)?.obdNumber ?? `#${orderId}`;

  async function write() {
    if (busy || !shot || lineCount === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tint/manager/ti-bulk", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ tintAssignmentIds: groups.map((g) => g.bill.tintAssignmentId), dose }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        done?: Array<{ orderId: number; lines: number }>;
        failed?: Array<{ orderId: number; rawLineItemId?: number; error: string }>;
        skipped?: Array<{ orderId: number; rawLineItemId?: number; reason: string }>;
        closed?: number[];
      };
      if (!Array.isArray(body.done)) {
        // 400 / 403 / 500 — the whole request was refused; nothing was written.
        setError(body.error ?? `Could not save — HTTP ${res.status}`);
        return;
      }
      const written = body.done.reduce((n, d) => n + d.lines, 0);
      const closed  = body.closed?.length ?? 0;
      const failed  = body.failed ?? [];
      const skipped = body.skipped ?? [];
      const detail = [
        ...failed.map((f) => `${f.orderId ? obdOf(f.orderId) : "—"}: ${f.error}`),
        ...skipped.map((s) => `${obdOf(s.orderId)}: ${s.reason}`),
      ];
      const head = `WHT ${dose} written on ${written} ${written === 1 ? "line" : "lines"} · ${closed} ${closed === 1 ? "bill" : "bills"} closed` +
        (skipped.length > 0 ? ` · ${skipped.length} skipped` : "") +
        (failed.length > 0 ? ` · ${failed.length} failed` : "");
      const opts = detail.length > 0 ? { description: detail.join("\n"), duration: 10000 } : undefined;
      if (written === 0 && failed.length > 0) toast.error(head, opts);
      else if (failed.length > 0 || skipped.length > 0) toast.warning(head, opts);
      else toast.success(head, opts);
      if (written > 0) onDone();
      onClose();
    } catch {
      setError("Could not reach the server — check your connection, then press Write TI again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={busy ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-[1040px] max-w-[calc(100%-32px)] rounded-2xl bg-white px-5 py-[18px] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[17px] font-bold text-ink-900">
          Write WHT {dose} · <span className="font-mono text-[15px]">{shot?.samplingNo}</span> on {lineCount}{" "}
          {lineCount === 1 ? "line" : "lines"} of {groups.length} {groups.length === 1 ? "bill" : "bills"}?
        </h3>
        <p className="mt-1 mb-3 text-[12px] text-ink-500">
          Same sampling number on every line. Same WHT {dose} on every tin size (fixed dose, not multiplied).
          Lines that already have a TI are skipped.
        </p>

        <div className="max-h-[min(560px,62vh)] overflow-auto rounded-xl border border-[#EEEDF3] px-1">
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }} className="text-[12.5px]">
            <colgroup>
              <col style={{ width: "14%" }} /><col style={{ width: "40%" }} /><col style={{ width: "10%" }} />
              <col style={{ width: "12%" }} /><col style={{ width: "14%" }} /><col style={{ width: "10%" }} />
            </colgroup>
            <thead>
              <tr className="text-left text-[10.5px] font-semibold uppercase tracking-[.04em] text-ink-400">
                <th className="sticky top-0 z-10 bg-white px-3 py-2.5">SKU</th>
                <th className="sticky top-0 z-10 bg-white px-3 py-2.5">Description</th>
                <th className="sticky top-0 z-10 bg-white px-3 py-2.5">Pack</th>
                <th className="sticky top-0 z-10 bg-white px-3 py-2.5">Shot</th>
                <th className="sticky top-0 z-10 bg-white px-3 py-2.5">Sampling</th>
                <th className="sticky top-0 z-10 bg-white px-3 py-2.5 text-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gi) => {
                const billTins = g.lines.reduce((m, l) => m + l.unitQty, 0);
                return [
                  gi > 0 && <tr key={`gap-${g.bill.tintAssignmentId}`}><td colSpan={6} className="h-3 p-0" /></tr>,
                  <tr key={`og-${g.bill.tintAssignmentId}`} className="bg-ink-50">
                    <td colSpan={5} className="rounded-l-lg border-y border-ink-100 px-3 py-2.5">
                      <span className="font-mono text-[13px] font-bold text-ink-900">{g.bill.obdNumber}</span>
                      <span className="ml-2.5 font-semibold text-ink-700">{g.bill.shipToName}</span>
                    </td>
                    <td className="rounded-r-lg border-y border-ink-100 px-3 py-2.5 text-right text-ink-500">
                      {billTins} {billTins === 1 ? "tin" : "tins"}
                    </td>
                  </tr>,
                  ...g.lines.map((l) => (
                    <tr key={`li-${l.rawLineItemId}`} className="border-b border-[#EEEDF3]">
                      <td className="py-[11px] pl-6 pr-3 font-mono text-[12px]">{l.skuCodeRaw}</td>
                      <td className="px-3 py-[11px]">{l.skuDescriptionRaw ?? "—"}</td>
                      <td className="px-3 py-[11px]">{l.packCode ?? "?"}</td>
                      <td className="px-3 py-[11px]"><b>WHT {dose}</b></td>
                      <td className="px-3 py-[11px]">
                        <span className="rounded-[5px] bg-ok-bg px-[7px] py-px font-mono text-[11px] font-semibold text-ok-text">{shot?.samplingNo}</span>
                      </td>
                      <td className="px-3 py-[11px] text-right"><b>{l.unitQty}</b></td>
                    </tr>
                  )),
                ];
              })}
              <tr><td colSpan={6} className="h-3 p-0" /></tr>
              <tr className="font-semibold text-ink-600">
                <td colSpan={5} className="border-t-2 border-ink-100 px-3 pt-3 pb-2 text-right">
                  Total · {lineCount} {lineCount === 1 ? "line" : "lines"} · {groups.length} {groups.length === 1 ? "bill" : "bills"}
                </td>
                <td className="border-t-2 border-ink-100 px-3 pt-3 pb-2 text-right"><b className="text-ink-900">{tins}</b></td>
              </tr>
            </tbody>
          </table>
        </div>

        {error && (
          <p className="mt-3 rounded-[9px] border border-danger-bd bg-danger-bg px-3 py-2 text-[12.5px] text-danger-text">{error}</p>
        )}
        <div className="mt-3.5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={BAR_SECONDARY}>Back</button>
          <button type="button" onClick={() => { void write(); }} disabled={busy || lineCount === 0} className={BAR_PRIMARY}>
            {busy ? "Writing…" : "Write TI"}
          </button>
        </div>
      </div>
    </div>
  );
}
