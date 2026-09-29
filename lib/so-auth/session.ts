import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SESSION_TTL_MS, SO_SESSION_COOKIE } from "./constants";
import { hashToken, newSessionToken } from "./crypto";
import { findEligibleSoById, type EligibleSo } from "./eligibility";

// Server-side SO sessions. The cookie holds a random token; so_sessions holds
// only its SHA-256 hash, so a database read never yields a usable cookie.
// Sequential awaits only — never prisma.$transaction (CORE §3).

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
 */
export async function getSoSession(): Promise<EligibleSo | null> {
  const tokenHash = readTokenHash();
  if (!tokenHash) return null;

  const now = new Date();
  const row = await prisma.so_sessions.findUnique({
    where: { tokenHash },
    select: { id: true, salesOfficerId: true, expiresAt: true, revokedAt: true },
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

  await prisma.so_sessions.update({
    where: { id: row.id },
    data: { lastSeenAt: now },
  });
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
