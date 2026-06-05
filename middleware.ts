import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { istDateString } from "./lib/attendance/date";

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = [
  "/login",
  "/unauthorized",
  "/not-ready",
  "/api/auth",
  "/api/health",
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

  // Allow HMAC auto-import
  if (
    pathname === "/api/import/obd" &&
    req.headers.get("x-import-key-id") === "auto-import-v1"
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

  // Attendance gate (v27.1) — block authenticated users who haven't
  // checked in for today's IST date, when the rollout flag applies to
  // them. Logic mirrors gateAppliesTo() in lib/auth.ts; kept inline
  // (no import) so middleware stays Edge-clean.
  //
  // Always allow attendance routes themselves so the gate doesn't
  // trap users on the very screen they need to clear it.
  if (
    !pathname.startsWith("/attendance") &&
    !pathname.startsWith("/api/attendance")
  ) {
    const role = req.auth.user?.role;
    const stage = req.auth.user?.rolloutStage ?? "OFF";
    const isTest = req.auth.user?.attendanceTestUser ?? false;
    const isExempt = req.auth.user?.attendanceExempt ?? false;
    const lastCheckIn = req.auth.user?.lastCheckInDate ?? null;

    let gateApplies = false;
    if (stage === "OFF") gateApplies = false;
    else if (isExempt) gateApplies = false;
    else if (role === "admin") gateApplies = isTest;
    else if (stage === "TEST_USERS_ONLY") gateApplies = isTest;
    else if (stage === "ALL_USERS") gateApplies = true;

    if (gateApplies && lastCheckIn !== istDateString()) {
      return NextResponse.redirect(new URL("/attendance", req.url));
    }
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
