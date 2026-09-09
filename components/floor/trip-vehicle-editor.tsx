"use client";

// Floor Control — the small editor behind a trip band's "Change vehicle".
//
// Vehicle or ad-hoc plate, transporter, slot, note, and the carrier's own docket
// number. Calls PATCH /api/floor/trips/[id].
//
// ⚠ NO WINDOW-LEVEL KEY LISTENER. floor-page.tsx is the SINGLE Esc owner for the
// whole floor tree (FLOOR §4.6) and a second listener races it in registration
// order — the bug that spec replaced. This closes on its ✕ and its backdrop.
//
// ⚠ IT SENDS ONLY WHAT CHANGED. The PATCH distinguishes an ABSENT key ("leave
// alone") from an explicit null ("clear"), so a form that posted every field on
// every save would overwrite columns the operator never looked at — and would
// re-snapshot the driver on a save that only edited the note.
//
// ⚠ DELIVERY TYPE IS NOT HERE, deliberately. The route refuses it: the trip
// number is built from the type (chk_trips_number_shape), so changing it is a
// re-number, not an edit. Offering a control the server refuses would be worse
// than not offering it.

import { useState } from "react";
import { toast } from "sonner";
import type {
  DeliveryTypeOption,
  DispatchWindowOption,
  TransporterOption,
  VehicleOption,
} from "./build-trip-drawer";
import type { TripSummary } from "@/lib/trips/queries";

const LABEL = "block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-1.5";
const INPUT =
  "w-full rounded-[8px] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 outline-none focus:border-gray-400";

export function TripVehicleEditor({
  trip,
  windows,
  vehicles,
  transporters,
  deliveryTypes,
  onClose,
  onSaved,
}: {
  trip: TripSummary;
  windows: DispatchWindowOption[];
  vehicles: VehicleOption[];
  transporters: TransporterOption[];
  /** Read-only, for the caption — the type cannot be changed here. */
  deliveryTypes: DeliveryTypeOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // "" = none · a number = a master vehicle · "adhoc" = type a plate.
  const initialChoice: number | "" | "adhoc" =
    trip.vehicleId !== null ? trip.vehicleId : trip.adhocVehicleNo !== null ? "adhoc" : "";
  const [vehicleChoice, setVehicleChoice] = useState<number | "" | "adhoc">(initialChoice);
  const [adhocVehicleNo, setAdhocVehicleNo] = useState(trip.adhocVehicleNo ?? "");
  const [transporterId, setTransporterId] = useState<number | "">(trip.transporterId ?? "");
  const [dispatchWindowId, setDispatchWindowId] = useState<number | "">(trip.dispatchWindowId ?? "");
  const [note, setNote] = useState(trip.note ?? "");
  const [docket, setDocket] = useState(trip.transporterTripNo ?? "");
  const [busy, setBusy] = useState(false);

  const usingAdhoc = vehicleChoice === "adhoc";
  const adhocTrimmed = adhocVehicleNo.trim();
  const typeName =
    deliveryTypes.find((d) => d.id === trip.deliveryTypeId)?.name ?? trip.typeCode;

  const canSave = !busy && (!usingAdhoc || adhocTrimmed !== "");

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      // Only the fields that MOVED. See the header: an absent key means "leave
      // alone" to the route, so a full-form post would be a different request
      // with different consequences.
      const patch: Record<string, unknown> = {};

      const nextVehicleId = typeof vehicleChoice === "number" ? vehicleChoice : null;
      const nextAdhoc = usingAdhoc ? adhocTrimmed : null;
      if (nextVehicleId !== trip.vehicleId) patch.vehicleId = nextVehicleId;
      if (nextAdhoc !== trip.adhocVehicleNo) patch.adhocVehicleNo = nextAdhoc;

      const nextTransporter = transporterId === "" ? null : transporterId;
      if (nextTransporter !== trip.transporterId) patch.transporterId = nextTransporter;

      const nextWindow = dispatchWindowId === "" ? null : dispatchWindowId;
      if (nextWindow !== trip.dispatchWindowId) patch.dispatchWindowId = nextWindow;

      const nextNote = note.trim() === "" ? null : note.trim();
      if (nextNote !== trip.note) patch.note = nextNote;

      const nextDocket = docket.trim() === "" ? null : docket.trim();
      if (nextDocket !== trip.transporterTripNo) patch.transporterTripNo = nextDocket;

      if (Object.keys(patch).length === 0) {
        toast.success("Nothing changed.");
        onClose();
        return;
      }

      const res = await fetch(`/api/floor/trips/${trip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const bodyJson = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Could not save — ${bodyJson?.error ?? `HTTP ${res.status}`}`);
        return;
      }
      toast.success(`${trip.tripNumber} updated`);
      onSaved();
    } catch {
      toast.error("Could not save — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={busy ? undefined : onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-[400px] max-w-full flex-col border-l border-gray-200 bg-white shadow-[0_12px_32px_-18px_rgba(20,19,26,0.4)]">
        <header className="flex items-center gap-2.5 border-b border-gray-200 px-4 py-3.5">
          <h4 className="m-0 text-[15px] font-bold tracking-[-0.01em] text-gray-900">
            {trip.tripNumber}
          </h4>
          <span className="text-[11.5px] text-gray-400">{typeName}</span>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="ml-auto flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
          <div>
            <label className={LABEL} htmlFor="tve-vehicle">Vehicle</label>
            <select
              id="tve-vehicle"
              className={INPUT}
              value={vehicleChoice}
              onChange={(e) => {
                const v = e.target.value;
                setVehicleChoice(v === "" ? "" : v === "adhoc" ? "adhoc" : Number(v));
                if (v !== "adhoc") setAdhocVehicleNo("");
              }}
            >
              <option value="">Not known yet — draft vehicle</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vehicleNo}
                  {v.driverName ? ` — ${v.driverName}` : ""}
                </option>
              ))}
              <option value="adhoc">Type a plate not in the master…</option>
            </select>
            {usingAdhoc && (
              <input
                className={`${INPUT} mt-2`}
                placeholder="e.g. GJ05CT4488"
                value={adhocVehicleNo}
                onChange={(e) => setAdhocVehicleNo(e.target.value)}
                autoFocus
              />
            )}
            {/* Choosing a master vehicle re-snapshots the driver server-side.
                Said out loud because it is a write the operator did not type. */}
            {typeof vehicleChoice === "number" && vehicleChoice !== trip.vehicleId && (
              <p className="mt-1 text-[10.5px] text-gray-400">
                The driver on the sheet will change to this vehicle&rsquo;s.
              </p>
            )}
          </div>

          <div>
            <label className={LABEL} htmlFor="tve-transporter">Transporter</label>
            <select
              id="tve-transporter"
              className={INPUT}
              value={transporterId}
              onChange={(e) => setTransporterId(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">Not set</option>
              {transporters.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL} htmlFor="tve-window">Slot</label>
            <select
              id="tve-window"
              className={INPUT}
              value={dispatchWindowId}
              onChange={(e) => setDispatchWindowId(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">Not set</option>
              {windows.map((w) => (
                <option key={w.id} value={w.id}>{w.windowTime}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL} htmlFor="tve-docket">Transporter&rsquo;s own trip / docket no.</label>
            <input
              id="tve-docket"
              className={INPUT}
              placeholder="e.g. L42"
              value={docket}
              onChange={(e) => setDocket(e.target.value)}
            />
            {/* Free text, not validated, not unique — it is their reference, not
                ours, and it is not comparable to the Orbit trip number above. */}
            <p className="mt-1 text-[10.5px] text-gray-400">
              Their number, not ours. During the NTS parallel run, the matching NTS trip number.
            </p>
          </div>

          <div>
            <label className={LABEL} htmlFor="tve-note">Reason / note</label>
            <input
              id="tve-note"
              className={INPUT}
              placeholder="Navsari side, going with the evening load"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <p className="text-[11px] leading-relaxed text-gray-400">
            Delivery type cannot be changed — the trip number is built from it. Cancel and rebuild
            if the type is wrong.
          </p>
        </div>

        <footer className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-[34px] items-center rounded-[8px] border border-gray-300 bg-white px-3.5 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSave}
            className="inline-flex h-[34px] items-center rounded-[8px] bg-brand-600 px-4 text-[12.5px] font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </footer>
      </aside>
    </>
  );
}
