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

/** Every note that identifies a hold event, for the `note: { in: … }` filter. */
export const HOLD_LOG_NOTES: string[] = [FLOOR_HOLD_NOTE, ...SUPPORT_HOLD_NOTES];

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
