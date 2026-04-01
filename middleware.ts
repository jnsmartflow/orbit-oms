import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = ["/login", "/unauthorized", "/not-ready", "/api/auth", "/api/health"];

// Routes blocked for non-admin users in Phase 1
const PHASE1_BLOCKED = ["/support", "/planning", "/warehouse", "/operations", "/dispatcher"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow HMAC auto-import requests through before session check
  if (
    pathname === "/api/import/obd" &&
    req.headers.get("x-import-key-id") === "auto-import-v1"
  ) {
    return NextResponse.next();
  }

  // Phase 1 route guard — block non-admin users from unrolled-out sections
  if (PHASE1_BLOCKED.some((p) => pathname.startsWith(p))) {
    const session = (req as any).auth;
    const role = session?.user?.role;
    if (role && role !== "admin") {
      return NextResponse.redirect(new URL("/not-ready", req.url));
    }
  }

  return (auth as any)(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
