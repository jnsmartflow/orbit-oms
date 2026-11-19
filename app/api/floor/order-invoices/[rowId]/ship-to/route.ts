import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { parsePartShipToForm } from "@/lib/ship-to/parse-form";
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
import { checkPartShipTo, setPartShipTo, type PartShipToResult, type PartShipToTarget } from "@/lib/order-invoices/ship-to";

export const dynamic = "force-dynamic";

// POST /api/floor/order-invoices/[rowId]/ship-to — change ONE PART's ship-to
// (per-part ship-to, Schema v27.81, owner 2026-11-19 — plan
// docs/prompts/drafts/code-plan-2026-11-19-split-load-per-part-ship-to.md §C.1).
// [rowId] = order_invoices.id of a row of an OBD with 2+ rows (a split-load
// part or an Add-invoices row, owner Q8). The part writer
// (lib/order-invoices/ship-to.ts setPartShipTo) owns every rule: it decides on
// its own whether the part is on a trip (and moves it to its new shop's stop)
// or not (one row write, orders untouched).
//
// multipart/form-data — the shared ship-to modal's fields (lib/ship-to/
// parse-form.ts parsePartShipToForm): mode dealer | typed | reset | inherit,
// customerId, text, asPerChallan, areaId, files, removeCopyIds.
//   reset   = this part goes to SAP's own site (its OWN reset)
//   inherit = "Same as the bill" — the part drops its own ship-to
//
// Copies attached here belong to THIS PART (ship_to_copies."orderInvoiceId");
// the part has its own cap of MAX_ACTIVE_COPIES. Floor may view the SO's
// Billing copies but never remove one (checkRemovable → 403).
//
// Nothing in the UI calls this yet (batch 4 wires the modal). Gate: floor
// canEdit. Sequential awaits, never prisma.$transaction (CORE §3).

export async function POST(
  req: Request,
  { params }: { params: { rowId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // session.user.id is a numeric string (lib/auth.ts) — never changedById: 0.
  const changedById = Number(session.user.id);
  if (!Number.isInteger(changedById) || changedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const idRaw = String(params.rowId ?? "").trim();
  const rowId = Number(idRaw);
  if (!/^\d+$/.test(idRaw) || rowId <= 0 || rowId > 2147483647) {
    return NextResponse.json({ error: "Invalid invoice row id" }, { status: 400 });
  }

  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "Send the ship-to form (multipart/form-data)" }, { status: 415 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const parsed = await parsePartShipToForm(form);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const r = parsed.req;
  const target: PartShipToTarget =
    r.mode === "dealer"
      ? { kind: "dealer", customerId: r.customerId }
      : r.mode === "typed"
        ? { kind: "typed", text: r.text, areaId: r.areaId }
        : r.mode === "inherit"
          ? { kind: "inherit" }
          : { kind: "reset" };

  // Every refusal and the target check BEFORE anything is uploaded
  // (setPartShipTo re-runs them).
  const check = await checkPartShipTo(rowId, target);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const orderId = check.orderId;

  const files = r.mode === "typed" ? r.files : [];
  const removeCopyIds = r.mode === "typed" ? r.removeCopyIds : [];
  if (r.mode === "typed") {
    // Only this part's own copies — an OBD copy or a Billing (SO) copy is not removable here.
    const notMine = await checkRemovable(removeCopyIds, "floor", orderId, rowId);
    if (notMine !== null) return NextResponse.json({ error: notMine.error }, { status: notMine.status });

    const ownAfter = (await countActiveOwnCopies("floor", orderId, rowId)) - removeCopyIds.length + files.length;
    if (ownAfter > MAX_ACTIVE_COPIES) {
      return NextResponse.json(
        { error: `At most ${MAX_ACTIVE_COPIES} copies per part — remove one before adding another.` },
        { status: 409 },
      );
    }
    // 🔴 SERVER-SIDE copy rule, as Floor's bill route: As per challan needs a
    // copy — the part's own after the save, or the SO's Billing copy that
    // will show on this ship-to (the one visibility rule).
    if (r.asPerChallan) {
      const billingAfter = await countBillingCopiesVisible({
        soNumber: check.soNumber,
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
    soNumber: check.soNumber,
    uploadedById: changedById,
    orderInvoiceId: rowId,
  });
  if (!rec.ok) return NextResponse.json({ error: rec.error }, { status: rec.status });

  let result: PartShipToResult;
  try {
    result = await setPartShipTo({ rowId, target, changedById });
  } catch (err) {
    console.error(`[floor/order-invoices/ship-to] save failed for invoice row ${rowId}:`, err);
    result = { ok: false, status: 500, error: "The ship-to could not be saved. Please try again." };
  }
  if (!result.ok) {
    await discardNewCopies(rec.ids, rec.paths);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // The ✕'d copies go only once the save landed, so a failed save hides nothing.
  let copiesRemoved = 0;
  if (removeCopyIds.length > 0) {
    copiesRemoved = await softRemoveCopies({ ...activeOwnCopiesWhere("floor", orderId, rowId), id: { in: removeCopyIds } }, changedById);
  }

  return NextResponse.json({
    rowId: result.rowId,
    orderId: result.orderId,
    changed: result.changed,
    shipTo: result.shipTo,
    onTrip: result.onTrip,
    copiesAdded: rec.ids,
    copiesRemoved,
  });
}
