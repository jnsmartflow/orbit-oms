import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAllPermissionsForRoles, holdsReportTick } from "@/lib/permissions";
import { REPORT_CATALOG } from "@/components/reports/report-catalog";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/options — what the Reports popup needs when it opens:
 * the reports this person may see (REPORT_CATALOG filtered by holdsReportTick,
 * the same canView-OR-canExport rule the sidebar row uses), plus the lists
 * the visible panels need. READ-ONLY.
 *
 * Each list is read only when its report is listed, so nobody receives the
 * operator roster or the delivery types for a report they do not hold.
 * No ticks at all → `reports: []` and a 200; the popup shows its plain message.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const roles = session.user.roles ?? [session.user.role];
  const allPerms = await getAllPermissionsForRoles(roles);

  const reports = REPORT_CATALOG.filter((r) => holdsReportTick(allPerms, r.pageKey));
  const has = (id: string) => reports.some((r) => r.id === id);

  // Same list and order as the trip desk's options route
  // (app/api/floor/trips/options), read here because that route gates on
  // `floor` canEdit, which a reports holder need not have.
  const deliveryTypes = has("trip-detail")
    ? await prisma.delivery_type_master.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } })
    : [];

  // The Customise drawer's operator list — the query app/reports/page.tsx ran.
  const roster = has("tint-summary")
    ? await prisma.users.findMany({
        where: { isActive: true, userRoles: { some: { role: { name: "tint_operator" } } } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  return NextResponse.json(
    {
      userName: session.user.name ?? "",
      reports,
      deliveryTypes,
      roster,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
