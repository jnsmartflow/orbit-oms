# code-update-2026-10-05 — Orbit customers (non-SAP ship-to hubs with system ORB codes)

**Status:** SHIPPED 2026-10-05. Schema stamp: `CLAUDE_CORE.md` v130 · Schema v27.57.
**Implements:** the parked "Orbit delivery points" idea in
`docs/prompts/drafts/web-update-2026-09-24-billing-mo-actions.md` → "5.0 Why parked, and the idea to redesign around" — **now BUILT**.

## What it is

Some dealers' bills go to a transporter hub (godown), not the shop. The hub is recorded as a
normal `delivery_point_master` row and picked as the bill's ship-to in Billing's ✎ pencil (or
Floor / Tint). Reports can then filter "ship-to customer type = Transporter" (type id 7).
Hubs are not in SAP, so the system makes their code: `ORB-00001`, `ORB-00002` …

## Owner decisions (2026-10-05)

1. Orbit customers are created ONLY via **+ Add Customer on `/admin/customers`** (`customers-split-view.tsx`). No new UI on Billing, Floor, `/po`, `/place-order`.
2. A tick **"Not in SAP — Orbit customer"** on the create form. Ticked → code box locked, showing "ORB-auto · generated on save". The tick is independent of customer type.
3. Code = `'ORB-'` + 5-digit zero-pad of `nextval('orb_customer_code_seq')`. Gaps acceptable.
4. Duplicate check (Orbit path only): same `areaId` + same name after normalising (lower-case, trim, collapse spaces), across ALL customer types. **HARD BLOCK** — 409 with the existing row's id, code and name. No "create anyway".
5. A hub is just another ship-to: no special routing, no new delivery type, no re-slotting. Area/route/type come from its AREA, as for any ship-to.
6. Floor + Tint ship-to search also matches `customerCode` (case-insensitive); still active-only, still 8 results.
7. Billing ✎ ship-to search adds `isActive: true` — for ALL customers.
8. An ORB customer must NEVER get a `mo_customer_keywords` row — that keeps it out of every bill-to picker.
9. **Orbit customer create is superuser-only (server-enforced), decided 2026-10-05.** The tick is also hidden on `/tint/manager/customers` (same component, `allowOrbitCreate` off).
10. A rename of a normal customer that collides with an ORB hub's name is NOT blocked (the duplicate check runs on the Orbit create only) — noted, left as is.

## Live facts (owner's SELECTs, 2026-10-05)

- `customer_type_master` id 7 = "Transporter", active.
- `public.orb_customer_code_seq` exists, owner postgres, START 1, unused.
- `delivery_point_master_customerCode_key` UNIQUE on (`"customerCode"`) was already live; 0 duplicates; 0 `ORB-` codes. Prisma's `@unique` matches live — no DDL.

## Files

| File | Change |
|---|---|
| `lib/customers/orbit-code.ts` (new) | `ORB_PREFIX`, `isOrbCode()`, `formatOrbCode()`, `normaliseName()`, `ORB_TYPED_REFUSAL`. |
| `app/api/admin/customers/route.ts` | POST accepts `orbitOnly`. True → superuser check (403), hard duplicate check (409 `{ error, duplicate }`), one `$queryRaw` `nextval`, create with `wrapCreateInTransaction: false`; audit summary notes "Orbit customer". False → code required, a typed `ORB-` code refused (400). No keyword write on either path. |
| `app/api/admin/customers/[id]/route.ts` | PATCH refuses changing an ORB- code, and changing any code TO an ORB- code. An unchanged code passes (the form sends it on every save). |
| `app/api/admin/customers/import/route.ts` | CSV rows with an `ORB-` code fail with a reason (no create, no update). |
| `app/api/mail-orders/[id]/customer/route.ts` | Refuses an `ORB-` bill-to code before any write (so no keyword row either). |
| `app/api/tint/manager/ship-to/create/route.ts` | Refuses a typed `ORB-` code before any write (that route writes a keyword row). |
| `components/admin/customers-split-view.tsx` | `allowOrbitCreate` prop; the tick; locked code box; ORB code read-only on edit with "Orbit customer · not in SAP" (field + header); 409 duplicate shown on the name field. |
| `app/(admin)/admin/customers/page.tsx` | Passes `allowOrbitCreate`. `/tint/manager/customers` does not. |
| `lib/floor/ship-to.ts` | `searchShipTo`: name OR code, case-insensitive; `isActive: true` and `take: 8` kept. |
| `app/api/billing/ship-to-search/route.ts` | `isActive: true` added. |
| `docs/CLAUDE_CORE.md` | v130 · Schema v27.57 (chain, §7.1, §13 `$transaction` list, change log, footer). |

## Canon corrections owed at the next consolidation

- **`CLAUDE_MAIL_ORDERS.md` → "6. Ship-to override — delivery-match.ts":** `lib/mail-orders/delivery-match.ts` (`matchDeliveryCustomer`) has had **no caller since 2026-09-29** — the ingest route's auto ship-to detection was removed by owner decision, and ingest now writes `shipToOverride: false, shipToOverrideCustomerId: null`. Ship-to is set only by the Billing ✎ pencil, Floor and the Tint Manager. Rewrite the section to say so, keeping a one-line history note of the old auto-detect + `[→ Name (Code)]` suffix. (`splitDeliveryRemarks` still parses old suffixes; its `\((\d+)\)` regex would not parse an ORB code, which is harmless because nothing writes the suffix any more.)
- **`CLAUDE_FLOOR.md` → "4.4 Ship-to change (detail panel)":** the search now matches **name OR code**, case-insensitive, **active only**, 8 results (`lib/floor/ship-to.ts` `searchShipTo`; the Tint Manager's ship-to search shares it).
- **`CLAUDE_BILLING.md` → the §5 Billing read routes paragraph (`GET /api/billing/ship-to-search`):** the search is now **active only**, name or code, 20 results.
- **`CLAUDE_PLACE_ORDER.md` → "Customer data source — the two-address-book gap":** add that **ORB- (Orbit) customers never get a `mo_customer_keywords` row**, by design — that is what keeps them out of every bill-to picker; the master-only "gap" is intended for them.
- **`docs/prompts/drafts/web-update-2026-09-24-billing-mo-actions.md` → "5.0":** mark the Orbit delivery points idea **BUILT** (this file). The "Orbit-only" flag it imagined is the `ORB-` code prefix itself, not a column.

## Known limits (not built, by decision or out of scope)

- No "ship-to customer type" report filter exists yet — reports read `customerType` only for SAP's own ship-to (`isSiteDelivery`). Build when the report is asked for.
- Slot / dispatch window still come from the SAP dealer's area; a redirect never re-slots (decision 5).
- `/po` and `/place-order` ship-to autocompletes read `mo_customer_keywords`, so ORB hubs are not offered there (decision 1, 8).
