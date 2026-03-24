import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);
  const rows = await prisma.customer_type_master.findMany({
    where:   { isActive: true },
    orderBy: { name: "asc" },
    select:  { id: true, name: true },
  });
  return NextResponse.json(rows);
}

const createSchema = z.object({
  name: z.string().min(1, "Name is required.").max(100).trim(),
});

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const name = parsed.data.name;

  const duplicate = await prisma.customer_type_master.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (duplicate) {
    return NextResponse.json({ error: "A customer type with this name already exists." }, { status: 409 });
  }

  const row = await prisma.customer_type_master.create({ data: { name } });
  return NextResponse.json(row, { status: 201 });
}
