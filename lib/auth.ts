import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig, type RolloutStage } from "@/auth.config";
import { istDateString } from "@/lib/attendance/date";
import { getAccessState } from "@/lib/access/source";
import { accessNotebook } from "@/lib/access/notebook-store";
import { readRefreshClaims } from "@/lib/access/notebook";

// ── Validation schema ──────────────────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

// ── Attendance gate helpers (Node-only — Prisma access) ───────────────────────
//
// Stale window: the refresh branch below skips the DB while the token's
// rolloutStageStaleAt is in the future, and stamps it forward after a re-read.
// ⚠ In practice the stamp NEVER ADVANCES in the cookie: a bare auth() (route
// handlers, layouts, pages) throws away the re-encoded token, and middleware's
// Edge jwt callback re-signs the old value. So after minute 5 of a session the
// OFF path re-reads the users row + attendance_settings on EVERY auth() —
// measured in docs/prompts/drafts/code-discovery-2026-09-29-disk-io.md §C.
// With system_config ACCESS_CACHE = 'on' the refresh reads the per-instance
// access notebook instead (lib/access/notebook.ts) and this window is not used.
const STALE_MS = 5 * 60 * 1000;

interface UserAttendanceFlags {
  rolloutStage: RolloutStage;
  attendanceTestUser: boolean;
  attendanceExempt: boolean;
  attendanceConsentVersion: string | null;
  // Not an attendance flag — it rides along because this function is already
  // the once-per-stale-window re-read of the user row, so carrying it costs no
  // extra query and means granting or revoking superuser lands within STALE_MS
  // instead of requiring the person to sign out and back in.
  isSuperuser: boolean;
}

async function fetchUserAttendanceFlags(userId: number): Promise<UserAttendanceFlags> {
  // Sequential awaits — never $transaction (Vercel pooler timeout rule).
  const userRow = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      attendanceTestUser: true,
      attendanceExempt: true,
      attendanceConsentVersion: true,
      isSuperuser: true,
    },
  });
  const settingsRow = await prisma.attendance_settings.findFirst({
    where: { scope: "GLOBAL", roleSlug: null },
    select: { rolloutStage: true },
  });
  return {
    rolloutStage: (settingsRow?.rolloutStage ?? "OFF") as RolloutStage,
    attendanceTestUser: userRow?.attendanceTestUser ?? false,
    attendanceExempt: userRow?.attendanceExempt ?? false,
    attendanceConsentVersion: userRow?.attendanceConsentVersion ?? null,
    // ?? false, never ?? true — a missing row must not mint a superuser.
    isSuperuser: userRow?.isSuperuser ?? false,
  };
}

async function fetchLastCheckInForToday(
  userId: number,
  todayIST: string,
): Promise<string | null> {
  const record = await prisma.attendance_records.findFirst({
    where: { userId, type: "CHECK_IN", attendanceDate: todayIST },
    select: { attendanceDate: true },
  });
  return record?.attendanceDate ?? null;
}

// Decides whether the jwt callback fetches lastCheckInDate for this user.
// (It once mirrored a middleware attendance gate; that gate was removed in
// 236f9743 and nothing reads lastCheckInDate today — CLAUDE_ATTENDANCE.md §3.)
function gateAppliesTo(role: string | undefined, flags: UserAttendanceFlags): boolean {
  if (flags.rolloutStage === "OFF") return false;
  if (flags.attendanceExempt) return false;
  if (role === "admin") return flags.attendanceTestUser;
  if (flags.rolloutStage === "TEST_USERS_ONLY") return flags.attendanceTestUser;
  if (flags.rolloutStage === "ALL_USERS") return true;
  return false;
}

// ── Full NextAuth config — Node.js runtime only ───────────────────────────────
// Spreads the Edge-compatible authConfig and adds the Credentials provider
// which requires Prisma + bcrypt (not available in Edge Runtime).
//
// Re-spreads `...authConfig.callbacks` so the Edge session callback (which
// passes attendance claims through to session.user) stays as-is. Only
// `jwt` is overridden — the Node version hits Prisma to set/refresh the
// attendance rollout claims and lastCheckInDate.
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger }) {
      // Update path: client called session.update() — narrow re-read of
      // both the consent claim (P4 consent flow) AND lastCheckInDate
      // (P6 check-in flow). rolloutStageStaleAt is intentionally left
      // alone so the 5-min stale window for rollout flags keeps working
      // independently of explicit user-driven refreshes.
      if (trigger === "update") {
        const userIdRaw = token.id as string | undefined;
        const userId = userIdRaw ? parseInt(userIdRaw, 10) : NaN;
        if (Number.isFinite(userId)) {
          const userRow = await prisma.users.findUnique({
            where: { id: userId },
            select: { attendanceConsentVersion: true },
          });
          token.attendanceConsentVersion = userRow?.attendanceConsentVersion ?? null;

          // Re-read today's CHECK_IN so the gate clears immediately
          // after a successful check-in. Always re-read on explicit
          // update — this is user-driven, not a passive refresh.
          token.lastCheckInDate = await fetchLastCheckInForToday(
            userId,
            istDateString(),
          );
          // This user's own notebook entry on THIS instance is now older than
          // what was just read — forget it (memory only; the consent column
          // deliberately does not bump ACCESS_VERSION for every instance).
          accessNotebook.invalidateUser(userId);
        }
        return token;
      }

      // Sign-in path: Credentials provider just authorized this user.
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.roles = user.roles;

        const userId = user.id ? parseInt(user.id, 10) : NaN;
        if (!Number.isFinite(userId)) return token;

        // A fresh sign-in must never be judged by an older notebook entry on
        // this instance (e.g. one cached while the account was inactive).
        // Memory only — the reads below are fresh either way.
        accessNotebook.invalidateUser(userId);

        const flags = await fetchUserAttendanceFlags(userId);
        token.rolloutStage = flags.rolloutStage;
        token.attendanceTestUser = flags.attendanceTestUser;
        token.attendanceExempt = flags.attendanceExempt;
        token.attendanceConsentVersion = flags.attendanceConsentVersion;
        token.isSuperuser = flags.isSuperuser;
        token.rolloutStageStaleAt = Date.now() + STALE_MS;

        if (gateAppliesTo(user.role, flags)) {
          token.lastCheckInDate = await fetchLastCheckInForToday(
            userId,
            istDateString(),
          );
        } else {
          token.lastCheckInDate = null;
        }
        return token;
      }

      // ── Refresh path, ACCESS NOTEBOOK ON (system_config ACCESS_CACHE='on') ──
      // Reads the per-instance notebook instead of the database. No stale-
      // window gate: the check is a memory read, and a deactivation must not
      // wait for minute 5 of a session. With the switch anything but 'on' this
      // block is skipped and the pre-notebook code below runs unchanged.
      // lib/access/notebook.ts has the trust rules; the plan of record is
      // docs/prompts/drafts/code-plan-2026-09-29-auth-access-notebook.md.
      if ((await getAccessState()).cacheOn) {
        const nbUserId = token.id ? parseInt(token.id as string, 10) : NaN;
        if (!Number.isFinite(nbUserId)) return token;

        const refresh = await readRefreshClaims(accessNotebook, nbUserId);

        if (refresh.kind === "failed") {
          // Decision 3 (2026-09-29): a failed read keeps the token's OWN claims
          // — exactly what the first 5 minutes of every session carry today.
          // It never deactivates anyone, never grants anything new, and nothing
          // is cached (the notebook stores only successful reads). The pre-
          // notebook path instead throws here, which makes auth() return null
          // and bounces every user to /login while the database is struggling.
          console.error("[auth] access notebook read failed; keeping the token's own claims:", refresh.error);
          return token;
        }

        // Deactivation mid-session: no users row, or isActive = false → null.
        // @auth/core then returns a null session, so auth() is null and the
        // person is treated as signed out on this and every later request;
        // sign-in is refused by authorize() below.
        if (refresh.kind === "inactive") return null;

        token.rolloutStage = refresh.claims.rolloutStage as RolloutStage;
        token.attendanceTestUser = refresh.claims.attendanceTestUser;
        token.attendanceExempt = refresh.claims.attendanceExempt;
        token.attendanceConsentVersion = refresh.claims.attendanceConsentVersion;
        token.isSuperuser = refresh.claims.isSuperuser;
        // Decision 8: lastCheckInDate is NOT re-read here — nothing reads the
        // claim (CLAUDE_ATTENDANCE.md §3); it keeps its sign-in / update() value.
        return token;
      }

      // Refresh path: skip DB unless the stale window has elapsed.
      const now = Date.now();
      const staleAt = token.rolloutStageStaleAt ?? 0;
      if (staleAt > now) return token;

      const userIdRaw = token.id as string | undefined;
      const userId = userIdRaw ? parseInt(userIdRaw, 10) : NaN;
      if (!Number.isFinite(userId)) return token;

      const flags = await fetchUserAttendanceFlags(userId);
      token.rolloutStage = flags.rolloutStage;
      token.attendanceTestUser = flags.attendanceTestUser;
      token.attendanceExempt = flags.attendanceExempt;
      token.attendanceConsentVersion = flags.attendanceConsentVersion;
      // 🔴 Re-read on the SAME 5-minute stale window as the attendance claims,
      // so granting or revoking superuser lands WITHOUT a sign-out. This is the
      // reason the answer to "does a flag change need a re-login?" is no.
      token.isSuperuser = flags.isSuperuser;
      token.rolloutStageStaleAt = now + STALE_MS;

      const role = token.role as string | undefined;
      if (gateAppliesTo(role, flags)) {
        const todayIST = istDateString();
        if (token.lastCheckInDate !== todayIST) {
          token.lastCheckInDate = await fetchLastCheckInForToday(
            userId,
            todayIST,
          );
        }
      } else {
        token.lastCheckInDate = null;
      }
      return token;
    },
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const input = email.trim();
        const isPhone = /^\d{10}$/.test(input);

        const user = await prisma.users.findFirst({
          where: isPhone
            ? { phone: input }
            : { email: input.toLowerCase() },
          include: {
            role: true,
            userRoles: { include: { role: true } },
          },
        });

        if (!user || !user.isActive) return null;

        const passwordValid = await bcrypt.compare(password, user.password);
        if (!passwordValid) return null;

        // Normalize to snake_case to match ROLES constants and role_permissions.roleSlug
        // e.g. "Tint Operator" → "tint_operator", "Admin" → "admin"
        const primaryRole = user.role.name.toLowerCase().replace(/\s+/g, "_");
        const allRoles = user.userRoles.map((ur) =>
          ur.role.name.toLowerCase().replace(/\s+/g, "_")
        );
        const roles = allRoles.length > 0 ? allRoles : [primaryRole];

        return {
          id: user.id.toString(),
          email: user.email,
          name: user.name,
          role: primaryRole,
          roles,
          isSuperuser: user.isSuperuser,
        };
      },
    }),
  ],
});
