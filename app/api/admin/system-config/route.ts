import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireSuperuser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { z } from "zod";

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  requireSuperuser(session);

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
  requireSuperuser(session);

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Fetch existing keys — never allow inserting new ones.
  // `value` is selected too so the audit line can carry the BEFORE state: this
  // read already existed for the unknown-key guard, so nothing new is queried
  // (audit rule — reuse the read the route already does).
  const existing = await prisma.system_config.findMany({ select: { key: true, value: true } });
  const existingKeys = new Set(existing.map((r) => r.key));
  const valueByKey   = new Map(existing.map((r) => [r.key, r.value]));

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

  // AFTER the writes return (audit RULE 2). These are GLOBAL settings — one
  // value here changes behaviour for every user — so both sides are recorded,
  // not just the new value. Unchanged keys are dropped: the settings screen
  // PATCHes everything it holds on every save, so without the diff a re-save
  // would look identical to a real change.
  const changed = updated
    .filter((row) => valueByKey.get(row.key) !== row.value)
    .map((row) => ({ key: row.key, from: valueByKey.get(row.key) ?? null, to: row.value }));

  if (changed.length > 0) {
    await logAdminAction({
      userId: parseInt(session!.user.id, 10),
      entity: "system_config",
      // No single row id — the screen saves several keys at once, and the keys
      // themselves are the addresses. They are in the data.
      entityId: null,
      action: "update",
      summary:
        `system config — ${changed.length} key(s) changed: ` +
        changed.map((c) => `${c.key} ${c.from ?? "—"}→${c.to}`).join("; "),
      before: Object.fromEntries(changed.map((c) => [c.key, c.from])),
      after:  Object.fromEntries(changed.map((c) => [c.key, c.to])),
    });
  }

  return NextResponse.json(updated);
}
