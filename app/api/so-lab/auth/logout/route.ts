import { NextResponse } from "next/server";
import { clearSoSessionCookie, revokeCurrentSoSession } from "@/lib/so-auth/session";
import { soLabStaffGate } from "@/lib/so-auth/staff-gate";

export const dynamic = "force-dynamic";

// POST /api/so-lab/auth/logout — revokes the SO session server-side (revokedAt
// = now) and clears the cookie. Idempotent: no cookie is still { ok: true }.
export async function POST(): Promise<NextResponse> {
  const denied = await soLabStaffGate();
  if (denied) return denied;

  await revokeCurrentSoSession();
  const res = NextResponse.json({ ok: true });
  clearSoSessionCookie(res);
  return res;
}
