import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LAST_SEEN_THROTTLE_MS, SESSION_TTL_MS, SO_SESSION_COOKIE } from "./constants";
import { findEligibleSoById, type EligibleSo } from "./eligibility";

// Server-side SO sessions. The cookie holds a random token; so_sessions holds
// only its SHA-256 hash, so a database read never yields a usable cookie.
// Sequential awaits only — never prisma.$transaction (CORE §3).

/** A new session token for the cookie: 32 random bytes, base64url. */
function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What is stored in so_sessions.tokenHash — SHA-256 hex of the cookie token. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Creates the so_sessions row and sets the cookie on `res`. */
export async function createSoSession(
  res: NextResponse,
  salesOfficerId: number,
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  const token = newSessionToken();
  const now = new Date();
  await prisma.so_sessions.create({
    data: {
      tokenHash: hashToken(token),
      salesOfficerId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      ip: meta.ip,
      userAgent: meta.userAgent ? meta.userAgent.slice(0, 500) : null,
    },
  });
  res.cookies.set(SO_SESSION_COOKIE, token, cookieOptions(Math.floor(SESSION_TTL_MS / 1000)));
}

export function clearSoSessionCookie(res: NextResponse): void {
  res.cookies.set(SO_SESSION_COOKIE, "", cookieOptions(0));
}

function readTokenHash(): string | null {
  const token = cookies().get(SO_SESSION_COOKIE)?.value;
  return token ? hashToken(token) : null;
}

/**
 * The current SO, or null. Cookie → hash → so_sessions row (not revoked, not
 * expired) → eligibility (active SO + live grant) → lastSeenAt bumped.
 * A session whose SO has lost eligibility is REVOKED here, so a revoked grant
 * or a deactivated SO ends the session on its next request.
 *
 * 🔴 2026-10-01: lastSeenAt throttled to 10 min — do not write on every call.
 * Every board API runs through this, so an unconditional bump would make every
 * read a DB write (the 2026-09-29 Disk IO outage). The bump is a conditional
 * updateMany (WHERE lastSeenAt < now − 10 min), so it writes at most once per
 * session per 10 minutes. "Last login" on /admin/so-access is accurate to 10 min.
 */
export async function getSoSession(): Promise<EligibleSo | null> {
  const tokenHash = readTokenHash();
  if (!tokenHash) return null;

  const now = new Date();
  const row = await prisma.so_sessions.findUnique({
    where: { tokenHash },
    select: { id: true, salesOfficerId: true, expiresAt: true, revokedAt: true, lastSeenAt: true },
  });
  if (!row || row.revokedAt || row.expiresAt <= now) return null;

  const so = await findEligibleSoById(row.salesOfficerId);
  if (!so) {
    await prisma.so_sessions.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: now },
    });
    return null;
  }

  const staleBefore = new Date(now.getTime() - LAST_SEEN_THROTTLE_MS);
  if (row.lastSeenAt < staleBefore) {
    await prisma.so_sessions.updateMany({
      where: { id: row.id, lastSeenAt: { lt: staleBefore } },
      data: { lastSeenAt: now },
    });
  }
  return so;
}

/** Revokes the session the cookie points at (if any). Idempotent. */
export async function revokeCurrentSoSession(): Promise<void> {
  const tokenHash = readTokenHash();
  if (!tokenHash) return;
  await prisma.so_sessions.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
