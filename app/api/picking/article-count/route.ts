import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { PICK_CHECKED } from "@/lib/workflow-stages";
import { ARTICLE_COUNT_ERROR, parseArticleCount } from "@/lib/picking/article-count";

export const dynamic = "force-dynamic";

/**
 * POST /api/picking/article-count — EDIT the article no. on a checked bill.
 * Body `{ orderId, articleCount }`. The supervisor's "Edit article no." in the
 * checked bill's ⋯ menu (2026-10-06, Schema v27.58). Approve writes the first
 * value (app/api/picking/approve/route.ts); this only corrects it.
 *
 * Allowed only at pick_checked WITH a pick_assignments row — a Direct Loaded
 * bill has no row and never gets an article no. (decision record
 * docs/prompts/drafts/web-update-2026-10-06-approve-article-no.md §5).
 *
 * Writes, sequential, never prisma.$transaction (CORE §3):
 *   (a) pick_assignments.update articleCount.
 *   (b) ONE orders.update that only bumps updatedAt. REQUIRED, not tidy-up:
 *       pick_assignments has NO updatedAt and the live-sync markers key on
 *       MAX(orders.updatedAt) only (CLAUDE_PICKING.md §10) — an assignment-only
 *       write would reach no other screen. If (b) fails, (a) is put back to the
 *       old value and the route 500s.
 *   (c) ONE order_status_logs row — the NON-STAGE shape Floor's mark-urgent /
 *       change-slot use (lib/floor/bill-actions.ts): fromStage = toStage = the
 *       unchanged stage, the event lives in `note`.
 * Same number as stored → 200, no writes.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // canEdit — a supervisor action, same gate as approve/route.ts.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "picking", "canEdit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderId?: number; articleCount?: unknown };

  const orderId = body.orderId;
  if (typeof orderId !== "number" || !Number.isInteger(orderId)) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }
  const articleCount = parseArticleCount(body.articleCount);
  if (articleCount === null) {
    return NextResponse.json({ error: ARTICLE_COUNT_ERROR }, { status: 400 });
  }

  const order = await prisma.orders.findFirst({
    where: { id: orderId },
    select: {
      id: true,
      workflowStage: true,
      pickAssignment: { select: { id: true, articleCount: true } },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.workflowStage !== PICK_CHECKED || order.pickAssignment === null) {
    return NextResponse.json({ error: "This bill is not an approved pick." }, { status: 409 });
  }

  const oldCount = order.pickAssignment.articleCount;
  if (oldCount === articleCount) {
    return NextResponse.json({ ok: true, orderId, articleCount, changed: false });
  }

  // (a)
  await prisma.pick_assignments.update({
    where: { orderId },
    data: { articleCount },
  });

  // (b) — the marker bump. The ONE orders.update of this route.
  try {
    await prisma.orders.update({
      where: { id: orderId },
      data: { updatedAt: new Date() },
    });
  } catch {
    // Best-effort revert of (a) — never prisma.$transaction (CORE §3).
    await prisma.pick_assignments
      .update({ where: { orderId }, data: { articleCount: oldCount } })
      .catch(() => {});
    return NextResponse.json(
      { error: "Failed to save the article no. Nothing was changed." },
      { status: 500 },
    );
  }

  // (c)
  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: PICK_CHECKED,
      toStage: PICK_CHECKED,
      changedById: userId,
      note: `Article no. ${oldCount ?? "—"} → ${articleCount}`,
    },
  });

  return NextResponse.json({ ok: true, orderId, articleCount, changed: true });
}
