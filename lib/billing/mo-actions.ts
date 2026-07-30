// Billing v2 — client helper for the four mail-order actions.
// One POST per action, straight to /api/billing/mail-order/actions.

export type BillingActionResult =
  | { ok: true }
  | { ok: false; error: string; alreadyPunched: boolean };

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
 * `alreadyPunched` is surfaced separately: the server refuses post-punch edits
 * (409 ALREADY_PUNCHED) because enrichment cannot carry them, and the UI says
 * so rather than showing a generic failure. The buttons are already disabled in
 * that state — this is the belt to that braces, for a race where the order is
 * punched in another tab between render and click.
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
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    return {
      ok: false,
      error: body.error ?? `Failed (HTTP ${res.status}).`,
      alreadyPunched: body.code === "ALREADY_PUNCHED",
    };
  } catch {
    return { ok: false, error: "Could not reach the server.", alreadyPunched: false };
  }
}
