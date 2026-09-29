import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireSuperuser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { clearAccessSourceCache } from "@/lib/access/source";
import { accessNotebook } from "@/lib/access/notebook-store";

export const dynamic = "force-dynamic";

// POST /api/admin/access/apply — "Apply access changes now" (/admin/access).
//
// Bumps system_config ACCESS_VERSION by one, with the SAME statement the
// database triggers use (sql/2026-09-30-access-notebook.sql). Every server
// instance drops its access notebook the next time it reads the version —
// within ~30 s (lib/access/source.ts TTL). The triggers already bump on every
// write to the access tables; this lever is for a change they cannot see (a
// data fix somewhere else that should still reset everyone's cached access).
//
// Superuser only. Writes one admin_audit_log line (entity "access_version",
// action "bump") after the bump succeeds. A missing ACCESS_VERSION row is a
// 409, not a silent success: the SQL file has not been run yet.
export async function POST() {
  const session = await auth();
  requireSuperuser(session);

  const updated = await prisma.$executeRaw`
    UPDATE system_config
       SET value = (CASE WHEN value ~ '^[0-9]+$' THEN value::bigint + 1 ELSE 1 END)::text
     WHERE key = 'ACCESS_VERSION'`;

  if (updated === 0) {
    return NextResponse.json(
      {
        error:
          "ACCESS_VERSION is not set up yet — run sql/2026-09-30-access-notebook.sql in the Supabase SQL Editor first.",
      },
      { status: 409 },
    );
  }

  const row = await prisma.system_config.findUnique({
    where:  { key: "ACCESS_VERSION" },
    select: { value: true },
  });
  const version = row?.value ?? null;

  // This instance need not wait for its own 30 s window.
  clearAccessSourceCache();
  accessNotebook.dropAll();

  await logAdminAction({
    userId: parseInt(session!.user.id, 10),
    entity: "access_version",
    entityId: null,
    action: "bump",
    summary: `Apply access changes now — ACCESS_VERSION is now ${version ?? "unknown"}`,
    after: { version },
  });

  return NextResponse.json({ ok: true, version });
}
