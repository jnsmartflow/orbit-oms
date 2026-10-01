import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getActiveDispatchWindows } from "@/lib/dispatch/windows";

export const dynamic = "force-dynamic";

/**
 * GET /api/tint/manager/dispatch-windows — the active dispatch windows for the
 * Tint Manager's slot picker and Slot column (2026-10-01, tabs build step 2).
 * READ-ONLY. → { windows: [{ id, windowTime, label }] }, Billing's shape.
 *
 * Gate: tint_manager canView — the Slot COLUMN shows a bill's window to anyone
 * who can open the screen; SETTING it is tint_slot's job on the actions route.
 * The query is lib/dispatch/windows.ts, shared with Billing's route.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canView");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const windows = await getActiveDispatchWindows();
  return NextResponse.json({ windows });
}
