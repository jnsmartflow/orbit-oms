import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission, type PageKey } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { billingRefusal, type BillingAction } from "@/lib/billing/refusal";
import { markMoOrderCi, unmarkMoOrderCi } from "@/lib/billing/mo-ci-tag";
import { notifyHandSet } from "@/lib/push/hand";
import { BILLING_CLEAR_HOLD_NOTE, BILLING_HOLD_NOTE } from "@/lib/floor/hold-log";
import { FLOOR_CLEAR_HOLD_STAGES } from "@/lib/floor/release-stages";
import { findLiveCi, liveCiRefusal } from "@/lib/ci/live-ci";

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
  // hold / urgent / hand / ci
  on?: unknown;
};

type Action = "slot" | "shipTo" | "hold" | "urgent" | "hand" | "ci";
const ACTIONS: readonly Action[] = ["slot", "shipTo", "hold", "urgent", "hand", "ci"];

/** Log notes for the per-bill writes (2026-09-24). Hold / Release use the
 *  shared constants in lib/floor/hold-log.ts — the Hold tab reads those. */
const HAND_SET_NOTE = "Hand — dealer collects";
const HAND_CLEAR_NOTE = "Hand cleared";

/** One bill the per-bill write did NOT change, and why — reported to the bar. */
interface BillOutcome {
  orderId: number;
  obdNumber: string;
  reason: string;
}

/**
 * POST /api/billing/mail-order/actions — the Billing Orders-tab actions on ONE
 * mail order: slot · ship-to · hold · urgent · hand · ci.
 *
 * 🔴 TWO WRITES, IN THIS ORDER (sequential awaits, never $transaction, CORE §3):
 *
 *   1. mo_orders — the INTENT, always first and always saved. When the operator
 *      is working the OBD usually does not exist yet (mail → mo_orders → punch
 *      → SAP → orders), and applyMailOrderEnrichment (app/api/import/obd/
 *      route.ts) carries the intent onto the OBD at import. CI is the exception
 *      in shape: its intent is mo_orders.billOnlyAt PLUS an so_tags 'ci' row
 *      (lib/billing/mo-ci-tag.ts, design §3.2/§3.6).
 *
 *   2. orders — PER BILL (2026-09-24, design §6, gate G9, re-gate R7). Was one
 *      `updateMany` by SO with no stage filter, which rewrote picked, dispatched
 *      and cancelled bills alike and held without heldAt or a log. Now: read
 *      every live bill on the SO, apply billingRefusal (lib/billing/refusal.ts),
 *      skip a repeat press, then ONE orders.update + ONE order_status_logs row
 *      per bill — the Floor actions contract.
 *        hold    → dispatchStatus 'hold' + heldAt (obdEmailDate ?? now) + BILLING_HOLD_NOTE
 *        release → FLOOR_CLEAR_HOLD_STAGES rule ('dispatch' or null) + BILLING_CLEAR_HOLD_NOTE;
 *                  refused on a bill with a live FULL CI (Floor's Release rule)
 *        urgent / slot / shipTo → the same values as before, now per bill
 *        hand    → handAt/handById (+ clear); newly marked bills → notifyHandSet
 *        ci      → NOTHING here: markMoOrderCi already applied the tag to the
 *                  bills on the SO (the CI + cancel happen in the tag hook)
 *
 * 🔴 ONE OF THREE (design §2). Hold, Hand and CI exclude each other. Setting
 * one clears the other two — on the mail order, and on the bills for Hold /
 * Hand — and clearing the OTHER mark on a bill follows THAT mark's refusals
 * (a Hand bill on a trip cannot be put on Hold here: its Hand cannot be
 * cleared while it is on a trip). Setting Hold or Hand on a CI-marked mail
 * order first un-marks the CI, which is REFUSED once the CI tag has matched a
 * bill — then nothing is saved and the answer is 409.
 *
 * 🔴 RESPONSE. 200 `{ ok, moOrder, updated, skipped, failed, ordersUpdated }`
 * whenever write 1 landed — even if every bill was refused — because billing's
 * client treats any non-2xx as "nothing changed", and write 1 DID change. The
 * bar shows the new state plus the refused bills. 4xx only when nothing was
 * saved (bad input, no permission, LOCKED, a CI refusal).
 *
 * 🔴 THE soNumber GUARD IS LOAD-BEARING. `where: { soNumber: null }` would match
 * every un-punched order. Write 2 is skipped entirely for a blank SO.
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

  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;

  const moOrderId = body.moOrderId;
  if (typeof moOrderId !== "number" || !Number.isInteger(moOrderId) || moOrderId <= 0) {
    return NextResponse.json(
      { error: "moOrderId is required and must be a positive integer" },
      { status: 400 },
    );
  }

  const action = body.action as Action;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `Invalid action "${String(body.action)}" — expected ${ACTIONS.join(" | ")}` },
      { status: 400 },
    );
  }

  // ── PER-ACTION GATE — the real lock ──────────────────────────────────────
  // One page key per button, so the owner can grant Slot without Hold. Checked
  // after the action name, before any read or write. Set and clear share one
  // key, so nobody can create a state they cannot undo. Hiding a button is not
  // the lock — anyone can post here. `mail_orders` canEdit above stays the outer
  // gate; both must pass. A refusal writes nothing and no audit line.
  const ACTION_KEY: Record<Action, PageKey> = {
    hold:   "billing_hold",
    slot:   "billing_slot",
    urgent: "billing_urgent",
    shipTo: "billing_ship_to",
    hand:   "billing_hand",
    ci:     "billing_ci",
  };
  const ACTION_REFUSAL: Record<Action, string> = {
    hold:   "You do not have permission to hold or release a bill from Billing.",
    slot:   "You do not have permission to change the dispatch slot from Billing.",
    urgent: "You do not have permission to change urgency from Billing.",
    shipTo: "You do not have permission to change the ship-to dealer from Billing.",
    hand:   "You do not have permission to mark a bill Hand (dealer collects) from Billing.",
    ci:     "You do not have permission to mark a bill CI (bill-only) from Billing.",
  };
  if (!(await checkAnyPermission(roles, ACTION_KEY[action], "canEdit"))) {
    return NextResponse.json({ error: ACTION_REFUSAL[action] }, { status: 403 });
  }

  const mailOrder = await prisma.mo_orders.findUnique({
    where: { id: moOrderId },
    select: { id: true, status: true, soNumber: true, isLocked: true, billOnlyAt: true },
  });
  if (!mailOrder) {
    return NextResponse.json({ error: "Mail order not found" }, { status: 404 });
  }
  if (mailOrder.isLocked) {
    return NextResponse.json({ error: "This order is locked.", code: "LOCKED" }, { status: 409 });
  }

  // ── Validate the payload and build write 1 (mo_orders) ──────────────────
  // `data` is the mail order's intent. The per-bill write below reads `action`,
  // `on` and the slot / ship-to values directly.
  let data: Record<string, unknown> = {};
  let on = false; // hold / urgent / hand / ci; slot + shipTo use their own values
  let slotDate: Date | null = null;
  let slotWindowId: number | null = null;
  let slotWindowLabel = "";
  let shipToCustomerId: number | null = null;

  if (action === "slot") {
    // Both together or both cleared — a date with no window is not a slot.
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
        return NextResponse.json({ error: "dispatchWindowId must be a positive integer" }, { status: 400 });
      }
      const win = await prisma.dispatch_slot_master.findFirst({
        where: { id: dispatchWindowId, isActive: true },
        select: { id: true, windowTime: true },
      });
      if (!win) {
        return NextResponse.json({ error: "Unknown or inactive dispatch window" }, { status: 400 });
      }
      // Explicit 'Z' — an offset-less ISO string is read in the HOST's zone (CORE §3).
      slotDate = new Date(`${date}T00:00:00.000Z`);
      slotWindowId = dispatchWindowId;
      slotWindowLabel = win.windowTime;
      data = { dispatchTargetDate: slotDate, dispatchWindowId };
    }
  } else if (action === "shipTo") {
    const { customerId } = body;
    if (customerId === null) {
      data = { shipToOverride: false, shipToOverrideCustomerId: null };
    } else {
      if (typeof customerId !== "number" || !Number.isInteger(customerId) || customerId <= 0) {
        return NextResponse.json({ error: "customerId must be a positive integer, or null to clear" }, { status: 400 });
      }
      const dealer = await prisma.delivery_point_master.findUnique({ where: { id: customerId }, select: { id: true } });
      if (!dealer) return NextResponse.json({ error: "Unknown customer" }, { status: 400 });
      shipToCustomerId = customerId;
      // The boolean and the id move together (enrichment carries them as a pair).
      data = { shipToOverride: true, shipToOverrideCustomerId: customerId };
    }
  } else {
    if (typeof body.on !== "boolean") {
      return NextResponse.json({ error: "on must be a boolean" }, { status: 400 });
    }
    on = body.on;
    if (action === "hold") {
      // ⚠ THE CASE DIFFERS BETWEEN THE TABLES (CORE §13): mo_orders is
      // CAPITALISED ("Dispatch" is its default), orders is lowercase.
      data = { dispatchStatus: on ? "Hold" : "Dispatch" };
      if (on) data = { ...data, handAt: null, handById: null }; // one of three
    } else if (action === "urgent") {
      data = { dispatchPriority: on ? "Urgent" : "Normal" };
    } else if (action === "hand") {
      data = on
        ? { handAt: new Date(), handById: userId, dispatchStatus: "Dispatch" } // one of three
        : { handAt: null, handById: null };
    }
    // ci: written by markMoOrderCi / unmarkMoOrderCi below.
  }

  // ── ONE OF THREE: Hold or Hand SET on a CI-marked mail order un-marks the CI
  // first. Refused once the CI tag has matched a bill → nothing is saved.
  const settingOther = (action === "hold" || action === "hand") && on;
  if (settingOther && mailOrder.billOnlyAt !== null) {
    const r = await unmarkMoOrderCi({ moOrderId, userId, now: new Date() });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  }

  // ── WRITE 1 — the intent, on the mail order. ─────────────────────────────
  let ciInfo: { tag: string | null; applied: unknown } | null = null;
  if (action === "ci") {
    const now = new Date();
    const r = on
      ? await markMoOrderCi({ moOrderId, userId, now })
      : await unmarkMoOrderCi({ moOrderId, userId, now });
    // 🔴 A refused CI press saves NOTHING (the mark stays as it was) — 409 / 404.
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    ciInfo = { tag: r.tag, applied: r.applied };
    // One of three: a CI-marked mail order is neither held nor Hand.
    if (on) data = { dispatchStatus: "Dispatch", handAt: null, handById: null };
  }

  const MO_SELECT = {
    id: true,
    dispatchStatus: true,
    dispatchPriority: true,
    shipToOverride: true,
    shipToOverrideCustomerId: true,
    dispatchTargetDate: true,
    dispatchWindowId: true,
    handAt: true,
    billOnlyAt: true,
  } as const;
  const updated =
    Object.keys(data).length > 0
      ? await prisma.mo_orders.update({ where: { id: moOrderId }, data, select: MO_SELECT })
      : await prisma.mo_orders.findUniqueOrThrow({ where: { id: moOrderId }, select: MO_SELECT });

  // ── WRITE 2 — per bill, if any exist yet. ────────────────────────────────
  const updatedIds: number[] = [];
  const skipped: BillOutcome[] = [];
  const failed: BillOutcome[] = [];
  const newlyHand: number[] = [];

  const soNumber = mailOrder.soNumber?.trim();
  if (soNumber && action !== "ci") {
    const bills = await prisma.orders.findMany({
      // isRemoved: false — soft-delete read rule (CORE §3).
      where: { soNumber, isRemoved: false },
      orderBy: { id: "asc" },
      select: {
        id: true,
        obdNumber: true,
        workflowStage: true,
        dispatchStatus: true,
        obdEmailDate: true,
        priorityLevel: true,
        dispatchTargetDate: true,
        dispatchWindowId: true,
        dispatchSlotSource: true,
        shipToOverride: true,
        shipToOverrideCustomerId: true,
        handAt: true,
        tripDropId: true,
        tripDrop: { select: { trip: { select: { tripNumber: true } } } },
      },
    });

    for (const bill of bills) {
      try {
        const refusalBill = {
          workflowStage: bill.workflowStage,
          isRemoved: false,
          tripDropId: bill.tripDropId,
          tripNumber: bill.tripDrop?.trip.tripNumber ?? null,
        };
        const refuse = (a: BillingAction, mode: "set" | "clear"): string | null => billingRefusal(a, refusalBill, mode);

        let update: Record<string, unknown> | null = null;
        let note = "";
        let refusal: string | null = null;
        let isRepeat = false;

        if (action === "hold") {
          if (on) {
            refusal = refuse("hold", "set");
            // One of three: clearing this bill's Hand follows Hand's refusals.
            if (refusal === null && bill.handAt !== null) refusal = refuse("hand", "clear");
            isRepeat = bill.dispatchStatus === "hold" && bill.handAt === null;
            // heldAt = the ARRIVAL date, as every hold path writes it (CLAUDE_FLOOR §4.5).
            update = { dispatchStatus: "hold", heldAt: bill.obdEmailDate ?? new Date(), handAt: null, handById: null };
            note = BILLING_HOLD_NOTE;
          } else {
            refusal = refuse("hold", "clear");
            isRepeat = bill.dispatchStatus !== "hold";
            if (refusal === null && !isRepeat) {
              const ci = await findLiveCi(bill.id);
              if (ci !== null) refusal = liveCiRefusal(ci, "released");
            }
            // Floor's unhold rule: 'dispatch' back only at a stage the bill reached
            // by being sent to the floor; anything else → null (a 'dispatch' there
            // leaves a bill no screen shows). Dispatched / cancelled → null.
            update = { dispatchStatus: FLOOR_CLEAR_HOLD_STAGES.includes(bill.workflowStage) ? "dispatch" : null };
            note = BILLING_CLEAR_HOLD_NOTE;
          }
        } else if (action === "urgent") {
          refusal = refuse("urgent", on ? "set" : "clear");
          const level = on ? 1 : 3;
          isRepeat = bill.priorityLevel === level;
          update = { priorityLevel: level };
          note = on ? "Marked urgent from billing (P1)" : "Cleared urgent from billing";
        } else if (action === "slot") {
          const clearing = slotDate === null;
          refusal = refuse("slot", clearing ? "clear" : "set");
          if (clearing) {
            isRepeat = bill.dispatchTargetDate === null && bill.dispatchWindowId === null;
            // Back to the rules engine: its guard skips anything still 'manual'.
            update = { dispatchTargetDate: null, dispatchWindowId: null, dispatchSlotSource: null };
            note = "Dispatch slot cleared from billing";
          } else {
            isRepeat =
              bill.dispatchTargetDate?.getTime() === slotDate!.getTime() &&
              bill.dispatchWindowId === slotWindowId &&
              bill.dispatchSlotSource === "manual";
            // Identical shape to Floor's change-slot.
            update = { dispatchTargetDate: slotDate, dispatchWindowId: slotWindowId, dispatchSlotSource: "manual" };
            note = `Dispatch slot changed from billing to ${body.date as string} ${slotWindowLabel}`;
          }
        } else if (action === "shipTo") {
          const clearing = shipToCustomerId === null;
          refusal = refuse("shipTo", clearing ? "clear" : "set");
          isRepeat = clearing
            ? bill.shipToOverrideCustomerId === null && !bill.shipToOverride
            : bill.shipToOverrideCustomerId === shipToCustomerId && bill.shipToOverride;
          update = clearing
            ? { shipToOverride: false, shipToOverrideCustomerId: null }
            : { shipToOverride: true, shipToOverrideCustomerId: shipToCustomerId };
          note = clearing ? "Ship-to redirect cleared from billing" : "Ship-to changed from billing";
        } else if (action === "hand") {
          refusal = refuse("hand", on ? "set" : "clear");
          if (on) {
            isRepeat = bill.handAt !== null && bill.dispatchStatus !== "hold";
            update = { handAt: new Date(), handById: userId };
            // One of three: a held bill is released by the Hand press, by the
            // same stage rule — and not if it carries a live full CI.
            if (refusal === null && !isRepeat && bill.dispatchStatus === "hold") {
              const ci = await findLiveCi(bill.id);
              if (ci !== null) refusal = liveCiRefusal(ci, "released");
              update.dispatchStatus = FLOOR_CLEAR_HOLD_STAGES.includes(bill.workflowStage) ? "dispatch" : null;
            }
            note = HAND_SET_NOTE;
          } else {
            isRepeat = bill.handAt === null;
            update = { handAt: null, handById: null };
            note = HAND_CLEAR_NOTE;
          }
        }

        if (refusal !== null) {
          failed.push({ orderId: bill.id, obdNumber: bill.obdNumber, reason: refusal });
          continue;
        }
        if (isRepeat || update === null) {
          skipped.push({ orderId: bill.id, obdNumber: bill.obdNumber, reason: "already set" });
          continue;
        }

        // ONE orders.update + ONE log per bill (the live-sync markers key on
        // MAX(orders.updatedAt) — a second write fires a false "changed").
        await prisma.orders.update({ where: { id: bill.id }, data: update });
        await prisma.order_status_logs.create({
          data: {
            orderId: bill.id,
            fromStage: bill.workflowStage,
            // No action here moves a stage; the NOTE identifies the event.
            toStage: bill.workflowStage,
            changedById: userId,
            note,
          },
        });
        updatedIds.push(bill.id);
        if (action === "hand" && on && bill.handAt === null) newlyHand.push(bill.id);
      } catch (err) {
        failed.push({
          orderId: bill.id,
          obdNumber: bill.obdNumber,
          reason: err instanceof Error ? err.message : "Unexpected error",
        });
      }
    }
  }

  // Hand set → the supervisors hear about it (awaited, swallowed).
  if (newlyHand.length > 0) await notifyHandSet(newlyHand, userId);

  return NextResponse.json({
    ok: true,
    moOrder: updated,
    updated: updatedIds,
    skipped,
    failed,
    // Kept for the existing callers (the ribbon, the pencil): how many live
    // bills this press actually changed.
    ordersUpdated: updatedIds.length,
    ...(ciInfo !== null ? { ci: ciInfo } : {}),
  });
}
