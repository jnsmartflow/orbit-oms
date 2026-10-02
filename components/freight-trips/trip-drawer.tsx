"use client";

// Freight Trips — the right-hand drawer for a NEW trip and for EDITING one.
//
// Vehicle: a master vehicle from /api/freight-trips/options, OR a typed plate —
// never both (chk_freight_trips_vehicle_one_of). Picking a vehicle prefills the
// transporter and the driver from it; both stay editable (a typed driver wins —
// owner, 2026-10-02). The values are SNAPSHOTS on the trip.
// ONE brand button: Create trip / Save.

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { formatLitres } from "@/components/floor/status-pill";
import type { FreightOptions, FreightTripDetail, TripFields } from "./api";

const INPUT =
  "h-9 w-full rounded-lg border border-ink-200 bg-white px-3 text-[13px] text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/10";
const LABEL = "mb-1 block text-[11px] font-medium text-ink-500";

export function TripDrawer({
  mode,
  trip,
  options,
  billCount,
  billLitres,
  busy,
  onClose,
  onSubmit,
}: {
  mode: "new" | "edit";
  /** The trip being edited (edit mode). */
  trip: FreightTripDetail | null;
  options: FreightOptions | null;
  /** New mode: the ticked bills going on the trip. */
  billCount: number;
  billLitres: number;
  busy: boolean;
  onClose: () => void;
  onSubmit: (fields: TripFields) => void;
}) {
  const [usePlate, setUsePlate] = useState(mode === "edit" && trip !== null && trip.adhocVehicleNo !== null);
  const [vehicleId, setVehicleId] = useState<number | null>(trip?.vehicleId ?? null);
  const [plate, setPlate] = useState(trip?.adhocVehicleNo ?? "");
  const [transporterId, setTransporterId] = useState<number | null>(trip?.transporterId ?? null);
  const [driverName, setDriverName] = useState(trip?.driverName ?? "");
  const [driverPhone, setDriverPhone] = useState(trip?.driverPhone ?? "");
  const [note, setNote] = useState(trip?.note ?? "");

  const transporterName = useMemo(
    () => new Map((options?.transporters ?? []).map((t) => [t.id, t.name])),
    [options],
  );

  // Esc closes the drawer (it is the only overlay open while it shows).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  function pickVehicle(id: number | null) {
    setVehicleId(id);
    const v = options?.vehicles.find((x) => x.id === id);
    if (v) {
      setTransporterId(v.transporterId);
      setDriverName(v.driverName ?? "");
      setDriverPhone(v.driverPhone ?? "");
    }
  }

  function submit() {
    const clean = (s: string) => (s.trim() === "" ? null : s.trim());
    onSubmit({
      vehicleId: usePlate ? null : vehicleId,
      adhocVehicleNo: usePlate ? clean(plate) : null,
      transporterId,
      driverName: clean(driverName),
      driverPhone: clean(driverPhone),
      note: clean(note),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="flex h-full w-full max-w-[420px] flex-col bg-white shadow-xl">
        <div className="flex items-center border-b border-ink-100 px-5 py-4">
          <h3 className="text-[15px] font-semibold text-ink-900">
            {mode === "new" ? "New freight trip" : `Edit ${trip?.tripNumber ?? ""}`}
          </h3>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="ml-auto text-ink-400 hover:text-ink-900">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {mode === "new" && (
            <div className="rounded-lg border border-ink-100 bg-ink-25 px-3 py-2 text-[12.5px] text-ink-700">
              {billCount > 0
                ? `${billCount} held bill${billCount === 1 ? "" : "s"} · ${formatLitres(billLitres)} L go on this trip.`
                : "An empty trip — add bills to it afterwards."}
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center">
              <span className="text-[11px] font-medium text-ink-500">Vehicle</span>
              <button
                type="button"
                onClick={() => setUsePlate((v) => !v)}
                className="ml-auto text-[11.5px] text-brand-700 hover:underline"
              >
                {usePlate ? "Pick from vehicle list" : "Type a plate"}
              </button>
            </div>
            {usePlate ? (
              <input className={`${INPUT} font-mono uppercase`} placeholder="GJ05AB1234" value={plate} onChange={(e) => setPlate(e.target.value)} />
            ) : (
              <select
                className={INPUT}
                value={vehicleId ?? ""}
                onChange={(e) => pickVehicle(e.target.value === "" ? null : Number(e.target.value))}
              >
                <option value="">No vehicle yet</option>
                {(options?.vehicles ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.vehicleNo}
                    {transporterName.get(v.transporterId) ? ` · ${transporterName.get(v.transporterId)}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className={LABEL}>Transporter</label>
            <select
              className={INPUT}
              value={transporterId ?? ""}
              onChange={(e) => setTransporterId(e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">None</option>
              {(options?.transporters ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {options?.transportersFallback && (
              <p className="mt-1 text-[11px] text-ink-400">Showing all active transporters — none is marked as a real carrier yet.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Driver name</label>
              <input className={INPUT} value={driverName} onChange={(e) => setDriverName(e.target.value)} />
            </div>
            <div>
              <label className={LABEL}>Driver phone</label>
              <input className={INPUT} inputMode="tel" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} />
            </div>
          </div>

          <div>
            <label className={LABEL}>Note</label>
            <textarea
              className={`${INPUT} h-20 py-2`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <div className="border-t border-ink-100 px-5 py-4">
          <p className="mb-3 text-[11.5px] text-ink-500">
            Only the freight report uses this. The bills stay on hold on the floor.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-9 rounded-lg border border-ink-200 bg-white px-4 text-[13px] font-semibold text-ink-900 hover:bg-ink-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || (usePlate && plate.trim() === "")}
              className="h-9 rounded-lg bg-brand-600 px-4 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
            >
              {mode === "new" ? "Create trip" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
