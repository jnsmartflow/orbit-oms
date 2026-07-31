// Billing v2 — client helper for the four mail-order actions.
// One POST per action, straight to /api/billing/mail-order/actions.

export type BillingActionResult =
  | { ok: true; ordersUpdated: number }
  | { ok: false; error: string };

type Payload =
  | { action: "slot"; date: string | null; dispatchWindowId: number | null }
  | { action: "shipTo"; customerId: number | null }
  | { action: "hold"; on: boolean }
  | { action: "urgent"; on: boolean };

/**
 * Posts one action. Never throws — callers get a discriminated result and
 * render the message, because a failed action must not take the detail view
 * down with it.
 *
 * `ordersUpdated` is how many live OBD rows the server's second write touched:
 * 0 before the SAP import exists (the mo_orders intent covers that case), 1
 * normally, >1 for a split bill. It is information, not an error.
 */
export async function postMailOrderAction(
  moOrderId: number,
  payload: Payload,
): Promise<BillingActionResult> {
  try {
    const res = await fetch("/api/billing/mail-order/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moOrderId, ...payload }),
    });
    if (res.ok) {
      const ok = (await res.json().catch(() => ({}))) as { ordersUpdated?: number };
      return { ok: true, ordersUpdated: ok.ordersUpdated ?? 0 };
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? `Failed (HTTP ${res.status}).` };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}
