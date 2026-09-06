import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// The "Base — No Tint" placeholder worker — ONE owner for its identity.
//
// A bill that is entirely base/stock colour still has to leave the tint rail,
// and the bypass (POST /api/tint/manager/base-bypass) does that by writing a
// completed `tint_assignments` row attributed to this row rather than to a real
// person. Several places then have to recognise it again — the board's
// completed-today feed, the live-sync marker, the TI ownership checks, and the
// "Tinter Issue pending" list — so the identity lives here and nowhere else.
//
// 🔴 THE EMAIL STRING EXISTS IN EXACTLY ONE PLACE: the constant below. Do not
// retype it in a route, a query or a test. It is the only stable key this row
// has — `users.id` is a serial that a reseed or a restore would renumber, and an
// id-keyed lookup would then silently attribute bypasses to whoever inherited
// that id. Email is UNIQUE on `users` (users_email_key), so findUnique is exact.
//
// The live row (SELECT-verified 2026-09-06) is deliberately inert:
//   isActive=false  → kept out of the Assign dropdown
//                     (/api/tint/manager/operators filters isActive), the
//                     Reports operator chips (app/reports/page.tsx), all three
//                     picker rosters, the attendance roster + export, the
//                     nightly rollover cron, and refused at sign-in
//                     (lib/auth.ts:210)
//   no user_roles   → invisible to the operators query even if that isActive
//                     filter ever changed, because it keys on the junction
//                     table rather than users.roleId
//   no user_page_access rows → holds no permission anywhere
//   non-bcrypt password → bcrypt.compare can never return true for it
//
// 🔴 `isActive: false` is deliberately NOT part of the lookup below. Assign
// (app/api/tint/manager/assign/route.ts:155-161) does not check isActive
// either, so an inactive user is a perfectly valid `assignedToId`. That
// asymmetry is the whole trick: the row is usable as an attribution target
// while staying invisible everywhere a *person* is listed. Adding an
// `isActive: true` filter here would break the bypass, not harden it.
// ─────────────────────────────────────────────────────────────────────────────

/** The placeholder worker's email. The single source of this string. */
export const BASE_OPERATOR_EMAIL = "base-notint@system.invalid";

/**
 * The placeholder worker's numeric id, or null when the row is absent.
 *
 * Callers decide what "absent" means for them — the bypass refuses loudly with
 * a 500 (attributing a bypass to a real person is the exact confusion the
 * feature exists to prevent), while the read-side filters degrade to "exclude
 * nothing", which shows a placeholder row on the board rather than hiding real
 * work. Both are deliberate; neither is a silent fallback to a real user.
 *
 * NOT cached in module scope. A serverless instance can outlive a reseed, and a
 * stale id here would mis-attribute every subsequent bypass. It is one indexed
 * lookup on a UNIQUE column, next to queries that already do far more work.
 */
export async function getBaseOperatorId(): Promise<number | null> {
  const row = await prisma.users.findUnique({
    where:  { email: BASE_OPERATOR_EMAIL },
    select: { id: true },
  });
  return row?.id ?? null;
}
