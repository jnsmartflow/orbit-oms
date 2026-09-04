import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireSuperuser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  requireSuperuser(session);
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
  requireSuperuser(session);

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

  // AFTER the create returns (audit RULE 2).
  await logAdminAction({
    userId: parseInt(session!.user.id, 10),
    entity: "customer_types",
    entityId: String(row.id),
    action: "create",
    summary: `customer type "${row.name}" created`,
    after: { name: row.name },
  });

  return NextResponse.json(row, { status: 201 });
}
