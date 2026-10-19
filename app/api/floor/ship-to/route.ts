import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import {
  loadShipToBill,
  setShipTo,
  setShipToOverride,
  validateShipToTarget,
  type ShipToResult,
  type ShipToTarget,
} from "@/lib/floor/ship-to";
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

export const dynamic = "force-dynamic";

// POST /api/floor/ship-to — change ONE bill's ship-to (CLAUDE_FLOOR.md §4.4).
// Support retirement step 2/8; typed ship-to + copies 2026-10-19 (free-text
// ship-to P1, design web-update-2026-10-19-ship-to-freetext.md §2-§4).
//
// TWO BODIES, chosen by Content-Type:
//   · application/json  { orderId, customerId: number | null } — the dealer /
//     clear form, unchanged for its existing caller (floor-page.tsx).
//   · multipart/form-data — the shared ship-to modal: orderId + the fields of
//     lib/ship-to/parse-form.ts (mode dealer | typed | reset, text,
//     asPerChallan, areaId, files, removeCopyIds).
//
// Deliberately NOT a copy of PATCH /api/support/orders/[id]: that route carried
// four unrelated fields, a dispatch_change_queue side effect, and a
// prisma.$transaction. This one does a single job with sequential awaits (CORE §3).
//
// Contract per bill (one update, one log, unchanged = nothing written) is owned
// by lib/floor/ship-to.ts setShipTo. That function also REFUSES a bill on a
// trip (409, Billing's wording — owner 2026-10-01).
//
// 🔴 FLOOR WRITES THIS ONE BILL ONLY — never mo_orders, never the SO's other
// bills (design §3). Copies attached here belong to the bill (orderId). Floor
// may VIEW the SO's Billing copies but never remove one → 403 (owner 2026-10-19).

interface Body {
  orderId?: number;
  customerId?: number | null;
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // session.user.id is a numeric string (lib/auth.ts). Require a real positive
  // integer so an empty/absent id can never become changedById: 0.
  const changedById = Number(session.user.id);
  if (!Number.isInteger(changedById) || changedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  if ((req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    return saveFromModal(req, changedById);
  }

  const body = (await req.json().catch(() => ({}))) as Body;

  const orderId = body.orderId;
  if (typeof orderId !== "number" || !Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "orderId is required and must be a positive integer" }, { status: 400 });
  }

  // Absent and null are NOT the same: `undefined` is a malformed body, `null` is
  // an explicit "clear the redirect".
  const customerId = body.customerId === undefined ? undefined : body.customerId;
  if (customerId !== null && (typeof customerId !== "number" || !Number.isInteger(customerId) || customerId <= 0)) {
    return NextResponse.json(
      { error: "customerId must be a positive integer, or null to clear" },
      { status: 400 },
    );
  }

  const r = await setShipToOverride({ orderId, customerId, changedById });
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  return NextResponse.json({ orderId: r.orderId, shipToOverrideCustomerId: r.shipToOverrideCustomerId, changed: r.changed });
}

/**
 * The modal's save. Order: validate EVERYTHING (bill + trip refusal, dealer /
 * area, which copies may be removed, the 3-copy cap, As per challan's copy
 * rule, total size) → upload + record copies → setShipTo → on failure delete
 * the NEW rows + objects → soft-remove the ✕'d copies.
 */
async function saveFromModal(req: Request, changedById: number): Promise<NextResponse> {
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

  const parsed = await parseShipToForm(form);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const r = parsed.req;

  // Refuse a bill on a trip BEFORE anything is uploaded (setShipTo re-checks).
  const loaded = await loadShipToBill(orderId);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  const bill = loaded.order;

  const target: ShipToTarget =
    r.mode === "dealer"
      ? { kind: "dealer", customerId: r.customerId }
      : r.mode === "typed"
        ? { kind: "typed", text: r.text, areaId: r.areaId }
        : { kind: "reset" };
  const bad = await validateShipToTarget(target);
  if (bad !== null) return NextResponse.json({ error: bad.error }, { status: bad.status });

  const files = r.mode === "typed" ? r.files : [];
  const removeCopyIds = r.mode === "typed" ? r.removeCopyIds : [];
  if (r.mode === "typed") {
    // Only this bill's own copies — a Billing (SO) copy is view-only here.
    const notMine = await checkRemovable(removeCopyIds, "floor", orderId);
    if (notMine !== null) return NextResponse.json({ error: notMine.error }, { status: notMine.status });

    const ownAfter = (await countActiveOwnCopies("floor", orderId)) - removeCopyIds.length + files.length;
    if (ownAfter > MAX_ACTIVE_COPIES) {
      return NextResponse.json(
        { error: `At most ${MAX_ACTIVE_COPIES} copies per bill — remove one before adding another.` },
        { status: 409 },
      );
    }
    // 🔴 SERVER-SIDE copy rule. Counts the bill's own copies after the save AND
    // the SO's Billing copies that will STILL show on it after the save (the
    // one visibility rule, lib/ship-to/copies-server.ts) — judged on the
    // bill's state as this save leaves it.
    if (r.asPerChallan) {
      const billingAfter = await countBillingCopiesVisible({
        soNumber: bill.soNumber,
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
    soNumber: bill.soNumber,
    uploadedById: changedById,
  });
  if (!rec.ok) return NextResponse.json({ error: rec.error }, { status: rec.status });

  let result: ShipToResult;
  try {
    result = await setShipTo({ orderId, target, changedById });
  } catch (err) {
    console.error(`[floor/ship-to] save failed for order ${orderId}:`, err);
    result = { ok: false, status: 500, error: "The ship-to could not be saved. Please try again." };
  }
  if (!result.ok) {
    await discardNewCopies(rec.ids, rec.paths);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // The ✕'d copies go only once the save landed, so a failed save hides nothing.
  let copiesRemoved = 0;
  if (removeCopyIds.length > 0) {
    copiesRemoved = await softRemoveCopies(
      { ...activeOwnCopiesWhere("floor", orderId), id: { in: removeCopyIds } },
      changedById,
    );
  }

  return NextResponse.json({
    orderId: result.orderId,
    shipToOverrideCustomerId: result.shipToOverrideCustomerId,
    shipToText: result.shipToText,
    shipToAreaId: result.shipToAreaId,
    changed: result.changed,
    copiesAdded: rec.ids,
    copiesRemoved,
  });
}
