import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/mrn/[mrnId]/end — the supervisor taps END UNLOADING.
 *
 * Writes status='done', unloadingEndAt=now, unloadingEndById=session.
 * ONE write, so no ordering question arises and no partial state is possible.
 *
 * 409 unless status === 'checking'. A double-tap therefore 409s on the second
 * call rather than restamping unloadingEndAt — the same guard shape as
 * app/api/picking/done/route.ts.
 *
 * 🔴 409 UNLESS EVERY LINE IS CHECKED, COUNTED SERVER-SIDE. The client's own
 * "18 of 18" is never trusted: the phone's copy can be seconds stale, and two
 * supervisors on the same truck (Checking is deliberately not scoped to the
 * viewer — design §11 OQ-6) means the board a supervisor is looking at may not
 * reflect what the other one has just done. This count is the authority. The
 * message names how many are outstanding, because "not all lines are checked"
 * on an 18-line sheet tells him nothing about where to look.
 *
 * ⚠ End is what makes everything land in billing AT ONCE (design §5). Billing
 * has had no live sync throughout — no progress bar, no partial values — so
 * this write is the first thing billing sees since Start. That is why the gate
 * is strict: a half-checked MRN marked done would surface in billing as a
 * complete receipt with silent holes in it, and the report is what gets signed.
 *
 * The marker: this write moves mrn.updatedAt (@updatedAt) AND moves the MRN
 * from Checking to Done, so both halves of the (count, latest) pair report it.
 * No extra propagation write here — adding one would fire a FALSE change on
 * every polling phone (CLAUDE_PICKING.md §10). The line-confirm route is the
 * only place in MRN that needs a bump, and it needs one because it writes to
 * mrn_lines alone.
 */
export async function POST(
  _req: Request,
  { params }: { params: { mrnId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // canEdit — floor_supervisor holds it true.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mrn", "canEdit");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // session.user.id is a string (lib/auth.ts). Require a real positive integer —
  // this id is the record of who closed the truck.
  const unloadingEndById = Number(session.user.id);
  if (!Number.isInteger(unloadingEndById) || unloadingEndById <= 0) {
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

  const existing = await prisma.mrn.findFirst({
    where: { id: mrnId, isRemoved: false },
    select: { status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "MRN not found" }, { status: 404 });
  }
  if (existing.status !== "checking") {
    return NextResponse.json(
      {
        error:
          existing.status === "open"
            ? "Tap Start unloading before finishing this truck."
            : "This MRN is already done.",
      },
      { status: 409 },
    );
  }

  // Two sequential counts, never prisma.$transaction (CORE §3). Counted here
  // rather than read off the client — see the header.
  const lineCount = await prisma.mrn_lines.count({ where: { mrnId } });
  const uncheckedCount = await prisma.mrn_lines.count({ where: { mrnId, isChecked: false } });

  // An MRN with no lines at all cannot be finished: there is nothing to have
  // unloaded, and marking it done would put an empty receipt in front of
  // billing. Billing can still paste lines — the MRN is 'checking', so the
  // lines route 409s; whoever started it early should have the status reset,
  // which is a v2 concern (there is no un-start in v1, OQ-7).
  if (lineCount === 0) {
    return NextResponse.json(
      { error: "This MRN has no lines — there is nothing to finish." },
      { status: 409 },
    );
  }

  if (uncheckedCount > 0) {
    return NextResponse.json(
      {
        error: `${uncheckedCount} of ${lineCount} line${lineCount === 1 ? "" : "s"} ${uncheckedCount === 1 ? "is" : "are"} still unchecked.`,
        lineCount,
        uncheckedCount,
      },
      { status: 409 },
    );
  }

  const ended = await prisma.mrn.update({
    where: { id: mrnId },
    data: {
      status: "done",
      unloadingEndAt: new Date(),
      unloadingEndById,
    },
    select: {
      id: true,
      mrnNumber: true,
      status: true,
      unloadingEndAt: true,
      unloadingEndBy: { select: { name: true } },
    },
  });

  return NextResponse.json(ended);
}
