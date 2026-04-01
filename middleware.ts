import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = ["/login", "/unauthorized", "/not-ready", "/api/auth", "/api/health"];
const PHASE1_BLOCKED = ["/support", "/planning", "/warehouse", "/operations", "/dispatcher"];

export default auth(function middleware(req) {
  const { pathname } = req.nextUrl;

  // Always allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow HMAC auto-import
  if (
    pathname === "/api/import/obd" &&
    req.headers.get("x-import-key-id") === "auto-import-v1"
  ) {
    return NextResponse.next();
  }

  // Phase 1 route guard
  if (PHASE1_BLOCKED.some((p) => pathname.startsWith(p))) {
    const role = req.auth?.user?.role;
    if (role && role !== "admin") {
      return NextResponse.redirect(new URL("/not-ready", req.url));
    }
  }

  // No session → redirect to login
  if (!req.auth) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
