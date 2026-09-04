import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { allPageKeys, pageLabel } from "@/lib/permissions";
import {
  differingPageKeys,
  roleBaselineByUser,
  FLAGS,
} from "@/lib/access/role-baseline";
import type { PagePermissions } from "@/lib/permissions";
import { z } from "zod";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Save per-user page access.
//
// 🔴 WRITING HERE CHANGES WHAT NOBODY CAN DO. Every gate and every menu still
// resolves through role_permissions; this table is consulted by nothing until
// step 4. That is the whole point of the step — the owner sets up what the
// switch will do, and the screen shows the difference.
//
// SAVE ONLY WHAT CHANGED. The client sends the flags it actually toggled, and
// this route writes exactly those. It never re-posts a full grid. The old
// role-permissions screen re-posts all ~78 rows on every click, which is how
// retired page keys get resurrected — that habit stops here.
// ─────────────────────────────────────────────────────────────────────────────

const flagSchema = z.object({
  canView:   z.boolean().optional(),
  canEdit:   z.boolean().optional(),
  canImport: z.boolean().optional(),
  canExport: z.boolean().optional(),
  canDelete: z.boolean().optional(),
});

const bodySchema = z.object({
  // { "<pageKey>": { canView: true, ... } } — ONLY the flags that moved.
  changes: z.record(z.string(), flagSchema),
});

const ALL_FALSE: PagePermissions = {
  canView: false, canImport: false, canExport: false, canEdit: false, canDelete: false,
};

export async function PATCH(
  req: Request,
  { params }: { params: { userId: string } },
) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const targetId = parseInt(params.userId, 10);
  if (isNaN(targetId)) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const pageKeys = allPageKeys();
  const valid    = new Set<string>(pageKeys);

  // Unknown page keys are REJECTED rather than ignored: silently dropping one
  // would let the screen believe it saved something it did not.
  const unknown = Object.keys(parsed.data.changes).filter((k) => !valid.has(k));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Unknown page key(s): ${unknown.join(", ")}` },
      { status: 400 },
    );
  }

  // ⚠ Deliberately NOT validated against isActionAvailable(). That map is
  // advisory and cosmetic (see its header in lib/permissions.ts) — a stale
  // entry must never cause a write to be refused. The row stores all five
  // booleans whatever the screen chooses to draw.

  const entries = Object.entries(parsed.data.changes).filter(
    ([, flags]) => Object.keys(flags).length > 0,
  );
  if (entries.length === 0) {
    return NextResponse.json({ error: "No changes supplied." }, { status: 400 });
  }

  const target = await prisma.users.findUnique({
    where: { id: targetId },
    select: {
      id: true, name: true, email: true,
      role:      { select: { name: true } },
      userRoles: { select: { role: { select: { name: true } } } },
    },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  // Before-image for the audit line, over the touched keys only.
  const beforeRows = await prisma.user_page_access.findMany({
    where: { userId: targetId, pageKey: { in: entries.map(([k]) => k) } },
    select: {
      pageKey: true,
      canView: true, canImport: true, canExport: true, canEdit: true, canDelete: true,
    },
  });
  const beforeByKey = new Map(beforeRows.map((r) => [r.pageKey, r]));

  // Sequential awaits — never $transaction (CORE §3, Vercel pooler timeout).
  // Upsert on the (userId, pageKey) unique constraint so a user created after
  // the step-2 back-fill still saves cleanly instead of 500ing on a missing row.
  const changedSummary: string[] = [];
  const beforeData: Record<string, unknown> = {};
  const afterData:  Record<string, unknown> = {};

  for (const [pageKey, flags] of entries) {
    const prev = beforeByKey.get(pageKey);

    // Only the flags that genuinely move are written or logged. The client
    // already filters, but a toggle-and-toggle-back arriving as a no-op must
    // not produce a log line claiming a change happened.
    const moved = FLAGS.filter(
      (f) => flags[f] !== undefined && flags[f] !== (prev ? prev[f] : false),
    );
    if (moved.length === 0) continue;

    const patch: Record<string, boolean> = {};
    for (const f of moved) patch[f] = flags[f] as boolean;

    await prisma.user_page_access.upsert({
      where:  { userId_pageKey: { userId: targetId, pageKey } },
      update: patch,
      create: { userId: targetId, pageKey, ...ALL_FALSE, ...patch },
    });

    changedSummary.push(
      `${pageLabel(pageKey)} (${moved
        .map((f) => `${f.replace(/^can/, "").toLowerCase()} ${patch[f] ? "on" : "off"}`)
        .join(", ")})`,
    );
    beforeData[pageKey] = moved.map((f) => `${f}=${prev ? prev[f] : false}`).join(" ");
    afterData[pageKey]  = moved.map((f) => `${f}=${patch[f]}`).join(" ");
  }

  if (changedSummary.length === 0) {
    return NextResponse.json({ error: "Nothing actually changed." }, { status: 400 });
  }

  // AFTER every write returns (audit RULE 2). ONE row for the whole save —
  // it is one click, not one per cell. Same shape as the permissions grid in
  // f00808c1.
  await logAdminAction({
    userId: parseInt(session!.user.id, 10),
    entity: "user_page_access",
    entityId: String(targetId),
    action: "update",
    summary:
      `${target.name} <${target.email}> — ${changedSummary.length} page(s) changed: ` +
      changedSummary.join("; "),
    before: beforeData,
    after:  afterData,
  });

  // Re-read and recompute so the screen's "differs" banner updates from the
  // SERVER's answer rather than the client guessing at it. That banner is the
  // owner's preview of step 4; a client-side estimate of it would be the one
  // number on this screen nobody could trust.
  const freshRows = await prisma.user_page_access.findMany({
    where: { userId: targetId },
    select: {
      pageKey: true,
      canView: true, canImport: true, canExport: true, canEdit: true, canDelete: true,
    },
  });
  const stored: Record<string, PagePermissions> = {};
  for (const k of pageKeys) stored[k] = { ...ALL_FALSE };
  for (const r of freshRows) {
    stored[r.pageKey] = {
      canView:   r.canView,
      canImport: r.canImport,
      canExport: r.canExport,
      canEdit:   r.canEdit,
      canDelete: r.canDelete,
    };
  }

  const baselines = await roleBaselineByUser([target]);
  const baseline  = baselines.get(target.id) ?? {};

  return NextResponse.json({
    ok: true,
    changed: changedSummary.length,
    stored,
    differs: differingPageKeys(stored, baseline, pageKeys),
  });
}
