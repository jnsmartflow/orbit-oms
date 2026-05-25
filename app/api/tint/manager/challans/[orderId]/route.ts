import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { resolveFiniMap } from "@/lib/fini-resolver";
import { buildSkuDisplay } from "@/types/sku-display";

export const dynamic = "force-dynamic";

// system_config keys consumed by the challan document
const CONFIG_KEYS = [
  "company_name",
  "company_subtitle",
  "depot_address",
  "depot_mobile",
  "gstin",
  "registered_office",
  "website",
  "tejas_contact",
] as const;

export async function GET(
  _req: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN, ROLES.OPERATIONS]);

  const orderId = parseInt(params.orderId, 10);
  if (isNaN(orderId)) {
    return NextResponse.json({ error: "Invalid orderId" }, { status: 400 });
  }

  try {
    // ── 1. Verify order exists ────────────────────────────────────────────────
    // Refined Phase 2c filter (Phase 2e): allow loading a voided challan that
    // belongs to a soft-removed order — Chandresh needs to inspect it.
    // findFirst (not findUnique) because the OR clause isn't valid on findUnique.
    const order = await prisma.orders.findFirst({
      where: {
        id: orderId,
        OR: [
          { isRemoved: false },
          { isRemoved: true, challan: { isVoided: true } },
        ],
      },
      select: {
        id:               true,
        obdNumber:        true,
        dispatchSlot:     true,
        shipToCustomerId: true,
        // Void-state metadata for the right-panel banner ("Voided by …").
        isRemoved:        true,
        removedAt:        true,
        removedBy:        { select: { name: true } },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // ── 2. Lookup challan — must already exist ────────────────────────────────
    // Challans are now auto-created at import time — no lazy creation needed.
    // If no challan exists, the order's SMU wasn't eligible for a challan.
    // NO isVoided filter — voided challans must still be viewable so the UI
    // can render the VOIDED banner. Voided state surfaces via the select.
    const challan = await prisma.delivery_challans.findUnique({
      where: { orderId },
    });

    if (!challan) {
      return NextResponse.json({ error: "Challan not found for this order" }, { status: 404 });
    }

    // ── 3. Parallel fetches (challan is now resolved) ─────────────────────────
    const [
      rawSummary,
      lineItems,
      querySummary,
      formulas,
      configRows,
    ] = await Promise.all([

      // import_raw_summary — OBD header fields
      prisma.import_raw_summary.findFirst({
        where: { obdNumber: order.obdNumber },
        select: {
          obdNumber:          true,
          smuNumber:          true,
          smu:                true,
          obdEmailDate:       true,
          warehouse:          true,
          grossWeight:        true,
          billToCustomerId:   true,
          billToCustomerName: true,
          shipToCustomerId:   true,
          shipToCustomerName: true,
        },
      }),

      // import_raw_line_items — line items ordered by lineId
      prisma.import_raw_line_items.findMany({
        where:   { obdNumber: order.obdNumber, lineStatus: "active" },
        orderBy: { lineId: "asc" },
        select: {
          id:                true,
          lineId:            true,
          skuCodeRaw:        true,
          skuDescriptionRaw: true,
          unitQty:           true,
          volumeLine:        true,
          isTinting:         true,
          articleTag:        true,
        },
      }),

      // import_obd_query_summary — totals row
      prisma.import_obd_query_summary.findFirst({
        where: { obdNumber: order.obdNumber },
        select: {
          totalUnitQty: true,
          totalVolume:  true,
          totalWeight:  true,
          hasTinting:   true,
          totalLines:   true,
        },
      }),

      // delivery_challan_formulas — per-tinting-line formula entries
      prisma.delivery_challan_formulas.findMany({
        where:  { challanId: challan.id },
        select: { rawLineItemId: true, formula: true },
      }),

      // system_config — company details for challan header/footer
      prisma.system_config.findMany({
        where:  { key: { in: [...CONFIG_KEYS] } },
        select: { key: true, value: true },
      }),
    ]);

    // ── 4. Resolve bill-to and ship-to delivery points ────────────────────────
    // Both IDs are stored as strings (customer codes) in import_raw_summary.
    const billToCode = rawSummary?.billToCustomerId  ?? null;
    const shipToCode = rawSummary?.shipToCustomerId  ?? order.shipToCustomerId ?? null;

    // Avoid duplicate DB call if both codes are the same customer
    const codesAreIdentical = billToCode !== null && billToCode === shipToCode;

    const [billToPoint, shipToPoint] = await Promise.all([
      billToCode
        ? prisma.delivery_point_master.findUnique({
            where: { customerCode: billToCode },
            select: {
              customerCode: true,
              customerName: true,
              address:      true,
              contacts: {
                select: {
                  name:        true,
                  phone:       true,
                  isPrimary:   true,
                  contactRole: { select: { name: true } },
                },
              },
            },
          })
        : null,

      shipToCode && !codesAreIdentical
        ? prisma.delivery_point_master.findUnique({
            where: { customerCode: shipToCode },
            select: {
              customerCode: true,
              customerName: true,
              address:      true,
              primaryRoute: { select: { name: true } },
              area: {
                select: {
                  name:         true,
                  primaryRoute: { select: { name: true } },
                },
              },
              salesOfficerGroup: {
                select: {
                  salesOfficer: { select: { name: true, phone: true } },
                },
              },
              // Phase 5 — Primary SO link, top cascade source for S5 SO column.
              salesOfficerLinks: {
                where:  { role: "PRIMARY", contactDismissed: false },
                take:   1,
                select: {
                  salesOfficer: { select: { name: true, phone: true } },
                },
              },
              contacts: {
                select: {
                  name:        true,
                  phone:       true,
                  isPrimary:   true,
                  contactRole: { select: { name: true } },
                },
              },
            },
          })
        : null,
    ]);

    // If bill-to and ship-to are the same customer, reuse the bill-to result
    // (which lacks route/SO fields) — fetch a full ship-to record instead
    let resolvedShipTo = shipToPoint;
    if (codesAreIdentical && billToCode) {
      resolvedShipTo = await prisma.delivery_point_master.findUnique({
        where: { customerCode: billToCode },
        select: {
          customerCode: true,
          customerName: true,
          address:      true,
          primaryRoute: { select: { name: true } },
          area: {
            select: {
              name:         true,
              primaryRoute: { select: { name: true } },
            },
          },
          salesOfficerGroup: {
            select: {
              salesOfficer: { select: { name: true, phone: true } },
            },
          },
          // Phase 5 — Primary SO link, top cascade source for S5 SO column.
          salesOfficerLinks: {
            where:  { role: "PRIMARY", contactDismissed: false },
            take:   1,
            select: {
              salesOfficer: { select: { name: true, phone: true } },
            },
          },
          contacts: {
            select: {
              name:        true,
              phone:       true,
              isPrimary:   true,
              contactRole: { select: { name: true } },
            },
          },
        },
      });
    }

    // ── 5. Build lookup maps ──────────────────────────────────────────────────
    const formulaMap = new Map(formulas.map((f) => [f.rawLineItemId, f.formula]));
    const configMap  = new Map(configRows.map((c) => [c.key, c.value]));

    // Fini/Generic mapping for line display
    const finiMap = await resolveFiniMap(
      lineItems.map((li) => li.skuCodeRaw).filter((c): c is string => !!c),
    );

    // ── 6. Resolve contacts (single contact per role group) ───────────────────
    const billToContact = (() => {
      const contacts = billToPoint?.contacts ?? [];
      if (contacts.length === 0) return null;
      const OWNER_ROLES = ["Owner", "Manager", "Proprietor", "Partner", "Director"];
      const match =
        contacts.find((c) => c.isPrimary) ??
        contacts.find((c) => c.contactRole?.name != null && OWNER_ROLES.includes(c.contactRole.name)) ??
        contacts[0];
      return { name: match.name, phone: match.phone ?? null };
    })();

    const shipToSiteContact = (() => {
      const contacts = resolvedShipTo?.contacts ?? [];
      if (contacts.length === 0) return null;
      const SITE_ROLES = ["Site Engineer", "Contractor", "Supervisor"];
      const match =
        contacts.find((c) => c.isPrimary && c.contactRole?.name !== "Sales Officer") ??
        contacts.find((c) => c.contactRole?.name != null && SITE_ROLES.includes(c.contactRole.name)) ??
        contacts.find((c) => c.contactRole?.name !== "Sales Officer") ??
        null;
      return match ? { name: match.name, phone: match.phone ?? null } : null;
    })();

    const resolvedSalesOfficer = (() => {
      // Phase 5 cascade — locked order (CLAUDE_TINT.md §5.5 reflects the
      // pre-Phase-5 order; context-file refresh tracked separately).
      // Frozen-record rule: existing printed challans don't re-render, but
      // re-opens DO re-resolve, so the displayed SO matches current
      // customer-master state on every GET.
      //
      // 1. Primary SO from customer_sales_officers (Phase 1 table). NEW.
      //    contactDismissed=true rows are filtered out by the include's
      //    where clause — falls through to source #2 in that case.
      const fromPrimary = resolvedShipTo?.salesOfficerLinks?.[0]?.salesOfficer;
      if (fromPrimary) {
        return { name: fromPrimary.name, phone: fromPrimary.phone ?? null };
      }
      // 2. salesOfficerGroup.salesOfficer (legacy fallback for historical
      //    customers without a Primary SO link yet; Phase 7 backfill will
      //    populate most of these).
      const fromGroup = resolvedShipTo?.salesOfficerGroup?.salesOfficer;
      if (fromGroup) {
        return { name: fromGroup.name, phone: fromGroup.phone ?? null };
      }
      // 3. Ship-To contact with contactRole.name === "Sales Officer". Rare
      //    manual override; usually redundant post-Phase 3b since the
      //    auto-contact would have matched source #1.
      const fromContact = resolvedShipTo?.contacts.find(
        (c) => c.contactRole?.name === "Sales Officer",
      );
      if (fromContact) {
        return { name: fromContact.name, phone: fromContact.phone ?? null };
      }
      // 4. null.
      return null;
    })();

    // ── 7. Assemble and return ────────────────────────────────────────────────
    return NextResponse.json({

      challan: {
        id:            challan.id,
        orderId:       challan.orderId,
        challanNumber: challan.challanNumber,
        transporter:   challan.transporter  ?? null,
        vehicleNo:     challan.vehicleNo    ?? null,
        printedAt:     challan.printedAt?.toISOString() ?? null,
        printedBy:     challan.printedBy    ?? null,
        createdAt:     challan.createdAt.toISOString(),
        updatedAt:     challan.updatedAt.toISOString(),
        // Phase 2e — void state for the banner + watermark + button disable.
        isVoided:      challan.isVoided,
        voidReason:    challan.voidReason ?? null,
        voidRemark:    challan.voidRemark ?? null,
        voidedAt:      challan.voidedAt?.toISOString() ?? null,
      },

      systemConfig: {
        companyName:      configMap.get("company_name")      ?? "",
        companySubtitle:  configMap.get("company_subtitle")  ?? "",
        depotAddress:     configMap.get("depot_address")     ?? "",
        depotMobile:      configMap.get("depot_mobile")      ?? "",
        gstin:            configMap.get("gstin")             ?? "",
        tejasContact:     configMap.get("tejas_contact")     ?? "",
        registeredOffice: configMap.get("registered_office") ?? "",
        website:          configMap.get("website")           ?? "",
      },

      order: {
        obdNumber:    rawSummary?.obdNumber                   ?? order.obdNumber,
        smu:          rawSummary?.smu                         ?? null,
        smuNumber:    rawSummary?.smuNumber                   ?? null,
        obdEmailDate: rawSummary?.obdEmailDate?.toISOString() ?? null,
        warehouse:    rawSummary?.warehouse                   ?? null,
        grossWeight:  rawSummary?.grossWeight                 ?? null,
        // Phase 2e — removal metadata for "Voided by X · timestamp" line.
        isRemoved:    order.isRemoved,
        removedAt:    order.removedAt?.toISOString() ?? null,
        removedBy:    order.removedBy ? { name: order.removedBy.name } : null,

        billTo: {
          name:         rawSummary?.billToCustomerName        ?? "",
          address:      billToPoint?.address                  ?? null,
          customerCode: rawSummary?.billToCustomerId ?? billToPoint?.customerCode ?? null,
          contact:      billToContact,
        },

        shipTo: {
          name:         rawSummary?.shipToCustomerName        ?? "",
          address:      resolvedShipTo?.address               ?? null,
          shipToCode:   rawSummary?.shipToCustomerId ?? resolvedShipTo?.customerCode ?? null,
          route:
            resolvedShipTo?.primaryRoute?.name ??
            resolvedShipTo?.area?.primaryRoute?.name ??
            null,
          area:         resolvedShipTo?.area?.name ?? null,
          salesOfficer: resolvedSalesOfficer,
          siteContact: shipToSiteContact,
        },

        lineItems: lineItems.map((li) => ({
          id:                li.id,
          lineId:            li.lineId,
          skuCodeRaw:        li.skuCodeRaw,
          skuDescriptionRaw: li.skuDescriptionRaw ?? null,
          unitQty:           li.unitQty,
          volumeLine:        li.volumeLine         ?? null,
          isTinting:         li.isTinting,
          articleTag:        li.articleTag         ?? null,
          formula:           formulaMap.get(li.id) ?? null,
          skuDisplay:        buildSkuDisplay(li.skuCodeRaw, li.skuDescriptionRaw, finiMap),
        })),

        totals: querySummary
          ? {
              totalUnitQty: querySummary.totalUnitQty,
              totalVolume:  querySummary.totalVolume,
              totalWeight:  querySummary.totalWeight,
            }
          : null,
      },
    });

  } catch (err) {
    console.error("[tint/manager/challans/[orderId]] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH — save transporter, vehicleNo, formulas, printedAt/printedBy
// ─────────────────────────────────────────────────────────────────────────────

interface FormulaItem {
  rawLineItemId: number;
  formula: string;
}

interface PatchBody {
  transporter?: string;
  vehicleNo?:   string;
  formulas?:    FormulaItem[];
  printedAt?:   string;
  printedBy?:   number;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN, ROLES.OPERATIONS]);

  const orderId = parseInt(params.orderId, 10);
  if (isNaN(orderId)) {
    return NextResponse.json({ error: "Invalid orderId" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { transporter, vehicleNo, formulas, printedAt, printedBy } = body;

  try {
    // ── 1. Confirm the challan row exists + check void state ──────────────────
    // Voided challans are read-only (UI shows banner). Reject write attempts
    // with 409 — caller must restore the order first to un-void the challan.
    const challan = await prisma.delivery_challans.findUnique({
      where:  { orderId },
      select: { id: true, orderId: true, isVoided: true },
    });

    if (!challan) {
      return NextResponse.json(
        { error: "Challan not found. Open the GET endpoint first to auto-create it." },
        { status: 404 },
      );
    }
    if (challan.isVoided) {
      return NextResponse.json(
        { ok: false, error: "Cannot modify a voided challan" },
        { status: 409 },
      );
    }

    // ── 2. Validate formula rawLineItemIds — isTinting = true only ────────────
    if (formulas && formulas.length > 0) {
      const requestedIds = formulas.map((f) => f.rawLineItemId);

      // Fetch the order's obdNumber so we can filter by it
      const orderRow = await prisma.orders.findFirst({
        where:  { id: orderId, isRemoved: false },
        select: { obdNumber: true },
      });

      if (!orderRow) {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }

      const tintingLines = await prisma.import_raw_line_items.findMany({
        where: {
          id:         { in: requestedIds },
          obdNumber:  orderRow.obdNumber,
          isTinting:  true,
          lineStatus: "active",
        },
        select: { id: true },
      });

      const validIds = new Set(tintingLines.map((l) => l.id));
      const invalid  = requestedIds.filter((id) => !validIds.has(id));

      if (invalid.length > 0) {
        return NextResponse.json(
          {
            error:   "Formula may only be set on tinting lines",
            invalid: invalid,
          },
          { status: 400 },
        );
      }
    }

    // ── 3. Build the challan update payload ───────────────────────────────────
    const challanUpdate: {
      transporter?: string;
      vehicleNo?:   string;
      printedAt?:   Date;
      printedBy?:   number;
    } = {};

    if (transporter !== undefined) challanUpdate.transporter = transporter;
    if (vehicleNo   !== undefined) challanUpdate.vehicleNo   = vehicleNo;
    if (printedAt   !== undefined) challanUpdate.printedAt   = new Date(printedAt);
    if (printedBy   !== undefined) challanUpdate.printedBy   = printedBy;

    // ── 4. Run all writes in a transaction ────────────────────────────────────
    const updated = await prisma.$transaction(async (tx) => {
      // 4a. Update delivery_challans (updatedAt is @updatedAt — Prisma sets it)
      const updatedChallan = await tx.delivery_challans.update({
        where: { id: challan.id },
        data:  challanUpdate,
      });

      // 4b. Upsert each formula — ON CONFLICT (challanId, rawLineItemId)
      if (formulas && formulas.length > 0) {
        for (const item of formulas) {
          await tx.delivery_challan_formulas.upsert({
            where: {
              challanId_rawLineItemId: {
                challanId:     challan.id,
                rawLineItemId: item.rawLineItemId,
              },
            },
            update: { formula: item.formula },
            create: {
              challanId:     challan.id,
              rawLineItemId: item.rawLineItemId,
              formula:       item.formula,
            },
          });
        }
      }

      return updatedChallan;
    });

    // ── 5. Return updated challan row ─────────────────────────────────────────
    return NextResponse.json({
      id:            updated.id,
      orderId:       updated.orderId,
      challanNumber: updated.challanNumber,
      transporter:   updated.transporter  ?? null,
      vehicleNo:     updated.vehicleNo    ?? null,
      printedAt:     updated.printedAt?.toISOString()  ?? null,
      printedBy:     updated.printedBy    ?? null,
      createdAt:     updated.createdAt.toISOString(),
      updatedAt:     updated.updatedAt.toISOString(),
    });

  } catch (err) {
    console.error("[tint/manager/challans/[orderId] PATCH] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
