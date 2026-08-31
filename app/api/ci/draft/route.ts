import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { parseCiDateOnly, resolveCiDealer } from "@/lib/ci/derive";
import { isCiMaterialMoved, isCiReturnType } from "@/lib/ci/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/ci/draft — step 1 of 3. Creates the CI header as `status = 'draft'`
 * and returns its id. NO CI NUMBER IS ALLOCATED HERE.
 *
 * Body: { orderId, returnType, materialMoved, materialReceivedDate, reasonId,
 *         reasonRemark? }
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 WHY THIS IS A SEPARATE ROUTE — THE SPLIT *IS* THE IDEMPOTENCY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A supervisor on a phone WILL double-tap Submit. Because the client holds ONE
 * `ciId` from this call, the second tap hits the SAME ROW, and submit's update
 * is guarded `WHERE status = 'draft'` — so it matches zero rows and changes
 * nothing.
 *
 * Collapse draft+lines+submit into one POST "for simplicity" and every
 * double-tap creates a SECOND CI, with a SECOND number, against the same bill.
 * That is the failure this shape exists to prevent. Do not merge these routes.
 *
 * A draft is INVISIBLE to every read — lib/ci/queries.ts filters
 * `status <> 'draft'` on the search, both boards, the marker and the detail —
 * which is also why an abandoned draft (browser closed mid-flow) is harmless
 * and needs no cleanup job. It is the reason `ciNumber` is nullable (spec §6).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE CLIENT IS NOT TRUSTED WITH ANYTHING IT DID NOT DECIDE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ACCEPTED (the supervisor's actual decisions): orderId · returnType ·
 * materialMoved · materialReceivedDate · reasonId · reasonRemark.
 *
 * DERIVED SERVER-SIDE, re-read from the database every time:
 *   obdNumber, invoiceNo, invoiceDate, soNumber   ← from `orders`
 *   customerId, customerCode, customerName        ← from `orders` + the dealer
 *                                                   rule (lib/ci/derive.ts)
 *   reasonLabel                                   ← from `ci_reason_master`
 *   supervisorId                                  ← from the SESSION, never
 *                                                   from the body
 *
 * A client that posts a dealer name, a reason label or a supervisor id is
 * IGNORED, not trusted. Those are facts about the bill, not choices the phone
 * gets to make, and a tampered payload must not be able to file a return
 * against a different dealer than the one on the OBD.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 🔴 canEdit, NOT canView. CORE records a standing bug — Mail Orders and
  // Picking write routes gate on canView, which makes a view-only grant a UI
  // illusion: the button is hidden but the route still writes. CI is a NEW
  // module and does not inherit that. Every write route here gates on canEdit.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "ci", "canEdit");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // session.user.id is a string (lib/auth.ts: `id: user.id.toString()`).
  // Number("") is 0, which IS finite — so require a real positive integer
  // rather than trusting isFinite, or an absent id becomes supervisorId: 0 and
  // the FK throws a 500 instead of this clean error.
  const supervisorId = Number(session.user.id);
  if (!Number.isInteger(supervisorId) || supervisorId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    orderId?: unknown;
    returnType?: unknown;
    materialMoved?: unknown;
    materialReceivedDate?: unknown;
    reasonId?: unknown;
    reasonRemark?: unknown;
  };

  // ── Validate EVERYTHING before the first write ─────────────────────────────
  // Nothing below writes, so a bad body 400s having changed nothing. Same
  // stance as app/api/mrn/[mrnId]/lines/route.ts: validate while failing is
  // still free.

  const orderId = Number(body.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json(
      { error: "`orderId` is required — expected a positive integer" },
      { status: 400 },
    );
  }

  if (typeof body.returnType !== "string" || !isCiReturnType(body.returnType)) {
    return NextResponse.json(
      { error: '`returnType` is required — expected "full" or "part"' },
      { status: 400 },
    );
  }
  const returnType = body.returnType;

  if (typeof body.materialMoved !== "string" || !isCiMaterialMoved(body.materialMoved)) {
    return NextResponse.json(
      { error: '`materialMoved` is required — expected "moved" or "not_moved"' },
      { status: 400 },
    );
  }
  const materialMoved = body.materialMoved;

  if (typeof body.materialReceivedDate !== "string") {
    return NextResponse.json(
      { error: "`materialReceivedDate` is required — expected YYYY-MM-DD" },
      { status: 400 },
    );
  }
  let materialReceivedDate: Date;
  try {
    materialReceivedDate = parseCiDateOnly(body.materialReceivedDate);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid materialReceivedDate" },
      { status: 400 },
    );
  }

  const reasonId = Number(body.reasonId);
  if (!Number.isInteger(reasonId) || reasonId <= 0) {
    return NextResponse.json(
      { error: "`reasonId` is required — expected a positive integer" },
      { status: 400 },
    );
  }

  // Optional. Empty/whitespace collapses to null rather than being stored as ""
  // — a blank remark and no remark are the same thing, and two representations
  // of it means two render branches downstream.
  const reasonRemark =
    typeof body.reasonRemark === "string" && body.reasonRemark.trim() !== ""
      ? body.reasonRemark.trim()
      : null;

  // ── Re-read the bill. THE SERVER'S COPY IS THE ONE THAT COUNTS. ────────────
  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    select: {
      id: true,
      obdNumber: true,
      invoiceNo: true,
      invoiceDate: true,
      soNumber: true,
      customerId: true,
      shipToCustomerId: true,
      shipToCustomerName: true,
      shipToOverrideCustomer: { select: { customerName: true } },
      customer: { select: { customerName: true } },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  // ── Re-read the reason, and SNAPSHOT ITS LABEL. ───────────────────────────
  // The label is stored beside the FK so renaming a reason never rewrites the
  // history of CIs raised under the old wording (spec §3.1). Reading it here
  // rather than accepting it from the body is what makes that snapshot
  // trustworthy: a client cannot file "Return by Dealer" against the id for
  // "Wrong Punching".
  //
  // isActive is checked — a retired reason must not be selectable on a NEW CI,
  // while existing CIs keep pointing at it (which is why reasons are retired by
  // flag and never deleted).
  const reason = await prisma.ci_reason_master.findFirst({
    where: { id: reasonId, isActive: true },
    select: { id: true, label: true },
  });
  if (!reason) {
    return NextResponse.json(
      { error: `Reason ${reasonId} not found or no longer active` },
      { status: 400 },
    );
  }

  // ── ONE write. Nothing partial can be left behind. ─────────────────────────
  // Sequential awaits, never prisma.$transaction (CORE §3).
  const created = await prisma.ci_returns.create({
    data: {
      // 🔴 No ciNumber. It is allocated at submit and nowhere else (spec §5).
      status: "draft",
      orderId: order.id,
      obdNumber: order.obdNumber,
      // Snapshots, all taken from the server's read of the bill.
      // ⚠ invoiceNo is snapshotted but the DETAIL route deliberately prefers the
      // LIVE value (spec §4): 5% of bills have none yet and SAP sends it later.
      // Storing it is a fallback, not the source of truth. No back-fill job.
      invoiceNo: order.invoiceNo,
      invoiceDate: order.invoiceDate,
      soNumber: order.soNumber,
      customerId: order.customerId,
      customerCode: order.shipToCustomerId,
      // The dealer rule has ONE owner — lib/ci/derive.ts, mirroring
      // lib/picking/queue.ts. Override first, then customer, then SAP's own
      // name, which is the COMMON path: 72% of overrides are flag-true with a
      // null id and have no master row to resolve.
      customerName: resolveCiDealer(order),

      returnType,
      materialMoved,
      materialReceivedDate,
      reasonId: reason.id,
      reasonLabel: reason.label,
      reasonRemark,
      supervisorId,
    },
    select: { id: true, status: true, orderId: true, obdNumber: true, returnType: true },
  });

  // 201 + the id the next two calls key on. The client MUST hold this and reuse
  // it — that is what makes a double-tap land on the same row.
  return NextResponse.json({ ciId: created.id, ...created }, { status: 201 });
}
