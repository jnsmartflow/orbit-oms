import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
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

  // Snapshot BEFORE the write so the log can say what changed, not just what
  // was sent. 🔴 `password` is deliberately NOT selected — a before-image
  // holding the old bcrypt hash is exactly what RULE 3 forbids.
  const before = await prisma.users.findUnique({
    where: { id: targetId },
    select: { name: true, email: true, roleId: true, isActive: true },
  });

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

  // AFTER the update succeeds (audit RULE 2). Only fields that actually moved
  // are recorded — the form PATCHes whatever it holds, so a diff is the only
  // way to tell a real role change from an unchanged re-save.
  //
  // ⚠ `user.roleId` does not exist — the update's `select` returns the joined
  // `role: { id, name }` instead, so the new role id is `user.role.id`. Building
  // the after-image explicitly rather than indexing `user` keeps that from
  // silently reading `undefined` on every save.
  const after = {
    name: user.name,
    email: user.email,
    roleId: user.role.id,
    isActive: user.isActive,
  };
  const changedFields: string[] = [];
  const beforeData: Record<string, unknown> = {};
  const afterData: Record<string, unknown> = {};
  for (const k of ["name", "email", "roleId", "isActive"] as const) {
    if (before && before[k] !== after[k]) {
      changedFields.push(k);
      beforeData[k] = before[k];
      afterData[k] = after[k];
    }
  }

  // 🔴 RULE 3 — a password reset is recorded as a FACT and nothing else. No
  // hash, no old value, no new value, in either data field. The reset is
  // tracked separately from the field diff because it is the one change with
  // no before/after a reader is ever allowed to see.
  const passwordReset = parsed.data.password !== undefined;
  if (passwordReset) changedFields.push("password reset");

  if (changedFields.length > 0) {
    await logAdminAction({
      userId: currentUserId,
      entity: "users",
      entityId: String(targetId),
      action: "update",
      summary: `${user.name} <${user.email}> — ${changedFields.join(", ")}`,
      before: beforeData,
      after: afterData,
    });
  }

  return NextResponse.json(user);
}
