import type { NextAuthConfig, DefaultSession } from "next-auth";

// ── Type augmentation (lives here so auth.config is the single source of truth)
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
    } & DefaultSession["user"];
  }
  interface User {
    role: string;
  }
}

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
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = (token.id as string | undefined) ?? "";
        session.user.role = (token.role as string | undefined) ?? "";
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
