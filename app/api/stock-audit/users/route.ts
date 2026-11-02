import { NextResponse } from "next/server";
import { stockAuditGate } from "@/lib/stock-audit/gate";
import { getAssignableUsers } from "@/lib/stock-audit/queries";
import type { AssignableUser } from "@/lib/stock-audit/types";

export const dynamic = "force-dynamic";

// GET /api/stock-audit/users — who may be made a counter: active users who
// would pass stock_audit_count canView through the SAME resolver the app uses
// (checkAnyPermissionForUser in lib/permissions.ts). id + name only.
// Gate: stock_audit_manage canEdit (only someone who can assign needs the list).
export async function GET(): Promise<NextResponse> {
  const gate = await stockAuditGate("canEdit");
  if (!gate.ok) return gate.response;
  const users: AssignableUser[] = await getAssignableUsers();
  return NextResponse.json({ users }, { headers: { "Cache-Control": "no-store" } });
}
