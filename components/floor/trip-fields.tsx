"use client";

// Floor Control — the ONE field body both trip drawers render
// (docs/mockups/floor-trips/trip-form-v1.html, LOCKED 2026-09-21).
//
// Field order (Smart Flow, 2026-10-04): Delivery type (New only) → a "Timing"
// box (Slot *, Manual dispatch time * as date + time) → a "Vehicle" box
// (Vehicle size on Upcountry, Transporter *, Vehicle *, Diesel amount ₹) →
// Reason / note. trip-form.tsx (POST) and trip-vehicle-editor.tsx (PATCH) own
// the header, the footer and the request; this file owns the fields, the drawer
// shell, the required-field rule and all the styling.
//
// ⚠ THE DOCKET FIELD IS GONE FROM THE DRAWER (2026-10-04) — UI only. The
// `transporterTripNo` column stays, PATCH still accepts it, and the trip header
// still prints a stored one.
//
// ⚠ A HAND TRIP (the dealer collects) has no transporter or vehicle to pick: the
// two pickers are replaced by the Hand line and are not required. Slot and the
// manual dispatch time still are.
//
// ⚠ TRANSPORTER COMES BEFORE VEHICLE, AND THE VEHICLE LIST IS THAT
// TRANSPORTER'S FLEET. So a picked vehicle can never quietly swap the
// transporter. Changing the transporter clears the vehicle.
//
// ⚠ NO HELPER TEXT (owner, 2026-09-21). Labels only — no "optional", no hints.
//
// ⚠ NO WINDOW-LEVEL KEY LISTENER. floor-page.tsx is the SINGLE Esc owner for the
// whole floor tree (FLOOR §4.6). The drawer closes on its ✕ and its backdrop.

import { VEHICLE_SIZES, VEHICLE_SIZE_DELIVERY_TYPE, VEHICLE_SIZE_LABEL, type VehicleSize } from "@/lib/trips/vehicle-size";
import type { ReactNode } from "react";
import { Clock, Truck, X } from "lucide-react";
import { ManualDispatchField } from "@/components/trips/manual-dispatch-field";
import { SearchSelect, Highlight, HighlightSpan } from "@/components/ui/search-select";
import type {
  DeliveryTypeOption,
  DispatchWindowOption,
  TransporterOption,
  VehicleOption,
} from "./trip-options";

// ── Shared styling ─────────────────────────────────────────────────────────

const LABEL = "mb-1.5 block text-[12px] font-medium text-gray-500";
const INPUT =
  "w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10";
/** CLAUDE_UI §9's error state, added over INPUT. */
const INPUT_ERROR = "!border-red-300 ring-2 ring-red-500/[0.06]";
const ERROR_TEXT = "mt-1 text-[12px] text-red-600";
/** The light tinted group box ("Timing", "Vehicle"). */
const GROUP = "flex flex-col gap-[14px] rounded-xl border border-ink-100 bg-ink-25 p-3.5";
const GROUP_LABEL = "flex items-center gap-1.5 text-[12px] font-medium text-gray-500";
const REQUIRED = <span className="text-red-500">*</span>;

export const BUTTON_SECONDARY =
  "inline-flex h-[38px] items-center rounded-lg border border-gray-200 bg-white px-4 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50";
// Disabled keeps its border — same box model in both states (CLAUDE_UI §10).
export const BUTTON_PRIMARY =
  "inline-flex h-[38px] items-center rounded-lg border border-brand-600 bg-brand-600 px-4 text-[13px] font-semibold text-white hover:border-brand-700 hover:bg-brand-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400";

// ── Values ─────────────────────────────────────────────────────────────────

/** A master vehicle, or a plate typed by hand (`trips.adhocVehicleNo`). */
export type VehiclePick =
  | { kind: "master"; id: number; plate: string; driver: string | null }
  | { kind: "typed"; plate: string };

export interface TripFieldValues {
  /** New only — the Edit drawer shows the type locked in its header. */
  deliveryTypeId: number | null;
  dispatchWindowId: number | null;
  /** Carries the name so a stored transporter missing from the list still shows. */
  transporter: { id: number; name: string } | null;
  vehicle: VehiclePick | null;
  /** gc | ace | big — asked (and required) on an Upcountry trip only. */
  vehicleSize: VehicleSize | null;
  /** Manual dispatch time, IST: YYYY-MM-DD (defaults to today in IST) … */
  dispatchDate: string;
  /** … and HH:MM, empty until typed. Sent together as `…+05:30`. */
  dispatchTime: string;
  /** Rupees as typed — digits, at most 2 decimals. Empty = none. */
  diesel: string;
  note: string;
}

/** Is the size asked for (and required) on this form? Upcountry only (owner, 2026-09-21). */
export function asksVehicleSize(values: TripFieldValues, deliveryTypes: DeliveryTypeOption[]): boolean {
  return deliveryTypes.find((d) => d.id === values.deliveryTypeId)?.name === VEHICLE_SIZE_DELIVERY_TYPE;
}

/** What the diesel input will accept while typing: up to 8 digits, up to 2 decimals. */
const DIESEL_TYPING = /^\d{0,8}(\.\d{0,2})?$/;

export type TripFieldErrors = Partial<
  Record<"vehicleSize" | "slot" | "dispatch" | "transporter" | "vehicle" | "diesel", string>
>;

/**
 * The Edit drawer's required-field rule (Smart Flow, 2026-10-04): Slot, Manual
 * dispatch time (date AND time), Transporter and Vehicle — the last two not on a
 * Hand trip — plus the Upcountry vehicle size. An older trip with blanks is
 * completed on its next save. Empty object = OK to save.
 */
export function validateTripFields(
  values: TripFieldValues,
  opts: { isHand: boolean; needsSize: boolean },
): TripFieldErrors {
  const e: TripFieldErrors = {};
  if (opts.needsSize && values.vehicleSize === null) e.vehicleSize = "Pick a vehicle size";
  if (values.dispatchWindowId === null) e.slot = "Pick a slot";
  if (values.dispatchDate === "" || values.dispatchTime === "") e.dispatch = "Enter the date and time";
  if (!opts.isHand) {
    if (values.transporter === null) e.transporter = "Pick a transporter";
    if (values.vehicle === null) e.vehicle = "Pick a vehicle or type the plate";
  }
  const d = values.diesel.trim();
  if (d !== "" && (d === "." || !DIESEL_TYPING.test(d))) e.diesel = "Enter an amount, e.g. 1250";
  return e;
}

/** The default transporter, looked up BY NAME — never by a hard-coded id. */
export function findDefaultTransporter(transporters: TransporterOption[]): { id: number; name: string } | null {
  const t = transporters.find((x) => /^nagadhiraj$/i.test(x.name.trim()));
  return t ? { id: t.id, name: t.name } : null;
}

/** Plate as compared: spaces and dashes stripped, upper-cased. */
export function normPlate(s: string): string {
  return s.toUpperCase().replace(/[\s-]/g, "");
}

/** Where the normalised query sits in the ORIGINAL plate, as [start, end). */
function plateMatchSpan(plate: string, nq: string): [number, number] {
  if (!nq) return [-1, -1];
  const kept: number[] = [];
  for (let i = 0; i < plate.length; i++) if (!/[\s-]/.test(plate[i])) kept.push(i);
  const at = normPlate(plate).indexOf(nq);
  if (at < 0) return [-1, -1];
  return [kept[at], kept[at + nq.length - 1] + 1];
}

// ── The drawer shell ───────────────────────────────────────────────────────

export function TripDrawer({
  busy,
  onClose,
  title,
  meta,
  footer,
  children,
}: {
  busy: boolean;
  onClose: () => void;
  /** The header's first line, left of the ✕. */
  title: ReactNode;
  /** Optional second header line. */
  meta?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={busy ? undefined : onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-full flex-col border-l border-gray-200 bg-white shadow-xl">
        <header className="border-b border-gray-100 px-5 pb-3.5 pt-4">
          <div className="flex items-center gap-2">
            {title}
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>
          {meta && <div className="mt-1.5 text-[12.5px] text-gray-500">{meta}</div>}
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-5 py-[18px]">{children}</div>
        <footer className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3.5">{footer}</footer>
      </aside>
    </>
  );
}

// ── The fields ─────────────────────────────────────────────────────────────

export function TripFields({
  mode,
  values,
  onChange,
  deliveryTypes,
  windows,
  vehicles,
  transporters,
  extraWindow,
  isHand = false,
  errors = {},
}: {
  mode: "new" | "edit";
  values: TripFieldValues;
  onChange: (next: TripFieldValues) => void;
  deliveryTypes: DeliveryTypeOption[];
  windows: DispatchWindowOption[];
  vehicles: VehicleOption[];
  transporters: TransporterOption[];
  /**
   * Edit only: the trip's stored slot when it is no longer in the active list,
   * so it still shows as selected instead of silently vanishing.
   */
  extraWindow?: DispatchWindowOption | null;
  /** A Hand trip: no transporter or vehicle pickers (and neither is required). */
  isHand?: boolean;
  /** Inline errors, one short line under each missing field. Empty = none shown. */
  errors?: TripFieldErrors;
}) {
  const set = (patch: Partial<TripFieldValues>) => onChange({ ...values, ...patch });

  const slotList =
    extraWindow && !windows.some((w) => w.id === extraWindow.id) ? [...windows, extraWindow] : windows;

  // The selected transporter's fleet. Not set → every active vehicle.
  const fleet = values.transporter
    ? vehicles.filter((v) => v.transporterId === values.transporter!.id)
    : vehicles;

  function pickTransporter(t: { id: number; name: string } | null) {
    const changed = (t?.id ?? null) !== (values.transporter?.id ?? null);
    set({ transporter: t, ...(changed ? { vehicle: null } : {}) });
  }

  function pickVehicle(v: VehicleOption) {
    const next: Partial<TripFieldValues> = {
      vehicle: { kind: "master", id: v.id, plate: v.vehicleNo, driver: v.driverName },
    };
    // Transporter Not set: take the vehicle's own, so the screen shows what the
    // server would default to anyway.
    if (!values.transporter) {
      const own = transporters.find((t) => t.id === v.transporterId);
      if (own) next.transporter = { id: own.id, name: own.name };
    }
    set(next);
  }

  return (
    <>
      {mode === "new" && (
        <div>
          <span className={LABEL}>Delivery type</span>
          <div className="flex gap-0.5 rounded-lg bg-gray-100 p-[3px]" role="radiogroup" aria-label="Delivery type">
            {deliveryTypes.map((d) => {
              const on = values.deliveryTypeId === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set({ deliveryTypeId: d.id })}
                  className={`h-8 flex-1 rounded-md text-[13px] font-medium ${
                    on ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {d.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Timing ─────────────────────────────────────────────────────── */}
      <section className={GROUP} aria-label="Timing">
        <div className={GROUP_LABEL}>
          <Clock size={13} strokeWidth={1.8} />
          Timing
        </div>

        <div>
          <span className={LABEL}>Slot {REQUIRED}</span>
          <div className="flex flex-wrap gap-1.5">
            {slotList.map((w) => {
              const on = values.dispatchWindowId === w.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  aria-pressed={on}
                  // Tap the selected chip again to clear it.
                  onClick={() => set({ dispatchWindowId: on ? null : w.id })}
                  className={`h-8 rounded-lg border px-3 text-[13px] ${
                    on
                      ? "border-brand-500 bg-brand-50 font-semibold text-brand-600"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                  }`}
                >
                  {w.windowTime}
                </button>
              );
            })}
          </div>
          {errors.slot && <div className={ERROR_TEXT}>{errors.slot}</div>}
        </div>

        {/* Shared with the Freight drawer (components/trips/manual-dispatch-field.tsx). */}
        <ManualDispatchField
          id="trip-dispatch-date"
          date={values.dispatchDate}
          time={values.dispatchTime}
          onChange={({ date, time }) => set({ dispatchDate: date, dispatchTime: time })}
          error={errors.dispatch}
        />
      </section>

      {/* ── Vehicle ────────────────────────────────────────────────────── */}
      <section className={GROUP} aria-label="Vehicle">
        <div className={GROUP_LABEL}>
          <Truck size={13} strokeWidth={1.8} />
          Vehicle
        </div>

        {!isHand && asksVehicleSize(values, deliveryTypes) && (
          <div>
            <span className={LABEL}>Vehicle size {REQUIRED}</span>
            <div className="flex gap-0.5 rounded-lg bg-gray-100 p-[3px]" role="radiogroup" aria-label="Vehicle size">
              {VEHICLE_SIZES.map((sz) => {
                const on = values.vehicleSize === sz;
                return (
                  <button
                    key={sz}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set({ vehicleSize: sz })}
                    className={`h-8 flex-1 rounded-md text-[13px] font-medium ${
                      on ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    {VEHICLE_SIZE_LABEL[sz]}
                  </button>
                );
              })}
            </div>
            {errors.vehicleSize && <div className={ERROR_TEXT}>{errors.vehicleSize}</div>}
          </div>
        )}

        {isHand ? (
          // A HAND TRIP (2026-09-24): the dealer collects — no transporter, no
          // vehicle, and the server refuses a vehicle or plate. Nothing to pick.
          <div className="text-[13px] font-semibold text-data-brown">✋ Hand — dealer collects</div>
        ) : (
          <>
            <div>
              <label className={LABEL} htmlFor="trip-transporter">
                Transporter {REQUIRED}
              </label>
              <SearchSelect<TransporterOption>
                id="trip-transporter"
                items={transporters}
                getKey={(t) => t.id}
                matches={(t, q) => t.name.toLowerCase().includes(q.trim().toLowerCase())}
                renderItem={(t, q) => (
                  <span className="truncate">
                    <Highlight text={t.name} query={q} />
                  </span>
                )}
                selectedKey={values.transporter?.id ?? null}
                value={values.transporter ? <span className="truncate text-gray-900">{values.transporter.name}</span> : null}
                placeholder="Not set"
                searchPlaceholder="Search transporter"
                onPick={(t) => pickTransporter({ id: t.id, name: t.name })}
                onClear={() => pickTransporter(null)}
                emptyText={(q) => `No transporter matches “${q}”`}
              />
              {errors.transporter && <div className={ERROR_TEXT}>{errors.transporter}</div>}
            </div>

            <div>
              <label className={LABEL} htmlFor="trip-vehicle">
                Vehicle {REQUIRED}
              </label>
              <SearchSelect<VehicleOption>
                id="trip-vehicle"
                items={fleet}
                getKey={(v) => v.id}
                matches={(v, q) => {
                  const nq = normPlate(q);
                  const lq = q.trim().toLowerCase();
                  if (!lq) return true;
                  return (nq !== "" && normPlate(v.vehicleNo).includes(nq)) || (v.driverName ?? "").toLowerCase().includes(lq);
                }}
                renderItem={(v, q) => {
                  const [s, e] = plateMatchSpan(v.vehicleNo, normPlate(q));
                  return (
                    <>
                      <span className="shrink-0 font-mono">
                        <HighlightSpan text={v.vehicleNo} start={s} end={e} />
                      </span>
                      {v.driverName && (
                        <span className="truncate font-normal text-gray-500">
                          <Highlight text={v.driverName} query={q} />
                        </span>
                      )}
                    </>
                  );
                }}
                selectedKey={values.vehicle?.kind === "master" ? values.vehicle.id : null}
                value={
                  values.vehicle ? (
                    <>
                      <span className="shrink-0 font-mono text-gray-900">{values.vehicle.plate}</span>
                      {values.vehicle.kind === "master" ? (
                        values.vehicle.driver && <span className="truncate text-gray-500">{values.vehicle.driver}</span>
                      ) : (
                        <span className="shrink-0 rounded-[5px] bg-warn-bg px-1.5 py-px text-[11px] font-semibold text-warn-text">
                          typed plate
                        </span>
                      )}
                    </>
                  ) : null
                }
                placeholder="No vehicle yet"
                searchPlaceholder={fleet.length > 0 ? "Search plate or driver" : "Type the plate"}
                onPick={pickVehicle}
                onClear={() => set({ vehicle: null })}
                extraRow={(q) => {
                  const nq = normPlate(q);
                  if (nq.length < 4 || fleet.some((v) => normPlate(v.vehicleNo) === nq)) return null;
                  return {
                    key: "typed",
                    render: (
                      <>
                        <span>
                          Use <span className="font-mono">“{nq}”</span> as typed plate
                        </span>
                        <span className="ml-auto shrink-0 rounded-[5px] bg-warn-bg px-1.5 py-px text-[11px] font-semibold text-warn-text">
                          typed
                        </span>
                      </>
                    ),
                    onPick: () => set({ vehicle: { kind: "typed", plate: nq } }),
                  };
                }}
                emptyText={(q) => (q.trim() ? "Type at least 4 characters of the plate" : "Start typing a plate")}
              />
              {errors.vehicle && <div className={ERROR_TEXT}>{errors.vehicle}</div>}
            </div>
          </>
        )}

        <div>
          <label className={LABEL} htmlFor="trip-diesel">Diesel amount (₹)</label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[13px] text-gray-400">₹</span>
            <input
              id="trip-diesel"
              inputMode="decimal"
              className={`${INPUT} h-[38px] pl-7 tabular-nums ${errors.diesel ? INPUT_ERROR : ""}`}
              placeholder="0"
              value={values.diesel}
              // Refuse the keystroke rather than accept a value the route
              // would refuse: digits, one dot, at most two decimals, ≥ 0.
              onChange={(e) => {
                const next = e.target.value.replace(/,/g, "");
                if (DIESEL_TYPING.test(next)) set({ diesel: next });
              }}
            />
          </div>
          {errors.diesel && <div className={ERROR_TEXT}>{errors.diesel}</div>}
        </div>
      </section>

      <div>
        <label className={LABEL} htmlFor="trip-note">Reason / note</label>
        <textarea
          id="trip-note"
          rows={2}
          className={`${INPUT} h-16 resize-none py-2`}
          placeholder="Navsari side, going with the evening load"
          value={values.note}
          onChange={(e) => set({ note: e.target.value })}
        />
      </div>
    </>
  );
}
