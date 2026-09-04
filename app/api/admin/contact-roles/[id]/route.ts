import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireSuperuser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name:     z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  requireSuperuser(session);

  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const existing = await prisma.contact_role_master.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Contact role not found." }, { status: 404 });

  if (parsed.data.name && parsed.data.name !== existing.name) {
    const duplicate = await prisma.contact_role_master.findUnique({ where: { name: parsed.data.name } });
    if (duplicate) {
      return NextResponse.json({ error: "A contact role with this name already exists." }, { status: 409 });
    }
  }

  const row = await prisma.contact_role_master.update({ where: { id }, data: parsed.data });

  // AFTER the update returns (audit RULE 2) — changed fields only, diffed
  // against the `existing` row this route ALREADY read for its 404 and its
  // duplicate-name guard. No second query.
  const changed: string[] = [];
  const beforeData: Record<string, unknown> = {};
  const afterData:  Record<string, unknown> = {};
  for (const k of ["name", "isActive"] as const) {
    if (existing[k] !== row[k]) {
      changed.push(k);
      beforeData[k] = existing[k];
      afterData[k]  = row[k];
    }
  }
  if (changed.length > 0) {
    await logAdminAction({
      userId: parseInt(session!.user.id, 10),
      entity: "contact_roles",
      entityId: String(id),
      action: "update",
      summary: `contact role "${row.name}" — ${changed.join(", ")}`,
      before: beforeData,
      after:  afterData,
    });
  }

  return NextResponse.json(row);
}
