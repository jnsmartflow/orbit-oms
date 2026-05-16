# Recovery audit — Place Order + Taxonomy workstream
# Generated: 2026-05-10

## TL;DR

- All Place Order code, taxonomy translator, and Phase 1 scripts are **present on disk** as untracked files inside the current branch `feat/attendance-feature-complete` — none of it has been committed to any branch.
- The `feat/place-order-page` branch exists locally and on origin but contains **only one commit** (`c6e3ab3f docs: add place-order mockup, photos, and implementation plan`) — the actual page/lib/scripts never landed on it.
- `splitLegacyProduct` (the Stage C splitter) is **ABSENT** as expected — Stage C remained design-only.
- `prisma/schema.prisma` matches Stages A/B/C assumptions (no `subVariant`, no `variant`, `@@unique([family, subProduct, baseColour])` in place), but the inline comment still says "not yet applied" — stale per our hypothesis.
- Surprises: `public/category-images/` directory exists but is **empty** (no photos); a draft `code-update-2026-05-26-place-order-page.md` has a future date; the local branch is **2 commits ahead of origin** (unpushed); a stray `pass.tx` and `test/` directory are untracked.

---

## Section 1 — `/place-order` page state

`app/(place-order)/` exists (route group) — 13 files, 2,388 lines combined.
`app/place-order/` (no route group) does **NOT** exist.
`lib/place-order/` exists — 3 files, 251 lines.
`public/category-images/` directory **exists but is EMPTY** (zero files).

| Path | Lines | First-line description |
|---|---:|---|
| `app/(place-order)/layout.tsx` | 29 | Place Order layout — full-bleed, no sidebar; auth + role gate via `checkAnyPermission(roles, "place_order", "canView")` |
| `app/(place-order)/place-order/page.tsx` | 7 | Server entry — renders `<PlaceOrderPage />` from `place-order-page.tsx` |
| `app/(place-order)/place-order/place-order-page.tsx` | 511 | Client orchestrator — composes CustomerSearch, CategoryGrid, ExpandedPanel, ProductSearch, CartPanel, SendConfirmOverlay, KeyboardHelpOverlay; wires `useKeyboardRouting`, `buildEmail`, `loadDraft/saveDraft` |
| `app/(place-order)/place-order/types.ts` | 35 | Shared `Customer` / `Product` / `Bill` / `CartLine` types — mirrors `/api/order/data` response shape |
| `app/(place-order)/place-order/components/category-grid.tsx` | 212 | Photo-first category grid; loads from `/category-images/{slug}.png` with letter-monogram fallback |
| `app/(place-order)/place-order/components/product-search.tsx` | 143 | Product search bar above the category grid; keyboard-driven filtering |
| `app/(place-order)/place-order/components/customer-search.tsx` | 163 | Desktop pill + dropdown for customer selection |
| `app/(place-order)/place-order/components/variant-cell.tsx` | 107 | Excel-style single-cell qty input with focus/halo states |
| `app/(place-order)/place-order/components/expanded-panel.tsx` | 415 | Inline expanded panel per planning §6.7 — header, product chip ribbon, base filter, variant grid |
| `app/(place-order)/place-order/components/send-confirm-overlay.tsx` | 100 | Email preview modal before mailto dispatch |
| `app/(place-order)/place-order/components/cart-panel.tsx` | 321 | Right-pane cart (360px sticky) with customer block + bill list |
| `app/(place-order)/place-order/components/keyboard-help-overlay.tsx` | 137 | `?` keymap modal; owns key dispatch while open |
| `app/(place-order)/place-order/hooks/use-keyboard-routing.ts` | 155 | Document-level keydown router for the GRID context only |
| `lib/place-order/pack.ts` | 55 | Pack-size formatting/sorting/carton-step helpers — byte-compatible with mobile `/order` |
| `lib/place-order/email.ts` | 98 | Mailto body + subject builder; multiplies cell qty × `packStep` to emit UNITS (cell = boxes per locked decision) |
| `lib/place-order/draft-storage.ts` | 98 | localStorage draft persistence keyed by SAP customer code; 24h TTL |

---

## Section 2 — `/order` public page state

- `app/order/page.tsx` — **PRESENT**, 1,807 lines (this is the public mobile SO order form).
- `app/(public)/order/page.tsx` — does NOT exist (it's at `app/order/`, not under a `(public)` group).
- `app/api/order/data/route.ts` — **PRESENT**, 120 lines.

---

## Section 3 — Taxonomy translator + Phase 1 scripts

| File | Status | Lines |
|---|---|---:|
| `lib/mail-orders/taxonomy-mapping.ts` | PRESENT | 858 |
| `scripts/preview-new-taxonomy.ts` | PRESENT | 189 |
| `scripts/preview-new-taxonomy-from-csv.ts` | PRESENT | 333 |
| `scripts/phase1-backup-current-index.ts` | PRESENT | 76 |
| `scripts/phase1-seed-mo-order-form-index.ts` | PRESENT | 252 |
| `scripts/phase1-restore-from-backup.ts` | PRESENT | 156 |
| `scripts/phase1-taxonomy-unique-constraint.sql` | PRESENT | 34 |
| `scripts/phase1-spotcheck-tmp.ts` | PRESENT | 42 |
| `scripts/phase1-rollback-verify-tmp.ts` | PRESENT | 25 |

**Two extra script files not on the expected list:**

| File | Lines | Note |
|---|---:|---|
| `scripts/phase1-schema-changes.sql` | 51 | Not in May 6 summary — additional Phase 1 SQL |
| `scripts/backup-mo-order-form-index.ts` | 50 | Looks like a sibling/older variant of `phase1-backup-current-index.ts` |

### `lib/mail-orders/taxonomy-mapping.ts` — exported symbols

Exported types (3): `LegacyKey`, `ProductType`, `NewRow`.
Exported consts (2): `FAMILY_BASE`, `SUB_PRODUCT_ORDER`.
Exported functions (2): `getSkipReason`, `mapLegacyToNew`.

- `mapLegacyToNew` — PRESENT (line 463)
- `getSkipReason` — PRESENT (line 159)
- `LegacyKey` — PRESENT (line 25)
- `NewRow` — PRESENT (line 34)
- `splitLegacyProduct` — **ABSENT** (matches expectation: Stage C was design-only, no code)

Header comment (line 1) cites `docs/prompts/drafts/web-update-2026-05-06-master-taxonomy-redesign.md` as the locked taxonomy source.

---

## Section 4 — Draft files inventory

Matches across `*taxonomy*`, `*place-order*`, `*stage-*`, `*so-order*`, `*phase1*`. All are **untracked** in git.

| File | Lines |
|---|---:|
| `web-update-2026-05-06-master-taxonomy-redesign.md` | 1043 |
| `web-update-2026-05-06-place-order-built-pending-taxonomy.md` | 139 |
| `code-update-2026-05-06-phase1-taxonomy-mapping.md` | 241 |
| `code-update-2026-05-06-phase1-prompt1.5-csv-preview.md` | 132 |
| `code-update-2026-05-06-phase1-prompt1.6-translator-fix.md` | 205 |
| `session-end-2026-05-06-taxonomy-phase1-summary.md` | 111 |
| `code-update-2026-05-26-place-order-page.md` | 595 |
| `web-update-2026-05-06-so-order-form-build.md` | 70 |
| `stage-a-audit-report-2026-05-07.md` | 9 |
| `stage-a-final-report-2026-05-07.md` | 260 |
| `stage-a-pass1-raw.md` | 407 |
| `stage-a-pass2-raw.md` | 600 |
| `stage-a-pass3-raw.md` | 397 |
| `stage-a-pass4-raw.md` | 513 |
| `stage-a-pass5-raw.md` | 307 |
| `stage-a-pass6-raw.md` | 126 |
| `session-end-2026-05-07-stage-a-audit.md` | 210 |
| `session-end-2026-05-08-stage-b-design.md` | 156 |
| `stage-b-design-2026-05-08.md` | 273 |
| `stage-c-design-2026-05-09.md` | 332 |

**Future-dated file:** `code-update-2026-05-26-place-order-page.md` — date is **16 days in the future** (today is 2026-05-10). Likely a typo for `2026-05-06` based on subject.

**Files dated 2026-05-09 or 2026-05-10 in scope:** Only `stage-c-design-2026-05-09.md` matches the workstream patterns. (Other 2026-05-09/10 drafts in the working tree relate to attendance/ops-admin, not taxonomy/place-order — see git status untracked list.)

---

## Section 5 — Data files inventory

| File | Lines | Note |
|---|---:|---|
| `docs/prompts/drafts/taxonomy-preview.json` | 6804 | Top-level keys: `capturedAt`, `source`, `summary`, `newRowsByFamily`. Summary block reports `totalLegacyTriples: 560`, `totalNewRows: 512`, `crossListedExtraRows: 68`, `suppressedPlainRows: 19`, `skippedTriples: 82`, `warnings: 0`, `familiesProduced: 34`. Captured 2026-05-06T18:53Z from `mo_sku_lookup-triples-2026-05-06.csv`. |
| `docs/prompts/drafts/mo_order_form_index-backup-2026-05-06.json` | 6260 | Top-level keys: `capturedAt`, `sourceTable`, `rowCount`, `schemaNote`, `rows`. `rowCount: 481`. Captured 2026-05-06T19:31Z. Schema note: "Pre-Phase B snapshot. Includes ALL rows (active + inactive)." |
| `docs/prompts/drafts/mo_sku_lookup-triples-2026-05-06.csv` | 560 | Header: `category,product,baseColour,sku_count,example_description` |
| `docs/prompts/drafts/mo_order_form_index-backup-2026-05-06.csv` | 100 | Header: `id,family,subProduct,displayName,searchTokens,tinterType,sortOrder,isActive,createdAt,baseColour,productType` |

Note: the JSON backup says 481 rows but the CSV variant only has 100 lines — likely a partial CSV export, worth checking next session.

---

## Section 6 — Git state

**Currently checked out:** `feat/attendance-feature-complete`. Local is **2 commits ahead of `origin/feat/attendance-feature-complete`** — unpushed commits.

**Working tree:** modified `.claude/settings.local.json` and `docs/prompts/context-update-code-template.md`. Plus the very long untracked list (Place Order code, all taxonomy scripts, all the drafts, plus `pass.tx`, `test/`, `public/JSW DULUX.png`, `public/JSW LOGO.png`).

**Branches present:**
- Local: `dev`, `feat/attendance-feature-complete` (current), `feat/attendance-foundation`, `feat/place-order-page`, `main`
- Remote: `origin/dev`, `origin/feat/attendance-feature-complete`, `origin/feat/attendance-foundation`, `origin/feat/place-order-page`, `origin/main`

`feat/place-order-page` exists **both locally and on origin**.

**`git log --oneline -10 feat/place-order-page` (verbatim):**
```
c6e3ab3f docs: add place-order mockup, photos, and implementation plan
c0b9d5ba fix(/order): phase 1.2 multi-select Enter routing
41b5695e fix(/order): phase 1.1 keyboard fixes from tele-caller validation
82743020 feat(/order): phase 1 keyboard-first workflow
5d3f72fa feat(order): keyboard nav for suggestions, pack qty carton step multiples
56f767f4 feat(order): keyboard nav for suggestions, pack qty carton step multiples
6da416b3 fix(order): pagination dots showing, Set Quantities bar sticky at bill level, suggestions limit 50
21cb38e8 feat(order): horizontal swipe pagination, fix selection persist on query edit
d397ece2 feat(order): paginated multi-SKU selection, pinned selected section, search+page together
c67a20cf feat(order): multi-SKU select flow, progress dots, skip/next picker
```

The branch only diverges from `c0b9d5ba` by **one commit** (`c6e3ab3f`) — and that commit is docs/photos/plan only, no `app/(place-order)/` code. The actual Place Order implementation files in the working tree are **not committed anywhere**.

**`git log -1 prisma/schema.prisma`:** `5c42288b 2026-05-08 11:11:04 +0530 feat(attendance): schema v27.1 + auth gate infrastructure (Prompts 1, 2.5, 3) (#1)` — schema last touched by attendance work on 2026-05-08, not by Phase 1 taxonomy work.

**`git log -1 lib/mail-orders/taxonomy-mapping.ts`:** No commits — the file is untracked.

**Place-order / taxonomy / phase1 / mapping commits across all branches** (`git log --all | grep -iE "place-order|taxonomy|phase1|mapping"`):
```
c6e3ab3f docs: add place-order mockup, photos, and implementation plan
78f97c86 fix: correct line status reason mapping in email template (v60)
dc54f7f1 feat: soNumber mapping + dispatch enrichment from mail orders ...
```

The two `mapping` hits are unrelated (line-status mapping, soNumber mapping). **Nothing taxonomy-related has landed on `main`.** `main`'s last 10 commits are all roles/attendance/order/dev work.

**`git log --oneline -30` on current branch:** ends with the same 10 commits as above; from 03035f5c onwards, history is all `/order` mobile-page work, `import` fixes, and earlier orders work. None mention `place-order` or `taxonomy`.

---

## Section 7 — Schema file inspection

`prisma/schema.prisma` is 1,317 lines. Last commit: `5c42288b` (2026-05-08, attendance v27.1).

### `mo_sku_lookup` (lines 1123–1138)

```prisma
model mo_sku_lookup {
  id              Int      @id @default(autoincrement())
  material        String   @unique
  description     String
  category        String
  product         String
  baseColour      String
  packCode        String
  unit            String?
  refMaterial     String?
  refDescription  String?
  paintType       String?
  materialType    String?
  piecesPerCarton Int?
  createdAt       DateTime @default(now())
}
```

- `subVariant` column: **ABSENT** ✓ (matches expectation: NO)
- No `@@unique`, `@@index`, or `@@map` directives.

### `mo_product_keywords` (lines 1107–1113)

```prisma
model mo_product_keywords {
  id        Int      @id @default(autoincrement())
  keyword   String
  category  String
  product   String
  createdAt DateTime @default(now())
}
```

- `subVariant` column: **ABSENT** ✓ (matches expectation: NO)
- No directives.

### `mo_order_form_index` (lines 1192–1212)

```prisma
model mo_order_form_index {
  id           Int      @id @default(autoincrement())
  family       String
  subProduct   String
  baseColour   String?
  displayName  String
  searchTokens String
  tinterType   String?
  productType  String?  @default("PLAIN")
  sortOrder    Int      @default(0)
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())

  // Widened from (subProduct, baseColour) to (family, subProduct, baseColour)
  // for Phase 1 taxonomy redesign — same (subProduct, baseColour) needs to
  // appear under multiple families when a Promise primer is cross-listed in
  // PRIMER + PROMISE INTERIOR + PROMISE umbrella. Migration SQL lives at
  // scripts/phase1-taxonomy-unique-constraint.sql; not yet applied.
  @@unique([family, subProduct, baseColour])
  @@map("mo_order_form_index")
}
```

- `variant` column: **ABSENT** ✓ (matches expectation: NO)
- Current `@@unique`: `(family, subProduct, baseColour)` ✓ (matches expectation)
- Comment block on the `@@unique` line still ends with **"not yet applied."** — **STALE** per hypothesis (we believe the migration did apply on 2026-05-06; backup `mo_order_form_index-backup-2026-05-06.json` and `taxonomy-preview.json` were captured around that work).

---

## Section 8 — `place_order` in permissions + middleware

### `lib/permissions.ts` (3 hits)

```
34:  { pageKey: "place_order",        label: "Place Order",       href: "/place-order" },
120:  | "place_order"
165:  "dispatcher", "warehouse", "place_order", "mail_orders",
```

Wired as a navigable page-key with label "Place Order" and href `/place-order`, declared in the union type, and listed in a role-allowance array alongside `dispatcher`, `warehouse`, `mail_orders`.

### `middleware.ts`

**No matches** for `place_order` or `place-order`. Middleware does not explicitly mention this route.

### `app/api/auth/`

**No matches.**

### `app/(place-order)/layout.tsx` (1 hit)

```
24:    const allowed = await checkAnyPermission(roles, "place_order", "canView");
```

Layout-level permission check guards every page under the route group via `checkAnyPermission(roles, "place_order", "canView")`.

### Repo-wide string-literal hits for `'place_order'` / `"place_order"`

Same 4 lines as above (3 in `lib/permissions.ts`, 1 in `app/(place-order)/layout.tsx`). No other files reference the page-key.

---

## Surprises and anomalies

1. **All Place Order + taxonomy work is untracked on the wrong branch.** The current branch is `feat/attendance-feature-complete`, but it carries the entire `app/(place-order)/`, `lib/place-order/`, `lib/mail-orders/taxonomy-mapping.ts`, all `scripts/phase1-*`, the JSON/CSV data files, and all the design drafts — none of them committed. The dedicated `feat/place-order-page` branch only contains a single docs commit (`c6e3ab3f`); none of the code lives on it.
2. **`public/category-images/` directory exists but is empty** (zero PNG/JPG files). The category-grid component expects `/category-images/{slug}.png` with a letter-monogram fallback, so the page renders but with no photos.
3. **Future-dated draft:** `code-update-2026-05-26-place-order-page.md` is dated 2026-05-26 (16 days in the future). Almost certainly a typo for `2026-05-06`.
4. **Schema comment is stale.** `mo_order_form_index` carries a "not yet applied" note on its `@@unique` line, but the current shape `(family, subProduct, baseColour)` is exactly what Phase 1 widened it to, and the backup files dated 2026-05-06 were captured around that migration.
5. **Local branch is 2 commits ahead of origin** on `feat/attendance-feature-complete` — unpushed work (the most recent commits are the ops_admin role + layout fixes shown in §6).
6. **Stray files.** `pass.tx` and a `test/` directory show up untracked at repo root with no obvious purpose.
7. **Two extra Phase 1 scripts** (`scripts/phase1-schema-changes.sql`, `scripts/backup-mo-order-form-index.ts`) not on the expected list from the May 6 summary — worth checking whether they superseded or duplicated the canonical ones.
8. **CSV vs JSON row-count mismatch:** `mo_order_form_index-backup-2026-05-06.json` reports 481 rows, but `mo_order_form_index-backup-2026-05-06.csv` is only 100 lines (≈99 data rows). The CSV looks partial.
9. **Public order page sits at `app/order/`, not `app/(public)/order/`** (no `(public)` route group) — relevant to where any future hardening or middleware tweaks should target.
10. **`prisma/schema.prisma` last touch is the 2026-05-08 attendance schema commit**, not anything from Phase 1. So if Phase 1 added anything to the schema, it was layered into that commit by another path, or the schema changes are still uncommitted (worth diffing against the JSON snapshot before resuming).

---

## Files NOT inspected

- All other domain-irrelevant `docs/prompts/drafts/` files (attendance, ops-admin, JSW logo swap, SAP import, dev-build/test scripts) — outside §4 patterns.
- Application code outside the eight scoped paths (no inspection of `app/mail-orders/`, `app/tint/`, `app/operations/`, etc.).
- Branch contents of `dev`, `feat/attendance-foundation`, `main` beyond the `git log` output already shown — no `git show`/`git diff` issued (would have required switching context, and prompt forbade branch switches).
- `pass.tx` and `test/` — flagged in surprises but not opened.
- The full body of any `.tsx` / `.ts` / data file beyond the first ~30 lines (per the 5-line-quote constraint).
- `node_modules`, `.next`, build artefacts.
