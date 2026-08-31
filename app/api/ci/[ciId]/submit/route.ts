import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { allocateCiNumber } from "@/lib/ci/number";

export const dynamic = "force-dynamic";

/**
 * POST /api/ci/[ciId]/submit — step 3 of 3. Allocates the CI number and flips
 * the draft to `status = 'submitted'`. This is the moment the return becomes a
 * record and appears on billing's rail.
 *
 * Body: none.
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
  _req: Request,
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

  // ── Read the draft and check it is submittable. NO WRITES YET. ────────────
  const ci = await prisma.ci_returns.findFirst({
    where: { id: ciId, isVoided: false },
    select: {
      id: true,
      status: true,
      ciNumber: true,
      supervisorId: true,
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
