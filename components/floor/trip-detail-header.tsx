"use client";

// Floor Control — the trip DETAIL HEADER in the middle column, above its stops.
//
// 🔴 REDESIGNED 2026-09-15 TO THE OWNER'S LOCKED DESIGN. Six rows:
//
//   1  the trip number chip          [Send to billing] [Show to floor] [···]
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

/**
 * Separate white buttons, 32px, 1px #c6c6d4, radius 7px, 13px medium, 14px of
 * side padding — every value from the design spec, including the states: the
 * border DARKENS on hover (not just a fill), a pressed fill, a purple
 * focus-visible outline, and a disabled button whose BORDER goes pale too, so it
 * stops looking pressable.
 */
const BUTTON =
  "inline-flex h-[32px] items-center rounded-[7px] border border-[#c6c6d4] bg-white px-[14px] text-[13px] font-medium text-[#1a1a22] transition-colors hover:border-[#a5a5ba] hover:bg-[#f5f5fa] active:bg-[#ececf4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6d3beb] disabled:cursor-not-allowed disabled:border-[#e2e2ea] disabled:bg-white disabled:text-[#adadb9] disabled:hover:border-[#e2e2ea] disabled:hover:bg-white";
/**
 * SHOW TO FLOOR WHILE DESK CONTROL IS ON AND THE TRIP IS NOT YET SHOWN (owner,
 * design spec `.tb.amber`): the one thing on the panel waiting to be done, in
 * the same amber as the SHOWN badge — on this screen amber means someone has to
 * act. Disabled and already-shown keep their own looks.
 */
const BUTTON_AMBER =
  "border-[#ddb156] bg-[#fff9ec] font-semibold text-[#8a5d0c] hover:border-[#c2952f] hover:bg-[#fdf2d9]";
/** The pressed state: a grey label with the time, the SAME height as the button. */
const PRESSED =
  "inline-flex h-[32px] items-center rounded-[7px] border border-[#e7e7ee] bg-[#fafafc] px-[14px] text-[13px] font-medium text-[#61616d]";
/** The pencil and the clock: 26px, quiet until hovered (spec `.pencil`). */
const ICON_BUTTON =
  "inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-[6px] border border-transparent px-[6px] text-[#96969f] transition-colors hover:border-[#dcdce6] hover:bg-[#f1f1f7] hover:text-[#1a1a22] active:bg-[#ececf4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#6d3beb] disabled:cursor-not-allowed disabled:opacity-50";
/** The "·" between metadata facts — lighter than the text it separates (spec). */
const DOT = "text-[#ccccd6]";

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
    <div>
      {/* Panel padding 16px 18px (spec). The 22px bottom belongs AFTER the
          stops, so trip-desk.tsx carries it — the stops are part of this panel. */}
      <div className="px-[18px] pt-4">
        {/* ── Row 1 — the number, and the three buttons ─────────────────── */}
        {/* min-h: the row keeps the buttons' 32px even on a trip that shows none, so
            the route never sits higher on a past day or a dispatched trip. */}
        <div className="flex min-h-[32px] flex-wrap items-center gap-[9px]">
          {/* A SMALL MONO CHIP, the rail card's family one step larger (owner):
              it leads the row; the route below is the headline. */}
          <span className="shrink-0 rounded-[6px] border border-[#e7e7ee] bg-[#f1f1f6] px-[9px] py-[3px] font-mono text-[14px] font-semibold text-[#1a1a22]">
            {trip.tripNumber}
          </span>

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
                  <button
                    type="button"
                    onClick={onShowToFloor}
                    disabled={busy || !gateOn}
                    className={`${BUTTON} ${gateOn ? BUTTON_AMBER : ""}`}
                  >
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
        <div className="mt-[11px] text-[23px] font-bold leading-tight tracking-[-0.02em] text-[#1a1a22]">
          {trip.routeName ? (
            <>
              {trip.routeName}
              {trip.routeExtraCount > 0 && <span className="font-medium text-[#96969f]"> +{trip.routeExtraCount}</span>}
            </>
          ) : (
            <span className="font-medium text-[#96969f]">No route</span>
          )}
        </div>

        {/* ── Row 3 — one grey metadata line, then the pencil and the clock ──
            Plate (mono) · vehicle type · transporter #their-no, a wider gap,
            then the driver in FULL and the phone. The slot is NOT here — the
            pencil edits it (owner). A missing vehicle says "Vehicle not set" in
            amber; a vehicle with no driver (a typed plate) says "No driver yet". */}
        <div className="mt-[6px] flex flex-wrap items-center gap-x-[7px] gap-y-[3px] text-[13px] text-[#61616d]">
          {plate ? (
            <span className="font-mono font-semibold text-[#1a1a22]">{plate}</span>
          ) : (
            <span className="font-medium text-[#8a5d0c]">Vehicle not set</span>
          )}
          {trip.vehicleCategory && (
            <>
              <span className={DOT}>·</span>
              <span className="text-[#96969f]">{trip.vehicleCategory}</span>
            </>
          )}
          {(trip.transporterName || trip.transporterTripNo) && (
            <>
              <span className={DOT}>·</span>
              <span>
                {trip.transporterName}
                {trip.transporterTripNo && (
                  <span className="tabular-nums text-[#96969f]">
                    {trip.transporterName ? " " : ""}#{trip.transporterTripNo}
                  </span>
                )}
              </span>
            </>
          )}
          {plate &&
            (trip.driverName ? (
              <>
                {/* The driver sits a clear 16px off the truck facts (spec) — the
                    plate is the only dark thing on this line. */}
                <span className="ml-4">{trip.driverName}</span>
                {trip.driverPhone && (
                  <>
                    <span className={DOT}>·</span>
                    {/* A tappable number, not ten digits to copy out (spec note). */}
                    <a
                      href={`tel:${trip.driverPhone.replace(/[^+\d]/g, "")}`}
                      className="tabular-nums text-[#96969f] hover:text-[#61616d] hover:underline"
                    >
                      {trip.driverPhone}
                    </a>
                  </>
                )}
              </>
            ) : (
              <span className="ml-4 font-medium text-[#8a5d0c]">No driver yet</span>
            ))}
          <span className="inline-flex items-center">
            <button
              type="button"
              onClick={onChangeVehicle}
              disabled={busy}
              title="Edit vehicle, transporter, slot and note"
              aria-label="Edit vehicle, transporter, slot and note"
              className={ICON_BUTTON}
            >
              <Pencil size={14} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              title="Trip history"
              aria-label={activity === null ? "Trip history" : `Full history, ${activity.length} entries`}
              aria-expanded={historyOpen}
              className={`${ICON_BUTTON} ${historyOpen ? "!border-[#dcdce6] !bg-[#f1f1f7] !text-[#1a1a22]" : ""}`}
            >
              <Clock size={14} strokeWidth={1.5} />
              {activity !== null && (
                <span className="ml-[3px] text-[10.5px] font-semibold tabular-nums">{activity.length}</span>
              )}
            </button>
          </span>
        </div>

        {/* The note — someone typed it on purpose (owner). Only when set. */}
        {trip.note && <div className="mt-[6px] text-[12.5px] italic text-[#61616d]">{trip.note}</div>}

        {/* ── Rows 4 and 5 — the bar and its legend, 7px apart ──────────── */}
        {!isEmpty && (
          <div className="mt-[14px] flex flex-col gap-[7px]">
            <TripBar counts={bar} />
            <TripBarLegend counts={bar} />
          </div>
        )}

        {/* The full history, in place, when the clock is on. */}
        {historyOpen && (
          <div className="mt-[14px] border-t border-[#f0f0f0] pt-3">
            {activity === null ? (
              <div className="text-[11.5px] text-[#96969f]">Loading history…</div>
            ) : (
              <TripHistoryList rows={activity} />
            )}
          </div>
        )}

        {/* ── Row 6 — the stops bar: 20px below the legend, 8px padding under
            its line, a 1px bottom border (exact values, owner's design file) ── */}
        <div className="mt-[20px] flex items-center gap-2.5 border-b border-[#e7e7ee] pb-2">
          <span className="text-[13.5px] font-semibold tabular-nums text-[#1a1a22]">
            {isEmpty
              ? "No bills yet"
              : [
                  `${trip.dropCount} stop${trip.dropCount === 1 ? "" : "s"}`,
                  `${bar.total} bill${bar.total === 1 ? "" : "s"}`,
                  `${formatLitres(trip.totalLitres)} L`,
                  ...(kg ? [`${kg}${trip.weightUnknownCount > 0 ? "+" : ""} kg`] : []),
                ].map((part, i) => (
                  <span key={i}>
                    {i > 0 && <span className="px-px font-normal text-[#c9c9d4]"> · </span>}
                    {part}
                  </span>
                ))}
          </span>
          {canWrite && (
            <button type="button" onClick={onAddBills} disabled={busy} className={`${BUTTON} ml-auto gap-[5px] !pl-[10px] !pr-3 font-semibold`}>
              <Plus size={13} strokeWidth={2.2} />
              Add bills
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
