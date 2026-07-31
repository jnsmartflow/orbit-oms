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
 * 🔴 DUAL-WRITE — this is what makes the actions work AFTER punch (2026-07-31).
 * Enrichment is fire-once-per-import, not a sync, so once the OBD exists an edit
 * to mo_orders alone changes nothing downstream. Every action therefore writes
 * BOTH sides, sequentially (never $transaction, CORE §3):
 *
 *   1. mo_orders  — the intent. Carries to orders at import for bills whose OBD
 *                   does not exist yet.
 *   2. orders     — updateMany WHERE soNumber, so an OBD that ALREADY exists is
 *                   updated in place. Matches 0 rows pre-import (harmless: the
 *                   mo_orders carry covers that case) and N rows after.
 *
 * One soNumber can map to SEVERAL OBDs (split bills). updateMany writes all of
 * them — intended, confirmed 2026-07-31.
 *
 * ⚠ The orders write is SKIPPED ENTIRELY when soNumber is null/blank. A
 * `where: { soNumber: null }` would match every un-punched order in the table
 * and rewrite all of them. The guard below is not defensive tidiness — without
 * it this route is a mass-update bug.
 *
 * This supersedes the earlier "refuse punched orders with 409 ALREADY_PUNCHED"
 * rule (design spec §4.5). The four actions are ALWAYS available now.
 *
 * ⚠ orders.updatedAt moves on the second write, so the picking/floor/billing
 * markers will see a change and refetch. That is correct — the bill genuinely
 * changed — and it is ONE write on a NEW path, not a second write added to an
 * existing one (the marker landmine in CORE §3 is about the latter).
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

  // NO punched gate — removed 2026-07-31. A punched order is edited through the
  // dual-write below, not refused. See the header block.

  if (mailOrder.isLocked) {
    return NextResponse.json(
      { error: "This order is locked.", code: "LOCKED" },
      { status: 409 },
    );
  }

  // ── Build BOTH payloads together ────────────────────────────────────────
  // `data` → mo_orders (the intent). `ordersData` → orders (the live OBD).
  // Built side by side deliberately: the two shapes differ in ways that are easy
  // to get wrong apart (case mapping, priority levels), and keeping them in one
  // block makes a divergence visible.
  let data: Record<string, unknown>;
  let ordersData: Record<string, unknown>;

  if (action === "slot") {
    // Both together or both cleared — a date with no window is not a slot, and
    // the enrichment carry requires the pair.
    const { date, dispatchWindowId } = body;
    const clearing = date === null && dispatchWindowId === null;

    if (clearing) {
      data = { dispatchTargetDate: null, dispatchWindowId: null };
      // dispatchSlotSource back to null, NOT left at 'manual': clearing the pick
      // means "hand this bill back to the rules engine", and the engine's guard
      // (import/obd/route.ts:344) skips anything still marked manual.
      ordersData = { dispatchTargetDate: null, dispatchWindowId: null, dispatchSlotSource: null };
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
      const slotDate = new Date(`${date}T00:00:00.000Z`);
      data = { dispatchTargetDate: slotDate, dispatchWindowId };
      // Identical shape to Floor's change-slot (floor/actions/route.ts:111).
      ordersData = { dispatchTargetDate: slotDate, dispatchWindowId, dispatchSlotSource: "manual" };
    }
  } else if (action === "shipTo") {
    const { customerId } = body;
    if (customerId === null) {
      // Explicit clear — drop the redirect entirely.
      data = { shipToOverride: false, shipToOverrideCustomerId: null };
      ordersData = { shipToOverride: false, shipToOverrideCustomerId: null };
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
      ordersData = { shipToOverride: true, shipToOverrideCustomerId: customerId };
    }
  } else if (action === "hold") {
    if (typeof body.on !== "boolean") {
      return NextResponse.json({ error: "on must be a boolean" }, { status: 400 });
    }
    // ⚠ THE CASE DIFFERS BETWEEN THE TWO TABLES — this is the mapping
    // CLAUDE_CORE.md §13 warns about, and the reason both payloads are built
    // here rather than shared. mo_orders.dispatchStatus is CAPITALISED
    // ("Dispatch" is its default); orders.dispatchStatus is LOWERCASE, which is
    // what Floor's feeds filter on (`dispatchStatus: "dispatch"`). Enrichment
    // does the same lowering at :250-252. Writing the wrong case to `orders`
    // silently drops the bill off the live floor board.
    data = { dispatchStatus: body.on ? "Hold" : "Dispatch" };
    // heldAt is deliberately NOT written here — see the note in the response
    // block below.
    ordersData = { dispatchStatus: body.on ? "hold" : "dispatch" };
  } else {
    if (typeof body.on !== "boolean") {
      return NextResponse.json({ error: "on must be a boolean" }, { status: 400 });
    }
    // Two-value mapping on BOTH sides, matching the carry at :256-258 and
    // Floor's mark-urgent (floor/actions/route.ts:107-108): mo_orders holds the
    // WORD, orders holds the LEVEL. Anything not exactly "Urgent" is 3 — no P2.
    data = { dispatchPriority: body.on ? "Urgent" : "Normal" };
    ordersData = { priorityLevel: body.on ? 1 : 3 };
  }

  // ── WRITE 1 of 2 — the intent, on the mail order. ───────────────────────
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

  // ── WRITE 2 of 2 — the live OBD(s), if any exist yet. ───────────────────
  // Sequential await, never $transaction (CORE §3). Ordered second on purpose:
  // if this one fails, the intent is already recorded on the mail order and a
  // re-import would still carry it — the reverse would leave orders updated with
  // no record of why.
  //
  // 🔴 THE soNumber GUARD IS LOAD-BEARING. `where: { soNumber: null }` matches
  // every un-punched order in the table. Never let a blank reach the where.
  const soNumber = mailOrder.soNumber?.trim();
  let ordersUpdated = 0;
  if (soNumber) {
    const res = await prisma.orders.updateMany({
      // isRemoved: false — soft-delete read rule (CORE §3); a removed OBD is not
      // a live bill and must not be silently edited back into shape.
      where: { soNumber, isRemoved: false },
      data: ordersData,
    });
    ordersUpdated = res.count;
  }

  // `ordersUpdated` is information, not an error: 0 is the correct answer before
  // the SAP import exists, and >1 is the correct answer for a split bill.
  return NextResponse.json({ ok: true, moOrder: updated, ordersUpdated });
}
