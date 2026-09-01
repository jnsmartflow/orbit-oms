import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/mrn/[mrnId]/delete — billing removes an MRN.
 *
 * 🔴 SOFT DELETE ONLY. Sets isRemoved / removedAt / removedById. The row is
 * NEVER deleted and nothing cascades: the lines and their batches stay exactly
 * where they are, attached to a row that no longer renders.
 *
 * 🔴 THE NUMBER IS NEVER REUSED, and this is the half that is easy to get
 * wrong later. A removed MRN still owns its `mrnNumber` and its
 * (mrnDate, srNo) pair under two live UNIQUE indexes — which is precisely why
 * the two allocators in lib/mrn/number.ts deliberately COUNT removed rows
 * instead of filtering them. Hard-deleting here, or teaching the allocators to
 * skip removed rows, would hand the next truck a number a deleted one still
 * holds and throw a P2002 on a screen where the operator did nothing wrong.
 * These two files are a pair; do not change one without the other
 * (design §7 / §11 OQ-8, the challan-sequence trap in CORE §13).
 *
 * 🔴 409 UNLESS status === 'open' (§11 OQ-8). Once the supervisor has started,
 * there is a record of who opened the truck and what was counted; removing it
 * out from under him would destroy that.
 *
 * Gated on canDelete, NOT canEdit — floor_supervisor and operations both hold
 * canDelete FALSE by design (§11 OQ-11: they can open and record, but the
 * report and its removal stay billing's). billing_operator holds it true.
 *
 * ONE write. No ordering question arises and no partial state is possible.
 *
 * No audit row is written, deliberately: MRN has no log table in v1 and needs
 * none — removedAt/removedById on the row itself IS the record, the same way
 * the mockup's "Activity" tab is derived from timestamps already on the row.
 * MRN is standalone and touches nothing in the orders pipeline (design §1), so
 * order_status_logs is not its log either.
 */
export async function POST(
  _req: Request,
  { params }: { params: { mrnId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 🔴 canDelete — the one route in this step that is not canEdit.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mrn", "canDelete");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // session.user.id is a string (lib/auth.ts). Require a real positive integer
  // so an absent id can never be written as removedById: 0 — the record of WHO
  // removed it is the only thing this write leaves behind.
  const removedById = Number(session.user.id);
  if (!Number.isInteger(removedById) || removedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  // Identical path-segment validation to app/api/mrn/[mrnId]/route.ts.
  const raw = params.mrnId?.trim() ?? "";
  const mrnId = Number(raw);
  if (!/^\d+$/.test(raw) || mrnId <= 0 || mrnId > 2147483647) {
    return NextResponse.json(
      { error: `Invalid mrnId "${params.mrnId}" — expected a positive integer` },
      { status: 400 },
    );
  }

  // isRemoved: false — an already-removed MRN 404s rather than being removed
  // twice, which would overwrite the original removedAt/removedById and lose
  // the record of who actually did it.
  const existing = await prisma.mrn.findFirst({
    where: { id: mrnId, isRemoved: false },
    select: { status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "MRN not found" }, { status: 404 });
  }
  if (existing.status !== "open") {
    return NextResponse.json(
      {
        error:
          existing.status === "checking"
            ? "The supervisor is checking this truck — it can no longer be removed."
            : "This MRN is finished — it can no longer be removed.",
      },
      { status: 409 },
    );
  }

  const removed = await prisma.mrn.update({
    where: { id: mrnId },
    data: {
      isRemoved: true,
      removedAt: new Date(),
      removedById,
    },
    select: { id: true, mrnNumber: true, isRemoved: true, removedAt: true },
  });

  return NextResponse.json(removed);
}
