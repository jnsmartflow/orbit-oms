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

  const rows = await prisma.role_permissions.findMany({
    orderBy: [{ roleSlug: "asc" }, { pageKey: "asc" }],
  });

  return NextResponse.json(rows);
}

const updateSchema = z.object({
  updates: z.array(
    z.object({
      roleSlug:  z.string().min(1),
      pageKey:   z.string().min(1),
      canView:   z.boolean(),
      canImport: z.boolean(),
      canExport: z.boolean(),
      canEdit:   z.boolean(),
      canDelete: z.boolean(),
    })
  ),
});

export async function POST(req: Request) {
  const session = await auth();
  requireSuperuser(session);

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const updates = parsed.data.updates.map((row) => {
    if (row.roleSlug === "admin") {
      return { ...row, canView: true, canImport: true, canExport: true, canEdit: true, canDelete: true };
    }
    return row;
  });

  // Snapshot BEFORE the write, so the audit line can name what actually changed
  // rather than all ~78 rows the grid always re-posts. Sequential await, outside
  // the transaction below (CORE §3 — never add reads into a $transaction).
  const beforeRows = await prisma.role_permissions.findMany({
    select: {
      roleSlug: true, pageKey: true,
      canView: true, canImport: true, canExport: true, canEdit: true, canDelete: true,
    },
  });
  const beforeByKey = new Map(beforeRows.map((r) => [`${r.roleSlug}|${r.pageKey}`, r]));

  const FLAGS = ["canView", "canImport", "canExport", "canEdit", "canDelete"] as const;
  const changed: {
    roleSlug: string; pageKey: string;
    flags: { flag: string; from: boolean | null; to: boolean }[];
  }[] = [];

  for (const row of updates) {
    const prev = beforeByKey.get(`${row.roleSlug}|${row.pageKey}`);
    const flags = FLAGS
      // `prev` absent = a brand-new grant row; `null` reads as "no prior value"
      // in the log rather than pretending it was false.
      .filter((f) => !prev || prev[f] !== row[f])
      .map((f) => ({ flag: f, from: prev ? prev[f] : null, to: row[f] }));
    if (flags.length > 0) changed.push({ roleSlug: row.roleSlug, pageKey: row.pageKey, flags });
  }

  // ⚠ This $transaction violates CORE §3 and is LEFT DELIBERATELY. The route is
  // due to be replaced entirely in a later step of the per-user access work;
  // unwrapping a 78-row upsert now would change its failure semantics for no
  // lasting benefit. Audit call only — see the commit that added this.
  const rows = await prisma.$transaction(
    updates.map((row) =>
      prisma.role_permissions.upsert({
        where: { roleSlug_pageKey: { roleSlug: row.roleSlug, pageKey: row.pageKey } },
        create: {
          roleSlug:  row.roleSlug,
          pageKey:   row.pageKey,
          canView:   row.canView,
          canImport: row.canImport,
          canExport: row.canExport,
          canEdit:   row.canEdit,
          canDelete: row.canDelete,
        },
        update: {
          canView:   row.canView,
          canImport: row.canImport,
          canExport: row.canExport,
          canEdit:   row.canEdit,
          canDelete: row.canDelete,
        },
      })
    )
  );

  // AFTER the write, never before (audit RULE 2). A no-op save — the grid posts
  // every row on every click — writes no line at all; an audit trail full of
  // "changed nothing" entries is how the real changes get lost.
  if (changed.length > 0) {
    await logAdminAction({
      userId: parseInt(session!.user.id, 10),
      entity: "role_permissions",
      // No single row id — this is a grid save. The changed pairs are in the data.
      entityId: null,
      action: "update",
      summary:
        `permissions grid — ${changed.length} row(s) changed: ` +
        changed
          .map((c) => `${c.roleSlug}/${c.pageKey} (${c.flags.map((f) => `${f.flag} ${f.from ?? "—"}→${f.to}`).join(", ")})`)
          .join("; "),
      after: { changed },
    });
  }

  return NextResponse.json(rows);
}
