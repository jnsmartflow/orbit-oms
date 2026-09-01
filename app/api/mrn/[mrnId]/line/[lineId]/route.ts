import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { validateBatches, validateConditionCounts } from "@/lib/mrn/derive";
import type { MrnBatchInput } from "@/lib/mrn/types";

export const dynamic = "force-dynamic";

/**
 * PUT /api/mrn/[mrnId]/line/[lineId] — the supervisor confirms ONE line.
 *
 * Body: { physicalQty, sndQty?, leakyQty?, damageQty?, emptyQty?, qtdQty?,
 *         rejQty?, batches: [{ batchNo, qty, mfgMonth, mfgYear }] }
 *
 * 409 unless status === 'checking'. RE-CONFIRMING AN ALREADY-CHECKED LINE IS
 * ALLOWED while the MRN is 'checking' — a supervisor correcting himself before
 * End unloading is normal, not an error, so there is deliberately no
 * `isChecked === false` guard.
 *
 * ⚠ EVERY DOMAIN RULE IS CALLED, NEVER RESTATED. validateBatches() and
 * validateConditionCounts() in lib/mrn/derive.ts own the arithmetic; the phone
 * renders their `message` live on every keystroke and this route returns the
 * SAME message, so the screen and the server can never disagree about why a
 * line will not confirm. The only checks written out below are STORABILITY
 * checks (is this an integer the column can hold), which are a different
 * question from the domain rules.
 *
 * ⚠ physicalQty === 0 IS VALID AND CARRIES ZERO BATCHES (design §11 OQ-4). A
 * truck genuinely bringing none of a line is a real receipt. chk_mrn_batch_qty
 * requires qty > 0 per row, so a zero line simply has no rows — validateBatches
 * encodes exactly that, and an empty array is never treated as a failure here.
 *
 * 🔴 BEST BEFORE IS NOT COLLECTED AT ALL (2026-08-22, schema v27.17). It is not
 * in the body, not validated, and not written — the column is nullable and
 * every row created here has NULL in both halves. Earlier revisions required it
 * from the body, and before that derived it as manufacturing + 24 months; both
 * are recorded in prisma/schema.prisma so neither is revived. Do not add a
 * pre-fill or a default in any direction.
 *
 * ── WRITE ORDER — THE ONE DANGEROUS SEQUENCE IN THIS MODULE ─────────────────
 *
 *   (1) deleteMany the line's existing batches
 *   (2) createMany the new batches
 *   (3) update the line: physicalQty, the six counts, then
 *       isChecked / checkedAt / checkedById
 *   (4) bump mrn.updatedAt — marker propagation, see below
 *
 * `isChecked` IS WRITTEN LAST, AND THAT IS THE WHOLE POINT. If (2) fails, the
 * line is left UNCHECKED with no batches: visibly incomplete, and the
 * supervisor simply taps it again — the re-confirm path above exists for
 * exactly this. Reverse the order and a failure leaves a line marked CHECKED
 * with no manufacturing data: it looks finished, it counts toward End
 * unloading's "every line checked" gate, and nobody sees the hole until the
 * report is printed. Same reasoning as app/api/picking/assign/route.ts writing
 * its pick_assignments row BEFORE advancing the stage.
 *
 * Sequential awaits throughout — never prisma.$transaction (CORE §3). There is
 * no transaction and none is possible, so the failure states are stated rather
 * than pretended away:
 *   fail at (1) → nothing changed.
 *   fail at (2) → batches gone, line still unchecked. Re-tap fixes it.
 *   fail at (3) → batches written, line still unchecked. Re-tap fixes it —
 *                 (1) clears them again, so duplicates cannot accumulate.
 *   fail at (4) → the line IS confirmed; only the live-sync signal is lost.
 */

/** A non-negative whole number, or null/absent. Storability only — NOT a domain
 *  rule. Returns `undefined` when the value is unusable. */
function optionalCount(v: unknown): number | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return undefined;
  return v;
}

export async function PUT(
  req: Request,
  { params }: { params: { mrnId: string; lineId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // canEdit — floor_supervisor holds it true, which is the whole point of the
  // three supervisor routes. Same gate + admin bypass shape as step 5.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mrn", "canEdit");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // session.user.id is a string (lib/auth.ts). Number("") is 0 and finite, so
  // require a real positive integer rather than trusting isFinite.
  const checkedById = Number(session.user.id);
  if (!Number.isInteger(checkedById) || checkedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  // Both path segments, validated identically to app/api/mrn/[mrnId]/route.ts.
  const rawMrn = params.mrnId?.trim() ?? "";
  const mrnId = Number(rawMrn);
  if (!/^\d+$/.test(rawMrn) || mrnId <= 0 || mrnId > 2147483647) {
    return NextResponse.json(
      { error: `Invalid mrnId "${params.mrnId}" — expected a positive integer` },
      { status: 400 },
    );
  }
  const rawLine = params.lineId?.trim() ?? "";
  const lineId = Number(rawLine);
  if (!/^\d+$/.test(rawLine) || lineId <= 0 || lineId > 2147483647) {
    return NextResponse.json(
      { error: `Invalid lineId "${params.lineId}" — expected a positive integer` },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // ── physicalQty ────────────────────────────────────────────────────────────
  // Required and >= 0. Zero is a REAL value, never a missing one (OQ-4), which
  // is why this tests the type rather than truthiness.
  if (
    typeof body.physicalQty !== "number" ||
    !Number.isInteger(body.physicalQty) ||
    body.physicalQty < 0
  ) {
    return NextResponse.json(
      { error: "`physicalQty` is required and must be a whole number of 0 or more" },
      { status: 400 },
    );
  }
  const physicalQty = body.physicalQty;

  // ── The six condition counts ───────────────────────────────────────────────
  // All six are null until the supervisor opens the issue toggle. QTD and REJ
  // are stored but sit OUTSIDE the four-way sum (design §4 / §6.4) —
  // validateConditionCounts owns that distinction; this only checks storability.
  const countKeys = ["sndQty", "leakyQty", "damageQty", "emptyQty", "qtdQty", "rejQty"] as const;
  const counts: Record<(typeof countKeys)[number], number | null> = {
    sndQty: null,
    leakyQty: null,
    damageQty: null,
    emptyQty: null,
    qtdQty: null,
    rejQty: null,
  };
  for (const key of countKeys) {
    const parsed = optionalCount(body[key]);
    if (parsed === undefined) {
      return NextResponse.json(
        { error: `${key} must be a whole number of 0 or more, or null` },
        { status: 400 },
      );
    }
    counts[key] = parsed;
  }

  // ── Batches ────────────────────────────────────────────────────────────────
  const rawBatches = body.batches === undefined ? [] : body.batches;
  if (!Array.isArray(rawBatches)) {
    return NextResponse.json({ error: "`batches` must be an array" }, { status: 400 });
  }

  const batches: MrnBatchInput[] = [];
  const batchNos: number[] = [];
  for (let i = 0; i < rawBatches.length; i += 1) {
    const b = rawBatches[i] as Record<string, unknown>;
    if (typeof b !== "object" || b === null) {
      return NextResponse.json({ error: `Batch ${i + 1} is not an object` }, { status: 400 });
    }

    // batchNo carries UNIQUE(lineId, batchNo) — a duplicate would come back as
    // a raw P2002 out of createMany, so it is caught here as a sentence.
    const batchNo = b.batchNo;
    if (typeof batchNo !== "number" || !Number.isInteger(batchNo) || batchNo <= 0) {
      return NextResponse.json(
        { error: `Batch ${i + 1} needs a whole batchNo of 1 or more` },
        { status: 400 },
      );
    }
    batchNos.push(batchNo);

    // qty and the two months are validated by validateBatches() below — NOT
    // duplicated here. These checks are storability only: the columns are NOT
    // NULL Int, so a non-integer would throw out of Prisma instead of returning
    // a sentence. In particular this is NOT a "reasonable year" test — derive.ts
    // deliberately declines to make that judgement (it ages), and so does this.
    // ⚠ bestBefore* IS NOT READ (2026-08-22, schema v27.17). The supervisor no
    // longer records it, so the client sends nothing and this writes NULL. A
    // caller that sends it anyway is IGNORED rather than rejected — it is not
    // an error, it is a field that stopped existing. See prisma/schema.prisma.
    for (const key of ["qty", "mfgMonth", "mfgYear"] as const) {
      if (typeof b[key] !== "number" || !Number.isInteger(b[key])) {
        return NextResponse.json(
          { error: `Batch ${i + 1} needs a whole ${key}.` },
          { status: 400 },
        );
      }
    }

    batches.push({
      qty: b.qty as number,
      mfgMonth: b.mfgMonth as number,
      mfgYear: b.mfgYear as number,
    });
  }
  if (new Set(batchNos).size !== batchNos.length) {
    return NextResponse.json(
      { error: "Two batches share a batchNo — each must be distinct on the line." },
      { status: 400 },
    );
  }

  // ── The domain rules — CALLED, never restated ──────────────────────────────
  const batchCheck = validateBatches(physicalQty, batches);
  if (!batchCheck.ok) {
    return NextResponse.json(
      {
        error: batchCheck.message,
        problem: batchCheck.problem,
        expected: batchCheck.expected,
        actual: batchCheck.actual,
      },
      { status: 400 },
    );
  }

  // null = the issue toggle was never opened, which is the clean path, not a
  // validation failure.
  const countCheck = validateConditionCounts(physicalQty, counts);
  if (countCheck && !countCheck.ok) {
    return NextResponse.json(
      {
        error: countCheck.message,
        problem: countCheck.problem,
        expected: countCheck.expected,
        actual: countCheck.actual,
      },
      { status: 400 },
    );
  }

  // ── State guards ───────────────────────────────────────────────────────────
  const mrn = await prisma.mrn.findFirst({
    where: { id: mrnId, isRemoved: false },
    select: { status: true },
  });
  if (!mrn) {
    return NextResponse.json({ error: "MRN not found" }, { status: 404 });
  }
  if (mrn.status !== "checking") {
    return NextResponse.json(
      {
        error:
          mrn.status === "open"
            ? "Tap Start unloading before confirming lines."
            : "This MRN is finished — its lines can no longer be changed.",
      },
      { status: 409 },
    );
  }

  // The line must belong to THIS MRN. A mismatch is a 404, never a silent write
  // to another truck's line — the two ids are adjacent integers and a client bug
  // that crossed them would be invisible in the response.
  const line = await prisma.mrn_lines.findFirst({
    where: { id: lineId, mrnId },
    select: { id: true },
  });
  if (!line) {
    return NextResponse.json({ error: "Line not found on this MRN" }, { status: 404 });
  }

  // ── (1) Clear the existing batches ─────────────────────────────────────────
  await prisma.mrn_line_batches.deleteMany({ where: { lineId } });

  // ── (2) Write the new ones ─────────────────────────────────────────────────
  // Skipped entirely when there are none — createMany([]) is a pointless round
  // trip, and zero batches is the CORRECT state for a line received at zero
  // (OQ-4), not an omission.
  if (batches.length > 0) {
    await prisma.mrn_line_batches.createMany({
      data: batches.map((b, i) => ({ lineId, batchNo: batchNos[i], ...b })),
    });
  }

  // ── (3) The line itself. isChecked LAST — see the header. ──────────────────
  await prisma.mrn_lines.update({
    where: { id: lineId },
    data: {
      physicalQty,
      ...counts,
      isChecked: true,
      checkedAt: new Date(),
      checkedById,
    },
  });

  // ── (4) MARKER PROPAGATION — a DELIBERATE second write ─────────────────────
  //
  // 🔴 This is the one place in MRN where a second write per action is correct,
  // and it is here because of a real gap, not for symmetry.
  //
  // /api/mrn/marker aggregates MAX(mrn.updatedAt) over the `mrn` table. Steps
  // (1)-(3) touch mrn_lines and mrn_line_batches ONLY — they never touch `mrn`,
  // so without this the "12 of 18 checked" progress on another supervisor's
  // Checking card would sit frozen from Start all the way to End. That is
  // precisely the standing CLAUDE_PICKING.md §10 landmine — "any future
  // assignment-only write silently escapes the marker and reaches no screen" —
  // arriving in a new module, and §10's own prescribed fix is this one: bump
  // the parent's updatedAt alongside the child write.
  //
  // ⚠ NOT A LICENCE TO ADD MORE. §10's other half — "never add a SECOND
  // orders.update to a trigger" — is the mirror rule: an extra write where the
  // change is ALREADY carried fires a FALSE 'changed' on every polling phone.
  // Start and End both write `mrn` themselves, so neither may add a bump. The
  // test is whether anything else already carries the change, not whether one
  // more write would be harmless.
  //
  // `updatedAt` is set EXPLICITLY rather than leaning on an empty `data: {}`
  // reaching the SET clause. It is a settable field in Prisma 5.22's generated
  // mrnUpdateInput (`updatedAt?: DateTimeFieldUpdateOperationsInput | Date |
  // string`), so this is deterministic and readable in the code — no dependence
  // on what @updatedAt does with an otherwise-empty update.
  //
  // Best-effort: the confirm ALREADY SUCCEEDED at (3), so a failure here must
  // not report failure to the supervisor and send him to redo a write that
  // landed. The cost of losing it is bounded — the next line confirm, or End
  // unloading, moves mrn.updatedAt anyway.
  try {
    await prisma.mrn.update({
      where: { id: mrnId },
      data: { updatedAt: new Date() },
    });
  } catch (err) {
    console.error(`[mrn/line] marker bump failed for mrn #${mrnId} (non-fatal):`, err);
  }

  return NextResponse.json({ ok: true, lineId, physicalQty, batchCount: batches.length });
}
