"use client";

// Freight Trips — the rail. The LOOK of Floor's trip rail (components/floor/
// trip-rail.tsx), none of its behaviour: no type letter, no READY, no progress
// bar, no show/billing badges. A freight trip is paper.
//
//   "{n} TRIPS · {m} BILLS"   ← ACTIVE trips of the date
//   [Held bills  {count} bills · {L} L]
//   [F-261002-01  Adajan  /  3 stops · 5 bills · 820 L  /  GJ05AB1234  /  RAMESH]
//   …
//   Cancelled (2)              ← opens a read-only list
//
// While bills are ticked in the pool a click on a trip card ADDS them to it
// (the parent does the add); a hint line says so above the cards.

import { formatLitres } from "@/components/floor/status-pill";
import type { FreightTripSummary } from "./api";

export type RailSelection = { kind: "pool" } | { kind: "trip"; tripId: number } | { kind: "cancelled" };

export function FreightRail({
  trips,
  loading,
  selection,
  onSelect,
  poolCount,
  poolLitres,
  addCount,
  onAddToTrip,
}: {
  trips: FreightTripSummary[] | null;
  loading: boolean;
  selection: RailSelection;
  onSelect: (s: RailSelection) => void;
  poolCount: number;
  poolLitres: number;
  /** Bills ticked in the pool and addable — 0 = normal rail. */
  addCount: number;
  onAddToTrip: (tripId: number) => void;
}) {
  const all = trips ?? [];
  const active = all.filter((t) => t.status !== "cancelled");
  const cancelled = all.length - active.length;
  const billTotal = active.reduce((s, t) => s + t.counts.bills, 0);
  const adding = addCount > 0;

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto border-ink-100 bg-ink-25 px-[11px] pb-4 pt-3 md:border-r">
      <div className="mb-[9px] px-1 text-[11px] font-semibold uppercase tabular-nums tracking-[0.06em] text-ink-400">
        {active.length} trip{active.length === 1 ? "" : "s"} · {billTotal} bill{billTotal === 1 ? "" : "s"}
      </div>

      <button
        type="button"
        onClick={() => onSelect({ kind: "pool" })}
        className={`mb-[14px] w-full rounded-[9px] border px-3 py-2.5 text-left ${
          selection.kind === "pool" ? "border-brand-600 bg-white" : "border-ink-100 bg-white hover:border-ink-200"
        }`}
      >
        <div className="text-[14.5px] font-semibold text-ink-900">Held bills</div>
        <div className="mt-px text-[12.5px] tabular-nums text-ink-500">
          {poolCount} bill{poolCount === 1 ? "" : "s"} · {formatLitres(poolLitres)} L
        </div>
      </button>

      {adding && (
        <div className="mb-2 px-1 text-[11.5px] leading-snug text-ink-600">
          Click a trip to add the {addCount} ticked bill{addCount === 1 ? "" : "s"} to it.
        </div>
      )}

      {loading && trips === null && <div className="px-1 py-4 text-center text-[11px] text-ink-400">Loading trips…</div>}
      {trips !== null && active.length === 0 && (
        <div className="px-1 py-4 text-[11px] leading-relaxed text-ink-400">
          No freight trips on this date. Tick held bills and press + New trip.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {active.map((t) => {
          const selected = selection.kind === "trip" && selection.tripId === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => (adding ? onAddToTrip(t.id) : onSelect({ kind: "trip", tripId: t.id }))}
              title={adding ? `Add ${addCount} bill${addCount === 1 ? "" : "s"} to ${t.tripNumber}` : undefined}
              className={`w-full rounded-[9px] border bg-white px-3 py-2.5 text-left ${
                selected ? "border-brand-600" : adding ? "border-dashed border-ink-400 hover:border-ink-900" : "border-ink-100 hover:border-ink-200"
              }`}
            >
              <span className="inline-block rounded-[4px] border border-ink-100 bg-ink-50 px-1.5 py-[1px] font-mono text-[11px] font-semibold text-ink-700">
                {t.tripNumber}
              </span>
              <div className="mt-1 truncate text-[14px] font-semibold text-ink-900">
                {t.counts.bills === 0 ? "Empty trip" : t.routeLabel ?? "No route"}
              </div>
              <div className="text-[12px] tabular-nums text-ink-500">
                {t.counts.stops} stop{t.counts.stops === 1 ? "" : "s"} · {t.counts.bills} bill{t.counts.bills === 1 ? "" : "s"} ·{" "}
                {formatLitres(t.counts.litres)} L
              </div>
              <div className="mt-1 truncate font-mono text-[11.5px] text-ink-600">{t.vehicleLabel ?? "No vehicle"}</div>
              <div className={`truncate text-[11.5px] font-semibold ${t.driverName ? "uppercase text-ink-700" : "text-warn-text"}`}>
                {t.driverName ?? "No driver yet"}
              </div>
            </button>
          );
        })}
      </div>

      {cancelled > 0 && (
        <button
          type="button"
          onClick={() => onSelect({ kind: "cancelled" })}
          className={`mt-3 self-start px-1 text-[11.5px] underline-offset-2 hover:underline ${
            selection.kind === "cancelled" ? "font-semibold text-ink-900" : "text-ink-500"
          }`}
        >
          Cancelled ({cancelled})
        </button>
      )}
    </div>
  );
}
