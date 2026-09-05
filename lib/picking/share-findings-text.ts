// ── WhatsApp share — picking findings, PLAIN TEXT ──────────────────────────
// Spec: docs/mockups/picking/picking-whatsapp-share.html (approved 05 Sep 2026).
// One consumer today: the SUPERVISOR detail screen's header icon
// (components/picking/picking-board-mobile.tsx). The picker face is deliberately
// not a caller — §5 of the mockup: "supervisor board only".
//
// ⚠ DELIBERATELY NOT lib/trip-report/share-sheet-image.ts, and that file must
// not learn about text. It renders a React document into a hidden container,
// captures it with html-to-image, and gates on `navigator.canShare({files:[…]})`
// — a predicate that is FALSE on browsers which share text perfectly well. Its
// fallback is a PNG download, which is meaningless for a message. What is
// reusable there is the SHAPE of the flow (feature-detect → share → fall back →
// tell the caller which path was taken), and that shape is reproduced below in
// about forty lines with no react-dom and no html-to-image. One "share" module
// serving both is exactly how the file gate ends up wrongly guarding the text
// path.
//
// Pure + client-safe: no prisma, no react, no next/server. lib/picking/types.ts
// and lib/picking/findings-reasons.ts are both import-free constant/type
// modules, so this stays importable from a client component.
//
// Nothing here is stored. There is no table, no column and no API route behind
// any of it — the message is built in memory from what the detail screen has
// already fetched, and forgotten the moment the share sheet closes.

import { MFG_MONTH_LABELS, findingReasonLabel, mfgLabel } from "./findings-reasons";
import type { PickingDetailLine } from "./types";

/**
 * What the message needs off the bill. Structural subset of PickingQueueRow
 * rather than the row itself, so the builder is testable with three literals
 * and cannot quietly grow a dependency on a field it does not print.
 */
export interface FindingsMessageBill {
  obdNumber: string;
  dealerName: string;
  /** `PickingQueueRow.obdDateTime` — when SAP raised the order. */
  obdDateTime: Date | string | null;
  /**
   * ⚠ ALREADY FILTERED TO CONFIRMED. This module does NOT re-filter, and must
   * not start: the amber/red decision has exactly one owner —
   * `findingState()` in components/picking/finding-recorder.tsx — and a second
   * copy of that predicate here is how the two drift. The caller applies it
   * (CLAUDE_PICKING.md §11.5: a picker's unconfirmed report is a claim, not a
   * fact, and must never reach a billing screen — or, now, a WhatsApp chat).
   *
   * A line with a null `finding` is skipped rather than printed blank, purely
   * so a caller that filters wrongly produces a short message instead of a
   * "Found undefined" one.
   */
  lines: PickingDetailLine[];
}

// Full ISO date-time WITHOUT a trailing Z or ±HH:MM offset. Copied from
// lib/picking/picker-split.ts, which CLAUDE_CORE.md §3 names as the reference
// implementation for this rule — see normaliseInstant below for why it is here
// rather than imported (that module's copy is file-private).
const OFFSETLESS_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

// Fixed offset, exactly as lib/picking/picker-split.ts derives its IST day.
// India has one zone and no DST, which is what makes a constant honest here.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Epoch-safe Date for an `obdDateTime`, or null when it cannot be read.
 *
 * ⚠ HOST-INDEPENDENCE — CLAUDE_CORE.md §3's `Date.parse()` rule, and this
 * helper is exactly the case it warns about: **the same formatting now runs in
 * two places.** The board's own `formatObdDateTime()` renders this field
 * server-side and client-side alike; this one runs ONLY on a depot phone in
 * Asia/Kolkata. Per the ES spec an offset-less date-TIME string is parsed in
 * the HOST's zone, so a value that reads as one instant on Vercel (UTC) reads
 * 5.5 hours earlier on the phone — and only near midnight, so it passes every
 * daytime test.
 *
 * In practice every value that arrives here is safe already: Prisma hands back
 * a real Date, and NextResponse.json emits an ISO string carrying `Z`. The
 * normalisation is what stops the machine's timezone deciding if that ever
 * stops being true. UTC is what the column actually holds (timestamptz), so
 * for every input that occurs today this changes nothing.
 */
function normaliseInstant(value: Date | string | null): Date | null {
  if (value === null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const normalised = OFFSETLESS_DATETIME_RE.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const ms = Date.parse(normalised);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * "04 Sep 2026, 5:42 pm" in IST — the mockup's §2 format, exactly.
 *
 * ⚠ NO `Intl` AND NO `toLocale*` ANYWHERE IN HERE, deliberately. Every ICU
 * route to this string was tried and each carries a real defect:
 *   • `en-GB` short month renders September as **"Sept"**, not "Sep" — caught
 *     by the smoke test on the very date this shipped. That is not only off the
 *     approved spec, it disagrees with `MFG_MONTH_LABELS` ("Sep") in the SAME
 *     message, which prints the MFG tail three lines below.
 *   • `en-US` with `hour12` emits a NARROW NO-BREAK SPACE (U+202F) before
 *     AM/PM on modern ICU (Node 18+, Chrome 110+), not the ASCII space the
 *     mockup shows. Invisible in review, wrong in the string.
 *   • `en-GB`'s lower-case "pm" is an ICU detail, not a guarantee, and the
 *     depot phones and Vercel do not run the same ICU build.
 * So the instant is shifted by the fixed IST offset and read through the UTC
 * getters — the identical pattern `istDayRangeFor()` uses in
 * lib/picking/picker-split.ts, and never the local getters — and the month name
 * comes from **MFG_MONTH_LABELS**, this module's own closed vocabulary. The two
 * month abbreviations in the message are then the same twelve strings by
 * construction rather than by coincidence.
 *
 * The board's own `formatObdDateTime()` is deliberately NOT reused: it renders
 * the CARD caption ("19 Jul, 4:05 PM" — no year, upper-case meridiem) and is
 * file-private to picking-board-mobile.tsx. Two different formats for two
 * different surfaces; widening that one to serve both would change every
 * card's caption as a side effect.
 *
 * Returns null on a missing or unparseable timestamp — the caller OMITS the
 * whole *Order* line rather than printing a placeholder (mockup §3: the field
 * is "when SAP raised the order", and a line that cannot say when is not a
 * shorter truth, it is a wrong one).
 */
export function formatOrderStamp(value: Date | string | null): string | null {
  const instant = normaliseInstant(value);
  if (instant === null) return null;

  // Shift into IST, then read UTC parts. Never getHours()/getDate() — those
  // are the machine's zone, which is the entire failure this avoids.
  const ist = new Date(instant.getTime() + IST_OFFSET_MS);
  const day = String(ist.getUTCDate()).padStart(2, "0");
  const month = MFG_MONTH_LABELS[ist.getUTCMonth()];
  const year = ist.getUTCFullYear();

  const h24 = ist.getUTCHours();
  const meridiem = h24 < 12 ? "am" : "pm";
  // 0 → 12am, 12 → 12pm. The modulo alone would print "0:42 am".
  const hour = h24 % 12 === 0 ? 12 : h24 % 12;
  const minute = String(ist.getUTCMinutes()).padStart(2, "0");

  return `${day} ${month} ${year}, ${hour}:${minute} ${meridiem}`;
}

/**
 * THE message. Mockup §2, character for character.
 *
 *   *Material not found — Picking*
 *
 *   *Customer*  Shree Paint House
 *   *OBD No*  9108973203
 *   *Order*  04 Sep 2026, 5:42 pm
 *
 *   *Material*
 *   1. Weathershield Max White · 20L
 *       Order 10 · Found 6 · Short quantity
 *
 *   2. Gloss Brilliant White · 4L
 *       Order 12 · Found 12 · Old MFG · Mar 2024
 *
 * Format rules, all load-bearing:
 * - `*…*` is WHATSAPP BOLD, not markdown. No tables, no pipes, no backticks —
 *   WhatsApp renders none of them and a pipe table becomes unreadable ASCII on
 *   a phone.
 * - TWO SPACES after each bold label. That is what lines the three values up in
 *   the bubble; a single space reads as ragged.
 * - Blank line between numbered items; the continuation line is indented FOUR
 *   spaces. Both are in the approved bubble.
 * - Plain `\n`. NOTHING is pre-encoded here — `shareFindingsText` encodes for
 *   the wa.me path only, and double-encoding is how a message arrives full of
 *   `%0A`.
 * - Reason labels come from findings-reasons.ts. Never hardcode "Short
 *   quantity" / "Old MFG": that module is the closed vocabulary the live CHECK
 *   constraint mirrors, and a hand-typed label is a second list to drift.
 * - The MFG tail is CONDITIONAL on `mfgLabel()` returning non-null. It returns
 *   null for `old_mfg` rows recorded before 2026-08-08, which carry no
 *   month/year and which nothing can backfill — 3 of the 4 live old-MFG rows
 *   were dateless at the 2026-08-09 count (CLAUDE_PICKING.md §11.3). Those
 *   lines simply end after the reason: no trailing " · ", never "undefined
 *   NaN". The mockup calls this out in its own panel.
 * - `name ?? sku`: PickingDetailLine.name is nullable, and the route already
 *   falls back to the raw SAP description before that. The SAP code is the last
 *   resort and is still a true identifier of the tin.
 * - A blank pack STAYS BLANK (`pack` is null on ~27% unmastered codes) — the
 *   " · {pack}" segment is dropped rather than guessed. CLAUDE_PICKING.md §7: a
 *   blank is a mis-pick preventer, a wrong value is not.
 */
export function buildFindingsMessage(bill: FindingsMessageBill): string {
  const blocks: string[] = ["*Material not found — Picking*"];

  const stamp = formatOrderStamp(bill.obdDateTime);
  const header = [
    `*Customer*  ${bill.dealerName}`,
    `*OBD No*  ${bill.obdNumber}`,
    // Omitted entirely when there is no readable date — see formatOrderStamp.
    ...(stamp !== null ? [`*Order*  ${stamp}`] : []),
  ];
  blocks.push(header.join("\n"));

  const items: string[] = [];
  let n = 0;
  for (const line of bill.lines) {
    const finding = line.finding;
    // Defensive only — the caller filters. See FindingsMessageBill.lines.
    if (finding === null) continue;
    n += 1;

    const product = line.name ?? line.sku;
    const packTail = line.pack !== null ? ` · ${line.pack}` : "";
    const mfg = mfgLabel(finding.mfgMonth, finding.mfgYear);
    const mfgTail = mfg !== null ? ` · ${mfg}` : "";

    items.push(
      `${n}. ${product}${packTail}\n` +
        `    Order ${line.qty} · Found ${finding.qtyFound} · ${findingReasonLabel(finding.reason)}${mfgTail}`,
    );
  }

  // The *Material* heading owns the blank line ABOVE it (every block is joined
  // by one) and sits DIRECTLY on item 1 with no gap — that is what the approved
  // bubble shows. The items are then separated from EACH OTHER by a blank line.
  // Skipped entirely on an empty list: the caller only renders the icon when
  // there is at least one confirmed finding, so this is a seatbelt, not a
  // supported shape — but a bare "*Material*" heading over nothing would be a
  // worse message than none.
  if (items.length > 0) {
    blocks.push(`*Material*\n${items.join("\n\n")}`);
  }

  return blocks.join("\n\n");
}

/**
 * How the share actually left the phone. The caller shows a toast for exactly
 * two of these — see the doc on each.
 */
export type ShareOutcome =
  /** The OS sheet took it. Silence: WhatsApp's own UI is the confirmation. */
  | "shared"
  /** He dismissed the sheet. Silence — see the AbortError note below. */
  | "cancelled"
  /** wa.me opened in a new tab. Silence: he is looking at WhatsApp. */
  | "opened"
  /** Clipboard fallback — the ONLY success worth a toast, because nothing else
   *  on screen tells him it worked. */
  | "copied"
  /** Every path refused. Toast, because he tapped and nothing happened. */
  | "unavailable";

/**
 * Share `message` as PLAIN TEXT.
 *
 * ⚠ MUST BE CALLED SYNCHRONOUSLY FROM A TAP HANDLER, and nothing may be
 * awaited before it. Both `navigator.share` and `window.open` require transient
 * user activation: Chrome expires it a few seconds after the gesture and
 * consumes it on a navigation, so a share issued after an `await fetch(…)`
 * throws `NotAllowedError` — which is exactly why this feature is NOT bolted
 * onto handleApprove (mockup §1: "Approve closes the screen immediately"). The
 * message is built from data already in memory, so there is nothing to await.
 *
 * 🔴 AbortError IS NOT A FAILURE. Dismissing the share sheet REJECTS the
 * promise, with `name === "AbortError"`. Caught by name and reported as
 * "cancelled" so the caller can show NOTHING. A toast saying something broke
 * because he changed his mind is the precise bug this branch exists to
 * prevent (mockup §4: "If he closes the share sheet without sending — nothing
 * happens. No error, no toast.").
 *
 * Order of attempts, and why:
 *  1. `navigator.share({ text })` — the floor is Android-only on the installed
 *     PWA (public/manifest.json, display: standalone). The OS sheet opens OVER
 *     the app, so the bill stays open underneath and Back returns to it with
 *     Approve still waiting. Feature-detected with a bare `typeof` check —
 *     deliberately NOT `canShare({ files: […] })`, the trip-sheet helper's
 *     gate, which is false for a text-only payload.
 *  2. `wa.me` in a new tab — the desk/desktop path. From a standalone PWA this
 *     hands off to Chrome or a Custom Tab first, which then intent-redirects to
 *     WhatsApp; that extra hop is why it is second, not first. `noopener` is
 *     mandatory (the opened page must not reach back through window.opener).
 *     A popup blocker returns null — fall through rather than claim success.
 *  3. Clipboard — last resort, and the one outcome the caller announces.
 */
export async function shareFindingsText(message: string): Promise<ShareOutcome> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ text: message });
      return "shared";
    } catch (err) {
      // By NAME, not by message text — the string is localised and varies per
      // engine; the name is specified.
      if (err instanceof Error && err.name === "AbortError") return "cancelled";
      // Anything else (NotAllowedError from a stale gesture, a share target
      // that threw) falls through to the paths below rather than dead-ending.
    }
  }

  if (typeof window !== "undefined") {
    // encodeURIComponent ONLY here, on the URL path — never in the builder.
    // Newlines become %0A, which WhatsApp honours.
    const opened = window.open(
      `https://wa.me/?text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener",
    );
    if (opened !== null) return "opened";
  }

  try {
    await navigator.clipboard.writeText(message);
    return "copied";
  } catch {
    // Insecure context, denied permission, or no clipboard at all.
    return "unavailable";
  }
}
