// lib/challan-orders/access.ts
//
// The ONE gate of the shared Challan orders screen's routes (Challan orders
// slice 5, 2026-10-07). One page key for all three mounts (D8): canView reads,
// canEdit pastes / unlinks. Returns the session user id, or a ready response.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";

export async function challanOrdersGate(
  need: "canView" | "canEdit",
): Promise<{ ok: true; userId: number } | { ok: false; res: NextResponse }> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, res: NextResponse.json({ ok: false, code: "UNAUTHORIZED", error: "Unauthorized" }, { status: 401 }) };
  }
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "challan_orders", need))) {
    return {
      ok: false,
      res: NextResponse.json(
        {
          ok: false,
          code: "FORBIDDEN",
          error: need === "canEdit" ? "Only Billing can link SOs to challan orders." : "Forbidden",
        },
        { status: 403 },
      ),
    };
  }
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return { ok: false, res: NextResponse.json({ ok: false, code: "BAD_SESSION", error: "Invalid session user id" }, { status: 500 }) };
  }
  return { ok: true, userId };
}
