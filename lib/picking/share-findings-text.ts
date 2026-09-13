// ── WhatsApp share — picking findings, PLAIN TEXT ──────────────────────────
// Spec: the message layout was RE-CUT on 13 Sep 2026 (see buildFindingsMessage).
// ⚠ docs/mockups/picking/picking-whatsapp-share.html (approved 05 Sep 2026) is
// STALE for the message body since then — its heading, labels, `·` separators
// and indented continuation line are all gone. It still describes the icon and
// the share flow correctly.
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

import { findingReasonLabel, mfgLabel } from "./findings-reasons";
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
 * "04-09-26, 5:42 pm" in IST — `dd-MM-yy, h:mm am/pm` (re-cut 13 Sep 2026; was
 * "04 Sep 2026, 5:42 pm"). Two-digit day, month and year; 12-hour clock with no
 * leading zero on the hour; lower-case meridiem after ONE ASCII space.
 *
 * ⚠ NO `Intl` AND NO `toLocale*` ANYWHERE IN HERE, deliberately. Every ICU
 * route to this string was tried and each carries a real defect:
 *   • `en-GB` short month renders September as **"Sept"**, not "Sep" — caught
 *     by the smoke test on the very date the first format shipped. The month is
 *     numeric now, but the next point still stands on its own.
 *   • `en-US` with `hour12` emits a NARROW NO-BREAK SPACE (U+202F) before
 *     AM/PM on modern ICU (Node 18+, Chrome 110+), not an ASCII space.
 *     Invisible in review, wrong in the string — and it would land inside a
 *     message pasted into a chat.
 *   • `en-GB`'s lower-case "pm" is an ICU detail, not a guarantee, and the
 *     depot phones and Vercel do not run the same ICU build.
 * So the instant is shifted by the fixed IST offset and read through the UTC
 * getters — the identical pattern `istDayRangeFor()` uses in
 * lib/picking/picker-split.ts, and never the local getters.
 *
 * The board's own `formatObdDateTime()` is deliberately NOT reused: it renders
 * the CARD caption ("19 Jul, 4:05 PM" — no year, upper-case meridiem) and is
 * file-private to picking-board-mobile.tsx. Two different formats for two
 * different surfaces; widening that one to serve both would change every
 * card's caption as a side effect.
 *
 * Returns null on a missing or unparseable timestamp — the caller OMITS the
 * whole 🕐 line rather than printing a placeholder (the field is "when SAP
 * raised the order", and a line that cannot say when is not a shorter truth,
 * it is a wrong one).
 */
export function formatOrderStamp(value: Date | string | null): string | null {
  const instant = normaliseInstant(value);
  if (instant === null) return null;

  // Shift into IST, then read UTC parts. Never getHours()/getDate() — those
  // are the machine's zone, which is the entire failure this avoids.
  const ist = new Date(instant.getTime() + IST_OFFSET_MS);
  const day = String(ist.getUTCDate()).padStart(2, "0");
  const month = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const year = String(ist.getUTCFullYear() % 100).padStart(2, "0");

  const h24 = ist.getUTCHours();
  const meridiem = h24 < 12 ? "am" : "pm";
  // 0 → 12am, 12 → 12pm. The modulo alone would print "0:42 am".
  const hour = h24 % 12 === 0 ? 12 : h24 % 12;
  const minute = String(ist.getUTCMinutes()).padStart(2, "0");

  return `${day}-${month}-${year}, ${hour}:${minute} ${meridiem}`;
}

// ── The material block's labels ─────────────────────────────────────────────
// A CLOSED set. Every value starts at the same column because every label is
// padded to the LONGEST one plus a fixed gap — never to the longest label
// actually present on this bill, which would move the column between messages
// (a bill with no Pack line would shift everything left).
//
// ⚠ Derived, not typed as 6: a longer label added here shifts all four
// together instead of breaking alignment for one.
const MATERIAL_LABELS = {
  pack:   "Pack",
  order:  "Order",
  found:  "Found",
  reason: "Reason",
} as const;

const LABEL_GAP = 2;

const LABEL_COLUMN_WIDTH =
  Math.max(...Object.values(MATERIAL_LABELS).map((label) => label.length)) + LABEL_GAP;

/**
 * `Pack    20L` — label, then PLAIN ASCII SPACES (U+0020) to the value column.
 *
 * ⚠ Never a figure space, a no-break space or a tab. The block is a WhatsApp
 * monospace fence, where ordinary spaces align exactly; the exotic ones are
 * what render at a different width and break the column.
 */
function labelledLine(label: string, value: string): string {
  return `${label.padEnd(LABEL_COLUMN_WIDTH, " ")}${value}`;
}

/**
 * The product name with its pack taken OFF THE END, when the catalog
 * description already ends with it — stainers and some other ranges do
 * ("DN Stainer Burnt Sienna 50ML"), which is what printed "50ML · 50ML". The
 * pack has its own line now, so the name no longer needs to carry it.
 *
 * Matching ignores ALL whitespace and case on both sides, so "…Sienna 50 ml"
 * against pack "50ML" still matches; the cut is made in the ORIGINAL string so
 * nothing else about the name changes.
 *
 * 🔴 DIGIT-BOUNDARY GUARD. "Putty 120KG" with pack "20KG" ends-with-matches on
 * the text alone, and trimming it would print "Putty 1" — a different product.
 * If the character just before the matched segment (whitespace ignored, as in
 * the comparison) is a digit, it is NOT a match and the name is left whole.
 *
 * Returns the name unchanged when nothing matches, and also when trimming would
 * leave nothing — a name that IS only its pack is still better than a blank
 * numbered line.
 */
function stripTrailingPack(name: string, pack: string): string {
  const target = pack.replace(/\s+/g, "").toUpperCase();
  if (target === "") return name;

  // Walk back from the end of the ORIGINAL name, skipping whitespace, matching
  // the normalised pack right to left. `cut` ends at the first matched char.
  let cut = name.length;
  let remaining = target.length;
  while (remaining > 0) {
    cut -= 1;
    if (cut < 0) return name;
    const ch = name[cut];
    if (/\s/.test(ch)) continue;
    if (ch.toUpperCase() !== target[remaining - 1]) return name;
    remaining -= 1;
  }

  // The guard: the nearest non-whitespace character before the segment.
  let before = cut - 1;
  while (before >= 0 && /\s/.test(name[before])) before -= 1;
  if (before >= 0 && /[0-9]/.test(name[before])) return name;

  const stripped = name.slice(0, cut).trimEnd();
  return stripped === "" ? name : stripped;
}

/** WhatsApp's monospace fence — a line holding exactly three backticks. */
const MONOSPACE_FENCE = "```";

/**
 * THE message. Re-cut 13 Sep 2026, character for character:
 *
 *   ⚠️ *SHORT DISPATCH*
 *
 *   🏪 *Shree Paint House*
 *   🧾 9108973203
 *   🕐 04-09-26, 5:42 pm
 *
 *   ```
 *   1. Weathershield Max White
 *   Pack    20L
 *   Order   10
 *   Found   6
 *   Reason  Short quantity
 *
 *   2. Gloss Brilliant White
 *   Pack    4L
 *   Order   12
 *   Found   12
 *   Reason  Old MFG Mar 2024
 *   ```
 *
 * Why it changed (a real message from the floor, 12 Sep 2026): the pack printed
 * twice ("50ML · 50ML"), the indented continuation line wrapped into something
 * that looked broken on a narrow phone, the bold labels were obvious words
 * eating width, and the heading did not say the one thing billing must act on —
 * the bill is dispatching SHORT.
 *
 * Format rules, all load-bearing:
 * - ONE emoji, at the FRONT of the heading only. No "— Picking" suffix.
 * - `*…*` is WHATSAPP BOLD, not markdown — on the heading and the dealer name
 *   only. The OBD number and the date carry no label word; the emoji is the
 *   label.
 * - The material list sits inside a ``` MONOSPACE FENCE, which is the only
 *   thing that makes a value column line up in a chat bubble. Label + ASCII
 *   spaces to a fixed column (LABEL_COLUMN_WIDTH), no colon, no hyphen, no `·`
 *   anywhere. Blank line between materials, none before the closing fence, and
 *   nothing after it.
 * - Plain `\n`. NOTHING is pre-encoded here — `shareFindingsText` encodes for
 *   the wa.me path only, and double-encoding is how a message arrives full of
 *   `%0A`.
 * - Reason labels come from findings-reasons.ts. Never hardcode "Short
 *   quantity" / "Old MFG": that module is the closed vocabulary the live CHECK
 *   constraint mirrors, and a hand-typed label is a second list to drift.
 * - The MFG date is CONDITIONAL on `mfgLabel()` returning non-null. It returns
 *   null for `old_mfg` rows recorded before 2026-08-08, which carry no
 *   month/year and which nothing can backfill — 3 of the 4 live old-MFG rows
 *   were dateless at the 2026-08-09 count (CLAUDE_PICKING.md §11.3). Those
 *   read exactly `Reason  Old MFG`: no trailing space, never "undefined NaN".
 * - `name ?? sku`: PickingDetailLine.name is nullable, and the route already
 *   falls back to the raw SAP description before that. The SAP code is the last
 *   resort and is still a true identifier of the tin — and is never trimmed.
 * - A blank pack STAYS BLANK (`pack` is null on ~27% unmastered codes) — the
 *   whole Pack line is dropped rather than guessed, and the name is left
 *   untouched. CLAUDE_PICKING.md §7: a blank is a mis-pick preventer, a wrong
 *   value is not.
 * - Brand prefixes ("DN", "IN") are NOT stripped from the name. That needs the
 *   real prefix list from live data and is a separate change.
 */
export function buildFindingsMessage(bill: FindingsMessageBill): string {
  const blocks: string[] = ["⚠️ *SHORT DISPATCH*"];

  const stamp = formatOrderStamp(bill.obdDateTime);
  const header = [
    // Trimmed: WhatsApp will not embolden `*Name *` — a stray trailing space
    // from the master would print literal asterisks.
    `🏪 *${bill.dealerName.trim()}*`,
    `🧾 ${bill.obdNumber}`,
    // Omitted entirely when there is no readable date — see formatOrderStamp.
    ...(stamp !== null ? [`🕐 ${stamp}`] : []),
  ];
  blocks.push(header.join("\n"));

  const items: string[] = [];
  let n = 0;
  for (const line of bill.lines) {
    const finding = line.finding;
    // Defensive only — the caller filters. See FindingsMessageBill.lines.
    if (finding === null) continue;
    n += 1;

    const pack = line.pack !== null && line.pack.trim() !== "" ? line.pack.trim() : null;
    const product =
      line.name !== null
        ? (pack !== null ? stripTrailingPack(line.name, pack) : line.name).trim()
        : line.sku;
    const mfg = mfgLabel(finding.mfgMonth, finding.mfgYear);
    const reason = findingReasonLabel(finding.reason);

    items.push(
      [
        `${n}. ${product}`,
        ...(pack !== null ? [labelledLine(MATERIAL_LABELS.pack, pack)] : []),
        labelledLine(MATERIAL_LABELS.order, String(line.qty)),
        labelledLine(MATERIAL_LABELS.found, String(finding.qtyFound)),
        labelledLine(MATERIAL_LABELS.reason, mfg !== null ? `${reason} ${mfg}` : reason),
      ].join("\n"),
    );
  }

  // Skipped entirely on an empty list: the caller only renders the icon when
  // there is at least one confirmed finding, so this is a seatbelt, not a
  // supported shape — but an empty fence would be a worse message than none.
  if (items.length > 0) {
    blocks.push(`${MONOSPACE_FENCE}\n${items.join("\n\n")}\n${MONOSPACE_FENCE}`);
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
