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

  const data = rows
    .filter((r) => r.name?.trim() && r.email?.trim())
    .map((r) => ({
      name:         r.name.trim(),
      email:        r.email.trim(),
      phone:        r.phone?.trim()        || null,
      employeeCode: r.employeecode?.trim() || "",
      isActive:     true,
    }));

  const result = await prisma.sales_officer_master.createMany({
    data,
    skipDuplicates: true,
  });

  const imported = result.count;
  const skipped  = data.length - imported;

  return NextResponse.json({ imported, skipped, failed: 0, errors: [] });
}
