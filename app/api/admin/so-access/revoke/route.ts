import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isSuperuser } from "@/lib/rbac";
import { revokeSoAccess } from "@/lib/so-auth/access";

export const dynamic = "force-dynamic";

// POST /api/admin/so-access/revoke  { salesOfficerId }
// SUPERUSER ONLY, and deliberately NOT a PageKey (lib/so-auth/access.ts header).
// Revokes the live grant (never deletes) AND ends the SO's open sessions now;
// answers with how many sessions were ended.
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isSuperuser(session)) {
    return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
  }

  const userId = parseInt(session.user.id, 10);
  let body: unknown = null;
  try { body = await req.json(); } catch { body = null; }
  const soId = (body as { salesOfficerId?: unknown } | null)?.salesOfficerId;
  if (!Number.isInteger(soId) || (soId as number) <= 0 || !Number.isFinite(userId)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const result = await revokeSoAccess(soId as number, userId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, sessionsEnded: result.sessionsEnded },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, sessionsEnded: result.sessionsEnded });
}
