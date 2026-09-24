// Billing v2 — client helper for the mail-order actions.
// One POST per action, straight to /api/billing/mail-order/actions.

/** A bill on the SO the press did NOT change, and why (design §6). */
export interface BillingBillOutcome {
  orderId: number;
  obdNumber: string;
  /** skipped: "already set" · failed: billingRefusal's words, a live-CI refusal, or an error. */
  reason: string;
}

/** The mail order as the route saved it — the bar lights its buttons from this
 *  until the page reload lands. Dates arrive as ISO strings. */
export interface BillingMoOrderState {
  id: number;
  dispatchStatus: string | null;
  dispatchPriority: string | null;
  dispatchTargetDate: string | null;
  dispatchWindowId: number | null;
  handAt: string | null;
  billOnlyAt: string | null;
}

export type BillingActionResult =
  | {
      ok: true;
      /** The saved mail order; null only if an older server omitted it. */
      moOrder: BillingMoOrderState | null;
      /** Live bills this press changed (length of `updated`). Kept for existing callers. */
      ordersUpdated: number;
      /** Their order ids. */
      updated: number[];
      /** Bills already in the asked state — nothing written. */
      skipped: BillingBillOutcome[];
      /** Bills REFUSED (dispatched / cancelled / on a trip / tint room / live CI).
       *  The mail order itself WAS saved — show these as a warning, not an error. */
      failed: BillingBillOutcome[];
    }
  | { ok: false; error: string };

type Payload =
  | { action: "slot"; date: string | null; dispatchWindowId: number | null }
  | { action: "shipTo"; customerId: number | null }
  | { action: "hold"; on: boolean }
  | { action: "urgent"; on: boolean }
  | { action: "hand"; on: boolean }
  | { action: "ci"; on: boolean };

/**
 * Posts one action. Never throws — callers get a discriminated result and
 * render the message, because a failed action must not take the detail view
 * down with it.
 *
 * `ok: true` means the MAIL ORDER was saved. Some bills on the SO may still
 * have been refused — they are in `failed`, and the caller shows them beside the
 * new state (never as "nothing changed": the server answers 200 precisely
 * because the mail order DID change).
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
      const ok = (await res.json().catch(() => ({}))) as {
        moOrder?: BillingMoOrderState;
        ordersUpdated?: number;
        updated?: number[];
        skipped?: BillingBillOutcome[];
        failed?: BillingBillOutcome[];
      };
      return {
        ok: true,
        moOrder: ok.moOrder ?? null,
        ordersUpdated: ok.ordersUpdated ?? 0,
        updated: ok.updated ?? [],
        skipped: ok.skipped ?? [],
        failed: ok.failed ?? [],
      };
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? `Failed (HTTP ${res.status}).` };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}
