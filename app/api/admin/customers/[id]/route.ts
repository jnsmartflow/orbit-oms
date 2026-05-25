import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { checkPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import {
  validateIncomingSalesOfficers,
  applyDismissalToggles,
  reconcileCustomerSalesOfficers,
  syncSalesOfficerContacts,
  enforcePrimaryContactRule,
  SoSyncValidationError,
} from "@/lib/customers/so-sync";

export const dynamic = 'force-dynamic';

const contactUpsertSchema = z.object({
  id:                   z.number().int().positive().optional(),
  name:                 z.string().min(1).max(100),
  phone:                z.string().max(30).optional().nullable(),
  email:                z.string().max(200).optional().nullable(),
  isPrimary:            z.boolean().default(false),
  contactRoleId:        z.number().int().positive().optional().nullable(),
  linkedSalesOfficerId: z.number().int().positive().optional().nullable(),
});

const salesOfficerLinkSchema = z.object({
  salesOfficerId: z.number().int().positive(),
  role:           z.enum(["PRIMARY", "BACKUP", "JUNIOR"]),
});

const dismissalToggleSchema = z.object({
  salesOfficerId: z.number().int().positive(),
  dismissed:      z.boolean(),
});

const patchSchema = z.object({
  customerCode:           z.string().min(1).max(50).optional(),
  customerName:           z.string().min(1).max(200).optional(),
  address:                z.string().max(500).optional().nullable(),
  areaId:                 z.number().int().positive().optional(),
  subAreaId:              z.number().int().positive().optional().nullable(),
  salesOfficerId:         z.number().int().positive().optional().nullable(),
  primaryRouteId:         z.number().int().positive().optional().nullable(),
  dispatchDeliveryTypeId:  z.number().int().positive().optional().nullable(),
  reportingDeliveryTypeId: z.number().int().positive().optional().nullable(),
  customerTypeId:          z.number().int().positive().optional().nullable(),
  premisesTypeId:          z.number().int().positive().optional().nullable(),
  salesOfficerGroupId:     z.number().int().positive().optional().nullable(),
  customerRating:         z.enum(["A", "B", "C"]).optional().nullable(),
  latitude:               z.number().optional().nullable(),
  longitude:              z.number().optional().nullable(),
  isKeyCustomer:          z.boolean().optional(),
  isKeySite:              z.boolean().optional(),
  acceptsPartialDelivery: z.boolean().optional(),
  isActive:               z.boolean().optional(),
  workingHoursStart:      z.string().max(10).optional().nullable(),
  workingHoursEnd:        z.string().max(10).optional().nullable(),
  noDeliveryDays:         z.array(z.string()).optional(),
  contacts:               z.array(contactUpsertSchema).optional(),
  // Phase 2 multi-SO sync
  salesOfficers:          z.array(salesOfficerLinkSchema).optional(),
  dismissalsToToggle:     z.array(dismissalToggleSchema).optional(),
});

const fullInclude = {
  area:                 { select: { id: true, name: true } },
  subArea:              { select: { id: true, name: true } },
  primaryRoute:         { select: { id: true, name: true } },
  dispatchDeliveryType:  { select: { id: true, name: true } },
  reportingDeliveryType: { select: { id: true, name: true } },
  customerType:          { select: { id: true, name: true } },
  premisesType:          { select: { id: true, name: true } },
  salesOfficerGroup:     { select: { id: true, name: true } },
  contacts:             { orderBy: [{ isPrimary: "desc" as const }, { id: "asc" as const }] },
  // Phase 2 — multi-SO links with nested SO master fields
  salesOfficerLinks: {
    orderBy: { createdAt: "asc" as const },
    include: {
      salesOfficer: { select: { id: true, name: true, phone: true } },
    },
  },
};

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.SUPPORT, ROLES.TINT_MANAGER, ROLES.TINT_OPERATOR, ROLES.FLOOR_SUPERVISOR]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "customers", "canView");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  try {
    const customer = await prisma.delivery_point_master.findUnique({
      where: { id },
      include: fullInclude,
    });
    if (!customer) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(customer);
  } catch (err) {
    console.error("GET /api/admin/customers/[id] error:", err);
    return NextResponse.json({ error: "Failed to load customer." }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.SUPPORT, ROLES.TINT_MANAGER, ROLES.TINT_OPERATOR, ROLES.FLOOR_SUPERVISOR]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "customers", "canEdit");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { contacts, salesOfficers, dismissalsToToggle, customerCode, ...rest } = parsed.data;

  // Stage B — validate FIRST, before any DB writes.
  // Skip when salesOfficers is undefined (true PATCH semantics: caller is
  // not touching the SO links). When provided as [], it means "remove all".
  if (salesOfficers !== undefined) {
    try {
      await validateIncomingSalesOfficers(salesOfficers, prisma);
    } catch (err) {
      if (err instanceof SoSyncValidationError) {
        return NextResponse.json({ error: err.message, field: err.field }, { status: err.status });
      }
      throw err;
    }
  }

  try {
    if (customerCode) {
      const upperCode = customerCode.trim().toUpperCase();
      const conflict = await prisma.delivery_point_master.findFirst({
        where: { customerCode: upperCode, NOT: { id } },
      });
      if (conflict) {
        return NextResponse.json({ error: "Customer code already exists." }, { status: 409 });
      }
    }

    // Stage A — existing customer + contacts save (unchanged).
    await prisma.delivery_point_master.update({
      where: { id },
      data: {
        ...(customerCode && { customerCode: customerCode.trim().toUpperCase() }),
        ...rest,
      },
    });

    if (contacts !== undefined) {
      const incomingIds = contacts.filter((c) => c.id).map((c) => c.id!);
      await prisma.delivery_point_contacts.deleteMany({
        where:
          incomingIds.length > 0
            ? { deliveryPointId: id, NOT: { id: { in: incomingIds } } }
            : { deliveryPointId: id },
      });
      for (const { id: contactId, linkedSalesOfficerId: _ignored, ...contactData } of contacts) {
        if (contactId) {
          await prisma.delivery_point_contacts.update({
            where: { id: contactId },
            data: contactData,
          });
        } else {
          await prisma.delivery_point_contacts.create({
            data: { ...contactData, deliveryPointId: id },
          });
        }
      }
    }

    // Stages F → C → D → E — multi-SO + Contacts sync.
    // Stage F runs regardless of whether salesOfficers is provided
    // (dismissal flags are independent of the SO list).
    // Stage C only runs when salesOfficers is explicitly provided
    // (undefined = "don't touch SO links"; [] = "remove all").
    // Stages D + E run unconditionally so dismissal-only requests
    // still refresh contacts + Primary state.
    await applyDismissalToggles(id, dismissalsToToggle ?? [], prisma);
    if (salesOfficers !== undefined) {
      await reconcileCustomerSalesOfficers(id, salesOfficers, prisma);
    }
    await syncSalesOfficerContacts(id, prisma);
    await enforcePrimaryContactRule(id, prisma);

    // customerMissing backfill (Finding 2 — preserved untouched).
    const fetched = await prisma.delivery_point_master.findUnique({
      where: { id },
      include: fullInclude,
    });

    if (fetched?.customerCode) {
      await prisma.orders.updateMany({
        where: { shipToCustomerId: fetched.customerCode, customerId: null },
        data:  { customerMissing: false, customerId: fetched.id },
      });
    }

    return NextResponse.json(fetched);
  } catch (err) {
    console.error("PATCH /api/admin/customers/[id] error:", err);
    return NextResponse.json({ error: "Failed to save customer." }, { status: 500 });
  }
}
