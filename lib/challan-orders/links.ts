// lib/challan-orders/links.ts
//
// PASTE SO / UNLINK — the two writes of the shared Challan orders screen
// (Challan orders slice 5, 2026-10-07; plan code-plan-2026-10-07-challan-slice5.md
// §2–§4; owner S5-2). Callers: POST /api/challan-orders/links (pasteSo),
// POST /api/challan-orders/links/[id]/unlink (unlinkSo). The routes check the
// session and challan_orders canEdit (plan check 1) before calling.
//
// Writes ONLY challan_order_so_links — never `orders`. Its live_changes triggers
// (v27.60, parent = the ORB order) announce every write. Sequential awaits, never
// prisma.$transaction (CORE §3). Nothing is ever deleted: an unlink is a status.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normaliseSoNumber } from "@/lib/billing/telephonic-so";

const CANCELLED = "cancelled";

export type PasteSoResult =
  | { ok: true; linkId: number }
  | { ok: false; warning: true; code: "DEALER_MISMATCH"; error: string; status: 409 }
  | { ok: false; warning?: false; code: string; error: string; status: number };

function refuse(code: string, error: string, status: number): PasteSoResult {
  return { ok: false, code, error, status };
}

/** The live link (waiting | linked) on this SO, with its ORB number, or null. */
async function liveLinkOf(soNumber: string) {
  return prisma.challan_order_so_links.findFirst({
    where: { soNumber, status: { not: "unlinked" } },
    select: { id: true, orbOrderId: true, orbOrder: { select: { obdNumber: true } } },
  });
}

/**
 * Paste one SO against one ORB order → a 'waiting' link (plan §2, checks 2–7 in
 * order; check 1 is the route's). NOTHING is written until every check passes.
 */
export async function pasteSo(args: {
  orbOrderId: number;
  soNumber: string;
  userId: number;
  confirmDealerMismatch: boolean;
}): Promise<PasteSoResult> {
  // 2. The SO — exactly 10 digits, the rule chk_challan_order_so_links_so_shape enforces.
  const soNumber = normaliseSoNumber(typeof args.soNumber === "string" ? args.soNumber : "");
  if (soNumber === null) return refuse("BAD_SO", "SO must be exactly 10 digits.", 400);

  // 3. The ORB order — exists, a challan, not removed, not cancelled.
  const orb = await prisma.orders.findUnique({
    where: { id: args.orbOrderId },
    select: {
      id: true,
      obdNumber: true,
      isChallanOrder: true,
      isRemoved: true,
      workflowStage: true,
      customer: { select: { customerCode: true, customerName: true } },
    },
  });
  if (!orb || orb.isRemoved || !orb.isChallanOrder) return refuse("NOT_FOUND", "Challan order not found.", 404);
  if (orb.workflowStage === CANCELLED) {
    return refuse("CANCELLED", `${orb.obdNumber} is cancelled — nothing to link.`, 409);
  }

  // 4. F5 — one SO → one challan among non-unlinked rows. The partial unique
  // challan_order_so_links_soNumber_live_key is the real lock (step 7).
  const existing = await liveLinkOf(soNumber);
  if (existing !== null) {
    return refuse(
      "ALREADY_LINKED",
      existing.orbOrderId === orb.id
        ? `SO ${soNumber} is already on ${orb.obdNumber}.`
        : `SO ${soNumber} already linked to ${existing.orbOrder.obdNumber}.`,
      409,
    );
  }

  // 5. LATE PASTE — the SO's OBD is already in Orbit (plan §3: REFUSE). The import
  // catch (slice 6) only sees NEW OBDs, so a 'waiting' row here would never be
  // acted on while that OBD is picked and loaded — a double dispatch. A cancelled
  // OBD ships nothing, so it does not block the paste.
  const obd = await prisma.orders.findFirst({
    where: { soNumber, isRemoved: false, isChallanOrder: false, workflowStage: { not: CANCELLED } },
    orderBy: { id: "asc" },
    select: { obdNumber: true, workflowStage: true },
  });
  if (obd !== null) {
    return refuse(
      "LATE_PASTE",
      `SO ${soNumber} already has OBD ${obd.obdNumber} in Orbit (${obd.workflowStage}). Linking it now could ship ` +
        `the goods twice — tell the floor supervisor; this is handled once the import safety net is live.`,
      409,
    );
  }

  // 6. Dealer guard (F1b) — what CAN be checked at paste: a mail order carrying
  // this SO. S5-2: a mismatch WARNS; a second request with confirmDealerMismatch
  // links anyway. The authoritative check is at import, against the SAP OBD's
  // bill-to (slice 6). No mail order → the SO's customer is unknown; nothing here.
  if (!args.confirmDealerMismatch) {
    const mail = await prisma.mo_orders.findFirst({
      where: { soNumber, customerCode: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { customerCode: true, customerName: true },
    });
    const billToCode = orb.customer?.customerCode ?? null;
    if (mail !== null && billToCode !== null && mail.customerCode !== billToCode) {
      return {
        ok: false,
        warning: true,
        code: "DEALER_MISMATCH",
        status: 409,
        error:
          `SO ${soNumber} is for ${mail.customerName ?? "another dealer"} (${mail.customerCode}) — ` +
          `challan ${orb.obdNumber} is for ${orb.customer?.customerName ?? billToCode} (${billToCode}).`,
      };
    }
  }

  // 7. The write — one 'waiting' row. A P2002 is a race on the partial unique.
  try {
    const row = await prisma.challan_order_so_links.create({
      data: { orbOrderId: orb.id, soNumber, status: "waiting", linkedById: args.userId },
      select: { id: true },
    });
    return { ok: true, linkId: row.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await liveLinkOf(soNumber);
      return refuse(
        "ALREADY_LINKED",
        `SO ${soNumber} already linked to ${raced?.orbOrder.obdNumber ?? "another challan order"}.`,
        409,
      );
    }
    throw err;
  }
}

export type UnlinkSoResult =
  | { ok: true; alreadyUnlinked: boolean }
  | { ok: false; error: string; status: number };

/**
 * Unlink one pasted SO (M5) — ONLY while 'waiting'. A guarded updateMany, so a
 * row that turned 'linked' between the read and the write is left alone.
 */
export async function unlinkSo(args: { linkId: number; userId: number }): Promise<UnlinkSoResult> {
  const row = await prisma.challan_order_so_links.findUnique({
    where: { id: args.linkId },
    select: { id: true, status: true, soNumber: true },
  });
  if (!row) return { ok: false, error: "Link not found.", status: 404 };
  if (row.status === "unlinked") return { ok: true, alreadyUnlinked: true };
  if (row.status === "linked") {
    return { ok: false, error: `SO ${row.soNumber} already has its OBD — it cannot be unlinked here.`, status: 409 };
  }
  const res = await prisma.challan_order_so_links.updateMany({
    where: { id: args.linkId, status: "waiting" },
    data: { status: "unlinked", unlinkedById: args.userId, unlinkedAt: new Date() },
  });
  if (res.count > 0) return { ok: true, alreadyUnlinked: false };
  const again = await prisma.challan_order_so_links.findUnique({ where: { id: args.linkId }, select: { status: true } });
  if (again?.status === "linked") {
    return { ok: false, error: `SO ${row.soNumber} already has its OBD — it cannot be unlinked here.`, status: 409 };
  }
  return { ok: true, alreadyUnlinked: true };
}
