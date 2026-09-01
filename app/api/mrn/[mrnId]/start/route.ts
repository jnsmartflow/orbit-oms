import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/mrn/[mrnId]/start — the supervisor taps START UNLOADING.
 *
 * Writes status='checking', unloadingStartAt=now, unloadingStartById=session.
 * ONE write, so no ordering question arises and no partial state is possible.
 *
 * 🔴 409 UNLESS status === 'open'. THERE IS NO TAKEOVER IN v1 (design §11
 * OQ-7). The row carries exactly ONE unloadingStartById and ONE start
 * timestamp, so a second supervisor tapping Start would silently overwrite the
 * only record of who opened the truck. The 409 below therefore NAMES HIM and
 * gives the time — "conflict" alone would tell the second supervisor nothing he
 * can act on, and on a shared floor the useful answer is always "Ramesh has
 * it".
 *
 * ⚠ THIS IS ALSO THE MOMENT BILLING LOSES EDIT RIGHTS, and the coupling is
 * worth seeing from both ends. Nothing extra is written here to enforce it:
 * app/api/mrn/[mrnId]/header, .../lines and .../delete each already 409 on
 * `status !== 'open'`, so moving the status to 'checking' locks all three in
 * one stroke. Design §5 removed the "Send to supervisor" button precisely so
 * that START is the single lock — if a future session adds another billing
 * write route, it must carry the same `status === 'open'` guard or it will
 * quietly stay editable while the supervisor is counting.
 *
 * The marker: this write moves mrn.updatedAt (@updatedAt) AND moves the MRN
 * between two tabs, so both halves of the (count, latest) pair report it. No
 * extra propagation write is needed here — unlike the line-confirm route, which
 * writes only to mrn_lines. See app/api/mrn/[mrnId]/line/[lineId]/route.ts.
 */
export async function POST(
  _req: Request,
  { params }: { params: { mrnId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // canEdit — floor_supervisor holds it true, which is the whole point of this
  // route. Same gate + admin bypass shape as the step-5 billing write routes.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mrn", "canEdit");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // session.user.id is a string (lib/auth.ts). Number("") is 0 and finite, so
  // require a real positive integer — this id IS the record of who opened the
  // truck, and OQ-7 exists to protect it.
  const unloadingStartById = Number(session.user.id);
  if (!Number.isInteger(unloadingStartById) || unloadingStartById <= 0) {
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
    select: {
      status: true,
      unloadingStartAt: true,
      unloadingStartBy: { select: { name: true } },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "MRN not found" }, { status: 404 });
  }

  if (existing.status !== "open") {
    // Name the holder and the time. IST, because the floor reads IST.
    const who = existing.unloadingStartBy?.name ?? "Another supervisor";
    const at = existing.unloadingStartAt
      ? existing.unloadingStartAt.toLocaleTimeString("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : null;

    return NextResponse.json(
      {
        error:
          existing.status === "checking"
            ? `${who} started unloading this truck${at ? ` at ${at}` : ""} — it cannot be started again.`
            : `This MRN is already ${existing.status === "closed" ? "closed" : "done"}${who !== "Another supervisor" ? ` — ${who} unloaded it` : ""}.`,
        startedByName: existing.unloadingStartBy?.name ?? null,
        startedAt: existing.unloadingStartAt,
      },
      { status: 409 },
    );
  }

  // Backstop: an MRN with no lines must not enter 'checking'. There is nothing
  // to check, and moving it there would 409 billing out of the lines route with
  // no un-start to recover (§11 OQ-7) — the truck would be stuck.
  //
  // Belt and braces, deliberately. buildMrnSupervisorWhere's `toCheck` branch
  // already keeps a line-less MRN off the phone entirely (lib/mrn/queries.ts),
  // so in normal use this never fires. It exists for the stale-list case: a
  // phone holding a list fetched before billing cleared the lines can still
  // fire Start at an MRN that has since emptied. The feed is the fix; this is
  // the guard for the race the feed cannot see.
  const lineCount = await prisma.mrn_lines.count({ where: { mrnId } });
  if (lineCount === 0) {
    return NextResponse.json(
      { error: "Billing has not added the lines for this MRN yet — there is nothing to check." },
      { status: 409 },
    );
  }

  const started = await prisma.mrn.update({
    where: { id: mrnId },
    data: {
      status: "checking",
      unloadingStartAt: new Date(),
      unloadingStartById,
    },
    select: {
      id: true,
      mrnNumber: true,
      status: true,
      unloadingStartAt: true,
      unloadingStartBy: { select: { name: true } },
    },
  });

  return NextResponse.json(started);
}
