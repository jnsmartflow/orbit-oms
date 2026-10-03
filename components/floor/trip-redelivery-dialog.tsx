"use client";

// Floor Control — the RE-DELIVERY dialog (2026-10-03, plan rev 5 §4.1; visual
// reference docs/mockups/trip-redelivery/trip-redelivery.html states 1–9).
//
// A bill that already went out on a truck and came back is put on THIS trip as
// attempt 2, 3 … The planner types one full OBD or invoice number; the server
// (GET /api/floor/trips/[id]/redeliveries?q=) returns every matching bill, each
// already JUDGED against this trip (lib/trips/redelivery.ts judgeBillForTrip):
//   ok      — tickable
//   warn    — tickable, but the latest attempt is on a trip dated today or later:
//             the planner must tick "Truck came back" (sent as confirmedReturn)
//   refused — shown with its reason, never tickable
// POST { action: "add", orderIds, reason, note?, confirmedReturn? } writes one
// trip_redeliveries row per bill and NOTHING on the bill itself. The server
// re-judges every bill; whatever it refuses comes back per bill and is shown here.
//
// ⚠ NO KEY LISTENER. floor-page.tsx is the single Esc owner (CLAUDE_FLOOR §4.6)
// and closes this through `onClose` — even from inside the number box.
// ⚠ A MODAL OVER THE WHOLE PAGE — the off-floor-dialog.tsx pattern (fixed,
// bg-black/40, z-[120]); its scrim covers the bottom bar's brand CTA.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { REDELIVERY_REASONS, REDELIVERY_REASON_LABELS, type RedeliveryReason } from "@/lib/trips/redelivery-reasons";
import type { AttemptHistoryEntry, RedeliveryCandidate } from "@/lib/trips/redelivery";
import { DISPATCHED, PICK_CHECKED } from "@/lib/workflow-stages";
import { formatLitres } from "./status-pill";
import { BAR_PRIMARY, BAR_SECONDARY } from "./floor-action-bar";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-01" → "1 Oct". Calendar arithmetic only — never a timezone shift. */
export function shortDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MON[m - 1] ?? ""}`;
}

/** The stage in the floor's own words. */
export function stageLabel(stage: string): string {
  if (stage === PICK_CHECKED) return "Checked";
  if (stage === DISPATCHED) return "Dispatched";
  return stage.replace(/_/g, " ");
}

/** "Earlier trips" — every Orbit attempt, oldest first. Shared with the info modal. */
export function EarlierTrips({ history }: { history: AttemptHistoryEntry[] }) {
  if (history.length === 0) {
    return <div className="mt-1.5 text-[12.5px] text-ink-500">No earlier Orbit trip</div>;
  }
  return (
    <ul className="mt-1.5 space-y-1">
      {history.map((h, i) => (
        <li key={`${h.tripId}-${h.createdAt}`} className="flex items-baseline gap-2 text-[12.5px] text-ink-600">
          <span
            className={`relative top-[-1px] h-[7px] w-[7px] shrink-0 rounded-full ${
              i === history.length - 1 ? "bg-warn" : "bg-ink-200"
            }`}
          />
          <span className="w-[44px] shrink-0 font-medium text-ink-900">{shortDay(h.tripDate)}</span>
          <span className="font-mono font-semibold text-ink-900">{h.tripNumber}</span>
          <span className="text-ink-500">
            · {h.kind === "original" ? "original" : `re-delivery${h.reasonLabel ? ` · ${h.reasonLabel}` : ""}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface AddFailure {
  orderId: number;
  error: string;
}

export function TripRedeliveryDialog({
  tripId,
  tripNumber,
  onClose,
  onAdded,
  onBusyChange,
}: {
  tripId: number;
  tripNumber: string;
  onClose: () => void;
  /** Something was added — the page refreshes the trip (rail + stops). */
  onAdded: () => void;
  /** Lets floor-page's Esc refuse to close the dialog mid-request. */
  onBusyChange: (busy: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [bills, setBills] = useState<RedeliveryCandidate[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [reason, setReason] = useState<RedeliveryReason | null>(null);
  const [note, setNote] = useState("");
  const [truckBack, setTruckBack] = useState(false);
  const [busy, setBusyState] = useState(false);
  const [failures, setFailures] = useState<AddFailure[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const setBusy = (b: boolean) => {
    setBusyState(b);
    onBusyChange(b);
  };
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => inputRef.current?.focus(), []);

  async function search() {
    const term = q.trim();
    if (term === "" || searching) return;
    setSearching(true);
    setSearchError(null);
    setFailures([]);
    try {
      const res = await fetch(`/api/floor/trips/${tripId}/redeliveries?q=${encodeURIComponent(term)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { bills?: RedeliveryCandidate[]; error?: string };
      if (!res.ok || !Array.isArray(body.bills)) {
        setBills(null);
        setSearchError(body.error ?? `Could not search — HTTP ${res.status}`);
        return;
      }
      setBills(body.bills);
      // One bill that may go → it is chosen at once. Several → the planner ticks.
      const goable = body.bills.filter((b) => b.verdict !== "refused");
      setChosen(body.bills.length === 1 && goable.length === 1 ? new Set([goable[0].orderId]) : new Set());
      setTruckBack(false);
    } catch {
      setBills(null);
      setSearchError("Could not reach the server — check your connection.");
    } finally {
      setSearching(false);
    }
  }

  const chosenBills = useMemo(() => (bills ?? []).filter((b) => chosen.has(b.orderId)), [bills, chosen]);
  const warned = chosenBills.filter((b) => b.verdict === "warn");
  const noteTooLong = note.trim().length > 500;
  const canAdd = !busy && chosenBills.length > 0 && reason !== null && (warned.length === 0 || truckBack) && !noteTooLong;
  const n = chosenBills.length;

  function toggle(orderId: number) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  async function add() {
    if (!canAdd || reason === null) return;
    setBusy(true);
    setFailures([]);
    try {
      const trimmed = note.trim();
      const res = await fetch(`/api/floor/trips/${tripId}/redeliveries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          orderIds: chosenBills.map((b) => b.orderId),
          reason,
          ...(trimmed !== "" ? { note: trimmed } : {}),
          ...(warned.length > 0 ? { confirmedReturn: truckBack } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        added?: Array<{ orderId: number; obdNumber: string; attemptNo: number }>;
        failed?: AddFailure[];
        error?: string;
      };
      if (!Array.isArray(body.added) || !Array.isArray(body.failed)) {
        setFailures(chosenBills.map((b) => ({ orderId: b.orderId, error: body.error ?? `HTTP ${res.status}` })));
        return;
      }
      const added = body.added;
      if (added.length > 0) {
        toast.success(
          added.length === 1
            ? `${added[0].obdNumber} added to ${tripNumber} · attempt ${added[0].attemptNo}`
            : `${added.length} re-deliveries added to ${tripNumber}`,
        );
        onAdded();
      }
      if (body.failed.length === 0) {
        onClose();
        return;
      }
      // Some did not go — keep the dialog, untick what went, say why per bill.
      const addedIds = new Set(added.map((a) => a.orderId));
      setChosen((prev) => new Set(Array.from(prev).filter((id) => !addedIds.has(id))));
      setBills((prev) => (prev ?? []).filter((b) => !addedIds.has(b.orderId)));
      setFailures(body.failed);
    } catch {
      setFailures(chosenBills.map((b) => ({ orderId: b.orderId, error: "Could not reach the server — nothing was changed." })));
    } finally {
      setBusy(false);
    }
  }

  const failureFor = (orderId: number) => failures.find((f) => f.orderId === orderId)?.error ?? null;
  const single = bills !== null && bills.length === 1 ? bills[0] : null;

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center bg-black/40 p-4 pt-[70px]" onClick={busy ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Re-delivery onto ${tripNumber}`}
        className="flex max-h-[calc(100vh-100px)] w-[560px] max-w-full flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-3.5">
          <h3 className="text-[15px] font-bold text-ink-900">Re-delivery onto</h3>
          <span className="rounded-[6px] border border-[#e7e7ee] bg-[#f1f1f6] px-[7px] py-[2px] font-mono text-[12.5px] font-semibold text-ink-900">
            {tripNumber}
          </span>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="ml-auto text-[16px] text-ink-400 hover:text-ink-900">
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search();
              }
            }}
            disabled={busy}
            placeholder="OBD or invoice no."
            className="h-[38px] w-full rounded-lg border border-ink-200 px-3 font-mono text-[13px] text-ink-900 placeholder:font-sans placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/10"
          />
          {bills === null && !searchError && (
            <p className="mt-2 text-[12px] leading-relaxed text-ink-500">
              {searching
                ? "Looking it up…"
                : "Type or paste one full number — a 10-digit OBD or an invoice (I + 9 digits, or just the 9 digits). Press Enter."}
            </p>
          )}
          {searchError && <p className="mt-2 text-[12.5px] text-danger-text">{searchError}</p>}

          {bills !== null && bills.length === 0 && (
            <div className="mt-3 rounded-[9px] border border-ink-100 bg-ink-50 px-3 py-2.5 text-[12.5px] text-ink-700">
              No bill with this OBD or invoice number.
            </div>
          )}

          {/* ── ONE bill → the card ─────────────────────────────────────────── */}
          {single && (
            <div className="mt-3.5 rounded-[9px] border border-ink-100 px-3.5 py-3">
              <div className="text-[14.5px] font-semibold text-ink-900">{single.customerName}</div>
              {single.area && <div className="mt-px text-[12px] text-ink-500">{single.area}</div>}
              <Facts bill={single} />
              <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-500">Earlier trips</div>
              <EarlierTrips history={single.history} />
              {single.verdict === "refused" ? (
                <Refusal text={single.message} />
              ) : (
                <div className="mt-3 text-[13px] font-semibold text-ink-900">
                  This will be <span className="text-warn-text">attempt {single.attemptNo}</span>
                </div>
              )}
              {failureFor(single.orderId) && <Refusal text={failureFor(single.orderId)} />}
            </div>
          )}

          {/* ── SEVERAL bills (an invoice covering two OBDs) → one line each ─── */}
          {bills !== null && bills.length > 1 && (
            <>
              <p className="mt-3 text-[12px] text-ink-500">
                This number covers <b className="text-ink-900">{bills.length} bills</b>. Tick the ones going back out.
              </p>
              <div className="mt-2 overflow-hidden rounded-[10px] border border-ink-100">
                {bills.map((b) => {
                  const off = b.verdict === "refused";
                  const fail = failureFor(b.orderId);
                  return (
                    <label
                      key={b.orderId}
                      className={`flex cursor-pointer items-start gap-2.5 border-b border-ink-50 px-3 py-2.5 last:border-b-0 ${
                        off ? "cursor-not-allowed text-ink-400" : "hover:bg-ink-25"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-[3px] h-[14px] w-[14px] flex-none accent-brand-600"
                        disabled={off || busy}
                        checked={chosen.has(b.orderId)}
                        onChange={() => toggle(b.orderId)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                          <span className={`font-mono font-semibold ${off ? "" : "text-ink-900"}`}>{b.obdNumber}</span>
                          <span className={off ? "" : "text-ink-700"}>{b.customerName}</span>
                          {b.volumeLitres !== null && <span className="tabular-nums text-ink-500">{formatLitres(b.volumeLitres)} L</span>}
                          <span className="text-ink-500">· {stageLabel(b.workflowStage)}</span>
                          {!off && <span className="font-semibold text-warn-text">· attempt {b.attemptNo}</span>}
                        </span>
                        {b.history.length > 0 && (
                          <span className="mt-0.5 block text-[11.5px] text-ink-500">
                            Earlier: {b.history.map((h) => `${shortDay(h.tripDate)} ${h.tripNumber}`).join(" · ")}
                          </span>
                        )}
                        {off && <span className="mt-1 block text-[12px] font-semibold text-ink-700">{b.message}</span>}
                        {!off && b.verdict === "warn" && (
                          <span className="mt-1 block text-[12px] text-warn-text">{b.message}</span>
                        )}
                        {fail && <span className="mt-1 block text-[12px] font-semibold text-danger-text">{fail}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )}

          {/* ── The same-day warning: ONE tick for every warned bill ─────────── */}
          {warned.length > 0 && (
            <div className="mt-3 rounded-[8px] border border-warn/40 bg-warn-bg px-3 py-2.5 text-[12.5px] text-warn-text">
              {warned.length === 1 ? warned[0].message : `${warned.length} of the ticked bills are already on a truck today. Add only if those trucks came back.`}
              <label className="mt-2 flex cursor-pointer items-center gap-2 font-semibold text-ink-900">
                <input
                  type="checkbox"
                  className="h-[14px] w-[14px] accent-brand-600"
                  checked={truckBack}
                  disabled={busy}
                  onChange={(e) => setTruckBack(e.target.checked)}
                />
                Truck came back
              </label>
            </div>
          )}

          {/* ── Reason + note — only once there is something to add ─────────── */}
          {bills !== null && bills.some((b) => b.verdict !== "refused") && (
            <>
              <div className="mb-1.5 mt-4 text-[11px] font-medium text-ink-500">Reason</div>
              <div className="flex flex-wrap gap-2">
                {REDELIVERY_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={busy}
                    onClick={() => setReason(r)}
                    className={`h-[32px] rounded-full border px-3.5 text-[12.5px] font-medium ${
                      reason === r ? "border-ink-900 bg-ink-900 text-white" : "border-[#c6c6d4] bg-white text-ink-900 hover:bg-ink-25"
                    }`}
                  >
                    {REDELIVERY_REASON_LABELS[r]}
                  </button>
                ))}
              </div>
              <div className="mb-1.5 mt-3.5 text-[11px] font-medium text-ink-500">
                Note <span className="font-normal text-ink-400">· optional</span>
              </div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
                placeholder="e.g. shop shut, reopens Monday"
                className="h-[52px] w-full resize-none rounded-lg border border-ink-200 px-3 py-2 text-[12.5px] text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/10"
              />
              {noteTooLong && <div className="mt-1 text-[12px] text-danger-text">A note is at most 500 characters.</div>}
            </>
          )}
        </div>

        <div className="flex items-center gap-2.5 border-t border-ink-100 bg-ink-25 px-5 py-3">
          <span className="text-[11.5px] text-ink-500">
            {bills === null
              ? "Nothing found yet"
              : n === 0
                ? bills.some((b) => b.verdict !== "refused")
                  ? "Tick a bill to add"
                  : "Nothing here can be added"
                : reason === null
                  ? "Pick a reason to add"
                  : warned.length > 0 && !truckBack
                    ? "Tick “Truck came back” to add"
                    : `Adds ${n === 1 ? "a RE-DEL row" : `${n} RE-DEL rows`} to ${tripNumber}`}
          </span>
          <button type="button" onClick={onClose} disabled={busy} className={`${BAR_SECONDARY} ml-auto`}>
            Cancel
          </button>
          <button type="button" onClick={() => void add()} disabled={!canAdd} className={BAR_PRIMARY}>
            {busy ? "Adding…" : n > 1 ? `Add ${n} re-deliveries` : "Add re-delivery"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Facts({ bill }: { bill: RedeliveryCandidate }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px] text-ink-600">
      <span>
        <span className="mr-1 text-ink-500">OBD</span>
        <span className="font-mono text-ink-900">{bill.obdNumber}</span>
      </span>
      <span>
        <span className="mr-1 text-ink-500">Invoice</span>
        <span className="font-mono text-ink-900">{bill.invoiceNo ?? "—"}</span>
      </span>
      <span>
        <span className="mr-1 text-ink-500">Stage</span>
        <span className="text-ink-900">{stageLabel(bill.workflowStage)}</span>
      </span>
      {bill.volumeLitres !== null && <span className="tabular-nums">{formatLitres(bill.volumeLitres)} L</span>}
    </div>
  );
}

function Refusal({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="mt-3 rounded-[8px] border border-ink-100 bg-ink-50 px-3 py-2 text-[12.5px] font-semibold text-ink-700">{text}</div>
  );
}
