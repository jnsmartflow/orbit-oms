# Planning Update — Challan contact resolution cascade canonised
Session date: 2026-04-22
Session type: design / architecture
Target files: docs/CLAUDE_TINT.md §4 (Delivery Challan), §8 (Pending items)
Implementation status: implemented (commit aab7885d on main)

## DECISION SUMMARY
Challan S5 three-column contact resolution (CUSTOMER / SALES OFFICER / SITE-RECEIVER) is now governed by explicit cascade logic in the detail API, not by narrow role whitelists. Primary-contact flag, role whitelist, and first-contact fallback are applied in that order. Sales officer has a two-source cascade: formal `salesOfficerGroup.salesOfficer` first, then contact with role = "Sales Officer" as fallback. Phone numbers render on a second line below the name in mono font-size 10 gray. Narrow whitelist approach (Owner/Manager only for Bill-To, Site Engineer/Contractor only for Ship-To) is rejected — too brittle for real-world customer master data.

## CONTEXT CHANGES
- Challan CUSTOMER column sources from Bill-To `delivery_point_contacts` via cascade: `isPrimary === true` → role in `[Owner, Manager, Proprietor, Partner, Director]` → first contact → null.
- Challan SITE / RECEIVER column sources from Ship-To contacts via cascade: `isPrimary AND role ≠ Sales Officer` → role in `[Site Engineer, Contractor, Supervisor]` → first non-Sales-Officer contact → null.
- Challan SALES OFFICER column uses two-source cascade: formal `delivery_point_master.salesOfficerGroupId → sales_officer_group.salesOfficer` first, then contact where `contactRole.name === "Sales Officer"` on the Ship-To customer.
- Blank CUSTOMER/SALES OFFICER/SITE columns are valid output when underlying customer master has no matching data — not a rendering bug. Code should not invent values.
- Phone rendering standard across challan S5: two-line format, name on top in `#374151` fontSize 11, phone below in mono `#6b7280` fontSize 10 marginTop 1. Matches existing Customer Code / Ship-to Code / OBD No. styling.
- Contact role whitelists are now encoded constants in the detail route, not scattered magic strings. Future role additions require editing the `OWNER_ROLES` and `SITE_ROLES` arrays.

## NEW PENDING ITEMS
- PATCH handler `prisma.$transaction` refactor | Claude Code | route.ts line 429, pre-existing violation of `CORE §3`. Must become sequential awaits. Formula upserts are idempotent so partial-failure semantics are acceptable.
- Customer master completeness view | Chandresh / admin / future prompt | Admin-level report flagging customers missing contacts, salesOfficerGroup, or address — operational visibility into data gaps exposed by challan blanks.
- Seed Bill-To contacts for SHREE RANG SAROVAR (102359) and similar Bill-To customers missing any contact | depot team / admin UI | Low priority, data task not code task.

## SUPERSEDED DECISIONS
- Previous narrow-whitelist approach in `challans/[orderId]/route.ts` (roles Owner/Manager for Bill-To, Site Engineer/Contractor for Ship-To) is superseded. See commit aab7885d.
- Previous single-source sales officer lookup (salesOfficerGroup only) is superseded by the two-source cascade.

## PROMPTS DRAFTED FOR CLAUDE CODE
- PATCH handler `$transaction` refactor — not yet drafted. When picked up: scope to `challans/[orderId]/route.ts` PATCH only, convert `prisma.$transaction` block to sequential awaits, preserve existing upsert semantics, verify `tsc --noEmit`, single commit.

## CONSOLIDATION NOTES
- `docs/CLAUDE_TINT.md §4.4` — append contact cascade rules. After the Bill To / Ship To description add a subsection "S5 contact cascade" documenting the three cascades (Bill-To contact, Ship-To site contact, Sales Officer). Reference whitelists explicitly.
- `docs/CLAUDE_TINT.md §4.4` — note phone render standard (two lines, mono 10px #6b7280) as part of document spec.
- `docs/CLAUDE_TINT.md §8` — add pending item: "PATCH handler $transaction refactor (route.ts line 429)."
- `docs/CLAUDE_UI.md §46` — note that Challan S5 columns render name + phone (mono) when contact exists, blank `<div height:20>` fallback otherwise.
- `docs/CLAUDE_CORE.md §15` — no change needed; this is module-specific.
