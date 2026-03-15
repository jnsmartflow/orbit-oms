import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const { searchParams } = new URL(req.url);
  const categoryIdParam = searchParams.get("categoryId");
  const where = categoryIdParam ? { categoryId: parseInt(categoryIdParam, 10) } : {};

  const rows = await prisma.product_name.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      category: { select: { id: true, name: true } },
      _count:   { select: { skus: true } },
    },
  });
  return NextResponse.json(rows);
}

const createSchema = z.object({
  name:       z.string().min(1, "Name is required.").max(100),
  categoryId: z.number().int().positive("Category is required."),
  isActive:   z.boolean().default(true),
});

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const duplicate = await prisma.product_name.findUnique({
    where: { name: parsed.data.name },
  });
  if (duplicate) {
    return NextResponse.json({ error: "A product name with this name already exists." }, { status: 409 });
  }

  const row = await prisma.product_name.create({
    data:    parsed.data,
    include: {
      category: { select: { id: true, name: true } },
      _count:   { select: { skus: true } },
    },
  });
  return NextResponse.json(row, { status: 201 });
}
