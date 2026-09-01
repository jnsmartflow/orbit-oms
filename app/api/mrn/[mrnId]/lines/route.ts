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

  // TWO INPUT SHAPES, ONE JOB (2026-08-22, step 8b).
  //
  //   { block }  — the raw paste. The SERVER parses it, so paste.ts stays the
  //                single parsing authority and a client that parsed
  //                differently cannot write a different answer.
  //   { lines }  — an already-structured set, for the board's row-delete on the
  //                open table: it sends the lines that REMAIN.
  //
  // ⚠ NEITHER SHAPE CARRIES cartonQty. It was briefly a typed field on the
  // `lines` path (2026-08-22, same day) and is now DERIVED from the catalog for
  // both shapes further down — so the two paths cannot drift, and a client
  // cannot write a carton count at all.
  //
  // Both paths converge on the SAME delete-then-create sequence below, so the
  // ordering guarantee and the linesCleared contract are identical either way.
  const body = (await req.json().catch(() => ({}))) as { block?: unknown; lines?: unknown };

  const hasBlock = typeof body.block === "string" && body.block.trim() !== "";
  const hasLines = Array.isArray(body.lines);
  if (!hasBlock && !hasLines) {
    return NextResponse.json(
      { error: "`block` is required — paste the lines from the STI sheet" },
      { status: 400 },
    );
  }
  if (hasBlock && hasLines) {
    return NextResponse.json(
      { error: "Send `block` or `lines`, never both — they are two ways to say the same thing." },
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
            : "This MRN is finished — the lines can no longer be replaced.",
      },
      { status: 409 },
    );
  }

  // ── 1. Resolve the input to rows. Nothing written yet, on either path. ─────

  /** What both shapes normalise to before anything is written. */
  interface IncomingLine {
    lineNo: number;
    skuCode: string;
    qtySti: number;
    cartonQty: number | null;
  }
  let incoming: IncomingLine[];
  /** Only a PASTE has these — how the block was read. Null on the `lines` path,
   *  where there was no parse to explain. */
  let pasteMeta: { numbering: string; delimiter: string; headerSkipped: boolean } | null = null;

  if (hasLines) {
    const raw = body.lines as unknown[];
    const out: IncomingLine[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const l = raw[i] as Record<string, unknown>;
      if (typeof l !== "object" || l === null) {
        return NextResponse.json({ error: `Line ${i + 1} is not an object` }, { status: 400 });
      }
      if (typeof l.lineNo !== "number" || !Number.isInteger(l.lineNo) || l.lineNo <= 0) {
        return NextResponse.json(
          { error: `Line ${i + 1} needs a whole lineNo of 1 or more` },
          { status: 400 },
        );
      }
      const skuCode = typeof l.skuCode === "string" ? l.skuCode.trim().toUpperCase() : "";
      if (skuCode === "") {
        return NextResponse.json({ error: `Line ${i + 1} needs a SKU code` }, { status: 400 });
      }
      if (typeof l.qtySti !== "number" || !Number.isInteger(l.qtySti) || l.qtySti < 0) {
        return NextResponse.json(
          { error: `Line ${i + 1} needs a whole quantity of 0 or more` },
          { status: 400 },
        );
      }
      // ⚠ cartonQty is NOT read from the body on this path either. It is
      // DERIVED below from the catalog on both shapes, so a client cannot set
      // it and the paste path and the save path cannot drift apart. Any
      // cartonQty sent here is ignored rather than rejected — it is not the
      // caller's field to send.
      out.push({ lineNo: l.lineNo, skuCode, qtySti: l.qtySti, cartonQty: null });
    }

    // UNIQUE(mrnId, lineNo) would otherwise surface as a raw P2002 out of
    // createMany — the same guard parsePastedLines applies to pasted Sr numbers.
    const nos = out.map((l) => l.lineNo);
    if (new Set(nos).size !== nos.length) {
      return NextResponse.json(
        { error: "Two lines share a line number — each must be distinct." },
        { status: 400 },
      );
    }
    if (out.length === 0) {
      return NextResponse.json(
        { error: "An MRN cannot be saved with no lines. Delete the MRN instead, or paste a new block." },
        { status: 400 },
      );
    }
    incoming = out;
  } else {
    // parsePastedLines NEVER throws — every problem comes back as a per-row
    // error so the preview can render "34 matched, 2 could not be read" beside
    // the rows that did parse.
    const parsed = parsePastedLines(body.block as string);

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

    // A pasted block carries no carton qty — the STI columns are Sr · SKU ·
    // Qty. Every line therefore starts NULL there, and billing types it after,
    // which is what the `lines` shape above exists to save.
    incoming = parsed.rows.map((r) => ({
      lineNo: r.lineNo,
      skuCode: r.skuCode,
      qtySti: r.qtySti,
      cartonQty: null,
    }));
    pasteMeta = {
      numbering: parsed.numbering,
      delimiter: parsed.delimiter,
      headerSkipped: parsed.headerSkipped,
    };
  }

  // One batched query, keyed on sku_master_v2.material, never an id
  // (lib/mrn/resolve-lines.ts owns that rule and carries the id-space warning).
  // Cannot fail the save.
  const catalog = await resolveMrnSkus(incoming.map((r) => r.skuCode));
  const unmatchedCodes = Array.from(
    new Set(
      incoming
        .filter((r) => !applyCatalog(r.skuCode, catalog).isCatalogued)
        .map((r) => r.skuCode),
    ),
  );

  // ── Carton qty — DERIVED, NEVER TYPED (2026-08-22) ─────────────────────────
  //
  // Billing types nothing into this column. It exists as a REFERENCE FIGURE for
  // the supervisor on the floor, and it is computed here from the catalog:
  //
  //     pack is 4L AND piecesPerCarton > 0  →  floor(qtySti / piecesPerCarton)
  //     anything else                        →  null
  //
  // 🔴 4L PACKS ONLY — owner's ruling. Larger packs arrive loose and carry no
  // carton count on the paper sheet, so a computed number there would be an
  // invention. Do NOT relax this to "whatever has a piecesPerCarton": the
  // catalog gives 1L SKUs a piecesPerCarton too, and using it would print
  // carton counts the depot has never recorded.
  //
  // ⚠ HOW "IS 4L" IS TESTED, AND WHY IT IS NOT `packCode === "4"`. packCode is
  // TEXT and `unit` is a SEPARATE column, so packCode "4" is 4L with unit L but
  // 4KG with unit KG and "1 pc" with unit PC (lib/place-order/pack.ts). The
  // test therefore runs against the FORMATTED pack string that resolveMrnSkus
  // already returns — the same formatPack() every other surface renders — which
  // makes the KG/GM/PC exclusions automatic and keeps one owner for the rule.
  //
  // ⚠ SNAPSHOT, NOT A RENDER-TIME DERIVATION. It is written to
  // mrn_lines.cartonQty at paste, so the report keeps what was true when the
  // truck arrived even if the catalog is edited later. A truck received in
  // August must not silently restate itself because a SKU's piecesPerCarton
  // changed in November.
  const cartonFor = async (): Promise<Map<string, number>> => {
    const codes = Array.from(new Set(incoming.map((r) => r.skuCode)));
    const rows = await prisma.sku_master_v2.findMany({
      where: { material: { in: codes } },
      select: { material: true, piecesPerCarton: true },
    });
    const out = new Map<string, number>();
    for (const r of rows) {
      if (typeof r.piecesPerCarton === "number" && r.piecesPerCarton > 0) {
        if (!out.has(r.material)) out.set(r.material, r.piecesPerCarton);
      }
    }
    return out;
  };
  const piecesPerCarton = await cartonFor();

  const withCarton = incoming.map((r) => {
    const entry = catalog.get(r.skuCode);
    const ppc = piecesPerCarton.get(r.skuCode);
    const is4L = entry?.pack === "4L";
    return {
      ...r,
      cartonQty: is4L && ppc ? Math.floor(r.qtySti / ppc) : null,
    };
  });

  // ── 2. Clear. Batches cascade on lineId. ───────────────────────────────────
  // Sequential awaits, never prisma.$transaction (CORE §3).
  await prisma.mrn_lines.deleteMany({ where: { mrnId } });

  // ── 3. Write the new lines. ────────────────────────────────────────────────
  // From here until this resolves, the MRN has ZERO lines. See the header.
  try {
    await prisma.mrn_lines.createMany({
      data: withCarton.map((r) => ({
        mrnId,
        lineNo: r.lineNo,
        skuCode: r.skuCode,
        qtySti: r.qtySti,
        // DERIVED above, on BOTH input shapes, so the two paths agree — see the
        // carton block. Never taken from the request body.
        cartonQty: r.cartonQty,
        // Everything else stays at its column default: physicalQty NULL,
        // isChecked false, all six condition counts NULL. The supervisor fills
        // those (step 6); billing never pre-fills them.
        //
        // ⚠ A REPLACE IS A REPLACE. Saving here discards any supervisor data on
        // the old rows — which is safe ONLY because this route 409s on
        // status !== 'open', so by definition nothing has been checked yet.
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
    lineCount: incoming.length,
    // Surfaced so the preview can explain a surprising parse without a second
    // round trip. Null on the `lines` path — nothing was parsed there.
    numbering: pasteMeta?.numbering ?? null,
    delimiter: pasteMeta?.delimiter ?? null,
    headerSkipped: pasteMeta?.headerSkipped ?? false,
    // Informational only — these lines ARE saved.
    unmatchedCount: unmatchedCodes.length,
    unmatchedCodes,
  });
}
