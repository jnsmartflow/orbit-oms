# Context Update v65

## MODIFIED FILES

- `lib/mail-orders/email-template.ts` — Slot summary email wording overhaul: subject-consistent header, revised opening/footer/sign-off, hardcoded depot phone, Billing Team designation
- `app/(mail-orders)/mail-orders/slot-completion-modal.tsx` — Subject line format updated

## BUSINESS RULES ADDED

**Slot summary email wording (locked):**

- **Subject line:** `${slotName} Orders — ${date} | JSW Dulux Surat` (e.g. "Morning Orders — 11 Apr 2026 | JSW Dulux Surat"). No brackets, no "Slot Summary".
- **Email header title:** `${slotName} Order Summary` (not "Slot Summary" — "Slot" is internal language).
- **Opening line:** `Please find your ${slotName} slot order summary below.`
- **Pending note:** `These orders will be processed in tomorrow's first slot. We will keep you updated.`
- **Footer line 1:** `Kindly note the order numbers for any future communication regarding these orders.` — Order numbers are for SO↔depot communication, NOT for dealer tracking.
- **Footer line 2:** `For any order-related queries, feel free to reach out to us.`
- **Sign-off:** `Thanks & regards,` (encoded as `&amp;` in HTML) with 14px top padding for visual gap.
- **Designation:** `Billing Team` (not Billing Desk/Department).
- **Phone:** Hardcoded `+91 7435065023` — depot number, same for all operators. `senderPhone` parameter kept in function signature for backward compat but ignored in output.
- **Bottom footer:** `JSW Dulux Ltd — Surat Depot · Do not reply to this email`

**Terminology rule:** "SO number" / "order number" in email context = SAP sale order number. Used for SO↔depot communication only. Dealers receive invoices, not order numbers.

## CHECKLIST UPDATES

- **Slot email subject:** `${slotName} Orders — ${date} | JSW Dulux Surat`. Constructed in `slot-completion-modal.tsx`.
- **Depot phone hardcoded:** `+91 7435065023` in email-template.ts. Do not use `senderPhone` param for output.
- **Email sign-off designation:** "Billing Team" — not Desk/Department.
