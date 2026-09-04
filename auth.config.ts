import type { NextAuthConfig, DefaultSession } from "next-auth";
import type { JWT } from "next-auth/jwt";

// ── Type augmentation (lives here so auth.config is the single source of truth)
export type RolloutStage = "OFF" | "TEST_USERS_ONLY" | "ALL_USERS";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      roles: string[];
      // Superuser flag (2026-09-04, step 5). OPTIONAL on purpose: a token
      // issued before this deploy carries no such claim, and `undefined` must
      // read as "not a superuser" rather than crash. That is safe precisely
      // because every gate ORs this with the `admin` role — an old token still
      // admits the owner on the role arm. See lib/rbac.ts.
      isSuperuser?: boolean;
      // Attendance gate claims (v27.1) — optional so absent token shape stays safe.
      attendanceTestUser?: boolean;
      attendanceExempt?: boolean;
      attendanceConsentVersion?: string | null;
      rolloutStage?: RolloutStage;
      rolloutStageStaleAt?: number;
      lastCheckInDate?: string | null;
    } & DefaultSession["user"];
  }
  interface User {
    role: string;
    roles: string[];
    isSuperuser: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    // Superuser flag — set on sign-in AND refreshed by the Node jwt callback in
    // lib/auth.ts on the same 5-minute stale window as the attendance claims,
    // so granting or revoking it lands without a re-login.
    isSuperuser?: boolean;
    // Attendance gate claims (v27.1) — set by Node jwt callback in lib/auth.ts.
    attendanceTestUser?: boolean;
    attendanceExempt?: boolean;
    attendanceConsentVersion?: string | null;
    rolloutStage?: RolloutStage;
    rolloutStageStaleAt?: number;
    lastCheckInDate?: string | null;
  }
}

// Re-export to keep the JWT type import alive (anchors the module augmentation
// above — `moduleResolution: "bundler"` won't pull next-auth/jwt's types
// without a referenced symbol).
export type { JWT };

// ── Edge-compatible config — no Prisma, no bcrypt ─────────────────────────────
// Providers that require Node.js (Credentials) are added only in lib/auth.ts.
export const authConfig: NextAuthConfig = {
  providers: [],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.roles = user.roles;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = (token.id as string | undefined) ?? "";
        session.user.role = (token.role as string | undefined) ?? "";
        session.user.roles = (token.roles as string[] | undefined) ?? [];
        // Absent on a pre-2026-09-04 token → undefined → falsy → the role arm
        // of every superuser gate carries it. Never default this to `true`.
        // `=== true` is the coercion, not a tidy-up: an absent claim must
        // become the boolean false, never undefined leaking onward.
        session.user.isSuperuser = token.isSuperuser === true;
        // Attendance gate claims (v27.1) — set by Node jwt callback in
        // lib/auth.ts. Pass through directly; absent on legacy tokens,
        // which the gate treats as default-off.
        session.user.attendanceTestUser = token.attendanceTestUser;
        session.user.attendanceExempt = token.attendanceExempt;
        session.user.attendanceConsentVersion = token.attendanceConsentVersion;
        session.user.rolloutStage = token.rolloutStage;
        session.user.rolloutStageStaleAt = token.rolloutStageStaleAt;
        session.user.lastCheckInDate = token.lastCheckInDate;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
