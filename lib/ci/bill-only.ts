// lib/ci/bill-only.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE BILL-ONLY AUTO-CI — A FULL-BILL, MATERIAL-NOT-MOVED RETURN
// ═══════════════════════════════════════════════════════════════════════════
//
// A bill-only order: the sales officer asks for the invoice, but the material
// never leaves the depot, so a CI (Goods Return Note) is raised against the
// same bill with material not moved. The SO carries a 'ci' tag (so_tags) —
// typed on the Billing · Telephonic tab, or written because billing pressed CI
// on a mail order (so_tags.fromMailOrder). When the OBD lands, the import hook
// raises this CI and then takes the bill off the floor.
// Designs: docs/prompts/drafts/web-update-2026-09-21-billing-telephonic-tab.md §5
//          docs/prompts/drafts/web-update-2026-09-24-billing-mo-actions.md §3.3
//
// ONE CALLER: lib/billing/telephonic-apply.ts (applySoTagHolds), reached from
// the four import sites in app/api/import/obd/route.ts and from the late-tag
// paths (lib/billing/telephonic.ts addTelephonicTags, lib/billing/mo-ci-tag.ts).
// Do not wire it from anywhere else — a raise here is followed by the hook's
// cancel, and a raise without that cancel leaves a CI'd bill on the floor.
//
// ── Refusals (all `skipped`, the caller holds the bill for a person) ─────────
//   • a live CI already exists (any source) — see the duplicate guard below
//   • an OPEN DRAFT CI exists on /ci for this bill (Floor Raise CI's own check,
//     app/api/floor/ci/route.ts) — raising here would make the draft, once
//     submitted, a second CI on the same bill
//   • the bill is gone, has no active lines, a line has no quantity, or the
//     reason code is inactive
//
// 🔴 IT NEVER THROWS. The caller runs inside an import, and a throw there would
// break the import for every other bill in the batch. The whole body is
// wrapped: a normal refusal is `skipped` (the caller records the reason on
// so_tag_matches.ciSkipReason), anything unexpected is `failed` and logged
// loudly here.
//
// ── Copied from lib/ci/auto.ts: the WRITE FORM, not the line rule ────────────
// Same form: allocate the number first, ONE nested create at 'submitted' with
// its lines, re-allocate ONCE on P2002. A nested create cannot leave a
// numbered CI with no lines on billing's rail. NOT the same lines: auto.ts is
// a PART return built from confirmed picking findings; this is a FULL return
// of every active line at its delivered quantity (lib/ci/full-bill.ts, shared
// with the manual 'full' path so both write identical rows).
//
// ── Duplicate guard: ANY live CI, ANY source ─────────────────────────────────
// auto.ts looks up its own CI by (orderId + source) because it RECONCILES its
// own document and must not rewrite a hand-raised one. This path CREATES, and a
// second CI on a bill that already has one would double the credit in SAP — so
// any non-voided, non-draft CI on the order stops it, whoever raised it. The
// late-tag case (tag typed after the OBD exists) is exactly where a manual CI
// may already be there. A draft does not count: it is an in-flight write,
// invisible everywhere (CLAUDE_CI.md §2).
//
// Invoice number and date are snapshotted as they stand — usually NULL, since
// the bill is typically raised before SAP invoices it. That is fine and needs no
// back-fill: every read path prefers the LIVE order value (CLAUDE_CI.md §5,
// §13 CI-1).
//
// Sequential awaits only, never prisma.$transaction (CORE §3). The nested
// create is the same accepted form auto.ts uses; add no other wrapper.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { allocateCiNumber } from "@/lib/ci/number";
import { resolveCiDealer } from "@/lib/ci/derive";
import { computeFullBillLines } from "@/lib/ci/full-bill";

/**
 * The reason every bill-only CI is filed under. Looked up BY CODE at write
 * time, never by id: `ci_reason_master` is depot-editable, so an id baked in
 * here would silently file returns under whatever row later took that number.
 * (Live id is 1 today; the code is what identifies it.)
 */
const BILL_ONLY_REASON_CODE = "WRONG_ORDER_BY_SO";

export type BillOnlyCiResult =
  /** reasonLabel — the snapshotted ci_reason_master label, for the caller's
   *  cancel note ("CI raised — {ciNumber} · {reasonLabel}"). */
  | { status: "raised"; ciId: number; ciNumber: string; reasonLabel: string }
  /** A normal refusal — the caller records `reason`. */
  | { status: "skipped"; reason: string }
  /** Unexpected — already logged here with the orderId. */
  | { status: "failed"; error: string };

export async function raiseBillOnlyCi(args: {
  orderId: number;
  /** The billing operator who typed the tag — stored as ci_returns.supervisorId
   *  ("who raised this"). Nothing in the schema or lib/ci requires that user to
   *  hold floor_supervisor. */
  raisedById: number;
}): Promise<BillOnlyCiResult> {
  const { orderId, raisedById } = args;
  try {
    // ── 1. Duplicate guard — ANY live CI on this bill, any source ───────────
    const existing = await prisma.ci_returns.findFirst({
      where: { orderId, isVoided: false, status: { not: "draft" } },
      orderBy: { id: "asc" },
      select: { id: true, ciNumber: true },
    });
    if (existing !== null) {
      return {
        status: "skipped",
        reason: `CI already exists: ${existing.ciNumber ?? `ci #${existing.id}`}`,
      };
    }

    // ── 1b. An open DRAFT on /ci — Floor Raise CI's own check ────────────────
    // A draft is invisible everywhere (CLAUDE_CI.md §2), so the guard above does
    // not see it; but submitting it later would put a SECOND CI on this bill.
    const draft = await prisma.ci_returns.findFirst({
      where: { orderId, isVoided: false, status: "draft" },
      select: { id: true },
    });
    if (draft !== null) {
      return { status: "skipped", reason: "A CI draft is open on /ci for this bill" };
    }

    // ── 2. The bill, and the header snapshot — the same select auto.ts's
    // caller (app/api/picking/findings/confirm/route.ts) makes, so a bill-only
    // CI names the same dealer a manual or finding CI would (CI-5: the ship-to
    // override wins, via resolveCiDealer).
    const order = await prisma.orders.findFirst({
      where: { id: orderId, isRemoved: false },
      select: {
        id: true,
        obdNumber: true,
        invoiceNo: true,
        invoiceDate: true,
        customerId: true,
        shipToCustomerId: true,
        shipToCustomerName: true,
        shipToOverrideCustomer: { select: { customerName: true } },
        customer: { select: { customerName: true } },
        soNumber: true,
      },
    });
    if (order === null) {
      return { status: "skipped", reason: "order not found or removed" };
    }

    // ── 3. Every active line at its delivered quantity ──────────────────────
    const full = await computeFullBillLines(order.obdNumber);
    if (!full.ok) {
      return {
        status: "skipped",
        reason:
          full.reason === "zero_qty"
            ? `zero_qty: lines ${full.lineIds.join(", ")}`
            : "no_lines",
      };
    }

    // ── 4. The reason, by CODE, label snapshotted ───────────────────────────
    // Renaming a reason must not rewrite the history of returns filed under the
    // old wording — the label is copied from this row, never composed here.
    const reason = await prisma.ci_reason_master.findFirst({
      where: { code: BILL_ONLY_REASON_CODE, isActive: true },
      select: { id: true, label: true },
    });
    if (reason === null) {
      return { status: "skipped", reason: `reason ${BILL_ONLY_REASON_CODE} not active` };
    }

    // ── 5. Write — auto.ts's form ───────────────────────────────────────────
    // ONE clock: it stamps submittedAt and decides which year's sequence the
    // number counts against.
    const now = new Date();
    // Today in IST, stored as UTC-midnight of the IST calendar day — the same
    // two lines lib/ci/auto.ts uses for this @db.Date column. Never
    // toISOString().slice(0,10): between 18:30 and 24:00 IST that is yesterday.
    const istDay = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const materialReceivedDate = new Date(`${istDay}T00:00:00Z`);

    // Number allocated first; UNIQUE(ciNumber) is the real backstop, so a
    // P2002 re-allocates ONCE and retries. No loop, no transaction.
    const MAX_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const identity = await allocateCiNumber(now);
      try {
        const created = await prisma.ci_returns.create({
          data: {
            orderId: order.id,
            obdNumber: order.obdNumber,
            invoiceNo: order.invoiceNo,
            invoiceDate: order.invoiceDate,
            soNumber: order.soNumber,
            customerId: order.customerId,
            customerCode: order.shipToCustomerId,
            customerName: resolveCiDealer(order),
            // 🔴 'full' — genuinely every active line (computeFullBillLines).
            returnType: "full",
            // The four chk_ci_returns_complete_when_not_draft requires on
            // anything past draft: materialMoved, materialReceivedDate,
            // reasonId, reasonLabel — all set.
            materialMoved: "not_moved",
            materialReceivedDate,
            reasonId: reason.id,
            reasonLabel: reason.label,
            supervisorId: raisedById,
            ciNumber: identity.ciNumber,
            status: "submitted",
            submittedAt: now,
            source: "auto_bill_only",
            lines: { create: full.lines },
          },
          select: { id: true, ciNumber: true },
        });
        console.warn(
          `[ci/bill-only] raised ${created.ciNumber} on order #${order.id} / OBD ${order.obdNumber} ` +
            `with ${full.lines.length} line(s).`,
        );
        return {
          status: "raised",
          ciId: created.id,
          ciNumber: created.ciNumber ?? identity.ciNumber,
          reasonLabel: reason.label,
        };
      } catch (err) {
        const collided =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
        if (collided && attempt < MAX_ATTEMPTS) continue;
        throw err;
      }
    }
    // Unreachable in practice — the last attempt either returns or throws.
    return { status: "failed", error: "could not allocate a CI number" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ci/bill-only] FAILED for order #${orderId}:`, err);
    return { status: "failed", error: message };
  }
}
