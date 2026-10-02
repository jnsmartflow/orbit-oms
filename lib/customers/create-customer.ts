// lib/customers/create-customer.ts — the customer-create core, shared (2026-10-02).
//
// EXTRACTED VERBATIM from POST /api/admin/customers so the admin Customers page
// and the Tint Manager's "Add ship-to" form create a customer the SAME way:
//   Stage B  validate the incoming sales officers (before any write);
//   409      refuse a customerCode that already exists;
//   Stage A  create delivery_point_master (+ nested contacts);
//   F → C → D → E  dismissal toggles, sales-officer links, SO contact sync,
//            primary-contact rule (lib/customers/so-sync.ts);
//   backfill every orphan order with this ship-to code: customerMissing → false,
//            customerId → the new row (orders.customerId IS NULL only);
//   re-fetch the row with `include`.
// The audit line stays in each route (it needs the session and its own wording).
//
// ⚠ `wrapCreateInTransaction`: the admin route's Stage A has always run inside a
// `prisma.$transaction` (kept verbatim there per the CORE §3 landmine policy) —
// it passes true and is unchanged. New callers pass false (CORE §3: no
// $transaction): a single nested create is still one statement.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  validateIncomingSalesOfficers,
  applyDismissalToggles,
  reconcileCustomerSalesOfficers,
  syncSalesOfficerContacts,
  enforcePrimaryContactRule,
  type IncomingSalesOfficer,
  type DismissalToggle,
} from "@/lib/customers/so-sync";

export interface CreateCustomerContact {
  name:                 string;
  phone?:               string | null;
  email?:               string | null;
  isPrimary:            boolean;
  contactRoleId?:       number | null;
  linkedSalesOfficerId?: number | null;
}

/** The master scalars — the admin createSchema's fields minus contacts / SO arrays. */
export type CreateCustomerData = Omit<Prisma.delivery_point_masterUncheckedCreateInput, "contacts" | "customerCode"> & {
  customerCode: string;
};

export interface CreateCustomerInput {
  data:               CreateCustomerData;
  contacts:           CreateCustomerContact[];
  salesOfficers:      IncomingSalesOfficer[];
  dismissalsToToggle: DismissalToggle[];
  /** `include` for the returned row (the admin route passes its fullInclude). */
  include:            Prisma.delivery_point_masterInclude;
  /** True only for the admin route (its pre-existing wrapper). */
  wrapCreateInTransaction: boolean;
}

export type CreateCustomerResult =
  | { kind: "exists" }
  | {
      kind:              "created";
      customerCode:      string;
      customer:          { id: number; customerName: string; areaId: number; subAreaId: number | null; isActive: boolean };
      /** The re-fetched row (with `include`). */
      finalCustomer:     unknown;
      contactsCreated:   number;
      ordersBackfilled:  number;
    };

/**
 * Create one customer. Throws SoSyncValidationError (Stage B) BEFORE any write;
 * any later error propagates to the caller.
 */
export async function createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult> {
  const { contacts, salesOfficers, dismissalsToToggle, include } = input;
  const data = input.data;
  const customerCode = data.customerCode.trim().toUpperCase();

  // Stage B — validate FIRST, before any DB writes.
  // A validation failure here leaves the DB untouched.
  await validateIncomingSalesOfficers(salesOfficers, prisma);

  const existing = await prisma.delivery_point_master.findUnique({ where: { customerCode } });
  if (existing) return { kind: "exists" };

  // Strip contact-level linkedSalesOfficerId from the nested-create payload.
  // Stage D owns that field; on initial create there are no SO links yet,
  // so any value here would be stale/spurious.
  const contactsForCreate = contacts.map(({ linkedSalesOfficerId: _ignored, ...rest }) => rest);

  const createArgs = {
    data: {
      ...data,
      customerCode,
      ...(contactsForCreate.length > 0 && { contacts: { create: contactsForCreate } }),
    },
    include,
  };

  // Stage A — customer + contacts save. The admin route keeps its pre-existing
  // $transaction wrapper verbatim (CORE §3 landmine policy); new callers do not.
  const customer = input.wrapCreateInTransaction
    ? await prisma.$transaction(async (tx) => tx.delivery_point_master.create(createArgs))
    : await prisma.delivery_point_master.create(createArgs);

  // Stages F → C → D → E — multi-SO + Contacts sync.
  await applyDismissalToggles(customer.id, dismissalsToToggle, prisma);
  await reconcileCustomerSalesOfficers(customer.id, salesOfficers, prisma);
  await syncSalesOfficerContacts(customer.id, prisma);
  await enforcePrimaryContactRule(customer.id, prisma);

  // customerMissing backfill (Finding 2 — preserved untouched). The result is
  // KEPT: creating a customer silently re-parents every orphan order carrying
  // this code, and that is the part a reader of the log would otherwise miss.
  const backfill = await prisma.orders.updateMany({
    where: { shipToCustomerId: customerCode, customerId: null },
    data:  { customerMissing: false, customerId: customer.id },
  });

  // Re-fetch so the response reflects synced SO links + refreshed contacts.
  const finalCustomer = await prisma.delivery_point_master.findUnique({
    where: { id: customer.id },
    include,
  });

  return {
    kind: "created",
    customerCode,
    customer: {
      id:           customer.id,
      customerName: customer.customerName,
      areaId:       customer.areaId,
      subAreaId:    customer.subAreaId,
      isActive:     customer.isActive,
    },
    finalCustomer,
    contactsCreated:  contactsForCreate.length,
    ordersBackfilled: backfill.count,
  };
}
