"use client";

// Floor Control — the trip DETAIL HEADER in the middle column, above its stops.
//
// 🔴 REDESIGNED 2026-09-15 TO THE OWNER'S LOCKED DESIGN. Six rows:
//
//   1  the trip number, big          [Send to billing] [Show to floor] [···]
//   2  the ROUTE, large, "+N" grey — route only, never the area
//   3  plate (mono) · vehicle type · transporter #their-no   driver · phone  ✎  🕒3
//      (the note, italic, on its own line when set)
//   4  the four-colour trip bar
//   5  the legend — only the segments that exist, "nothing pending" when so
//   6  a divider bar: stops · bills · litres · kg              [+ Add bills]
//
// What LEFT the header with the redesign: the Add bills and Set vehicle buttons
// (now + Add bills on row 6 and the pencil), the "HAND OFF" label, the "Desk
// control is off" caption (now the disabled button's tooltip), the delivery type
// (the L / U / I in the number says it), the Ready chip (the rail card carries
// the state), the slot (the pencil edits it — owner), and the three recent
// history lines (the clock replaces them).
//
// ⚠ BUTTONS ARE SEPARATE, never a joined strip (owner). Once pressed, Send to
// billing and Show to floor become grey LABELS WITH THE TIME at the same 32px
// height, so nothing reflows when a button becomes a label.
//
// ⚠ HISTORY IS THE CLOCK, NOT A ··· ITEM (owner). ··· holds only take-backs and
// Cancel trip — destructive actions people learn to avoid opening; history is a
// view, and it opens in place under the header.
//
// ⚠ A CANCELLED OR DISPATCHED TRIP, OR A PAST DAY, OFFERS NO WRITE BUTTONS and
// no + Add bills — every write path refuses closed trips server-side, and adding
// bills to a finished trip must not be one click away. The pencil and the clock
// DO stay (owner): the trip edit route accepts a dispatched trip, and cancelled
// trips never reach the rail.
//
// ⚠ NO Esc HANDLER FOR THE ··· MENU. floor-page.tsx is the single window-level Esc
// owner for the floor tree (FLOOR §4.6). The menu closes on a click outside —
// the same transparent-backdrop pattern detail-panel.tsx's ⋯ menu uses — and on
// choosing its item.

import { useState } from "react";
import { Clock, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { TripBar, TripBarLegend, tripBarCounts } from "./trip-bar";
import { TripHistoryList } from "./trip-history";
import { formatLitres, formatWeightKg } from "./status-pill";
import type { TripSummary } from "@/lib/trips/queries";
import type { TripActivityRow } from "@/lib/trips/activity";

/** Separate white buttons, 32px, 1px #c6c6d4, radius 7px, 13px medium (owner). */
const BUTTON =
  "inline-flex h-[32px] items-center rounded-[7px] border border-[#c6c6d4] bg-white px-3 text-[13px] font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-white";
/** The pressed state: a grey label with the time, the SAME height as the button. */
const PRESSED =
  "inline-flex h-[32px] items-center rounded-[7px] border border-gray-200 bg-gray-50 px-3 text-[13px] font-medium text-gray-500";
/** The small icon buttons on the metadata line. */
const ICON_BUTTON =
  "inline-flex h-[26px] items-center gap-1 rounded-[6px] border border-transparent px-1.5 text-gray-500 hover:border-gray-200 hover:bg-gray-50 hover:text-gray-800";

/** "10:42" in IST, or null. */
function istTime(iso: string | null): string | null {
  return iso
    ? new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })
    : null;
}

export function TripDetailHeader({
  trip,
  busy,
  readOnly,
  gateOn,
  activity,
  onAddBills,
  onChangeVehicle,
  onCancelTrip,
  onShowToFloor,
  onTakeBackFromFloor,
  onSendToBilling,
  onTakeBackFromBilling,
}: {
  trip: TripSummary;
  busy: boolean;
  /** History — a past day is a record, not a thing to add to. */
  readOnly: boolean;
  /** Desk control (the picking visibility gate). Show to floor is disabled while off. */
  gateOn: boolean;
  /**
   * The trip's history, oldest first — or NULL while the detail fetch for THIS
   * trip is still on its way, so the clock never shows the previous trip's count.
   */
  activity: TripActivityRow[] | null;
  /** + Add bills — switches the rail back to the pool, where bills are ticked. */
  onAddBills: () => void;
  /** The pencil — opens the vehicle / transporter / slot / note editor. */
  onChangeVehicle: () => void;
  onCancelTrip: () => void;
  /** POST …/show { shown: true } — slice 8. */
  onShowToFloor: () => void;
  /** POST …/show { shown: false } — ···. */
  onTakeBackFromFloor: () => void;
  /** POST …/billing { sent: true } — slice 9. */
  onSendToBilling: () => void;
  /** POST …/billing { sent: false } — ···, refused once billing has copied. */
  onTakeBackFromBilling: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const bar = tripBarCounts(trip.counts);
  const isEmpty = bar.total === 0;
  const isClosed = trip.status === "cancelled" || trip.status === "dispatched";
  const canWrite = !isClosed && !readOnly;
  const plate = trip.vehicleNo ?? trip.adhocVehicleNo;
  const shownTime = istTime(trip.shownAt);
  const sentTime = istTime(trip.sentToBillingAt);
  const copiedTime = istTime(trip.billingCopiedAt);
  // Whole kilos on a trip total ("412 kg", owner's design) — a decimal on a load
  // of hundreds of kilos is noise.
  const kg = formatWeightKg(Math.round(trip.totalWeightKg));

  const canTakeBackFloor = gateOn && trip.shownAt !== null;
  const canTakeBackBilling = trip.sentToBillingAt !== null && trip.billingCopiedAt === null;

  return (
    <div className="border-b border-gray-200">
      <div className="px-4 pb-3 pt-3.5">
        {/* ── Row 1 — the number, and the three buttons ─────────────────── */}
        <div className="flex items-start gap-3">
          <h2 className="m-0 font-mono text-[22px] font-bold leading-[32px] tracking-[-0.01em] text-gray-900">
            {trip.tripNumber}
          </h2>

          {canWrite && (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {/* SEND TO BILLING (slice 9). An empty trip has nothing for billing
                  to copy: disabled, with the reason as the wrapper's tooltip. */}
              {trip.billingCopiedAt ? (
                <span className={PRESSED}>Billing copied{copiedTime ? ` · ${copiedTime}` : ""}</span>
              ) : trip.sentToBillingAt ? (
                <span className={PRESSED}>Sent to billing{sentTime ? ` · ${sentTime}` : ""}</span>
              ) : (
                <span title={isEmpty ? "No bills yet" : undefined} className="inline-flex">
                  <button type="button" onClick={onSendToBilling} disabled={busy || isEmpty} className={BUTTON}>
                    Send to billing
                  </button>
                </span>
              )}

              {/* SHOW TO FLOOR (slice 8). While desk control is off it is simply
                  disabled, and "Desk control is off" is the tooltip — on a WRAPPER,
                  because a disabled button fires no mouse events and its own
                  title would never appear (owner). */}
              {gateOn && trip.shownAt ? (
                <span className={PRESSED}>Shown to floor{shownTime ? ` · ${shownTime}` : ""}</span>
              ) : (
                <span title={!gateOn ? "Desk control is off" : undefined} className="inline-flex">
                  <button type="button" onClick={onShowToFloor} disabled={busy || !gateOn} className={BUTTON}>
                    Show to floor
                  </button>
                </span>
              )}

              {/* ··· — the take-backs and Cancel trip, nothing else. 🔴 NO
                  CONFIRMATION PROMPT ON CANCEL, BY OWNER DECISION (2026-09-15):
                  the menu is the deliberate step and the activity log records it. */}
              <div className="relative">
                <button
                  type="button"
                  aria-label="More trip actions"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((v) => !v)}
                  disabled={busy}
                  className={`${BUTTON} w-[32px] justify-center !px-0`}
                >
                  <MoreHorizontal size={16} strokeWidth={2} />
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div
                      role="menu"
                      className="absolute right-0 z-20 mt-1 w-[230px] overflow-hidden rounded-[8px] border border-gray-200 bg-white shadow-lg"
                    >
                      {/* Take back from floor (slice 8) — only where it does
                          something. Non-destructive: only still-waiting bills leave
                          the supervisor's screen. */}
                      {canTakeBackFloor && (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={busy}
                          onClick={() => {
                            setMenuOpen(false);
                            onTakeBackFromFloor();
                          }}
                          className="block w-full px-3 py-2 text-left text-[12.5px] text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                        >
                          Take back from floor
                        </button>
                      )}
                      {/* Take back from billing (slice 9) — only until billing has
                          copied; the server refuses it after. */}
                      {canTakeBackBilling && (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={busy}
                          onClick={() => {
                            setMenuOpen(false);
                            onTakeBackFromBilling();
                          }}
                          className="block w-full px-3 py-2 text-left text-[12.5px] text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                        >
                          Take back from billing
                        </button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        disabled={busy}
                        onClick={() => {
                          setMenuOpen(false);
                          onCancelTrip();
                        }}
                        className="block w-full px-3 py-2 text-left text-[12.5px] text-[#b91c1c] hover:bg-[#fef2f2] disabled:opacity-40"
                      >
                        {/* 🔴 STILL ALLOWED ONCE BILLING HAS COPIED (owner, slice 9):
                            the label is the warning, no prompt. */}
                        {trip.billingCopiedAt ? "Cancel trip · billing already copied" : "Cancel trip"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Row 2 — the ROUTE (owner: route only, never the area) ──────── */}
        <div className="mt-0.5 text-[17px] font-semibold leading-snug text-gray-900">
          {trip.routeName ? (
            <>
              {trip.routeName}
              {trip.routeExtraCount > 0 && <span className="font-normal text-gray-400"> +{trip.routeExtraCount}</span>}
            </>
          ) : (
            <span className="font-normal text-gray-400">No route</span>
          )}
        </div>

        {/* ── Row 3 — one grey metadata line, then the pencil and the clock ──
            Plate (mono) · vehicle type · transporter #their-no, a wider gap,
            then the driver in FULL and the phone. The slot is NOT here — the
            pencil edits it (owner). A missing vehicle says "Vehicle not set" in
            amber; a vehicle with no driver (a typed plate) says "No driver yet". */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-gray-500">
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {plate ? (
              <span className="font-mono font-medium text-gray-800">{plate}</span>
            ) : (
              <span className="font-medium text-[#b45309]">Vehicle not set</span>
            )}
            {trip.vehicleCategory && <span>· {trip.vehicleCategory}</span>}
            {(trip.transporterName || trip.transporterTripNo) && (
              <span>
                · {trip.transporterName}
                {trip.transporterTripNo && (
                  <span className="tabular-nums text-gray-400">
                    {trip.transporterName ? " " : ""}#{trip.transporterTripNo}
                  </span>
                )}
              </span>
            )}
          </span>
          {plate && (
            <span className="inline-flex items-center gap-x-1.5">
              {trip.driverName ? (
                <>
                  <span className="text-gray-700">{trip.driverName}</span>
                  {trip.driverPhone && <span className="tabular-nums">· {trip.driverPhone}</span>}
                </>
              ) : (
                <span className="font-medium text-[#b45309]">No driver yet</span>
              )}
            </span>
          )}
          <span className="inline-flex items-center gap-0.5">
            <button
              type="button"
              onClick={onChangeVehicle}
              disabled={busy}
              title="Edit vehicle, transporter, slot and note"
              aria-label="Edit vehicle, transporter, slot and note"
              className={ICON_BUTTON}
            >
              <Pencil size={14} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              title="Trip history"
              aria-label="Trip history"
              aria-expanded={historyOpen}
              className={`${ICON_BUTTON} ${historyOpen ? "!border-gray-200 !bg-gray-100 !text-gray-900" : ""}`}
            >
              <Clock size={14} strokeWidth={2} />
              {activity !== null && <span className="text-[11.5px] font-semibold tabular-nums">{activity.length}</span>}
            </button>
          </span>
        </div>

        {/* The note — someone typed it on purpose (owner). Only when set. */}
        {trip.note && <div className="mt-1 text-[12px] italic text-gray-500">{trip.note}</div>}

        {/* ── Rows 4 and 5 — the bar and its legend ─────────────────────── */}
        {!isEmpty && (
          <>
            <TripBar counts={bar} className="mt-3 !h-2" />
            <TripBarLegend counts={bar} className="mt-2" />
          </>
        )}

        {/* The full history, in place, when the clock is on. */}
        {historyOpen && (
          <div className="mt-3 border-t border-[#f0f0f0] pt-3">
            {activity === null ? (
              <div className="text-[11.5px] text-gray-400">Loading history…</div>
            ) : (
              <TripHistoryList rows={activity} />
            )}
          </div>
        )}
      </div>

      {/* ── Row 6 — the stops bar ─────────────────────────────────────────── */}
      <div className="flex min-h-[40px] items-center gap-3 border-t border-gray-200 bg-[#fbfaff] px-4 py-1.5">
        <span className="text-[12.5px] tabular-nums text-gray-600">
          {isEmpty
            ? "No bills yet"
            : [
                `${trip.dropCount} stop${trip.dropCount === 1 ? "" : "s"}`,
                `${bar.total} bill${bar.total === 1 ? "" : "s"}`,
                `${formatLitres(trip.totalLitres)} L`,
                ...(kg ? [`${kg}${trip.weightUnknownCount > 0 ? "+" : ""} kg`] : []),
              ].join(" · ")}
        </span>
        {canWrite && (
          <button type="button" onClick={onAddBills} disabled={busy} className={`${BUTTON} ml-auto gap-1.5 !h-[28px] !text-[12.5px]`}>
            <Plus size={14} strokeWidth={2.2} />
            Add bills
          </button>
        )}
      </div>
    </div>
  );
}
