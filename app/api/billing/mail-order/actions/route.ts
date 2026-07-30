import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Body = {
  moOrderId?: unknown;
  action?: unknown;
  // slot
  date?: unknown;
  dispatchWindowId?: unknown;
  // shipTo
  customerId?: unknown;
  // hold / urgent
  on?: unknown;
};

/**
 * POST /api/billing/mail-order/actions — the four Floor-style actions on the
 * Billing Orders detail: slot · ship-to · hold · urgent.
 *
 * ONE route for all four, mirroring app/api/floor/actions/route.ts. EXACTLY ONE
 * WRITE per call: a single `mo_orders.update`. Never prisma.$transaction
 * (CORE §3).
 *
 * 🔴 WRITES TO mo_orders, NOT orders — and that is the whole design.
 * When the operator is working, the OBD row does not exist yet: mail arrives →
 * mo_orders → punch → SAP export → orders. So the edit is recorded as INTENT on
 * the mail order, and applyMailOrderEnrichment (app/api/import/obd/route.ts)
 * carries it onto the OBD at import. Every field written here has a matching
 * carry line there — ship-to :269-274, hold :250-252, urgent :256-258, slot the
 * Phase-2 block. A field written here with no carry line is silently dropped.
 *
 * 🔴 UN-PUNCHED ONLY — a punched order is REJECTED with 409.
 * Enrichment is fire-once-per-import, not a sync (it runs only inside import
 * handlers). Once the OBD exists, editing mo_orders changes nothing downstream
 * until that OBD is re-imported — which normally never happens. Rather than
 * silently accept an edit that will not propagate, this route refuses it and the
 * UI renders the buttons disabled with "Punched — manage on Floor Control."
 * The fuller post-import story belongs to the data-audit session; until then,
 * refusing is the honest behaviour. DO NOT relax this guard to "make it work".
 */
export async function POST(req: Request): Promise<NextResponse> {
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

  const body = (await req.json().catch(() => ({}))) as Body;

  const moOrderId = body.moOrderId;
  if (typeof moOrderId !== "number" || !Number.isInteger(moOrderId) || moOrderId <= 0) {
    return NextResponse.json(
      { error: "moOrderId is required and must be a positive integer" },
      { status: 400 },
    );
  }

  const action = body.action;
  if (action !== "slot" && action !== "shipTo" && action !== "hold" && action !== "urgent") {
    return NextResponse.json(
      { error: `Invalid action "${String(action)}" — expected slot | shipTo | hold | urgent` },
      { status: 400 },
    );
  }

  // Sequential awaits only, never prisma.$transaction (CORE §3).
  const mailOrder = await prisma.mo_orders.findUnique({
    where: { id: moOrderId },
    select: { id: true, status: true, soNumber: true, isLocked: true },
  });
  if (!mailOrder) {
    return NextResponse.json({ error: "Mail order not found" }, { status: 404 });
  }

  // The punched gate — see the header block. Same definition the detail view
  // uses for `isPunched` (review-view.tsx renderDetailHeader).
  const isPunched = mailOrder.status === "punched" && !!mailOrder.soNumber;
  if (isPunched) {
    return NextResponse.json(
      {
        error: "This order is already punched — manage it on Floor Control.",
        code: "ALREADY_PUNCHED",
      },
      { status: 409 },
    );
  }

  if (mailOrder.isLocked) {
    return NextResponse.json(
      { error: "This order is locked.", code: "LOCKED" },
      { status: 409 },
    );
  }

  // ── Build the ONE update ────────────────────────────────────────────────
  let data: Record<string, unknown>;

  if (action === "slot") {
    // Both together or both cleared — a date with no window is not a slot, and
    // the enrichment carry requires the pair.
    const { date, dispatchWindowId } = body;
    const clearing = date === null && dispatchWindowId === null;

    if (clearing) {
      data = { dispatchTargetDate: null, dispatchWindowId: null };
    } else {
      if (typeof date !== "string" || !DATE_RE.test(date)) {
        return NextResponse.json(
          { error: "date must be YYYY-MM-DD (or null with dispatchWindowId null to clear)" },
          { status: 400 },
        );
      }
      if (typeof dispatchWindowId !== "number" || !Number.isInteger(dispatchWindowId) || dispatchWindowId <= 0) {
        return NextResponse.json(
          { error: "dispatchWindowId must be a positive integer" },
          { status: 400 },
        );
      }
      // Validate the window up front rather than letting the FK surface as a 500.
      const win = await prisma.dispatch_slot_master.findFirst({
        where: { id: dispatchWindowId, isActive: true },
        select: { id: true },
      });
      if (!win) {
        return NextResponse.json(
          { error: "Unknown or inactive dispatch window" },
          { status: 400 },
        );
      }
      // Explicit 'Z': an offset-less ISO date-time is parsed in the HOST's zone
      // (CORE §3). A date-only column wants a plain calendar day, so pin it to
      // UTC midnight and let @db.Date drop the time.
      data = {
        dispatchTargetDate: new Date(`${date}T00:00:00.000Z`),
        dispatchWindowId,
      };
    }
  } else if (action === "shipTo") {
    const { customerId } = body;
    if (customerId === null) {
      // Explicit clear — drop the redirect entirely.
      data = { shipToOverride: false, shipToOverrideCustomerId: null };
    } else {
      if (typeof customerId !== "number" || !Number.isInteger(customerId) || customerId <= 0) {
        return NextResponse.json(
          { error: "customerId must be a positive integer, or null to clear" },
          { status: 400 },
        );
      }
      const dealer = await prisma.delivery_point_master.findUnique({
        where: { id: customerId },
        select: { id: true },
      });
      if (!dealer) {
        return NextResponse.json({ error: "Unknown customer" }, { status: 400 });
      }
      // The boolean and the id move together: enrichment carries them as a pair
      // (:269-274), and Floor resolves the displayed dealer off the id.
      data = { shipToOverride: true, shipToOverrideCustomerId: customerId };
    }
  } else if (action === "hold") {
    if (typeof body.on !== "boolean") {
      return NextResponse.json({ error: "on must be a boolean" }, { status: 400 });
    }
    // CAPITALISED here on purpose: mo_orders.dispatchStatus defaults to
    // "Dispatch", and enrichment lowercases at the boundary (:250-252) because
    // `orders` holds lowercase. Writing 'hold' here would break that mapping.
    data = { dispatchStatus: body.on ? "Hold" : "Dispatch" };
  } else {
    if (typeof body.on !== "boolean") {
      return NextResponse.json({ error: "on must be a boolean" }, { status: 400 });
    }
    // Two-value mapping, matching the carry at :256-258 — anything not exactly
    // "Urgent" becomes priorityLevel 3. There is no P2.
    data = { dispatchPriority: body.on ? "Urgent" : "Normal" };
  }

  // THE one write.
  const updated = await prisma.mo_orders.update({
    where: { id: moOrderId },
    data,
    select: {
      id: true,
      dispatchStatus: true,
      dispatchPriority: true,
      shipToOverride: true,
      shipToOverrideCustomerId: true,
      dispatchTargetDate: true,
      dispatchWindowId: true,
    },
  });

  return NextResponse.json({ ok: true, moOrder: updated });
}
