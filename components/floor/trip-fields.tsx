"use client";

// Floor Control — the ONE field body both trip drawers render
// (docs/mockups/floor-trips/trip-form-v1.html, LOCKED 2026-09-21).
//
// Field order, both modes: Delivery type (New only) → Slot → Transporter →
// Vehicle → Transporter's trip / docket no. → Reason / note. trip-form.tsx
// (POST) and trip-vehicle-editor.tsx (PATCH) own the header, the footer and the
// request; this file owns the fields, the drawer shell and all the styling.
//
// ⚠ TRANSPORTER COMES BEFORE VEHICLE, AND THE VEHICLE LIST IS THAT
// TRANSPORTER'S FLEET. So a picked vehicle can never quietly swap the
// transporter. Changing the transporter clears the vehicle.
//
// ⚠ NO HELPER TEXT (owner, 2026-09-21). Labels only — no "optional", no hints.
//
// ⚠ NO WINDOW-LEVEL KEY LISTENER. floor-page.tsx is the SINGLE Esc owner for the
// whole floor tree (FLOOR §4.6). The drawer closes on its ✕ and its backdrop.

import type { ReactNode } from "react";
import { X } from "lucide-react";
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
  docket: string;
  note: string;
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

      <div>
        <span className={LABEL}>Slot</span>
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
      </div>

      <div>
        <label className={LABEL} htmlFor="trip-transporter">Transporter</label>
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
      </div>

      <div>
        <label className={LABEL} htmlFor="trip-vehicle">Vehicle</label>
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
      </div>

      <div>
        <label className={LABEL} htmlFor="trip-docket">Transporter&rsquo;s trip / docket no.</label>
        <input
          id="trip-docket"
          className={`${INPUT} h-[38px]`}
          placeholder="e.g. L42"
          value={values.docket}
          onChange={(e) => set({ docket: e.target.value })}
        />
      </div>

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
