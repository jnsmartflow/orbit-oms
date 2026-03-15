import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name:     z.string().min(1).max(100).optional(),
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

  const existing = await prisma.base_colour.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Base colour not found." }, { status: 404 });

  // N/A is the fallback for non-tint SKUs — cannot be deactivated
  if (parsed.data.isActive === false && existing.name === "N/A") {
    return NextResponse.json(
      { error: "The 'N/A' base colour cannot be deactivated. It is the fallback for non-tint SKUs." },
      { status: 422 }
    );
  }

  if (parsed.data.name && parsed.data.name !== existing.name) {
    const duplicate = await prisma.base_colour.findUnique({
      where: { name: parsed.data.name },
    });
    if (duplicate) {
      return NextResponse.json({ error: "A base colour with this name already exists." }, { status: 409 });
    }
  }

  const row = await prisma.base_colour.update({
    where:   { id },
    data:    parsed.data,
    include: { _count: { select: { skus: true } } },
  });
  return NextResponse.json(row);
}
