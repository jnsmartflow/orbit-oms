import { prisma } from "@/lib/prisma";

/**
 * Role slugs (role_master.name — stored in slug form, e.g. "floor_supervisor")
 * that receive supervisor-level picking notifications.
 */
export const PICKING_SUPERVISOR_ROLE_SLUGS: string[] = ["floor_supervisor", "operations", "admin"];

/**
 * Active user ids for everyone who should get supervisor-level picking pushes.
 *
 * Matches BOTH the primary role (users.roleId → role_master.name, via the
 * `role` relation) AND any secondary role (via the populated `user_roles`
 * table's `userRoles` relation). getActivePickers() (lib/picking/picker-roster.ts)
 * only checks the primary role and would miss a secondary-role holder — this
 * helper deliberately covers both, since user_roles IS used in production (e.g.
 * the Trip Report secondary-role grants, CLAUDE_CORE.md §5).
 *
 * Sequential await (one query). isActive only.
 */
export async function getPickingSupervisorUserIds(): Promise<number[]> {
  const users = await prisma.users.findMany({
    where: {
      isActive: true,
      OR: [
        { role: { name: { in: PICKING_SUPERVISOR_ROLE_SLUGS } } },
        { userRoles: { some: { role: { name: { in: PICKING_SUPERVISOR_ROLE_SLUGS } } } } },
      ],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}
