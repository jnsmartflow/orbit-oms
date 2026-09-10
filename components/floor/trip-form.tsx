"use client";

// Floor Control — the small New trip form (v3 mockup §01, "New trip").
//
// Delivery type, slot, vehicle or ad-hoc plate, transporter, note. Creates an
// EMPTY draft; bills are added from the pool afterwards.
//
// ⚠ IT REPLACES build-trip-drawer.tsx ON THIS SCREEN. That drawer was built
// around a selection — it summarised the ticked bills by route and created the
// trip with them attached. The v3 flow separates the two: a trip is a thing you
// make, and bills are added to it from the pool with the bottom bar. The one
// case where both happen at once is "New trip…" at the foot of the Add-to-trip
// list, and `attachOrderIds` covers it without the form knowing anything about
// selections.
//
// ⚠ NO WINDOW-LEVEL KEY LISTENER. floor-page.tsx is the SINGLE Esc owner for the
// whole floor tree (FLOOR §4.6) and a second listener races it in registration
// order. This closes on its ✕ and its backdrop.
//
// ⚠ VEHICLE AND TRANSPORTER ARE BOTH OPTIONAL. A trip must be creatable with
// neither — the van is usually unknown when the load is planned. And the form
// cannot express a master vehicle AND an ad-hoc plate at once, because the
// choice is one control, so `chk_trips_vehicle_one_of` is unreachable from here.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type {
  DeliveryTypeOption,
  DispatchWindowOption,
  TransporterOption,
  VehicleOption,
} from "./build-trip-drawer";

const LABEL = "block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-1.5";
const INPUT =
  "w-full rounded-[8px] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 outline-none focus:border-gray-400";

export function TripForm({
  tripDate,
  deliveryTypes,
  windows,
  vehicles,
  transporters,
  attachOrderIds,
  seedDeliveryTypeId,
  onClose,
  onCreated,
}: {
  /** YYYY-MM-DD — the board's own anchor day, never a clock read here. */
  tripDate: string;
  deliveryTypes: DeliveryTypeOption[];
  windows: DispatchWindowOption[];
  vehicles: VehicleOption[];
  transporters: TransporterOption[];
  /**
   * Bills to attach the moment the trip exists. Empty for the New trip button;
   * the current selection when the form is opened from "New trip…" at the foot
   * of the bottom bar's list.
   */
  attachOrderIds: number[];
  /** Pre-selects the type when every ticked bill agrees. null = the operator picks. */
  seedDeliveryTypeId: number | null;
  onClose: () => void;
  /** Called after a successful create — the page clears the selection and refetches. */
  onCreated: (tripId: number) => void;
}) {
  const [deliveryTypeId, setDeliveryTypeId] = useState<number | "">(seedDeliveryTypeId ?? "");
  const [dispatchWindowId, setDispatchWindowId] = useState<number | "">("");
  const [vehicleChoice, setVehicleChoice] = useState<number | "" | "adhoc">("");
  const [adhocVehicleNo, setAdhocVehicleNo] = useState("");
  const [transporterId, setTransporterId] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // A master vehicle DEFAULTS the transporter and the operator can still change
  // it — the trip carries its own transporter FK precisely so the default is
  // overridable. Only fills an empty field.
  useEffect(() => {
    if (typeof vehicleChoice !== "number") return;
    const v = vehicles.find((x) => x.id === vehicleChoice);
    if (v?.transporterId != null) setTransporterId((cur) => (cur === "" ? v.transporterId! : cur));
  }, [vehicleChoice, vehicles]);

  const usingAdhoc = vehicleChoice === "adhoc";
  const adhocTrimmed = adhocVehicleNo.trim();
  const canSubmit = !busy && deliveryTypeId !== "" && (!usingAdhoc || adhocTrimmed !== "");

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const res = await fetch("/api/floor/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveryTypeId,
          tripDate,
          dispatchWindowId: dispatchWindowId === "" ? null : dispatchWindowId,
          transporterId: transporterId === "" ? null : transporterId,
          vehicleId: typeof vehicleChoice === "number" ? vehicleChoice : null,
          adhocVehicleNo: usingAdhoc ? adhocTrimmed : null,
          note: note.trim() === "" ? null : note.trim(),
        }),
      });
      const created = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Could not create the trip — ${created?.error ?? `HTTP ${res.status}`}`);
        return;
      }
      const trip = created.trip as { id: number; tripNumber: string };

      if (attachOrderIds.length === 0) {
        toast.success(`${trip.tripNumber} created`);
        onCreated(trip.id);
        return;
      }

      // Attach whatever was ticked. A failure HERE leaves a real, empty trip
      // rather than rolling back — there is no transaction (CORE §3), and an
      // empty trip is visible and fixable where a silently-deleted one is not.
      const billsRes = await fetch(`/api/floor/trips/${trip.id}/bills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: attachOrderIds, action: "add" }),
      });
      const billsBody = await billsRes.json().catch(() => ({}));
      const attached: number[] = billsBody?.attached ?? [];
      const skipped: number[] = billsBody?.skipped ?? [];
      const failed: Array<{ orderId: number; error: string }> = billsBody?.failed ?? [];

      const parts = [`${trip.tripNumber} created`];
      if (attached.length > 0) parts.push(`${attached.length} added`);
      if (skipped.length > 0) parts.push(`${skipped.length} already on it`);
      toast.success(parts.join(" · "));
      // 🔴 NEVER SWALLOWED, even beside a success (FLOOR §6b).
      if (failed.length > 0) {
        toast.error(
          `${failed.length} bill${failed.length === 1 ? "" : "s"} not added — ${failed[0].error}`,
        );
      }
      onCreated(trip.id);
    } catch {
      toast.error("Could not create the trip — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={busy ? undefined : onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-[390px] max-w-full flex-col border-l border-gray-200 bg-white shadow-[0_12px_32px_-18px_rgba(20,19,26,0.4)]">
        <header className="flex items-center gap-2.5 border-b border-gray-200 px-4 py-3.5">
          <h4 className="m-0 text-[15px] font-bold tracking-[-0.01em] text-gray-900">New trip</h4>
          <span className="text-[11.5px] text-gray-400">
            {attachOrderIds.length > 0
              ? `${attachOrderIds.length} bill${attachOrderIds.length === 1 ? "" : "s"} will be added`
              : "number assigned on create"}
          </span>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="tf-type">Delivery type</label>
              <select
                id="tf-type"
                className={INPUT}
                value={deliveryTypeId}
                onChange={(e) => setDeliveryTypeId(e.target.value === "" ? "" : Number(e.target.value))}
              >
                <option value="">Choose…</option>
                {deliveryTypes.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="tf-window">Slot</label>
              <select
                id="tf-window"
                className={INPUT}
                value={dispatchWindowId}
                onChange={(e) => setDispatchWindowId(e.target.value === "" ? "" : Number(e.target.value))}
              >
                <option value="">Not set</option>
                {windows.map((w) => (
                  <option key={w.id} value={w.id}>{w.windowTime}</option>
                ))}
              </select>
              {dispatchWindowId === "" && (
                <p className="mt-1 text-[10.5px] text-gray-400">
                  A trip cannot be released without one.
                </p>
              )}
            </div>
          </div>

          <div>
            <label className={LABEL} htmlFor="tf-vehicle">Vehicle</label>
            <select
              id="tf-vehicle"
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
          </div>

          <div>
            <label className={LABEL} htmlFor="tf-transporter">Transporter</label>
            <select
              id="tf-transporter"
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
            <label className={LABEL} htmlFor="tf-note">Reason / note</label>
            <input
              id="tf-note"
              className={INPUT}
              placeholder="Navsari side, going with the evening load"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
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
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="inline-flex h-[34px] items-center rounded-[8px] bg-brand-600 px-4 text-[12.5px] font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          >
            {busy ? "Creating…" : "Create trip"}
          </button>
        </footer>
      </aside>
    </>
  );
}
