// lib/tint/challan-detail.ts — ONE reader of a delivery challan (2026-10-09).
//
// The body of GET /api/tint/manager/challans/[orderId], MOVED here unchanged so
// two callers share one query instead of two copies drifting apart:
//   · that GET route — the Challans screen; gate delivery_challans canView;
//   · app/challan-print/[orderId]/page.tsx — the print-only page Floor's DC
//     column loads out of sight; gate floor OR delivery_challans canView.
// 🔴 NO ACCESS CHECK IN HERE. Each caller gates itself, before calling. Owned by
// Tint (CLAUDE_TINT.md §9); Floor is a caller.
//
// Returns the exact object the route used to hand NextResponse.json, or the
// status + message it used to answer with — the route maps both back 1:1.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveFiniMap } from "@/lib/fini-resolver";
import { buildSkuDisplay } from "@/types/sku-display";
import { SO_CASCADE_SELECT, resolveSalesOfficer } from "@/lib/customers/sales-officer";
// Type only — erased at build, so this server module pulls in no client code.
import type { ChallanApiResponse } from "@/components/tint/challan-document";

export type ChallanDetailResult =
  | { ok: true; data: ChallanApiResponse }
  | { ok: false; status: number; error: string };

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

export async function loadChallanDetail(orderId: number): Promise<ChallanDetailResult> {
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
        // The ship-to redirect (Floor / Tint Manager ship-to) — the site block
        // resolves it FIRST (2026-10-01, plan decision 12).
        shipToOverrideCustomerId: true,
        dispatchSlot:     true,
        shipToCustomerId: true,
        // Void-state metadata for the right-panel banner ("Voided by …").
        isRemoved:        true,
        removedAt:        true,
        removedBy:        { select: { name: true } },
      },
    });

    if (!order) {
      return { ok: false, status: 404, error: "Order not found" };
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
      return { ok: false, status: 404, error: "Challan not found for this order" };
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
              // SO group + Primary SO link + contacts (oldest first) — the S5
              // SO cascade's sources, shared with Floor (lib/customers/sales-officer.ts).
              ...SO_CASCADE_SELECT,
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
          // The S5 SO cascade's sources — see the ship-to read above.
          ...SO_CASCADE_SELECT,
        },
      });
    }

    // ── 4b. Ship-to REDIRECT wins (2026-10-01, Tint Manager tabs build step 5) ──
    // A bill whose ship-to was redirected on Floor or the Tint Manager
    // (orders.shipToOverrideCustomerId) prints the REDIRECTED site: its name,
    // address, code, route, area, site contact and sales officer all come from
    // that delivery point. Re-resolved on every GET, like the rest of this
    // block, so a reprint after a redirect carries the new site. No redirect, or
    // a redirect to a point that no longer exists → today's source, unchanged.
    // Bill-to is never touched: the ordering dealer did not change.
    // ⚠ TI report and sampling stay on the ORIGINAL site by design (ROADMAP).
    let shipToOverridden = false;
    if (order.shipToOverrideCustomerId !== null) {
      const overridePoint = await prisma.delivery_point_master.findUnique({
        where:  { id: order.shipToOverrideCustomerId },
        select: SHIP_TO_POINT_SELECT,
      });
      if (overridePoint !== null) {
        resolvedShipTo = overridePoint;
        shipToOverridden = true;
      }
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
      // "Receiver" FIRST (2026-10-02): the Tint Manager's Add ship-to form saves
      // its site receivers under that role (matched by NAME, never by id).
      const SITE_ROLES = ["Receiver", "Site Engineer", "Contractor", "Supervisor"];
      const match =
        contacts.find((c) => c.isPrimary && c.contactRole?.name !== "Sales Officer") ??
        contacts.find((c) => c.contactRole?.name != null && SITE_ROLES.includes(c.contactRole.name)) ??
        contacts.find((c) => c.contactRole?.name !== "Sales Officer") ??
        null;
      return match ? { name: match.name, phone: match.phone ?? null } : null;
    })();

    // Phase 5 cascade — locked order: Primary SO link → SO group → ship-to
    // "Sales Officer" contact → null. Moved VERBATIM to the shared helper
    // (2026-10-06) so Floor's SO column names the same person this prints.
    // Frozen-record rule: existing printed challans don't re-render, but
    // re-opens DO re-resolve, so the displayed SO matches current
    // customer-master state on every GET.
    const resolvedSalesOfficer = resolveSalesOfficer(resolvedShipTo);

    // ── 7. Assemble and return ────────────────────────────────────────────────
    return { ok: true, data: {

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
          // NAME: the customer master's name whenever a master record exists for
          // the ship-to (or the redirect) — so a spelling corrected in the master
          // prints (2026-10-02); SAP's name only when there is no master record.
          // CODE (below) is unchanged: the redirect's code, else SAP's.
          name:         resolvedShipTo?.customerName
                          ?? rawSummary?.shipToCustomerName
                          ?? "",
          address:      resolvedShipTo?.address               ?? null,
          shipToCode:   shipToOverridden
                          ? (resolvedShipTo?.customerCode ?? null)
                          : (rawSummary?.shipToCustomerId ?? resolvedShipTo?.customerCode ?? null),
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
    } };

  } catch (err) {
    console.error("[tint/manager/challans/[orderId]] Error:", err);
    return { ok: false, status: 500, error: err instanceof Error ? err.message : "Internal server error" };
  }
}

// The ship-to delivery-point read for the REDIRECT (step 4b in GET). The same
// columns the two ship-to reads above select, so the result drops into
// `resolvedShipTo` unchanged — those two are left as they were.
const SHIP_TO_POINT_SELECT = {
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
  // SO group + Primary SO link + contacts (oldest first).
  ...SO_CASCADE_SELECT,
} satisfies Prisma.delivery_point_masterSelect;
