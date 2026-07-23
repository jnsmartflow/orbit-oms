import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getFloorCancelled } from "@/lib/floor/queries";
import type { FloorScope } from "@/lib/floor/types";

export const dynamic = "force-dynamic";

const SCOPES: FloorScope[] = ["All", "Local", "Upcountry", "IGT"];
function parseScope(v: string | null): FloorScope {
  return (SCOPES as string[]).includes(v ?? "") ? (v as FloorScope) : "All";
}

// GET /api/floor/cancelled?scope=All|Local|Upcountry|IGT — today's cancelled
// bills (design §9), newest-cancelled first.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canView");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const scope = parseScope(new URL(req.url).searchParams.get("scope"));
  const rows = await getFloorCancelled(scope);
  return NextResponse.json({ scope, rows, count: rows.length });
}
