import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { loadPrintTrips, getPrintWorkTripIds, getPrintMarkerLatest } from "@/lib/billing/print";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/print/marker — the Print tab's cheap "has anything moved?"
 * probe (slice 9, 2026-09-15). Polled every 30s by BillingPrintMarkerProvider
 * for the Print pill's count and the tab's refetch.
 *
 *   count  — trips with copy work outstanding: the SAME number the list's
 *            `pending` holds. Never-copied trips are counted without loading
 *            them; only copied trips touched since their copy are loaded, to
 *            confirm they reopened (usually none).
 *   latest — lib/billing/print.ts getPrintMarkerLatest: one statement.
 *
 * `?scope=` and `?date=` are sent by the shared marker hook and ignored: the
 * count is all-dates, and a copy on any day moves trips.updatedAt.
 *
 * READ-ONLY — never add a write here (CORE §3). Gated on `billing_print` canView.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "billing_print", "canView");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const workIds = await getPrintWorkTripIds();
  // Split the work ids: never-copied ones count as they are; copied-and-touched
  // ones are loaded and counted only if they really reopened.
  const touched = workIds.length
    ? await prisma.trips.findMany({
        where: { id: { in: workIds }, billingCopiedAt: { not: null } },
        select: { id: true },
      })
    : [];
  const reopened = (await loadPrintTrips(touched.map((t) => t.id))).filter((t) => t.state === "reopened").length;
  const count = workIds.length - touched.length + reopened;

  const latest = await getPrintMarkerLatest();

  return NextResponse.json({ count, latest }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
