"use client";

// Floor Control — the Build trip drawer (mockup §05).
//
// Opens from the At-desk pool with the currently ticked rows. Creates the trip,
// then attaches those bills, then hands control back to floor-page to clear the
// selection and refetch.
//
// TWO CALLS, IN ORDER, AND THE SECOND CAN PARTIALLY FAIL:
//   POST /api/floor/trips              → the trip
//   POST /api/floor/trips/[id]/bills   → { orderIds, action: "add" }
// The second returns `{ attached, skipped, failed }`. 🔴 `failed[]` IS SURFACED,
// never swallowed — a trip created with four of its six bills is a real outcome
// the operator has to see, and reporting only the successes is the swallowed-
// response bug FLOOR §6(b) closed on the release path.
//
// ⚠ NO WINDOW-LEVEL KEY LISTENER. floor-page.tsx is the SINGLE Esc owner for the
// whole floor tree and a second listener races it in registration order — the
// exact bug that spec replaced (FLOOR §4.6). This drawer closes on its own ✕ and
// on the backdrop, and Esc is not its business.
//
// ⚠ RELEASE IS NOT HERE. The mockup shows a "release to the floor now" tick; it
// is deliberately absent from this step. The route exists
// (POST /api/floor/trips/[id]/release) but no button calls it yet.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatLitres } from "./status-pill";
import type { FloorBoardRow } from "@/lib/floor/types";

export interface DeliveryTypeOption {
  id: number;
  name: string;
}
export interface VehicleOption {
  id: number;
  vehicleNo: string;
  driverName: string | null;
  transporterId: number | null;
}
export interface TransporterOption {
  id: number;
  name: string;
}
export interface DispatchWindowOption {
  id: number;
  windowTime: string;
}

const LABEL = "block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-1.5";
const INPUT =
  "w-full rounded-[8px] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 outline-none focus:border-gray-400";

export function BuildTripDrawer({
  rows,
  tripDate,
  deliveryTypes,
  windows,
  vehicles,
  transporters,
  onClose,
  onCreated,
}: {
  /** The ticked bills. Never empty — the pool's button is disabled at zero. */
  rows: FloorBoardRow[];
  /** YYYY-MM-DD. The board's own anchor day, not a clock read here. */
  tripDate: string;
  deliveryTypes: DeliveryTypeOption[];
  windows: DispatchWindowOption[];
  vehicles: VehicleOption[];
  transporters: TransporterOption[];
  onClose: () => void;
  /** Called after a successful create + attach, so the page can clear + refetch. */
  onCreated: () => void;
}) {
  // Seeded from the selection's own delivery type when every ticked bill agrees
  // — the common case, and one fewer decision. When they disagree the operator
  // picks, because guessing would put a Local bill on an Upcountry trip number.
  const seededTypeName = useMemo(() => {
    const names = new Set(rows.map((r) => r.deliveryType).filter(Boolean));
    return names.size === 1 ? (Array.from(names)[0] as string) : null;
  }, [rows]);
  const seededTypeId = useMemo(
    () => deliveryTypes.find((d) => d.name === seededTypeName)?.id ?? null,
    [deliveryTypes, seededTypeName],
  );

  const [deliveryTypeId, setDeliveryTypeId] = useState<number | "">(seededTypeId ?? "");
  const [dispatchWindowId, setDispatchWindowId] = useState<number | "">("");
  // "" = none · a number = a master vehicle · "adhoc" = type a plate.
  const [vehicleChoice, setVehicleChoice] = useState<number | "" | "adhoc">("");
  const [adhocVehicleNo, setAdhocVehicleNo] = useState("");
  const [transporterId, setTransporterId] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Picking a master vehicle DEFAULTS the transporter from it, and the operator
  // can still change it afterwards — the trip carries its own transporter FK
  // precisely so the default is overridable (owner decision 7). Only fills an
  // empty field, so a choice already made is never overwritten.
  useEffect(() => {
    if (typeof vehicleChoice !== "number") return;
    const v = vehicles.find((x) => x.id === vehicleChoice);
    if (v?.transporterId != null) setTransporterId((cur) => (cur === "" ? v.transporterId! : cur));
  }, [vehicleChoice, vehicles]);

  // The selection, summarised by route (mockup). Litres per route and a total.
  const byRoute = useMemo(() => {
    const map = new Map<string, { bills: number; litres: number }>();
    for (const r of rows) {
      const key = r.route ?? "No route";
      const cur = map.get(key) ?? { bills: 0, litres: 0 };
      cur.bills += 1;
      cur.litres += r.volumeLitres ?? 0;
      map.set(key, cur);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "en"));
  }, [rows]);
  const totalLitres = rows.reduce((s, r) => s + (r.volumeLitres ?? 0), 0);

  // chk_trips_vehicle_one_of forbids a master vehicle AND an ad-hoc plate on one
  // trip. The form cannot express both — the choice is a single control — so the
  // constraint can never be reached from here. Kept as a real branch rather than
  // a comment, because the API accepts both fields and a future edit could.
  const usingAdhoc = vehicleChoice === "adhoc";
  const adhocTrimmed = adhocVehicleNo.trim();
  const canSubmit =
    !busy && deliveryTypeId !== "" && rows.length > 0 && (!usingAdhoc || adhocTrimmed !== "");

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const createRes = await fetch("/api/floor/trips", {
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
      const created = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        toast.error(`Could not create the trip — ${created?.error ?? `HTTP ${createRes.status}`}`);
        return;
      }
      const trip = created.trip as { id: number; tripNumber: string };

      // Attach the bills. A failure HERE leaves a real, empty trip behind rather
      // than rolling back — there is no transaction (CORE §3) and an empty trip
      // is a visible, fixable thing, where a silently-deleted one is not.
      const billsRes = await fetch(`/api/floor/trips/${trip.id}/bills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: rows.map((r) => r.orderId), action: "add" }),
      });
      const billsBody = await billsRes.json().catch(() => ({}));
      const attached: number[] = billsBody?.attached ?? [];
      const skipped: number[] = billsBody?.skipped ?? [];
      const failed: Array<{ orderId: number; error: string }> = billsBody?.failed ?? [];

      if (!billsRes.ok && attached.length === 0 && skipped.length === 0) {
        toast.error(
          `${trip.tripNumber} was created but no bill could be added — ${
            failed[0]?.error ?? billsBody?.error ?? `HTTP ${billsRes.status}`
          }`,
        );
      } else {
        const parts = [`${trip.tripNumber} created`];
        if (attached.length > 0) parts.push(`${attached.length} added`);
        if (skipped.length > 0) parts.push(`${skipped.length} already on it`);
        toast.success(parts.join(" · "));
      }
      // 🔴 NEVER SWALLOWED, even alongside a success. A partial attach that
      // reports only its successes is the bug FLOOR §6(b) exists to prevent.
      if (failed.length > 0) {
        toast.error(
          `${failed.length} bill${failed.length === 1 ? "" : "s"} not added — ${failed[0].error}`,
        );
      }

      onCreated();
    } catch {
      toast.error("Could not create the trip — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Backdrop. One of the two close paths; Esc belongs to floor-page. */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={busy ? undefined : onClose} />

      <aside className="fixed inset-y-0 right-0 z-50 flex w-[430px] max-w-full flex-col border-l border-gray-200 bg-white shadow-[0_12px_32px_-18px_rgba(20,19,26,0.4)]">
        <header className="flex items-center gap-2.5 border-b border-gray-200 px-4 py-3.5">
          <h4 className="m-0 text-[15px] font-bold tracking-[-0.01em] text-gray-900">Build trip</h4>
          <span className="ml-auto text-[11.5px] text-gray-400">
            number assigned on create
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="trip-delivery-type">Delivery type</label>
              <select
                id="trip-delivery-type"
                className={INPUT}
                value={deliveryTypeId}
                onChange={(e) => setDeliveryTypeId(e.target.value === "" ? "" : Number(e.target.value))}
              >
                <option value="">Choose…</option>
                {deliveryTypes.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              {seededTypeId === null && (
                <p className="mt-1 text-[10.5px] text-gray-400">
                  The ticked bills span more than one type — pick the trip&rsquo;s own.
                </p>
              )}
            </div>
            <div>
              <label className={LABEL} htmlFor="trip-window">Slot</label>
              <select
                id="trip-window"
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
          </div>

          <div>
            <label className={LABEL} htmlFor="trip-vehicle">Vehicle</label>
            <select
              id="trip-vehicle"
              className={INPUT}
              value={vehicleChoice}
              onChange={(e) => {
                const v = e.target.value;
                setVehicleChoice(v === "" ? "" : v === "adhoc" ? "adhoc" : Number(v));
                if (v !== "adhoc") setAdhocVehicleNo("");
              }}
            >
              {/* OPTIONAL, and the default. A trip must be creatable with no
                  vehicle at all — the van is often unknown at planning time. */}
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
            <label className={LABEL} htmlFor="trip-transporter">Transporter</label>
            <select
              id="trip-transporter"
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
            <label className={LABEL} htmlFor="trip-note">Reason / note</label>
            <input
              id="trip-note"
              className={INPUT}
              placeholder="Navsari side, going with the evening load"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div>
            <label className={LABEL}>
              {rows.length} bill{rows.length === 1 ? "" : "s"} selected
            </label>
            <div className="rounded-[9px] border border-[#f0eef5] bg-[#fcfbfe] px-3 py-2.5 text-[12.5px] text-gray-600">
              {byRoute.map(([route, v]) => (
                <div key={route} className="flex justify-between py-[3px] tabular-nums">
                  <span>{route}</span>
                  <span>
                    {v.bills} bill{v.bills === 1 ? "" : "s"} · {formatLitres(v.litres)} L
                  </span>
                </div>
              ))}
              <div className="mt-1.5 flex justify-between border-t border-gray-200 pt-1.5 font-semibold tabular-nums text-gray-900">
                <span>Total</span>
                <span>
                  {rows.length} bill{rows.length === 1 ? "" : "s"} · {formatLitres(totalLitres)} L
                </span>
              </div>
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-gray-400">
            The trip is created as a draft. Releasing it to the floor is a separate step.
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
