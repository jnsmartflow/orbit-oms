import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = [
  "/login",
  "/unauthorized",
  "/not-ready",
  "/api/auth",
  "/api/health",
  // ⚠ KEEP — /order was RETIRED 2026-07-27 (archive/2026-07-order/), and the
  // address is deliberately PARKED for possible future reuse with NO redirect.
  // This entry stays for two separate reasons:
  //   1. Middleware runs before the page. Without it, /order stops being public
  //      and an anonymous visitor gets a LOGIN PROMPT instead of a clean 404 —
  //      a dead end that reads as a broken login, not a retired page.
  //   2. The check at line 26 is startsWith(), a PREFIX match — so this one
  //      entry also keeps /orders (with an s) public. Deleting it would put
  //      /orders behind auth as an unintended side effect.
  // It looks like junk because its page is gone. It is not. See the archive README.
  "/order",
  "/api/order",
  "/po",              // new public mobile order page (Phase 1) — reuses /api/order/data (already public above)
  "/demo",            // rewrites to /order-demo.html (matcher catches the rewritten URL via the dot rule, but the original /demo arrives here first)
  "/order-demo.html", // explicit safety net — matcher already excludes paths with file extensions
];
const PHASE1_BLOCKED: string[] = [];

export default auth(function middleware(req) {
  const { pathname } = req.nextUrl;

  // Always allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Cron endpoints carry their own Bearer-token auth (lib/cron-auth.ts).
  // Skip the session-redirect path so Vercel Cron isn't bounced to /login.
  if (pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }

  // Allow HMAC auto-import (v1: auto-import-v1, v2: auto-import-json-v1)
  const importKeyId = req.headers.get("x-import-key-id");
  if (
    pathname === "/api/import/obd" &&
    (importKeyId === "auto-import-v1" || importKeyId === "auto-import-json-v1")
  ) {
    return NextResponse.next();
  }

  // Allow HMAC mail-order ingest
  if (pathname === "/api/mail-orders/ingest" && req.headers.get("x-hmac-signature")) {
    return NextResponse.next();
  }

  // Allow public keyword lookup (parser startup cache)
  if (pathname === "/api/mail-orders/keywords") {
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
  // Skip middleware for Next.js internals AND any path with a file extension
  // (e.g. .html, .png, .css, .js, .ico) so static files in /public/ bypass
  // auth automatically. Routed paths and API endpoints have no extension and
  // still flow through.
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};
