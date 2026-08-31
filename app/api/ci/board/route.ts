import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getCiBillingBoard, getCiSupervisorBoard } from "@/lib/ci/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/ci/board — both CI faces off ONE route.
 *
 *   ?face=billing[&date=YYYY-MM-DD]  → CiBillingBoard    (one IST day, one rail)
 *   ?face=supervisor                 → CiSupervisorBoard (his Submitted tab)
 *
 * The branch copies app/api/mrn/board/route.ts, including its VALIDATE-NEVER-
 * COERCE stance: an unrecognised or contradictory param returns 400 rather than
 * being quietly ignored, because a caller that asked the wrong question and got
 * a plausible answer has no way to notice.
 *
 * READ-ONLY. Not one write in this file — no update, no upsert, no log row.
 *
 * 🔴 EVERY BAND FILTERS `status <> 'draft'` and `isVoided = false`, inside
 * lib/ci/queries.ts's WHERE builders. A draft exists only between the header
 * insert and the number allocation; if a null-numbered card ever appears on
 * either face, the filter is missing, not the number.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "ci", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(req.url);
  const faceParam = searchParams.get("face")?.trim() || undefined;
  const dateParam = searchParams.get("date")?.trim() || undefined;

  // `face` is REQUIRED. There is no sensible default: the two faces answer
  // different questions with different shapes, so guessing one would hand a
  // caller a payload it cannot render.
  if (faceParam !== "billing" && faceParam !== "supervisor") {
    return NextResponse.json(
      {
        error:
          faceParam === undefined
            ? '`face` is required — expected "billing" or "supervisor"'
            : `Invalid face "${faceParam}" — expected "billing" or "supervisor"`,
      },
      { status: 400 },
    );
  }

  if (faceParam === "supervisor") {
    // Contradictory request: the supervisor's outstanding band spans ALL dates
    // (a CI handed to billing yesterday is still his to see), so a `date` here
    // would be silently ignored. Reject it, exactly as the MRN board rejects
    // `date` alongside face=supervisor.
    if (dateParam !== undefined) {
      return NextResponse.json(
        { error: "`date` is not accepted with face=supervisor (the band spans all dates)" },
        { status: 400 },
      );
    }

    // ⚠ SCOPED TO THE VIEWER — spec §11.5 ("does Submitted show other
    // supervisors' CIs, or only his own?") is an OPEN DECISION, and the mockup
    // draws his own. The scope is resolved SERVER-SIDE from the session and is
    // never accepted as a parameter: a supervisorId in the query string would
    // let any holder of `ci` read any other supervisor's returns. The rule
    // itself lives in buildCiSupervisorWhere(), so answering §11.5 the other
    // way is one line there.
    const viewerId = Number(session.user.id);
    if (!Number.isInteger(viewerId) || viewerId <= 0) {
      return NextResponse.json({ error: "Session has no usable user id" }, { status: 401 });
    }

    const result = await getCiSupervisorBoard(viewerId);
    return NextResponse.json(result);
  }

  // face === "billing"
  try {
    // Omitted `date` → today IST, resolved inside getCiBillingBoard(). A
    // malformed or impossible date makes assertCiDate() throw, surfacing as a
    // clean 400 below instead of a silently-different day. Sequential awaits
    // only — never prisma.$transaction (CORE §3).
    const result = await getCiBillingBoard(dateParam);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid date" },
      { status: 400 },
    );
  }
}
