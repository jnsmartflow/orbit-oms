"use client";

// ── Assign tab › Trips view — the trip list's pieces (2026-10-13, slices 2–4) ──
//
// Design: docs/mockups/picking/assign-trips-view.html (screens ② and ③).
// Data:   GET /api/picking/trips (lib/picking/trips-view.ts), owned by the shell.
//
// 🔴 PRESENTATIONAL ONLY. Props in, taps out. No fetch, no history, no state.
// The BILLS inside a trip are not drawn here: picking-board-mobile.tsx renders
// them with its own PickingCard, the same card every tab uses — this file draws
// only what no bill card can carry (the trip row, its ring, the trip header).
//
// 🔴 THE TILE COLOUR KEYS ON THE TRIP'S STORED `typeCode`, NOT A BILL'S
// deliveryType (CLAUDE_UI.md §62.3 — RouteDot keys on deliveryType, a different
// fact). The two blues/oranges are RouteDot's own Local/Upcountry values
// (§60); IGT and Cross trips take a neutral grey tile (owner).

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PickingTrip, PickingTripCounts } from "@/lib/picking/types";
import { CARD_SHADOW_V2 } from "./card-atoms";
// One "needs check" value for every progress bar in the product (Floor's bar,
// trip bar, route cards) — reused, never retyped.
import { NEEDS_CHECK_SEGMENT } from "@/components/floor/progress-bar";

// The ring's / bar's segment colours. The SAME tones Floor's progress bar draws
// for the same buckets (components/floor/progress-bar.tsx: waiting #d1d5db,
// with-picker #0284C7, done #22c55e, tint #f9a8d4), so a trip reads the same on
// the desk and on the phone. Picking had no segment palette of its own.
export const TRIP_SEGMENT = {
  waiting: "#d1d5db",
  tinting: "#f9a8d4",
  picking: "#0284C7",
  needsCheck: NEEDS_CHECK_SEGMENT,
  done: "#22c55e",
} as const;

/** Segment order, start → end: least started first, finished last (the mockup's order). */
const SEGMENT_ORDER: ReadonlyArray<{ key: keyof typeof TRIP_SEGMENT; of: (c: PickingTripCounts) => number }> = [
  // Locked Zone-2 bills are still "to assign" — grey, like the due ones.
  { key: "waiting", of: (c) => c.waiting + c.lockedUpcoming },
  { key: "tinting", of: (c) => c.tinting },
  { key: "picking", of: (c) => c.picking },
  { key: "needsCheck", of: (c) => c.needsCheck },
  { key: "done", of: (c) => c.checked },
];

/** The five ring segments' values. HELD and `other` are out (held never goes; other has no colour). */
function segments(c: PickingTripCounts): Array<{ color: string; n: number }> {
  return SEGMENT_ORDER.map((s) => ({ color: TRIP_SEGMENT[s.key], n: s.of(c) })).filter((s) => s.n > 0);
}

/** "Local" / "UPC" / "IGT" / "Cross" — the board's own pill word for U. */
export function tripTypeLabel(typeCode: string): string {
  if (typeCode === "L") return "Local";
  if (typeCode === "U") return "UPC";
  if (typeCode === "I") return "IGT";
  if (typeCode === "C") return "Cross";
  return typeCode;
}

/** Tile / tag colours by stored type. RouteDot's L and U values; neutral grey otherwise. */
function typeTone(typeCode: string): { fg: string; bg: string } {
  if (typeCode === "L") return { fg: "#2563eb", bg: "#eaf1ff" };
  if (typeCode === "U") return { fg: "#ea580c", bg: "#fff1e7" };
  return { fg: "#667085", bg: "#f2f4f7" };
}

/** What the ring's centre says — decided on the phone from the visible due rows. */
export type TripCentre =
  | { kind: "left"; n: number }
  | { kind: "locked" }
  | { kind: "tint" }
  | { kind: "done" };

/** The centre rule (owner): >0 left → the number; else locked → 🔒; else tint → pink; else ✓. */
export function tripCentre(left: number, counts: PickingTripCounts): TripCentre {
  if (left > 0) return { kind: "left", n: left };
  if (counts.lockedUpcoming > 0) return { kind: "locked" };
  if (counts.tinting > 0) return { kind: "tint" };
  return { kind: "done" };
}

function LockMark(): React.JSX.Element {
  return (
    <svg className="w-[15px] h-[15px] text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-label="Locked — upcoming">
      <rect x="4" y="10.5" width="16" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </svg>
  );
}

// ── THE RING ────────────────────────────────────────────────────────────────
// Progress ring on Picking — owner-approved 2026-10-13, deliberate reversal of
// CLAUDE_UI §62.4 roll-up rejection.
//
// Segments come from the SERVER's whole-trip counts (the board cannot see a
// carried trip's earlier-checked bills, dispatched or held bills — discovery F).
// The centre is the phone's: bills still to assign, from the same due waiting
// rows the Bills view shows, so the two views can never disagree.
function TripRing({ counts, centre, ground }: { counts: PickingTripCounts; centre: TripCentre; ground: string }): React.JSX.Element {
  const segs = segments(counts);
  const total = segs.reduce((s, x) => s + x.n, 0);
  let at = 0;
  const stops = segs.map((s) => {
    const from = (at / total) * 360;
    at += s.n;
    const to = (at / total) * 360;
    return `${s.color} ${from}deg ${to}deg`;
  });
  const background = total === 0 ? "#eef1f4" : `conic-gradient(${stops.join(", ")})`;
  return (
    <div className="w-[46px] h-[46px] rounded-full shrink-0 grid place-items-center" style={{ background }}>
      <div className="w-[35px] h-[35px] rounded-full grid place-items-center leading-none" style={{ background: ground }}>
        {centre.kind === "left" && (
          <span className="flex flex-col items-center">
            <span className="text-[15px] font-bold tabular-nums text-[#1d2939]">{centre.n}</span>
            <span className="text-[8px] font-bold tracking-wide text-gray-400 mt-[1px]">LEFT</span>
          </span>
        )}
        {centre.kind === "locked" && <LockMark />}
        {centre.kind === "tint" && (
          <span className="text-[8.5px] font-bold tracking-wide" style={{ color: "#be185d" }} aria-label="Waiting on the tint room">
            TINT
          </span>
        )}
        {centre.kind === "done" && (
          <span className="flex flex-col items-center">
            <span className="text-[15px] font-bold" style={{ color: "#16a34a" }}>✓</span>
            <span className="text-[7.5px] font-bold tracking-wide text-gray-400 mt-[1px]">ALL IN</span>
          </span>
        )}
      </div>
    </div>
  );
}

function TypeTile({ typeCode }: { typeCode: string }): React.JSX.Element {
  const t = typeTone(typeCode);
  return (
    <span
      className="w-[38px] h-[38px] rounded-full shrink-0 grid place-items-center text-[16px] font-bold"
      style={{ background: t.bg, color: t.fg }}
      aria-label={tripTypeLabel(typeCode)}
    >
      {typeCode}
    </span>
  );
}

/** One trip in the list (mockup ②). The whole card is the tap target. */
export function TripRow({
  trip,
  left,
  onOpen,
}: {
  trip: PickingTrip;
  left: number;
  onOpen: () => void;
}): React.JSX.Element {
  const centre = tripCentre(left, trip.counts);
  const done = centre.kind === "done";
  // Soft green on a finished trip — Picking's own checked-footer green pair.
  const ground = done ? "#f0fdf4" : "#ffffff";
  const line = [trip.cutoff ?? "no slot", trip.routeLabel ?? "No route"].join(" · ");
  return (
    <button
      type="button"
      onClick={onOpen}
      className={
        "w-full text-left border rounded-[16px] overflow-hidden mb-2.5 active:opacity-70 flex items-center gap-3 px-3.5 py-3 " +
        (done ? "border-[#dcfce7]" : "border-gray-200")
      }
      style={{ boxShadow: CARD_SHADOW_V2, background: ground }}
    >
      <TypeTile typeCode={trip.typeCode} />
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-semibold tabular-nums text-[#1d2939] truncate">{trip.tripNumber}</span>
        <span className="block text-[12.5px] font-medium text-[#98a2b3] mt-[2px] truncate">{line}</span>
      </span>
      <TripRing counts={trip.counts} centre={centre} ground={ground} />
    </button>
  );
}

/**
 * The last card — waiting bills on no trip, a COUNT only (owner). Gate ON →
 * "N not planned yet" and inert (none of them is on the board). Gate OFF →
 * tapping goes to the Bills view, where they all are.
 */
export function NotOnTripCard({
  bills,
  notPlannedYet,
  onOpenBills,
}: {
  bills: number;
  notPlannedYet: boolean;
  onOpenBills: () => void;
}): React.JSX.Element {
  const body = (
    <>
      <span className="w-[38px] h-[38px] rounded-full shrink-0 grid place-items-center text-[15px] font-semibold bg-gray-100 text-gray-400">
        —
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-[#1d2939]">Not on a trip</span>
        <span className="block text-[12.5px] font-medium text-[#98a2b3] mt-[2px] truncate">
          {notPlannedYet ? (
            <>
              <span className="tabular-nums">{bills}</span> not planned yet
            </>
          ) : (
            "Bills the planner hasn't put on a truck"
          )}
        </span>
      </span>
      {notPlannedYet ? null : (
        <span className="flex items-center gap-1 shrink-0 text-[15px] font-bold tabular-nums text-[#1d2939]">
          {bills}
          <ChevronRight size={16} className="text-gray-400" />
        </span>
      )}
    </>
  );
  const shell = "w-full text-left bg-white border border-gray-200 rounded-[16px] overflow-hidden mb-2.5 flex items-center gap-3 px-3.5 py-3";
  if (notPlannedYet) {
    return (
      <div className={shell} style={{ boxShadow: CARD_SHADOW_V2 }}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" onClick={onOpenBills} className={shell + " active:opacity-70"} style={{ boxShadow: CARD_SHADOW_V2 }}>
      {body}
    </button>
  );
}

/**
 * The opened trip's header (mockup ③): ‹, number + type, "Cutoff · stops", the
 * details box, the status bar and its counts. `trip` null = the trip left the
 * desk while open — the screen stays (never auto-closed under a thumb) and says so.
 */
export function TripHeader({ trip, onBack }: { trip: PickingTrip | null; onBack: () => void }): React.JSX.Element {
  const back = (
    <button
      type="button"
      onClick={onBack}
      aria-label="Back to trips"
      className="w-11 h-11 -ml-2.5 shrink-0 flex items-center justify-center rounded-[10px] text-gray-500 active:bg-gray-100"
    >
      <ChevronLeft size={22} />
    </button>
  );
  if (trip === null) {
    return (
      <div className="flex items-center gap-2 mb-3">
        {back}
        <div className="text-[13px] text-gray-400">This trip is no longer on the desk.</div>
      </div>
    );
  }
  const tone = typeTone(trip.typeCode);
  const c = trip.counts;
  const segs = SEGMENT_ORDER.map((s) => ({ key: s.key, n: s.of(c) }));
  const total = segs.reduce((s, x) => s + x.n, 0);
  const legend: Array<{ key: keyof typeof TRIP_SEGMENT; n: number; label: string }> = [
    { key: "waiting", n: c.waiting + c.lockedUpcoming, label: "to assign" },
    { key: "picking", n: c.picking, label: "picking" },
    { key: "needsCheck", n: c.needsCheck, label: "check" },
    { key: "done", n: c.checked, label: "done" },
    { key: "tinting", n: c.tinting, label: "tinting" },
  ];
  const driver = [trip.driverName, trip.driverPhone].filter((v): v is string => v !== null && v.trim() !== "").join(" · ");
  return (
    <div
      className="bg-white border border-gray-200 rounded-[16px] px-3.5 pt-2 pb-3 mb-3"
      style={{ boxShadow: CARD_SHADOW_V2 }}
    >
      <div className="flex items-center gap-2">
        {back}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[19px] font-semibold tabular-nums text-[#1d2939] truncate">{trip.tripNumber}</span>
            <span
              className="shrink-0 text-[10.5px] font-bold uppercase tracking-wider rounded-[6px] px-2 py-[3px]"
              style={{ background: tone.bg, color: tone.fg }}
            >
              {tripTypeLabel(trip.typeCode)}
            </span>
          </div>
          <div className="text-[12.5px] font-medium text-[#667085] mt-[1px] tabular-nums">
            Cutoff {trip.cutoff ?? "—"} · {trip.stops} {trip.stops === 1 ? "stop" : "stops"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-[12px] bg-gray-50 px-3 py-2.5 mt-2">
        <div className="min-w-0">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400">Vehicle</div>
          <div className="text-[13px] font-semibold text-[#1d2939] truncate">{trip.vehiclePlate ?? "—"}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400">Driver</div>
          <div className="text-[13px] font-semibold text-[#1d2939] truncate">{driver || "—"}</div>
        </div>
        <div className="min-w-0 col-span-2">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400">Routes</div>
          <div className="text-[13px] font-semibold text-[#1d2939]">{trip.routes.length > 0 ? trip.routes.join(", ") : "—"}</div>
        </div>
      </div>

      {/* Status bar — the same five server counts as the list's ring, as a bar. */}
      <div className="flex gap-[2px] h-[6px] mt-3 mb-2 rounded-full overflow-hidden bg-[#eef1f4]">
        {total > 0 &&
          segs
            .filter((s) => s.n > 0)
            .map((s) => <span key={s.key} style={{ flex: s.n, background: TRIP_SEGMENT[s.key] }} />)}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#667085]">
        {legend
          .filter((l) => l.key !== "tinting" || l.n > 0)
          .map((l) => (
            <span key={l.key} className="flex items-center gap-[5px]">
              <i className="inline-block w-2 h-2 rounded-[2px]" style={{ background: TRIP_SEGMENT[l.key] }} />
              <b className="font-semibold text-[#1d2939] tabular-nums">{l.n}</b> {l.label}
            </span>
          ))}
        {c.held > 0 && (
          <span className="text-gray-400">
            <span className="tabular-nums">{c.held}</span> on hold
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A band heading inside the opened trip — the Assign tab's own "Due now"
 * heading type (11.5px bold caps, gray-700) with the band's segment dot in
 * front, so a band and its slice of the status bar read as one thing.
 */
export function TripBandHeading({
  tone,
  label,
  count,
  first = false,
  action = null,
}: {
  tone: keyof typeof TRIP_SEGMENT;
  label: string;
  count: number;
  first?: boolean;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={
        "flex items-center justify-between gap-2 text-[11.5px] font-bold uppercase tracking-wider text-gray-700 mb-2 px-[2px] " +
        (first ? "" : "mt-[18px]")
      }
    >
      <span className="flex items-center gap-[7px]">
        <i className="inline-block w-2 h-2 rounded-[2px]" style={{ background: TRIP_SEGMENT[tone] }} aria-hidden="true" />
        {label}
        <span className="tabular-nums">{count}</span>
      </span>
      {action}
    </div>
  );
}
