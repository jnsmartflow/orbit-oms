// lib/floor/sales-officer.ts
//
// FLOOR'S OWN COPY of the customer-master SO cascade (2026-10-10).
//
// The delivery challan's cascade lives in lib/customers/sales-officer.ts
// (SO_CASCADE_SELECT + resolveSalesOfficer) and prints the FULL master name.
// 🔴 That file is challan-owned and must not change: Delivery Challans are
//    EXCLUDED from the short-name rule by owner (2026-10-10). Floor needs two
//    more facts per master row — its id and "displayName" — so Floor keeps
//    this copy instead of widening the challan's select.
//
// The ARM ORDER is the challan's, verbatim, so Floor and the challan still
// name the same PERSON for a bill; only how the name is shown differs:
//   a. Primary SO link — customer_sales_officers, role PRIMARY,
//      contactDismissed = false
//   b. salesOfficerGroup.salesOfficer — legacy
//   c. the first ship-to contact (id asc) whose role is "Sales Officer"
//      (free text — the caller runs it through lib/sales-officer/resolve.ts)
//   d. null
//
// Pure: no prisma, no clock. The caller does the read.

const FLOOR_SO_PERSON_SELECT = {
  select: { id: true, name: true, displayName: true, phone: true },
} as const;

/** Spread into a delivery_point_master select. */
export const FLOOR_SO_CASCADE_SELECT = {
  salesOfficerGroup: {
    select: { salesOfficer: FLOOR_SO_PERSON_SELECT },
  },
  salesOfficerLinks: {
    where: { role: "PRIMARY" as const, contactDismissed: false },
    take: 1,
    select: { salesOfficer: FLOOR_SO_PERSON_SELECT },
  },
  contacts: {
    orderBy: { id: "asc" as const },
    select: {
      name: true,
      phone: true,
      contactRole: { select: { name: true } },
    },
  },
} as const;

export interface FloorSoMaster {
  id: number;
  name: string;
  displayName: string | null;
  phone: string | null;
}

export interface FloorSoCascadePoint {
  salesOfficerLinks: Array<{ salesOfficer: FloorSoMaster }>;
  salesOfficerGroup: { salesOfficer: FloorSoMaster } | null;
  contacts: Array<{ name: string; phone: string | null; contactRole: { name: string } | null }>;
}

export type FloorSoCascadeHit =
  | { kind: "master"; master: FloorSoMaster }
  | { kind: "contact"; name: string; phone: string | null }
  | null;

/** The challan's arm order (see the header), on Floor's wider select. */
export function floorSoCascade(point: FloorSoCascadePoint | null | undefined): FloorSoCascadeHit {
  const fromPrimary = point?.salesOfficerLinks?.[0]?.salesOfficer;
  if (fromPrimary) return { kind: "master", master: fromPrimary };
  const fromGroup = point?.salesOfficerGroup?.salesOfficer;
  if (fromGroup) return { kind: "master", master: fromGroup };
  const fromContact = point?.contacts.find((c) => c.contactRole?.name === "Sales Officer");
  if (fromContact) return { kind: "contact", name: fromContact.name, phone: fromContact.phone ?? null };
  return null;
}

/** How a master row is SHOWN: "displayName", else the full name. */
export function masterShownName(m: { name: string; displayName: string | null }): string {
  const d = m.displayName?.trim();
  return d ? d : m.name;
}
