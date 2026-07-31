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
import type { MoOrder } from "@/lib/mail-orders/types";

const BTN_BASE =
  "inline-flex h-[27px] items-center gap-1.5 rounded-md border px-2 text-[10.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const BTN_OFF = "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50";
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

  return (
    <span className="mo-print-hide inline-flex items-center gap-1.5">
      {/* Slot — the reused Floor picker. Its own trigger is overlaid invisibly
          on our spec-styled button purely to anchor the (body-portalled)
          popover; the shared component is NOT modified. Same technique as
          components/floor/assign-bar.tsx. */}
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

      <button
        type="button"
        disabled={disabled}
        onClick={() => void run({ action: "hold", on: !holdOn })}
        title={holdOn ? "Release hold" : "Put on hold"}
        className={`${BTN_BASE} ${holdOn ? BTN_HOLD_ON : BTN_OFF}`}
      >
        <span className={holdOn ? "" : "text-gray-400"}>⚑</span> Hold
      </button>

      <button
        type="button"
        disabled={disabled}
        onClick={() => void run({ action: "urgent", on: !urgentOn })}
        title={urgentOn ? "Clear urgent" : "Mark urgent"}
        className={`${BTN_BASE} ${urgentOn ? BTN_URGENT_ON : BTN_OFF}`}
      >
        <span className={urgentOn ? "" : "text-gray-400"}>⚡</span> Urgent
      </button>

      {err && <span className="text-[10px] font-medium text-red-600">{err}</span>}
    </span>
  );
}
