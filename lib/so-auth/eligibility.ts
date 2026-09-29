import { prisma } from "@/lib/prisma";

// THE eligibility rule — one place, used when a code is requested, when it is
// verified, AND on every session read (getSoSession). An SO may log in only if:
//   1. a sales_officer_master row matches the email (lower + trim),
//   2. that row is isActive = true, and
//   3. a so_order_access row for it has revokedAt IS NULL.
// Revoking the grant or deactivating the SO therefore ends every existing
// session on its next request.

export type EligibleSo = { salesOfficerId: number; name: string; email: string };

async function hasLiveGrant(salesOfficerId: number): Promise<boolean> {
  const grant = await prisma.so_order_access.findFirst({
    where: { salesOfficerId, revokedAt: null },
    select: { id: true },
  });
  return grant !== null;
}

/** By normalised email. sales_officer_master.email is @unique but
 *  case-sensitive, so the match is case-insensitive; more than one match is
 *  treated as NOT eligible rather than guessing which row is meant. */
export async function findEligibleSoByEmail(email: string): Promise<EligibleSo | null> {
  if (!email) return null;
  const rows = await prisma.sales_officer_master.findMany({
    where: { email: { equals: email, mode: "insensitive" }, isActive: true },
    select: { id: true, name: true, email: true },
    take: 2,
  });
  // Exact after trim — `equals` does not trim the stored value.
  const matches = rows.filter((r) => (r.email ?? "").trim().toLowerCase() === email);
  if (matches.length !== 1) return null;
  const so = matches[0];
  if (!(await hasLiveGrant(so.id))) return null;
  return { salesOfficerId: so.id, name: so.name, email };
}

/** By id — the session-read path. */
export async function findEligibleSoById(salesOfficerId: number): Promise<EligibleSo | null> {
  const so = await prisma.sales_officer_master.findUnique({
    where: { id: salesOfficerId },
    select: { id: true, name: true, email: true, isActive: true },
  });
  if (!so || !so.isActive || !so.email) return null;
  if (!(await hasLiveGrant(so.id))) return null;
  return { salesOfficerId: so.id, name: so.name, email: so.email.trim().toLowerCase() };
}
