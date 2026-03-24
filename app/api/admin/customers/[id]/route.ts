import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const contactUpsertSchema = z.object({
  id:            z.number().int().positive().optional(),
  name:          z.string().min(1).max(100),
  phone:         z.string().max(30).optional().nullable(),
  email:         z.string().max(200).optional().nullable(),
  isPrimary:     z.boolean().default(false),
  contactRoleId: z.number().int().positive().optional().nullable(),
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
};

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  const customer = await prisma.delivery_point_master.findUnique({ where: { id }, include: fullInclude });
  if (!customer) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(customer);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { contacts, customerCode, ...rest } = parsed.data;

  if (customerCode) {
    const upperCode = customerCode.trim().toUpperCase();
    const conflict  = await prisma.delivery_point_master.findFirst({
      where: { customerCode: upperCode, NOT: { id } },
    });
    if (conflict) {
      return NextResponse.json({ error: "Customer code already exists." }, { status: 409 });
    }
  }

  const customer = await prisma.$transaction(async (tx) => {
    await tx.delivery_point_master.update({
      where: { id },
      data: {
        ...(customerCode && { customerCode: customerCode.trim().toUpperCase() }),
        ...rest,
      },
    });

    if (contacts !== undefined) {
      const incomingIds = contacts.filter((c) => c.id).map((c) => c.id!);

      await tx.delivery_point_contacts.deleteMany({
        where:
          incomingIds.length > 0
            ? { deliveryPointId: id, NOT: { id: { in: incomingIds } } }
            : { deliveryPointId: id },
      });

      for (const { id: contactId, ...contactData } of contacts) {
        if (contactId) {
          await tx.delivery_point_contacts.update({
            where: { id: contactId },
            data:  contactData,
          });
        } else {
          await tx.delivery_point_contacts.create({
            data: { ...contactData, deliveryPointId: id },
          });
        }
      }
    }

    return tx.delivery_point_master.findUnique({ where: { id }, include: fullInclude });
  });

  return NextResponse.json(customer);
}
