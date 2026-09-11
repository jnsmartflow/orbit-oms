import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isSuperuser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { getAccessSource } from "@/lib/access/source";
import { effectiveRoleSlugs, roleBaselineByUser } from "@/lib/access/role-baseline";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Who a Mail Order tag switch can be pointed at.
//
// The admin Tags picker offers two sections — Roles and People — and BOTH are
// derived from one list: the active people who can actually open Mail Orders
// today. Offering anybody else would let an admin hide a badge from a person who
// never sees the screen, which reads as a switch that does nothing.
//
// 🔴 THE LIVE RESOLVER DECIDES, NOT role_permissions AND NOT THE SEED.
// Access came off job titles on 2026-09-04 (CORE §5): the authority is
// user_page_access, behind system_config.ACCESS_SOURCE. This route asks
// getAccessSource() and reads whichever table is live, so the picker can never
// offer a population the app disagrees with.
//
// ⚠ WHY NOT checkAnyPermission(). The five resolvers in lib/permissions.ts answer
// about the LOGGED-IN user only — in user mode they read session.user.id, so
// asking them about 40 other people returns the viewing admin's own permissions
// 40 times. That is documented at lib/permissions.ts:394-407, and is the same
// trap lib/access/role-baseline.ts was written to avoid. This route reads the
// per-user rows directly in user mode, and reuses role-baseline's shared merge in
// role mode, rather than inventing a third copy of either rule.
//
// Read-only. Sequential awaits, never $transaction (CORE §3).
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_KEY = "mail_orders";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isSuperuser(session)) {
    return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
  }

  // Active people only. A deactivated person keeps their access rows so that
  // reactivating restores them (CORE §7.14), but they are not somebody an admin
  // is choosing between today.
  const users = await prisma.users.findMany({
    where:  { isActive: true },
    select: {
      id: true,
      name: true,
      isSuperuser: true,
      role:      { select: { name: true } },
      userRoles: { select: { role: { select: { name: true } } } },
    },
    orderBy: { name: "asc" },
  });

  const source = await getAccessSource();

  // ── Who holds mail_orders view access, by the LIVE source ─────────────────
  const canSee = new Set<number>();

  if (source === "user") {
    const rows = await prisma.user_page_access.findMany({
      where:  { pageKey: PAGE_KEY, canView: true, userId: { in: users.map((u) => u.id) } },
      select: { userId: true },
    });
    for (const r of rows) canSee.add(r.userId);
  } else {
    // Role mode — the rollback path. roleBaselineByUser() shares the role-table
    // merge with the live resolvers and de-duplicates by role-set, so this is
    // ~14 queries for 40 people rather than 40.
    const baseline = await roleBaselineByUser(users);
    for (const u of users) {
      if (baseline.get(u.id)?.[PAGE_KEY]?.canView === true) canSee.add(u.id);
    }
  }

  // A superuser reaches every page by short-circuit, before either table is read
  // (lib/permissions.ts:564). They belong in the picker for the same reason these
  // switches have no admin bypass: a badge hidden from the admin really is hidden.
  for (const u of users) if (u.isSuperuser) canSee.add(u.id);

  const people = users
    .filter((u) => canSee.has(u.id))
    .map((u) => ({
      id:        u.id,
      name:      u.name,
      roleSlugs: effectiveRoleSlugs(u),
      roleLabel: u.role.name,
    }));

  // ── Roles: only those the qualifying people actually hold ─────────────────
  // Offering a role nobody on this screen holds would create a switch that can
  // never fire. The slug is stored; the name is shown. Both come from
  // effectiveRoleSlugs(), which reproduces lib/auth.ts:217-221 — the one place
  // that normalisation is defined.
  const roleNames = await prisma.role_master.findMany({ select: { name: true } });
  const labelBySlug = new Map(
    roleNames.map((r) => [r.name.toLowerCase().replace(/\s+/g, "_"), r.name]),
  );

  const counts = new Map<string, number>();
  for (const p of people) {
    for (const slug of p.roleSlugs) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }

  const roles = Array.from(counts.entries())
    .map(([slug, count]) => ({
      slug,
      // A slug with no matching role_master row cannot normally happen — the slug
      // is derived FROM that table — but a rename between the two reads would do
      // it, so the slug itself is the fallback label rather than an empty chip.
      label: labelBySlug.get(slug) ?? slug,
      count,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return NextResponse.json({ ok: true, source, people, roles });
}
