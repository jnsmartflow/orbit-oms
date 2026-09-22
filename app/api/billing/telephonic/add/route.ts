import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { addTelephonicTag } from "@/lib/billing/telephonic";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/telephonic/add — body { soNumber, tag: "hold" | "ci" }.
 *
 * 400 — not a 10-digit SO number, or an unknown tag (plain message).
 * 409 — the SO already has a non-removed tag: { error, existingTag,
 *       addedByName, addedAt }.
 * 200 — { tag, applied }. `applied` is the applySoTagHolds summary when OBDs
 *       for the SO already existed (the late tag — it may have HELD a bill and
 *       raised a CI), else null.
 *
 * The user is ALWAYS the session user, never the body.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "billing_telephonic", "canEdit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { soNumber?: unknown; tag?: unknown };
  if (typeof body.soNumber !== "string" || typeof body.tag !== "string") {
    return NextResponse.json({ error: "soNumber and tag are required." }, { status: 400 });
  }

  const result = await addTelephonicTag({
    soNumber: body.soNumber,
    tag: body.tag,
    userId,
    now: new Date(),
  });
  if (!result.ok) {
    if (result.status === 400) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(
      {
        error: result.error,
        existingTag: result.existingTag,
        addedByName: result.addedByName,
        addedAt: result.addedAt,
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ tag: result.tag, applied: result.applied });
}
