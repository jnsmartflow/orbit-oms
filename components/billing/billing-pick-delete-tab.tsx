"use client";

// Billing v2 — the "Pick delete" tab: HISTORY ONLY (2026-09-28).
//
// Until 2026-09-28 this tab was where billing decided same-SO groups, behind a
// yellow pill with a count. The owner moved the deciding into a BLOCKING POPUP
// on every Billing tab (billing-pick-delete-popup.tsx, which renders the queue
// from billing-pick-delete-queue.tsx) — billing must decide before anything
// else. What stays here is the record: every Pick delete and All OK in the IST
// month, with Undo. A plain label on the tab row, like Telephonic.
//
// UNDO FROM HERE. An undone decision makes its group actionable again, so the
// popup comes back — that is correct. After a successful Undo this fires
// PICK_DELETE_CHECK_EVENT so the popup checks at once instead of on its next
// 10s tick.
//
// 🔴 HIDE, NEVER DISABLE, FOR PERMISSION (CLAUDE_UI §10): without canEdit the
// Undo column is not drawn at all.
//
// THE TINT MANAGER REUSES IT (2026-10-01, tabs build step 8) through three
// optional props — Billing passes none, so its tab is unchanged:
//   · base    — API base (default PICK_DELETE_BASE, Billing's routes);
//   · columns — "tint" relabels Customer → "Site" (the column already shows the
//               ship-to site first) and OBD → "OBD removed" (the deleted OBD on a
//               pick delete, "—" on an All OK). Default "billing" = as before;
//   · onCount — the decided-row count of the month shown, for a tab badge;
//   · reloadSignal — a host with no Billing marker provider (the subscription
//               hook is inert there) bumps it to make the tab re-read. Default
//               undefined: Billing reloads off its provider, as before.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useBillingPickDeleteMarkerPause,
  useBillingPickDeleteMarkerSubscription,
} from "@/components/billing/billing-marker-provider";
import { TelephonicMonthPicker } from "@/components/billing/billing-telephonic-tab";
import {
  BTN_SECONDARY,
  PICK_DELETE_BASE,
  PICK_DELETE_CHECK_EVENT,
  PILL,
  customerOf,
  fmtDayTime,
  postJson,
} from "@/components/billing/billing-pick-delete-queue";
import { currentIstMonth } from "@/lib/billing/telephonic-so";
import type { PickDeleteDecidedRow, PickDeleteList } from "@/lib/billing/pick-delete-types";

// Fixed table standard (CLAUDE_UI §27): 32px header, 36px rows, 10px uppercase
// header, 11px data — in ink tokens.
const TH =
  "h-[32px] border-b border-ink-100 px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-ink-400 whitespace-nowrap overflow-hidden text-ellipsis";
const TD = "h-[36px] border-b border-ink-50 px-3.5 text-[11px] text-ink-600 whitespace-nowrap overflow-hidden text-ellipsis";

export function BillingPickDeleteTab({
  canEdit,
  base = PICK_DELETE_BASE,
  columns = "billing",
  onCount,
  reloadSignal,
}: {
  canEdit: boolean;
  /** API base for list / undo. Default = Billing's routes. */
  base?: string;
  /** "tint" = the Tint Manager's labels (Site, OBD removed). Default "billing". */
  columns?: "billing" | "tint";
  /** Called with the decided-row count after every load. */
  onCount?: (n: number) => void;
  /** A change re-reads the list (hosts without Billing's provider). */
  reloadSignal?: number;
}) {
  const [month, setMonth] = useState<string>(() => currentIstMonth(new Date()));
  const [data, setData] = useState<PickDeleteList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reqRef = useRef(0);
  const load = useCallback(async () => {
    const seq = ++reqRef.current;
    try {
      const res = await fetch(`${base}/list?month=${encodeURIComponent(month)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as PickDeleteList & { error?: string };
      if (seq !== reqRef.current) return;
      if (!res.ok) {
        setLoadError(body.error ?? "Could not load the list.");
        return;
      }
      setLoadError(null);
      setData(body);
    } catch {
      if (seq === reqRef.current) setLoadError("Could not load the list — check the connection.");
    }
  }, [month, base]);

  // The host's tab badge — the decided rows of the month on screen.
  useEffect(() => {
    if (data !== null) onCount?.(data.decided.length);
  }, [data, onCount]);

  useEffect(() => {
    void load();
  }, [load]);

  // A host-driven reload (the Tint Manager). Undefined for Billing → never runs.
  useEffect(() => {
    if (reloadSignal !== undefined && reloadSignal > 0) void load();
    // load is read, not a trigger: a month change already reloads above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSignal]);

  // Live: a decision made in the popup (here or on another desk) moves the marker.
  useBillingPickDeleteMarkerSubscription(load);
  useBillingPickDeleteMarkerPause("pick-delete-history", busy);

  const undo = useCallback(
    async (row: PickDeleteDecidedRow) => {
      setBusy(true);
      setNotice(null);
      const r = await postJson(`${base}/undo`, { decisionId: row.id });
      setBusy(false);
      if (!r.ok) setNotice(String(r.data.error ?? "Undo did not go through."));
      else window.dispatchEvent(new Event(PICK_DELETE_CHECK_EVENT));
      await load();
    },
    [load, base],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-ink-25">
      <div className="flex flex-col gap-2.5 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 px-0.5 pt-1">
          <span className="text-[13px] font-semibold text-ink-900">History</span>
          <span className="text-[12px] text-ink-500">every pick delete and All OK, with Undo</span>
          <div className="ml-auto">
            <TelephonicMonthPicker month={month} onChange={setMonth} />
          </div>
        </div>

        {notice !== null && (
          <div role="alert" className="rounded-lg border border-danger-bd bg-danger-bg px-3.5 py-2 text-[12px] font-medium text-danger-text">
            {notice}
          </div>
        )}

        {loadError !== null ? (
          <div className="rounded-lg border border-ink-100 bg-white px-4 py-5 text-center text-[12px] text-ink-500">
            {loadError}
          </div>
        ) : data === null ? (
          <div className="rounded-lg border border-ink-100 bg-white px-4 py-5 text-center text-[12px] text-ink-500">
            Loading…
          </div>
        ) : (
          <DecidedTable rows={data.decided} canEdit={canEdit} busy={busy} onUndo={(row) => void undo(row)} columns={columns} />
        )}
      </div>
    </div>
  );
}

// ── History ─────────────────────────────────────────────────────────────────

function DecidedTable({
  rows,
  canEdit,
  busy,
  onUndo,
  columns = "billing",
}: {
  rows: PickDeleteDecidedRow[];
  canEdit: boolean;
  busy: boolean;
  onUndo: (row: PickDeleteDecidedRow) => void;
  columns?: "billing" | "tint";
}) {
  const tint = columns === "tint";
  // SO · OBD · Customer · Decision · By · When · (Undo). Without canEdit the
  // Undo column is not drawn and Customer takes its width.
  const widths = canEdit ? [13, 20, 25, 13, 11, 10, 8] : [13, 20, 33, 13, 11, 10];
  return (
    <div className="overflow-x-auto rounded-lg border border-ink-100 bg-white">
      <table className="w-full min-w-[640px] border-collapse" style={{ tableLayout: "fixed" }}>
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={{ width: `${w}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className={TH}>SO</th>
            <th className={TH}>{tint ? "OBD removed" : "OBD"}</th>
            <th className={TH}>{tint ? "Site" : "Customer"}</th>
            <th className={TH}>Decision</th>
            <th className={TH}>By</th>
            <th className={TH}>When</th>
            {canEdit && <th className={TH} />}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={canEdit ? 7 : 6} className="h-[48px] px-3.5 text-center text-[11px] text-ink-500">
                Nothing decided this month.
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const undone = r.undoneAt !== null;
              const pill = undone
                ? `${PILL} bg-ink-50 text-ink-500`
                : r.kind === "pick_delete"
                  ? `${PILL} bg-danger-bg text-danger-text`
                  : `${PILL} bg-ok-bg text-ok-text`;
              const label = undone ? "Undone" : r.kind === "pick_delete" ? "Pick deleted" : "All OK";
              return (
                <tr key={r.id}>
                  <td className={`${TD} font-mono text-ink-900`}>{r.soNumber}</td>
                  {tint ? (
                    // "OBD removed": the deleted OBD on a pick delete (obdNumbers
                    // is exactly that one there), nothing on an All OK.
                    <td className={`${TD} font-mono`}>
                      {r.kind === "pick_delete" ? r.obdNumbers.join(", ") : <span className="font-sans text-ink-400">—</span>}
                    </td>
                  ) : (
                    <td className={`${TD} font-mono`} title={r.obdNumbers.join(", ")}>
                      {r.obdNumbers.join(", ")}
                    </td>
                  )}
                  <td className={TD}>{customerOf(r.customerName)}</td>
                  <td className={TD}>
                    <span className={pill}>{label}</span>
                  </td>
                  <td className={TD}>{r.decidedByName ?? "—"}</td>
                  <td className={TD}>{fmtDayTime(r.decidedAt)}</td>
                  {canEdit && (
                    <td className={`${TD} text-right`}>
                      <button type="button" className={BTN_SECONDARY} disabled={undone || busy} onClick={() => onUndo(r)}>
                        Undo
                      </button>
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
