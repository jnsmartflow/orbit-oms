import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const contactSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().max(200).optional().nullable(),
  isPrimary: z.boolean().default(false),
});

const createSchema = z.object({
  customerCode: z.string().min(1).max(50),
  customerName: z.string().min(1).max(200),
  areaId: z.number().int().positive(),
  subAreaId: z.number().int().positive().optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  isKeyCustomer: z.boolean().default(false),
  isKeySite: z.boolean().default(false),
  isActive: z.boolean().default(true),
  workingHoursStart: z.string().max(10).optional().nullable(),
  workingHoursEnd: z.string().max(10).optional().nullable(),
  noDeliveryDays: z.array(z.string()).default([]),
  contacts: z.array(contactSchema).default([]),
});

export async function GET(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = 25;
  const search = searchParams.get("search")?.trim() ?? "";
  const areaIdParam = searchParams.get("areaId");
  const areaId = areaIdParam ? parseInt(areaIdParam, 10) : undefined;
  const isKeyCustomer = searchParams.get("isKeyCustomer") === "true" ? true : undefined;
  const isActiveParam = searchParams.get("isActive");
  const isActive =
    isActiveParam === "true" ? true : isActiveParam === "false" ? false : undefined;

  const where = {
    ...(search && {
      OR: [
        { customerCode: { contains: search, mode: "insensitive" as const } },
        { customerName: { contains: search, mode: "insensitive" as const } },
      ],
    }),
    ...(areaId && !isNaN(areaId) && { areaId }),
    ...(isKeyCustomer !== undefined && { isKeyCustomer }),
    ...(isActive !== undefined && { isActive }),
  };

  const [customers, total] = await prisma.$transaction([
    prisma.delivery_point_master.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { customerName: "asc" },
      include: {
        area: { select: { id: true, name: true } },
        subArea: { select: { id: true, name: true } },
      },
    }),
    prisma.delivery_point_master.count({ where }),
  ]);

  return NextResponse.json({
    data: customers,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { contacts, ...data } = parsed.data;
  const customerCode = data.customerCode.trim().toUpperCase();

  const existing = await prisma.delivery_point_master.findUnique({ where: { customerCode } });
  if (existing) {
    return NextResponse.json({ error: "Customer code already exists." }, { status: 409 });
  }

  const customer = await prisma.$transaction(async (tx) => {
    return tx.delivery_point_master.create({
      data: {
        ...data,
        customerCode,
        ...(contacts.length > 0 && { contacts: { create: contacts } }),
      },
      include: {
        area: { select: { id: true, name: true } },
        subArea: { select: { id: true, name: true } },
        contacts: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
      },
    });
  });

  return NextResponse.json(customer, { status: 201 });
}
