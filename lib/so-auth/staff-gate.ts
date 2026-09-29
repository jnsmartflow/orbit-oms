import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isSuperuser } from "@/lib/rbac";

// TEST-PHASE LOCK for every /api/so-lab route: a superuser STAFF session is
// required before any SO logic runs. JSON 401/403, the pattern of
// app/api/admin/hide/rules/route.ts — never requireSuperuser, which redirects
// (a fetch would follow it into an HTML page that arrives 200).
// It is also what makes TEST_MODE_SHOW_CODE safe. Lift it only when real email
// sending ships and TEST_MODE_SHOW_CODE is false.

/** Returns a response to send back when the caller is not a superuser, else null. */
export async function soLabStaffGate(): Promise<NextResponse | null> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isSuperuser(session)) {
    return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
  }
  return null;
}

/** Client IP as Vercel forwards it (first x-forwarded-for hop). */
export function requestIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    null
  );
}
