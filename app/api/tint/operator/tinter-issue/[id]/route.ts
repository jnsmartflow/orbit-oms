import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!hasRole(session, [ROLES.TINT_OPERATOR, ROLES.ADMIN])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Step 1 — Parse params
  const id = Number(params.id);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const { searchParams } = new URL(_req.url);
  const type = searchParams.get("type");

  if (type !== "split" && type !== "assignment") {
    return NextResponse.json(
      { error: "type must be split or assignment" },
      { status: 400 },
    );
  }

  // Step 2 — Query tinter_issue_entries
  const entries = await prisma.tinter_issue_entries.findMany({
    where: type === "split" ? { splitId: id } : { tintAssignmentId: id },
    select: {
      id:        true,
      baseSku:   true,
      tinQty:    true,
      YOX:       true,
      LFY:       true,
      GRN:       true,
      TBL:       true,
      WHT:       true,
      MAG:       true,
      FFR:       true,
      BLK:       true,
      OXR:       true,
      HEY:       true,
      HER:       true,
      COB:       true,
      COG:       true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Step 3 — Return (empty array is valid — not a 404)
  return NextResponse.json({ entries });
}
