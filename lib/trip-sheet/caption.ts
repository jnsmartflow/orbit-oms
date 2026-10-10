// lib/trip-sheet/caption.ts
//
// The WhatsApp caption sent with the trip sheet image (spec
// docs/prompts/drafts/web-update-2026-10-09-trip-sheet.md §4), exactly:
//
//   🕐 {time 12h} · {tripNumber}
//   {driver first name} {mobile}
//   {N} stops · {unique areas, comma-joined}
//
// A missing piece drops out rather than printing "null": no time → the line is
// just the trip number; no driver and no mobile → that line is left out.
//
// PURE — client-safe.

import { smartTitleCase } from "@/lib/mail-orders/utils";
import type { TripSheet } from "./types";

/** "15:30" → "3:30 PM"; anything else → null. */
export function to12h(hhmm: string | null): string | null {
  const m = hhmm ? /^(\d{1,2}):(\d{2})/.exec(hhmm) : null;
  if (!m) return null;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

/** First word of the driver's name, title-cased ("SUNIL DIPAKBHAI …" → "Sunil"). */
export function driverFirstName(name: string | null): string | null {
  const first = smartTitleCase(name).split(/\s+/)[0];
  return first ? first : null;
}

/** "2026-10-10" → "10 Oct" (the sheet's own date, read UTC-anchored). */
function dayMonth(isoDate: string): string {
  return new Date(isoDate + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}

/**
 * The caption, owner's 5-line format (2026-10-10):
 *
 *   🚚 L-261010-02
 *   🕐 10 Oct 10:30 AM
 *   👤 Prahalad · 7984732765
 *   📦 2 stops
 *   📍 Adajan
 *
 * No word "Trip" and no delivery type. Date = the sheet's trip date; time = the
 * sheet's time (manualDispatchAt IST, else the slot window) — no time → the date
 * alone. No phone → "👤 {name}"; no driver → the line is skipped. N = the stops
 * on the sheet. Areas = unique, in sheet order; no areas → the line is skipped.
 */
export function buildTripSheetCaption(sheet: TripSheet): string {
  const h = sheet.header;
  const lines: string[] = [`🚚 ${h.tripNumber}`];
  const time = to12h(h.timeLabel);
  lines.push(`🕐 ${dayMonth(h.tripDate)}${time ? ` ${time}` : ""}`);
  const first = driverFirstName(h.driverName);
  if (first) lines.push(h.driverPhone ? `👤 ${first} · ${h.driverPhone}` : `👤 ${first}`);
  const n = sheet.totals.stops;
  lines.push(`📦 ${n} ${n === 1 ? "stop" : "stops"}`);
  const areas = sheet.captionAreas.map((a) => smartTitleCase(a)).filter(Boolean).join(", ");
  if (areas) lines.push(`📍 ${areas}`);
  return lines.join("\n");
}
