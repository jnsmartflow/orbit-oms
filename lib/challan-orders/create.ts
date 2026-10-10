// lib/challan-orders/create.ts
//
// CREATE ONE CHALLAN ORDER (Challan orders slice 3, 2026-10-07). The one writer of
// an ORB order. Called only by POST /api/place-order/challan-orders.
// Spec: docs/prompts/drafts/code-plan-2026-10-07-challan-slice3.md (rev 1) + the
// owner decisions in web-update-2026-10-06-challan-orders.md §4c (S3-1…S3-7).
//
// WHAT IT MAKES: one `orders` row that Picking and Floor cannot tell from an
// imported non-tint bill released to picking — workflowStage 'pending_picking'
// (SUPPORT_DONE_OUTPUT, where the import's release puts such a bill), status
// 'dispatch', orderType 'non_tint' — plus the four rows every board reads with it:
// import_batches, import_raw_summary, import_raw_line_items,
// import_obd_query_summary. And one order_status_logs row.
//
// 🔴 OPTION B — BUILT DARK, NUMBERED LAST (plan §2). Everything is written under a
// temporary key with the order soft-removed (isRemoved = true — every board reads
// isRemoved: false, CORE §3). Only then does ONE orders.update take the lowest free
// ORB number (orders_obdNumber_key is the lock), the children are re-keyed BY ROW
// ID, and ONE more update makes the bill visible. A failure before the claim holds
// no number; a failure after it gives the number back (releaseClaim), and a release
// that itself fails is picked up by the next create (releaseStaleClaims). Gapless,
// owner S3-4. Sequential awaits — NEVER prisma.$transaction (CORE §3). No hard
// deletes: a failed create's dark rows stay, invisible, under a non-ORB key.
//
// ⚠ NOTHING IS WRITTEN UNTIL EVERY CHECK HAS PASSED (validate() below).

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";
import { resolveArrivalSlotId } from "@/lib/slots/slot-ruler";
import { resolveLegacySlot } from "@/lib/dispatch/legacy-slot";
import { evaluateDispatchSlot } from "@/lib/dispatch/dispatch-engine";
import { resolveArrivalClocks } from "@/lib/dispatch/punch-clock";
import { computeArticleInfo, loadPackCatalog, rollupArticleTagsBySku, type ArticleInfo } from "@/lib/article-tag";
import { packToLitres } from "@/lib/place-order/pack";
import { orderRemarkText } from "@/lib/place-order/email";
import { CHALLAN_STAGING, lowestFreeOrbNumber, releaseClaim, releaseStaleClaims } from "./number";
import { createSapInvoiceRows } from "@/lib/order-invoices/sap-row";
import type {
  CreateChallanOrderErrorCode,
  CreateChallanOrderRequest,
  CreateChallanOrderResponse,
} from "./types";

/** A sane ceiling per line — the cart has none; a typo of 100000 is not an order. */
const MAX_TINS_PER_LINE = 10_000;

type Refusal = { ok: false; code: CreateChallanOrderErrorCode; error: string; status: number };
type Created = Extract<CreateChallanOrderResponse, { ok: true }>;

function refuse(code: CreateChallanOrderErrorCode, error: string, status = 400): Refusal {
  return { ok: false, code, error, status };
}

/** IST "HH:mm" of an instant. */
function istHhMm(at: Date): string {
  const ist = new Date(at.getTime() + 5.5 * 60 * 60 * 1000);
  return `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}`;
}


/** Is this the obdNumber unique — i.e. another press took the same number? */
function isObdNumberClash(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = err.meta?.target;
  const text = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return text.includes("obdNumber");
}

interface ResolvedLine {
  lineId: number;
  material: string;
  description: string;
  tins: number;
  litres: number;
}

interface Validated {
  billTo: { id: number; customerCode: string; customerName: string; isKeyCustomer: boolean; isKeySite: boolean };
  /** The dealer the truck goes to when it is not the bill-to; null = same as billing. */
  dealer: { id: number; customerCode: string; customerName: string } | null;
  /** delivery_type_master.name of the EFFECTIVE delivery point — the engine's input. */
  deliveryType: string | null;
  lines: ResolvedLine[];
}

const POINT_SELECT = {
  id: true,
  customerCode: true,
  customerName: true,
  isActive: true,
  isKeyCustomer: true,
  isKeySite: true,
  area: { select: { deliveryType: { select: { name: true } } } },
} as const;

/** Every re-check of plan §7. Reads only. */
async function validate(body: CreateChallanOrderRequest): Promise<Validated | Refusal> {
  // 2. Dispatch — Normal or Urgent; Call would hold the order (owner S3-2).
  const dispatch = body.dispatch as string;
  if (dispatch === "Call") {
    return refuse("CALL_NOT_ALLOWED", "Call is not allowed on a challan order — choose Normal or Urgent.");
  }
  if (dispatch !== "Normal" && dispatch !== "Urgent") return refuse("BAD_REQUEST", "Dispatch must be Normal or Urgent.");

  const shipMode = body.shipTo?.mode as string | undefined;
  if (shipMode !== "same" && shipMode !== "dealer") {
    return refuse("BAD_REQUEST", "Ship to must be the billing dealer or another dealer.");
  }

  // 3. Bill-to and ship-to dealer: ACTIVE customer-master rows.
  const billCode = typeof body.customerCode === "string" ? body.customerCode.trim() : "";
  const billTo = billCode
    ? await prisma.delivery_point_master.findUnique({ where: { customerCode: billCode }, select: POINT_SELECT })
    : null;
  if (!billTo || !billTo.isActive) {
    return refuse("CUSTOMER_NOT_FOUND", `Customer ${billCode || "(none)"} is not an active customer in the master.`);
  }

  let dealer: Validated["dealer"] = null;
  let deliveryType = billTo.area?.deliveryType?.name ?? null;
  if (body.shipTo.mode === "dealer") {
    const code = typeof body.shipTo.customerCode === "string" ? body.shipTo.customerCode.trim() : "";
    // The billing dealer picked as "another dealer" is simply same-as-billing.
    if (code && code !== billTo.customerCode) {
      const point = await prisma.delivery_point_master.findUnique({ where: { customerCode: code }, select: POINT_SELECT });
      if (!point || !point.isActive) {
        return refuse("SHIP_TO_NOT_FOUND", `Ship-to dealer ${code} is not an active customer in the master.`);
      }
      dealer = { id: point.id, customerCode: point.customerCode, customerName: point.customerName };
      deliveryType = point.area?.deliveryType?.name ?? null;
    } else if (!code) {
      return refuse("SHIP_TO_NOT_FOUND", "Pick the dealer the goods go to, or choose Same as billing.");
    }
  }

  // 4. At least one line; every quantity a positive whole number.
  const input = Array.isArray(body.lines) ? body.lines : [];
  if (input.length === 0) return refuse("NO_LINES", "Add at least one item to the challan order.");
  for (const l of input) {
    if (!Number.isInteger(l?.tins) || l.tins <= 0 || l.tins > MAX_TINS_PER_LINE) {
      return refuse("BAD_QTY", `Every quantity must be a whole number from 1 to ${MAX_TINS_PER_LINE}.`);
    }
    if (!Number.isInteger(l.productId) || typeof l.packCode !== "string" || typeof l.material !== "string") {
      return refuse("BAD_REQUEST", "A line is malformed — reload the page and try again.");
    }
  }

  // 5. Every material, by NATURAL KEY (CORE §13 — never an id across tables):
  //    the grid row → (product ?? subProduct, baseColour) → an isPrimary
  //    mo_sku_lookup_v2 row with this material and this exact pack → sku_master_v2.
  //    The same join /api/place-order/data uses to draw the cell.
  const productIds = Array.from(new Set(input.map((l) => l.productId)));
  const indexRows = await prisma.mo_order_form_index_v2.findMany({
    where: { id: { in: productIds }, isActive: true },
    select: { id: true, product: true, subProduct: true, baseColour: true, displayName: true },
  });
  const indexById = new Map(indexRows.map((r) => [r.id, r]));
  const materials = Array.from(new Set(input.map((l) => l.material.trim()).filter(Boolean)));
  const lookups = materials.length
    ? await prisma.mo_sku_lookup_v2.findMany({
        where: { material: { in: materials }, isPrimary: true },
        select: { material: true, product: true, baseColour: true, packCode: true, unit: true },
      })
    : [];
  const lookupByMaterial = new Map(lookups.map((r) => [r.material, r]));
  const catalog = materials.length
    ? await prisma.sku_master_v2.findMany({
        where: { material: { in: materials } },
        select: { material: true, description: true },
      })
    : [];
  const descByMaterial = new Map(catalog.map((r) => [r.material, r.description]));

  const lines: ResolvedLine[] = [];
  for (const l of input) {
    const row = indexById.get(l.productId);
    if (!row) return refuse("UNKNOWN_PRODUCT", "A product in the cart is no longer on the order form — remove it and add it again.");
    const label = `${row.displayName} · ${l.packCode}${l.unit ?? ""}`;
    const material = l.material.trim();
    const sku = lookupByMaterial.get(material);
    const joinName = row.product ?? row.subProduct;
    const matches =
      !!sku &&
      sku.product === joinName &&
      (row.baseColour ? sku.baseColour === row.baseColour : true) &&
      String(sku.packCode) === l.packCode &&
      (sku.unit ?? null) === (l.unit ?? null);
    const description = descByMaterial.get(material);
    if (!matches || !description) {
      return refuse(
        "UNRESOLVED_LINE",
        `${label} has no SAP code — remove it and add it again from the grid.`,
        422,
      );
    }
    lines.push({
      lineId: (lines.length + 1) * 10,
      material,
      description,
      tins: l.tins,
      litres: packToLitres(l.packCode, l.unit) * l.tins,
    });
  }

  return {
    billTo: {
      id: billTo.id,
      customerCode: billTo.customerCode,
      customerName: billTo.customerName,
      isKeyCustomer: billTo.isKeyCustomer,
      isKeySite: billTo.isKeySite,
    },
    dealer,
    deliveryType,
    lines,
  };
}

/**
 * Create one challan order. `actorId` is the session user. Returns the response
 * body plus the HTTP status for the route.
 */
export async function createChallanOrder(
  body: CreateChallanOrderRequest,
  actorId: number,
): Promise<(Created & { status: number }) | Refusal> {
  const checked = await validate(body);
  if ("ok" in checked) return checked;
  const { billTo, dealer, deliveryType, lines } = checked;

  const now = new Date();
  const istTime = istHhMm(now);
  const tmpKey = `CO-TMP-${randomUUID()}`;
  const totalTins = lines.reduce((s, l) => s + l.tins, 0);
  const totalLitres = lines.reduce((s, l) => s + l.litres, 0);

  // Derived fields — reads only, still nothing written.
  // SMU (owner S3-6): the bill-to dealer's most recent bill, else null.
  const lastBill = await prisma.orders.findFirst({
    where: { customerId: billTo.id, isRemoved: false, isChallanOrder: false },
    orderBy: { createdAt: "desc" },
    select: { smu: true },
  });
  const smu = lastBill?.smu ?? null;

  // Priority: Urgent, or a key dealer / key site — the import's own rule (route.ts:1458).
  const priorityLevel = body.dispatch === "Urgent" || billTo.isKeyCustomer || billTo.isKeySite ? 1 : 3;

  // Remarks: the same words the email's Remark / Note lines would carry.
  const remarkParts = [orderRemarkText(body.marker, body.crossDepot), (body.notes ?? "").trim() || null].filter(
    (p): p is string => !!p,
  );
  const remarks = remarkParts.length ? remarkParts.join(" | ") : null;

  // Engine slot — the call applyNoMailOrderFallback makes (route.ts:711-740). A
  // decline leaves the slot null: "no slot", exactly as an imported bill.
  const clocks = resolveArrivalClocks(now, now);
  const engine = evaluateDispatchSlot({
    smu,
    dispatchStatus: "dispatch",
    deliveryType,
    emailDateTime: clocks.emailDateTime,
    punchDateTime: clocks.punchDateTime,
  });
  let engineSlot: Record<string, unknown> = {};
  if (engine.assigned) {
    const windowRow = await prisma.dispatch_slot_master.findFirst({
      where: { isActive: true, windowTime: engine.windowTime },
      select: { id: true },
    });
    if (windowRow) {
      engineSlot = {
        dispatchTargetDate: engine.targetDate,
        dispatchWindowId: windowRow.id,
        dispatchSlotRuleId: engine.ruleId,
        dispatchSlotSource: "auto",
      };
    }
  }
  // The import's own legacy slot rule — one owner since slice 6 (lib/dispatch/legacy-slot.ts).
  const { dispatchSlot, slotId } = resolveLegacySlot(istTime);

  // Article tags — the import's own helpers, one catalog read.
  const packCatalog = await loadPackCatalog(lines.map((l) => l.material));
  const articles: ArticleInfo[] = [];
  for (const l of lines) {
    articles.push(await computeArticleInfo({ material: l.material, unitQty: l.tins, volumeLine: l.litres }, packCatalog));
  }
  const rollup = await rollupArticleTagsBySku(
    lines.map((l) => ({ skuCodeRaw: l.material, unitQty: l.tins, volumeLine: l.litres })),
    packCatalog,
  );

  // A number stranded by an earlier failure is freed BEFORE this press allocates.
  await releaseStaleClaims(now);

  // ── 1. batch ───────────────────────────────────────────────────────────────
  const batch = await prisma.import_batches.create({
    data: {
      batchRef: tmpKey,
      importedById: actorId,
      headerFile: `[challan-order] ${billTo.customerCode}`,
      lineFile: "",
      status: "processing",
      totalObds: 1,
    },
    select: { id: true },
  });

  let orderId: number | null = null;
  let claimed: string | null = null;
  try {
    // ── 2. the order, DARK, under the temporary key ──────────────────────────
    // isChallanOrder false until the claim: chk_orders_orb_number forbids a
    // challan row without an ORB number. isRemoved hides it from every board.
    const order = await prisma.orders.create({
      data: {
        obdNumber: tmpKey,
        batchId: batch.id,
        isChallanOrder: false,
        isRemoved: true,
        removalReason: CHALLAN_STAGING,
        customerId: billTo.id,
        shipToCustomerId: billTo.customerCode,
        shipToCustomerName: billTo.customerName,
        shipToOverride: dealer !== null,
        shipToOverrideCustomerId: dealer?.id ?? null,
        orderType: "non_tint",
        workflowStage: SUPPORT_DONE_OUTPUT,
        dispatchStatus: "dispatch",
        dispatchSlot,
        slotId,
        originalSlotId: slotId,
        arrivalSlotId: resolveArrivalSlotId(now),
        ...engineSlot,
        priorityLevel,
        remarks,
        smu,
        obdEmailDate: now,
        orderDateTime: now,
        totalUnitQty: totalTins,
        volume: totalLitres,
        grossWeight: 0,
        manualTintEntry: false,
      },
      select: { id: true },
    });
    orderId = order.id;
    // Add invoices (v27.63): every order — an ORB one too — gets its seq-1
    // 'sap' row (invoiceNo NULL: a challan never gets an SAP invoice). Keyed by
    // id, so the re-key in step 7 does not touch it. Never throws.
    await createSapInvoiceRows([order.id]);

    // ── 3. raw summary ───────────────────────────────────────────────────────
    const summary = await prisma.import_raw_summary.create({
      data: {
        batchId: batch.id,
        obdNumber: tmpKey,
        smu,
        obdEmailDate: now,
        obdEmailTime: istTime,
        totalUnitQty: totalTins,
        grossWeight: 0,
        volume: totalLitres,
        billToCustomerId: billTo.customerCode,
        billToCustomerName: billTo.customerName,
        shipToCustomerId: dealer?.customerCode ?? billTo.customerCode,
        shipToCustomerName: dealer?.customerName ?? billTo.customerName,
        rowStatus: "valid",
      },
      select: { id: true },
    });

    // ── 4. raw lines + count check (Auto-Import GUARD 1) ─────────────────────
    const created = await prisma.import_raw_line_items.createMany({
      data: lines.map((l, i) => ({
        rawSummaryId: summary.id,
        obdNumber: tmpKey,
        lineId: l.lineId,
        skuCodeRaw: l.material,
        skuDescriptionRaw: l.description,
        unitQty: l.tins,
        volumeLine: l.litres,
        isTinting: false, // owner S3-5: base / tintable products go as plain goods
        article: articles[i].article,
        articleTag: articles[i].articleTag,
        rowStatus: "valid",
      })),
    });
    if (created.count !== lines.length) {
      throw new Error(`line write count mismatch (expected ${lines.length}, got ${created.count})`);
    }

    // ── 5. query summary ─────────────────────────────────────────────────────
    await prisma.import_obd_query_summary.create({
      data: {
        orderId: order.id,
        obdNumber: tmpKey,
        totalLines: lines.length,
        totalUnitQty: totalTins,
        totalWeight: 0,
        totalVolume: totalLitres,
        hasTinting: false,
        totalArticle: rollup.totalArticle,
        articleTag: rollup.articleTag,
      },
    });

    // ── 6. CLAIM — the lowest free ORB number, one update, retry ONCE ────────
    for (let attempt = 0; attempt < 2 && claimed === null; attempt++) {
      const candidate = await lowestFreeOrbNumber(now);
      try {
        await prisma.orders.update({
          where: { id: order.id },
          data: { obdNumber: candidate, isChallanOrder: true },
        });
        claimed = candidate;
      } catch (err) {
        if (!isObdNumberClash(err)) throw err;
      }
    }
    if (claimed === null) {
      await prisma.import_batches.update({ where: { id: batch.id }, data: { status: "failed" } }).catch(() => undefined);
      return refuse("NUMBER_BUSY", "Someone else is creating a challan order right now — please press Create again.", 409);
    }

    // ── 7. re-key the children to the number, BY ROW ID ──────────────────────
    await prisma.import_raw_summary.update({ where: { id: summary.id }, data: { obdNumber: claimed } });
    await prisma.import_raw_line_items.updateMany({ where: { rawSummaryId: summary.id }, data: { obdNumber: claimed } });
    await prisma.import_obd_query_summary.update({ where: { orderId: order.id }, data: { obdNumber: claimed } });

    // ── 8. MAKE VISIBLE — one write ──────────────────────────────────────────
    await prisma.orders.update({
      where: { id: order.id },
      data: { isRemoved: false, removalReason: null },
    });
  } catch (err) {
    console.error(`[challan-orders] create failed${claimed ? ` after claiming ${claimed}` : ""}`, err);
    // Give the number back at once; if this fails too, the next create's
    // releaseStaleClaims() frees it after STALE_CLAIM_MS.
    if (claimed !== null && orderId !== null) {
      await releaseClaim({ id: orderId, batchId: batch.id }).catch((e) =>
        console.error(`[challan-orders] could not release ${claimed} — the next create will`, e),
      );
    }
    await prisma.import_batches.update({ where: { id: batch.id }, data: { status: "failed" } }).catch(() => undefined);
    return refuse("WRITE_FAILED", "The challan order could not be saved — nothing was sent to picking. Please try again.", 500);
  }

  // ── 9. status log, 10. batch completed — the bill is LIVE from here on; a
  // failure below is logged, never rolled back (a missing log is not a missing bill).
  try {
    await prisma.order_status_logs.create({
      data: {
        orderId: orderId!,
        fromStage: null,
        toStage: SUPPORT_DONE_OUTPUT,
        changedById: actorId,
        note: `Created as challan order ${claimed} (Place Order)`,
      },
    });
  } catch (err) {
    console.error(`[challan-orders] ${claimed} is live but its status log failed`, err);
  }
  await prisma.import_batches
    .update({
      where: { id: batch.id },
      data: { status: "completed", headerFile: `[challan-order] ${claimed} · ${billTo.customerCode}` },
    })
    .catch((err) => console.error(`[challan-orders] ${claimed} is live but its batch was not marked completed`, err));

  return {
    ok: true,
    orderId: orderId!,
    orbNumber: claimed!,
    lines: lines.length,
    tins: totalTins,
    litres: Math.round(totalLitres * 10) / 10,
    status: 200,
  };
}
