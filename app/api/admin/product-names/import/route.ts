import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const body = await req.json() as { rows: Record<string, string>[] };
  const rows = body.rows ?? [];

  if (rows.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0, failed: 0, errors: [] });
  }

  const categories = await prisma.product_category.findMany({ select: { id: true, name: true } });
  const catMap = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

  const errors: { row: number; reason: string }[] = [];
  const data: { name: string; categoryId: number; isActive: boolean }[] = [];

  rows.forEach((r, i) => {
    const name     = r.name?.trim();
    const catName  = r.category?.trim();
    const catId    = catMap.get(catName?.toLowerCase() ?? "");

    if (!name)   { errors.push({ row: i + 2, reason: "Name is required." }); return; }
    if (!catId)  { errors.push({ row: i + 2, reason: `Category "${catName}" not found.` }); return; }

    data.push({ name, categoryId: catId, isActive: true });
  });

  const result = await prisma.product_name.createMany({
    data,
    skipDuplicates: true,
  });

  const imported = result.count;
  const skipped  = data.length - imported;

  return NextResponse.json({ imported, skipped, failed: errors.length, errors });
}
