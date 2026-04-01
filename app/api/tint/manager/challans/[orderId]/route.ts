import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

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
    const order = await prisma.orders.findUnique({
      where: { id: orderId },
      select: {
        id:               true,
        obdNumber:        true,
        dispatchSlot:     true,
        shipToCustomerId: true,
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // ── 2. Auto-create delivery_challans if missing ───────────────────────────
    // challanNumber format: CHN-{YEAR}-{MAX(id)+1 padded to 5 digits}
    let challan = await prisma.delivery_challans.findUnique({
      where: { orderId },
    });

    if (!challan) {
      const maxRow = await prisma.delivery_challans.findFirst({
        orderBy: { id: "desc" },
        select:  { id: true },
      });
      const nextSeq      = (maxRow?.id ?? 0) + 1;
      const year         = new Date().getFullYear();
      const challanNumber = `CHN-${year}-${String(nextSeq).padStart(5, "0")}`;

      challan = await prisma.delivery_challans.create({
        data: { orderId, challanNumber },
      });
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
        where:   { obdNumber: order.obdNumber },
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
              contacts: {
                select: {
                  name:        true,
                  phone:       true,
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
          contacts: {
            select: {
              name:        true,
              phone:       true,
              contactRole: { select: { name: true } },
            },
          },
        },
      });
    }

    // ── 5. Build lookup maps ──────────────────────────────────────────────────
    const formulaMap = new Map(formulas.map((f) => [f.rawLineItemId, f.formula]));
    const configMap  = new Map(configRows.map((c) => [c.key, c.value]));

    // ── 6. Resolve contacts (single contact per role group) ───────────────────
    const billToContact = (() => {
      const match = billToPoint?.contacts.find(
        (c) => c.contactRole?.name === "Owner" || c.contactRole?.name === "Manager",
      );
      return match ? { name: match.name, phone: match.phone ?? null } : null;
    })();

    const shipToSiteContact = (() => {
      const match = resolvedShipTo?.contacts.find(
        (c) => c.contactRole?.name === "Site Engineer" || c.contactRole?.name === "Contractor",
      );
      return match ? { name: match.name, phone: match.phone ?? null } : null;
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
          salesOfficer: resolvedShipTo?.salesOfficerGroup?.salesOfficer
            ? {
                name:  resolvedShipTo.salesOfficerGroup.salesOfficer.name,
                phone: resolvedShipTo.salesOfficerGroup.salesOfficer.phone ?? null,
              }
            : null,
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
    // ── 1. Confirm the challan row exists ─────────────────────────────────────
    const challan = await prisma.delivery_challans.findUnique({
      where:  { orderId },
      select: { id: true, orderId: true },
    });

    if (!challan) {
      return NextResponse.json(
        { error: "Challan not found. Open the GET endpoint first to auto-create it." },
        { status: 404 },
      );
    }

    // ── 2. Validate formula rawLineItemIds — isTinting = true only ────────────
    if (formulas && formulas.length > 0) {
      const requestedIds = formulas.map((f) => f.rawLineItemId);

      // Fetch the order's obdNumber so we can filter by it
      const orderRow = await prisma.orders.findUnique({
        where:  { id: orderId },
        select: { obdNumber: true },
      });

      if (!orderRow) {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }

      const tintingLines = await prisma.import_raw_line_items.findMany({
        where: {
          id:        { in: requestedIds },
          obdNumber: orderRow.obdNumber,
          isTinting: true,
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
