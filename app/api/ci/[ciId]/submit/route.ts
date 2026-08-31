import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { allocateCiNumber } from "@/lib/ci/number";
import { parseCiDateOnly } from "@/lib/ci/derive";
import { isCiMaterialMoved } from "@/lib/ci/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/ci/[ciId]/submit — step 3 of 3. Allocates the CI number and flips
 * the draft to `status = 'submitted'`. This is the moment the return becomes a
 * record and appears on billing's rail.
 *
 * Body: { materialMoved, materialReceivedDate, reasonId, reasonRemark? }
 *
 * ⚠ THE STAGE-1 ANSWERS ARRIVE HERE, not in a separate PATCH. They are written
 * in the SAME guarded updateMany as the number and the flip — see the block
 * above that statement for why a PATCH-then-submit pair is unsafe.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE DOUBLE-TAP GUARD — `WHERE status = 'draft'`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A supervisor on a phone WILL tap Submit twice. The client holds ONE ciId from
 * the draft call, so the second tap arrives here against the SAME ROW — and the
 * update below is an `updateMany` guarded on `status: "draft"`. The second call
 * therefore matches ZERO rows, writes nothing, and returns the CI as it already
 * stands. No second number is burned, no second CI exists.
 *
 * ⚠ IT MUST STAY AN `updateMany` WITH THE STATUS IN THE `where`, not a
 * read-then-`update`. A read-then-write has a window between the two in which a
 * concurrent submit can pass the same check; the guarded updateMany makes the
 * status test and the write ONE statement, which is what closes it. Do not
 * "simplify" this to findFirst + update.
 *
 * ⚠ AND DO NOT COLLAPSE draft+lines+submit INTO ONE ROUTE. A single POST would
 * create a second CI, with a second number, on every double-tap. The three-route
 * split IS the idempotency (spec §6's write order).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE NUMBER IS ALLOCATED HERE AND NOWHERE ELSE (spec §5)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Never when the form opens. That is precisely why `ci_returns.ciNumber` is
 * NULLABLE: a draft carries no number, so a failure part-way through the flow
 * leaves a numberless draft rather than a numbered CI with no lines on the
 * floor's screen.
 *
 * lib/ci/number.ts is deliberately NOT atomic (spec §5) and UNIQUE(ciNumber) is
 * the real backstop. On a P2002 collision we re-allocate ONCE and retry — two
 * supervisors submitting in the same millisecond is the only way to get here,
 * and one retry clears it. We do NOT loop, and we do NOT reach for
 * prisma.$transaction: it is banned (CORE §3).
 */

/** Who may submit: this is the FLOOR's action. */
const SUBMIT_ROLES = [ROLES.FLOOR_SUPERVISOR, ROLES.OPERATIONS, ROLES.ADMIN];

export async function POST(
  req: Request,
  { params }: { params: { ciId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // TWO gates, and they answer different questions.
  //
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
  // ...and WHICH SIDE of the workflow this is. Submitting is the floor's step;
  // billing holds `ci` canEdit too (it needs it to close), so the permission
  // alone would let a billing operator raise a return on a supervisor's behalf.
  //
  // ⚠ `hasRole`, NOT `requireRole`. requireRole calls redirect("/unauthorized"),
  // which is right for a PAGE and wrong here: a fetch() would receive a 307 to
  // an HTML page instead of a JSON 403, and the client's error handling would
  // report a parse failure rather than "not allowed".
  if (!hasRole(session, SUBMIT_ROLES)) {
    return NextResponse.json(
      { error: "Submitting a return is the floor supervisor's step." },
      { status: 403 },
    );
  }

  const rawId = params.ciId?.trim() ?? "";
  const ciId = Number(rawId);
  if (!/^\d+$/.test(rawId) || ciId <= 0 || ciId > 2147483647) {
    return NextResponse.json(
      { error: `Invalid ciId "${params.ciId}" — expected a positive integer` },
      { status: 400 },
    );
  }

  // ── The stage-1 answers, from the body. Validated BEFORE any write. ───────
  const body = (await req.json().catch(() => ({}))) as {
    materialMoved?: unknown;
    materialReceivedDate?: unknown;
    reasonId?: unknown;
    reasonRemark?: unknown;
  };

  // Parsed to null-or-value rather than rejected field by field, so the error
  // below can name EVERYTHING that is missing in one sentence. Three separate
  // 400s would make the supervisor fix one thing, tap Submit, and be told about
  // the next.
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
      // reported as "missing" — the supervisor typed something and deserves to
      // know it was rejected rather than ignored.
      dateError = err instanceof Error ? err.message : "Invalid materialReceivedDate";
    }
  }
  if (dateError !== null) {
    return NextResponse.json({ error: dateError }, { status: 400 });
  }

  const parsedReasonId = Number(body.reasonId);
  const reasonId =
    Number.isInteger(parsedReasonId) && parsedReasonId > 0 ? parsedReasonId : null;

  // Optional. Empty/whitespace collapses to null rather than being stored as ""
  // — a blank remark and no remark are the same thing, and two representations
  // of it means two render branches downstream.
  const reasonRemark =
    typeof body.reasonRemark === "string" && body.reasonRemark.trim() !== ""
      ? body.reasonRemark.trim()
      : null;

  // ── Read the draft and check it is submittable. NO WRITES YET. ────────────
  const ci = await prisma.ci_returns.findFirst({
    where: { id: ciId, isVoided: false },
    select: {
      id: true,
      status: true,
      ciNumber: true,
      supervisorId: true,
      // ⚠ The four stage-1 columns are NOT read here. They are NULL on a draft
      // by design and this request is what fills them — reading the row's
      // (null) values to validate against would be checking the wrong copy.
      _count: { select: { lines: true } },
    },
  });
  if (!ci) {
    return NextResponse.json({ error: "CI not found" }, { status: 404 });
  }

  // ⚠ NOT AN ERROR ON THE SECOND TAP. A CI that is already submitted is the
  // expected result of a double-tap or a retried request on a flaky depot
  // connection, and the honest answer is "this is done", with the number, so
  // the phone can show the success screen. 200, not 409 — the client asked for
  // a submitted CI and there is one.
  if (ci.status !== "draft") {
    return NextResponse.json({
      ciId: ci.id,
      ciNumber: ci.ciNumber,
      status: ci.status,
      alreadySubmitted: true,
    });
  }

  // Ownership — same rule as the lines route. A draft belongs to the supervisor
  // who opened it; admin and operations keep the bypass for support work.
  const viewerId = Number(session.user.id);
  if (
    !roles.includes("admin") &&
    !roles.includes("operations") &&
    ci.supervisorId !== viewerId
  ) {
    return NextResponse.json(
      { error: "This draft belongs to another supervisor." },
      { status: 403 },
    );
  }

  // 🔴 ZERO LINES CANNOT BE SUBMITTED. This is also the backstop that makes an
  // orphaned lineless draft — the failure mode the lines route documents —
  // inert rather than dangerous: it can never become a numbered record.
  if (ci._count.lines === 0) {
    return NextResponse.json(
      { error: "This return has no lines. Choose at least one line before submitting." },
      { status: 400 },
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 🔴 THE STAGE-1 ANSWERS ARRIVE IN THIS REQUEST AND ARE WRITTEN WITH THE FLIP
  // ═════════════════════════════════════════════════════════════════════════
  //
  // The four columns are NULLABLE so a draft can exist before the details
  // screen has been answered (owner ruling 2026-09-01 — a draft carries NULL,
  // never a placeholder), and `chk_ci_returns_complete_when_not_draft` makes
  // them mandatory the moment status stops being 'draft':
  //
  //   CHECK (status = 'draft' OR (materialMoved IS NOT NULL
  //          AND materialReceivedDate IS NOT NULL
  //          AND reasonId IS NOT NULL AND reasonLabel IS NOT NULL))
  //
  // 🔴 THEY ARE WRITTEN IN THE SAME updateMany AS THE NUMBER AND THE FLIP, AND
  // THAT IS NOT AN OPTIMISATION. A PATCH-then-submit pair would leave a window
  // in which the row carries the details but is still a draft — and a phone that
  // dies in that window has a CI that is invisible to every screen (all reads
  // filter `status <> 'draft'`) with no way for the supervisor to find it again.
  // He would simply re-do the whole return. ONE guarded statement means the
  // details and the number land together or not at all, and a double-tap still
  // matches zero rows the second time.
  //
  // ⚠ THE CHECK IS THE BACKSTOP, NOT THE ERROR MESSAGE. Without the validation
  // below, an incomplete submit would surface to a supervisor's phone as
  // `violates check constraint "chk_ci_returns_complete_when_not_draft"` —
  // technically correct, useless to a man holding returned stock. If that string
  // ever reaches the UI, this validation has a hole: fix it, never weaken the
  // CHECK.
  const missing: string[] = [];
  if (materialMoved === null) missing.push("whether the material has moved");
  if (materialReceivedDate === null) missing.push("the date it was received");
  if (reasonId === null) missing.push("a reason");

  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `This return is missing ${formatList(missing)}. Fill the details step, then submit.`,
        missing,
      },
      { status: 400 },
    );
  }

  // TypeScript cannot see that the `missing` return above already proved these
  // three are non-null — it does not follow the array. Narrowed here rather than
  // asserted with `!`, so that a future edit which drops a field from `missing`
  // fails loudly instead of quietly writing a null into a column the CHECK
  // requires the moment this row stops being a draft.
  if (materialMoved === null || materialReceivedDate === null || reasonId === null) {
    return NextResponse.json(
      { error: "This return is missing part of the details step." },
      { status: 400 },
    );
  }

  // ── Resolve the reason, and SNAPSHOT ITS LABEL. ───────────────────────────
  // A READ, not a second write — the one statement rule below is about writes.
  //
  // The label is stored beside the FK so renaming a reason never rewrites the
  // history of CIs raised under the old wording (spec §3.1). Reading it here
  // rather than accepting it from the body is what makes that snapshot
  // trustworthy: a client cannot file "Return by Dealer" against the id for
  // "Wrong Punching".
  //
  // isActive is checked — a retired reason must not be selectable on a NEW CI,
  // while existing CIs keep pointing at it (which is why reasons are retired by
  // flag and never deleted).
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

  // ── Allocate + flip, guarded. ─────────────────────────────────────────────
  // ONE clock for the whole operation: the same instant stamps submittedAt and
  // decides which year's sequence the number counts against. Reading the clock
  // twice could straddle midnight on 31 December and file the number under one
  // year with a timestamp in the other.
  const now = new Date();
  const MAX_ATTEMPTS = 2; // the allocation, then ONE retry (spec §5)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const identity = await allocateCiNumber(now);

    try {
      // 🔴 THE GUARD. `status: "draft"` inside the where is what makes a
      // double-tap a no-op — see this file's header.
      const res = await prisma.ci_returns.updateMany({
        where: { id: ciId, status: "draft", isVoided: false },
        data: {
          // The four stage-1 answers, written WITH the flip — never before it.
          materialMoved,
          materialReceivedDate,
          reasonId: reason.id,
          reasonLabel: reason.label,
          reasonRemark,
          ciNumber: identity.ciNumber,
          status: "submitted",
          submittedAt: now,
        },
      });

      if (res.count === 0) {
        // Someone else submitted this row between our read and our write — the
        // race the guard exists to lose safely. Nothing was written; report the
        // CI as it now stands rather than inventing an error.
        const fresh = await prisma.ci_returns.findFirst({
          where: { id: ciId },
          select: { id: true, ciNumber: true, status: true },
        });
        return NextResponse.json({
          ciId,
          ciNumber: fresh?.ciNumber ?? null,
          status: fresh?.status ?? "unknown",
          alreadySubmitted: true,
        });
      }

      return NextResponse.json({
        ciId,
        ciNumber: identity.ciNumber,
        status: "submitted",
        submittedAt: now.toISOString(),
      });
    } catch (err) {
      const collided =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

      // Retry ONCE. Nothing partial was written — the update either applied or
      // it did not — so the next attempt starts clean.
      if (collided && attempt < MAX_ATTEMPTS) continue;

      if (collided) {
        // 409, not 500: nothing is broken. Two returns were submitted at the
        // same instant and this one lost twice. No cleanup is needed — the draft
        // is untouched and still submittable.
        console.error(`[ci/submit] ciNumber collision twice for ci #${ciId}`);
        return NextResponse.json(
          {
            error:
              "Could not allocate a CI number — another return was submitted at the same moment. " +
              "Please try again.",
          },
          { status: 409 },
        );
      }

      throw err;
    }
  }

  // Unreachable: the loop either returns or throws. Present so the function has
  // a total return type rather than an implicit undefined path.
  return NextResponse.json({ error: "Could not allocate a CI number." }, { status: 409 });
}

/** "a" · "a and b" · "a, b and c" — so the error reads as a sentence rather
 *  than a comma-joined field dump. */
function formatList(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
