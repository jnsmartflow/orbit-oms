import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { parseCiDateOnly } from "@/lib/ci/derive";
import { isCiMaterialMoved } from "@/lib/ci/types";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/ci/[ciId]/details — the four stage-1 answers, on an ALREADY
 * SUBMITTED CI.
 *
 * Body: { materialMoved, materialReceivedDate, reasonId, reasonRemark? }
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 WHY THIS EXISTS SEPARATELY FROM /submit, WHICH TAKES THE SAME FOUR FIELDS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * /submit's header carries a rule that must not be read as contradicted here:
 * "THE STAGE-1 ANSWERS ARRIVE IN THIS REQUEST — do NOT add a separate
 * PATCH-then-submit pair." That rule is about the CREATE flow, and it still
 * holds. Its reason was that a PATCH-then-submit pair leaves a window in which
 * the row carries the details but is STILL A DRAFT — and a draft is invisible to
 * every screen, so a phone dying in that window strands a return the supervisor
 * can never find again.
 *
 * This route cannot open that window: it only ever touches a CI that is ALREADY
 * 'submitted'. There is no flip to lose, nothing becomes invisible, and the
 * worst outcome of a dead phone here is that the old answers stand. It is a
 * correction to a visible record, not a stage of creating one.
 *
 * ⚠ IT MUST NEVER ACCEPT 'draft'. If it did, it would become exactly the
 * PATCH-then-submit pair /submit forbids. The guard below names 'submitted' and
 * nothing else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 ONE GUARDED updateMany — WHERE status='submitted' AND supervisorId=:me
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner ruling (2026-09-01): a submitted CI is VIEWABLE always, and EDITABLE
 * only while 'submitted' and only by the supervisor who raised it. Once
 * 'closed' it is read-only with no exceptions — billing has punched it into SAP
 * by then and the document is real.
 *
 * Both halves of that rule live in the `where` of a single statement, so the
 * check and the write cannot be separated by a concurrent close. A read-then-
 * update would reopen that window; do not "simplify" this to findFirst+update.
 *
 * ⚠ NO ADMIN BYPASS, deliberately. The ruling says "the supervisor who raised
 * it" and the guard is written that way verbatim. An admin editing someone
 * else's submitted CI matches zero rows and is told so.
 *
 * ⚠ `updatedAt` MOVING IS INTENDED. Billing's marker watches it, so their rail
 * refreshes under them when the floor corrects something — a correction that
 * lands visibly beats one that does not.
 *
 * ⚠ WHAT THIS ROUTE WILL NOT TOUCH: ciNumber, status, submittedAt, returnType,
 * and every stage-2 column billing owns (ciDate, sapCiNumber, ciValue,
 * billingOperatorId, closedAt). The floor corrects what the floor entered.
 *
 * Sequential awaits, never prisma.$transaction (CORE §3).
 */

/** Editing a return is the FLOOR's action — the same set /submit uses. Billing
 *  holds `ci` canEdit too (it needs it to close), so the permission alone would
 *  let a billing operator rewrite a supervisor's answers. */
const EDIT_ROLES = [ROLES.FLOOR_SUPERVISOR, ROLES.OPERATIONS, ROLES.ADMIN];

export async function PATCH(
  req: Request,
  { params }: { params: { ciId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 🔴 canEdit, NOT canView — CORE records the standing bug where Mail Orders
  // and Picking write routes gate on canView, making a view-only grant a UI
  // illusion. CI does not inherit it.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "ci", "canEdit");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  // ⚠ `hasRole`, NOT `requireRole`. requireRole calls redirect("/unauthorized"),
  // which is right for a PAGE and wrong here: a fetch() would receive a 307 to
  // an HTML page instead of a JSON 403, and the client would report a parse
  // failure rather than "not allowed".
  if (!hasRole(session, EDIT_ROLES)) {
    return NextResponse.json(
      { error: "Changing a return is the floor supervisor's step." },
      { status: 403 },
    );
  }

  // Validate, never coerce. Digits only — a PATH segment has no reason to accept
  // "1e3", "+1" or " 1". The upper bound keeps a 20-digit URL a clean 400 rather
  // than a Prisma int4 overflow surfacing as a 500.
  const rawId = params.ciId?.trim() ?? "";
  const ciId = Number(rawId);
  if (!/^\d+$/.test(rawId) || ciId <= 0 || ciId > 2147483647) {
    return NextResponse.json(
      { error: `Invalid ciId "${params.ciId}" — expected a positive integer` },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    materialMoved?: unknown;
    materialReceivedDate?: unknown;
    reasonId?: unknown;
    reasonRemark?: unknown;
  };

  // ── Validate all four BEFORE any write ────────────────────────────────────
  //
  // 🔴 ALL FOUR ARE REQUIRED, even though this is a PATCH. A partial patch would
  // be a way to write a null into a column that
  // `chk_ci_returns_complete_when_not_draft` forbids on a non-draft row:
  //
  //   CHECK (status = 'draft' OR (materialMoved IS NOT NULL
  //          AND materialReceivedDate IS NOT NULL
  //          AND reasonId IS NOT NULL AND reasonLabel IS NOT NULL))
  //
  // The screen always sends the complete set — it renders every field seeded
  // from the CI — so requiring them costs nothing and removes the shape of
  // request that could violate the CHECK. `reasonRemark` is the one genuinely
  // optional field, and it is nullable in the database.
  //
  // Parsed to null-or-value rather than rejected field by field, so the error
  // can name EVERYTHING missing in one sentence.
  const materialMoved =
    typeof body.materialMoved === "string" && isCiMaterialMoved(body.materialMoved)
      ? body.materialMoved
      : null;

  let materialReceivedDate: Date | null = null;
  let dateError: string | null = null;
  if (typeof body.materialReceivedDate === "string") {
    try {
      materialReceivedDate = parseCiDateOnly(body.materialReceivedDate);
    } catch (err) {
      // A MALFORMED date is different from a MISSING one and must not be
      // reported as "missing" — he typed something and deserves to know it was
      // rejected rather than ignored.
      dateError = err instanceof Error ? err.message : "Invalid materialReceivedDate";
    }
  }
  if (dateError !== null) {
    return NextResponse.json({ error: dateError }, { status: 400 });
  }

  const parsedReasonId = Number(body.reasonId);
  const reasonId =
    Number.isInteger(parsedReasonId) && parsedReasonId > 0 ? parsedReasonId : null;

  // Empty/whitespace collapses to null rather than being stored as "" — a blank
  // remark and no remark are the same thing, and two representations of it means
  // two render branches downstream.
  const reasonRemark =
    typeof body.reasonRemark === "string" && body.reasonRemark.trim() !== ""
      ? body.reasonRemark.trim()
      : null;

  const missing: string[] = [];
  if (materialMoved === null) missing.push("whether the material has moved");
  if (materialReceivedDate === null) missing.push("the date it was received");
  if (reasonId === null) missing.push("a reason");
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `This return is missing ${formatList(missing)}.`, missing },
      { status: 400 },
    );
  }
  // TypeScript cannot see that the return above proved these three non-null —
  // it does not follow the array. Narrowed rather than asserted with `!`, so a
  // future edit that drops a field from `missing` fails loudly instead of
  // quietly writing a null into a column the CHECK requires.
  if (materialMoved === null || materialReceivedDate === null || reasonId === null) {
    return NextResponse.json(
      { error: "This return is missing part of the details step." },
      { status: 400 },
    );
  }

  // ── Resolve the reason and SNAPSHOT ITS LABEL ─────────────────────────────
  // A READ, not a second write.
  //
  // 🔴 THE LABEL COMES FROM ci_reason_master, NEVER FROM THE BODY — the same
  // rule /submit follows. Stored beside the FK so renaming a reason never
  // rewrites the history of CIs raised under the old wording (spec §3.1);
  // reading it here rather than trusting the client is what makes that snapshot
  // worth anything, because otherwise a phone could file "Return by Dealer"
  // against the id for "Wrong Punching".
  //
  // isActive is checked: a retired reason must not be selectable on an edit any
  // more than on a new CI, while existing CIs keep pointing at it (which is why
  // reasons are retired by flag and never deleted).
  const reason = await prisma.ci_reason_master.findFirst({
    where: { id: reasonId, isActive: true },
    select: { id: true, label: true },
  });
  if (!reason) {
    return NextResponse.json(
      { error: "That reason is no longer available — pick another." },
      { status: 400 },
    );
  }

  // ── The one guarded write ─────────────────────────────────────────────────
  const viewerId = Number(session.user.id);
  const res = await prisma.ci_returns.updateMany({
    where: {
      id: ciId,
      status: "submitted",
      supervisorId: viewerId,
      isVoided: false,
    },
    data: {
      materialMoved,
      materialReceivedDate,
      reasonId: reason.id,
      reasonLabel: reason.label,
      reasonRemark,
      updatedAt: new Date(),
    },
  });

  if (res.count === 0) {
    // ═══════════════════════════════════════════════════════════════════════
    // 🔴 THE RACE, LOST SAFELY. Nothing was written.
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Three ways to get here, and they need different sentences — "could not
    // save" would be true and useless in all three:
    //   • billing closed it while he had it open  (the common one)
    //   • it is not his CI                        (403-shaped, but the guard
    //                                              catches it either way)
    //   • it does not exist / was voided
    //
    // The client uses `raced` + `status` to refetch and flip to read-only. It
    // must NEVER retry, and must never report this as a save.
    const fresh = await prisma.ci_returns.findFirst({
      where: { id: ciId },
      select: { status: true, supervisorId: true, isVoided: true },
    });

    if (!fresh || fresh.isVoided) {
      return NextResponse.json({ error: "CI not found" }, { status: 404 });
    }
    if (fresh.supervisorId !== viewerId) {
      return NextResponse.json(
        { error: "Only the supervisor who raised this return can change it." },
        { status: 403 },
      );
    }
    return NextResponse.json(
      {
        error:
          fresh.status === "closed"
            ? "Billing closed this CI while you had it open, so your change was not saved."
            : `This CI is ${fresh.status} and can no longer be changed.`,
        status: fresh.status,
        raced: true,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ciId,
    status: "submitted",
    materialMoved,
    materialReceivedDate: materialReceivedDate.toISOString().slice(0, 10),
    reasonId: reason.id,
    reasonLabel: reason.label,
    reasonRemark,
  });
}

/** "a" · "a and b" · "a, b and c" — so the error reads as a sentence rather
 *  than a comma-joined field dump. */
function formatList(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
