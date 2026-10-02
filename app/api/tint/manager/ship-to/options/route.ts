import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/tint/manager/ship-to/options — what the Tint Manager's Add ship-to
 * form needs (2026-10-02). READ-ONLY.
 *
 *   (no params)      → { areas, salesOfficers } — active rows only
 *   ?similar=<name>  → { similar } — up to 5 ACTIVE master rows whose name
 *                      contains every main word of <name> (ILIKE). Info only:
 *                      the form shows them to avoid a duplicate, never links.
 *
 * Gate: customers canEdit — the same gate as the save (and the admin POST).
 */

// Words too common to say two customers are the same.
const STOP = new Set([
  "PVT", "PRIVATE", "LTD", "LIMITED", "LLP", "THE", "AND", "CO", "COMPANY", "M/S", "MS",
  "GROUP", "SITE", "PROJECT", "PROJECTS", "NEW",
]);

function mainWords(name: string): string[] {
  return name
    .toUpperCase()
    .split(/[^A-Z0-9/]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
}

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "customers", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const similarParam = new URL(req.url).searchParams.get("similar");
  if (similarParam !== null) {
    const words = mainWords(similarParam);
    if (words.length === 0) return NextResponse.json({ similar: [] });
    const similar = await prisma.delivery_point_master.findMany({
      where: {
        isActive: true,
        AND: words.map((w) => ({ customerName: { contains: w, mode: "insensitive" as const } })),
      },
      select: { id: true, customerCode: true, customerName: true, area: { select: { name: true } } },
      orderBy: { customerName: "asc" },
      take: 5,
    });
    return NextResponse.json({
      similar: similar.map((s) => ({ id: s.id, customerCode: s.customerCode, customerName: s.customerName, area: s.area.name })),
    });
  }

  const areas = await prisma.area_master.findMany({
    where:   { isActive: true },
    select:  { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const salesOfficers = await prisma.sales_officer_master.findMany({
    where:   { isActive: true },
    select:  { id: true, name: true, employeeCode: true, phone: true, email: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ areas, salesOfficers });
}
