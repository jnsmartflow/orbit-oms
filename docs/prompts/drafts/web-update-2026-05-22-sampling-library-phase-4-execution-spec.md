# Sampling Library — Phase 4 Execution Spec

**Drafted:** 2026-05-22 (planning session)
**Status:** Design locked. Ready for execution session.
**Supersedes:** `docs/prompts/drafts/web-update-2026-05-22-sampling-library-phase-4-kickoff.md` (Track 3 wiring proposal).
**Predecessor docs:**
- Phase 1 handoff: `code-update-2026-05-22-sampling-library-phase-1-handoff.md`
- Phase 2 handoff: `code-update-2026-05-22-sampling-library-phase-2-handoff.md`
- Phase 3 handoff (shipped): `code-update-2026-05-22-sampling-library-phase-3-shipped.md`
- Buildout summary: `code-update-2026-05-22-sampling-library-buildout.md`

This document is the **complete handoff for the next session**. Read it end-to-end before drafting any Claude Code prompts.

---

## 1. Mission

Wire the Sampling Library into the live Tint Operator workflow so:
1. Every TI saved gets a `samplingNo` attached (new or existing).
2. Every TI marked done writes a `sampling_usage_log` row with real operator, OBD, dealer, site, qty, date.
3. The operator screen suggests past tinting at the same site — both exact matches and reference shades.
4. `shade_master` is retired in favour of `sampling_register` + `sampling_recipes` + `sampling_usage_log`.

Outcome: depot has one source of truth (Sampling Library), the paper register goes digital end-to-end, and tinting analytics (per site, per dealer, per operator) become possible.

---

## 2. Locked decisions

### 2.1 Architecture

- **Sampling Library replaces `shade_master`.** No dual-write. Once Phase 4 ships, all new shade saves write to `sampling_register` + `sampling_recipes` + `sampling_usage_log`. `shade_master` becomes read-only legacy data and the existing migrations from it can be deprecated separately.
- **Lookup key for suggestions:** `siteId + skuCode + packCode` (exact match) and `siteId` alone (reference list).
- **Site** = `delivery_point_master.id` (Int FK), resolved from `orders.customerId`.
- **No customer/site grouping in Phase 4.** Multi-SAP-code sites (e.g. "Sun Shantam" with 5 customer codes) treated as separate sites for now. Grouping is a separate later phase.

### 2.2 Sampling number allocation

- **`MAX(samplingNo) + 1`** — plain sequential, no year prefix.
- **Allocated at Save TI** — not at toggle or screen open.
- **Race-safe via P2002 retry pattern** (same as `import_batches.batchRef`).
- **Confirmation popup on save**:
  > Saved as Sampling #135203
  > Write this in your paper register.
  > [OK]
- After OK, the number stays visible on screen in the TI summary area.

### 2.3 "Save shade" toggle

- **Removed entirely** from the operator UI.
- Every TI submit → writes to library. No opt-out.
- Old shade_master "Save shade" toggle code path deprecated.

### 2.4 Suggestion card on operator screen

When operator picks a SKU line, screen runs lookup against `sampling_usage_log` for this `siteId + skuCode + packCode`. Card has two sections:

**Top — Exact match (site + same SKU + same pack)**
- Big sampling number, shade name, recipe preview (active pigment chips inline)
- "Used N times at this site · last DD MMM YY"
- "Use this recipe →" button (gray-900, NOT teal — matches cousin pages)
- Multiple exact matches → show top 3 sorted by `usageCount DESC`, then `lastUsedAt DESC`

**Bottom — Reference list (other sampling numbers at same site)**
- Up to 5 cards, smaller, gray styling
- Each card: sampling number, shade name, pigment preview, SKU + pack info, uses count
- Same "click to apply recipe" behaviour — copies values into pigment chips
- Sorted by `usageCount DESC`, then `lastUsedAt DESC`

**No auto-fill.** Operator must click. Click on either section's card → copy that variant's recipe into pigment chips + set `samplingNo` + `shadeName` in form state.

### 2.5 Repeat-site / New-site badge

In the Ship-To card header on operator screen:
- Site has ≥1 row in `sampling_usage_log` for ANY past tinting → small gray pill **"Repeat site · N TIs"**
- Site has zero history → small gray pill **"New site"**
- Both styles use `bg-gray-100 text-gray-700 border-gray-200`. No traffic-light colours.

### 2.6 Same shade, different pack at same site

ONE sampling number per shade per site, multiple pack variants underneath:
- 20 LT tinted first → parent #135202 + child variant for 20 LT
- 4 LT comes later (same shade, same site) → finds parent #135202 → adds new child variant for 4 LT under same #135202
- No new sampling number created
- Suggestion card shows reference: "20 LT was tinted 7 times at this site as #135202. Enter your 4 LT recipe — it will be added as a new 4 LT variant under #135202."
- On save: popup says **"Saved as new 4 LT variant under #135202."**

### 2.7 On Save TI — three scenarios

1. **NEW sampling (no exact match clicked, operator entered fresh recipe + shade name):**
   - Allocate `MAX + 1`
   - Create `sampling_register` parent row (samplingNo, shadeName, tinterType, createdById, createdAt, siteId=order.customerId, dealerNameRaw from import_raw_summary)
   - Create first `sampling_recipes` variant (samplingNo, skuCode, packCode, pigment values)
   - Update `tinter_issue_entries` with `samplingNo` + `shadeName`
   - Popup: "Saved as Sampling #135203"

2. **EXISTING sampling + NEW pack at same site (operator picked suggestion #135202 from reference list, but TI is for a pack/SKU combo not yet in `sampling_recipes`):**
   - DO NOT allocate new number
   - Create new `sampling_recipes` variant under #135202 with new (skuCode, packCode)
   - Update `tinter_issue_entries` with `samplingNo=135202` + `shadeName` (copied from parent)
   - Popup: "Saved as new 4 LT variant under #135202"

3. **EXISTING sampling + EXISTING pack (operator picked exact-match suggestion):**
   - Find `sampling_recipes` row by (samplingNo, skuCode, packCode)
   - Update pigment values (last-saved wins per Q6)
   - Update `tinter_issue_entries` with `samplingNo` + `shadeName`
   - No popup (silent save — operator already saw the suggestion card)

### 2.8 On Mark as Done — usage log writes

For each `tinter_issue_entries` and `tinter_issue_entries_b` row under this order/split:
1. Find `sampling_recipes` row by (samplingNo, skuCode, packCode) → get `recipeId`
2. Insert into `sampling_usage_log`:
   - `samplingNo`
   - `recipeId`
   - `usageDate` = today (IST)
   - `operatorId` = `session.user.id`
   - `operatorNameRaw` = null (FK is enough)
   - `tinQty` = TI entry's tinQty
   - `dealerNameRaw` = `import_raw_summary.billToCustomerName` joined by obdNumber
   - `siteNameRaw` = `order.shipToCustomerName`
   - `siteId` = `order.customerId` (via include on customer)
   - `skuCodeRaw` = TI's baseSku
   - `packCode` = TI's packCode
   - `sourceRowIndex` = null (live data, not Excel)
   - `deliveryNumber` = `order.obdNumber`
3. Bump `sampling_recipes.usageCount` (existing column)
4. Update `sampling_recipes.lastUsedAt` = today
5. Sequential awaits. **No `prisma.$transaction`.**
6. If samplingNo is NULL on a TI row (unexpected — should not happen post-Phase-4 but defensive), log a warning and skip the usage_log write for that row. Mark-Done still succeeds.

### 2.9 Edit semantics

- **Before Mark as Done:** TI is editable. Pigment values, samplingNo, shadeName all editable. Each save updates `sampling_recipes` row (last-saved wins). No usage_log row written until Mark Done.
- **After Mark as Done:** TI committed. Future edits not in scope for Phase 4. (Out-of-band correction would need a separate workflow.)

### 2.10 Last-clicked / last-saved wins

Operator can change their mind mid-edit (click #135202, then click #134846 from reference list). Only the final saved choice wins. No audit trail of "considered then changed." Every saved TI marked Done = one row in usage_log = one row in #N's Tinting History.

---

## 3. Schema changes (v27.2 → v27.3)

### 3.1 SQL (Supabase SQL Editor)

File path: `docs/plans/sampling-register/05-phase4-ti-link.sql`

```sql
-- Phase 4: link TI entries to Sampling Library

ALTER TABLE tinter_issue_entries
  ADD COLUMN IF NOT EXISTS "samplingNo" INTEGER,
  ADD COLUMN IF NOT EXISTS "shadeName" TEXT;

ALTER TABLE tinter_issue_entries_b
  ADD COLUMN IF NOT EXISTS "samplingNo" INTEGER,
  ADD COLUMN IF NOT EXISTS "shadeName" TEXT;

-- FK constraints (sampling_register.samplingNo is the natural key, not id)
ALTER TABLE tinter_issue_entries
  ADD CONSTRAINT IF NOT EXISTS fk_tinter_issue_sampling
  FOREIGN KEY ("samplingNo") REFERENCES sampling_register("samplingNo") ON DELETE SET NULL;

ALTER TABLE tinter_issue_entries_b
  ADD CONSTRAINT IF NOT EXISTS fk_tinter_issue_b_sampling
  FOREIGN KEY ("samplingNo") REFERENCES sampling_register("samplingNo") ON DELETE SET NULL;

-- Indexes for lookup
CREATE INDEX IF NOT EXISTS idx_tinter_issue_sampling   ON tinter_issue_entries   ("samplingNo");
CREATE INDEX IF NOT EXISTS idx_tinter_issue_b_sampling ON tinter_issue_entries_b ("samplingNo");

-- Add siteId column on sampling_register if not already present (defensive — check first)
-- It SHOULD already exist from Phase 1, but verify.
ALTER TABLE sampling_register
  ADD COLUMN IF NOT EXISTS "siteId" INTEGER REFERENCES delivery_point_master(id);

CREATE INDEX IF NOT EXISTS idx_sampling_register_site ON sampling_register ("siteId");
```

### 3.2 Prisma schema mirror (hand-edit `prisma/schema.prisma`)

In `tinter_issue_entries` model — add:
```prisma
samplingNo        Int?
samplingRegister  sampling_register? @relation("TinterIssueSampling", fields: [samplingNo], references: [samplingNo])
shadeName         String?
```

In `tinter_issue_entries_b` model — add same two fields with relation name `"TinterIssueBSampling"`.

In `sampling_register` model — add back-relations:
```prisma
tinterIssueEntries   tinter_issue_entries[]   @relation("TinterIssueSampling")
tinterIssueEntriesB  tinter_issue_entries_b[] @relation("TinterIssueBSampling")
```

Then run `npx prisma generate`.

---

## 4. API changes

### 4.1 NEW endpoint — GET `/api/sampling-library/suggest`

Purpose: power the suggestion card on operator screen.

Query params:
- `siteId` (required, Int)
- `skuCode` (required, string)
- `packCode` (required, PackCode enum)

Response shape:
```ts
{
  exactMatches: Array<{
    samplingNo: number;
    shadeName: string;
    recipeId: number;
    skuCode: string;
    packCode: PackCode;
    pigments: Record<string, number>;  // 13 TINTER or 14 ACOTONE
    activePigments: Array<{code: string, value: number}>;  // value > 0 only
    usageCountAtThisSite: number;
    totalUsageCount: number;
    lastUsedAt: string;  // ISO
    isPrimary: boolean;
  }>;
  referenceList: Array<{
    samplingNo: number;
    shadeName: string;
    recipeId: number;
    skuCode: string;
    packCode: PackCode;
    pigments: Record<string, number>;
    activePigments: Array<{code: string, value: number}>;
    usageCountAtThisSite: number;
    lastUsedAt: string;
  }>;
  siteHistorySummary: {
    totalTIs: number;          // total rows in sampling_usage_log for this siteId
    distinctSamplingNos: number;
    isNewSite: boolean;        // true when totalTIs === 0
  };
}
```

Query logic (sequential):
1. Fetch `sampling_usage_log` for `siteId` joined with `sampling_recipes` → group by samplingNo.
2. Filter exactMatches where `recipe.skuCode === param.skuCode AND recipe.packCode === param.packCode`. Sort by `usageCountAtThisSite DESC, lastUsedAt DESC`. Take top 3.
3. referenceList = all other samplingNos at this site (any SKU, any pack). Sort by `usageCountAtThisSite DESC, lastUsedAt DESC`. Take top 5.
4. Compute siteHistorySummary from the same aggregation.
5. For each entry, fetch the recipe's pigment values from `sampling_recipes`.

Auth: requires `sampling_library:canView`. (Tint operators already have this per Phase 1 grants.)

`export const dynamic = "force-dynamic";`

### 4.2 MODIFIED endpoint — POST `/api/tint/operator/tinter-issue` and `/api/tint/operator/tinter-issue-b`

These are the TI write endpoints. Need to:

1. Accept new payload fields: `samplingNo` (Int, nullable), `shadeName` (string, nullable).
2. If `samplingNo` is null AND the operator entered values + shade name → allocate new sampling number:
   - `MAX(samplingNo) + 1` from `sampling_register`
   - Create `sampling_register` row with: samplingNo, shadeName, tinterType (TINTER or ACOTONE), createdById, createdAt, siteId=order.customerId
   - Create first `sampling_recipes` variant with skuCode, packCode, pigment values, isPrimary=true, isActive=true
   - P2002 retry loop (3 attempts) for race safety
3. If `samplingNo` is provided AND `(samplingNo, skuCode, packCode)` exists in sampling_recipes → update that row's pigment values
4. If `samplingNo` is provided AND `(samplingNo, skuCode, packCode)` doesn't exist → create new variant row under existing samplingNo
5. Write the TI row with the resolved `samplingNo` + `shadeName`
6. Return `{ tiEntry, allocatedSamplingNo: number | null, isNewSampling: boolean, isNewVariant: boolean }` so client can show the popup correctly.

All sequential awaits. No transactions.

### 4.3 MODIFIED endpoint — POST `/api/tint/operator/done`

The Mark-Done endpoint. Add a step at the end (after all existing logic):

1. Load all TI entries for this order/split: `tinter_issue_entries.findMany({ where: { orderId, splitId } })` and same for `_b`.
2. Load `import_raw_summary` for `order.obdNumber` to get `billToCustomerName`.
3. For each TI entry:
   - Skip if `samplingNo` is null (defensive).
   - Lookup `sampling_recipes` row by (samplingNo, skuCode, packCode) → get recipeId.
   - Insert `sampling_usage_log` row (all fields per §2.8).
   - Update `sampling_recipes` { usageCount: { increment: 1 }, lastUsedAt: now }.
4. Return existing response shape + new field `usageLogRows: number`.

If any step fails per-TI, log + continue. Mark-Done MUST NOT fail because of usage_log writes (TI completion is the primary purpose).

### 4.4 DEPRECATED endpoint — `/api/tint/operator/shades`

Keep the file in place for now (legacy compatibility). Don't delete. Add a comment at top noting it's deprecated and should not be called from new code. Phase 4 frontend will not call it.

---

## 5. UI changes

### 5.1 Tint Operator screen — `components/tint/tint-operator-content.tsx`

Reference the existing screenshot uploaded during planning session (the one with "Pallav Appartment" job, SKU 5948223, ACOTONE shade quantities grid).

#### A. Ship-To card header — add badge

Top of the existing `SHIP TO (SITE)` card, next to the site name:
- Small pill, 11px font, `bg-gray-100 text-gray-700 border-gray-200 rounded-md px-2 py-0.5`
- States: "Repeat site · N TIs" or "New site"
- Data from `siteHistorySummary` in suggest endpoint response

#### B. Existing "All shades..." popover — REPLACE with new suggest UI

Remove the existing shade_master suggestion row + "All shades..." popover entirely. Replace with the new SuggestionCard component built from the suggest endpoint response.

**SuggestionCard structure (rendered between the SKU line picker and the pigment chips grid):**

```
┌──────────────────────────────────────────────────────────────────┐
│ Loading suggestions...           (while suggest API in flight)    │
│ — OR —                                                            │
│ [Repeat site card or New site card from §A]                       │
├──────────────────────────────────────────────────────────────────┤
│ EXACT MATCH (when exactMatches.length > 0)                        │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ #135202  SPL SHADE 90 GAVAN LIGHT                            │ │
│ │ Recipe: [YOX 400] [BLK 70] [OXR 30]                          │ │
│ │ Used 7 times here · last 12 Mar 26                           │ │
│ │                                            [Use this recipe→] │ │
│ └──────────────────────────────────────────────────────────────┘ │
│ (up to 2 more exact-match cards if multiple, smaller)             │
├──────────────────────────────────────────────────────────────────┤
│ OTHER SHADES AT THIS SITE (when referenceList.length > 0)         │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ #134846  SPL SHADE 91 · SKU 5948211 · 20 LT                  │ │
│ │ [YOX 380] [BLK 50] [OXR 25]  · 3 uses                        │ │
│ └──────────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ #134174  SPL CUSTOM TEAL · SKU 5948223 · 4 LT                │ │
│ │ [YOX 100] [TBL 50]  · 1 use                                  │ │
│ └──────────────────────────────────────────────────────────────┘ │
│ (up to 5 cards total in this section)                             │
└──────────────────────────────────────────────────────────────────┘
```

Empty state (no exact match, no reference list): collapse the whole section. Just show pigment chips area as today.

#### C. Click handler on any suggestion card

Reuses `applyShadeToEntry()` pattern from existing code but writes:
- `entry.shadeValues` = pigment values from clicked card
- `entry.samplingNo` = card's samplingNo
- `entry.shadeName` = card's shadeName
- `entry.selectedFromSuggestion` = true (for analytics, optional)
- Triggers existing 1.5s flashActive highlight

#### D. Remove "Save shade" toggle

Find the existing toggle in the operator UI. Remove it entirely. Remove all referenced state (`shouldSaveShade`, etc.) and the conditional shade name input.

#### E. Add ALWAYS-VISIBLE shade name input

Replace the conditional shade name input with an always-visible one, just below the suggestion card:

```
Shade name:  [______________________________]
             (auto-fills when you pick a suggestion)
```

When operator clicks a suggestion → input fills from that card's shadeName. When operator types manually → they're entering a new shade name (Phase 4 NEW sampling path on save).

#### F. Save TI confirmation popup

After successful Save TI POST → check response:
- `isNewSampling === true` → show popup:
  > **Saved as Sampling #135203**
  > Write this in your paper register.
  > [OK]
- `isNewVariant === true` → show popup:
  > **Saved as new {packCode} variant under Sampling #135202**
  > [OK]
- Else (existing variant update) → no popup, silent success

Popup pattern: same as `CLAUDE_UI.md §13` modal (`bg-black/40 backdrop`, `bg-white rounded-lg shadow-xl`, `bg-gray-900` confirm button).

#### G. TI summary area — show samplingNo

After save, show the assigned samplingNo on screen in a small chip near the SKU line label, so operator can refer back to it without reopening the popup. Persist this on the form state.

### 5.2 No other UI changes

Don't touch Tint Manager screen, TI Report, Delivery Challan, Sampling Library detail page (Phase 3 already shipped). Operator screen is the only mutation.

---

## 6. Execution checklist for next session

In this exact order:

```
[ ]  1. Read canonical files + 4 handoff docs + this spec
[ ]  2. Apply schema bump (Supabase SQL Editor → 05-phase4-ti-link.sql)
[ ]  3. Hand-edit prisma/schema.prisma + npx prisma generate (locally)
[ ]  4. Verify schema bump worked — quick SELECT on tinter_issue_entries
[ ]  5. Build new endpoint /api/sampling-library/suggest (with tests via curl)
[ ]  6. Modify /api/tint/operator/tinter-issue (TINTER write path)
[ ]  7. Modify /api/tint/operator/tinter-issue-b (ACOTONE write path)
[ ]  8. Modify /api/tint/operator/done (usage_log writes)
[ ]  9. Build SuggestionCard component (new file under components/tint/operator/)
[ ] 10. Wire SuggestionCard into tint-operator-content.tsx
[ ] 11. Remove Save shade toggle, add always-visible shade name input
[ ] 12. Wire confirmation popup on save responses
[ ] 13. Show samplingNo chip in TI summary area
[ ] 14. tsc --noEmit clean
[ ] 15. Local smoke test:
       - Open operator screen, open a fresh TI, verify suggestion API fires
       - Pick exact-match card → recipe applies → Save → check no popup, check
         tinter_issue_entries row has samplingNo populated, check sampling_recipes
         lastUsedAt updated
       - Mark as Done → check sampling_usage_log row appears with all fields
         populated correctly
       - Open a NEW TI for a shade with no history → type fresh recipe + shade
         name → Save → popup shows new sampling number → check sampling_register
         + sampling_recipes rows created, samplingNo on TI matches
       - Open a TI for existing shade + new pack → pick reference card → enter
         values → Save → popup shows "new variant" message → check new
         sampling_recipes row under existing samplingNo
       - Open Sampling Library page → verify new sampling number appears in list,
         Tinting History shows the new TI with real operator name + OBD
[ ] 16. Commit + push (single push, all changes in one or two logical commits)
[ ] 17. Vercel deploy verification on orbitoms.in
[ ] 18. Production smoke test (Smart Flow runs one TI on a test site)
[ ] 19. Send training note to Chandresh + Deepak + Chandrasing
[ ] 20. Draft session-end handoff doc with anything pending
```

---

## 7. Smoke test plan (detailed)

### 7.1 Pre-conditions

- Schema v27.3 applied (tinter_issue_entries has samplingNo + shadeName columns)
- Sampling Library has existing data (3,566 entries from Phase 3)
- A test order/split exists in Tint Manager assigned to Deepak (test operator)
- Test site (e.g. Petronet Lng Limited 3, customerId=X) has at least one entry in sampling_usage_log for SKU 5880384 + 20 LT pack → samplingNo #135202

### 7.2 Test scenarios

**T1 — Exact match suggestion appears**
1. Open `/tint/operator` as Deepak
2. Pick the test job → verify "Repeat site · N TIs" pill appears in Ship-To card
3. Pick SKU line 5880384 + 20 LT
4. Expected: SuggestionCard shows #135202 in EXACT MATCH section with recipe preview YOX 400 / BLK 70 / OXR 30 + "Used N times here"
5. Click "Use this recipe →" button
6. Expected: pigment chips fill in, shade name input shows "SPL SHADE 90 GAVAN LIGHT", samplingNo chip shows #135202

**T2 — Save existing exact-match TI**
1. Continue from T1
2. Set tin qty to 5
3. Click Save TI
4. Expected: no popup, silent save, tinter_issue_entries row appears with samplingNo=135202, shadeName populated, pigments populated
5. Check DB: `SELECT samplingNo, shadeName, baseSku, packCode FROM tinter_issue_entries WHERE id = <new row id>` → all four populated correctly

**T3 — Mark as Done writes usage_log**
1. Continue from T2 (TI saved, not yet done)
2. Click Mark as Done on the job
3. Expected: job marks done, no errors
4. Check DB:
   ```sql
   SELECT samplingNo, recipeId, usageDate, operatorId, tinQty,
          dealerNameRaw, siteId, siteNameRaw, skuCodeRaw, packCode, deliveryNumber
   FROM sampling_usage_log
   ORDER BY id DESC LIMIT 1;
   ```
   Expected fields:
   - samplingNo = 135202
   - recipeId not null
   - usageDate = today
   - operatorId = Deepak's user id (NOT NULL, NOT "Harsh" legacy fallback)
   - tinQty = 5
   - dealerNameRaw = "Colour Class Paints" (or whatever billToCustomerName is on the OBD)
   - siteId = Petronet's delivery_point_master.id
   - siteNameRaw = "Petronet Lng Limited 3"
   - skuCodeRaw = "5880384"
   - packCode = "TWENTY_L" (or however the enum encodes 20 LT)
   - deliveryNumber = actual OBD number
5. Check `sampling_recipes` row for (#135202, 5880384, 20 LT): `usageCount` incremented by 1, `lastUsedAt` = now

**T4 — Sampling Library page reflects new TI**
1. Open `/tint/sampling-library`
2. Search for #135202
3. Open detail pane
4. Verify TINTING HISTORY section shows new row with:
   - Date: today
   - Delivery No: actual OBD
   - Dealer: Colour Class Paints
   - Site: Petronet Lng Limited 3
   - SKU: 5880384
   - Qty: 5
   - Operator: **Deepak Vasava** (with avatar initials "DV", NOT "Harsh")
5. Verify USED AT counter for Petronet site bumps by 1

**T5 — Brand new shade (no exact match, no reference list)**
1. Pick a job for a site with zero history
2. Verify "New site" pill in Ship-To card
3. Pick SKU line → SuggestionCard shows empty state (no exact match, no reference list)
4. Operator types pigment values manually: YOX 200, BLK 30
5. Type shade name "PHASE 4 TEST SHADE"
6. Set tin qty 3
7. Save TI
8. Expected popup: "Saved as Sampling #135204" (or whatever MAX+1 is)
9. Click OK → popup closes → samplingNo chip shows #135204 on screen
10. Check DB:
    - `sampling_register` has new row with samplingNo=135204, shadeName="PHASE 4 TEST SHADE", siteId=test site id
    - `sampling_recipes` has new row with samplingNo=135204, skuCode=test SKU, packCode=test pack, YOX=200, BLK=30, isPrimary=true
    - `tinter_issue_entries` has new row with samplingNo=135204

**T6 — Existing shade, new pack variant**
1. Pick a job at Petronet (has existing #135202 for 20 LT)
2. Pick SKU line 5880384 (same SKU) + 4 LT pack (different pack)
3. Expected: SuggestionCard shows REFERENCE LIST section with #135202 (since exact match for 4 LT doesn't exist, but #135202 exists at this site for 20 LT)
4. Click #135202 from reference → pigment chips fill with the 20 LT recipe (operator can edit before save)
5. Operator scales down values: YOX 80, BLK 14, OXR 6
6. Set tin qty 2
7. Save TI
8. Expected popup: "Saved as new 4 LT variant under Sampling #135202"
9. Click OK
10. Check DB:
    - `sampling_register` still has only ONE row for #135202 (NOT a new sampling number)
    - `sampling_recipes` has NEW row for (#135202, 5880384, 4 LT) with the new values, isPrimary=false
    - `tinter_issue_entries` row has samplingNo=135202

**T7 — Reference list (different SKU)**
1. Pick a job at Petronet
2. Pick SKU line 5948211 (different SKU than 5880384) + 20 LT pack
3. Expected: SuggestionCard EXACT MATCH section empty (no usage_log for this SKU yet at Petronet)
4. Expected: REFERENCE LIST section shows #135202 (SKU 5880384, 20 LT) as a reference even though SKU is different
5. Verify operator can click reference card → recipe applies → save creates new sampling number (since this is a different SKU, not just a new pack)

### 7.3 Rollback plan

If T1-T7 reveal a blocker:
1. Revert the code commit (`git revert <sha>`) and push.
2. Schema change is additive (new nullable columns + indexes) → safe to leave in place. No data loss. Old code paths ignore the new columns.
3. If the new endpoint is causing problems → temporarily make it return empty arrays so the UI falls back to "no suggestions" state (effectively reverts to today's behaviour minus the deprecated shade_master suggestions).

### 7.4 Data integrity checks (post-deploy)

Run these queries 24h after rollout:

```sql
-- Count of TIs saved with samplingNo (should be growing)
SELECT COUNT(*) FROM tinter_issue_entries WHERE "samplingNo" IS NOT NULL;

-- Count of usage_log rows written by Phase 4 (operatorId NOT NULL = new data)
SELECT COUNT(*) FROM sampling_usage_log WHERE "operatorId" IS NOT NULL;

-- Spot-check that operator names are real
SELECT u.name, COUNT(*)
FROM sampling_usage_log s
JOIN users u ON u.id = s."operatorId"
WHERE s."operatorId" IS NOT NULL
GROUP BY u.name;

-- New sampling numbers allocated by Phase 4
SELECT samplingNo, shadeName, "createdAt"
FROM sampling_register
WHERE samplingNo > 135202   -- adjust to current MAX before Phase 4
ORDER BY samplingNo DESC LIMIT 20;
```

---

## 8. Risks and edge cases

### 8.1 Race conditions

- **Concurrent new-sampling allocations:** P2002 retry pattern (3 attempts, same as `import_batches.batchRef`). Acceptable.
- **Concurrent variant upserts** on same (samplingNo, skuCode, packCode): last-write-wins per Q6. Acceptable.
- **Operator A and B both saving same TI:** existing optimistic concurrency on tinter_issue_entries (whatever currently exists) handles this. Phase 4 doesn't change this.

### 8.2 Data quality issues

- **OBD with no `import_raw_summary` row** (manual tint entry path): `dealerNameRaw` will be NULL in usage_log. Acceptable. UI gracefully handles em-dash.
- **TI saved with samplingNo but recipe variant doesn't exist** (shouldn't happen but defensive): Mark-Done writes usage_log with `recipeId=null`. Log warning. Don't fail the operation.
- **Order with `customerId=NULL`** (orphan order, rare): `siteId` in usage_log is null. `siteNameRaw` still populated from `shipToCustomerName`. Site-based lookup won't find matches but works.
- **Sampling number conflict from legacy data:** legacy MAX is ~135,000 range. Phase 4 starts allocating from 135,000+. No conflict expected.

### 8.3 Performance

- **Suggest endpoint** runs per SKU-line click. Query is:
  ```sql
  SELECT * FROM sampling_usage_log
  JOIN sampling_recipes ON ...
  WHERE siteId = X
  GROUP BY samplingNo;
  ```
  Indexed on `siteId` from Phase 1. Should be sub-100ms even for high-volume sites.
- **Mark-Done usage_log writes** are sequential, one per TI entry. A job with 20 TI entries → 20 sequential inserts. Acceptable (~2s worst case).
- **Sampling Library list page** unaffected — same queries as before, just sees new rows.

### 8.4 UI risks

- **Suggestion card height** when 3 exact + 5 reference cards visible → might push pigment chips below the fold. Build mockup first, test in browser. Consider compact mode if too tall.
- **Pigment chips don't re-render** when applyShadeToEntry runs (existing bug from Phase 1?): verify the existing flashActive highlight pattern still works after our changes.
- **Confirmation popup blocks workflow** when many TIs in a row: consider toast vs modal. Locked decision = modal. Revisit if operators complain.

### 8.5 Rollout

- Ship to production directly to `main` (per CORE §3 — no feature branches).
- Smart Flow runs one TI on production as smoke test BEFORE telling operators to use new flow.
- If smoke test fails on production → revert immediately, debug locally, retry.
- Send training note to Chandresh/Deepak/Chandrasing ONLY after Smart Flow's smoke test passes.

---

## 9. Out-of-scope (deferred)

Things this spec deliberately does NOT include:

- **Customer/site grouping** (multi-SAP-code sites). Separate phase.
- **TM ability to retroactively edit a completed TI's samplingNo.** Out of scope.
- **Bulk-import samplings via CSV.** Phase 3 already shipped Excel import — that workflow still works for one-off legacy data injection if needed.
- **Operator analytics dashboard** (per-operator productivity, shade variety, etc.). Future phase, requires usage_log to mature first.
- **shade_master deprecation cleanup.** Phase 4 makes shade_master unused-for-writes but doesn't delete the table or migrate existing rows. Cleanup is a separate workstream once usage_log proves stable for 30+ days.
- **TI Report changes** to show samplingNo column. Could be a nice-to-have follow-up.
- **Delivery Challan changes** to show samplingNo on the challan. Could be a nice-to-have follow-up.
- **Sales Officer column population** in Sampling Library detail USED AT table. Depends on site → SO cascade, which is data-dependent. Phase 3 wired the SQL; Phase 4 doesn't touch it.
- **Edit after Mark Done** workflow. Out of scope.
- **Concurrent operator collision UX** (Option B "reservation" pattern from planning session). Decided against — Option C "show on save" wins.

---

## 10. Files affected (summary)

| File | Type | Purpose |
|---|---|---|
| `docs/plans/sampling-register/05-phase4-ti-link.sql` | NEW | Schema bump SQL |
| `prisma/schema.prisma` | MODIFY | Add samplingNo + shadeName fields on TI tables, add back-relations |
| `app/api/sampling-library/suggest/route.ts` | NEW | Suggest endpoint |
| `app/api/sampling-library/_lib/suggest.ts` | NEW | Shared suggest query builder |
| `app/api/tint/operator/tinter-issue/route.ts` (and `[id]/route.ts`) | MODIFY | Accept samplingNo + shadeName, allocate new sampling on demand |
| `app/api/tint/operator/tinter-issue-b/route.ts` (and `[id]/route.ts`) | MODIFY | Same for ACOTONE |
| `app/api/tint/operator/done/route.ts` | MODIFY | Add usage_log writes |
| `app/api/tint/operator/shades/route.ts` | KEEP (deprecated) | Add deprecation comment, don't delete |
| `components/tint/tint-operator-content.tsx` | MODIFY | Remove Save shade toggle, add SuggestionCard, popup wiring, samplingNo chip |
| `components/tint/operator/suggestion-card.tsx` | NEW | The two-section suggestion card |
| `components/tint/operator/save-sampling-popup.tsx` | NEW | Confirmation popup (new sampling / new variant / silent) |
| `lib/sampling-library/types.ts` (if exists) | MODIFY | Suggest response types |
| `docs/CLAUDE_TINT.md` | MODIFY (session end) | Document new flow in §10 |
| `docs/CLAUDE_CORE.md` | MODIFY (session end) | Schema bump v27.2 → v27.3 |

Approximately 4-5 sessions of work based on Phase 3 cadence. Smart Flow's call on whether to chunk further.

---

## 11. Session-end consolidation

After all 20 checklist items done:

1. Draft session-end handoff doc: `code-update-2026-MM-DD-sampling-library-phase-4-shipped.md`
2. Move all 4 Phase 1-4 draft docs into `docs/archive/drafts/2026-Q2/` once consolidated into canonical files
3. Update `CLAUDE_TINT.md §10` with new wiring details (replaces the Phase 1-3 sections; Phase 4 is the "shipped" state going forward)
4. Update `CLAUDE_CORE.md §7.3` schema reference + version bump line
5. Update `CLAUDE.md` router to reflect canonical state v27.3

---

## 12. Engineering rules audit (Phase 4)

Confirm before commit:

- ✅ No `prisma.$transaction` introduced (all sequential awaits)
- ✅ No `prisma db push` (Supabase SQL Editor only)
- ✅ All API routes have `export const dynamic = "force-dynamic"`
- ✅ `tsc --noEmit` passes
- ✅ DB columns camelCase, no `@map`
- ✅ Auth split (Node vs Edge) preserved
- ✅ One commit (or two logical commits) to `main`, smoke test before push
- ✅ Cousin colour budget restored — no extra teal added to operator screen
- ✅ Fixed-table standard (CLAUDE_UI §40) applied if any new table introduced (Phase 4 has no new tables, just card components)

---

*Phase 4 execution spec · Sampling Library · drafted 2026-05-22*
