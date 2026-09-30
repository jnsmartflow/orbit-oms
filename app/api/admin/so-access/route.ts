import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isSuperuser } from "@/lib/rbac";
import { listSoAccess } from "@/lib/so-auth/access";

export const dynamic = "force-dynamic";

// GET /api/admin/so-access — every sales officer with their order-access state.
// SUPERUSER ONLY, and deliberately NOT a PageKey (lib/so-auth/access.ts header).
// JSON 401/403 — never requireSuperuser, which redirects.
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isSuperuser(session)) {
    return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
  }

  const rows = await listSoAccess();
  return NextResponse.json({ ok: true, rows });
}
