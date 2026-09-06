import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { z } from "zod";
import { checkAnyPermission } from "@/lib/permissions";

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title (2026-09-06).
  //
  // 🔴 customers/canEdit, DELIBERATELY NOT routes_areas/canView. Read this
  // before 'correcting' the key to the one that matches the table name.
  //
  // This GET has exactly ONE caller in the whole app:
  // components/shared/customer-missing-sheet.tsx:162-165, the missing-customer
  // form on the Tint Manager board. The admin Routes/Areas/Sub-areas tables do
  // NOT call it — their list data arrives as server props, and they only ever
  // POST/PATCH. So this is reference data for CREATING A CUSTOMER (the Route dropdown behind the selected area),
  // not for managing routes, and customers/canEdit is the permission the caller
  // actually represents.
  //
  // The old gate let tint_manager and support SKIP the flag entirely, which is
  // how Chandresh Kolgha reached it holding no routes_areas tick. Verified live
  // 2026-09-06: tint_manager/canView (who can open the sheet) and
  // customers/canEdit are the SAME three people — Harsh, Chandresh, Prakash —
  // so this key covers the caller exactly. routes_areas/canView is held by
  // Harsh alone and would have broken the sheet for Chandresh AND Prakash;
  // granting it to them would also have put a Routes item in their sidebar,
  // because buildNavItems reads the same tick.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "customers", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const routes = await prisma.route_master.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { areaRoutes: true } } },
  });

  return NextResponse.json(
    routes.map((r) => ({ ...r, areaCount: r._count.areaRoutes, _count: undefined }))
  );
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title (2026-09-06). The role array only narrowed
  // ahead of a flag that already decided, so deleting it changes nobody: on this
  // key every role it named either holds the tick or was refused by the flag.
  // Both superuser arms live inside checkAnyPermission.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "routes_areas", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const existing = await prisma.route_master.findFirst({
    where: { name: { equals: parsed.data.name, mode: "insensitive" } },
  });
  if (existing) {
    return NextResponse.json({ error: "Route name already exists." }, { status: 409 });
  }

  const route = await prisma.route_master.create({
    data: { name: parsed.data.name, description: parsed.data.description ?? null },
    include: { _count: { select: { areaRoutes: true } } },
  });

  // AFTER the create returns (audit RULE 2).
  await logAdminAction({
    userId: parseInt(session!.user.id, 10),
    entity: "routes",
    entityId: String(route.id),
    action: "create",
    summary: `route "${route.name}" created`,
    after: { name: route.name, description: route.description, isActive: route.isActive },
  });

  return NextResponse.json({ ...route, areaCount: route._count.areaRoutes, _count: undefined }, { status: 201 });
}
