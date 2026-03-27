import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Create an Edge-compatible auth instance from the Edge-safe config only.
// This does NOT import lib/auth.ts, avoiding Prisma and bcrypt which use
// Node.js APIs unavailable in the Edge Runtime.
const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = ["/login", "/unauthorized", "/api/auth"];

// Outer middleware — runs before NextAuth
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow HMAC auto-import requests through before session check.
  // Header name is lowercased by the Edge runtime.
  // Full HMAC-SHA256 verification happens inside handleAutoImport.
  if (
    pathname === "/api/import/obd" &&
    req.headers.get("x-import-key-id") === "auto-import-v1"
  ) {
    return NextResponse.next();
  }

  // All other routes go through NextAuth session check
  return (auth as any)(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
