import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

const patchSchema = z.union([
  z.object({ isActive: z.boolean() }),
  z.object({ password: z.string().min(8) }),
]);

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
  if ("isActive" in parsed.data && !parsed.data.isActive && targetId === currentUserId) {
    return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 403 });
  }

  let data: Record<string, unknown>;

  if ("password" in parsed.data) {
    data = { password: await bcrypt.hash(parsed.data.password, 10) };
  } else {
    data = { isActive: parsed.data.isActive };
  }

  const user = await prisma.users.update({
    where: { id: targetId },
    data,
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
