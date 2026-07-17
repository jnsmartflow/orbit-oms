import { prisma } from "@/lib/prisma";

export interface PickerRosterEntry {
  id: number;
  name: string;
}

/**
 * Active picker-role users — {id, name} only. For the admin-only "view as
 * picker" test hook (discovery §E5, docs/prompts/drafts/
 * code-discovery-2026-07-17-picking-stage2.md). Read-only, no writes.
 *
 * Deliberately does NOT reuse app/api/warehouse/pickers/route.ts (that route
 * also joins today's pick_assignments for load-stat counts, gated to
 * FLOOR_SUPERVISOR/ADMIN/OPERATIONS via requireRole — a different shape and
 * a different caller). This is a plain roster query for a dropdown; calling
 * it from a server component avoids an unnecessary self-fetch HTTP hop.
 */
export async function getActivePickers(): Promise<PickerRosterEntry[]> {
  return prisma.users.findMany({
    where: { role: { name: "picker" }, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
