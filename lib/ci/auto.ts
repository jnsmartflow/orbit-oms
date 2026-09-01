// lib/ci/auto.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE AUTO-CI: A SIDE EFFECT OF CONFIRMING A PICK FINDING (step 15)
// ═══════════════════════════════════════════════════════════════════════════
//
// When a supervisor CONFIRMS a finding on a bill SAP has already invoiced, the
// goods cannot simply be un-picked — an invoice exists, so what is not going out
// has to come back on a document. This module raises that document.
//
// ⚠ THE FINDINGS BOARD IS THE PRIMARY JOB; THIS IS THE SIDE EFFECT. Every entry
// point here is called AFTER the confirm has been written, and a failure in here
// must never roll back or block it. The caller logs and lets the confirm stand.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE FIRE RULE — orders.invoiceNo, AND NOTHING ELSE
// ═══════════════════════════════════════════════════════════════════════════
//
// No invoice, no CI. The DATABASE COLUMN is the only authority: do NOT consult
// billing's "Already invoiced" badge, the billing picking tab, `invoicedAt`, or
// any marker. That badge means two different things — the invoice genuinely
// arrived early, OR the operator forgot to mark done — so it cannot be a
// trigger. `invoicedAt` is billing's mark-done timestamp, not SAP's invoicing
// moment, and is not this rule either.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 ONE AUTO CI PER ORDER, AND IT GROWS AS HE CONFIRMS (owner ruling 1)
// ═══════════════════════════════════════════════════════════════════════════
//
// A supervisor confirms lines one at a time — `confirm/route.ts` takes ONE
// rawLineItemId per call. So a "create once on the first confirm" design would
// be born with one line and lock the rest out, and a CI claiming 2 tins when 6
// came back is worse than no CI: billing punches that into SAP.
//
// Instead this RECONCILES on every confirm. It re-reads every confirmed finding
// on the order, works out the due lines, and makes the auto CI's lines MATCH
// them — inserting, updating and deleting as needed, then renumbering. The
// duplicate protection is the (orderId + source='auto_finding') lookup itself,
// not a "skip if one exists" guard.
//
// 🔴 A CI THAT IS NO LONGER 'submitted' IS NEVER TOUCHED. Once billing has
// closed it, the document is real and this module has no business editing it —
// even though that means the CI can end up short of what actually came back.
// That case is LOGGED LOUDLY rather than silently reconciled, because a
// mismatch someone can see beats one nobody can.
//
// Sequential awaits only, never prisma.$transaction (CORE §3).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { allocateCiNumber } from "@/lib/ci/number";
import { litresPerTin, resolveCiDealer, returnedLitres } from "@/lib/ci/derive";
import { applyCiCatalog, resolveCiSkus } from "@/lib/ci/resolve-lines";

/**
 * 🔴 THE OLD-MFG TOKEN, VERIFIED LIVE (2026-09-01):
 *   SELECT DISTINCT reason FROM pick_findings
 *   → 'short_quantity' (74) · 'old_mfg' (21)
 * Exactly two values, and this is the literal one. Not assumed from the code —
 * lib/picking/findings-reasons.ts declares the same pair, and the DB agrees.
 */
const OLD_MFG_REASON = "old_mfg";

/**
 * The reason every auto CI is filed under. Looked up BY CODE at write time, not
 * hardcoded as an id: `ci_reason_master` is depot-editable (spec §3.1), so an id
 * baked in here would silently file returns under whatever row later took that
 * number. Live id is 2, but this code is what identifies it.
 */
const AUTO_REASON_CODE = "PHYSICALLY_CROSS";

/** The order fields this module needs. Every one comes from the select that
 *  `confirm/route.ts` ALREADY makes — no second query for the order. */
export interface CiAutoOrder {
  id: number;
  obdNumber: string;
  invoiceNo: string | null;
  invoiceDate: Date | null;
  customerId: number | null;
  soNumber: string | null;
  /** ⚠ THE CUSTOMER CODE IS `orders.shipToCustomerId` — `orders` carries no
   *  `customerCode` column. lib/ci/queries.ts:312 snapshots the same field on
   *  the manual path. */
  shipToCustomerId: string | null;
  /** Everything resolveCiDealer() needs — the SAP name plus the two relations,
   *  same shape, same rule and same precedence as the manual path: a ship-to
   *  override wins over the customer, and the SAP name is the last fallback. */
  shipToCustomerName: string | null;
  shipToOverrideCustomer: { customerName: string } | null;
  customer: { customerName: string } | null;
}

export type CiAutoOutcome =
  | { action: "skipped"; why: string }
  | { action: "created"; ciId: number; ciNumber: string | null; lineCount: number }
  | { action: "updated"; ciId: number; ciNumber: string | null; lineCount: number }
  | { action: "removed"; ciId: number; ciNumber: string | null }
  | { action: "frozen"; ciId: number; ciNumber: string | null; status: string };

/** One due line, already re-derived from the bill. */
interface DueLine {
  rawLineItemId: number;
  skuCode: string;
  skuDescription: string | null;
  packCode: string | null;
  deliveryQty: number | null;
  returnedQty: number;
  litresPerTin: number | null;
  returnedQtyLitres: number | null;
}

/**
 * Reconcile the auto CI for one order after a confirm.
 *
 * @param order         the row confirm/route.ts already loaded
 * @param supervisorId  the confirming user — used ONLY when creating. On an
 *                      existing CI it is never changed: it records who raised
 *                      the return, not who last touched it.
 */
export async function reconcileAutoCi(
  order: CiAutoOrder,
  supervisorId: number,
): Promise<CiAutoOutcome> {
  // ── The fire rule ─────────────────────────────────────────────────────────
  const invoiceNo = order.invoiceNo?.trim() ?? "";
  if (invoiceNo === "") {
    return { action: "skipped", why: "no invoiceNo on the order" };
  }

  // ── Every CONFIRMED finding on this bill ──────────────────────────────────
  //
  // 🔴 `recordedById: { not: null }` IS THE CONFIRMED MARKER, and it is the
  // right one. The two write routes divide cleanly:
  //   report/route.ts  — the PICKER. Sets reportedById/reportedAt and leaves
  //                      recordedById NULL.
  //   confirm/route.ts — the SUPERVISOR. Always stamps recordedById/recordedAt,
  //                      on both its INSERT and its UPDATE branch, and never
  //                      touches reportedById.
  // So a non-null recordedById means and can only mean "a supervisor signed off
  // on this line". A picker's unconfirmed claim has recordedById NULL and can
  // never reach a CI. Measured live: 92 of 95 findings are recorded, 3 are
  // picker-only — those 3 are exactly the rows this filter must exclude.
  //
  // ⚠ NOT `reportedById` and NOT `createdAt`: a row created by the picker exists
  // from the moment he reports, so either of those would put an unverified claim
  // on a signed document.
  const findings = await prisma.pick_findings.findMany({
    where: { orderId: order.id, recordedById: { not: null } },
    select: { rawLineItemId: true, qtyOrdered: true, qtyFound: true, reason: true },
  });

  // ── The bill's ACTIVE lines, in bill order ────────────────────────────────
  //
  // ⚠ `orderBy: { lineId: "asc" }` — THE SAME ORDERING PUT /lines USES, because
  // lineNumber must mean the same thing on an auto CI as on a manual one.
  // ⚠ lineStatus 'active' ONLY: 113 rows across 100 OBDs are 'removed_by_import',
  // and returning one would file against a line SAP has withdrawn.
  const active = await prisma.import_raw_line_items.findMany({
    where: { obdNumber: order.obdNumber, lineStatus: "active" },
    select: { id: true, skuCodeRaw: true, unitQty: true, volumeLine: true },
    orderBy: { lineId: "asc" },
  });
  const findingByLine = new Map(findings.map((f) => [f.rawLineItemId, f]));

  // ── Which lines are due ───────────────────────────────────────────────────
  //
  // 🔴 THE DUE RULE (owner ruling 3):
  //     due  if  shortfall > 0   OR   reason is old-MFG
  //     qty  =   qtyOrdered      for old-MFG (the whole line is held back)
  //          =   shortfall       for everything else
  //
  // Old-MFG earns its place even at a full count: nothing is short, but nothing
  // is going out either — the stock is held, so it comes back. Before this rule
  // those 21 of 95 findings raised nothing at all.
  //
  // ⚠ FLAGGED PROVISIONAL by the owner: raise now, review after testing. There
  // is deliberately NO switch or feature flag for that review — a special case
  // built for a decision nobody has made yet is a second code path to maintain.
  //
  // ⚠ WALKED IN BILL ORDER, not findings order, so lineNumber lands 1..N the way
  // PUT /lines assigns it.
  const due: { rawLineItemId: number; returnedQty: number; src: (typeof active)[number] }[] = [];
  for (const src of active) {
    const f = findingByLine.get(src.id);
    if (!f) continue;
    const shortfall = f.qtyOrdered - f.qtyFound;
    const isOldMfg = f.reason === OLD_MFG_REASON;
    if (!isOldMfg && shortfall <= 0) continue;
    const returnedQty = isOldMfg ? f.qtyOrdered : shortfall;
    // A zero-tin line is not "nothing came back", it is a line that should not
    // be on the return — the same rule PUT /lines enforces with a 400.
    if (returnedQty < 1) continue;
    due.push({ rawLineItemId: src.id, returnedQty, src });
  }

  // ── Find our own CI ───────────────────────────────────────────────────────
  //
  // 🔴 KEYED ON orderId + source='auto_finding'. `source` is what makes this
  // safe: without it the lookup would also match a CI the supervisor raised BY
  // HAND for the same bill, and a reconcile would rewrite his document. It is
  // also why this is find-or-create rather than skip-if-exists — one auto CI per
  // order is the invariant, and the lookup IS the duplicate protection.
  //
  // ⚠ isVoided false: a voided CI is not a live document and must not be
  // resurrected by a later confirm.
  const existing = await prisma.ci_returns.findFirst({
    where: { orderId: order.id, source: "auto_finding", isVoided: false },
    select: { id: true, ciNumber: true, status: true },
  });

  if (existing !== null && existing.status !== "submitted") {
    // 🔴 BILLING HAS ALREADY ACTED. Never touch it — see this file's header.
    // This is the one case where an auto CI can end up short of what came back,
    // and it is logged loudly rather than reconciled silently.
    console.error(
      `[ci/auto] FROZEN: ci #${existing.id} (${existing.ciNumber ?? "no number"}) on order ` +
        `#${order.id} / OBD ${order.obdNumber} is '${existing.status}', not 'submitted'. ` +
        `A confirmed finding changed the due lines to ${due.length} line(s) but the CI was ` +
        `NOT updated — billing has acted on it. Reconcile by hand if the counts disagree.`,
    );
    return {
      action: "frozen",
      ciId: existing.id,
      ciNumber: existing.ciNumber,
      status: existing.status,
    };
  }

  if (due.length === 0) {
    if (existing === null) return { action: "skipped", why: "no due lines" };
    // A corrected count wiped the shortfall. An empty CI must not stand — it
    // would sit on billing's rail claiming a return with nothing in it.
    // ⚠ Lines first, then the header. ci_return_lines cascades on delete, but
    // deleting them explicitly keeps the order of operations readable and does
    // not depend on the FK's ON DELETE for correctness.
    await prisma.ci_return_lines.deleteMany({ where: { ciReturnId: existing.id } });
    await prisma.ci_returns.deleteMany({
      where: { id: existing.id, source: "auto_finding", status: "submitted" },
    });
    console.warn(
      `[ci/auto] removed ci #${existing.id} (${existing.ciNumber ?? "no number"}) on order ` +
        `#${order.id}: no confirmed finding leaves a due line any more.`,
    );
    return { action: "removed", ciId: existing.id, ciNumber: existing.ciNumber };
  }

  // ── Re-derive every line field SERVER-SIDE ────────────────────────────────
  //
  // 🔴 THE SAME HELPERS THE MANUAL PATH CALLS, ON THE SAME SOURCE ROW. Nothing
  // is copied off the finding that PUT /lines would compute — the two paths must
  // write IDENTICAL rows, not lookalikes:
  //   skuDescription / packCode  ← applyCiCatalog over resolveCiSkus
  //   litresPerTin               ← litresPerTin(volumeLine, unitQty)
  //   returnedQtyLitres          ← returnedLitres(perTin, qty)
  //   deliveryQty                ← the raw line's unitQty
  //
  // ⚠ resolveCiSkus matches on `sku_master_v2.material` ONLY — never a catalog
  // row id (CORE §13's id-space landmine: the old and new SKU tables assign
  // completely different ids to the same material code). An unresolved code is
  // NORMAL and never rejects a line.
  const catalog = await resolveCiSkus(due.map((d) => d.src.skuCodeRaw));
  const dueLines: DueLine[] = due.map((d) => {
    const code = d.src.skuCodeRaw ?? "";
    const resolved = applyCiCatalog(code, catalog);
    // 🔴 Guarded on unitQty ONLY. volumeLine = 0 is a REAL value — 346 active
    // lines are brushes and rollers — and must snapshot as 0, never as null.
    const perTin = litresPerTin(d.src.volumeLine, d.src.unitQty);
    return {
      rawLineItemId: d.rawLineItemId,
      skuCode: code,
      skuDescription: resolved.description,
      packCode: resolved.pack,
      deliveryQty: d.src.unitQty,
      returnedQty: d.returnedQty,
      litresPerTin: perTin,
      returnedQtyLitres: returnedLitres(perTin, d.returnedQty),
    };
  });

  // ── The reason, read live ─────────────────────────────────────────────────
  //
  // 🔴 THE LABEL IS SNAPSHOTTED FROM THIS ROW, never composed here. Renaming a
  // reason must not rewrite the history of returns filed under the old wording
  // (spec §3.1) — the same rule the submit route follows.
  const reason = await prisma.ci_reason_master.findFirst({
    where: { code: AUTO_REASON_CODE, isActive: true },
    select: { id: true, label: true },
  });
  if (reason === null) {
    // Refusing is correct: a CI needs a reason, and inventing one would print
    // wording nobody chose on a signed document.
    console.error(
      `[ci/auto] no active ci_reason_master row with code '${AUTO_REASON_CODE}' — ` +
        `no auto CI raised for order #${order.id}.`,
    );
    return { action: "skipped", why: `reason ${AUTO_REASON_CODE} missing or inactive` };
  }

  // ── Create, or reconcile in place ─────────────────────────────────────────
  if (existing === null) {
    return await createAutoCi(order, supervisorId, reason, dueLines);
  }
  return await reconcileLines(existing, dueLines);
}

/** First confirm on this bill: header + lines. */
async function createAutoCi(
  order: CiAutoOrder,
  supervisorId: number,
  reason: { id: number; label: string },
  dueLines: DueLine[],
): Promise<CiAutoOutcome> {
  // ONE clock for the whole operation — the same instant stamps submittedAt and
  // decides which year's sequence the number counts against. Reading it twice
  // could straddle midnight on 31 December.
  const now = new Date();

  // 🔴 TODAY IN IST, never toISOString().slice(0,10) — that is the UTC day, and
  // between 18:30 and 24:00 IST it is YESTERDAY, which is a depot evening shift.
  // The date is stored as UTC-midnight of the IST calendar day, matching
  // parseCiDateOnly's contract for this @db.Date column.
  const istDay = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const materialReceivedDate = new Date(`${istDay}T00:00:00Z`);

  // ⚠ ALLOCATED HERE AND NOWHERE EARLIER. lib/ci/number.ts is deliberately not
  // atomic and UNIQUE(ciNumber) is the real backstop; on a P2002 we re-allocate
  // ONCE and retry, exactly as the submit route does. No loop, and never
  // prisma.$transaction (CORE §3).
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
          // 🔴 THE SAME DEALER RULE AS THE MANUAL PATH — resolveCiDealer, not a
          // hand-picked relation. An auto CI and a manual CI for the same bill
          // must name the same dealer.
          customerName: resolveCiDealer(order),
          // 🔴 ALWAYS 'part'. An auto CI carries the lines that were marked, and
          // "full bill" MEANS every active line at its delivered quantity — a
          // claim only the whole-bill path may make.
          returnType: "part",
          materialMoved: "not_moved",
          materialReceivedDate,
          reasonId: reason.id,
          reasonLabel: reason.label,
          supervisorId,
          ciNumber: identity.ciNumber,
          status: "submitted",
          submittedAt: now,
          source: "auto_finding",
          lines: {
            create: dueLines.map((l, i) => ({ ...l, lineNumber: i + 1 })),
          },
        },
        select: { id: true, ciNumber: true },
      });
      console.warn(
        `[ci/auto] raised ${created.ciNumber} on order #${order.id} / OBD ${order.obdNumber} ` +
          `with ${dueLines.length} line(s).`,
      );
      return {
        action: "created",
        ciId: created.id,
        ciNumber: created.ciNumber,
        lineCount: dueLines.length,
      };
    } catch (err) {
      const collided =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (collided && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }
  }
  return { action: "skipped", why: "could not allocate a CI number" };
}

/**
 * A later confirm: make the lines MATCH the due set.
 *
 * ⚠ UPSERT BY rawLineItemId, THEN RENUMBER — not delete-all-and-recreate. This
 * CI is 'submitted' and billing may be reading it right now; PUT /lines can
 * clear a draft to zero lines because a draft is invisible, but doing that here
 * would blank a live document for the width of two statements.
 *
 * ⚠ ciNumber IS NOT RE-ALLOCATED and supervisorId IS NOT CHANGED. The number is
 * on billing's rail already, and the supervisor field records who RAISED the
 * return, not who last touched it.
 */
async function reconcileLines(
  existing: { id: number; ciNumber: string | null },
  dueLines: DueLine[],
): Promise<CiAutoOutcome> {
  const current = await prisma.ci_return_lines.findMany({
    where: { ciReturnId: existing.id },
    select: { id: true, rawLineItemId: true },
  });
  const currentByRaw = new Map(
    current.filter((c) => c.rawLineItemId !== null).map((c) => [c.rawLineItemId as number, c.id]),
  );
  const dueRawIds = new Set(dueLines.map((l) => l.rawLineItemId));

  // Gone first: a line no longer due frees its lineNumber before the renumber,
  // so the UNIQUE(ciReturnId, lineNumber) cannot collide mid-way.
  const stale = current.filter(
    (c) => c.rawLineItemId === null || !dueRawIds.has(c.rawLineItemId),
  );
  for (const s of stale) {
    await prisma.ci_return_lines.delete({ where: { id: s.id } });
  }

  // ⚠ RENUMBERED TO A HIGH OFFSET FIRST. lineNumber is UNIQUE per CI, so
  // rewriting 1..N in place can collide with a row that still holds the number
  // being assigned (swap two lines and the first update fails). Moving every
  // surviving row out of the 1..N range first makes the second pass free of
  // collisions. Two passes, sequential — never a transaction (CORE §3).
  const OFFSET = 1000;
  // ⚠ Array.from() around the Map iterator — the tsconfig target is below
  // ES2015, so a bare for-of over .values() does not compile (CLAUDE.md rule).
  for (const id of Array.from(currentByRaw.values())) {
    if (stale.some((s) => s.id === id)) continue;
    await prisma.ci_return_lines.update({
      where: { id },
      data: { lineNumber: { increment: OFFSET } },
    });
  }

  for (let i = 0; i < dueLines.length; i += 1) {
    const l = dueLines[i];
    const existingLineId = currentByRaw.get(l.rawLineItemId);
    if (existingLineId !== undefined && !stale.some((s) => s.id === existingLineId)) {
      // Every derived field is rewritten, not just the quantity: a re-import can
      // change the catalog resolution or the volume behind a line, and a
      // reconcile is the moment to pick that up.
      await prisma.ci_return_lines.update({
        where: { id: existingLineId },
        data: { ...l, lineNumber: i + 1 },
      });
    } else {
      await prisma.ci_return_lines.create({
        data: { ...l, ciReturnId: existing.id, lineNumber: i + 1 },
      });
    }
  }

  // 🔴 TOUCH THE HEADER so billing's marker fires. It watches MAX(updatedAt),
  // and a CI whose lines changed without the header moving would sit stale on a
  // desk that has no other way to learn about it.
  await prisma.ci_returns.updateMany({
    where: { id: existing.id, source: "auto_finding", status: "submitted" },
    data: { updatedAt: new Date() },
  });

  console.warn(
    `[ci/auto] reconciled ${existing.ciNumber ?? `ci #${existing.id}`} to ${dueLines.length} line(s).`,
  );
  return {
    action: "updated",
    ciId: existing.id,
    ciNumber: existing.ciNumber,
    lineCount: dueLines.length,
  };
}
