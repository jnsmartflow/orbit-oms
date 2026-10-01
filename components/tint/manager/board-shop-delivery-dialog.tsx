"use client";

// Tint Manager — Shop delivery confirm (owner, 2026-10-01). The bar's
// ··· More → "Shop delivery" opens this; one press of the brand button posts
// POST /api/tint/manager/shop-delivery { orderIds } — every selected bill's
// ship-to becomes its own bill-to dealer. ONE-STEP confirm: the change is
// reversible from the detail panel (Change ship-to / Clear redirect), so it is
// not a destructive two-step (CLAUDE_UI §13 reserves that for cancels/removes).
//
// The toast names what happened: "N sent to dealer's shop · M skipped", with
// every skip and failure listed by OBD and reason (FLOOR §6(b) — never swallowed).
//
// ⚠ NO KEY LISTENER. tint-manager-content.tsx is the single Esc owner; it closes
// this through `onClose` (refused while busy, via onBusyChange).
// ⚠ A MODAL OVER THE WHOLE PAGE, the board-stop-cancel-dialog.tsx pattern
// (fixed, bg-black/40, z-[120]) — the scrim covers the bottom bar, so its brand
// button is never a second one on screen.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BAR_PRIMARY, BAR_SECONDARY } from "@/components/floor/floor-action-bar";

export interface ShopDeliveryBill {
  orderId:   number;
  obdNumber: string;
}

export function BoardShopDeliveryDialog({
  bills,
  onDone,
  onBusyChange,
  onClose,
}: {
  bills:        ShopDeliveryBill[];
  /** Something was written — the page clears the selection and reloads. */
  onDone:       () => void;
  onBusyChange: (busy: boolean) => void;
  onClose:      () => void;
}) {
  const [busy, setBusyState] = useState(false);
  const [error, setError]    = useState<string | null>(null);

  const setBusy = (b: boolean) => { setBusyState(b); onBusyChange(b); };
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const n = bills.length;
  const obdOf = (id: number) => bills.find((b) => b.orderId === id)?.obdNumber ?? `#${id}`;

  async function send() {
    if (busy || n === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tint/manager/shop-delivery", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderIds: bills.map((b) => b.orderId) }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        done?: number[];
        failed?: Array<{ orderId: number; error: string }>;
        skipped?: Array<{ orderId: number; reason: string }>;
      };
      if (!Array.isArray(body.done)) {
        setError(body.error ?? `Could not save — HTTP ${res.status}`);
        return;
      }
      const failed  = body.failed ?? [];
      const skipped = body.skipped ?? [];
      const lines = [
        ...failed.map((f) => `${obdOf(f.orderId)}: ${f.error}`),
        ...skipped.map((s) => `${obdOf(s.orderId)}: ${s.reason}`),
      ];
      const head = `${body.done.length} sent to dealer's shop` +
        (skipped.length > 0 ? ` · ${skipped.length} skipped` : "") +
        (failed.length > 0 ? ` · ${failed.length} failed` : "");
      const opts = lines.length > 0 ? { description: lines.join("\n"), duration: 10000 } : undefined;
      if (body.done.length === 0 && failed.length > 0) toast.error(head, opts);
      else if (failed.length > 0) toast.warning(head, opts);
      else if (body.done.length > 0) toast.success(head, opts);
      else toast.info(head, opts);
      if (body.done.length > 0) onDone();
      onClose();
    } catch {
      setError("Could not reach the server — nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={busy ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[420px] rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5">
          <h3 className="text-[18px] font-bold text-ink-900">Shop delivery</h3>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-700">
            Send {n} {n === 1 ? "bill" : "bills"} to {n === 1 ? "its" : "their"} dealer&apos;s shop?
          </p>
          <p className="mt-1 text-[12.5px] text-ink-500">
            Each bill&apos;s ship-to becomes its bill-to dealer. A bill already on a trip is refused.
          </p>
          {error && (
            <p className="mt-3 rounded-[9px] border border-danger-bd bg-danger-bg px-3 py-2 text-[12.5px] text-danger-text">{error}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2.5 border-t border-ink-100 px-6 py-4">
          <button type="button" onClick={onClose} disabled={busy} className={BAR_SECONDARY}>
            Back
          </button>
          <button type="button" onClick={() => { void send(); }} disabled={busy || n === 0} className={BAR_PRIMARY}>
            {busy ? "Sending…" : "Send to dealer's shop"}
          </button>
        </div>
      </div>
    </div>
  );
}
