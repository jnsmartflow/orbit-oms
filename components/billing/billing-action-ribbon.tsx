"use client";

// Billing v2 — the compact Slot / Hold / Urgent buttons on the order line
// (mockup billing-final-mockup.html `.ribbon .acts`).
//
// ⚠ RENDERS ONLY WHEN billingV2 IS ON. The caller guards with
// `{billingV2 && <BillingActionRibbon …/>}`, so with the flag off this
// component is never constructed and emits ZERO nodes. It adds no wrapper
// around anything that already exists — it is appended as a sibling inside the
// ribbon's existing actions slot.
//
// ALWAYS ACTIVE — punched or not (2026-07-31). The earlier "disabled once
// punched" state is gone: the server now DUAL-WRITES (mo_orders for the intent,
// orders WHERE soNumber for an OBD that already exists), so an edit after punch
// reaches the live bill instead of being silently dropped. Nothing here should
// consult punch state again.
//
// Each button = one action → one write per table. No local optimism: we post,
// then ask the page to reload, so what is on screen is what is in the database.

import { useState } from "react";
import { DispatchSlotPicker, type DispatchWindow, type DispatchSlotValue } from "@/components/floor/dispatch-slot-picker";
import { postMailOrderAction } from "@/lib/billing/mo-actions";
import { useBillingActionsAccess } from "@/components/billing/billing-actions-access-provider";
import type { MoOrder } from "@/lib/mail-orders/types";

// EXPORTED so the Billing ribbon's other icon+label buttons (Notes, ⓘ) match
// Urgent/Hold/Slot exactly, rather than approximating them with a second set of
// class strings that drifts. One source for the button shape.
export const BTN_BASE =
  "inline-flex h-[27px] items-center gap-1.5 rounded-md border px-2 text-[10.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40";
export const BTN_OFF = "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50";
const BTN_HOLD_ON = "border-red-200 bg-red-50 text-red-700 hover:bg-red-100";
const BTN_URGENT_ON = "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100";
const BTN_SLOT_ON = "border-gray-300 bg-gray-100 text-gray-800 hover:bg-gray-200";

function toDateString(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

export function BillingActionRibbon({
  order,
  windows,
  onSaved,
}: {
  order: MoOrder;
  windows: DispatchWindow[];
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [slotGen, setSlotGen] = useState(0);

  // Per-button ticks (2026-09-11). Three independent grants — a person may hold
  // Slot and not Hold. The server re-checks each one before it writes; this only
  // decides what is offered.
  const access = useBillingActionsAccess();

  const holdOn = (order.dispatchStatus ?? "").toLowerCase() === "hold";
  const urgentOn = (order.dispatchPriority ?? "") === "Urgent";
  const slotDate = toDateString(order.dispatchTargetDate);
  const slotWindow = windows.find((w) => w.id === order.dispatchWindowId) ?? null;
  const slotOn = !!slotDate && !!slotWindow;

  const slotValue: DispatchSlotValue | null =
    slotOn && slotDate && slotWindow
      ? { date: slotDate, dispatchWindowId: slotWindow.id, windowTime: slotWindow.windowTime }
      : null;

  // Busy is the ONLY reason a button is inert — it stops a double-post while a
  // write is in flight. Punch state is deliberately not consulted.
  const disabled = busy;

  async function run(payload: Parameters<typeof postMailOrderAction>[1]) {
    if (disabled) return;
    setBusy(true);
    setErr(null);
    const res = await postMailOrderAction(order.id, payload);
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    onSaved();
  }

  // 🔴 RENDER NOTHING AT ALL when this person holds none of the three. Returning
  // an empty <span> would still be a flex ITEM in the ribbon row, and that row's
  // `gap-2` would then leave an 8px hole between the spacer and the Notes button
  // — a gap with nothing in it reads as a missing control. `null` contributes no
  // item, so the row closes up and renders correctly with just Notes / Copy /
  // Order No + Punch. The row's one divider still sits between those and the
  // punch group, which is exactly what it is for.
  //
  // ⚠ `err` lives inside this span, and that is fine: with no button there is no
  // way to start an action that could fail.
  if (!access.urgent && !access.hold && !access.slot) return null;

  return (
    <span className="mo-print-hide inline-flex items-center gap-1.5">
      {/* Hidden, never disabled (CLAUDE_UI §10): hidden says "not yours",
          disabled says "not yet". `false &&` contributes no DOM, so a person
          without the tick gets a row that closes up rather than one with a hole
          where a control used to be. */}
      {access.urgent && (
      <button
        type="button"
        disabled={disabled}
        onClick={() => void run({ action: "urgent", on: !urgentOn })}
        title={urgentOn ? "Clear urgent" : "Mark urgent"}
        className={`${BTN_BASE} ${urgentOn ? BTN_URGENT_ON : BTN_OFF}`}
      >
        <span className={urgentOn ? "" : "text-gray-400"}>⚡</span> Urgent
      </button>
      )}

      {access.hold && (
      <button
        type="button"
        disabled={disabled}
        onClick={() => void run({ action: "hold", on: !holdOn })}
        title={holdOn ? "Release hold" : "Put on hold"}
        className={`${BTN_BASE} ${holdOn ? BTN_HOLD_ON : BTN_OFF}`}
      >
        <span className={holdOn ? "" : "text-gray-400"}>⚑</span> Hold
      </button>
      )}

      {/* Slot — the reused Floor picker. Its own trigger is overlaid invisibly
          on our spec-styled button purely to anchor the (body-portalled)
          popover; the shared component is NOT modified. Same technique as
          components/floor/assign-bar.tsx.

          ⚠ The WHOLE wrapper is gated, not just the visible button — the
          overlaid DispatchSlotPicker inside it is a real, clickable trigger, so
          hiding only the button would leave an invisible control that still
          opens the popover and posts a slot change. */}
      {access.slot && (
      <span className="relative inline-flex h-[27px]">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setSlotGen((g) => g + 1)}
          title="Set dispatch slot"
          className={`${BTN_BASE} ${slotOn ? BTN_SLOT_ON : BTN_OFF}`}
        >
          <span className="text-gray-400">🕑</span>
          {slotOn && slotWindow ? `${slotDate?.slice(8, 10)}-${slotDate?.slice(5, 7)} · ${slotWindow.windowTime}` : "Slot"}
        </button>
        {!disabled && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-0 [&>div]:!block [&>div]:h-full [&>div]:w-full [&>div>button]:!h-full [&>div>button]:!w-full"
          >
            <DispatchSlotPicker
              value={slotValue}
              windows={windows}
              popoverDir="down"
              popoverAlign="left"
              forceOpenGen={slotGen || undefined}
              onChange={(v) =>
                void run(
                  v === null
                    ? { action: "slot", date: null, dispatchWindowId: null }
                    : { action: "slot", date: v.date, dispatchWindowId: v.dispatchWindowId },
                )
              }
            />
          </span>
        )}
      </span>
      )}

      {err && <span className="text-[10px] font-medium text-red-600">{err}</span>}
    </span>
  );
}
