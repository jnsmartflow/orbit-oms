import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/ci/reasons — the reason picker's vocabulary (frame 7 of
 * docs/mockups/ci/supervisor.html).
 *
 * 🔴 THE LIST IS DATA, NOT CODE, AND MUST NEVER BE HARDCODED IN A COMPONENT.
 * It lives in `ci_reason_master` precisely so the depot can add, relabel or
 * retire a reason without a deploy (spec §3.1 — that is also why it is a master
 * table rather than a CHECK constraint). A copy in the client would go stale the
 * first time someone edits a row, and the phone would offer a reason the submit
 * route then refuses.
 *
 * ⚠ `isActive: true` ONLY. A retired reason must not be selectable on a NEW
 * return, while existing CIs keep pointing at it — which is why reasons are
 * retired by flag and NEVER deleted (`ci_returns.reasonId` is ON DELETE
 * RESTRICT, and `reasonLabel` is snapshotted beside it so a relabel never
 * rewrites history).
 *
 * Ordered by `sortOrder`. The client splits on `isPinned` for the divider —
 * three pinned above it, the rest under "More" — and that split is data too:
 * this route does not decide how many are pinned, it reports which ones are.
 *
 * READ-ONLY. Not one write in this file.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // canView, not canEdit: reading the vocabulary is not writing a return, and
  // billing's screen may want to render a reason filter later.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "ci", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const reasons = await prisma.ci_reason_master.findMany({
    where: { isActive: true },
    select: { id: true, code: true, label: true, sortOrder: true, isPinned: true },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ reasons });
}
