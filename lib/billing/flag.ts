import { prisma } from "@/lib/prisma";

// ── Billing v2 rollout flag (Phase 0, 2026-07-30) ────────────────────────────
//
// Per-USER opt-in for the new Billing UI on /mail-orders. Off for everyone
// until a row is flipped in `users.billingV2TestUser`; the column exists in
// Supabase and is mirrored in prisma/schema.prisma.
//
// ⚠ DELIBERATE DEVIATION FROM THE ATTENDANCE PATTERN — do not "fix" this.
// `attendanceTestUser` is read once and cached onto the JWT (lib/auth.ts:34 →
// :124/:151), which means a change to it only reaches the user after the
// 5-minute STALE_MS window has elapsed. This flag is read FRESH on every page
// load instead. The cost is one indexed lookup on a primary key; the gain is
// that switching a user OFF takes effect IMMEDIATELY rather than after a token
// refresh — which is the whole point of a rollout switch you may need to pull
// in a hurry.
//
// ⚠ Do NOT move this into lib/auth.ts or auth.config.ts. Those two are the
// Node/Edge auth split and must not be merged or expanded (CORE §3). This
// helper is Node-only (it touches Prisma) and belongs to the Billing module,
// not to auth.
//
// FAILS CLOSED. Any error — a missing column, a dropped connection, a bad id —
// returns false and logs. A flag lookup must NEVER break the Mail Orders page:
// the worst case is that the user simply stays on the screen they have today.
export async function isBillingV2Enabled(
  userId: number | null | undefined,
): Promise<boolean> {
  // `session.user.id` arrives as a string, so callers pass Number(...) — which
  // yields NaN for a malformed value. Number.isFinite catches NaN, ±Infinity,
  // null and undefined in one test.
  if (!Number.isFinite(userId)) return false;

  try {
    const user = await prisma.users.findUnique({
      where: { id: userId as number },
      select: { billingV2TestUser: true },
    });
    return user?.billingV2TestUser ?? false;
  } catch (err) {
    console.error("[billing-v2-flag] lookup failed — defaulting to OFF", err);
    return false;
  }
}
