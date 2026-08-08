import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = 'force-dynamic';

/* ── Slot cutoffs — 5-minute in-process cache ──────────────── */

/**
 * Response shape — UNCHANGED. Declared locally rather than imported from
 * lib/mail-orders/utils so this route keeps no dependency on the client module;
 * the four keys and their defaults are exactly what this route has always
 * returned ("HH:MM" strings, CLAUDE_MAIL_ORDERS §9.1).
 */
interface SlotCutoffsPayload {
  morning:     string;
  afternoon:   string;
  evening:     string;
  lateEvening: string;
}

/**
 * Why this cache exists. This route has exactly ONE caller — fetchSlotCutoffs()
 * in lib/mail-orders/api.ts:133 — and it is called from inside the SAME
 * Promise.all as fetchMailOrders (mail-orders-page.tsx:237-238). So it fires on
 * the board's 30-second poll, every poll, all day, per open tab.
 *
 * What it reads is four depot configuration rows that change a few times a
 * year. A 5-minute TTL is the accepted trade: an admin editing a cutoff in
 * settings sees it take effect within 5 minutes, never instantly, never not at
 * all.
 *
 * SOFT cache, not a source of truth. Module-level = per warm Vercel instance; a
 * cold start rebuilds it once, which is correct. Deliberately NOT persisted and
 * NOT invalidated by a settings write.
 */
const CUTOFFS_CACHE_TTL_MS = 5 * 60 * 1000;

let cutoffsCache: { value: SlotCutoffsPayload; builtAt: number } | null = null;
// Single-flight guard — see the twin in app/api/mail-orders/route.ts.
let cutoffsInFlight: Promise<SlotCutoffsPayload> | null = null;

async function getSlotCutoffs(): Promise<SlotCutoffsPayload> {
  if (cutoffsCache && Date.now() - cutoffsCache.builtAt < CUTOFFS_CACHE_TTL_MS) {
    return cutoffsCache.value;
  }
  if (cutoffsInFlight) return cutoffsInFlight;

  // Sequential await, never prisma.$transaction (CORE §3).
  const build = (async (): Promise<SlotCutoffsPayload> => {
    const rows = await prisma.system_config.findMany({
      where: {
        key: {
          in: [
            "slot_morning_cutoff",
            "slot_afternoon_cutoff",
            "slot_evening_cutoff",
            "slot_late_evening_cutoff",
          ],
        },
      },
    });

    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    // Same keys, same order, same fallbacks as before the cache landed.
    const value: SlotCutoffsPayload = {
      morning:     map.slot_morning_cutoff ?? "10:30",
      afternoon:   map.slot_afternoon_cutoff ?? "12:30",
      evening:     map.slot_evening_cutoff ?? "17:00",
      lateEvening: map.slot_late_evening_cutoff ?? "20:00",
    };

    cutoffsCache = { value, builtAt: Date.now() };
    return value;
  })();

  cutoffsInFlight = build;
  try {
    return await build;
  } finally {
    // A failed read leaves no cache entry; the next request simply retries.
    if (cutoffsInFlight === build) cutoffsInFlight = null;
  }
}

export async function GET() {
  return NextResponse.json(await getSlotCutoffs());
}
