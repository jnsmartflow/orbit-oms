import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import type { ShipToTarget } from "@/lib/floor/ship-to";
import { parseShipToForm } from "@/lib/ship-to/parse-form";
import { MAX_ACTIVE_COPIES } from "@/lib/ship-to/copy";
import {
  activeOwnCopiesWhere,
  checkRemovable,
  countActiveOwnCopies,
  countBillingCopiesVisible,
  discardNewCopies,
  softRemoveCopies,
  uploadAndRecordCopies,
} from "@/lib/ship-to/copies-server";
import { planTripShipTo, setTripShipTo, type TripShipToResult } from "@/lib/trips/ship-to-on-trip";

export const dynamic = "force-dynamic";

// POST /api/floor/trips/[id]/ship-to — change the ship-to of ONE bill that is
// ON this trip, and move it to the new shop's stop on the SAME trip (owner D2 /
// D8, 2026-10-24). The write and every refusal are lib/trips/ship-to-on-trip.ts.
//
// Floor's own POST /api/floor/ship-to still REFUSES an on-trip bill, for every
// other caller; Billing and the Tint Manager are untouched. The shared ship-to
// modal calls THIS route only when Floor opens it on a bill with a trip.
//
// TWO BODIES, the same as /api/floor/ship-to:
//   · application/json  { orderId, customerId: number | null, preview? }
//   · multipart/form-data — the modal: orderId + parse-form's fields (mode
//     dealer | typed | reset, text, asPerChallan, areaId, files, removeCopyIds)
//     + preview=1 for the dry run.
// `preview` writes NOTHING and uploads nothing: it answers what a save would do
// ({ preview }), or the refusal a save would get.
//
// Gate: floor canEdit. Sequential awaits, never prisma.$transaction (CORE §3).

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const changedById = Number(session.user.id);
  if (!Number.isInteger(changedById) || changedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const tripId = Number(params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return NextResponse.json({ error: "Invalid trip id" }, { status: 400 });
  }

  if ((req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    return saveFromModal(req, tripId, changedById);
  }

  const body = (await req.json().catch(() => ({}))) as { orderId?: number; customerId?: number | null; preview?: boolean };
  const orderId = body.orderId;
  if (typeof orderId !== "number" || !Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "orderId is required and must be a positive integer" }, { status: 400 });
  }
  const customerId = body.customerId;
  if (customerId !== null && (typeof customerId !== "number" || !Number.isInteger(customerId) || customerId <= 0)) {
    return NextResponse.json({ error: "customerId must be a positive integer, or null to clear" }, { status: 400 });
  }
  const target: ShipToTarget = customerId === null ? { kind: "reset" } : { kind: "dealer", customerId };

  if (body.preview === true) return previewResponse(tripId, orderId, target);
  return writeResponse(await runWrite(tripId, orderId, target, changedById));
}

async function previewResponse(tripId: number, orderId: number, target: ShipToTarget): Promise<NextResponse> {
  const plan = await planTripShipTo(tripId, orderId, target);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });
  return NextResponse.json({ preview: plan.preview });
}

async function runWrite(tripId: number, orderId: number, target: ShipToTarget, changedById: number): Promise<TripShipToResult> {
  try {
    return await setTripShipTo({ tripId, orderId, target, changedById });
  } catch (err) {
    console.error(`[floor/trips/ship-to] save failed for order ${orderId} on trip ${tripId}:`, err);
    return { ok: false, status: 500, error: "The ship-to could not be saved. Please try again." };
  }
}

function writeResponse(r: TripShipToResult, extra: Record<string, unknown> = {}): NextResponse {
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ changed: r.changed, preview: r.preview, toDropId: r.toDropId, oldStopClosed: r.oldStopClosed, ...extra });
}

/**
 * The modal's save — /api/floor/ship-to's order: validate EVERYTHING (here the
 * trip plan, which carries every refusal) → upload + record copies → the
 * write → on failure delete the NEW copies → soft-remove the ✕'d copies.
 */
async function saveFromModal(req: Request, tripId: number, changedById: number): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const idRaw = typeof form.get("orderId") === "string" ? String(form.get("orderId")).trim() : "";
  const orderId = Number(idRaw);
  if (!/^\d+$/.test(idRaw) || orderId <= 0 || orderId > 2147483647) {
    return NextResponse.json({ error: "orderId is required and must be a positive integer" }, { status: 400 });
  }
  const isPreview = String(form.get("preview") ?? "") === "1";

  const parsed = await parseShipToForm(form);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const r = parsed.req;
  const target: ShipToTarget =
    r.mode === "dealer"
      ? { kind: "dealer", customerId: r.customerId }
      : r.mode === "typed"
        ? { kind: "typed", text: r.text, areaId: r.areaId }
        : { kind: "reset" };

  // Every refusal BEFORE anything is uploaded (setTripShipTo re-checks).
  const plan = await planTripShipTo(tripId, orderId, target);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });
  if (isPreview) return NextResponse.json({ preview: plan.preview });

  const files = r.mode === "typed" ? r.files : [];
  const removeCopyIds = r.mode === "typed" ? r.removeCopyIds : [];
  if (r.mode === "typed") {
    const notMine = await checkRemovable(removeCopyIds, "floor", orderId);
    if (notMine !== null) return NextResponse.json({ error: notMine.error }, { status: notMine.status });

    const ownAfter = (await countActiveOwnCopies("floor", orderId)) - removeCopyIds.length + files.length;
    if (ownAfter > MAX_ACTIVE_COPIES) {
      return NextResponse.json(
        { error: `At most ${MAX_ACTIVE_COPIES} copies per bill — remove one before adding another.` },
        { status: 409 },
      );
    }
    if (r.asPerChallan) {
      const billingAfter = await countBillingCopiesVisible({
        soNumber: plan.bill.soNumber,
        shipToOverrideCustomerId: null,
        shipToText: r.text,
        shipToAreaId: r.areaId,
      });
      if (ownAfter + billingAfter < 1) {
        return NextResponse.json({ error: "As per challan needs the challan copy attached." }, { status: 400 });
      }
    }
  }

  const rec = await uploadAndRecordCopies({
    files,
    owner: "floor",
    ownerId: orderId,
    soNumber: plan.bill.soNumber,
    uploadedById: changedById,
  });
  if (!rec.ok) return NextResponse.json({ error: rec.error }, { status: rec.status });

  const result = await runWrite(tripId, orderId, target, changedById);
  if (!result.ok) {
    await discardNewCopies(rec.ids, rec.paths);
    return writeResponse(result);
  }

  // The ✕'d copies go only once the save landed, so a failed save hides nothing.
  let copiesRemoved = 0;
  if (removeCopyIds.length > 0) {
    copiesRemoved = await softRemoveCopies(
      { ...activeOwnCopiesWhere("floor", orderId), id: { in: removeCopyIds } },
      changedById,
    );
  }
  return writeResponse(result, { copiesAdded: rec.ids, copiesRemoved });
}
