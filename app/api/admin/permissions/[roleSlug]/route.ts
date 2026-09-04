import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireSuperuser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { roleSlug: string } }
) {
  const session = await auth();
  requireSuperuser(session);

  const rows = await prisma.role_permissions.findMany({
    where: { roleSlug: params.roleSlug },
    orderBy: { pageKey: "asc" },
  });

  return NextResponse.json(rows);
}
