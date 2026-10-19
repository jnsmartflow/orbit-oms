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

  const bill = await prisma.orders.findFirst({
    where: { id: orderId!, isRemoved: false },
    select: { soNumber: true, shipToOverrideCustomerId: true, shipToText: true, shipToAreaId: true },
  });
  if (!bill) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const own = await prisma.ship_to_copies.findMany({
    where: activeOwnCopiesWhere("floor", orderId!),
    select: COPY_SELECT,
    orderBy: { id: "asc" },
  });
  const billingWhere = billingCopiesVisibleWhere(bill);
  const billing =
    billingWhere === null
      ? []
      : await prisma.ship_to_copies.findMany({ where: billingWhere, select: COPY_SELECT, orderBy: { id: "asc" } });
  const canRemoveOwn = await checkAnyPermission(roles, "floor", "canEdit");

  return NextResponse.json({
    copies: [...billing.map((r) => shape(r, "billing", false)), ...own.map((r) => shape(r, "floor", canRemoveOwn))],
  });
}
