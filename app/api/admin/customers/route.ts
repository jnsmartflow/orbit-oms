import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/permissions";
import {
  validateIncomingSalesOfficers,
  applyDismissalToggles,
  reconcileCustomerSalesOfficers,
  syncSalesOfficerContacts,
  enforcePrimaryContactRule,
  SoSyncValidationError,
} from "@/lib/customers/so-sync";

export const dynamic = 'force-dynamic';

const contactSchema = z.object({
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

const createSchema = z.object({
  customerCode:           z.string().min(1).max(50),
  customerName:           z.string().min(1).max(200),
  address:                z.string().max(500).optional().nullable(),
  areaId:                 z.number().int().positive(),
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
  isKeyCustomer:          z.boolean().default(false),
  isKeySite:              z.boolean().default(false),
  acceptsPartialDelivery: z.boolean().default(true),
  isActive:               z.boolean().default(true),
  workingHoursStart:      z.string().max(10).optional().nullable(),
  workingHoursEnd:        z.string().max(10).optional().nullable(),
  noDeliveryDays:         z.array(z.string()).default([]),
  contacts:               z.array(contactSchema).default([]),
  // Phase 2 multi-SO sync
  salesOfficers:          z.array(salesOfficerLinkSchema).optional().default([]),
  dismissalsToToggle:     z.array(dismissalToggleSchema).optional().default([]),
});

const listInclude = {
  area:              { select: { id: true, name: true } },
  subArea:           { select: { id: true, name: true } },
  salesOfficerGroup: { select: { id: true, name: true } },
  premisesType:      { select: { id: true, name: true } },
} as const;

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

export async function GET(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.SUPPORT, ROLES.TINT_MANAGER, ROLES.TINT_OPERATOR, ROLES.FLOOR_SUPERVISOR, ROLES.OPERATION_MANAGER]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "customers", "canView");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page          = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize      = Math.min(parseInt(searchParams.get("pageSize") ?? "25", 10), 500);
  const search        = searchParams.get("search")?.trim() ?? "";
  const areaIdParam        = searchParams.get("areaId");
  const areaId             = areaIdParam ? parseInt(areaIdParam, 10) : undefined;
  const deliveryTypeParam  = searchParams.get("dispatchDeliveryTypeId");
  const dispatchDeliveryTypeId = deliveryTypeParam ? parseInt(deliveryTypeParam, 10) : undefined;
  const isKeyCustomer      = searchParams.get("isKeyCustomer") === "true" ? true : undefined;
  const isActiveParam      = searchParams.get("isActive");
  const isActive           = isActiveParam === "true" ? true : isActiveParam === "false" ? false : undefined;
  const premisesTypeParam  = searchParams.get("premisesTypeId");
  const premisesTypeId     = premisesTypeParam ? parseInt(premisesTypeParam, 10) : undefined;

  const where = {
    ...(search && {
      OR: [
        { customerCode: { contains: search, mode: "insensitive" as const } },
        { customerName: { contains: search, mode: "insensitive" as const } },
      ],
    }),
    ...(areaId && !isNaN(areaId) && { areaId }),
    ...(dispatchDeliveryTypeId && !isNaN(dispatchDeliveryTypeId) && {
      OR: [
        { dispatchDeliveryTypeId },
        { dispatchDeliveryTypeId: null, area: { deliveryTypeId: dispatchDeliveryTypeId } },
      ],
    }),
    ...(isKeyCustomer !== undefined && { isKeyCustomer }),
    ...(isActive      !== undefined && { isActive }),
    ...(premisesTypeId && !isNaN(premisesTypeId) && { premisesTypeId }),
  };

  const [customers, total] = await prisma.$transaction([
    prisma.delivery_point_master.findMany({
      where,
      skip:    (page - 1) * pageSize,
      take:    pageSize,
      orderBy: [{ area: { name: "asc" } }, { subArea: { name: "asc" } }, { customerName: "asc" }],
      include: listInclude,
    }),
    prisma.delivery_point_master.count({ where }),
  ]);

  return NextResponse.json({ data: customers, total, page, totalPages: Math.ceil(total / pageSize) });
}

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.SUPPORT, ROLES.TINT_MANAGER, ROLES.TINT_OPERATOR, ROLES.FLOOR_SUPERVISOR, ROLES.OPERATION_MANAGER]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "customers", "canEdit");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { contacts, salesOfficers, dismissalsToToggle, ...data } = parsed.data;
  const customerCode = data.customerCode.trim().toUpperCase();

  // Stage B — validate FIRST, before any DB writes.
  // A validation failure here leaves the DB untouched.
  try {
    await validateIncomingSalesOfficers(salesOfficers, prisma);
  } catch (err) {
    if (err instanceof SoSyncValidationError) {
      return NextResponse.json({ error: err.message, field: err.field }, { status: err.status });
    }
    throw err;
  }

  const existing = await prisma.delivery_point_master.findUnique({ where: { customerCode } });
  if (existing) {
    return NextResponse.json({ error: "Customer code already exists." }, { status: 409 });
  }

  // Strip contact-level linkedSalesOfficerId from the nested-create payload.
  // Stage D owns that field; on initial create there are no SO links yet,
  // so any value here would be stale/spurious.
  const contactsForCreate = contacts.map(({ linkedSalesOfficerId: _ignored, ...rest }) => rest);

  // Stage A — existing customer + contacts save (pre-existing $transaction wrapper
  // kept verbatim per CORE §3 landmine policy).
  const customer = await prisma.$transaction(async (tx) => {
    return tx.delivery_point_master.create({
      data: {
        ...data,
        customerCode,
        ...(contactsForCreate.length > 0 && { contacts: { create: contactsForCreate } }),
      },
      include: fullInclude,
    });
  });

  // Stages F → C → D → E — multi-SO + Contacts sync.
  await applyDismissalToggles(customer.id, dismissalsToToggle, prisma);
  await reconcileCustomerSalesOfficers(customer.id, salesOfficers, prisma);
  await syncSalesOfficerContacts(customer.id, prisma);
  await enforcePrimaryContactRule(customer.id, prisma);

  // customerMissing backfill (Finding 2 — preserved untouched).
  await prisma.orders.updateMany({
    where: { shipToCustomerId: customerCode, customerId: null },
    data:  { customerMissing: false, customerId: customer.id },
  });

  // Re-fetch so the response reflects synced SO links + refreshed contacts.
  const finalCustomer = await prisma.delivery_point_master.findUnique({
    where: { id: customer.id },
    include: fullInclude,
  });

  return NextResponse.json(finalCustomer, { status: 201 });
}
