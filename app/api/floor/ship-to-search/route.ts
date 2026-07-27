import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/floor/ship-to-search?q=... — customer lookup for the detail panel's
// "Change ship-to" picker (CLAUDE_FLOOR.md §4.4). READ-ONLY: no writes anywhere.
//
// Support retirement step 2/8. Copied verbatim from
// app/api/support/ship-to-search/route.ts EXCEPT the auth gate, which now uses
// the floor pageKey (matching app/api/floor/board/route.ts) instead of Support's
// role list. Support's own route is untouched and still serves /support.
//
// The response is a BARE ARRAY, not an object — the caller
// (components/floor/detail-panel.tsx) reads it as ShipToResult[]. Do not wrap it.
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canView");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  // Under 2 characters: answer empty without touching the DB. The client also
  // guards this, but a short query would match half the master.
  if (q.length < 2) {
    return NextResponse.json([]);
  }

  const matches = await prisma.delivery_point_master.findMany({
    where: {
      customerName: { contains: q, mode: "insensitive" },
      isActive: true,
    },
    select: { id: true, customerName: true, area: { select: { name: true } } },
    take: 8,
    orderBy: { customerName: "asc" },
  });

  return NextResponse.json(
    matches.map((m) => ({ id: m.id, customerName: m.customerName, area: m.area?.name ?? null })),
  );
}
