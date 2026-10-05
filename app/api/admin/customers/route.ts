import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { z } from "zod";
import { checkAnyPermission } from "@/lib/permissions";
import { SoSyncValidationError } from "@/lib/customers/so-sync";
import { createCustomer } from "@/lib/customers/create-customer";
import { isSuperuser } from "@/lib/rbac";
import {
  isOrbCode, formatOrbCode, normaliseName, ORB_TYPED_REFUSAL,
} from "@/lib/customers/orbit-code";

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
  // Required unless orbitOnly — checked in the handler (an Orbit customer's
  // code is made by the server, so the client sends none).
  customerCode:           z.string().max(50).default(""),
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
  // Orbit customer (2026-10-05) — "Not in SAP". Superuser only; the server
  // ignores any client code and allocates ORB-NNNNN (lib/customers/orbit-code.ts).
  orbitOnly:              z.boolean().optional().default(false),
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
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title (2026-09-06). The role array only narrowed
  // ahead of a flag that already decided, so deleting it changes nobody: on this
  // key every role it named either holds the tick or was refused by the flag.
  // Both superuser arms live inside checkAnyPermission.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "customers", "canView");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

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
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title (2026-09-06). The role array only narrowed
  // ahead of a flag that already decided, so deleting it changes nobody: on this
  // key every role it named either holds the tick or was refused by the flag.
  // Both superuser arms live inside checkAnyPermission.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "customers", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { contacts, salesOfficers, dismissalsToToggle, orbitOnly, ...data } = parsed.data;

  if (!orbitOnly) {
    // A SAP customer: the code is typed, and the ORB- prefix is reserved.
    if (!data.customerCode.trim()) {
      return NextResponse.json({ error: { customerCode: ["Customer code is required."] } }, { status: 400 });
    }
    if (isOrbCode(data.customerCode)) {
      return NextResponse.json({ error: ORB_TYPED_REFUSAL }, { status: 400 });
    }
  } else {
    // Orbit customer — superuser only (server-enforced, decided 2026-10-05).
    if (!isSuperuser(session)) {
      return NextResponse.json({ error: "Only a superuser can create an Orbit customer." }, { status: 403 });
    }

    // HARD duplicate check: same area + same name after normalising, across
    // ALL customer types (the place may already exist as a SAP row). The
    // contains-filter narrows in SQL; the exact normalised compare is in JS.
    const wanted = normaliseName(data.customerName);
    const firstWord = wanted.split(" ")[0] ?? "";
    const candidates = await prisma.delivery_point_master.findMany({
      where:  { areaId: data.areaId, customerName: { contains: firstWord, mode: "insensitive" } },
      select: { id: true, customerCode: true, customerName: true },
    });
    const dup = candidates.find((c) => normaliseName(c.customerName) === wanted);
    if (dup) {
      return NextResponse.json({
        error:     `${dup.customerName} (${dup.customerCode}) already exists in this area.`,
        duplicate: dup,
      }, { status: 409 });
    }

    // ONE raw call — nextval is atomic, so no $transaction is needed (CORE §3).
    // It burns a number even if the create below fails; gaps are acceptable.
    const seq = await prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('orb_customer_code_seq') AS n`;
    data.customerCode = formatOrbCode(Number(seq[0].n));
  }

  // The create core — Stage B validate, 409, Stage A create (its pre-existing
  // $transaction wrapper kept, CORE §3 landmine policy), F → C → D → E SO sync,
  // the customerMissing backfill, re-fetch. EXTRACTED 2026-10-02 to
  // lib/customers/create-customer.ts so the Tint Manager's Add ship-to form
  // creates the same way; behaviour here is unchanged.
  let created;
  try {
    created = await createCustomer({
      data, contacts, salesOfficers, dismissalsToToggle,
      include: fullInclude,
      // The Orbit path is new code, so no $transaction (CORE §3); the SAP
      // path keeps its pre-existing wrapper verbatim.
      wrapCreateInTransaction: !orbitOnly,
    });
  } catch (err) {
    if (err instanceof SoSyncValidationError) {
      return NextResponse.json({ error: err.message, field: err.field }, { status: err.status });
    }
    throw err;
  }
  if (created.kind === "exists") {
    return NextResponse.json({ error: "Customer code already exists." }, { status: 409 });
  }
  const { customerCode, customer, finalCustomer } = created;
  const contactsForCreate = { length: created.contactsCreated };
  const backfill = { count: created.ordersBackfilled };

  // AFTER every write in the request has returned (audit RULE 2). One line for
  // the whole create — the customer, its nested contacts, its SO links, and the
  // orphan-order backfill are one user action, not four.
  await logAdminAction({
    userId: parseInt(session!.user.id, 10),
    entity: "customers",
    entityId: String(customer.id),
    action: "create",
    summary:
      `${customerCode} — ${customer.customerName}` +
      (orbitOnly ? " (Orbit customer · not in SAP)" : "") +
      (backfill.count > 0 ? `; linked ${backfill.count} orphan order(s)` : ""),
    after: {
      customerCode,
      customerName: customer.customerName,
      areaId:       customer.areaId,
      subAreaId:    customer.subAreaId,
      isActive:     customer.isActive,
      contacts:     contactsForCreate.length,
      salesOfficers: salesOfficers.length,
      ordersBackfilled: backfill.count,
    },
  });

  return NextResponse.json(finalCustomer, { status: 201 });
}
