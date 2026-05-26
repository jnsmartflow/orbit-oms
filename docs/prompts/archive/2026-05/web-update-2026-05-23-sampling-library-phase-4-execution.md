# Sampling Library Phase 4 — Execution Handoff (2026-05-23)

**Status:** SHIPPED
**Production deploys:** commits `3ae2f79e` + `b4fe2dc2` on `main`
**Session length:** full Saturday session

---

## 1. What shipped

Phase 4 turns the Sampling Library from a read-only catalogue (Phase 3) into a live participant in the depot's tinting workflow. Every Tinter Issue now writes through the library: operators either pick an existing sampling from the on-screen suggestion picker (which surfaces shades historically used at the same site) or type a fresh shade name to allocate a brand-new sampling number. The new series — `26-XXXX` — uses a calendar-year prefix and a 4-digit counter, allocated race-safely on save via the `next_sampling_no(year_prefix)` Postgres helper.

The operator screen has been re-architected around this flow. The old "Save shade" toggle is gone; the shade name input is always visible. Suggestion picker shows up to 3 exact matches (same SKU + pack at this site) plus up to 5 reference shades (other shades used at this site), ranked by most-recent-use and badged with "Last DD MMM" so freshness is the visual headline. On save, a centred popup confirms the allocated `#26-XXXX` so the operator can copy it to their paper register; the Applied shade bar pill then carries the mono samplingNo prefix as a persistent reminder. A "View all N →" link bridges the picker to the full Sampling Library when the cap hides additional shades.

Tint Manager assignment is now gated: clicking Assign on an order whose ship-to customer hasn't been resolved opens the existing `CustomerMissingSheet` first, prompts resolution with an amber warning strip, then auto-chains back to the Assign modal once the master row is created. The Sampling Library search bar was widened to match site name and customer code (not just samplingNo and shadeName) so operators can find prior work at a specific site without remembering the number. The Ship-To badge in the operator screen is now color-coded (violet "New site" / emerald "Repeat site") for at-a-glance state. Engineering rules held: `tsc --noEmit` clean throughout, all routes `dynamic = "force-dynamic"`, the lone `prisma.$transaction` in the assign route was sequentialised per CORE §3.

---

## 2. Schema state (post-Phase-4)

- `sampling_register.samplingNo`: `INT → TEXT` migration shipped. Five total columns across the four relevant tables migrated to match (sampling_register PK, sampling_recipes FK, sampling_usage_log FK, tinter_issue_entries + tinter_issue_entries_b new columns).
- New series format: `26-XXXX` — calendar-year-prefix + 4-digit counter, e.g. `26-0001`.
- `next_sampling_no(year_prefix TEXT)` Postgres function — row-locked allocation against a series-counter table. P2002 retry pattern (3 attempts) wraps it in `app/api/tint/operator/_lib/sampling-resolution.ts`.
- `sampling_usage_log.siteId`: new nullable `Int?` FK to `delivery_point_master`. Back-populated mid-session via name-matching against `customerName` (5,031 rows resolved; 5,586 remain unmatched due to typo variants).
- `tinter_issue_entries.samplingNo` + `shadeName` and `tinter_issue_entries_b.samplingNo` + `shadeName` — Phase 4 linkage columns, round-tripped via the per-id GET endpoint so the Applied bar pill survives reload.
- Confirmed counts at session end: **3,566** sampling_register rows, **10,620** sampling_usage_log rows, `next_sampling_no('26')` reset → returns `26-0001` for Monday's first real allocation.

---

## 3. New API endpoints + contracts

### `GET /api/sampling-library`
List endpoint. Step 16a extended the search clause: a single substring matches against samplingNo, shadeName, **and** via an EXISTS subquery against `sampling_usage_log` joined to `delivery_point_master` — so siteNameRaw, customerCode, and customerName all hit. ORDER BY `lastUsedAt DESC NULLS LAST, samplingNo DESC`. Pagination + count share the same `whereClause` so totals stay consistent.

### `GET /api/sampling-library/suggest`
Two-section payload: `exactMatches` (top 3) + `referenceList` (top 5), both ranked by `lastUsedAt DESC, usageCountAtThisSite DESC` (step 16c flipped the comparator from count-first to recency-first). Plus `siteHistorySummary: { totalTIs, distinctSamplingNos, isNewSite }`. `distinctSamplingNos` doubles as the "View all N" bridge counter — no separate field needed. Filters usage history via `sampling_usage_log.siteId` (step 10d swap from parent-side join), which surfaces ~66 legacy shades whose parent siteId was null but whose usage rows correctly tag the site.

### `GET /api/sampling-library/:samplingNo` (+ `/variants`, `/usage-log`, `/review`)
Detail builder unchanged in shape from Phase 3, but the route handlers + `_lib/detail.ts` were swept in step 10a to accept `samplingNo: string` (was `number`). All Prisma aggregate accesses (`_min/_max/_count/_sum`) defensively use optional chaining + nullish defaults.

### `POST /api/tint/operator/tinter-issue` (+ `tinter-issue-b`)
Three-scenario routing in `resolveSamplingForEntry`:
1. **New sampling** — caller omits `samplingNo` and provides a fresh `shadeName`. Allocates `next_sampling_no('YY')`, creates `sampling_register` parent + first `sampling_recipes` variant, returns `isNewSampling: true`.
2. **New variant** — caller provides existing `samplingNo` but the `(samplingNo, skuCode, packCode)` tuple isn't in `sampling_recipes` yet. Creates a new variant row under the existing parent, returns `isNewVariant: true`.
3. **Update variant** — tuple exists. Updates the existing variant's pigment values (last-write-wins), returns both flags false.

Response: `{ success: number, entries: Array<{ tiEntryId, allocatedSamplingNo, isNewSampling, isNewVariant }> }`. Order positional with request entries[i] so the client can match by index for popup wiring.

### `POST /api/tint/operator/done`
Existing Mark Done endpoint extended in step 8: after order_status_logs writes, calls `writeUsageLogsForAssignment` which iterates combined TINTER + ACOTONE TI rows. Each row → looks up recipeId via `(samplingNo, skuCode, packCode)`, inserts `sampling_usage_log` (with IST-day-aligned `usageDate`, dealer + site denormalised text, structured `siteId` from `order.customerId`), bumps `sampling_recipes.usageCount` + `lastUsedAt`. Per-row try/catch; counters returned as `usageLogRows / usageLogSkipped / usageLogFailed`. Mark Done never fails because of a usage-log write.

### `POST /api/tint/manager/assign`
Step 13d additions:
- `customerMissing` added to the order select; if true, returns `400` with message "Customer master data is missing for this order. Resolve in the Missing Customers sheet before assigning."
- `prisma.$transaction` wrapper removed; the six DB calls run as sequential awaits per CORE §3.
- Each post-validation write has its own try/catch with structured `console.error({ orderId, assignmentId, step, error })` for Vercel-log post-incident triage. User-facing 500s carry which-step-failed copy.

### `POST /api/admin/customers` (existing, unchanged)
Re-used by the `CustomerMissingSheet` flow. After creating a `delivery_point_master` row, runs an `updateMany` that flips `orders.customerMissing = false` + `orders.customerId = customer.id` for every order matching the same `shipToCustomerId`. The TM assign interceptor watches `orders` state for this flip and auto-chains to the Assign modal.

---

## 4. New UI components

### `components/tint/operator/suggestion-card.tsx`
Picker for the operator screen. 3-column grid layout (both sections), 4-line card body (samplingNo + recency / shade name / SKU·pack on reference cards only / pigment chips). Recency badge "Last DD MMM" replaces the prior "N uses" count. Single `<Link>` "View all N →" at the reference section header bridges to `/tint/sampling-library?search=<encoded site name>` when `distinctSamplingNos > shown`. Linked-sampling state was tried mid-session (step 13) then reverted (step 13c) — the picker now stays visible after a samplingNo is bound, and the binding shows in the Applied bar pill below.

### `components/tint/operator/save-sampling-popup.tsx`
Modal confirmation after Save TI. Centred on a `bg-black/40` backdrop, white rounded panel, mono-formatted `#26-XXXX` displayed prominently with "Write this in your paper register." reminder for new-sampling scenario, or "Saved as new {packCode} variant under sampling #XXXX" for new-variant scenario. OK button is the only focusable element (autofocus); Esc closes; backdrop click does **not** close (per spec — explicit acknowledgment required). New-sampling and new-variant scenarios fire popup; update-variant (Scenario 3) saves silently.

---

## 5. Engineering rules preserved

- All API routes: `export const dynamic = "force-dynamic"`.
- No `prisma.$transaction` — the one pre-existing violation (assign route) was sequentialised in step 13d.
- camelCase columns everywhere, no `@map`.
- `npx tsc --noEmit`: **0 errors** throughout the session (held since step 10a sweep).
- All commits direct to `main` (2 total: `3ae2f79e` Phase 4 build + `b4fe2dc2` step 16c/16d UX polish), no feature branches, no PR workflow.
- `npm run lint` triggers Next.js's interactive ESLint setup wizard — ESLint has never been configured in this repo. Not a blocker; flagged in step 14 for Phase 5 adoption.

---

## 6. Key findings + decisions from session

- **Customer master gaps cascade through Phase 4.** Orders with unresolved ship-to codes leave `orders.customerId = null`; new samplings created from those orders end up with `siteId = null` on the parent row; suggestion picker then can't surface them at that site (the per-log siteId is also null since the resolver couldn't write it). Fixed at the front of the funnel via the TM assign interceptor + existing `CustomerMissingSheet`. The orange ⓘ icon already flagged these orders pre-Phase-4 but had no enforcement.
- **Backfill landed mid-session.** 5,031 of 10,617 legacy `sampling_usage_log` rows got `siteId` resolved via case-insensitive `customerName` match against `delivery_point_master`. The remaining 5,586 are typo variants ("ANTILLA HERITAGE" vs "ANTILIA HERITAGE", spacing/punctuation drifts) that need fuzzy matching or manual cleanup. Suggestion endpoint's siteId filter now surfaces 66 additional samplings that were previously invisible due to parent-side siteId being null.
- **Suggestion ranking changed mid-session: usage count → recency.** Step 16c. Reasoning: a 2-year-old shade with 20 uses was dominating the top of fresh sites where the operator wanted to see what's actually being tinted now. Recency-first naturally surfaces active practice, drops stale shades off the cap, and tracks taste shifts automatically. Count was kept as the tiebreaker for identical dates.
- **"View all N →" bridge.** Step 16d. The picker's cap (3 exact + 5 reference) was hiding shades at busy sites — Spinoza Enclove had 9 distinct samplings, picker showed 8 at most. The bridge link uses the step-16a site-name search to navigate to the full list with one click. Counter sourced from existing `siteHistorySummary.distinctSamplingNos` — zero backend churn.
- **Repeat-site badge simplified to binary.** Dropped "· N TIs" count. Operators care about "has this site been here before?", not how many times specifically. The full count is one click away in the Sampling Library detail pane.
- **Linked-sampling card scrapped in favour of pill enhancement.** Step 13 built a "Linked sampling" panel inside SuggestionCard; step 13c reverted it and instead enhanced the Applied shade bar pill with the mono `#samplingNo` prefix. Reasoning: the pill already existed for the picker-click flow, the linked card was a parallel UI for the same signal — pill enhancement is simpler and matches existing patterns.
- **Amber warning strip > toast for blocking flows.** Step 13e moved the "Resolve customer details first" message from a post-cancel `toast.info` to an in-sheet `bg-amber-50` strip. Toast was too late (only fired on cancel — punitive); strip is continuous and informational. The orange ⓘ icon on the kanban row remains the persistent reminder when the sheet is closed.
- **Site history badge color-coded.** Step 16b. Violet (`bg-violet-50 / text-violet-700 / border-violet-200`) for "New site"; emerald for "Repeat site". Distinct from the amber cluster (Pending TI / MISSING) and from the purple-50 Split / green-50 Done canonical semantic tones. Worth noting: violet and emerald aren't pre-existing in the codebase; they were introduced here.

---

## 7. Phase 5 backlog (running tally)

- TM assignment-time customer master validation **(DONE — shipped in step 13d)**
- Customer master quick-add modal **(DONE — pre-existing `CustomerMissingSheet` was reused)**
- Backfill button for orphan `sampling_usage_log.siteId` values (Phase 5) — 5,586 typo-variant rows remain unmatched
- PATCH endpoint reallocation handling: operator who unlinks via the Applied bar Clear × then re-saves can't trigger a fresh `next_sampling_no` allocation through the PATCH path (PATCH only rewrites the TI row; only POST allocates) (Phase 5)
- Auto-select after save: today jumps to the next uncovered line; would be friendlier to remain on the just-saved line so the operator sees the confirmation popup + new linked-pill in context (Phase 5)
- Typo-variant cleanup in `delivery_point_master` / `sampling_usage_log.siteNameRaw` (Phase 5) — e.g. "ANTILLA HERITAGE" → "ANTILIA HERITAGE"
- Sampling Library: action button handlers (edit / deactivate / mark for review) — currently console.log stubs on the detail pane (Phase 5)
- Sampling Library: CSV export from USED AT and TINTING HISTORY tables — currently console.log stubs (Phase 5)
- ESLint config adoption + lint gate in CI (Phase 5) — `npm run lint` currently triggers the Next.js setup wizard
- TM assign route still uses `customerMissing: true` field which only signals "no delivery_point_master row exists" — separate from "delivery_point_master row exists but has incomplete fields (no sales officer, no area)". Phase 5 may want a second-tier gate for incomplete-but-existing customers.
- Two pre-existing Scenario 1 data-capture bugs flagged during step 11a (parent `siteId` and `dealerName` not being written correctly on fresh-shade saves) — observed once on `#26-0001` test row before cleanup; root cause may be in the resolver helper's arg wiring (Phase 5)

---

## 8. Test data cleanup (end of session)

- **3 test samplings deleted:** `26-0001`, `26-0002`, `26-0003` (all the Saturday session's allocations).
- **5 test orders deleted:** `1104, 1105, 1136, 1137, 1186` — fresh OBDs used to exercise the Scenario 1/2/3 paths.
- **1 placeholder customer master row deleted:** id `2676` — the placeholder created via `CustomerMissingSheet` during interceptor testing.
- **`next_sampling_no('26')` reset** → returns `26-0001` for Monday's first real allocation. Series counter rewound so production numbering starts from a clean slate.
- **5,031 backfilled `siteId` values preserved** — these are real production legacy data improvements and stay.
- All deletes were sequential SQL via Supabase SQL Editor (no `prisma db push`, no script).

---

## 9. Monday rollout notes

- **New series starts on first save:** `#26-0001`. Operators should expect the popup to read "Saved as Sampling #26-0001" on the first new shade Monday morning.
- **Operator UX:** SuggestionCard always visible when SKU + pack are picked; color-coded site badge in Ship-To card (violet = first visit here, emerald = we've been here); save confirmation popup on new sampling / new variant; Applied bar pill shows mono `#samplingNo` for the duration of the form.
- **TM:** Assign clicks on the orange-ⓘ rows now open the CustomerMissingSheet with an amber warning strip first; cannot bypass via the API (server returns 400). Once the master row is filled in, the Assign modal auto-chains in.
- **Sampling Library search:** type a site name (e.g. "antilia") or customer code (e.g. "3447146") to find every sampling ever used there. Pre-Phase-4 behaviour (samplingNo + shadeName matching) still works as before.
- **Mark Done now writes usage_log:** every TI row Mark-Done'd adds a `sampling_usage_log` entry with the operator's user, the IST date, and structured siteId via `order.customerId`. Suggestion picker on subsequent shifts will reflect this within the same day.
- **What hasn't changed:** Tint Manager kanban / TM assign flow (other than the gate), Operator pause/resume/skip flows, Mark Done core behaviour, dispatch / challan / TI Report screens — all Phase 1-3 work untouched.

---

*Handoff drafted at session end · two-commit Phase 4 (`3ae2f79e` + `b4fe2dc2`) live on `main` · Vercel auto-deployed · ready for Monday's first allocation.*
