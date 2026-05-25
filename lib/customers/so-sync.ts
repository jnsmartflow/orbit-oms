// lib/customers/so-sync.ts
// Phase 2 of 8 — multi-SO + Contacts auto-sync.
//
// Five helpers wired into POST /api/admin/customers and
// PATCH /api/admin/customers/[id]. Order at call site (B before any
// write, then A → F → C → D → E):
//
//   B  validateIncomingSalesOfficers
//   A  (caller: existing customer + contacts save — not in this file)
//   F  applyDismissalToggles
//   C  reconcileCustomerSalesOfficers
//   D  syncSalesOfficerContacts
//   E  enforcePrimaryContactRule
//
// LEGACY salesOfficerId on delivery_point_master:
//   The direct delivery_point_master.salesOfficerId column is now
//   write-ignored by the admin customer routes. GET still returns it
//   (scalar field) for backward compat. Phase 8 will drop the column
//   entirely once all consumers (TM cards, challan cascade, sampling
//   library fallback) are switched to read from customer_sales_officers.
//
// All operations use sequential awaits on the passed `db` parameter.
// No prisma.$transaction calls (CORE §3).

import type { PrismaClient, Prisma } from "@prisma/client";
import { CustomerSalesOfficerRole } from "@prisma/client";

// contact_role_master.id for "Sales Officer".
// Confirmed in Supabase; admin UI never edits this row.
// If contact_role_master is reseeded, update this constant.
const SALES_OFFICER_ROLE_ID = 5;

export type Db = PrismaClient | Prisma.TransactionClient;

export interface IncomingSalesOfficer {
  salesOfficerId: number;
  role: CustomerSalesOfficerRole;
}

export interface DismissalToggle {
  salesOfficerId: number;
  dismissed: boolean;
}

export class SoSyncValidationError extends Error {
  status: number;
  field: string;
  constructor(message: string, field: string) {
    super(message);
    this.name = "SoSyncValidationError";
    this.status = 400;
    this.field = field;
  }
}

// ── Stage B ────────────────────────────────────────────────────────────
// Sync + DB validation. Throws SoSyncValidationError on any failure.
// Run BEFORE any DB writes — a failure here leaves the customer record
// untouched.

export async function validateIncomingSalesOfficers(
  incoming: IncomingSalesOfficer[],
  db: Db,
): Promise<void> {
  if (incoming.length === 0) return;

  const seen = new Set<number>();
  let primaryCount = 0;

  for (const entry of incoming) {
    if (seen.has(entry.salesOfficerId)) {
      throw new SoSyncValidationError(
        "Duplicate sales officer in list",
        "salesOfficers",
      );
    }
    seen.add(entry.salesOfficerId);
    if (entry.role === CustomerSalesOfficerRole.PRIMARY) primaryCount++;
  }

  if (primaryCount > 1) {
    throw new SoSyncValidationError(
      "Only one PRIMARY sales officer allowed",
      "salesOfficers",
    );
  }

  // Zero PRIMARY entries is intentionally allowed.

  const ids = Array.from(seen);
  const existing = await db.sales_officer_master.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((r) => r.id));
  const missing = ids.filter((id) => !existingIds.has(id));
  if (missing.length > 0) {
    throw new SoSyncValidationError(
      `Unknown salesOfficerId(s): [${missing.join(", ")}]`,
      "salesOfficers",
    );
  }
}

// ── Stage F ────────────────────────────────────────────────────────────
// Flip contactDismissed on existing customer_sales_officers rows.
// When dismissing, also hard-delete the linked auto-contact so the UI
// sees immediate removal. Undismissing only clears the flag — Stage D
// recreates the contact on this same request.

export async function applyDismissalToggles(
  customerId: number,
  toggles: DismissalToggle[],
  db: Db,
): Promise<void> {
  if (toggles.length === 0) return;

  for (const toggle of toggles) {
    await db.customer_sales_officers.updateMany({
      where: { customerId, salesOfficerId: toggle.salesOfficerId },
      data: { contactDismissed: toggle.dismissed },
    });

    if (toggle.dismissed) {
      await db.delivery_point_contacts.deleteMany({
        where: {
          deliveryPointId: customerId,
          linkedSalesOfficerId: toggle.salesOfficerId,
        },
      });
    }
  }
}

// ── Stage C ────────────────────────────────────────────────────────────
// Reconcile customer_sales_officers rows against incoming list.
// Inserts new SOs, updates role on existing, deletes removed SOs
// (and their linked auto-contacts).

export async function reconcileCustomerSalesOfficers(
  customerId: number,
  incoming: IncomingSalesOfficer[],
  db: Db,
): Promise<void> {
  const currentRows = await db.customer_sales_officers.findMany({
    where: { customerId },
    select: { id: true, salesOfficerId: true, role: true },
  });

  const currentBySoId = new Map(
    currentRows.map((row) => [row.salesOfficerId, row] as const),
  );
  const incomingBySoId = new Map(
    incoming.map((entry) => [entry.salesOfficerId, entry] as const),
  );

  // Pre-clear: bulk-demote every current PRIMARY for this customer to BACKUP
  // BEFORE the main upsert loop runs. Without this, a save that swaps the
  // Primary (either A→B in-list, or removes A + creates B) would briefly hold
  // two PRIMARY rows mid-reconcile and trip the partial unique index
  // "customer_sales_officers_customerId_primary_key" → Prisma P2002.
  // The actual Primary (if any) is re-promoted unconditionally in the main
  // loop below; the delete pass removes any leftover demoted rows whose SO
  // isn't in incoming.
  await db.customer_sales_officers.updateMany({
    where: { customerId, role: CustomerSalesOfficerRole.PRIMARY },
    data:  { role: CustomerSalesOfficerRole.BACKUP },
  });

  // Inserts + updates.
  // Note: we UPDATE existing rows unconditionally (no `current.role !== entry.role`
  // check) because the pre-clear above leaves the in-memory currentBySoId cache
  // stale for any row that was PRIMARY. Unconditional updates are idempotent at
  // the DB level and avoid a silent "stay-demoted" bug.
  for (const entry of incoming) {
    const current = currentBySoId.get(entry.salesOfficerId);
    if (!current) {
      await db.customer_sales_officers.create({
        data: {
          customerId,
          salesOfficerId: entry.salesOfficerId,
          role: entry.role,
          contactDismissed: false,
        },
      });
    } else {
      await db.customer_sales_officers.update({
        where: { id: current.id },
        data:  { role: entry.role },
      });
    }
  }

  // Deletes — linked contact first, then link row.
  // linkedSalesOfficerId has ON DELETE SET NULL (not CASCADE), so without
  // explicit cleanup the contact would survive as an orphan.
  for (const row of currentRows) {
    if (incomingBySoId.has(row.salesOfficerId)) continue;
    await db.delivery_point_contacts.deleteMany({
      where: {
        deliveryPointId: customerId,
        linkedSalesOfficerId: row.salesOfficerId,
      },
    });
    await db.customer_sales_officers.delete({
      where: { id: row.id },
    });
  }
}

// ── Stage D ────────────────────────────────────────────────────────────
// Refresh-or-create the auto-contact for each non-dismissed SO link.
// Update path only touches name + phone (refresh from SO master).
// Operator-owned fields (email, isPrimary, contactRoleId) are preserved.

export async function syncSalesOfficerContacts(
  customerId: number,
  db: Db,
): Promise<void> {
  const links = await db.customer_sales_officers.findMany({
    where: { customerId },
    include: {
      salesOfficer: { select: { id: true, name: true, phone: true } },
    },
  });

  for (const link of links) {
    if (link.contactDismissed) continue;

    const existing = await db.delivery_point_contacts.findFirst({
      where: {
        deliveryPointId: customerId,
        linkedSalesOfficerId: link.salesOfficerId,
      },
      select: { id: true },
    });

    if (existing) {
      await db.delivery_point_contacts.update({
        where: { id: existing.id },
        data: {
          name: link.salesOfficer.name,
          phone: link.salesOfficer.phone,
        },
      });
    } else {
      await db.delivery_point_contacts.create({
        data: {
          deliveryPointId: customerId,
          name: link.salesOfficer.name,
          phone: link.salesOfficer.phone,
          contactRoleId: SALES_OFFICER_ROLE_ID,
          linkedSalesOfficerId: link.salesOfficerId,
          isPrimary: false,
        },
      });
    }
  }
}

// ── Stage E ────────────────────────────────────────────────────────────
// PRIMARY SO's contact owns isPrimary=true on the customer.
// Branch A: PRIMARY exists AND not dismissed → force isPrimary on its
//           contact, clear on all others.
// Branch B: no PRIMARY, OR PRIMARY is dismissed → true no-op. Operator
//           preference wins; we don't touch isPrimary on any contact.

export async function enforcePrimaryContactRule(
  customerId: number,
  db: Db,
): Promise<void> {
  const primaryLink = await db.customer_sales_officers.findFirst({
    where: {
      customerId,
      role: CustomerSalesOfficerRole.PRIMARY,
      contactDismissed: false,
    },
    select: { salesOfficerId: true },
  });

  if (!primaryLink) return;

  const primaryContact = await db.delivery_point_contacts.findFirst({
    where: {
      deliveryPointId: customerId,
      linkedSalesOfficerId: primaryLink.salesOfficerId,
    },
    select: { id: true },
  });

  if (!primaryContact) return;

  await db.delivery_point_contacts.updateMany({
    where: {
      deliveryPointId: customerId,
      NOT: { id: primaryContact.id },
    },
    data: { isPrimary: false },
  });

  await db.delivery_point_contacts.update({
    where: { id: primaryContact.id },
    data: { isPrimary: true },
  });
}
