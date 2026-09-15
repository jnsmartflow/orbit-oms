import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { copyTripInvoices } from "@/lib/billing/print";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/print/trip/[id]/copy — record a Copy on the Print tab
 * (slice 9, 2026-09-15).
 *
 * Body: `{ invoiceNos: string[] }` — exactly what the client just put on the
 * clipboard. The server recomputes the trip's copy set and records only if the
 * two match (lib/billing/print.ts copyTripInvoices); a trip that changed under
 * the screen is a 409 and nothing is written.
 *
 * 🔴 WRITES THE TRIP, NEVER AN ORDER ROW: `trips.billingCopiedAt` /
 * `billingCopiedById` and one `invoices_copied` activity row carrying the
 * numbers.
 *
 * A re-copy of a finished trip never reaches this route — its plain Copy writes
 * nothing. Should one arrive anyway it is a 200 with `changed: false`.
 *
 * Gated on `billing_print` canEdit. Sequential awaits (CORE §3).
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "billing_print", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const actorId = Number(session.user.id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const tripId = Number(params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return NextResponse.json({ error: "Invalid trip id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { invoiceNos?: unknown };
  if (
    !Array.isArray(body.invoiceNos) ||
    body.invoiceNos.length === 0 ||
    !body.invoiceNos.every((n) => typeof n === "string" && n.length > 0)
  ) {
    return NextResponse.json({ error: "invoiceNos must be a non-empty list of strings" }, { status: 400 });
  }

  const outcome = await copyTripInvoices({ tripId, invoiceNos: body.invoiceNos as string[], actorId });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  return NextResponse.json({
    changed: outcome.changed,
    tripNumber: outcome.tripNumber,
    invoiceNos: outcome.invoiceNos,
    billingCopiedAt: outcome.billingCopiedAt,
  });
}
