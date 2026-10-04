"use client";

// Freight Trips — one trip: header, then its bills under numbered STOPS, each
// stop the SHARED held-bills table (components/floor/hold-table.tsx, as-is).
//
// What is deliberately NOT here (owner): no picking / dispatch status, no READY,
// no progress bar, no Send to billing, no Show to floor, no Hold / Release. A
// freight trip is paper; the bills stay exactly as Floor has them.
//
// A bill released on Floor since it joined STAYS on the trip and is still
// counted. The shared table cannot carry an extra chip (it is imported
// unchanged), so each stop names its released bills on a line under its table.

import { useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Plus, XCircle } from "lucide-react";
import { HoldTable } from "@/components/floor/hold-table";
import { formatLitres, formatWeightKg } from "@/components/floor/status-pill";
import { loadLitres } from "@/lib/orders/gift";
import { toggleAllIds, toggleOne, type FloorSelection } from "@/lib/floor/selection";
import type { FreightTripDetail, FreightStop } from "./api";
import { formatIstDayTime } from "@/lib/trips/diesel-dispatch";

export function TripView({
  trip,
  canEdit,
  readOnly,
  selection,
  onSelection,
  onEdit,
  onAddBills,
  onCancelTrip,
  compact = false,
}: {
  trip: FreightTripDetail;
  canEdit: boolean;
  /** A cancelled trip: no controls at all. */
  readOnly: boolean;
  selection: FloorSelection;
  onSelection: (next: FloorSelection) => void;
  onEdit: () => void;
  onAddBills: () => void;
  onCancelTrip: () => void;
  /** The add band shows the trip ABOVE the pool — header + stops, no buttons. */
  compact?: boolean;
}) {
  const writable = canEdit && !readOnly && !compact;
  const now = useMemo(() => new Date(), [trip]);
  const c = trip.counts;
  const kg = formatWeightKg(c.kg);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-ink-100 px-4 pb-3 pt-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <span className="inline-block rounded-[4px] border border-ink-100 bg-ink-50 px-1.5 py-[1px] font-mono text-[11.5px] font-semibold text-ink-700">
              {trip.tripNumber}
            </span>
            {readOnly && (
              <span className="ml-2 rounded-[4px] border border-ink-100 bg-ink-50 px-1.5 py-[1px] text-[11px] font-semibold text-ink-500">
                Cancelled{trip.cancelledByName ? ` by ${trip.cancelledByName}` : ""}
              </span>
            )}
            <h2 className="mt-1 truncate text-[24px] font-semibold leading-tight text-ink-900">
              {c.bills === 0 ? "Empty trip" : trip.routeLabel ?? "No route"}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-600">
              <span className="font-mono">{trip.vehicleLabel ?? "No vehicle"}</span>
              <span className="text-ink-200">·</span>
              <span>{trip.transporterName ?? "No transporter"}</span>
              <span className="text-ink-200">·</span>
              {trip.driverName ? (
                <span className="font-semibold uppercase text-ink-700">
                  {trip.driverName}
                  {trip.driverPhone ? <span className="ml-1 font-normal normal-case text-ink-500">{trip.driverPhone}</span> : null}
                </span>
              ) : (
                <span className="font-semibold text-warn-text">No driver yet</span>
              )}
              {writable && (
                <button
                  type="button"
                  onClick={onEdit}
                  aria-label="Edit vehicle and driver"
                  className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-500 hover:bg-ink-50 hover:text-ink-900"
                >
                  <Pencil size={13} />
                </button>
              )}
            </div>
            {/* The manual dispatch time (v27.55), IST — only when set (an older trip may have none). */}
            {trip.manualDispatchAt && (
              <div className="mt-1 text-[12px] tabular-nums text-ink-500">Dispatch {formatIstDayTime(trip.manualDispatchAt)}</div>
            )}
            {trip.note && <div className="mt-1 text-[12px] text-ink-500">{trip.note}</div>}
          </div>
          {writable && <TripMenu onCancel={onCancelTrip} />}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <span className="text-[12.5px] tabular-nums text-ink-600">
            {c.stops} stop{c.stops === 1 ? "" : "s"} · {c.bills} bill{c.bills === 1 ? "" : "s"} · {formatLitres(c.litres)} L
            {" · "}
            {kg ?? "—"}
            {c.kgUnknown > 0 ? "+" : ""} kg
          </span>
          {writable && (
            <button
              type="button"
              onClick={onAddBills}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 text-[12.5px] font-semibold text-ink-900 hover:border-ink-400 hover:bg-ink-50"
            >
              <Plus size={14} /> Add bills
            </button>
          )}
        </div>
      </div>

      {trip.stops.length === 0 ? (
        <div className="px-5 py-12 text-center text-[11.5px] text-ink-400">
          {readOnly ? "This trip held no bills when it was cancelled." : "No bills on this trip yet. Press + Add bills to put held bills on it."}
        </div>
      ) : (
        trip.stops.map((s, i) => (
          <StopBlock
            key={s.stopKey}
            index={i + 1}
            stop={s}
            now={now}
            selectable={writable}
            selection={selection}
            onSelection={onSelection}
          />
        ))
      )}
    </div>
  );
}

function StopBlock({
  index,
  stop,
  now,
  selectable,
  selection,
  onSelection,
}: {
  index: number;
  stop: FreightStop;
  now: Date;
  selectable: boolean;
  selection: FloorSelection;
  onSelection: (next: FloorSelection) => void;
}) {
  const litres = stop.bills.reduce((s, b) => s + loadLitres(b.volumeLitres, b.isGift), 0);
  const released = stop.bills.filter((b) => !b.currentlyHeld);
  return (
    <div className="border-b border-ink-100">
      <div className="flex items-baseline gap-3 bg-ink-25 px-4 py-2">
        <span className="w-5 text-right text-[13px] font-semibold tabular-nums text-ink-400">{index}</span>
        <span className="truncate text-[13px] font-semibold text-ink-900">{stop.name}</span>
        <span className="truncate text-[12px] text-ink-500">
          {stop.area ?? stop.route ?? "No route"} · {stop.bills.length} bill{stop.bills.length === 1 ? "" : "s"} · {formatLitres(litres)} L
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[1080px]">
          <HoldTable
            rows={stop.bills}
            now={now}
            selectable={selectable}
            selection={selection}
            onToggleRow={(id) => onSelection(toggleOne(selection, id))}
            onToggleAll={(rs) => onSelection(toggleAllIds(selection, rs))}
          />
        </div>
      </div>
      {released.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 text-[11.5px] text-ink-500">
          {released.map((b) => (
            <span key={b.orderId} className="rounded-[4px] border border-ink-100 bg-ink-50 px-1.5 py-[1px] text-[11px] font-medium text-ink-700">
              <span className="font-mono">{b.obdNumber}</span> · Released on floor
            </span>
          ))}
          <span>still counted on this trip</span>
        </div>
      )}
    </div>
  );
}

/** "···" → Cancel freight trip. The confirm itself is the parent's in-app modal. */
function TripMenu({ onCancel }: { onCancel: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-600 hover:bg-ink-50"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+6px)] z-30 w-[240px] rounded-xl border border-ink-200 bg-white p-1.5 shadow-lg">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onCancel();
            }}
            className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-ink-50"
          >
            <XCircle size={16} className="mt-0.5 text-danger-text" />
            <span>
              <span className="block text-[13.5px] font-semibold text-danger-text">Cancel freight trip</span>
              <span className="block text-[11.5px] text-ink-500">Frees its bills. The trip is kept as cancelled.</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
