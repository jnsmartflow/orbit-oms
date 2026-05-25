// lib/customers/resolve-linked-so.ts
// Pure helper used by every customer form that renders auto-linked contacts.
//
// Given a contact draft, the form's current salesOfficers state, and the
// SO master option list, returns the info ContactCard needs to render the
// auto branch — or null if this contact is manual or its link is orphaned.

import type {
  ContactDraft,
  SalesOfficerLink,
  SalesOfficerOption,
  SalesOfficerRole,
} from "@/components/admin/customer-sheet";

export interface LinkedSOInfo {
  name:  string;
  phone: string | null;
  role:  SalesOfficerRole;
}

export function resolveLinkedSO(
  contact:       ContactDraft,
  salesOfficers: SalesOfficerLink[],
  options:       SalesOfficerOption[],
): LinkedSOInfo | null {
  if (contact.linkedSalesOfficerId == null) return null;
  const link = salesOfficers.find((s) => s.salesOfficerId === contact.linkedSalesOfficerId);
  if (!link) return null;
  const master = options.find((o) => o.id === contact.linkedSalesOfficerId);
  if (!master) return null;
  return { name: master.name, phone: master.phone, role: link.role };
}
