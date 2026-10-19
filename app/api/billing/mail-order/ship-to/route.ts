import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditBillingShipTo } from "@/lib/ship-to/access";
import { parseShipToForm } from "@/lib/ship-to/parse-form";
import { MAX_ACTIVE_COPIES } from "@/lib/ship-to/copy";
import {
  activeOwnCopiesWhere,
  checkRemovable,
  countActiveOwnCopies,
  discardNewCopies,
  softRemoveCopies,
  uploadAndRecordCopies,
} from "@/lib/ship-to/copies-server";
import { applyBillingShipTo } from "@/lib/billing/ship-to-write";
import { validateShipToTarget, type ShipToTarget } from "@/lib/floor/ship-to";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/mail-order/ship-to — the shared ship-to modal's SAVE on
 * the Billing desk (free-text ship-to P1, 2026-10-19; design
 * web-update-2026-10-19-ship-to-freetext.md §2-§4). multipart/form-data, the
 * fields of lib/ship-to/parse-form.ts plus:
 *   moOrderId   positive int, required
 *
 * Applies to the MAIL ORDER and every bill of its SO (per bill, refusals
 * apply), and to bills that import later through the fill-only carry.
 * Copies attached here belong to the mail order (moOrderId).
 *
 * Gate: mail_orders canEdit AND billing_ship_to canEdit — the same two ticks as
 * the ✎ pencil's JSON action (actions/route.ts). No new page key.
 *
 * Order (CORE §3 — sequential awaits, never $transaction):
 *   1. validate EVERYTHING: shape, lock, dealer / area, which copies may be
 *      removed, the 3-copy cap, As per challan's copy rule, total size
 *   2. upload the files + insert their rows (lib/ship-to/copies-server.ts)
 *   3. write the mail order, then each bill (lib/billing/ship-to-write.ts)
 *   4. if 3 throws → delete the NEW rows + objects; nothing is left visible
 *   5. soft-remove the copies the operator ✕'d
 * Response: the actions route's shape — 200 `{ ok, moOrder, updated, skipped,
 * failed, ordersUpdated, copiesAdded, copiesRemoved }` whenever the mail order
 * was saved, even if every bill was refused.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  if (!(await canEditBillingShipTo(roles))) {
    return NextResponse.json(
      { error: "You do not have permission to change the ship-to dealer from Billing." },
      { status: 403 },
    );
  }

  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const moRaw = typeof form.get("moOrderId") === "string" ? String(form.get("moOrderId")).trim() : "";
  const moOrderId = Number(moRaw);
  if (!/^\d+$/.test(moRaw) || moOrderId <= 0 || moOrderId > 2147483647) {
    return NextResponse.json({ error: "moOrderId is required and must be a positive integer" }, { status: 400 });
  }

  const parsed = await parseShipToForm(form);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const r = parsed.req;

  const mailOrder = await prisma.mo_orders.findUnique({
    where: { id: moOrderId },
    select: { id: true, soNumber: true, isLocked: true },
  });
  if (!mailOrder) return NextResponse.json({ error: "Mail order not found" }, { status: 404 });
  if (mailOrder.isLocked) {
    return NextResponse.json({ error: "This order is locked.", code: "LOCKED" }, { status: 409 });
  }

  const target: ShipToTarget =
    r.mode === "dealer"
      ? { kind: "dealer", customerId: r.customerId }
      : r.mode === "typed"
        ? { kind: "typed", text: r.text, areaId: r.areaId }
        : { kind: "reset" };
  const bad = await validateShipToTarget(target);
  if (bad !== null) return NextResponse.json({ error: bad.error }, { status: bad.status });

  // ── Copies: who may remove what, the cap, and As per challan's rule ────────
  const files = r.mode === "typed" ? r.files : [];
  const removeCopyIds = r.mode === "typed" ? r.removeCopyIds : [];
  if (r.mode === "typed") {
    const notMine = await checkRemovable(removeCopyIds, "billing", moOrderId);
    if (notMine !== null) return NextResponse.json({ error: notMine.error }, { status: notMine.status });

    const activeAfter = (await countActiveOwnCopies("billing", moOrderId)) - removeCopyIds.length + files.length;
    if (activeAfter > MAX_ACTIVE_COPIES) {
      return NextResponse.json(
        { error: `At most ${MAX_ACTIVE_COPIES} copies per order — remove one before adding another.` },
        { status: 409 },
      );
    }
    // 🔴 SERVER-SIDE, not only the disabled Save button: As per challan names
    // no place, so the copy IS the address.
    if (r.asPerChallan && activeAfter < 1) {
      return NextResponse.json({ error: "As per challan needs the challan copy attached." }, { status: 400 });
    }
  }

  // ── Upload + record, then the ship-to write ───────────────────────────────
  const rec = await uploadAndRecordCopies({
    files,
    owner: "billing",
    ownerId: moOrderId,
    soNumber: mailOrder.soNumber,
    uploadedById: userId,
  });
  if (!rec.ok) return NextResponse.json({ error: rec.error }, { status: rec.status });

  let result: Awaited<ReturnType<typeof applyBillingShipTo>>;
  try {
    result = await applyBillingShipTo({ moOrderId, soNumber: mailOrder.soNumber, target, userId });
  } catch (err) {
    console.error(`[billing/ship-to] save failed for mail order ${moOrderId}:`, err);
    await discardNewCopies(rec.ids, rec.paths);
    return NextResponse.json({ error: "The ship-to could not be saved. Please try again." }, { status: 500 });
  }

  // The ✕'d copies go only once the save landed, so a failed save hides nothing.
  let copiesRemoved = 0;
  if (removeCopyIds.length > 0) {
    copiesRemoved = await softRemoveCopies(
      { ...activeOwnCopiesWhere("billing", moOrderId), id: { in: removeCopyIds } },
      userId,
    );
  }

  return NextResponse.json({
    ok: true,
    moOrder: result.moOrder,
    updated: result.updated,
    skipped: result.skipped,
    failed: result.failed,
    ordersUpdated: result.updated.length,
    copiesAdded: rec.ids,
    copiesRemoved,
  });
}
