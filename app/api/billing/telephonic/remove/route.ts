import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { removeTelephonicTag } from "@/lib/billing/telephonic";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/telephonic/remove — body { id }. Soft-removes the tag;
 * idempotent (a second call returns { alreadyRemoved: true }). 404 when no such
 * tag. It does NOT release a held bill or void a CI — Floor's and billing's
 * jobs. The user is ALWAYS the session user, never the body.
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

  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
    return NextResponse.json({ error: "id must be a positive integer." }, { status: 400 });
  }

  const result = await removeTelephonicTag({ id, userId, now: new Date() });
  if (!result.ok) {
    // 'locked' — a mail-order CI tag; 409 with a code the tab can read.
    if (result.status === "locked") {
      return NextResponse.json({ error: result.error, code: "locked" }, { status: 409 });
    }
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ alreadyRemoved: result.alreadyRemoved });
}
