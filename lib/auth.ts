import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig, type RolloutStage } from "@/auth.config";
import { istDateString } from "@/lib/attendance/date";

// ── Validation schema ──────────────────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ── Attendance gate helpers (Node-only — Prisma access) ───────────────────────
//
// Stale window: cached rollout flags are re-read from DB this often. Lower
// = faster propagation when admin toggles rolloutStage; higher = fewer DB
// hits per session refresh. 5 min matches the diagnosis trade-off.
const STALE_MS = 5 * 60 * 1000;

interface UserAttendanceFlags {
  rolloutStage: RolloutStage;
  attendanceTestUser: boolean;
  attendanceExempt: boolean;
  attendanceConsentVersion: string | null;
}

async function fetchUserAttendanceFlags(userId: number): Promise<UserAttendanceFlags> {
  // Sequential awaits — never $transaction (Vercel pooler timeout rule).
  const userRow = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      attendanceTestUser: true,
      attendanceExempt: true,
      attendanceConsentVersion: true,
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

// Mirror of the middleware gate logic — kept in sync there. Lives here so
// the jwt callback can skip the lastCheckInDate fetch when the gate doesn't
// apply to this user (Q3 refinement).
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
    async jwt({ token, user }) {
      // Sign-in path: Credentials provider just authorized this user.
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.roles = user.roles;

        const userId = user.id ? parseInt(user.id, 10) : NaN;
        if (!Number.isFinite(userId)) return token;

        const flags = await fetchUserAttendanceFlags(userId);
        token.rolloutStage = flags.rolloutStage;
        token.attendanceTestUser = flags.attendanceTestUser;
        token.attendanceExempt = flags.attendanceExempt;
        token.attendanceConsentVersion = flags.attendanceConsentVersion;
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

        const user = await prisma.users.findUnique({
          where: { email },
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
        };
      },
    }),
  ],
});
