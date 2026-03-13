import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  roleId: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const targetId = parseInt(params.id, 10);
  if (isNaN(targetId)) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const currentUserId = parseInt(session!.user.id, 10);

  // Cannot deactivate yourself
  if (parsed.data.isActive === false && targetId === currentUserId) {
    return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 403 });
  }

  // Check email uniqueness if changing email
  if (parsed.data.email) {
    const conflict = await prisma.users.findFirst({
      where: { email: parsed.data.email, NOT: { id: targetId } },
    });
    if (conflict) {
      return NextResponse.json({ error: "Email already in use." }, { status: 409 });
    }
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name.trim();
  if (parsed.data.email !== undefined) updateData.email = parsed.data.email.trim().toLowerCase();
  if (parsed.data.roleId !== undefined) updateData.roleId = parsed.data.roleId;
  if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
  if (parsed.data.password !== undefined) {
    updateData.password = await bcrypt.hash(parsed.data.password, 10);
  }

  const user = await prisma.users.update({
    where: { id: targetId },
    data: updateData,
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      createdAt: true,
      role: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(user);
}
