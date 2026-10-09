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

export function buildTripSheetCaption(sheet: TripSheet): string {
  const h = sheet.header;
  const time = to12h(h.timeLabel);
  const lines: string[] = [time ? `🕐 ${time} · ${h.tripNumber}` : `🕐 ${h.tripNumber}`];
  const who = [driverFirstName(h.driverName), h.driverPhone].filter((s): s is string => !!s).join(" ");
  if (who) lines.push(who);
  const n = sheet.totals.stops;
  const areas = sheet.captionAreas.map((a) => smartTitleCase(a)).join(", ");
  lines.push(`${n} ${n === 1 ? "stop" : "stops"}${areas ? ` · ${areas}` : ""}`);
  return lines.join("\n");
}
