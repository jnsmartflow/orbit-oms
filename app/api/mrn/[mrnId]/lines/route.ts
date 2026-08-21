import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { parsePastedLines } from "@/lib/mrn/paste";
import { applyCatalog, resolveMrnSkus } from "@/lib/mrn/resolve-lines";

export const dynamic = "force-dynamic";

/**
 * PUT /api/mrn/[mrnId]/lines — REPLACES every line on the MRN from a pasted
 * block.
 *
 * Body: { block: string } — the raw paste out of the STI sheet.
 *
 * 🔴 409 UNLESS status === 'open'. Same lock as the header route: Start
 * unloading is what locks billing out (design §5).
 *
 * ── ORDER OF OPERATIONS, AND WHY IT IS THIS ORDER ───────────────────────────
 *
 *   1. PARSE (lib/mrn/paste.ts) and RESOLVE (lib/mrn/resolve-lines.ts).
 *      NO WRITES YET. Both are pure/read-only, so a malformed paste 400s having
 *      changed NOTHING — the MRN still holds the lines it held before. This is
 *      the whole reason parsing comes first: validate everything that can be
 *      validated while the cost of failing is still zero.
 *   2. deleteMany the existing lines. mrn_line_batches cascades on lineId, so
 *      the batches go with them — nothing is orphaned.
 *   3. createMany the new lines.
 *
 * ⚠ THERE IS NO TRANSACTION, AND A FAILURE BETWEEN (2) AND (3) LEAVES THE MRN
 * WITH ZERO LINES. That is stated plainly rather than papered over. It is the
 * right trade: prisma.$transaction is banned (Vercel serverless + the Supabase
 * pooler time out on it — CORE §3), and the damage is fully recoverable —
 * billing pastes the same block again and is back where it was. The error
 * response below SAYS SO, in those words. It must never read as a generic
 * failure, because an operator who thinks the save merely "didn't work" will
 * not know the lines are now gone.
 *
 * Replacing rather than diffing is deliberate: the paste IS the source of
 * truth, and a diff would have to guess which of two similar lines the operator
 * meant to change.
 *
 * ⚠ UNMATCHED SKU CODES ARE STORED AS-IS AND NEVER REJECT A PASTE. Roughly 27%
 * of distinct active SAP codes resolve in neither catalog table (CORE §7.1.c);
 * the screens render "Not in catalog" against the bare code with the line still
 * fully checkable. The resolve in (1) exists only to report the count back to
 * the preview — nothing about it can fail a save.
 */
export async function PUT(
  req: Request,
  { params }: { params: { mrnId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 🔴 canEdit, NOT canView — see app/api/mrn/create/route.ts.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mrn", "canEdit");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Identical path-segment validation to app/api/mrn/[mrnId]/route.ts.
  const raw = params.mrnId?.trim() ?? "";
  const mrnId = Number(raw);
  if (!/^\d+$/.test(raw) || mrnId <= 0 || mrnId > 2147483647) {
    return NextResponse.json(
      { error: `Invalid mrnId "${params.mrnId}" — expected a positive integer` },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { block?: unknown };
  if (typeof body.block !== "string" || body.block.trim() === "") {
    return NextResponse.json(
      { error: "`block` is required — paste the lines from the STI sheet" },
      { status: 400 },
    );
  }

  const existing = await prisma.mrn.findFirst({
    where: { id: mrnId, isRemoved: false },
    select: { status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "MRN not found" }, { status: 404 });
  }
  if (existing.status !== "open") {
    return NextResponse.json(
      {
        error:
          existing.status === "checking"
            ? "The supervisor is checking this truck — the lines are locked."
            : "This MRN is done — the lines can no longer be replaced.",
      },
      { status: 409 },
    );
  }

  // ── 1. Parse. Nothing written yet. ─────────────────────────────────────────
  // parsePastedLines NEVER throws — every problem comes back as a per-row error
  // so the preview can render "34 matched, 2 could not be read" beside the rows
  // that did parse.
  const parsed = parsePastedLines(body.block);

  // Any unreadable row fails the WHOLE paste, and that is the safe direction on
  // a REPLACE: silently dropping 2 rows of 36 would delete two real lines the
  // operator believes they just saved. Nothing has been written at this point,
  // so the MRN keeps the lines it already had. (An unmatched SKU is NOT a
  // parse error — see the header note; it never reaches here.)
  if (parsed.errors.length > 0) {
    return NextResponse.json(
      {
        error: `${parsed.errors.length} row${parsed.errors.length === 1 ? "" : "s"} could not be read. Nothing was changed — fix ${parsed.errors.length === 1 ? "it" : "them"} and paste again.`,
        errors: parsed.errors,
        parsedCount: parsed.rows.length,
      },
      { status: 400 },
    );
  }
  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { error: "No lines found in that paste. Nothing was changed." },
      { status: 400 },
    );
  }

  // Resolve for the REPORT ONLY — one batched query, keyed on
  // sku_master_v2.material, never an id (lib/mrn/resolve-lines.ts owns that
  // rule and carries the id-space warning). Cannot fail the save.
  const catalog = await resolveMrnSkus(parsed.rows.map((r) => r.skuCode));
  const unmatchedCodes = Array.from(
    new Set(
      parsed.rows
        .filter((r) => !applyCatalog(r.skuCode, catalog).isCatalogued)
        .map((r) => r.skuCode),
    ),
  );

  // ── 2. Clear. Batches cascade on lineId. ───────────────────────────────────
  // Sequential awaits, never prisma.$transaction (CORE §3).
  await prisma.mrn_lines.deleteMany({ where: { mrnId } });

  // ── 3. Write the new lines. ────────────────────────────────────────────────
  // From here until this resolves, the MRN has ZERO lines. See the header.
  try {
    await prisma.mrn_lines.createMany({
      data: parsed.rows.map((r) => ({
        mrnId,
        lineNo: r.lineNo,
        skuCode: r.skuCode,
        qtySti: r.qtySti,
        // Everything else stays at its column default: cartonQty and
        // physicalQty NULL, isChecked false, all six condition counts NULL.
        // The supervisor fills them (step 6); billing never pre-fills them.
      })),
    });
  } catch (err) {
    // ⚠ THE LINES ARE GONE. Say it in the operator's words — this must not read
    // as "the save didn't work", which would leave them believing the old lines
    // survived.
    console.error(`[mrn/lines] createMany failed for mrn #${mrnId} after deleteMany:`, err);
    return NextResponse.json(
      {
        error:
          "The previous lines were cleared but the new ones could not be saved, so this MRN now has no lines. Nothing was kept — paste the block again.",
        linesCleared: true,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    lineCount: parsed.rows.length,
    // Surfaced so the preview can explain a surprising parse without a second
    // round trip.
    numbering: parsed.numbering,
    delimiter: parsed.delimiter,
    headerSkipped: parsed.headerSkipped,
    // Informational only — these lines ARE saved.
    unmatchedCount: unmatchedCodes.length,
    unmatchedCodes,
  });
}
