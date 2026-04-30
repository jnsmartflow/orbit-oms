import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "@/auth.config";

// ── Validation schema ──────────────────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ── Full NextAuth config — Node.js runtime only ───────────────────────────────
// Spreads the Edge-compatible authConfig and adds the Credentials provider
// which requires Prisma + bcrypt (not available in Edge Runtime).
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
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
