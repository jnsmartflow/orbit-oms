import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { onSoNumberChange, precheckSoNumberChange } from "@/lib/billing/mo-ci-tag";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // canEdit — these are writes. Admin bypass is inside checkAnyPermission.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "mail_orders", "canEdit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: { soNumber?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const soNumber = body.soNumber?.trim() ?? "";
  if (!/^\d{10}$/.test(soNumber)) {
    return NextResponse.json(
      { error: "SO Number must be exactly 10 digits" },
      { status: 400 },
    );
  }

  const order = await prisma.mo_orders.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const userId = parseInt(session.user.id, 10);

  // 🔴 A CI-MARKED mail order (billOnlyAt) carries an so_tags 'ci' row on its SO
  // (lib/billing/mo-ci-tag.ts, design web-update-2026-09-24-billing-mo-actions.md
  // §3.6). Changing the SO moves that tag — and is REFUSED once the tag has been
  // applied to a bill. The refusal is decided BEFORE the number is written.
  const refusal = await precheckSoNumberChange({ moOrderId: id, newSoNumber: soNumber });
  if (refusal !== null) {
    return NextResponse.json({ error: refusal, code: "CI_TAG_MATCHED" }, { status: 409 });
  }

  await prisma.mo_orders.update({
    where: { id },
    data: {
      soNumber,
      status: "punched",
      punchedAt: new Date(),
      punchedById: userId,
    },
  });

  // First punch or re-punch of a CI-marked mail order: write / move the tag and
  // apply it to any bill already imported on the SO. Never throws — the number
  // is saved either way; a problem comes back as `ciTagWarning`.
  let ciTagWarning: string | null = null;
  if (order.billOnlyAt !== null) {
    const moved = await onSoNumberChange({
      moOrderId: id,
      oldSoNumber: order.soNumber,
      newSoNumber: soNumber,
      userId,
      now: new Date(),
    });
    ciTagWarning = moved.warning;
  }

  return NextResponse.json({ success: true, soNumber, status: "punched", ciTagWarning });
}
