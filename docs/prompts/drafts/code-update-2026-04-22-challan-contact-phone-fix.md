# Context Update v75 — Challan S5 contact cascade + phone rendering
Session date: 2026-04-22
Target files: CLAUDE_TINT.md §4 (Delivery Challan), §8 (Pending items); CLAUDE_UI.md §46 (Challan document)

## SCHEMA CHANGES
None.

## NEW/MODIFIED FILES

| File | Purpose |
|---|---|
| `app/api/tint/manager/challans/[orderId]/route.ts` | GET handler — adds `isPrimary` to all three `contacts` select blocks; replaces narrow role whitelist with explicit cascade for Bill-To contact, Ship-To site contact, and Sales Officer. |
| `components/tint/challan-document.tsx` | S5 three-column block (Customer / Sales Officer / Site-Receiver) renders phone number on second line below name when present. |

## BUSINESS RULES ADDED

- **Bill-To contact cascade** (CUSTOMER column on challan): `isPrimary === true` → `contactRole.name ∈ {Owner, Manager, Proprietor, Partner, Director}` → first contact in array → null. Applied in `delivery_point_contacts` lookup on the Bill-To delivery point.
- **Ship-To site contact cascade** (SITE / RECEIVER column): `isPrimary === true AND contactRole.name ≠ "Sales Officer"` → `contactRole.name ∈ {Site Engineer, Contractor, Supervisor}` → first contact with role ≠ "Sales Officer" → null.
- **Sales Officer cascade** (SALES OFFICER column): `delivery_point_master.salesOfficerGroupId → sales_officer_group.salesOfficer` → contact on Ship-To where `contactRole.name === "Sales Officer"` → null. Previously only the formal `salesOfficerGroup` path was read.
- **Phone render standard on challan S5**: when a contact resolves, name renders on line 1 (`fontSize 11, color #374151, marginTop 3`), phone on line 2 (`fontSize 10, color #6b7280, marginTop 1, fontFamily SF Mono`). If no contact, fallback `<div height:20>` preserves row height. Same pattern across all three S5 columns.
- **`isPrimary` is always selected** on the `delivery_point_contacts` join in the challan detail API (all three select blocks — billToPoint, shipToPoint, and the codesAreIdentical duplicate fetch).
- **Blank S5 columns are valid** when customer master has no matching contact — not a rendering bug. API returns `null`, render uses empty height-20 div, no placeholder text.

## BUSINESS RULES CHANGED / SUPERSEDED

- Previous filter "roles `Owner` or `Manager` only" for Bill-To contact (`CLAUDE_TINT.md §4.4` implicit) is superseded by the cascade above. Commit `aab7885d`.
- Previous filter "roles `Site Engineer` or `Contractor` only" for Ship-To site contact is superseded by the cascade above. Commit `aab7885d`.
- Previous single-source sales officer (`salesOfficerGroup.salesOfficer` only) is superseded by the two-source cascade. Commit `aab7885d`.
- Previous S5 render (name-only, no phone) is superseded. Commit `aab7885d`.

## PENDING ITEMS

- **PATCH handler `prisma.$transaction` refactor** — `app/api/tint/manager/challans/[orderId]/route.ts` line ~429 uses `prisma.$transaction`, violating `CORE §3`. Pre-existing, not introduced this session, left untouched per scope. Convert to sequential awaits later. Formula upserts are idempotent, partial-failure acceptable.
- **Customer master completeness report** — admin view flagging customers missing contacts, `salesOfficerGroup`, or address. Operational visibility into data gaps exposed by challan blanks.
- **Seed Bill-To contacts** for SHREE RANG SAROVAR (102359) and similar Bill-To customers with no contacts. Data task, not code.

Pending from previous drafts — status unchanged this session:
- Challan lazy creation removal verification (`CLAUDE_TINT.md §8`) — not addressed.
- Challan print CSS verification (old class names `ch-header`, `tint-yes`) — not addressed.

## CONSOLIDATION NOTES

- `docs/CLAUDE_TINT.md §4.4` — append new subsection "S5 contact cascade" documenting the three cascades (Bill-To contact, Ship-To site contact, Sales Officer). Encode role whitelists as explicit lists: `OWNER_ROLES = [Owner, Manager, Proprietor, Partner, Director]`, `SITE_ROLES = [Site Engineer, Contractor, Supervisor]`.
- `docs/CLAUDE_TINT.md §4.4` — add phone render standard line: "S5 phone rendering: mono 10px `#6b7280`, marginTop 1, below name."
- `docs/CLAUDE_TINT.md §8` — add pending: "PATCH handler `$transaction` refactor (`route.ts` line 429)."
- `docs/CLAUDE_UI.md §46` — add line to Challan document spec: "S5 columns render name (11px `#374151`) + phone (mono 10px `#6b7280`) on two lines when contact resolves; empty 20px div fallback."
- This update overlaps with `web-update-2026-04-22-challan-contact-cascade.md` (same commit `aab7885d`). Merge together during consolidation — code side (this file) describes the implementation touching 2 files; web side describes the design decision. Single entry per affected doc section.
