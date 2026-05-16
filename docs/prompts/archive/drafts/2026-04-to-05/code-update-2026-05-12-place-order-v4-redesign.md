# Claude Code prompt — /place-order v4 redesign implementation

**Save as:** `docs/prompts/drafts/code-update-2026-05-12-place-order-v4-redesign.md`

**Use:** Paste contents into a fresh Claude Code session (Opus). One prompt = one session.

**Estimated effort:** 4-6 hours. Likely 8-12 file additions, 3-5 file deletions, 4-6 file edits. ~600-900 lines net new code.

**Branch state expected at session start:** `feat/place-order-page` checked out, working tree contains the uncommitted section + subgroup work from 2026-05-11 (verify with `git status` before starting).

---

## PROMPT BEGINS BELOW THIS LINE — paste from here onwards

```
We are implementing the v4 redesign of /place-order. The locked design is captured in docs/prompts/drafts/web-update-2026-05-12-place-order-ui-redesign.md and the visual reference HTML mockup is at docs/mockups/place-order/desktop-order-redesign-v4.html.

This session bundles:
1. The v4 redesign implementation (new layout: search + speed dial + variant grid + cart)
2. The uncommitted section + subgroup data foundation from 2026-05-11 (already on disk, must be committed alongside)
3. A new speed dial config + supporting API endpoints
4. Cleanup of v1/v2 layout components (category-grid.tsx, expanded-panel.tsx) that are obsolete

═══ STAGE 0 — READ FILES, CONFIRM, DO NOT WRITE CODE YET ═══

Read these files completely and silently. Do NOT begin implementing.

Canonical context:
1. CLAUDE.md
2. docs/CLAUDE_CORE.md (especially §3 engineering rules, §6 universal header system, §13 sidebar behaviour)
3. docs/CLAUDE_UI.md (full file — neutral aesthetic, ONE teal element rule, fixed table standard, all component specs)
4. docs/CLAUDE_MAIL_ORDERS.md

This session's design + mockup:
5. docs/prompts/drafts/web-update-2026-05-12-place-order-ui-redesign.md (the locked design — primary spec)
6. docs/mockups/place-order/desktop-order-redesign-v4.html (visual reference for spacing, colours, component layout)

Existing /place-order code:
7. app/(place-order)/place-order/place-order-page.tsx (current page composition)
8. app/(place-order)/place-order/components/category-grid.tsx (DELETE later — current sectioned grid; uncommitted section+subgroup work lives here)
9. app/(place-order)/place-order/components/expanded-panel.tsx (DELETE later — current inline expanded variant grid)
10. app/(place-order)/place-order/components/product-search.tsx (or wherever the typeahead is — current search implementation; will be replaced by the new big search bar)
11. Any other components under app/(place-order)/place-order/components/

Supporting data + API:
12. app/api/mail-orders/* — existing mail-order endpoints, for parser stability reference
13. lib/mail-orders/* — parser/enrichment, DO NOT TOUCH but read for context

After reading all of the above, reply with this exact confirmation block, no other content:

  Files read · v72/v5.1/v1.0 confirmed
  Current /place-order layout: <one line summary>
  Uncommitted state on feat/place-order-page: <one line summary of git status output>
  v4 design understood: search + speed dial + variant grid (with optional sub-product tabs) + cart
  Speed dial v1 config: GLOSS, SATIN, PROMISE ENAMEL, MAX, VT GLO, WOODCARE, STAINER, PRIMER, AQUATECH

Then STOP. Wait for me to say "go".

═══ STAGE 1 — VERIFY BRANCH STATE (after I say "go") ═══

Run these and report output:
1. `git branch --show-current` — should be feat/place-order-page
2. `git status` — confirm the uncommitted section + subgroup work is present (look for changes in mo_order_form_index_v2 schema/seed scripts, app/api/place-order route, and components/category-grid.tsx)
3. `git log --oneline -10` — show recent commits for context

If the working tree does NOT have the uncommitted section + subgroup changes, STOP. Do not proceed. Recovery: pull from backup at C:\Users\HP\OneDrive\VS Code\orbit-oms-backup-2026-05-10-1104. I will recover and restart.

If the working tree IS correct, proceed to Stage 2.

═══ STAGE 2 — DIAGNOSIS (no code yet) ═══

Output a short plan covering:

1. List of files to ADD (estimate component names from design doc §Component anatomy)
2. List of files to MODIFY (place-order-page.tsx and any shared layout)
3. List of files to DELETE (category-grid.tsx, expanded-panel.tsx, focus-mode-view.tsx if still present)
4. List of API routes to ADD (per design doc §Data contracts)
5. List of API routes to MODIFY (existing /api/place-order routes that need to thread section/subgroup or change response shape)
6. Any concerns, risks, or ambiguities you spot in the design doc that block implementation

Wait for my approval of this plan before writing any code.

═══ STAGE 3 — IMPLEMENT IN ORDER (after I approve the plan) ═══

Implementation order — do NOT skip ahead. Show me the diff after each step. Wait for me to say "next" before continuing to the next step.

──── STEP 3.1 — Speed dial config + endpoint ────

Create `lib/place-order/quick-tiles-config.ts` with the locked v1 list as a typed array:

  export type QuickTile = {
    position: number;
    type: 'sub-product' | 'family' | 'section';
    label: string;
    parentLabel: string | null;
    familyName?: string;
    subProductId?: number;
    sectionName?: string;
  };

  export const QUICK_TILES_V1: QuickTile[] = [
    { position: 1, type: 'family',      label: 'GLOSS',          parentLabel: 'ENAMELS',    familyName: 'GLOSS' },
    { position: 2, type: 'family',      label: 'SATIN',          parentLabel: 'ENAMELS',    familyName: 'SATIN' },
    { position: 3, type: 'sub-product', label: 'PROMISE ENAMEL', parentLabel: 'ENAMELS',    subProductId: /* resolve from DB */ 0 },
    { position: 4, type: 'family',      label: 'MAX',            parentLabel: 'EXTERIORS',  familyName: 'MAX' },
    { position: 5, type: 'family',      label: 'VT GLO',         parentLabel: 'INTERIORS',  familyName: 'VT GLO' },
    { position: 6, type: 'section',     label: 'WOODCARE',       parentLabel: null,         sectionName: 'WOODCARE' },
    { position: 7, type: 'family',      label: 'STAINER',        parentLabel: 'UTILITY',    familyName: 'STAINER' },
    { position: 8, type: 'family',      label: 'PRIMER',         parentLabel: 'UTILITY',    familyName: 'PRIMER' },
    { position: 9, type: 'family',      label: 'AQUATECH',       parentLabel: 'UTILITY',    familyName: 'AQUATECH' },
  ];

For position 3 (PROMISE ENAMEL sub-product), do a one-time resolution from `mo_order_form_index_v2`:
  SELECT id FROM mo_order_form_index_v2 WHERE family = 'PROMISE ENAMEL' AND "subProduct" IS NULL  -- adjust per schema
or wherever that single sub-product row sits. Hardcode the resolved ID into the config as a comment. If the row doesn't exist in the v2 table yet, FAIL LOUDLY in the seed step rather than guessing.

Add `app/api/place-order/quick-tiles/route.ts`:

  export const dynamic = 'force-dynamic';

  export async function GET() {
    return NextResponse.json(QUICK_TILES_V1);
  }

Run `npx tsc --noEmit`. Show me the output.

──── STEP 3.2 — Family + sub-product + section endpoints ────

Add these routes per design doc §Data contracts. All must have `export const dynamic = 'force-dynamic'`. All must use sequential awaits — NO `prisma.$transaction`.

  app/api/place-order/family/[familyName]/route.ts
  app/api/place-order/sub-product/[subProductId]/route.ts
  app/api/place-order/section/[sectionName]/families/route.ts
  app/api/place-order/last-order/[customerCode]/route.ts
  app/api/place-order/search/route.ts

Each should query mo_order_form_index_v2 + mo_sku_lookup_v2 (the v2 tables from the uncommitted work). Reuse existing helpers if any exist; otherwise write new ones in `lib/place-order/queries.ts`.

Search endpoint: full-text search on `searchTokens` (already a column in mo_order_form_index_v2). Score family-match higher than sub-product-match when query is short (≤4 chars). Limit 10 results.

Run `npx tsc --noEmit` after each route added. Stop and show output if errors.

──── STEP 3.3 — Component skeletons (no logic yet) ────

Create empty/stub components in `app/(place-order)/place-order/components/`:

  speed-dial-grid.tsx
  speed-dial-tile.tsx
  active-product-panel.tsx
  sub-product-direct.tsx
  family-nav-with-tabs.tsx
  section-landing.tsx
  variant-grid.tsx
  sub-product-tab-bar.tsx
  recently-used.tsx
  last-order-recall.tsx
  browse-all-families.tsx
  cart-panel.tsx
  big-search-bar.tsx

Each component: typed props interface matching the design doc, return a placeholder div with the component name. No real rendering yet. This step is to set up the file structure and prop contracts.

Run `npx tsc --noEmit`. Show output.

──── STEP 3.4 — Implement components, leaf-up ────

Implement in this order:

  3.4.1  variant-grid.tsx (the base × pack table — most complex, build first)
  3.4.2  sub-product-tab-bar.tsx
  3.4.3  speed-dial-tile.tsx
  3.4.4  speed-dial-grid.tsx
  3.4.5  big-search-bar.tsx (with debounced search + results dropdown)
  3.4.6  sub-product-direct.tsx (uses variant-grid)
  3.4.7  family-nav-with-tabs.tsx (uses sub-product-tab-bar + variant-grid)
  3.4.8  section-landing.tsx (mini speed dial + delegates to family-nav-with-tabs)
  3.4.9  active-product-panel.tsx (the dispatcher: routes to one of three above based on tile type / search result type)
  3.4.10 recently-used.tsx
  3.4.11 last-order-recall.tsx
  3.4.12 browse-all-families.tsx (uses section + subgroup data from the uncommitted work)
  3.4.13 cart-panel.tsx (port from existing cart, preserve mailto: build exactly)

For each component:
- Match the visual reference HTML mockup (spacing, colours, fonts)
- Follow CLAUDE_UI.md §6 (universal header), §10 (modal/secondary-active gray-900 pattern), and the teal budget rules in the design doc
- Use shadcn/ui components where they fit; otherwise raw Tailwind classes matching the mockup
- Keyboard handlers as per design doc §Keyboard model
- Export named TypeScript types for all props

Run `npx tsc --noEmit` after each component. Show output. STOP if errors.

──── STEP 3.5 — Recompose page ────

Modify `app/(place-order)/place-order/place-order-page.tsx` to use the new component tree:

  <PlaceOrderPage>
    <TopBar /> {/* customer pill, etc */}
    <main className="flex h-[calc(100vh-52px)]">
      <section className="flex-1 bg-gray-50 overflow-y-auto">
        <div className="max-w-[920px] mx-auto p-6">
          <BigSearchBar />
          <SpeedDialGrid tiles={tiles} />
          <ActiveProductPanel state={activeState} />
          <RecentlyUsed />
          <LastOrderRecall customerCode={customer.code} />
          <BrowseAllFamilies />
        </div>
      </section>
      <CartPanel />
    </main>
  </PlaceOrderPage>

State management: top-level `place-order-page.tsx` owns:
- `activeCustomer: Customer | null`
- `activeState: { kind: 'idle' } | { kind: 'sub-product', subProductId } | { kind: 'family', familyName } | { kind: 'section', sectionName, drilledFamily?: string }`
- `cart: CartLine[]` grouped by sub-product
- `searchQuery: string` and `searchResults: SearchResult[]`

Use React Context or props drilling — choose whichever stays cleaner. Keep cart state and active state at the top.

──── STEP 3.6 — Wire up keyboard navigation ────

Implement the keyboard model from design doc §Keyboard model exactly:
- Page-level keydown listener for digits 1-9 (when not in cell + not in search) → opens speed dial tile
- Page-level keydown listener for `/` → click Send Email
- Cell-level keydown listeners for navigation, qty input, esc-to-search-box

Use a focus-management hook in `lib/place-order/use-cell-focus.ts`. The hook returns `{ focusedCell, focusCell, focusNextPack, focusNextBase, focusFirstCell, releaseFocus }`.

──── STEP 3.7 — Delete obsolete files ────

Delete:
- app/(place-order)/place-order/components/category-grid.tsx
- app/(place-order)/place-order/components/expanded-panel.tsx
- app/(place-order)/place-order/components/focus-mode-view.tsx (if still present, per CLAUDE_MAIL_ORDERS.md §17)

Run `npx tsc --noEmit`. Resolve any orphan imports.

──── STEP 3.8 — Mockup file copy ────

Copy `desktop-order-redesign-v4.html` (the locked mockup) into `docs/mockups/place-order/`. This becomes the reference artefact for future visual changes.

  cp /mnt/user-data/outputs/desktop-order-redesign-v4.html docs/mockups/place-order/

(If running on Windows PowerShell:)

  Copy-Item -Path '<source path>' -Destination 'docs\mockups\place-order\'

──── STEP 3.9 — Final tsc + dev test ────

Run:
  npx tsc --noEmit
  npm run dev

Visit /place-order on localhost. Verify:
- Speed dial renders 9 tiles with the locked v1 labels
- Pressing digits 1-9 opens corresponding tile
- Search bar filters live
- Variant grid cells accept qty input via keyboard
- Cart updates instantly
- Send Email opens mailto: with byte-identical output as previous /place-order build (test with a sample order, compare with the existing live mailto: output character-for-character)

Stop and show me the dev server URL + a screenshot path / file list before committing.

═══ STAGE 4 — COMMIT ═══

Single commit, single push. After I approve dev test results:

  git add -A
  git status  # confirm staged changes match what we expect
  git commit -m "feat(place-order): v4 UI redesign + section/subgroup data foundation

  Bundles two pieces of work:
  - v4 redesign: search-driven layout with 9-tile speed dial, sub-product
    tabs only when navigating multi-sub-product families, recently-used
    + last-order-recall + browse-all sections
  - Section + subgroup data foundation (carried over from 2026-05-11):
    schema columns on mo_order_form_index_v2, seed-script grouping,
    API/types threading

  Discards v1/v2 layout: deletes category-grid.tsx, expanded-panel.tsx,
  focus-mode-view.tsx.

  Mailto: email body output preserved byte-identical to previous build —
  parser pipeline untouched.

  Speed dial v1 config (GLOSS / SATIN / PROMISE ENAMEL / MAX / VT GLO /
  WOODCARE / STAINER / PRIMER / AQUATECH) lives in
  lib/place-order/quick-tiles-config.ts and is swappable via the
  /api/place-order/quick-tiles endpoint without frontend changes.

  Mockup: docs/mockups/place-order/desktop-order-redesign-v4.html
  Design doc: docs/prompts/drafts/web-update-2026-05-12-place-order-ui-redesign.md
  "
  git push origin feat/place-order-page

Show me the push output. Confirm Vercel preview build kicked off (URL will be in Vercel dashboard or comment on the push).

═══ HARD CONSTRAINTS — DO NOT VIOLATE ═══

- All API routes: `export const dynamic = 'force-dynamic'` at file top
- NEVER `prisma.$transaction` — sequential awaits only
- Never run `prisma db push` — schema lives in Supabase SQL editor
- All schema column references: camelCase + double-quotes ("subProduct", "skuCount")
- `npx tsc --noEmit` MUST pass at every step boundary (3.1, 3.2, ..., 3.9). If it doesn't, STOP and fix before proceeding.
- No `any` types in new code unless absolutely justified with a comment
- No new dependencies added without my approval (we have Tailwind, shadcn/ui, lucide-react already)
- Do NOT touch lib/mail-orders/* (parser, enrichment)
- Do NOT touch app/(mail-orders)/* (mail orders board)
- Do NOT touch the /order public mobile page
- Do NOT modify mo_orders, mo_order_lines, or any orders table — read-only access
- Mailto: email body output MUST be byte-identical to current build (test by ordering same items in old vs new build, diff the output)
- One commit at the end. Don't make intermediate commits during steps 3.1-3.9.
- Single teal CTA per view (CLAUDE_UI.md). Send Email is the only teal button. Active speed-dial tile, focused cell, filled cells, in-cart dots are teal but not "buttons" — they're state indicators.

═══ POWERSHELL REMINDERS ═══

- Single-quote any path containing parentheses: 'app/(place-order)/...'
- Use ; not && for command chaining
- If npx prisma generate hits EPERM (Windows file lock):
    Get-Process node | Stop-Process -Force
    npx prisma generate
- Working directory must NOT be inside OneDrive sync (causes file lock issues with native binary installs)

═══ OUTPUT EXPECTATIONS ═══

- After each step (3.1-3.9), show me the file diff + tsc output, wait for "next"
- If anything is unclear about the design doc, STOP and ask. Do not guess.
- If a step's complexity exceeds expectation, propose breaking it into sub-steps before continuing.
- Final deliverable: pushed commit, Vercel preview URL, screenshot of /place-order rendering correctly.

═══ END OF PROMPT ═══

START with Stage 0 — read the files and produce the confirmation block.
```

---

## NOTES FOR FUTURE-SMART-FLOW

- **This prompt assumes the mockup file lives at `/mnt/user-data/outputs/desktop-order-redesign-v4.html`** at the time of running. Copy it into the repo's `docs/mockups/place-order/` directory yourself before pasting the prompt — that way Claude Code can reference it locally.
- **The prompt is paced for Opus.** Sonnet would likely struggle with the 13-component build in one session. If Opus is unavailable, split this into 3 sessions: (a) endpoints + config + mockup copy, (b) component skeletons + variant-grid + speed-dial + search, (c) recompose page + keyboard + cart + commit.
- **Step 3.4 (component build) is the longest** and where things will likely need iteration. Don't be surprised if Claude Code asks 2-3 clarifying questions during this step. That's healthy.
- **The PROMISE ENAMEL sub-product ID resolution in step 3.1** depends on the v2 catalog being fully seeded. If `mo_order_form_index_v2` doesn't have a row with family=PROMISE ENAMEL yet, the seed needs to land first. The uncommitted state from 2026-05-11 may or may not have seeded it — verify in Stage 1.
- **The byte-identical mailto: requirement is the riskiest constraint.** Build a sample order in current /place-order, save the mailto: output to a text file, then test the new build against it. If diff shows any change, fix before committing.
- **WOODCARE tile (position 6) is the trickiest tile to implement** because it's a section, not a family — the click flow is two levels deep. Consider whether SectionLanding component can reuse SpeedDialGrid internally for the mini-dial of 7 woodcare families.

---

*Code update prompt · 2026-05-12 · /place-order v4 redesign · Smart Flow + Claude*
