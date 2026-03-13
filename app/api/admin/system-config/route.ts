import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const rows = await prisma.system_config.findMany({
    orderBy: { id: "asc" },
  });

  return NextResponse.json(rows);
}

const patchSchema = z.object({
  updates: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    })
  ),
});

export async function PATCH(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Fetch existing keys — never allow inserting new ones
  const existing = await prisma.system_config.findMany({ select: { key: true } });
  const existingKeys = new Set(existing.map((r) => r.key));

  const unknownKeys = parsed.data.updates.filter((u) => !existingKeys.has(u.key));
  if (unknownKeys.length > 0) {
    return NextResponse.json(
      { error: `Unknown config keys: ${unknownKeys.map((u) => u.key).join(", ")}` },
      { status: 400 }
    );
  }

  const updated = await Promise.all(
    parsed.data.updates.map((u) =>
      prisma.system_config.update({
        where: { key: u.key },
        data: { value: u.value },
      })
    )
  );

  return NextResponse.json(updated);
}
