import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const officers = await prisma.sales_officer_master.findMany({
    orderBy: { name: "asc" },
  });

  return NextResponse.json(officers);
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(200),
});

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();

  const existing = await prisma.sales_officer_master.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already exists." }, { status: 409 });
  }

  const officer = await prisma.sales_officer_master.create({
    data: { name: parsed.data.name.trim(), email },
  });

  return NextResponse.json(officer, { status: 201 });
}
