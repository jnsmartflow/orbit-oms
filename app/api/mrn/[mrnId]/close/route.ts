import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/mrn/[mrnId]/close — billing punches the OTR number and files the
 * MRN. This is the last step in the ladder:
 *
 *   open ──START──► checking ──END──► done ──OTR PUNCH──► closed
 *    │  (supervisor)          (supervisor)      (billing, here)
 *
 * Body: { otrNo }
 *
 * 🔴 A NEW ROUTE, NOT A RELAXATION OF THE HEADER LOCK, and that is the whole
 * design (§3.3). PATCH /api/mrn/[mrnId]/header 409s the moment the supervisor
 * taps Start and stays locked for ever after; widening it to allow a late
 * `otrNo` would have reopened `truckReportingDate`, `receivedFrom`, `stiRefNo`
 * and `deliveryNo` on a finished document at the same time. This route writes
 * `otrNo` and the three closing fields and NOTHING else. It is not a general
 * unlock and must never grow into one.
 *
 * 🔴 THIS IS WHY THE OTR FIELD HAS NEVER BEEN USED. All ten live MRNs carry
 * otrNo NULL while stiRefNo (7/10) and deliveryNo (8/10) are routinely filled
 * — because the real OTR number arrives AFTER unloading, which is exactly when
 * the header locks. The field was offered twice, at create and at header-edit,
 * and both windows close before the number exists.
 *
 * 🔴 THERE IS NO REOPEN, ANYWHERE IN THIS MODULE. No route writes the status
 * backwards, `header` rejects `status` outright (:40), and none of that changes
 * here. A closed MRN is closed, and a mistyped OTR is permanent — which is why
 * the modal says so BEFORE the click rather than after. Do not add a reopen, an
 * edit-OTR-after-close or an undo without a fresh owner decision; each is a
 * different action with a different audit story.
 */

/**
 * 🔴 BILLING ONLY — AN EXPLICIT ROLE CHECK, DELIBERATELY NOT `canEdit`.
 *
 * The live grants (SELECT, not seed) give `mrn` canEdit to THREE roles:
 *
 *   billing_operator  canView ✓  canEdit ✓  canExport ✓  canDelete ✓
 *   floor_supervisor  canView ✓  canEdit ✓  canExport ✗  canDelete ✗
 *   operations        canView ✓  canEdit ✓  canExport ✓  canDelete ✗
 *
 * canEdit is what the supervisor needs to START and END an unloading, so
 * gating on it would put a Close button on his phone — where it has no meaning,
 * because he does not have the OTR number. `operations` is excluded for the
 * same reason and on the owner's instruction (§7): closing is billing's act.
 *
 * ⚠ NOTE THIS IS NARROWER THAN CI'S EQUIVALENT. app/api/ci/[ciId]/close's
 * CLOSE_ROLES includes OPERATIONS; MRN's does not. The two modules made
 * different calls about the same role and both are deliberate — do not
 * "align" them.
 *
 * ⚠ `hasRole`, NOT `requireRole` — the latter redirects to an HTML page, which
 * a fetch() cannot make sense of. Same reason CI's close and submit routes use
 * it.
 */
const CLOSE_ROLES: string[] = [ROLES.BILLING_OPERATOR, ROLES.ADMIN];

export async function POST(
  req: Request,
  { params }: { params: { mrnId: string } },
): Promise<NextResponse> {
  // ── 1. Session ─────────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Role. See CLOSE_ROLES above for why this is not a permission check ──
  if (!hasRole(session, CLOSE_ROLES)) {
    return NextResponse.json(
      { error: "Closing an MRN is the billing operator's step." },
      { status: 403 },
    );
  }

  // 🔴 THE ACTOR — this is the id written to `mrn.closedById`. The column is
  // nullable because it is null for every MRN that was never closed, not
  // because closing without an actor is acceptable: nothing may reach 'closed'
  // with it unset. MRN has exactly two write paths that record
  // nobody — header PATCH and lines PUT
  // (code-discovery-2026-08-31-role-census.md:533-535) — and this must not
  // become a third. A closing step nobody signed is worth less than no closing
  // step: it is the only evidence of who accepted the truck's paperwork.
  //
  // Number("") is 0 and finite, so require a real positive integer rather than
  // trusting the coercion.
  const closedById = Number(session.user.id);
  if (!Number.isInteger(closedById) || closedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  // ── 3. Path segment — identical validation to every other MRN route ────────
  const raw = params.mrnId?.trim() ?? "";
  const mrnId = Number(raw);
  if (!/^\d+$/.test(raw) || mrnId <= 0 || mrnId > 2147483647) {
    return NextResponse.json(
      { error: `Invalid mrnId "${params.mrnId}" — expected a positive integer` },
      { status: 400 },
    );
  }

  // ── 4. The MRN ─────────────────────────────────────────────────────────────
  // isRemoved: false — a soft-removed MRN is gone from every screen (§11 OQ-8),
  // so it 404s here exactly as it does on the read route.
  const existing = await prisma.mrn.findFirst({
    where: { id: mrnId, isRemoved: false },
    select: { status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "MRN not found" }, { status: 404 });
  }

  // ── 5. 409 unless done ─────────────────────────────────────────────────────
  // Closing is what follows the supervisor finishing. Before that there is
  // nothing to file; after it, it is already filed.
  if (existing.status !== "done") {
    return NextResponse.json(
      {
        error:
          existing.status === "closed"
            ? "This MRN has already been closed."
            : existing.status === "checking"
              ? "The supervisor is still checking this truck — it cannot be closed yet."
              : "This MRN has not been unloaded yet — it cannot be closed.",
        status: existing.status,
      },
      { status: 409 },
    );
  }

  // ── 6. The OTR number ──────────────────────────────────────────────────────
  // Trimmed, and blank is refused. Closing with an empty OTR would produce a
  // finished document carrying the one field it exists to record, empty — and
  // there is no reopen to fix it afterwards.
  const body = (await req.json().catch(() => ({}))) as { otrNo?: unknown };
  const otrNo = typeof body.otrNo === "string" ? body.otrNo.trim() : "";
  if (otrNo === "") {
    return NextResponse.json(
      { error: "An OTR number is required to close this MRN." },
      { status: 400 },
    );
  }

  // ── 7. One guarded write ───────────────────────────────────────────────────
  //
  // 🔴 updateMany WITH THE STATUS IN THE `where`, NOT the read-then-update the
  // check above might suggest. Between step 5's read and this write there is a
  // window, and a billing operator with the MRN open in two tabs — or one who
  // double-clicks Close — walks straight through it: both calls pass the check
  // and the second overwrites the first operator's OTR number and closedAt on a
  // document that is already filed. Putting the status in the WHERE makes the
  // test and the write one statement, so a second call matches zero rows.
  //
  // Same guard, same reasoning as app/api/ci/[ciId]/close/route.ts. Do not
  // "simplify" it back to prisma.mrn.update({ where: { id } }).
  //
  // Never prisma.$transaction (CORE §3) — one statement needs none.
  const result = await prisma.mrn.updateMany({
    where: { id: mrnId, status: "done", isRemoved: false },
    data: {
      otrNo,
      status: "closed",
      closedAt: new Date(),
      closedById,
    },
  });

  if (result.count === 0) {
    // Someone else closed it in the window above. Their OTR stands.
    return NextResponse.json(
      { error: "This MRN was closed by someone else a moment ago." },
      { status: 409 },
    );
  }

  const closed = await prisma.mrn.findUnique({
    where: { id: mrnId },
    select: {
      id: true,
      mrnNumber: true,
      status: true,
      otrNo: true,
      closedAt: true,
      closedBy: { select: { name: true } },
    },
  });

  return NextResponse.json({
    id: closed?.id ?? mrnId,
    mrnNumber: closed?.mrnNumber ?? null,
    status: closed?.status ?? "closed",
    otrNo: closed?.otrNo ?? otrNo,
    closedAt: closed?.closedAt ?? null,
    closedByName: closed?.closedBy?.name ?? null,
  });
}
