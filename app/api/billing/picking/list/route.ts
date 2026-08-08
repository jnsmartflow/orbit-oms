import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getISTDayRange } from "@/lib/dates";
import {
  buildBillingPendingWhere,
  buildBillingInvoicedInfoWhere,
} from "@/lib/billing/picking-where";

export const dynamic = "force-dynamic";

/**
 * Shape gate for `?date=`. Mirrors lib/picking/queue.ts:39/62 — that module
 * THROWS on a malformed date so its route can 400, rather than falling back to
 * today, because silently answering a different question than the caller asked
 * looks like a working response. Same call here.
 *
 * ⚠ SHAPE ONLY. A shape-valid but impossible calendar date ("2026-02-30") is
 * rolled forward by Date.UTC inside getISTDayRange (lib/dates.ts:37) rather
 * than rejected. resolveTargetDate additionally round-trips the parsed date
 * back to a string to catch that; this route does not, because its only caller
 * is the header date stepper, which can emit real calendar days only.
 *
 * Duplicated verbatim in app/api/billing/picking/marker/route.ts — the two must
 * accept exactly the same input, since the client points them at the same day.
 */
const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/billing/picking/list — the Billing "Picking" tab's two lists.
 *
 * READ-ONLY. No writes, no mutations, no side effects. The mark-done write
 * lands in a later step and does not belong here.
 *
 *   pending — every approved-but-uninvoiced bill, ALL DATES. The predicate is
 *             buildBillingPendingWhere() (lib/billing/picking-where.ts), shared
 *             verbatim with the marker route so the two cannot drift. See that
 *             file for why there is no dispatchTargetDate fence. ⚠ `?date=`
 *             does NOT narrow this arm — the backlog is the backlog.
 *   done    — ONE IST day (`?date=`, default today), TWO arms, merged and
 *             sorted newest-first on `sortAt`:
 *               (a) "marked"   — bills the operator marked done that day
 *                                (invoicedAt inside the window). UNCHANGED
 *                                except that its window is now parameterised.
 *               (b) "invoiced" — NEW. Bills CHECKED that day that SAP had
 *                                ALREADY invoiced, via
 *                                buildBillingInvoicedInfoWhere(). Purely
 *                                informational; see that helper for why they
 *                                previously matched NEITHER list and vanished.
 *             The arms key on different columns on purpose — (a) on invoicedAt,
 *             because it is the receipt of the operator's own action and is
 *             what the undo route's window keys on; (b) on checkedAt, because
 *             nobody acted on those rows and the check is the only thing that
 *             happened that day. `invoicedAt IS NULL` inside (b) keeps a
 *             marked-AND-invoiced bill in exactly one arm.
 * Day-scoped on purpose: "what happened on this day" is a per-day question,
 * unlike `pending`.
 *
 * `dispatchStatus` / `orderType` / `natureOfTransaction` on each pending row
 * are RAW PASS-THROUGH for the FLAGS column the UI renders later. This route
 * does not interpret them and holds no flag logic — deliberately.
 *
 * `hasConfirmedShortage` (2026-08-08) is the ONE exception to that rule, and it
 * is a derived boolean on purpose: the raw form would be a per-row query, which
 * is exactly what the batched Set below exists to avoid. PENDING ROWS ONLY —
 * both Done arms are untouched, so their shape is byte-identical to before.
 *
 * Sequential awaits only, never prisma.$transaction (CORE §3).
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same gate shape as app/api/picking/marker/route.ts. Stricter than the
  // legacy session-only /api/mail-orders routes on purpose — new routes get
  // real gating. The operations-only pilot is enforced by the UI feature flag,
  // not here; this route stays on mail_orders/canView.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mail_orders", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // ── The day this request is about ───────────────────────────────────────
  // ABSENT → undefined → today, which is byte-for-byte the behaviour this
  // route had before the param existed. Present-but-malformed → 400, never a
  // silent fallback to today (see DATE_STR_RE above). An empty `?date=` is
  // malformed, not absent, and is rejected — the client only ever sends the
  // param when it has a real day.
  const dateParam = new URL(req.url).searchParams.get("date");
  if (dateParam !== null && !DATE_STR_RE.test(dateParam)) {
    return NextResponse.json(
      { error: `Invalid date "${dateParam}" — expected YYYY-MM-DD` },
      { status: 400 },
    );
  }
  const dateStr = dateParam ?? undefined;

  // ── Pending — approved, uninvoiced, every date. ─────────────────────────
  // ⚠ Deliberately NOT given `dateStr`. This arm is the outstanding-work
  // backlog and spans every date; narrowing it to a day would hide exactly the
  // carry-over bills it exists to surface.
  const pendingWhere = await buildBillingPendingWhere();

  const pendingRows = await prisma.orders.findMany({
    where: pendingWhere,
    // Oldest-checked first — the order the floor finished them in, which is the
    // order billing works them. obdNumber is a deterministic tiebreak (and the
    // fallback ordering for any row whose checkedAt is somehow null; Approve
    // always stamps it, so that should not occur in practice).
    orderBy: [{ pickAssignment: { checkedAt: "asc" } }, { obdNumber: "asc" }],
    select: {
      id: true,
      obdNumber: true,
      shipToCustomerName: true,
      // The resolved Support ship-to override. `shipToOverridden` below is
      // derived from the ID, NOT from the scalar orders.shipToOverride — that
      // flag can be true with a null id on free-text redirects (CORE §7.3),
      // where no dealer row exists and the displayed name does not change.
      shipToOverrideCustomerId: true,
      shipToOverrideCustomer: { select: { customerName: true } },
      dispatchTargetDate: true,
      dispatchWindow: { select: { id: true, windowTime: true, label: true } },
      volume: true,
      totalUnitQty: true,
      pickAssignment: { select: { checkedAt: true } },
      // Raw pass-through for FLAGS — not interpreted here.
      dispatchStatus: true,
      orderType: true,
      natureOfTransaction: true,
    },
  });

  // ── Confirmed shortages — ONE batched query for the whole visible list ─────
  // Mirrors app/api/picking/order/[orderId]/route.ts:109-125 (findMany with an
  // `in` list → Map/Set → attach in the map below), widened from one bill's
  // LINES to the list's ORDERS. Never one query per row.
  //
  // Keyed on `orderId` — pick_findings.orderId points at orders.id, the same id
  // space `pendingRows` is built from (both are `prisma.orders` rows), so no
  // resolution step is needed. That is NOT true of the mo_orders-keyed billing
  // face, which would have to travel soNumber → orders first.
  // Index-backed: pick_findings_order_idx ON (orderId).
  //
  // 🔴 `recordedById: { not: null }` IS THE ENTIRE DEFINITION OF "CONFIRMED",
  // and it is a filter here rather than a test at the call site so no consumer
  // can widen it by accident. A PENDING finding — picker reported it, no
  // supervisor has signed off — must NOT reach this list: it is a claim awaiting
  // confirmation, and Billing invoices against confirmed fact. Never infer the
  // state from qtyFound or reason (lib/picking/types.ts:136-140) — a supervisor
  // may confirm a line at the full ordered quantity.
  // Matches the live partial index pick_findings_confirmed_idx
  // ON ("recordedById") WHERE "recordedById" IS NOT NULL.
  //
  // `select: { orderId }` only — the flag is a boolean, so the rows themselves
  // are never needed and a bill with six confirmed lines collapses to one Set
  // entry. Skipped entirely on an empty list, the guard shape
  // app/api/sampling-library/route.ts:195-213 uses.
  //
  // Read-only. Sequential await, never prisma.$transaction (CORE §3).
  const pendingIds = pendingRows.map((o) => o.id);
  const confirmedFindingRows =
    pendingIds.length === 0
      ? []
      : await prisma.pick_findings.findMany({
          where: { orderId: { in: pendingIds }, recordedById: { not: null } },
          select: { orderId: true },
        });
  const shortageOrderIds = new Set(confirmedFindingRows.map((f) => f.orderId));

  const pending = pendingRows.map((o) => ({
    id: o.id,
    obdNumber: o.obdNumber,
    shipToName: o.shipToOverrideCustomer?.customerName ?? o.shipToCustomerName,
    shipToOverridden: o.shipToOverrideCustomerId !== null,
    dispatchTargetDate: o.dispatchTargetDate,
    dispatchWindow: o.dispatchWindow,
    volume: o.volume,
    totalUnitQty: o.totalUnitQty,
    checkedAt: o.pickAssignment?.checkedAt ?? null,
    dispatchStatus: o.dispatchStatus,
    orderType: o.orderType,
    natureOfTransaction: o.natureOfTransaction,
    hasConfirmedShortage: shortageOrderIds.has(o.id),
  }));

  // ── Done (a) — MARKED: invoiced by the operator, in the selected IST day. ─
  // getISTDayRange() (lib/dates) is the SAME helper Floor uses — a half-open
  // [start, end) window of real Date objects. Never hand-roll a day boundary,
  // and never Date.parse an offset-less string for this (CORE §3).
  //
  // The ONLY change to this arm is the argument: it used to be called bare
  // (always today). Everything below — the predicate, the select, the mapping —
  // is what it always was, so with no `?date=` this arm returns exactly the
  // rows it returned before.
  const { start, end } = getISTDayRange(dateStr);

  // ⚠ NO getHideExclusion() HERE — the asymmetry with `pending` is DELIBERATE,
  // do not "fix" it. Pending is a WORKLIST: a hidden bill should not be worked,
  // so hide applies. Done is a RECEIPT of the operator's own action: they
  // invoiced it regardless of a later hide, so hide does not apply. Done stays
  // invoicedAt-window + isRemoved only.
  const doneRows = await prisma.orders.findMany({
    where: {
      invoicedAt: { gte: start, lt: end },
      isRemoved: false,
    },
    orderBy: { invoicedAt: "desc" },
    select: {
      id: true,
      obdNumber: true,
      shipToCustomerName: true,
      shipToOverrideCustomer: { select: { customerName: true } },
      dispatchTargetDate: true,
      dispatchWindow: { select: { id: true, windowTime: true, label: true } },
      invoiceNo: true,
      invoicedAt: true,
      invoicedBy: { select: { id: true, name: true } },
    },
  });

  const markedDone = doneRows.map((o) => ({
    id: o.id,
    obdNumber: o.obdNumber,
    shipToName: o.shipToOverrideCustomer?.customerName ?? o.shipToCustomerName,
    dispatchTargetDate: o.dispatchTargetDate,
    dispatchWindow: o.dispatchWindow,
    // Null until the next SAP upload fills it — the UI shows "awaiting SAP".
    invoiceNo: o.invoiceNo,
    invoicedAt: o.invoicedAt,
    invoicedBy: o.invoicedBy,
    kind: "marked" as const,
    // No check facts on this arm: the row is here because of what the OPERATOR
    // did, and the UI shows invoicedBy/invoicedAt for it.
    checkedAt: null,
    checkedByName: null,
    sortAt: o.invoicedAt ? o.invoicedAt.toISOString() : null,
  }));

  // ── Done (b) — ALREADY INVOICED: checked in the day, SAP got there first. ─
  // The predicate (lib/billing/picking-where.ts) carries the stage, the
  // `invoiceNo IS NOT NULL` inversion, the `invoicedAt IS NULL` de-duplication
  // against arm (a), isRemoved, the checkedAt day window and the hide
  // exclusion. This route adds NO filtering of its own — one definition, one
  // place. Sequential await, never prisma.$transaction (CORE §3).
  const invoicedInfoWhere = await buildBillingInvoicedInfoWhere(dateStr);

  const invoicedInfoRows = await prisma.orders.findMany({
    where: invoicedInfoWhere,
    // Newest check first. The merge below re-sorts across both arms anyway, so
    // this only makes the arm's own input deterministic — obdNumber is the same
    // tiebreak the pending arm uses.
    orderBy: [{ pickAssignment: { checkedAt: "desc" } }, { obdNumber: "asc" }],
    select: {
      // The SAME display fields arm (a) selects, so one row renderer can serve
      // both…
      id: true,
      obdNumber: true,
      shipToCustomerName: true,
      shipToOverrideCustomer: { select: { customerName: true } },
      dispatchTargetDate: true,
      dispatchWindow: { select: { id: true, windowTime: true, label: true } },
      invoiceNo: true,
      invoicedAt: true,
      invoicedBy: { select: { id: true, name: true } },
      // …plus the two facts only this arm has. `pickAssignment` is the
      // relation field on `orders` (prisma/schema.prisma), the same one the
      // pending arm selects checkedAt through above.
      pickAssignment: {
        select: { checkedAt: true, checkedBy: { select: { name: true } } },
      },
    },
  });

  const alreadyInvoiced = invoicedInfoRows.map((o) => ({
    id: o.id,
    obdNumber: o.obdNumber,
    shipToName: o.shipToOverrideCustomer?.customerName ?? o.shipToCustomerName,
    dispatchTargetDate: o.dispatchTargetDate,
    dispatchWindow: o.dispatchWindow,
    // Non-null by predicate — this arm exists BECAUSE the invoice already
    // landed. Never "awaiting SAP".
    invoiceNo: o.invoiceNo,
    // Both null by predicate (`invoicedAt: null`, and invoicedById is written
    // and cleared with it). Passed through rather than hardcoded so the row
    // reports what the database actually holds.
    invoicedAt: o.invoicedAt,
    invoicedBy: o.invoicedBy,
    kind: "invoiced" as const,
    checkedAt: o.pickAssignment?.checkedAt?.toISOString() ?? null,
    checkedByName: o.pickAssignment?.checkedBy?.name ?? null,
    // checkedAt IS the day key for this arm, so it is also its sort key.
    sortAt: o.pickAssignment?.checkedAt?.toISOString() ?? null,
  }));

  // ── Merge — newest first, across both arms. ─────────────────────────────
  // Compared as STRINGS, which is safe and exact here: every `sortAt` is
  // `Date.toISOString()` output — fixed-width UTC — so lexicographic order IS
  // chronological order. No Date re-parsing, no timezone arithmetic.
  // A null sortAt (arm (a) can only produce one if invoicedAt were somehow
  // null, which its own predicate forbids) sorts LAST rather than throwing.
  const done = [...markedDone, ...alreadyInvoiced].sort((a, b) => {
    const av = a.sortAt ?? "";
    const bv = b.sortAt ?? "";
    if (av === bv) return 0;
    return av < bv ? 1 : -1;
  });

  return NextResponse.json({ pending, done });
}
