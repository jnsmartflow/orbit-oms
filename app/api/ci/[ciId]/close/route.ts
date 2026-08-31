import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { parseCiDateOnly } from "@/lib/ci/derive";

export const dynamic = "force-dynamic";

/**
 * POST /api/ci/[ciId]/close — billing's step. Records the three CI-details
 * fields and flips the CI to `status = 'closed'`.
 *
 * Body: { ciDate, sapCiNumber, ciValue }
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE REPEAT-CALL GUARD — `WHERE status = 'submitted'`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Same shape as submit's, for the same reason and against a different hazard: a
 * billing operator with the CI open in two tabs, or one who double-clicks Close.
 * The update is an `updateMany` guarded on `status: "submitted"`, so a second
 * call matches ZERO rows and cannot re-close a CI or overwrite the SAP number
 * and value that billing already finished with.
 *
 * ⚠ IT MUST STAY AN `updateMany` WITH THE STATUS IN THE `where`, not a
 * read-then-`update` — a read-then-write leaves a window in which two tabs both
 * pass the check and the second silently overwrites the first operator's
 * figures. The guarded updateMany makes the test and the write one statement.
 *
 * ⚠ A CLOSED CI IS NOT REOPENED HERE. Undoing a close is a different action with
 * a different audit story (and `returned_to_floor` — spec §11.1 — is the open
 * decision about sending one back). This route only ever moves submitted →
 * closed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 TWO NUMBERS, AND ONLY ONE OF THEM IS LABELLED (spec §5)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `sapCiNumber` is SAP's, typed by billing after punching — and the billing
 * screen labels that field plain "CI number", which is exactly why it looks like
 * it should overwrite `ciNumber`. IT MUST NOT. `ciNumber` is OrbitOMS's own
 * reference, allocated at submit, printed on the rail card and on the phone.
 * This route never touches it.
 */

/** Who may close: this is BILLING's action. */
const CLOSE_ROLES = [ROLES.BILLING_OPERATOR, ROLES.OPERATIONS, ROLES.ADMIN];

/** ₹ value: up to 10 integer digits and 2 decimals, matching numeric(12,2). */
const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;

export async function POST(
  req: Request,
  { params }: { params: { ciId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 🔴 canEdit, NOT canView — CORE's standing bug on the Mail Orders and
  // Picking write routes is not inherited here.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "ci", "canEdit");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  // ...and WHICH SIDE. Closing is billing's step; floor_supervisor holds `ci`
  // canEdit (it needs it to raise a return), so the permission alone would let
  // the floor close its own return and skip billing entirely — which is the one
  // thing the two-stage workflow exists to prevent.
  //
  // ⚠ `hasRole`, NOT `requireRole` — the latter redirects to an HTML page,
  // which a fetch() cannot make sense of. See the submit route.
  if (!hasRole(session, CLOSE_ROLES)) {
    return NextResponse.json(
      { error: "Closing a return is the billing operator's step." },
      { status: 403 },
    );
  }

  const billingOperatorId = Number(session.user.id);
  if (!Number.isInteger(billingOperatorId) || billingOperatorId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const rawId = params.ciId?.trim() ?? "";
  const ciId = Number(rawId);
  if (!/^\d+$/.test(rawId) || ciId <= 0 || ciId > 2147483647) {
    return NextResponse.json(
      { error: `Invalid ciId "${params.ciId}" — expected a positive integer` },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    ciDate?: unknown;
    sapCiNumber?: unknown;
    ciValue?: unknown;
  };

  // ── Validate EVERYTHING before the write ──────────────────────────────────
  // All three are the close payload (spec §3, stage 2: "fills three fields and
  // closes it: CI date · CI number · Value"). Closing with a blank would leave a
  // finished document that cannot be reconciled against SAP.

  if (typeof body.ciDate !== "string") {
    return NextResponse.json(
      { error: "`ciDate` is required — expected YYYY-MM-DD" },
      { status: 400 },
    );
  }
  let ciDate: Date;
  try {
    ciDate = parseCiDateOnly(body.ciDate);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid ciDate" },
      { status: 400 },
    );
  }

  if (typeof body.sapCiNumber !== "string" || body.sapCiNumber.trim() === "") {
    return NextResponse.json(
      { error: "`sapCiNumber` is required — SAP's CI number, as punched" },
      { status: 400 },
    );
  }
  const sapCiNumber = body.sapCiNumber.trim();

  // Accepted as a string OR a number, but VALIDATED AS TEXT and handed to
  // Prisma as a Decimal.
  // ⚠ NEVER parseFloat into a JS number and store that: this is money on a
  // document someone signs, and binary floating point cannot hold 0.1 exactly.
  // The regex also rejects "1e3", "+5" and "5." — shapes Number() would happily
  // accept and silently reshape.
  const rawValue =
    typeof body.ciValue === "string"
      ? body.ciValue.trim()
      : typeof body.ciValue === "number" && Number.isFinite(body.ciValue)
        ? String(body.ciValue)
        : "";
  if (!MONEY_RE.test(rawValue)) {
    return NextResponse.json(
      {
        error:
          "`ciValue` is required — a rupee amount with at most 2 decimals (0 is allowed)",
      },
      { status: 400 },
    );
  }
  const ciValue = new Prisma.Decimal(rawValue);

  // ── Read, to answer honestly on a repeat call. NO WRITE YET. ──────────────
  const ci = await prisma.ci_returns.findFirst({
    where: { id: ciId, isVoided: false },
    select: { id: true, status: true, ciNumber: true, closedAt: true },
  });
  if (!ci) {
    return NextResponse.json({ error: "CI not found" }, { status: 404 });
  }

  // ⚠ ALREADY CLOSED IS NOT AN ERROR — it is the expected result of a
  // double-click or a retried request, and the honest answer is "this is done".
  // 200 with the CI as it stands, so the desk shows the closed state rather than
  // an error the operator cannot act on.
  if (ci.status === "closed") {
    return NextResponse.json({
      ciId: ci.id,
      ciNumber: ci.ciNumber,
      status: ci.status,
      closedAt: ci.closedAt?.toISOString() ?? null,
      alreadyClosed: true,
    });
  }

  // Anything else — a draft that somehow reached this URL, or a CI sent back to
  // the floor — is a real 409: it is not billing's to close yet.
  if (ci.status !== "submitted") {
    return NextResponse.json(
      {
        error: `This CI is ${ci.status} and cannot be closed.`,
        status: ci.status,
      },
      { status: 409 },
    );
  }

  // ── The guarded write. ONE statement. ─────────────────────────────────────
  // Sequential awaits, never prisma.$transaction (CORE §3).
  const now = new Date();
  const res = await prisma.ci_returns.updateMany({
    // 🔴 THE GUARD — see this file's header.
    where: { id: ciId, status: "submitted", isVoided: false },
    data: {
      ciDate,
      sapCiNumber,
      ciValue,
      billingOperatorId,
      closedAt: now,
      status: "closed",
      // 🔴 `ciNumber` is NOT in this data block and must never be. sapCiNumber
      // is SAP's number; ciNumber is ours, allocated at submit (spec §5).
    },
  });

  if (res.count === 0) {
    // Lost the race with another tab between the read and the write — exactly
    // what the guard is for. Nothing was written; report the CI as it now
    // stands rather than inventing an error.
    const fresh = await prisma.ci_returns.findFirst({
      where: { id: ciId },
      select: { ciNumber: true, status: true, closedAt: true },
    });
    return NextResponse.json({
      ciId,
      ciNumber: fresh?.ciNumber ?? null,
      status: fresh?.status ?? "unknown",
      closedAt: fresh?.closedAt?.toISOString() ?? null,
      alreadyClosed: fresh?.status === "closed",
    });
  }

  return NextResponse.json({
    ciId,
    ciNumber: ci.ciNumber,
    status: "closed",
    closedAt: now.toISOString(),
  });
}
