import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// ── PATCH /api/admin/shades/[id] ───────────────────────────────────────────────
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.TINT_MANAGER, ROLES.TINT_OPERATOR]);

  const id = parseInt(params.id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { isActive } = body as { isActive?: unknown };

  if (typeof isActive !== "boolean") {
    return NextResponse.json({ error: "isActive (boolean) is required" }, { status: 400 });
  }

  const existing = await prisma.shade_master.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Shade not found" }, { status: 404 });
  }

  const updated = await prisma.shade_master.update({
    where: { id },
    data:  { isActive },
  });

  return NextResponse.json(updated);
}
