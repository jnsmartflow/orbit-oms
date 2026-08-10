import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { resolveCatalogByCode } from "@/lib/picking/resolve-lines";
import { groupPickingDetailLines } from "@/lib/picking/group-lines";
import type { PickingLineFinding } from "@/lib/picking/types";

export const dynamic = "force-dynamic";

/**
 * Read-only line items for the mobile picking board's detail screen.
 * PickingQueueRow carries only order-level aggregates (articleTag,
 * volumeLitres, weightKg from `orders.querySnapshot`) — never individual
 * lines, so this is a rare, on-demand tap-through, not part of the main
 * queue payload.
 *
 * There is no FK from `orders` to its line items — `import_raw_line_items`
 * only carries a plain `obdNumber` string, matched here via the order's own
 * unique `obdNumber`. Reads the FULL active line set (not just the subset the
 * catalog can resolve) so a line whose SAP code isn't mastered still shows up
 * — with its raw SAP description — rather than silently vanishing from what
 * the picker sees on the bill.
 *
 * Product name + pack resolve against sku_master_v2 by `material` (2026-07-19b
 * repoint, Option B); ~73% of active raw SAP codes resolve, the rest fall back
 * to raw text. Do NOT reintroduce the enrichedLineItem.sku relation here — see
 * the comment at the catalog lookup below.
 *
 * 2026-08-07 — each line now also carries `finding`: the pick_findings row for
 * that raw line, or null. ADDITIVE ONLY: every pre-existing field on `lines` is
 * untouched, so the supervisor board (which reads the same endpoint and does not
 * know about findings) is unaffected.
 *
 * 2026-08-10 — SPLIT-SKU MERGE. SAP routinely emits one line PER BATCH/LOT for a
 * single ordered quantity, so the same SKU arrives as several `active` rows that
 * are identical in every product-identifying field. Live measurement on that
 * date: 1,225 duplicate groups across 963 OBDs (2,630 of 33,500 active lines);
 * `skuDescriptionRaw` and `isTinting` differed in ZERO of them, and 62% did not
 * even differ on `batchCode`. Worst case OBD 9108587550 printed the SAME tin
 * eight times (IN60000676, one line per batch, qty 3+4+1+4+4+4+4+8 = 32). This
 * route now groups them into one row per (skuCodeRaw, resolved pack) and sums
 * the quantities.
 *
 * ⚠ MERGED ON THE SAP CODE, never on description text — the same natural-key
 * rule CombinedSkuRow already follows for its cross-bill merge
 * (lib/picking/types.ts). Pack is included in the key as belt-and-braces only:
 * it resolves FROM the code (sku_master_v2.material is @unique), so it can never
 * split a group on its own.
 *
 * The DISPLAY layer is the only thing merged. Nothing here writes, and every row
 * still carries its underlying `import_raw_line_items.id`s in `lineIds`, so the
 * tables that reference raw line ids directly — pick_findings,
 * delivery_challan_formulas, tinter_issue_entries — are untouched and unaware.
 * app/api/billing/picking/order/[orderId]/route.ts mirrors this route but is
 * deliberately NOT merged: out of scope, still one row per raw line.
 */
export async function GET(
  _req: Request,
  { params }: { params: { orderId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same gate as the other picking routes (queue/assign/unassign) — admin
  // bypass, else canView on 'picking'.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "picking", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const orderId = Number(params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  }

  // Sequential awaits only (CORE §3) — no prisma.$transaction, both reads.
  // Soft-delete read: never surface a removed order's lines.
  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    select: { obdNumber: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const rawLines = await prisma.import_raw_line_items.findMany({
    where: { obdNumber: order.obdNumber, lineStatus: "active" },
    select: {
      id: true,
      skuCodeRaw: true,
      skuDescriptionRaw: true,
      unitQty: true,
      // Added 2026-08-10 for the split-SKU merge — the three measures that must
      // be SUMMED across a group rather than taken from one line, plus the tag
      // that must NOT be (see the merge below).
      volumeLine: true,
      netWeight: true,
      totalWeight: true,
      articleTag: true,
    },
    orderBy: { lineId: "asc" },
  });

  // Catalog resolution goes through sku_master_v2 keyed on `material` (the SAP
  // code), NOT through the enrichedLineItem.sku relation — the FK rides
  // `skuId`, which shares no id space with v2 and would render a confidently
  // WRONG name/pack on a live picking bill.
  //
  // Moved into lib/picking/resolve-lines.ts on 2026-08-07 (extraction, not a
  // behaviour change: same query, same select, same de-dup, same fallbacks) so
  // the Combined view can resolve MANY bills' codes through the identical
  // path. ⚠️ THE FULL WARNING AND ITS REASONING NOW LIVE IN THAT FILE — read it
  // there before touching this lookup.
  //
  // Sequential await, no $transaction (CORE §3).
  const catalogByCode = await resolveCatalogByCode(rawLines.map((l) => l.skuCodeRaw));

  // `pack` is the code ONLY ("1L", "500ML") — no container word. The picker
  // matches pack size against the shelf/box, not the container type.
  // Unresolved codes fall back to the raw SAP text exactly as before; a blank
  // pack stays blank rather than guessing (CLAUDE_PICKING.md §7 — a blank is a
  // mis-pick preventer, a wrong value is not).
  // ── Findings (2026-08-07) — has anyone recorded a shortage on these lines? ──
  // ONE extra query, keyed on rawLineItemId (UNIQUE on pick_findings, so this is
  // at most one row per line). Read-only; this route writes nothing.
  //
  // The pair that matters downstream is reportedAt vs recordedAt:
  //   reportedById set, recordedById NULL → the picker recorded it, awaiting a
  //                                          supervisor's confirmation (amber)
  //   recordedById set                    → a supervisor confirmed it (red)
  // The UI reads exactly that distinction; nothing here interprets it.
  //
  // Sequential await, no $transaction (CORE §3). Skipped entirely on a bill
  // with no lines.
  const findingRows =
    rawLines.length > 0
      ? await prisma.pick_findings.findMany({
          where: { rawLineItemId: { in: rawLines.map((l) => l.id) } },
          select: {
            rawLineItemId: true,
            qtyFound:      true,
            reason:        true,
            remarks:       true,
            // Old-MFG month/year (2026-08-08). Prefills the popup on re-open,
            // and since 2026-08-09 also renders as the note's "· Mar 2024"
            // tail on old_mfg lines (lib/picking/types.ts).
            mfgMonth:      true,
            mfgYear:       true,
            reportedById:  true,
            reportedAt:    true,
            recordedById:  true,
            recordedAt:    true,
          },
        })
      : [];
  // Normalised to the wire shape (PickingLineFinding) right here, so the pure
  // grouping below never sees a Prisma row or a Date. The two timestamps become
  // ISO strings — byte for byte what NextResponse.json already emitted for them,
  // so this is a type-honesty fix, not a wire change.
  const findingByLineId = new Map<number, PickingLineFinding>(
    findingRows.map((f) => [
      f.rawLineItemId,
      {
        qtyFound:     f.qtyFound,
        reason:       f.reason,
        remarks:      f.remarks,
        mfgMonth:     f.mfgMonth,
        mfgYear:      f.mfgYear,
        reportedById: f.reportedById,
        reportedAt:   f.reportedAt?.toISOString() ?? null,
        recordedById: f.recordedById,
        recordedAt:   f.recordedAt?.toISOString() ?? null,
      },
    ]),
  );

  // ── Split-SKU grouping (2026-08-10) ───────────────────────────────────────
  // One row per (skuCodeRaw, resolved pack), quantities summed. The rule, the
  // live evidence behind it, and why a group carrying a finding is deliberately
  // left UNMERGED all live in lib/picking/group-lines.ts — read it there before
  // touching this. Pure and synchronous; the reads above are this route's only
  // I/O (sequential awaits, no $transaction — CORE §3).
  const lines = groupPickingDetailLines(rawLines, catalogByCode, findingByLineId);

  return NextResponse.json({ lines });
}
