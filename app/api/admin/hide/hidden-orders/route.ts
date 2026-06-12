import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getActiveHideRules, getHiddenWhere, matchesRule } from "@/lib/hide/visibility";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Hidden Orders admin list — admin-only. Surfaces orders that are manually
// hidden OR caught by an active rule, with the reason attributed per order.
// Removed orders are excluded so they don't leak into this view.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
  }

  const activeRules = await getActiveHideRules();
  const hiddenWhere = await getHiddenWhere();

  const rows = await prisma.orders.findMany({
    where:   { AND: [{ isRemoved: false }, hiddenWhere] },
    orderBy: { orderDateTime: "desc" },
    select: {
      id:                 true,
      obdNumber:          true,
      orderDateTime:      true,
      dispatchStatus:     true,
      isHidden:           true,
      hiddenReason:       true,
      hiddenById:         true,
      hiddenAt:           true,
      shipToCustomerName: true,
    },
  });

  // ── Resolve manual-hide user names in one query ────────────────────────────
  const hiddenByIds = Array.from(
    new Set(rows.map((r) => r.hiddenById).filter((id): id is number => id != null)),
  );
  const users = hiddenByIds.length > 0
    ? await prisma.users.findMany({
        where:  { id: { in: hiddenByIds } },
        select: { id: true, name: true },
      })
    : [];
  const userNameById = new Map(users.map((u) => [u.id, u.name]));

  // ── Attribute the reason per order ─────────────────────────────────────────
  const orders = rows.map((r) => {
    let reason:
      | { type: "manual"; text: string | null; by: string | null; at: Date | null }
      | { type: "rule"; text: string; by: string }
      | null;

    if (r.isHidden) {
      reason = {
        type: "manual",
        text: r.hiddenReason,
        by:   r.hiddenById != null ? (userNameById.get(r.hiddenById) ?? null) : null,
        at:   r.hiddenAt,
      };
    } else {
      const rule = activeRules.find((rule) => matchesRule(rule, r));
      reason = rule
        ? { type: "rule", text: rule.ruleName, by: "Auto" }
        : null;
    }

    return {
      id:            r.id,
      obdNumber:     r.obdNumber,
      orderDateTime: r.orderDateTime,
      siteName:      r.shipToCustomerName,
      reason,
    };
  });

  return NextResponse.json({ ok: true, orders });
}
