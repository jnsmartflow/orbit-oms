import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/rbac";
import { getPickingQueue } from "@/lib/picking/queue";
import { splitPickerRows } from "@/lib/picking/picker-split";
import { resolveCatalogByCode } from "@/lib/picking/resolve-lines";
import type {
  CombinedBill,
  CombinedPickResult,
  CombinedSkuRow,
} from "@/lib/picking/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/picking/combined — one picker's PENDING bills, merged into one flat
 * list, one row per distinct SAP code, quantities and volume summed.
 *
 * ⚠️ THE SCOPE IS DECIDED SERVER-SIDE AND IS NEVER SENT BY THE PHONE. There is
 * deliberately no `orderIds` parameter: the route resolves the viewer's own
 * pickerId, re-runs the EXACT rule the Pending tab already uses
 * (getPickingQueue({ scope: "openPending", pickerId }) → splitPickerRows →
 * `pending`), and merges whatever that returns. Two things fall out of that,
 * both load-bearing:
 *   • Combined can never show another picker's bills — there is no input that
 *     could widen it.
 *   • Combined can never drift from Pending — it is not a parallel filter, it
 *     is the same one, called again.
 *
 * `pickerId` IS accepted as a query param, but ONLY for the admin/operations
 * `?view=picker&as=<id>` preview (app/picking/page.tsx). A real picker's own
 * session id always wins and the param is ignored for him — strictly tighter
 * than app/api/picking/queue/route.ts, which accepts the param from anyone
 * holding picking.canView.
 *
 * Read-only: SELECTs only, no writes, sequential awaits, never
 * prisma.$transaction (CORE §3).
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same gate + admin bypass as every other picking read route (queue/marker/
  // order) — this route is reachable directly by URL and returns real depot
  // data.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "picking", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // ── Whose board is this? ──────────────────────────────────────────────────
  const primaryRole = session.user.role;
  const canUseTestHook = roles.includes(ROLES.ADMIN) || roles.includes(ROLES.OPERATIONS);

  let pickerId: number;
  if (primaryRole === "picker") {
    // The real path. His own session id, never the query param — a picker
    // cannot ask for anybody else's combined list even by editing the URL.
    const ownId = Number(session.user.id);
    if (!Number.isInteger(ownId) || ownId <= 0) {
      return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
    }
    pickerId = ownId;
  } else if (canUseTestHook) {
    // Admin/operations preview only. Validated exactly like the queue and
    // marker routes so the three accept and reject the identical value.
    const pickerIdParam = new URL(req.url).searchParams.get("pickerId")?.trim() || undefined;
    if (pickerIdParam === undefined) {
      return NextResponse.json(
        { error: "pickerId is required when previewing another picker's board" },
        { status: 400 },
      );
    }
    const n = Number(pickerIdParam);
    if (!Number.isInteger(n) || n <= 0) {
      return NextResponse.json(
        { error: `Invalid pickerId "${pickerIdParam}" — expected a positive integer` },
        { status: 400 },
      );
    }
    pickerId = n;
  } else {
    // A floor_supervisor holds picking.canView but has no "own" picker board,
    // and must not be able to name one. 403 rather than 400 — this is an
    // authorisation answer, not a malformed request.
    return NextResponse.json(
      { error: "This view is scoped to a picker's own bills" },
      { status: 403 },
    );
  }

  // ── The picker's Pending list — the SAME rule, not a copy of it ───────────
  // Narrowed to him in the QUERY (pickerId), then split by the one shared rule
  // so this endpoint and his Pending tab can never disagree about membership.
  // Sequential awaits only.
  const queue = await getPickingQueue({ scope: "openPending", pickerId });
  const { pending } = splitPickerRows(queue.rows, pickerId, new Date());

  const bills: CombinedBill[] = pending.map((r) => ({
    orderId: r.orderId,
    obdNumber: r.obdNumber,
    dealerName: r.dealerName,
  }));

  if (bills.length === 0) {
    const empty: CombinedPickResult = { pickerId, bills: [], rows: [] };
    return NextResponse.json(empty);
  }

  // ── Raw lines for those bills ────────────────────────────────────────────
  // There is no FK from `orders` to its line items — `import_raw_line_items`
  // carries a plain `obdNumber` string, matched here against the orders' own
  // unique obdNumbers (the same join the single-bill detail route makes, just
  // `in` instead of `=`).
  //
  // `lineStatus: "active"` ONLY — deliberately the single-bill detail screen's
  // filter, not lib/picking/queue.ts's stricter active+valid pair: a picker
  // opening one of these bills must see the identical line set he sees here,
  // and the full active set is what that screen shows.
  const obdNumbers = Array.from(new Set(pending.map((r) => r.obdNumber)));
  const rawLines = await prisma.import_raw_line_items.findMany({
    where: { obdNumber: { in: obdNumbers }, lineStatus: "active" },
    select: {
      id: true,
      obdNumber: true,
      skuCodeRaw: true,
      skuDescriptionRaw: true,
      unitQty: true,
      volumeLine: true,
    },
    orderBy: { lineId: "asc" },
  });

  // Catalog names + packs, one batch lookup for every code on every bill.
  // ⚠ Never via enrichedLineItem.sku — see lib/picking/resolve-lines.ts.
  const catalogByCode = await resolveCatalogByCode(rawLines.map((l) => l.skuCodeRaw));

  // ── Merge ────────────────────────────────────────────────────────────────
  // Lines are grouped by bill first, then walked in the server's own bill order
  // (PICKING_SPINE, preserved through splitPickerRows' filters) with each
  // bill's lines in lineId order. That makes the output deterministic in two
  // ways that matter: the row ORDER is stable across refreshes, and "the first
  // contributing bill" — whose raw text a code with no catalog entry falls back
  // to — is a defined bill rather than whatever Postgres returned first.
  type RawLine = (typeof rawLines)[number];
  const linesByObd = new Map<string, RawLine[]>();
  for (const line of rawLines) {
    const bucket = linesByObd.get(line.obdNumber);
    if (bucket) bucket.push(line);
    else linesByObd.set(line.obdNumber, [line]);
  }

  // ⚠ KEYED ON THE SAP CODE, ALWAYS — never on description text. Two bills can
  // carry different raw text for the same unmastered code; merging on text
  // would split one real product in two (or, worse, fuse two different ones).
  const rowByCode = new Map<string, CombinedSkuRow>();
  for (const bill of pending) {
    for (const line of linesByObd.get(bill.obdNumber) ?? []) {
      const code = line.skuCodeRaw;
      if (!code) continue; // no code = nothing to merge ON; cannot be summed safely

      let row = rowByCode.get(code);
      if (!row) {
        const cat = catalogByCode.get(code);
        row = {
          sku: code,
          // Unmastered code → the raw SAP text of the FIRST contributing bill.
          // Purely cosmetic; deliberately no cleverness here.
          name: cat?.name ?? line.skuDescriptionRaw ?? null,
          // Blank pack stays blank rather than guessing — a blank prevents a
          // mis-pick, a wrong value does not (CLAUDE_PICKING.md §7).
          pack: cat?.pack ?? null,
          qty: 0,
          litres: 0,
          contributions: [],
        };
        rowByCode.set(code, row);
      }

      const litres = line.volumeLine ?? 0;
      row.qty += line.unitQty;
      row.litres += litres;
      row.contributions.push({
        orderId: bill.orderId,
        lineItemId: line.id,
        qty: line.unitQty,
        litres,
      });
    }
  }

  // Map iteration is insertion order, which is the walk order above.
  // Array.from around the iterator (CORE §3 — target < ES2015).
  const rows = Array.from(rowByCode.values()).map((row) => ({
    ...row,
    // Kill float noise from summing volumeLine (0.1+0.2). Display rounds again
    // to 1dp; this just stops 2.8000000000000003 riding the wire.
    litres: Math.round(row.litres * 100) / 100,
  }));

  const result: CombinedPickResult = { pickerId, bills, rows };
  return NextResponse.json(result);
}
