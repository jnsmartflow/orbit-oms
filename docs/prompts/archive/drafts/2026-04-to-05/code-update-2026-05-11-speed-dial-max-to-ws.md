# Claude Code prompt — /place-order speed-dial: rename MAX tile → WS

Save to: `docs/prompts/drafts/code-update-2026-05-11-speed-dial-max-to-ws.md`

---

## Context

The `/place-order` page has a 9-tile speed-dial at the top. Current order:
1 GLOSS · 2 SATIN · 3 PROMISE ENAMEL · **4 MAX** · 5 VT GLO · 6 WOODCARE · 7 STAINER · 8 PRIMER · 9 AQUATECH

Tile #4 ("MAX") is broken — clicking it does nothing.

**Root cause:** The May 2026 Path A taxonomy cleanup renamed the catalog family from `MAX` to `WS` (which now contains 5 sub-product tabs: MAX, PROTECT, DUSTPROOF, RAINPROOF, POWERFLEXX). The speed-dial tile is hardcoded as `family='MAX'`, so the lookup against `mo_order_form_index_v2.family` returns zero rows.

**Goal:** Update the speed-dial tile #4 label from "MAX" → "WS", and the family it targets from "MAX" → "WS". No other behaviour changes.

---

## Hard constraints

- Branch: `main` only. May 2026 branch strategy — direct commit + push to main, no feature branch, no PR. Smoke-test locally before push.
- Stack: Next.js 14 App Router, TypeScript strict mode, Tailwind, shadcn/ui, Prisma, NextAuth v5, Vercel `bom1`.
- **Never** `prisma db push` — schema changes via Supabase SQL Editor + `npx prisma generate`. (None expected here — this is code-only.)
- **Never** `prisma.$transaction` — sequential awaits only.
- All API routes need `export const dynamic = 'force-dynamic'`.
- DB columns are camelCase — `@map` directives must match exactly.
- `npx tsc --noEmit` must pass clean before commit.
- No new npm dependencies.
- PowerShell on Windows uses `;` not `&&` for command chaining (if running terminal commands).
- One commit, one push, Vercel auto-deploys from `main`.

---

## Step 1 — READ-ONLY AUDIT (do not write code yet)

Confirm where the speed-dial tile config lives. Search these locations in order:

1. `app/(place-order)/place-order/components/` — look for files named like `speed-dial*.tsx`, `quick-tiles*.tsx`, `tile-grid*.tsx`
2. `app/api/place-order/quick-tiles/route.ts` — endpoint shape mentioned in `web-update-2026-05-12-place-order-v4-shipped.md`
3. `lib/place-order/` — constants file
4. `app/(place-order)/place-order/page.tsx` — the page component itself

After finding the tile definition, confirm and report back:

1. **Exact file path** containing the tile definition
2. **Shape** of the tile definition — TypeScript const array, DB table, env var, or something else
3. **Field name** used to identify the target family — is it `family`, `familyName`, `targetFamily`, or something else?
4. **Tile structure** — does each tile have separate fields for label + family (so we can rename label only, family only, or both)?
5. **How the click handler resolves family → catalog rows** — direct `mo_order_form_index_v2.family = $tile.family` match, or via an intermediate mapping?

**DO NOT write any code yet.** Just paste back the audit findings.

---

## Step 2 — Plan the change (still no code)

After audit, propose:

1. **Files to modify** (1 or 2 max — this is a tiny change)
2. **Exact diff** in plain English — e.g. "change `family: 'MAX'` to `family: 'WS'` and `label: 'MAX'` to `label: 'WS'`"
3. **Type-safety implications** — any TypeScript types that need updating (unlikely but check)
4. **Whether the tile sortOrder / position changes** — should stay at position 4 in the speed-dial
5. **Any UI string elsewhere** referencing "MAX" tile (e.g. keyboard shortcut hint, search placeholder, help overlay) that also needs updating

---

## Step 3 — Implement (after audit + plan are confirmed)

Only after I confirm the audit and plan:

1. Make the change in the identified file(s)
2. Run `npx tsc --noEmit` to confirm clean compile
3. Smoke-test locally — verify clicking the WS tile opens the WS family on `/place-order`
4. Single commit with message: `fix(place-order): rename speed-dial tile MAX → WS to match catalog family rename`
5. Push to `main`. Vercel auto-deploys.

---

## What success looks like

- Speed-dial tile #4 reads "WS" instead of "MAX"
- Clicking tile #4 opens the WS family showing 5 sub-product tabs (MAX, PROTECT, DUSTPROOF, RAINPROOF, POWERFLEXX)
- Keyboard shortcut `4` opens the same tile
- All other tiles (1-3, 5-9) unchanged
- `tsc --noEmit` clean
- Vercel preview/production builds without errors

---

## Out of scope

- Changing the speed-dial tile ORDER (WS stays at position 4)
- Other speed-dial tile changes (PRIMER, GLOSS, etc. all unchanged)
- Search keyword pipeline updates (`mo_product_keywords`) — Path A change log notes this for Stage E later
- Renaming "Place Order" → "Purchase Order" (separate planned session, see v4 ship draft)
- `/order` mobile page (separate codebase, handled in future merge session)

---

## Reference

- v4 ship draft: `docs/prompts/drafts/web-update-2026-05-12-place-order-v4-shipped.md` (speed-dial v1 design)
- Path A taxonomy changelog: `docs/prompts/drafts/web-update-2026-05-11-place-order-taxonomy-pathA-changelog.md` (Section 5: WS family work)
