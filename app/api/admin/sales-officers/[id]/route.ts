import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().max(200).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  if (parsed.data.email) {
    const email = parsed.data.email.trim().toLowerCase();
    const conflict = await prisma.sales_officer_master.findFirst({
      where: { email, NOT: { id } },
    });
    if (conflict) return NextResponse.json({ error: "Email already exists." }, { status: 409 });
    parsed.data.email = email;
  }

  if (parsed.data.name) {
    parsed.data.name = parsed.data.name.trim();
  }

  const officer = await prisma.sales_officer_master.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json(officer);
}
