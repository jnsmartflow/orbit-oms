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
  // POST/PATCH. So this is reference data for CREATING A CUSTOMER (the Sub-area dropdown, filtered by the chosen area),
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

  const subAreas = await prisma.sub_area_master.findMany({
    orderBy: [{ area: { name: "asc" } }, { name: "asc" }],
    include: { area: { select: { id: true, name: true } } },
  });

  return NextResponse.json(subAreas);
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  areaId: z.number().int().positive(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title (2026-09-06).
  //
  // ⚠ THIS ONE CHANGES THE RULE, NOT JUST THE MECHANISM. It read
  // requireSuperuser followed by a bypass+flag that nothing could reach (anyone
  // failing requireSuperuser was already redirected; anyone passing it was
  // admitted by checkPermission's own superuser arm). It is now
  // routes_areas/canEdit, matching its areas and routes siblings — the same
  // person today (Harsh holds every routes_areas flag and is the sole
  // superuser), a different rule tomorrow. Its own [id] PATCH and import are
  // still requireSuperuser, so sub-area CREATE is now looser than sub-area
  // EDIT. Flagged in the gate report as an owner decision; revert this one
  // block to requireSuperuser if that is the wrong half to have moved.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "routes_areas", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const subArea = await prisma.sub_area_master.create({
    data: parsed.data,
    include: { area: { select: { id: true, name: true } } },
  });

  // AFTER the create returns (audit RULE 2).
  await logAdminAction({
    userId: parseInt(session!.user.id, 10),
    entity: "sub_areas",
    entityId: String(subArea.id),
    action: "create",
    summary: `sub-area "${subArea.name}" created under area "${subArea.area.name}"`,
    after: { name: subArea.name, areaId: subArea.areaId, isActive: subArea.isActive },
  });

  return NextResponse.json(subArea, { status: 201 });
}
