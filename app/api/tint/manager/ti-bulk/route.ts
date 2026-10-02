import { NextResponse } from "next/server";
import { PackCode } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkTintAction } from "@/lib/tint/manager-bill";
import { getBaseOperatorId } from "@/lib/tint/base-operator";
import { TINT_STATUS_DONE } from "@/lib/tint/assignment-status";
import { derivePackCode } from "@/lib/sampling/pack-code";
import { WHITE_SHOT_PIGMENT, whiteShotFor } from "@/lib/tint/white-shots";
import {
  ACOTONE_PIGMENT_CODES,
  TINTER_PIGMENT_CODES,
  owedLinesForAssignment,
  saveTinterIssue,
} from "@/lib/tint/ti-save";

export const dynamic = "force-dynamic";

/**
 * POST /api/tint/manager/ti-bulk — bulk WHITE-SHOT Tinter Issue on "Base — No
 * Tint" bills (2026-10-02, docs/prompts/drafts/code-discovery-2026-10-02-
 * bulk-tinter-issue.md §G, §I).
 *
 * Body:     { tintAssignmentIds: number[], dose: 5 | 20 | 25 }
 * Response: { done: [{ orderId, lines }], failed: [{ orderId, rawLineItemId?, error }],
 *             skipped: [{ orderId, rawLineItemId?, reason }], closed: orderId[] }
 *           422 only when nothing landed and something failed.
 *
 * Gate: tint_manager canEdit AND tint_ti_bulk canEdit (§I-3), PLUS the
 * manager-only TI arm of app/api/tint/operator/tinter-issue: every assignment
 * must be placeholder-owned (lib/tint/base-operator.ts), `tinting_done`, a
 * whole-OBD job (no split), on an order that is not removed. Never
 * canSeeAllOperatorRows (CLAUDE_TINT §13.4).
 *
 * The shot (lib/tint/white-shots.ts — the only place the numbers live):
 *   - FIXED dose, NEVER scaled (§I-2): every line gets WHT = dose, all other
 *     pigments 0, whatever its pack. A missing (sku, pack) variant is created
 *     under the SAME number with those same values (Scenario 2).
 *   - SAFETY: before ANY write, the sampling must exist, be active, be TINTER,
 *     and every recipe variant must be WHT-only with WHT = dose. Anything else
 *     → 400 for the whole request; a different formula is never written.
 *   - shadeName = the register's OWN name, so Scenario 3 never renames it.
 *
 * Per bill sequentially, per owed line sequentially (CORE §3 — no $transaction);
 * each line is ONE call of lib/tint/ti-save.ts saveTinterIssue with one entry —
 * the same save the single-line panel uses (TI row, tiSubmitted, challan sync,
 * and the bill's usage log on its last line, §I-5). A line that already has a
 * TI row on the assignment is skipped "already recorded" (§I-4); a line whose
 * pack cannot be derived fails. A bill leaves the TI tab only when every line
 * is covered (§I-7) — those are returned in `closed`.
 */

interface Done    { orderId: number; lines: number }
interface Failed  { orderId: number; rawLineItemId?: number; error: string }
interface Skipped { orderId: number; rawLineItemId?: number; reason: string }

const ALL_PIGMENTS: readonly string[] = [...TINTER_PIGMENT_CODES, ...ACOTONE_PIGMENT_CODES];

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const refused = await checkTintAction(roles, "ti-bulk");
  if (refused !== null) return NextResponse.json({ error: refused }, { status: 403 });

  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { tintAssignmentIds?: unknown; dose?: unknown };
  const rawIds = body.tintAssignmentIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0 || !rawIds.every((id) => typeof id === "number" && Number.isInteger(id) && id > 0)) {
    return NextResponse.json({ error: "tintAssignmentIds is required and must be a non-empty array of positive integers" }, { status: 400 });
  }
  const assignmentIds = Array.from(new Set(rawIds as number[]));
  const shot = whiteShotFor(body.dose);
  if (shot === null) {
    return NextResponse.json({ error: "dose must be 5, 20 or 25" }, { status: 400 });
  }

  // ── Safety: the fixed number must be exactly this white shot (§I-2) ────────
  const register = await prisma.sampling_register.findUnique({
    where:  { samplingNo: shot.samplingNo },
    select: { shadeName: true, tinterType: true, isActive: true },
  });
  const recipes = register
    ? await prisma.sampling_recipes.findMany({ where: { samplingNo: shot.samplingNo } })
    : [];
  const recipeOk = recipes.length > 0 && recipes.every((r) => {
    const rec = r as unknown as Record<string, unknown>;
    return ALL_PIGMENTS.every((code) =>
      code === WHITE_SHOT_PIGMENT ? Number(rec[code] ?? 0) === shot.dose : Number(rec[code] ?? 0) === 0,
    );
  });
  if (!register || !register.isActive || register.tinterType !== "TINTER" || !recipeOk) {
    return NextResponse.json(
      { error: `Sampling ${shot.samplingNo} is not an active TINTER WHT ${shot.dose} white shot — nothing was written` },
      { status: 400 },
    );
  }

  const baseOperatorId = await getBaseOperatorId();
  if (baseOperatorId === null) {
    return NextResponse.json({ error: "The Base — No Tint placeholder is missing — nothing was written" }, { status: 500 });
  }

  // WHT = dose, every other TINTER pigment 0 — the same values on every line.
  const pigments: Record<string, number> = {};
  for (const code of TINTER_PIGMENT_CODES) pigments[code] = code === WHITE_SHOT_PIGMENT ? shot.dose : 0;

  const done: Done[] = [];
  const failed: Failed[] = [];
  const skipped: Skipped[] = [];
  const closed: number[] = [];

  for (const tintAssignmentId of assignmentIds) {
    let orderId = 0;
    try {
      // The manager-only TI arm, verbatim in meaning (tinter-issue/route.ts):
      // placeholder-owned, tinting_done, whole-OBD, order not removed.
      const assignment = await prisma.tint_assignments.findFirst({
        where: {
          id:           tintAssignmentId,
          assignedToId: baseOperatorId,
          status:       TINT_STATUS_DONE,
          splitId:      null,
          order:        { isRemoved: false },
        },
        select: { orderId: true, order: { select: { obdNumber: true } } },
      });
      if (!assignment) {
        failed.push({ orderId: 0, error: `Assignment ${tintAssignmentId} is not a Base — No Tint bill that owes TI` });
        continue;
      }
      orderId = assignment.orderId;
      const obdNumber = assignment.order.obdNumber;

      const { lines, covered } = await owedLinesForAssignment(tintAssignmentId, obdNumber);
      let wrote = 0;
      for (const line of lines) {
        if (covered.has(line.id)) {
          skipped.push({ orderId, rawLineItemId: line.id, reason: "already recorded" });
          continue;
        }
        const pack = derivePackCode(line.volumeLine, line.unitQty);
        if (pack === null || !(pack in PackCode)) {
          failed.push({ orderId, rawLineItemId: line.id, error: `${line.skuCodeRaw}: pack size can't be derived — use + New shade` });
          continue;
        }
        const saved = await saveTinterIssue({
          tinterType:       "TINTER",
          orderId,
          splitId:          null,
          tintAssignmentId,
          userId,
          logTag:           "ti-bulk",
          entries: [{
            baseSku:       line.skuCodeRaw,
            packCode:      pack as PackCode,
            tinQty:        line.unitQty,
            rawLineItemId: line.id,
            samplingNo:    shot.samplingNo,
            shadeName:     register.shadeName,
            pigments,
          }],
        });
        if (!saved.ok) failed.push({ orderId, rawLineItemId: line.id, error: saved.error });
        else wrote++;
      }
      if (wrote > 0) done.push({ orderId, lines: wrote });

      // Off the TI tab only when EVERY line is covered now (§I-7).
      const after = await owedLinesForAssignment(tintAssignmentId, obdNumber);
      if (after.lines.length > 0 && after.lines.every((l) => after.covered.has(l.id))) closed.push(orderId);
    } catch (err) {
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  const status = done.length === 0 && failed.length > 0 ? 422 : 200;
  return NextResponse.json({ done, failed, skipped, closed }, { status });
}
