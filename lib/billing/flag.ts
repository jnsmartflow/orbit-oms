import { prisma } from "@/lib/prisma";
import type { RolloutStage } from "@/auth.config";

// ── Billing v2 rollout flag (Phase 0, 2026-07-30) ────────────────────────────
//
// Two-part gate, mirroring the STRUCTURE of the Attendance rollout (a global
// stage + a per-user boolean + a tiny gate) — but NOT its JWT caching, see the
// deviation note below.
//
//   billing_settings.rolloutStage   global master switch, one singleton row
//   users.billingV2TestUser         per-user opt-in
//
// Both live in Supabase and are mirrored in prisma/schema.prisma.
//
// Rollout ladder:
//   OFF              — nobody, whatever their per-user flag says. The emergency
//                      kill switch: one UPDATE pulls the feature from everyone.
//   TEST_USERS_ONLY  — only users with billingV2TestUser = true. The seeded
//                      default, and DARK on arrival (0 users opted in), so the
//                      pilot is a single per-user flip on `operations` (id 20).
//   ALL_USERS        — everyone who can already reach /mail-orders (that route
//                      is gated on mail_orders/canView by its layout). The
//                      one-flip full rollout.
//
// ⚠ DELIBERATE DEVIATION FROM THE ATTENDANCE PATTERN — do not "fix" this.
// `attendanceTestUser` is read once and cached onto the JWT (lib/auth.ts:34 →
// :124/:151), which means a change to it only reaches the user after the
// 5-minute STALE_MS window has elapsed. This flag is read FRESH on every page
// load instead. The cost is two indexed lookups; the gain is that switching a
// user — or the whole depot — OFF takes effect IMMEDIATELY rather than after a
// token refresh. That is the whole point of a switch you may need to pull in a
// hurry. Confirmed as the intended design 2026-07-30: "mirror Attendance" means
// the structure, not the cache. Do NOT introduce STALE_MS here.
//
// ⚠ Do NOT move this into lib/auth.ts or auth.config.ts. Those two are the
// Node/Edge auth split and must not be merged or expanded (CORE §3). This
// helper is Node-only (it touches Prisma) and belongs to the Billing module,
// not to auth. Only the RolloutStage *type* is borrowed, which is Edge-safe.
//
// FAILS CLOSED, everywhere. Any error — a missing table, a missing column, a
// dropped connection, a bad id — resolves to OFF and never throws. A flag
// lookup must NEVER break the Mail Orders page: the worst case is that the user
// simply stays on the screen they have today.

/**
 * The global stage. Defaults to OFF when the row (or the whole table) is
 * absent, so the feature is dark until someone deliberately turns it on.
 */
async function getRolloutStage(): Promise<RolloutStage> {
  try {
    const row = await prisma.billing_settings.findFirst({
      where: { scope: "GLOBAL" },
      select: { rolloutStage: true },
    });
    return (row?.rolloutStage ?? "OFF") as RolloutStage;
  } catch (err) {
    // P2021 = the table does not exist yet. That is the EXPECTED state between
    // this code deploying and Smart Flow running the CREATE TABLE in the
    // Supabase SQL Editor, so it is not logged as an error — it just reads OFF,
    // which is exactly what we want during that window. Anything else is a real
    // fault and gets logged.
    if ((err as { code?: string }).code !== "P2021") {
      console.error("[billing-v2-flag] stage lookup failed — defaulting to OFF", err);
    }
    return "OFF";
  }
}

/**
 * Is Billing v2 on for this user, right now?
 *
 * Sequential awaits, never prisma.$transaction (CORE §3). The per-user lookup
 * is skipped entirely on OFF and on ALL_USERS — those two answers do not depend
 * on it, so the common cases cost one query, not two.
 */
export async function isBillingV2Enabled(
  userId: number | null | undefined,
): Promise<boolean> {
  // `session.user.id` arrives as a string, so callers pass Number(...) — which
  // yields NaN for a malformed value. Number.isFinite catches NaN, ±Infinity,
  // null and undefined in one test.
  if (!Number.isFinite(userId)) return false;

  const stage = await getRolloutStage();
  if (stage === "OFF") return false;
  if (stage === "ALL_USERS") return true;

  // TEST_USERS_ONLY — the per-user opt-in decides. An unrecognised stage value
  // cannot reach here (the CHECK constraint bounds the column), and if one ever
  // did it would land in this arm and stay gated on the per-user flag, which is
  // the safe side.
  try {
    const user = await prisma.users.findUnique({
      where: { id: userId as number },
      select: { billingV2TestUser: true },
    });
    return user?.billingV2TestUser ?? false;
  } catch (err) {
    console.error("[billing-v2-flag] user lookup failed — defaulting to OFF", err);
    return false;
  }
}
