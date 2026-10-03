"use client";

// Floor Control — the RE-DELIVERY INFO modal (2026-10-03, plan rev 5 §4.2).
// READ-ONLY: opened from a RE-DEL chip (or the row's ⋯) on an opened trip. It
// shows what the trip_redeliveries row recorded and the bill's earlier Orbit
// trips. It writes nothing — taking a re-delivery off the trip is Remove from
// trip on the ticked row, like any bill (§4.3).
//
// ⚠ NO KEY LISTENER — floor-page.tsx is the single Esc owner (CLAUDE_FLOOR §4.6).

import type { TripRedeliveryRow } from "@/lib/trips/queries";
import { EarlierTrips } from "./trip-redelivery-dialog";
import { BAR_SECONDARY } from "./floor-action-bar";

function fmtAddedAt(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function TripRedeliveryInfo({
  redelivery,
  tripNumber,
  onClose,
}: {
  redelivery: TripRedeliveryRow;
  tripNumber: string;
  onClose: () => void;
}) {
  const r = redelivery;
  const name = r.row?.dealerName ?? null;
  const area = r.row?.area ?? null;
  // From the row's own flags (no stage literal): dispatched wins over checked,
  // because the board sets isChecked on a dispatched bill too.
  const stage = r.row ? (r.row.isDispatched ? "Dispatched" : r.row.isChecked ? "Checked" : null) : null;

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center bg-black/40 p-4 pt-[70px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Re-delivery ${r.obdNumber}`}
        className="flex max-h-[calc(100vh-100px)] w-[500px] max-w-full flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-3.5">
          <span className="rounded-[3px] border border-warn/40 bg-warn-bg px-[5px] py-px font-mono text-[10px] font-semibold text-warn-text">
            RE-DEL
          </span>
          <h3 className="text-[15px] font-bold text-ink-900">Attempt {r.attemptNo}</h3>
          <span className="text-[12.5px] text-ink-500">on {tripNumber}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-[16px] text-ink-400 hover:text-ink-900">
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {name && <div className="text-[14.5px] font-semibold text-ink-900">{name}</div>}
          {area && <div className="mt-px text-[12px] text-ink-500">{area}</div>}

          <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
            <dt className="text-ink-500">OBD</dt>
            <dd className="font-mono text-ink-900">{r.obdNumber}</dd>
            <dt className="text-ink-500">Invoice</dt>
            <dd className="font-mono text-ink-900">{r.invoiceNo ?? "—"}</dd>
            {stage && (
              <>
                <dt className="text-ink-500">Stage</dt>
                <dd className="text-ink-900">{stage}</dd>
              </>
            )}
            <dt className="text-ink-500">Reason</dt>
            <dd className="text-ink-900">{r.reasonLabel}</dd>
            {r.note && (
              <>
                <dt className="text-ink-500">Note</dt>
                <dd className="whitespace-pre-wrap text-ink-900">{r.note}</dd>
              </>
            )}
            {r.confirmedReturn && (
              <>
                <dt className="text-ink-500">Truck came back</dt>
                <dd className="font-semibold text-ok-text">✓ confirmed when added</dd>
              </>
            )}
            <dt className="text-ink-500">Added</dt>
            <dd className="text-ink-900">
              {r.createdByName ?? "—"} · {fmtAddedAt(r.createdAt)}
            </dd>
          </dl>

          <div className="mt-4 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-500">Earlier trips</div>
          <EarlierTrips history={r.history} />
        </div>

        <div className="flex items-center gap-2.5 border-t border-ink-100 bg-ink-25 px-5 py-3">
          <span className="text-[11.5px] text-ink-500">To take it off this trip, tick the row and press Remove from trip.</span>
          <button type="button" autoFocus onClick={onClose} className={`${BAR_SECONDARY} ml-auto`}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
