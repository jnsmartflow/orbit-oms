"use client";

// Floor Control — the New trip drawer (docs/mockups/floor-trips/trip-form-v1.html,
// LOCKED 2026-09-21). The fields are the shared body in trip-fields.tsx; this
// file owns the header, the footer and the POST.
//
// Delivery type is the ONLY required field — it is the letter in the trip
// number. Nothing is pre-selected: the planner picks it. Transporter starts as
// Nagadhiraj (looked up by name). Everything else is optional, and so are bills.
//
// 🔴 AN EMPTY TRIP IS VALID (owner, slice 6, 2026-09-15). The floor plans
// trucks before the bills exist, so "+ New trip" creates an empty trip and bills
// are added later. Do NOT add an "at least one bill" rule here or in
// POST /api/floor/trips.
//
// ⚠ A VEHICLE ON THE FORM MOVES THE TRIP OUT OF DRAFT, on the server (the create
// route writes `released` and its stamps). Nothing on screen names that state.
//
// ⚠ ONE CALLER, AND IT PASSES NO BILLS. The form opens only from the "+ New
// trip" button (floor-page.tsx, `openTripForm([])`). Creating a trip WITH the
// ticked bills does not use this form at all — `createTripWithSelection` posts
// straight to the route. `attachOrderIds` is kept so the form can still attach
// bills if a caller ever passes some.
//
// ⚠ TRANSPORTER IS ALWAYS SENT. The route defaults the transporter from the
// vehicle only when the supplied one is null, and a supplied value wins — so
// what the planner sees on the form is what is saved.
//
// ⚠ NO WINDOW-LEVEL KEY LISTENER. floor-page.tsx is the SINGLE Esc owner for the
// whole floor tree (FLOOR §4.6). This closes on its ✕ and its backdrop.

import { useState } from "react";
import { toast } from "sonner";
import type {
  DeliveryTypeOption,
  DispatchWindowOption,
  TransporterOption,
  VehicleOption,
} from "./trip-options";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  TripDrawer,
  TripFields,
  findDefaultTransporter,
  type TripFieldValues,
} from "./trip-fields";

export function TripForm({
  tripDate,
  deliveryTypes,
  windows,
  vehicles,
  transporters,
  attachOrderIds,
  onClose,
  onCreated,
}: {
  /** YYYY-MM-DD — the board's own anchor day, never a clock read here. */
  tripDate: string;
  deliveryTypes: DeliveryTypeOption[];
  windows: DispatchWindowOption[];
  vehicles: VehicleOption[];
  transporters: TransporterOption[];
  /** Bills to attach the moment the trip exists. Empty from the one caller today. */
  attachOrderIds: number[];
  onClose: () => void;
  /** Called after a successful create — the page clears the selection and refetches. */
  onCreated: (tripId: number) => void;
}) {
  const [values, setValues] = useState<TripFieldValues>(() => ({
    deliveryTypeId: null,
    dispatchWindowId: null,
    transporter: findDefaultTransporter(transporters),
    vehicle: null,
    docket: "",
    note: "",
  }));
  const [busy, setBusy] = useState(false);

  const canSubmit = !busy && values.deliveryTypeId !== null;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const v = values.vehicle;
      const res = await fetch("/api/floor/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveryTypeId: values.deliveryTypeId,
          tripDate,
          dispatchWindowId: values.dispatchWindowId,
          transporterId: values.transporter?.id ?? null,
          // Never both — chk_trips_vehicle_one_of.
          vehicleId: v?.kind === "master" ? v.id : null,
          adhocVehicleNo: v?.kind === "typed" ? v.plate : null,
          transporterTripNo: values.docket.trim() === "" ? null : values.docket.trim(),
          note: values.note.trim() === "" ? null : values.note.trim(),
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

      // Attach whatever was passed. A failure HERE leaves a real, empty trip
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
    <TripDrawer
      busy={busy}
      onClose={onClose}
      title={<h4 className="m-0 text-[16px] font-semibold text-gray-900">New trip</h4>}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={BUTTON_SECONDARY}>
            Cancel
          </button>
          <button type="button" onClick={() => void submit()} disabled={!canSubmit} className={BUTTON_PRIMARY}>
            {busy ? "Creating…" : "Create trip"}
          </button>
        </>
      }
    >
      <TripFields
        mode="new"
        values={values}
        onChange={setValues}
        deliveryTypes={deliveryTypes}
        windows={windows}
        vehicles={vehicles}
        transporters={transporters}
      />
    </TripDrawer>
  );
}
