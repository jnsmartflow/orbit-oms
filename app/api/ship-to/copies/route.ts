import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";
import { canEditBillingShipTo, canViewShipTo } from "@/lib/ship-to/access";
import { activeOwnCopiesWhere, billingCopiesVisibleWhere } from "@/lib/ship-to/copies-server";
import type { ShipToCopyOwner } from "@/lib/ship-to/copy";

export const dynamic = "force-dynamic";

/**
 * GET /api/ship-to/copies?moOrderId=N | ?orderId=N — the active dealer / SO
 * challan copies the shared ship-to modal shows (free-text ship-to P1,
 * 2026-10-19). READ-ONLY. Exactly one of the two params.
 *
 *   ?moOrderId — BILLING's view: the mail order's own copies.
 *   ?orderId   — FLOOR's view: the bill's own copies, plus the SO's Billing
 *                copies that still show on this bill (the one visibility rule,
 *                lib/ship-to/copies-server.ts billingCopiesVisibleWhere).
 *                Since v27.81 "the bill's own" = the OBD's own (orderInvoiceId
 *                NULL) — 0 part copies live, so the list is unchanged.
 *   &orderInvoiceId — (v27.81, per-part ship-to) ONE PART of that bill: the
 *                part's own copies, plus the bill's (own + Billing) ONLY while
 *                the part inherits (its shipToOverride is NULL).
 *
 * Each copy: { id, owner: "billing" | "floor", contentType, sizeBytes,
 * createdAt, uploadedByName, canRemove }. `canRemove` answers for THIS caller
 * on THIS desk: Billing removes Billing copies (mail_orders + billing_ship_to
 * canEdit); Floor removes the bill's own copies (floor canEdit) and NEVER a
 * Billing copy — the save routes refuse that with 403 whatever this says.
 *
 * Gate: mail_orders canView OR floor canView (lib/ship-to/access.ts).
 */

const COPY_SELECT = {
  id: true,
  contentType: true,
  sizeBytes: true,
  createdAt: true,
  uploadedBy: { select: { name: true } },
} as const;

function positiveIntParam(v: string | null): number | null {
  const t = v?.trim() ?? "";
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= 2147483647 ? n : null;
}

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  if (!(await canViewShipTo(roles))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const moOrderId = positiveIntParam(searchParams.get("moOrderId"));
  const orderId = positiveIntParam(searchParams.get("orderId"));
  if ((moOrderId === null) === (orderId === null)) {
    return NextResponse.json({ error: "Pass exactly one of moOrderId or orderId (positive integers)" }, { status: 400 });
  }

  type Row = { id: number; contentType: string; sizeBytes: number; createdAt: Date; uploadedBy: { name: string } | null };
  const shape = (r: Row, owner: ShipToCopyOwner, canRemove: boolean) => ({
    id: r.id,
    owner,
    contentType: r.contentType,
    sizeBytes: r.sizeBytes,
    createdAt: r.createdAt,
    uploadedByName: r.uploadedBy?.name ?? null,
    canRemove,
  });

  if (moOrderId !== null) {
    const mo = await prisma.mo_orders.findUnique({ where: { id: moOrderId }, select: { id: true } });
    if (!mo) return NextResponse.json({ error: "Mail order not found" }, { status: 404 });
    const rows = await prisma.ship_to_copies.findMany({
      where: activeOwnCopiesWhere("billing", moOrderId),
      select: COPY_SELECT,
      orderBy: { id: "asc" },
    });
    const canRemove = await canEditBillingShipTo(roles);
    return NextResponse.json({ copies: rows.map((r) => shape(r, "billing", canRemove)) });
  }

  // v27.81 — optional: one part of the bill (must be that bill's row).
  const rawPart = searchParams.get("orderInvoiceId");
  const partId = rawPart === null ? null : positiveIntParam(rawPart);
  if (rawPart !== null && partId === null) {
    return NextResponse.json({ error: "orderInvoiceId must be a positive integer" }, { status: 400 });
  }
  const part =
    partId === null
      ? null
      : await prisma.order_invoices.findFirst({ where: { id: partId, orderId: orderId! }, select: { id: true, shipToOverride: true } });
  if (partId !== null && part === null) return NextResponse.json({ error: "Invoice row not found on this bill" }, { status: 404 });
  const partInherits = part === null || part.shipToOverride === null;

  const bill = await prisma.orders.findFirst({
    where: { id: orderId!, isRemoved: false },
    select: { soNumber: true, shipToOverrideCustomerId: true, shipToText: true, shipToAreaId: true },
  });
  if (!bill) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // The OBD's own copies — shown on the bill, and on a part only while it inherits.
  const own = partInherits
    ? await prisma.ship_to_copies.findMany({
        where: activeOwnCopiesWhere("floor", orderId!, null),
        select: COPY_SELECT,
        orderBy: { id: "asc" },
      })
    : [];
  // A part's own copies (none unless a part is asked for).
  const partOwn =
    part !== null
      ? await prisma.ship_to_copies.findMany({
          where: activeOwnCopiesWhere("floor", orderId!, part.id),
          select: COPY_SELECT,
          orderBy: { id: "asc" },
        })
      : [];
  const billingWhere = partInherits ? billingCopiesVisibleWhere(bill) : null;
  const billing =
    billingWhere === null
      ? []
      : await prisma.ship_to_copies.findMany({ where: billingWhere, select: COPY_SELECT, orderBy: { id: "asc" } });
  const canRemoveOwn = await checkAnyPermission(roles, "floor", "canEdit");

  return NextResponse.json({
    copies: [
      ...billing.map((r) => shape(r, "billing", false)),
      ...own.map((r) => shape(r, "floor", canRemoveOwn)),
      ...partOwn.map((r) => shape(r, "floor", canRemoveOwn)),
    ],
  });
}
