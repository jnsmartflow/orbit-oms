import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";
import { logAdminAction } from "@/lib/audit/log";
import { SoSyncValidationError } from "@/lib/customers/so-sync";
import { createCustomer } from "@/lib/customers/create-customer";
import { MIN_ADDRESS, SO_NO_PHONE, checkReceivers } from "@/lib/customers/ship-to-rules";
import { isOrbCode, ORB_TYPED_REFUSAL } from "@/lib/customers/orbit-code";

export const dynamic = "force-dynamic";

/**
 * POST /api/tint/manager/ship-to/create — the Tint Manager's one-page
 * "Add ship-to" form (2026-10-02).
 *
 * Gate: customers canEdit — the same gate as POST /api/admin/customers.
 * Sequential awaits, no $transaction (CORE §3). Each step has its own catch.
 *
 *   a+b+c  lib/customers/create-customer.ts — THE SAME core as the admin POST:
 *          delivery_point_master (area only: primaryRouteId and
 *          dispatchDeliveryTypeId NULL = "Use area default", exactly what the
 *          admin form writes), the receivers as nested contacts, the ONE sales
 *          person as PRIMARY + SoSync (which adds the SO's own contact row with
 *          name + phone, and makes it the site's primary contact), then the
 *          backfill: every orphan order with this ship-to code →
 *          customerMissing false + customerId linked.
 *   d      mo_customer_keywords — one row (code, name, AREA, delivery type,
 *          route; keyword = name, required but unused by search), added only if
 *          no row has this code yet (the runbook's WHERE NOT EXISTS, done as a
 *          findFirst + create: the table has no unique on customerCode —
 *          docs/runbooks/customer-intake.sql — and tint routes write through
 *          Prisma only, lib/tint/marker-coverage.test.ts), so the site is searchable in
 *          /po and /place-order. A failure here does NOT undo the customer: the
 *          response carries a warning instead.
 *
 * 400 with a readable message if the code is already in the master.
 *
 * RECEIVER ROLE: contact_role_master has no receiver role (live 2026-10-02:
 * Owner, Contractor, Manager, Site Engineer, Sales Officer). The role is looked
 * up BY NAME — "Receiver" if an admin ever adds one, else "Site Engineer" —
 * never a hard-coded id and never a new row.
 */

const receiverSchema = z.object({
  name:  z.string().max(100),
  phone: z.string().max(30).optional().nullable(),
});

const bodySchema = z.object({
  customerCode:   z.string().trim().min(1).max(50),
  customerName:   z.string().trim().min(1).max(200),
  address:        z.string().max(500).optional().nullable(),   // required — checked below (ship-to-rules)
  areaId:         z.number().int().positive(),
  salesOfficerId: z.number().int().positive(),
  receivers:      z.array(receiverSchema).max(10).default([]),
});

/** delivery_type_master.name → the text mo_customer_keywords holds (LOCAL / UPC). */
function keywordDeliveryType(name: string | null | undefined): string | null {
  if (!name) return null;
  if (name === "Local") return "LOCAL";
  if (name === "Upcountry") return "UPC";
  return name.toUpperCase();
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "customers", "canEdit");
  if (!allowed) return NextResponse.json({ error: "No permission to add customers" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Fill code, name, area and sales person." }, { status: 400 });
  const body = parsed.data;
  const customerCode = body.customerCode.toUpperCase();
  // ORB- codes are made by the system for Orbit customers (2026-10-05) and
  // must never get the keyword row this route writes — refuse before any write.
  if (isOrbCode(customerCode)) return NextResponse.json({ error: ORB_TYPED_REFUSAL }, { status: 400 });

  // EVERY FIELD IS MANDATORY (2026-10-02) — the same rules as the form,
  // lib/customers/ship-to-rules.ts: address 10+ chars, at least one receiver
  // with a 2+ char name AND a 10-digit mobile, partly filled extra rows refused.
  const address = (body.address ?? "").trim();
  if (address.length < MIN_ADDRESS) {
    return NextResponse.json({ error: `Site address is required (at least ${MIN_ADDRESS} characters).` }, { status: 400 });
  }
  const receiverCheck = checkReceivers(body.receivers.map((r) => ({ name: r.name, phone: r.phone ?? "" })));
  if (receiverCheck.message !== null) {
    return NextResponse.json({ error: receiverCheck.message.replace(/ to save.$/, ".") }, { status: 400 });
  }
  const rows = receiverCheck.rows;

  // The sales person must exist, be active and HAVE A PHONE in the master
  // (the challan prints it). The form never edits the SO master.
  const so = await prisma.sales_officer_master.findFirst({
    where:  { id: body.salesOfficerId, isActive: true },
    select: { phone: true },
  });
  if (!so) return NextResponse.json({ error: "Pick an active sales person." }, { status: 400 });
  if (!so.phone || so.phone.trim() === "") return NextResponse.json({ error: SO_NO_PHONE }, { status: 400 });

  // Lookups — readable 400s before any write.
  const area = await prisma.area_master.findFirst({
    where:  { id: body.areaId, isActive: true },
    select: { id: true, name: true, deliveryType: { select: { name: true } }, primaryRoute: { select: { name: true } } },
  });
  if (!area) return NextResponse.json({ error: "Pick an active area." }, { status: 400 });

  const existing = await prisma.delivery_point_master.findUnique({ where: { customerCode }, select: { customerName: true } });
  if (existing) {
    return NextResponse.json({ error: `Ship-to ${customerCode} is already in the customer master (${existing.customerName}).` }, { status: 400 });
  }

  let receiverRoleId: number | null = null;
  if (rows.length > 0) {
    const roleRows = await prisma.contact_role_master.findMany({
      where:  { isActive: true, name: { in: ["Receiver", "Site Engineer"], mode: "insensitive" } },
      select: { id: true, name: true },
    });
    receiverRoleId =
      roleRows.find((r) => r.name.toLowerCase() === "receiver")?.id ??
      roleRows.find((r) => r.name.toLowerCase() === "site engineer")?.id ??
      null;
  }

  // a + b + c — the shared create core (same as the admin POST).
  let created;
  try {
    created = await createCustomer({
      data: {
        customerCode,
        customerName:           body.customerName,
        address,
        areaId:                 area.id,
        // "Use area default" — the admin form writes NULL for both.
        primaryRouteId:         null,
        dispatchDeliveryTypeId: null,
        noDeliveryDays:         [],
      },
      // The first receiver is listed first and flagged primary; SoSync's
      // primary-contact rule then hands primary to the PRIMARY sales officer's
      // contact (it does that on every admin save too).
      contacts: rows.map((r, i) => ({
        name:          r.name,
        phone:         r.phone,
        isPrimary:     i === 0,
        contactRoleId: receiverRoleId,
      })),
      salesOfficers:      [{ salesOfficerId: body.salesOfficerId, role: "PRIMARY" }],
      dismissalsToToggle: [],
      include:            {},
      wrapCreateInTransaction: false,
    });
  } catch (err) {
    if (err instanceof SoSyncValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[tint ship-to/create] customer create failed", err);
    return NextResponse.json({ error: "Could not save the ship-to — nothing was added. Try again." }, { status: 500 });
  }
  if (created.kind === "exists") {
    return NextResponse.json({ error: `Ship-to ${customerCode} is already in the customer master.` }, { status: 400 });
  }

  const warnings: string[] = [];

  // d — order-entry search row, only if no row has this code yet.
  try {
    const kw = await prisma.mo_customer_keywords.findFirst({ where: { customerCode }, select: { id: true } });
    if (!kw) {
      await prisma.mo_customer_keywords.create({
        data: {
          customerCode,
          customerName: body.customerName,
          area:         area.name.toUpperCase(),
          deliveryType: keywordDeliveryType(area.deliveryType?.name),
          route:        area.primaryRoute?.name.toUpperCase() ?? null,
          keyword:      body.customerName,
        },
      });
    }
  } catch (err) {
    console.error("[tint ship-to/create] keyword insert failed", err);
    warnings.push("Saved, but it could not be added to order-entry search (/po). Ask admin to add it.");
  }

  await logAdminAction({
    userId:   parseInt(session.user.id, 10),
    entity:   "customers",
    entityId: String(created.customer.id),
    action:   "create",
    summary:
      `${customerCode} — ${created.customer.customerName} (Tint Manager · Add ship-to)` +
      (created.ordersBackfilled > 0 ? `; linked ${created.ordersBackfilled} orphan order(s)` : ""),
    after: {
      customerCode,
      customerName:     created.customer.customerName,
      areaId:           created.customer.areaId,
      salesOfficerId:   body.salesOfficerId,
      receivers:        rows.length,
      ordersBackfilled: created.ordersBackfilled,
    },
  });

  return NextResponse.json({
    customerCode,
    customerName: created.customer.customerName,
    billsUpdated: created.ordersBackfilled,
    warnings,
  }, { status: 201 });
}
