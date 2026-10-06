// lib/customers/sales-officer.ts
//
// WHOSE BILL IS IT — the Sales Officer, from either of its two sources.
// Pure: no prisma, no clock, no React. Callers do the reads.
//
// 1. CUSTOMER MASTER — the delivery challan's cascade, moved here VERBATIM from
//    app/api/tint/manager/challans/[orderId]/route.ts (2026-10-06) so the
//    challan, the Floor table and the Floor detail panel can never name two
//    different people for one bill. Locked order, on the SHIP-TO delivery point
//    (the redirect target when there is one — the caller decides that):
//      a. Primary SO link — customer_sales_officers, role PRIMARY,
//         contactDismissed = false (filtered by the select)
//      b. salesOfficerGroup.salesOfficer — legacy. ⚠ 0 rows live 2026-10-06
//         (sales_officer_group is empty); kept because the challan reads it
//      c. the first ship-to contact (id asc) whose role is "Sales Officer"
//      d. null
//    No sales_officer_master.isActive filter — the challan never had one.
//
// 2. THE MAIL ORDER — free-text mo_orders.soName. There is no id link from a
//    mail order to sales_officer_master (soEmail is never written by the
//    parser), so this is a name, displayed through displaySoName.

import { displaySoName } from "@/lib/mail-orders/utils";

/** The delivery_point_master select the cascade reads. Spread it into a
 *  ship-to select. `contacts` is the challan's own contacts select (oldest
 *  first, with isPrimary + role) because the challan's SITE-RECEIVER cascade
 *  reads the same list — one read, two cascades. */
export const SO_CASCADE_SELECT = {
  salesOfficerGroup: {
    select: {
      salesOfficer: { select: { name: true, phone: true } },
    },
  },
  salesOfficerLinks: {
    where:  { role: "PRIMARY" as const, contactDismissed: false },
    take:   1,
    select: {
      salesOfficer: { select: { name: true, phone: true } },
    },
  },
  // Oldest first (2026-10-02) — the first receiver entered prints.
  contacts: {
    orderBy: { id: "asc" as const },
    select: {
      name:        true,
      phone:       true,
      isPrimary:   true,
      contactRole: { select: { name: true } },
    },
  },
} as const;

type SoPerson = { name: string; phone: string | null };

/** The minimum a delivery point must carry for the cascade — what
 *  SO_CASCADE_SELECT returns. */
export interface SoCascadePoint {
  salesOfficerLinks: Array<{ salesOfficer: SoPerson }>;
  salesOfficerGroup: { salesOfficer: SoPerson } | null;
  contacts: Array<{ name: string; phone: string | null; contactRole: { name: string } | null }>;
}

/** The challan's Sales Officer cascade (see the header). */
export function resolveSalesOfficer(
  point: SoCascadePoint | null | undefined,
): { name: string; phone: string | null } | null {
  // a. Primary SO from customer_sales_officers. contactDismissed=true rows are
  //    filtered out by the select's where — falls through to b in that case.
  const fromPrimary = point?.salesOfficerLinks?.[0]?.salesOfficer;
  if (fromPrimary) {
    return { name: fromPrimary.name, phone: fromPrimary.phone ?? null };
  }
  // b. salesOfficerGroup.salesOfficer (legacy fallback).
  const fromGroup = point?.salesOfficerGroup?.salesOfficer;
  if (fromGroup) {
    return { name: fromGroup.name, phone: fromGroup.phone ?? null };
  }
  // c. Ship-to contact with contactRole.name === "Sales Officer".
  const fromContact = point?.contacts.find(
    (c) => c.contactRole?.name === "Sales Officer",
  );
  if (fromContact) {
    return { name: fromContact.name, phone: fromContact.phone ?? null };
  }
  // d. null.
  return null;
}

/** Depot mailboxes that forward orders and so land in mo_orders.soName in
 *  place of a person (≈6.5% of mail orders, 30 days to 2026-10-06). Matched
 *  case-insensitively AFTER displaySoName. Shown as "Telecaller" (owner). */
export const TELECALLER_MAILBOX_NAMES: readonly string[] = [
  "Surat Akzonobel",
  "Surat Depot",
  "Surat Order",
];

export const TELECALLER_LABEL = "Telecaller";

const TELECALLER_SET = new Set(TELECALLER_MAILBOX_NAMES.map((n) => n.toLowerCase()));

/** A mail order's SO as the Floor shows it: the display name, or the
 *  Telecaller label for a depot mailbox. Null for an empty name. */
export function mailOrderSalesOfficer(
  soName: string | null | undefined,
): { name: string; source: "mail" | "telecaller" } | null {
  if (!soName) return null;
  const name = displaySoName(soName);
  if (!name) return null;
  if (TELECALLER_SET.has(name.toLowerCase())) {
    return { name: TELECALLER_LABEL, source: "telecaller" };
  }
  return { name, source: "mail" };
}
