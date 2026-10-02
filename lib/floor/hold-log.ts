// Floor Control — hold read-side helpers (design §8 + the carried `heldAt`
// decision). Pure: no DB, no React, no Date.now() — the clock is always passed in.
//
// WHY THIS FILE EXISTS
// `orders.heldAt` stores the bill's ARRIVAL date (`obdEmailDate`), NOT the moment
// it was held. That write is deliberate and stays: Support anchors its amber hold
// footprint to the arrival day (CLAUDE_SUPPORT §4.9 / §5), and flipping it to
// wall-clock would move that footprint on a module Floor Control must not touch.
// Floor's Hold tab needs the opposite fact — how long the bill has been ON HOLD —
// so "held since" is derived on the READ side, from the hold event's wall-clock
// `order_status_logs.createdAt` (getFloorHold, lib/floor/queries.ts).
//
// The hold event is identified by its NOTE, never by a sentinel `toStage`. A fake
// value in `toStage` pollutes the stage ladder (lib/workflow-stages.ts) and every
// future query that reads stages would then have to know about a value that is not
// a stage. Every hold path deliberately leaves `toStage` equal to the order's
// UNCHANGED `workflowStage` (hold does not advance a bill), so the note is the
// only honest discriminator available.

// ── The notes ───────────────────────────────────────────────────────────────

/** Floor's own hold note. Written by `app/api/floor/actions/route.ts` (action
 *  "hold") and read by `getFloorHold()` — ONE constant, both sides, so writer and
 *  reader can never drift apart. */
export const FLOOR_HOLD_NOTE = "Held from floor";

/** Floor's clear-hold note (slice 3b, 2026-09-14). Written by
 *  `app/api/floor/actions/route.ts` (action "unhold" — the bottom bar's
 *  8 s Undo after a bulk Hold, 2026-09-22).
 *
 *  ⚠ NOT IN HOLD_LOG_NOTES, AND MUST NEVER BE. That list identifies HOLD events
 *  for the "held since" read; a clear event inside it would make a re-held bill's
 *  age start from the moment its previous hold was lifted. */
export const FLOOR_CLEAR_HOLD_NOTE = "Hold cleared on floor";

/** Support's hold notes — MIRRORED literals. Floor does not write these and does
 *  not own them; they are declared here so the reader matches a named constant
 *  rather than a loose inline string. Verified 2026-07-24 against live code:
 *
 *    app/api/support/orders/[id]/hold/route.ts:44 + :75  "Placed on hold by support"
 *    app/api/support/bulk/route.ts:114 + :143            "Placed on hold by support (bulk)"
 *
 *  Both Support routes accept an optional caller `note` that would override the
 *  default; the only live caller (components/support/support-page-content.tsx:278)
 *  posts a bare `{}`, so these defaults are what actually land in the log. A bill
 *  held from Support therefore groups correctly on the Floor's Hold tab.
 *
 *  ⚠ If Support ever starts sending a custom note, or renames these strings, holds
 *  taken from Support silently fall back to the approximate source below — they do
 *  not disappear. Re-verify these two literals when touching Support's hold path. */
export const SUPPORT_HOLD_NOTES = [
  "Placed on hold by support",
  "Placed on hold by support (bulk)",
] as const;

/** The import's hold note (2026-09-22). Written by lib/billing/telephonic-apply.ts
 *  when a bill's SO carries a live Billing · Telephonic tag (`so_tags`, hold or
 *  ci) — the import holds it before the no-mail-order fallback can release it.
 *  Its own string, never FLOOR_HOLD_NOTE: nobody on the floor held this bill,
 *  and the Hold tab's "held since" must still find it. */
export const TELEPHONIC_HOLD_NOTE = "Held on import (Telephonic tag)";

/** The import's SAFETY-NET hold note (2026-09-24). Written by
 *  applyMailOrderEnrichment (app/api/import/obd/route.ts) when any mail order on
 *  the bill's SO is marked CI by billing (mo_orders.billOnlyAt): the bill is held
 *  instead of carrying the mail order's status, so a missing tag or a failed hook
 *  can never let the no-mail-order fallback release it to picking with no CI.
 *  The hook's cancel (lib/billing/telephonic-apply.ts) clears the hold.
 *  Design: web-update-2026-09-24-billing-mo-actions.md §3.4. */
export const BILLING_CI_HOLD_NOTE = "Held on import (CI marked in billing)";

/** Billing's own hold note (2026-09-24) — the Orders-tab Hold button, once the
 *  billing actions route writes one log per bill (design §6). Declared here now
 *  so the Hold tab's "held since" already recognises it. */
export const BILLING_HOLD_NOTE = "Held from billing";

/** Billing's Release note (2026-09-24) — the Orders-tab Hold button turned off.
 *
 *  ⚠ NOT IN HOLD_LOG_NOTES, AND MUST NEVER BE — the same rule as
 *  FLOOR_CLEAR_HOLD_NOTE above: a clear event in that list would make a re-held
 *  bill's "held since" start from the moment its previous hold was lifted. */
export const BILLING_CLEAR_HOLD_NOTE = "Hold cleared from billing";

/** The Tint Manager's hold note (2026-10-01, tabs build step 2). Written by
 *  lib/floor/bill-actions.ts applyBillAction("hold") when the caller is the
 *  Tint Manager (app/api/tint/manager/actions). Its own string, never
 *  FLOOR_HOLD_NOTE: nobody on the floor held this bill — but Floor's Hold tab
 *  must still find it for "held since", so it is in HOLD_LOG_NOTES below. */
export const TINT_HOLD_NOTE = "Held from Tint Manager";

/** The Tint Manager's Release (unhold) note (2026-10-01).
 *
 *  ⚠ NOT IN HOLD_LOG_NOTES, AND MUST NEVER BE — the same rule as
 *  FLOOR_CLEAR_HOLD_NOTE above. */
export const TINT_CLEAR_HOLD_NOTE = "Hold cleared from Tint Manager";

/** The import's mail-order hold, PARSER-set (2026-10-01, F1): applyMailOrderEnrichment
 *  carried a 'Hold' mail order with no `mo_orders.heldById` onto the bill. changedById = 1 (system). */
export const MAIL_ORDER_AUTO_HOLD_NOTE = "Held on import (mail order)";

/** The import's mail-order hold, BILLING-set (2026-10-01, F1/F2): the mail order was held with
 *  ⚑ Hold before its OBD existed; changedById = that user (`mo_orders.heldById`). */
export const MAIL_ORDER_BILLING_HOLD_NOTE = "Held on import (billing hold on mail order)";

/** Every note that identifies a hold event, for the `note: { in: … }` filter. */
export const HOLD_LOG_NOTES: string[] = [
  FLOOR_HOLD_NOTE,
  ...SUPPORT_HOLD_NOTES,
  TELEPHONIC_HOLD_NOTE,
  BILLING_CI_HOLD_NOTE,
  BILLING_HOLD_NOTE,
  TINT_HOLD_NOTE,
  MAIL_ORDER_AUTO_HOLD_NOTE,
  MAIL_ORDER_BILLING_HOLD_NOTE,
];

// ── Held from / held by (2026-10-02) — the Hold table's two source columns ──

/** Who put a bill on hold, as the Hold table says it. Derived on the read side
 *  (getFloorHold) from the latest hold log's NOTE; two cases need a second read:
 *  the telephonic note is split by its so_tags.tag ('ci' → "Billing · CI"), and a
 *  bill with NO hold log reads "Auto (mail order)" when its SO's newest mail order
 *  is on Hold (the pre-2026-10-01 enrichment holds wrote no log), else "Unknown". */
export type HoldSourceLabel =
  | "Floor"
  | "Tint Manager"
  | "Billing"
  | "Billing · telephonic"
  | "Billing · CI"
  | "Billing · mail order"
  | "Auto (mail order)"
  | "Support"
  | "Unknown";

/** Every hold note → its label. Keyed by the constants, never a retyped string.
 *  hold-log.test.ts proves it covers HOLD_LOG_NOTES exactly. */
export const HOLD_SOURCE_BY_NOTE: Readonly<Record<string, HoldSourceLabel>> = {
  [FLOOR_HOLD_NOTE]: "Floor",
  [TINT_HOLD_NOTE]: "Tint Manager",
  [BILLING_HOLD_NOTE]: "Billing",
  [BILLING_CI_HOLD_NOTE]: "Billing · CI",
  // Split by the tag in getFloorHold: 'hold' keeps this label, 'ci' → "Billing · CI".
  [TELEPHONIC_HOLD_NOTE]: "Billing · telephonic",
  [MAIL_ORDER_BILLING_HOLD_NOTE]: "Billing · mail order",
  [MAIL_ORDER_AUTO_HOLD_NOTE]: "Auto (mail order)",
  [SUPPORT_HOLD_NOTES[0]]: "Support",
  [SUPPORT_HOLD_NOTES[1]]: "Support",
};

/** Import-path notes on which `changedById = 1` means the SYSTEM, not the owner's
 *  own account (user 1 is both — hold-sources discovery §Q2, owner 2026-10-01).
 *  On these, held-by reads "System"; on every other note user 1 is a person. */
export const SYSTEM_PERSON_NOTES: readonly string[] = [MAIL_ORDER_AUTO_HOLD_NOTE, BILLING_CI_HOLD_NOTE];

/** The user id the import paths write for "no person" (CORE convention). */
export const SYSTEM_USER_ID = 1;

/** The "Held by" text: null with no hold log; "System" for user 1 on an
 *  import-path note; otherwise the person's name (null if the user row is gone). */
export function heldByLabel(
  note: string | null,
  changedById: number | null,
  name: string | null,
): string | null {
  if (note === null || changedById === null) return null;
  if (changedById === SYSTEM_USER_ID && SYSTEM_PERSON_NOTES.includes(note)) return "System";
  return name;
}

/** Where a row's `heldSince` came from — surfaced in the UI so an approximated
 *  date can never silently read as a recorded one.
 *   - `log`     — a real hold event's wall-clock `createdAt`. Exact.
 *   - `approx`  — no hold log found; fell back to `heldAt` (the ARRIVAL date).
 *                 Rendered with a `~` marker and an explaining tooltip.
 *   - `unknown` — no log AND no `heldAt`. Rendered "—", banded separately. */
export type HeldSinceSource = "log" | "approx" | "unknown";

// ── Age bands (design §8, labels verbatim from 01-board.html) ───────────────

export type HoldBandKey = "today" | "week" | "month" | "older" | "unknown";

export interface HoldBand {
  key: HoldBandKey;
  label: string;
}

/** Order = recent-first. The Oldest-first toggle reverses the first FOUR only;
 *  "Held date unknown" always sits last in both directions — it is not a point on
 *  the age axis, so it cannot meaningfully lead an oldest-first list. */
export const HOLD_BANDS: HoldBand[] = [
  { key: "today", label: "Held today" },
  { key: "week", label: "This week" },
  { key: "month", label: "1 week to 1 month" },
  { key: "older", label: "Older than a month" },
  { key: "unknown", label: "Held date unknown" },
];

function istDayOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function utcMidnightOf(dayIso: string): number {
  const [y, m, d] = dayIso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole IST days between `heldSince` and now, floored at 0. Null when unknown. */
export function holdAgeDays(heldSince: string | null, now: Date): number | null {
  if (!heldSince) return null;
  const then = utcMidnightOf(istDayOf(heldSince));
  const today = utcMidnightOf(now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  return Math.max(0, Math.round((today - then) / 86_400_000));
}

/** Band boundaries match the mockup exactly: 0 today · 1-7 week · 8-30 month ·
 *  31+ older. */
export function bandOfDays(days: number | null): HoldBandKey {
  if (days === null) return "unknown";
  if (days === 0) return "today";
  if (days <= 7) return "week";
  if (days <= 30) return "month";
  return "older";
}

/** "today" / "yesterday" / "N days ago" — the mockup's `held` wording. */
export function heldSinceLabel(days: number | null): string {
  if (days === null) return "—";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export interface BandedHold<T> {
  band: HoldBand;
  rows: T[];
}

/** Split rows into bands, newest band first (or oldest first when `oldestFirst`),
 *  each band's rows sorted by age in the same direction. Empty bands are dropped.
 *  Generic so the tab and the PDF builder share one grouping — they can't disagree
 *  about what "This week" means. */
export function groupByHoldBand<T extends { heldSince: string | null }>(
  rows: T[],
  now: Date,
  oldestFirst = false,
): Array<BandedHold<T>> {
  const buckets = new Map<HoldBandKey, T[]>();
  for (const row of rows) {
    const key = bandOfDays(holdAgeDays(row.heldSince, now));
    const arr = buckets.get(key) ?? [];
    arr.push(row);
    buckets.set(key, arr);
  }

  const dated = HOLD_BANDS.filter((b) => b.key !== "unknown");
  const ordered = oldestFirst ? [...dated].reverse() : dated;
  const unknown = HOLD_BANDS.find((b) => b.key === "unknown")!;

  return [...ordered, unknown]
    .map((band) => {
      const rowsInBand = (buckets.get(band.key) ?? []).slice().sort((a, b) => {
        const da = holdAgeDays(a.heldSince, now) ?? Number.MAX_SAFE_INTEGER;
        const db = holdAgeDays(b.heldSince, now) ?? Number.MAX_SAFE_INTEGER;
        return oldestFirst ? db - da : da - db;
      });
      return { band, rows: rowsInBand };
    })
    .filter((g) => g.rows.length > 0);
}

/** Per-band counts for the PDF header strip and the tab. Always all five keys, so
 *  a zero band still prints as 0 rather than vanishing from the summary. */
export function countByBand<T extends { heldSince: string | null }>(
  rows: T[],
  now: Date,
): Record<HoldBandKey, number> {
  const counts: Record<HoldBandKey, number> = { today: 0, week: 0, month: 0, older: 0, unknown: 0 };
  for (const row of rows) counts[bandOfDays(holdAgeDays(row.heldSince, now))]++;
  return counts;
}
