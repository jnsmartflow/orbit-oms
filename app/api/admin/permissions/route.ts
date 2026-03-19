import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const rows = await prisma.role_permissions.findMany({
    orderBy: [{ roleSlug: "asc" }, { pageKey: "asc" }],
  });

  return NextResponse.json(rows);
}

const updateSchema = z.object({
  updates: z.array(
    z.object({
      roleSlug:  z.string().min(1),
      pageKey:   z.string().min(1),
      canView:   z.boolean(),
      canImport: z.boolean(),
      canExport: z.boolean(),
      canEdit:   z.boolean(),
      canDelete: z.boolean(),
    })
  ),
});

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const updates = parsed.data.updates.map((row) => {
    if (row.roleSlug === "admin") {
      return { ...row, canView: true, canImport: true, canExport: true, canEdit: true, canDelete: true };
    }
    return row;
  });

  const rows = await prisma.$transaction(
    updates.map((row) =>
      prisma.role_permissions.upsert({
        where: { roleSlug_pageKey: { roleSlug: row.roleSlug, pageKey: row.pageKey } },
        create: {
          roleSlug:  row.roleSlug,
          pageKey:   row.pageKey,
          canView:   row.canView,
          canImport: row.canImport,
          canExport: row.canExport,
          canEdit:   row.canEdit,
          canDelete: row.canDelete,
        },
        update: {
          canView:   row.canView,
          canImport: row.canImport,
          canExport: row.canExport,
          canEdit:   row.canEdit,
          canDelete: row.canDelete,
        },
      })
    )
  );

  return NextResponse.json(rows);
}
