import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// SO order access — grant, revoke, list (2026-09-30). Read and written ONLY by
// the superuser-gated /api/admin/so-access routes.
//
// 🔴 2026-09-30: SO order-access grant is deliberately NOT a PageKey — do not
// add one. A PageKey tick can be handed to anyone through /admin/access; this
// grant must stay superuser-only, and editing sales_officer_master must never
// grant it either (so_order_access is a separate table for exactly that).
//
// Rows are history: revoke stamps revokedAt/revokedById and never deletes; a
// re-grant is a NEW row. At most one live row per SO is enforced by the
// partial unique so_order_access_live_key (Schema v27.43).
// Sequential awaits only — never prisma.$transaction (CORE §3).

export type SoAccessRow = {
  salesOfficerId: number;
  name: string;
  employeeCode: string;
  email: string | null;
  isActive: boolean;
  granted: boolean;
  grantedByName: string | null;
  grantedAt: string | null;
  pastGrants: number;       // revoked rows — earlier grant/revoke cycles
  lastLoginAt: string | null; // MAX(so_sessions.lastSeenAt)
};

export async function listSoAccess(): Promise<SoAccessRow[]> {
  const officers = await prisma.sales_officer_master.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, employeeCode: true, email: true, isActive: true },
  });
  const grants = await prisma.so_order_access.findMany({
    select: {
      salesOfficerId: true,
      grantedAt: true,
      revokedAt: true,
      grantedBy: { select: { name: true } },
    },
  });
  const lastSeen = await prisma.so_sessions.groupBy({
    by: ["salesOfficerId"],
    _max: { lastSeenAt: true },
  });

  const lastSeenBySo = new Map<number, Date | null>();
  for (const r of lastSeen) lastSeenBySo.set(r.salesOfficerId, r._max.lastSeenAt);

  return officers.map((o) => {
    const mine = grants.filter((g) => g.salesOfficerId === o.id);
    const live = mine.find((g) => g.revokedAt === null) ?? null;
    const email = o.email && o.email.trim() ? o.email.trim() : null;
    const seen = lastSeenBySo.get(o.id) ?? null;
    return {
      salesOfficerId: o.id,
      name: o.name,
      employeeCode: o.employeeCode,
      email,
      isActive: o.isActive,
      granted: live !== null,
      grantedByName: live?.grantedBy.name ?? null,
      grantedAt: live ? live.grantedAt.toISOString() : null,
      pastGrants: mine.filter((g) => g.revokedAt !== null).length,
      lastLoginAt: seen ? seen.toISOString() : null,
    };
  });
}

export type GrantResult =
  | { ok: true }
  | { ok: false; status: 404 | 409 | 422; error: string };

export async function grantSoAccess(salesOfficerId: number, grantedById: number): Promise<GrantResult> {
  const so = await prisma.sales_officer_master.findUnique({
    where: { id: salesOfficerId },
    select: { isActive: true, email: true },
  });
  if (!so) return { ok: false, status: 404, error: "Sales officer not found." };
  if (!so.isActive) return { ok: false, status: 422, error: "This sales officer is inactive." };
  if (!so.email || !so.email.trim()) {
    return { ok: false, status: 422, error: "This sales officer has no email — add it in Sales Officers." };
  }

  try {
    await prisma.so_order_access.create({ data: { salesOfficerId, grantedById } });
  } catch (err) {
    // so_order_access_live_key (partial unique) — a live grant already exists.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, status: 409, error: "Already granted." };
    }
    throw err;
  }
  return { ok: true };
}

export type RevokeResult =
  | { ok: true; sessionsEnded: number }
  | { ok: false; status: 409; error: string; sessionsEnded: number };

/** Revokes the live grant AND ends every open session for that SO now.
 *  getSoSession re-checks eligibility on every read as well — both, on purpose. */
export async function revokeSoAccess(salesOfficerId: number, revokedById: number): Promise<RevokeResult> {
  const now = new Date();
  const revoked = await prisma.so_order_access.updateMany({
    where: { salesOfficerId, revokedAt: null },
    data: { revokedAt: now, revokedById },
  });
  const ended = await prisma.so_sessions.updateMany({
    where: { salesOfficerId, revokedAt: null, expiresAt: { gt: now } },
    data: { revokedAt: now },
  });
  if (revoked.count === 0) {
    return { ok: false, status: 409, error: "Not granted.", sessionsEnded: ended.count };
  }
  return { ok: true, sessionsEnded: ended.count };
}
