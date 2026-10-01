import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isSuperuser } from "@/lib/rbac";
import { isSoPageOpen } from "./lock";

// TEST-PHASE LOCK for every /api/so-lab route. Since C.2a (2026-10-01) it is a
// SWITCH (lib/so-auth/lock.ts, app_settings 'so.page.open'): while the page is
// LOCKED — the default, and on any read error — a superuser STAFF session is
// required before any SO logic runs; once go-live opens it, this gate passes
// everyone through and the SO session (requireSoApi) is the only lock.
// JSON 401/403, the pattern of app/api/admin/hide/rules/route.ts — never
// requireSuperuser, which redirects (a fetch would follow it into an HTML page
// that arrives 200).

/** Returns a response to send back when the caller is locked out, else null. */
export async function soLabStaffGate(): Promise<NextResponse | null> {
  if (await isSoPageOpen()) return null;
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
