import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { litresPerTin, returnedLitres, round3 } from "@/lib/ci/derive";
import { applyCiCatalog, resolveCiSkus } from "@/lib/ci/resolve-lines";

export const dynamic = "force-dynamic";

/**
 * PUT /api/ci/[ciId]/lines — REPLACES every line on a CI.
 *
 * Body: { lines: [{ rawLineItemId, returnedQty }] }
 *       — ignored entirely when the CI's returnType is 'full'.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 TWO WAYS IN, AND ONLY TWO (owner ruling 2026-09-01, step 7e)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   1. status = 'draft'      — step 2 of the create flow. UNCHANGED.
 *   2. status = 'submitted'  — AND ONLY BY THE SUPERVISOR WHO RAISED IT.
 *
 * Everything else 409s, and 'closed' 409s WITH NO EXCEPTION: billing has punched
 * it into SAP by then and the document is real. This is also the answer to the
 * open "return to floor" question (spec §11.1) — billing does not send it back,
 * they tell the floor and he fixes it himself. A 'returned_to_floor' CI still
 * does NOT reopen this route; that flow is not built, and whether it rewinds to
 * 'draft' or edits in place stays a product decision rather than something to
 * infer from a status check here.
 *
 * ⚠ THE DRAFT PATH IS LOAD-BEARING AND MUST NOT BE COLLAPSED INTO THE OTHER.
 * `WHERE status = 'draft'` is what makes the create flow idempotent: the client
 * holds ONE ciId, so a re-tap re-PUTs onto the same row instead of raising a
 * second CI. Widening this route did not touch that.
 *
 * ── ORDER OF OPERATIONS, AND WHY IT IS THIS ORDER ───────────────────────────
 *   1. Read the draft, read the OBD's ACTIVE lines, resolve the catalog, and
 *      VALIDATE. No writes yet, so every rejection below leaves the draft
 *      exactly as it was. Same reasoning as app/api/mrn/[mrnId]/lines/route.ts:
 *      validate everything while the cost of failing is still zero.
 *   2. deleteMany the existing ci_return_lines.
 *   3. createMany the new ones.
 *
 * ⚠ NO TRANSACTION, AND A FAILURE BETWEEN (2) AND (3) LEAVES THE CI WITH ZERO
 * LINES — stated plainly rather than papered over, exactly as MRN's lines route
 * states it. prisma.$transaction is banned (Vercel serverless + the Supabase
 * pooler time out on it — CORE §3).
 *
 * 🔴 THE DAMAGE IS NOT THE SAME ON THE TWO PATHS, AND THE SECOND IS WORSE.
 *   draft     — a lineless draft is INVISIBLE to every read (all feeds filter
 *               `status <> 'draft'`) and cannot be submitted (the submit route
 *               rejects zero lines). It is inert; the supervisor taps Save
 *               again.
 *   submitted — a lineless SUBMITTED CI is a numbered record sitting on
 *               billing's rail with nothing on it. Nothing is lost that cannot
 *               be re-entered, but somebody else can see it in that state, so
 *               the error below says so explicitly and tells him to save again
 *               rather than leaving him to discover it.
 *
 * A safe reorder was considered and rejected: inserting the new rows at offset
 * lineNumbers, deleting the old, then renumbering is THREE writes whose own
 * partial failures leave a CI with two overlapping line sets — a worse state,
 * reached more often, to avoid a rarer one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 WHAT THE CLIENT MAY DECIDE, AND WHAT IT MAY NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * ACCEPTED: rawLineItemId + returnedQty pairs, and only on a 'part' return.
 * DERIVED, re-read from `import_raw_line_items` + `sku_master_v2` every time:
 *   skuCode · skuDescription · packCode · deliveryQty · litresPerTin ·
 *   returnedQtyLitres · lineNumber
 *
 * A client that posts a litres figure, a pack, a description or a delivery
 * quantity is IGNORED. Litres in particular are never accepted: they are
 * SAP's volumeLine ÷ unitQty (lib/ci/derive.ts owns that rule and the argument
 * for why the catalog must never be the source), and a phone that could post
 * them could post any number onto a document that replaces a signed form.
 */
export async function PUT(
  req: Request,
  { params }: { params: { ciId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 🔴 canEdit, NOT canView — see app/api/ci/draft/route.ts.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "ci", "canEdit");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const rawId = params.ciId?.trim() ?? "";
  const ciId = Number(rawId);
  if (!/^\d+$/.test(rawId) || ciId <= 0 || ciId > 2147483647) {
    return NextResponse.json(
      { error: `Invalid ciId "${params.ciId}" — expected a positive integer` },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { lines?: unknown };

  // ── 1a. The draft ──────────────────────────────────────────────────────────
  const ci = await prisma.ci_returns.findFirst({
    where: { id: ciId, isVoided: false },
    select: { id: true, status: true, obdNumber: true, returnType: true, supervisorId: true },
  });
  if (!ci) {
    return NextResponse.json({ error: "CI not found" }, { status: 404 });
  }
  const viewerId = Number(session.user.id);
  const editingSubmitted = ci.status === "submitted";

  if (ci.status !== "draft" && !editingSubmitted) {
    return NextResponse.json(
      {
        error:
          ci.status === "closed"
            ? "Billing has closed this CI — its lines can no longer be changed."
            : `This CI is ${ci.status} — its lines can no longer be changed.`,
        status: ci.status,
      },
      { status: 409 },
    );
  }

  // ── Ownership ─────────────────────────────────────────────────────────────
  // The permission grant says "may raise returns", not "may edit anyone's
  // return".
  //
  // ⚠ THE TWO PATHS HAVE DIFFERENT OWNERSHIP RULES, ON PURPOSE.
  //   draft     — admin and operations keep the support bypass they have always
  //               had. A draft is invisible to every read and carries no number,
  //               so a support user fixing one changes nothing anyone has seen.
  //   submitted — NO BYPASS. The owner ruling names the rule as "only by the
  //               supervisor who raised it", and the guard below is written that
  //               way verbatim. A submitted CI has a number, is on billing's
  //               rail and may already have been read off a screen; an admin
  //               silently rewriting one is exactly the thing the ruling
  //               refuses. If support ever needs it, that is a new decision with
  //               its own audit trail, not a quiet `||` here.
  if (editingSubmitted) {
    if (ci.supervisorId !== viewerId) {
      return NextResponse.json(
        { error: "Only the supervisor who raised this return can change it." },
        { status: 403 },
      );
    }
  } else if (
    !roles.includes("admin") &&
    !roles.includes("operations") &&
    ci.supervisorId !== viewerId
  ) {
    return NextResponse.json(
      { error: "This draft belongs to another supervisor." },
      { status: 403 },
    );
  }

  // ── 1b. The OBD's ACTIVE lines — the only lines that may be returned ───────
  // 🔴 lineStatus 'active' ONLY. 113 rows across 100 OBDs are
  // 'removed_by_import'; offering one would let a supervisor return a line SAP
  // has withdrawn. Joined on the obdNumber TEXT column — there is no FK from
  // `orders` to its line items (Picking and Floor both join on the string).
  const active = await prisma.import_raw_line_items.findMany({
    where: { obdNumber: ci.obdNumber, lineStatus: "active" },
    select: { id: true, skuCodeRaw: true, unitQty: true, volumeLine: true },
    orderBy: { lineId: "asc" },
  });
  if (active.length === 0) {
    return NextResponse.json(
      { error: `Bill ${ci.obdNumber} has no active lines to return.` },
      { status: 409 },
    );
  }
  const activeById = new Map(active.map((l) => [l.id, l]));

  // ── 1c. Build the requested set ────────────────────────────────────────────
  // 🔴 'full' IS COMPUTED HERE, NEVER ACCEPTED. The whole point of "Full bill"
  // is that it means *every active line at its delivered quantity* — if the
  // client supplied that list, a stale phone holding a bill from before a
  // re-import would file a "full" return that silently omitted a line.
  let requested: { rawLineItemId: number; returnedQty: number }[];

  if (ci.returnType === "full") {
    requested = active.map((l) => ({ rawLineItemId: l.id, returnedQty: l.unitQty ?? 0 }));
    // A delivered quantity of 0 cannot be returned. If SAP sent one, the bill
    // cannot be fully returned and the supervisor must use Part.
    const zero = requested.filter((r) => r.returnedQty < 1);
    if (zero.length > 0) {
      return NextResponse.json(
        {
          error:
            `Bill ${ci.obdNumber} has ${zero.length} line(s) with no delivered quantity, ` +
            "so it cannot be returned in full. Use Part and pick the lines that came back.",
        },
        { status: 409 },
      );
    }
  } else {
    if (!Array.isArray(body.lines)) {
      return NextResponse.json(
        { error: "`lines` is required on a part return — expected an array" },
        { status: 400 },
      );
    }
    if (body.lines.length === 0) {
      return NextResponse.json(
        { error: "A CI must have at least one line." },
        { status: 400 },
      );
    }

    const seen = new Set<number>();
    requested = [];
    for (const entry of body.lines as unknown[]) {
      const e = entry as { rawLineItemId?: unknown; returnedQty?: unknown };
      const rawLineItemId = Number(e.rawLineItemId);
      const returnedQty = Number(e.returnedQty);

      if (!Number.isInteger(rawLineItemId) || rawLineItemId <= 0) {
        return NextResponse.json(
          { error: "Every line needs a positive integer `rawLineItemId`" },
          { status: 400 },
        );
      }
      // Duplicates would collide on UNIQUE(ciReturnId, lineNumber) only by luck
      // of ordering; rejecting them here makes the failure legible instead.
      if (seen.has(rawLineItemId)) {
        return NextResponse.json(
          { error: `Line ${rawLineItemId} appears more than once.` },
          { status: 400 },
        );
      }
      seen.add(rawLineItemId);

      // ⚠ >= 1. A zero-quantity line is not "nothing came back on this line" —
      // it is a line that should not have been sent at all. Storing it would
      // put a 0-tin row on a printed return.
      if (!Number.isInteger(returnedQty) || returnedQty < 1) {
        return NextResponse.json(
          { error: `Line ${rawLineItemId}: \`returnedQty\` must be a whole number of at least 1.` },
          { status: 400 },
        );
      }

      // 🔴 The line must belong to THIS OBD and be active. This is the check
      // that stops a tampered payload attaching another bill's line — and
      // rawLineItemId is a global PK, so without it any id in the table would
      // be accepted.
      const src = activeById.get(rawLineItemId);
      if (!src) {
        return NextResponse.json(
          {
            error:
              `Line ${rawLineItemId} is not an active line on bill ${ci.obdNumber}. ` +
              "The bill may have changed since it was opened — reopen it and try again.",
          },
          { status: 400 },
        );
      }

      // The supervisor picked from a list, so a quantity above what was
      // delivered is a bug or a tampered payload, not a real return. Only
      // enforced when the delivered quantity is KNOWN — null means SAP did not
      // send one, and inventing a ceiling from nothing would block a legitimate
      // return.
      const delivered = src.unitQty;
      if (delivered !== null && returnedQty > delivered) {
        return NextResponse.json(
          {
            error:
              `Line ${rawLineItemId}: ${returnedQty} tins cannot come back — ` +
              `only ${delivered} were delivered.`,
          },
          { status: 400 },
        );
      }

      requested.push({ rawLineItemId, returnedQty });
    }
  }

  // ── 1d. Catalog, for the name/pack snapshots ──────────────────────────────
  // Unmastered codes are stored AS-IS and never reject a save: ~5.9% of active
  // lines resolve in neither catalog table, and the screens render the bare
  // code with the line still fully returnable.
  const catalog = await resolveCiSkus(
    requested.map((r) => activeById.get(r.rawLineItemId)?.skuCodeRaw ?? null),
  );

  // Everything below is DERIVED. Nothing here came off the wire except
  // rawLineItemId and returnedQty.
  const rows = requested.map((r, i) => {
    const src = activeById.get(r.rawLineItemId)!;
    const code = src.skuCodeRaw ?? "";
    const resolved = applyCiCatalog(code, catalog);
    // 🔴 Guarded on unitQty ONLY. volumeLine = 0 is a REAL value — 346 active
    // lines are brushes and rollers — and must snapshot as 0, never as null.
    const perTin = litresPerTin(src.volumeLine, src.unitQty);
    return {
      ciReturnId: ciId,
      // 1..N in the order the lines sit on the bill. Not the SAP item number —
      // that is display-only and can be sparse.
      lineNumber: i + 1,
      rawLineItemId: r.rawLineItemId,
      skuCode: code,
      skuDescription: resolved.description,
      packCode: resolved.pack,
      deliveryQty: src.unitQty,
      returnedQty: r.returnedQty,
      litresPerTin: perTin,
      returnedQtyLitres: returnedLitres(perTin, r.returnedQty),
    };
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 🔴 THE CLAIM — ONE GUARDED updateMany, AND IT IS THE RACE GUARD
  // ═════════════════════════════════════════════════════════════════════════
  //
  // Everything above was a READ. Between that read and the writes below,
  // billing can close this CI from the desk — they poll every 15s and the
  // Close CI button is one click. Without this statement the supervisor's save
  // would land on a closed document and nobody would ever know.
  //
  // So the states are re-tested AS PART OF A WRITE, which is the only way to
  // make the test and the decision one operation:
  //   • 'draft'      — the create flow, unchanged
  //   • 'submitted'  — and `supervisorId` must still be the viewer
  // A close between the read and here means this matches ZERO rows, and we stop
  // BEFORE deleting anything.
  //
  // ⚠ IT MUST STAY AN updateMany WITH THE STATUS IN THE `where`, never a
  // findFirst-then-update — the same rule the submit route's header states. A
  // read-then-write reopens the window it is supposed to close.
  //
  // ⚠ THE WINDOW IS NARROWED, NOT ELIMINATED, and pretending otherwise would be
  // worse than saying it: a close landing between this statement and the
  // createMany below still wins on paper while these lines get rewritten.
  // prisma.$transaction is banned (CORE §3) so that gap cannot be closed here.
  // It is milliseconds against a human clicking a button, and the damage is a
  // line list that disagrees with a closed CI — visible, and fixable by billing.
  //
  // ⚠ `updatedAt` MOVING IS THE POINT, NOT A SIDE EFFECT TO SUPPRESS. Billing's
  // marker watches it, so their rail refreshes under them when the floor
  // corrects something. A correction that lands visibly beats one that does not.
  const claim = await prisma.ci_returns.updateMany({
    where: editingSubmitted
      ? { id: ciId, status: "submitted", supervisorId: viewerId, isVoided: false }
      : { id: ciId, status: "draft", isVoided: false },
    data: { updatedAt: new Date() },
  });
  if (claim.count === 0) {
    // Report the CI AS IT NOW STANDS. The client uses this to refetch and flip
    // to read-only — never to retry, and never to pretend the save worked.
    const fresh = await prisma.ci_returns.findFirst({
      where: { id: ciId },
      select: { status: true },
    });
    return NextResponse.json(
      {
        error:
          fresh?.status === "closed"
            ? "Billing closed this CI while you had it open, so your change was not saved."
            : "This CI changed while you had it open — nothing was saved.",
        status: fresh?.status ?? "unknown",
        raced: true,
      },
      { status: 409 },
    );
  }

  // ── 2. Clear. ──────────────────────────────────────────────────────────────
  // Sequential awaits, never prisma.$transaction (CORE §3).
  await prisma.ci_return_lines.deleteMany({ where: { ciReturnId: ciId } });

  // ── 3. Write. From here until this resolves the draft has ZERO lines. ──────
  try {
    await prisma.ci_return_lines.createMany({ data: rows });
  } catch (err) {
    // ⚠ THE LINES ARE GONE. Say it in the operator's words — this must not read
    // as "the save didn't work", which would leave them believing the previous
    // selection survived.
    //
    // NO MANUAL ROLLBACK. The draft stays exactly where it is: it is invisible
    // to every read (all feeds filter `status <> 'draft'`) and cannot be
    // submitted (the submit route rejects zero lines), so an orphaned lineless
    // draft is inert. Deleting it here would be a second write that can fail
    // for the same reason the first one did.
    console.error(
      `[ci/lines] createMany failed for ci #${ciId} (obd ${ci.obdNumber}, ` +
        `status ${ci.status}, ${rows.length} lines) after deleteMany — ` +
        "CI left with zero lines:",
      err,
    );
    return NextResponse.json(
      {
        error: editingSubmitted
          ? // He is editing a record billing can already see. Say that.
            "The previous lines were cleared but the new ones could not be saved, so this " +
            "return now shows no lines to billing. Choose the lines again and save — and tell " +
            "billing if they are already working on it."
          : "The previous lines were cleared but the new ones could not be saved, so this return " +
            "now has no lines. Nothing was kept and nothing was submitted — choose the lines again.",
        linesCleared: true,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ciId,
    returnType: ci.returnType,
    lineCount: rows.length,
    totalTins: rows.reduce((s, r) => s + r.returnedQty, 0),
    totalLitres: round3(rows.reduce((s, r) => s + (r.returnedQtyLitres ?? 0), 0)),
    // Informational only — these lines ARE saved. Lets the UI warn that some
    // rows will print without a product name.
    unmatchedCount: rows.filter((r) => r.skuDescription === null).length,
  });
}
