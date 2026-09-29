// lib/access/notebook-store.ts — the Prisma-wired ACCESS NOTEBOOK for this
// server instance (one per Vercel lambda, module scope).
//
// Behaviour and trust rules: lib/access/notebook.ts. Plan of record:
// docs/prompts/drafts/code-plan-2026-09-29-auth-access-notebook.md
//
// 🔴 NODE-ONLY. Imported by lib/auth.ts and lib/permissions.ts. It must never be
// imported by auth.config.ts or middleware.ts (Edge) — `npm run build` proves it.
//
// Every read below is a sequential await (CORE §3 — never prisma.$transaction).

import { prisma } from "@/lib/prisma";
import { getAccessState } from "@/lib/access/source";
import {
  createNotebook,
  type GlobalSettings,
  type NotebookPagePerms,
  type RolePermRow,
  type UserBundle,
} from "@/lib/access/notebook";

/** Is the notebook switched on right now (system_config ACCESS_CACHE = 'on')? */
export async function notebookOn(): Promise<boolean> {
  return (await getAccessState()).cacheOn;
}

async function fetchUser(userId: number): Promise<UserBundle> {
  const user = await prisma.users.findUnique({
    where:  { id: userId },
    select: {
      isActive: true,
      isSuperuser: true,
      attendanceTestUser: true,
      attendanceExempt: true,
      attendanceConsentVersion: true,
    },
  });
  const pages = new Map<string, NotebookPagePerms>();
  if (!user) return { flags: null, pages };

  // ALL of the user's ticks in one read. An absent page key stays absent —
  // the resolvers read that as all-false, exactly as the per-page read does.
  const rows = await prisma.user_page_access.findMany({
    where:  { userId },
    select: {
      pageKey: true,
      canView: true, canImport: true, canExport: true, canEdit: true, canDelete: true,
    },
  });
  for (const r of rows) {
    pages.set(r.pageKey, {
      canView:   r.canView,
      canImport: r.canImport,
      canExport: r.canExport,
      canEdit:   r.canEdit,
      canDelete: r.canDelete,
    });
  }
  return {
    flags: {
      isActive: user.isActive,
      isSuperuser: user.isSuperuser,
      attendanceTestUser: user.attendanceTestUser,
      attendanceExempt: user.attendanceExempt,
      attendanceConsentVersion: user.attendanceConsentVersion,
    },
    pages,
  };
}

async function fetchSettings(): Promise<GlobalSettings> {
  // Same row lib/auth.ts fetchUserAttendanceFlags reads, same "OFF" default.
  const row = await prisma.attendance_settings.findFirst({
    where:  { scope: "GLOBAL", roleSlug: null },
    select: { rolloutStage: true },
  });
  return { rolloutStage: row?.rolloutStage ?? "OFF" };
}

async function fetchRoleRows(roleSlugs: string[]): Promise<RolePermRow[]> {
  const rows = await prisma.role_permissions.findMany({
    where:  { roleSlug: { in: roleSlugs } },
    select: {
      roleSlug: true, pageKey: true,
      canView: true, canImport: true, canExport: true, canEdit: true, canDelete: true,
    },
  });
  return rows;
}

export const accessNotebook = createNotebook({
  now: () => Date.now(),
  getVersion: async () => ({ version: (await getAccessState()).version }),
  fetchUser,
  fetchSettings,
  fetchRoleRows,
});
