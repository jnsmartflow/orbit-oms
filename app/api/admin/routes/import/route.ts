import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireSuperuser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  requireSuperuser(session);

  const body = await req.json() as { rows: Record<string, string>[] };
  const rows = body.rows ?? [];

  if (rows.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0, failed: 0, errors: [] });
  }

  const data = rows
    .filter((r) => r.name?.trim())
    .map((r) => ({
      name:        r.name.trim(),
      description: r.description?.trim() || null,
      isActive:    true,
    }));

  const result = await prisma.route_master.createMany({
    data,
    skipDuplicates: true,
  });

  const imported = result.count;
  const skipped  = data.length - imported;

  // ONE line for the whole upload (audit RULE 6).
  await logAdminAction({
    userId: parseInt(session!.user.id, 10),
    entity: "routes",
    entityId: null,
    action: "import",
    summary: `imported ${imported} route(s) (${skipped} skipped) from ${rows.length} row(s)`,
    after: { rows: rows.length, imported, skipped },
  });

  return NextResponse.json({ imported, skipped, failed: 0, errors: [] });
}
