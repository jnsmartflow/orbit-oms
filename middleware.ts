import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { NextResponse } from "next/server";

// Create an Edge-compatible auth instance from the Edge-safe config only.
// This does NOT import lib/auth.ts, avoiding Prisma and bcrypt which use
// Node.js APIs unavailable in the Edge Runtime.
const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = ["/login", "/unauthorized", "/api/auth"];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Always allow public paths through — no auth check
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Redirect unauthenticated users to login
  if (!req.auth) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
});

export const config = {
  // Run on all routes except Next.js internals and static files
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
