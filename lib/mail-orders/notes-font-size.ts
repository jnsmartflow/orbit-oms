import { prisma } from "@/lib/prisma";

// ── Notes-band text size (per user, 2026-08-07) ──────────────────────────────
//
// The size of the remark text in the /mail-orders instructions band, stored in
// PIXELS on users.notesFontSize. Structured like lib/billing/flag.ts, and for
// the same reason: this is read on every /mail-orders page load, so it must be
// impossible for it to break that page.
//
// ⚠ NOT cached onto the JWT, deliberately — same stance as billingV2TestUser,
// but for a different reason. billingV2 is read fresh because it is a kill
// switch that must propagate instantly. THIS is read fresh because the operator
// who changes it is the operator reading it: caching behind lib/auth.ts's
// 5-minute STALE_MS window would let them pick 14, see 14, reload, and get 11
// back until the token happened to refresh. A preference that un-does itself is
// worse than one that takes a moment to arrive.
//
// FAILS SOFT, everywhere. Any error — a missing column between deploy and Smart
// Flow, a dropped connection, a bad id — resolves to DEFAULT_NOTES_FONT_PX and
// never throws.

/** The column's own default, and the answer to every failed lookup. */
export const DEFAULT_NOTES_FONT_PX = 11;

/**
 * Bounds, mirroring the live CHECK constraint chk_users_notes_font_size
 * (notesFontSize >= 11 AND <= 15). Prisma cannot express a CHECK, so the same
 * range is enforced in three places — here on read, in the POST route on write,
 * and by Postgres itself. Widening the range means changing all three.
 */
export const MIN_NOTES_FONT_PX = 11;
export const MAX_NOTES_FONT_PX = 15;

/** Clamp to [11, 15]. Exported so the write path bounds-checks against the
 *  same helper the read path clamps with, rather than a second pair of
 *  literals that can drift. */
export function clampNotesFontPx(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_NOTES_FONT_PX;
  return Math.min(MAX_NOTES_FONT_PX, Math.max(MIN_NOTES_FONT_PX, Math.round(px)));
}

/**
 * This user's notes-band size in px, right now.
 *
 * Single sequential await, never prisma.$transaction (CORE §3). The clamp is a
 * safety net, not the primary guard: the CHECK constraint already bounds the
 * column, but a row written before the constraint existed — or by a future
 * path that bypasses the route — must not be able to render an absurd band.
 */
export async function getNotesFontSize(
  userId: number | null | undefined,
): Promise<number> {
  // `session.user.id` arrives as a string, so callers pass Number(...), which
  // yields NaN for a malformed value. Number.isFinite catches NaN, ±Infinity,
  // null and undefined in one test — same guard shape as isBillingV2Enabled.
  if (!Number.isFinite(userId)) return DEFAULT_NOTES_FONT_PX;

  try {
    const user = await prisma.users.findUnique({
      where: { id: userId as number },
      select: { notesFontSize: true },
    });
    if (user?.notesFontSize == null) return DEFAULT_NOTES_FONT_PX;
    return clampNotesFontPx(user.notesFontSize);
  } catch (err) {
    // P2022 = the column does not exist yet. That is the EXPECTED state between
    // this code deploying and Smart Flow running the ALTER, so it is not logged
    // as an error — it just reads 11, which is the column's own default and
    // today's rendered size. Anything else is a real fault and gets logged.
    if ((err as { code?: string }).code !== "P2022") {
      console.error(
        "[notes-font-size] lookup failed — defaulting to 11px",
        err,
      );
    }
    return DEFAULT_NOTES_FONT_PX;
  }
}
