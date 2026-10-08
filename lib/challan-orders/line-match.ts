// lib/challan-orders/line-match.ts
//
// THE LINE MATCH — challan lines vs SAP lines, computed LIVE, never stored (Challan
// orders slice 7, 2026-10-08 — design D12, F2, F5, M6; plan
// docs/prompts/drafts/code-plan-2026-10-08-challan-slice7.md §1–§2). READ-ONLY.
// Caller: lib/challan-orders/board.ts (loadChallanBoard's Billed rows, loadChallanHistory's
// billed rows on the page).
//
//   Challan side — the ORB order's own raw lines (import_raw_line_items.obdNumber = the
//                  ORB number; create.ts writes one per cart pack, unitQty = tins).
//   SAP side     — the raw lines of EVERY bill billed against it: orders.challanOrderId =
//                  the ORB AND workflowStage 'challan_linked'. A linked OBD cancelled by admin
//                  (S6-3) is 'cancelled' and drops out with no write; several OBDs per SO and
//                  several SOs per ORB (F5) are simply summed.
//   Both sides   — lineStatus 'active' only (a removed_by_import line is not on the bill);
//                  rowStatus NOT filtered (a parse-rejected row is still a tin —
//                  lib/floor/queries.ts). unitQty is SAP's DELIVERY quantity in units (CI §6,
//                  CI-14). Tins are SUMMED per material, NEVER de-duplicated by lineId: the same
//                  material on two lines (batch splits) is real goods twice.
//
// 🔴 MATCHED ON THE MATERIAL CODE TEXT (skuCodeRaw) — NO CATALOG JOIN, NO ID. sku_master and
// sku_master_v2 assign completely different ids to the same material (CLAUDE_CORE.md §13,
// the id-space landmine). The description is already on each line, so nothing here reads a
// catalog table at all. A wrong pick on a double-mapped Place Order cell, or an alternate SAP
// code for the same goods, shows as ⚠ — intended (F2; owner 8 Oct).
//
// ONE query per call — never per row. Sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";
import { CHALLAN_LINKED } from "@/lib/workflow-stages";
import type { ChallanLineMatch, ChallanMatchLine, ChallanRow } from "./board-types";

export interface MatchSourceLine {
  lineId: number;
  skuCodeRaw: string;
  skuDescriptionRaw: string | null;
  unitQty: number;
}

/**
 * Pure. Challan lines vs the SAP lines of every live linked OBD. ✅ iff every material's
 * tins are equal; a material with 0 on both sides is dropped and never a difference.
 * Rows: challan line order first, then SAP-only materials in their order.
 */
export function computeLineMatch(
  challanLines: MatchSourceLine[],
  sapLines: MatchSourceLine[],
  obdNumbers: string[],
): ChallanLineMatch {
  const byMaterial = new Map<string, ChallanMatchLine>();
  const take = (l: MatchSourceLine, side: "challanTins" | "sapTins") => {
    let m = byMaterial.get(l.skuCodeRaw);
    if (!m) {
      m = { material: l.skuCodeRaw, product: l.skuDescriptionRaw ?? "", challanTins: 0, sapTins: 0, diff: 0 };
      byMaterial.set(l.skuCodeRaw, m);
    }
    if (!m.product && l.skuDescriptionRaw) m.product = l.skuDescriptionRaw;
    m[side] += l.unitQty;
  };
  for (const l of [...challanLines].sort((a, b) => a.lineId - b.lineId)) take(l, "challanTins");
  for (const l of [...sapLines].sort((a, b) => a.lineId - b.lineId)) take(l, "sapTins");

  const lines = Array.from(byMaterial.values())
    .filter((m) => m.challanTins !== 0 || m.sapTins !== 0)
    .map((m) => ({ ...m, diff: m.sapTins - m.challanTins }));
  const differing = lines.filter((m) => m.diff !== 0).length;
  return {
    ok: differing === 0,
    differing,
    challanTins: lines.reduce((s, m) => s + m.challanTins, 0),
    sapTins: lines.reduce((s, m) => s + m.sapTins, 0),
    obdNumbers,
    lines,
  };
}

/**
 * Set `match` on every BILLED row given (plan §2: waiting / part-billed / cancelled rows
 * keep null — no chip). One import_raw_line_items read for all of them.
 */
export async function attachLineMatches(rows: ChallanRow[]): Promise<void> {
  const targets = rows
    .filter((r) => r.status === "billed")
    .map((r) => ({ row: r, obds: r.linkedObds.filter((b) => b.workflowStage === CHALLAN_LINKED).map((b) => b.obdNumber) }))
    // A billed row always has a live linked bill; none = inconsistent data → no chip.
    .filter((t) => t.obds.length > 0);
  if (targets.length === 0) return;

  const numbers = Array.from(new Set(targets.flatMap((t) => [t.row.orbNumber, ...t.obds])));
  const raw = await prisma.import_raw_line_items.findMany({
    where: { obdNumber: { in: numbers }, lineStatus: "active" },
    select: { obdNumber: true, lineId: true, skuCodeRaw: true, skuDescriptionRaw: true, unitQty: true },
  });
  const byObd = new Map<string, MatchSourceLine[]>();
  for (const l of raw) {
    const list = byObd.get(l.obdNumber) ?? [];
    list.push(l);
    byObd.set(l.obdNumber, list);
  }
  for (const t of targets) {
    t.row.match = computeLineMatch(
      byObd.get(t.row.orbNumber) ?? [],
      t.obds.flatMap((o) => byObd.get(o) ?? []),
      t.obds,
    );
  }
}
