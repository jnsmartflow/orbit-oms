import { NextResponse } from "next/server";
import { getSoSession } from "@/lib/so-auth/session";
import { soLabStaffGate } from "@/lib/so-auth/staff-gate";

export const dynamic = "force-dynamic";

// GET /api/so-lab/auth/me — the logged-in SO's name + email, or 401.
// `reason: "no_so_session"` separates "no SO session" from the staff gate's
// own 401 (no staff login at all).
export async function GET(): Promise<NextResponse> {
  const denied = await soLabStaffGate();
  if (denied) return denied;

  const so = await getSoSession();
  if (!so) {
    return NextResponse.json({ ok: false, error: "Not logged in", reason: "no_so_session" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, name: so.name, email: so.email });
}
