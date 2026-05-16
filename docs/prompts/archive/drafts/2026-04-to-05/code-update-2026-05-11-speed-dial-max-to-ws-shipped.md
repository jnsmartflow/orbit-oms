# Code update — /place-order speed-dial: MAX tile → WS

Saved to: `docs/prompts/drafts/code-update-2026-05-11-speed-dial-max-to-ws.md`
Session date: 2026-05-11
Model: Sonnet 4.6 (Claude Code)
Branch: `main` (direct push, per May 2026 strategy)

---

## What changed

Single edit in `lib/place-order/quick-tiles-config.ts`, position 4 tile:

```diff
- { position: 4, type: "family", label: "MAX", parentLabel: "EXTERIORS", familyName: "MAX" }
+ { position: 4, type: "family", label: "WS",  parentLabel: "EXTERIORS", familyName: "WS"  }
```

Both `label` and `familyName` renamed `MAX` → `WS`. `parentLabel` stayed `"EXTERIORS"`.

---

## Why

Path A taxonomy cleanup (see `web-update-2026-05-11-place-order-taxonomy-pathA-changelog.md` section 5) consolidated four separate Dulux Weather Shield product lines into one WS family with 5 sub-product tabs:

| Tab | Source product | SKU count |
|---|---|---|
| MAX | MAX | 73 |
| PROTECT | PROTECT (+ WS CLEAR added) | 51 |
| DUSTPROOF | PROTECT DUSTPROOF | 19 |
| RAINPROOF | RAINPROOF | 40 |
| POWERFLEXX | POWERFLEXX | 62 |

The `mo_order_form_index_v2.family` value was renamed `MAX` → `WS` to match the consolidated taxonomy. But the speed-dial tile at position 4 was hardcoded `familyName: "MAX"`, so `products.filter(p => p.family === "MAX")` returned zero rows. Operator clicking the tile saw no UI change — appeared broken.

Renaming the tile's `label` and `familyName` to `WS` restores the click → family lookup path.

---

## Audit findings (from Claude Code Step 1)

- Speed-dial tiles live in `lib/place-order/quick-tiles-config.ts` as a TypeScript `ReadonlyArray<QuickTile>` constant `QUICK_TILES_V1`.
- Served via `app/api/place-order/quick-tiles/route.ts` (force-dynamic GET endpoint, returns the array verbatim).
- No DB table involvement — purely code-driven config.
- Click handler in `app/(place-order)/place-order/place-order-page.tsx` does direct `products.filter(p => p.family === tile.familyName)` — no intermediate mapping.
- The `QuickTile` type has independent `label` (visual text) and `familyName` (catalog lookup key) fields, so rename was clean.

Other "MAX" string references that did **NOT** need changing:
- `app/(place-order)/place-order/types.ts:13` — JSDoc comment example text. MAX is still a valid `subProduct` value within the WS family, so the comment stays accurate.
- No keyboard help text, search placeholders, speed-dial subtitles, inline hints, or test fixtures reference "MAX" as a tile.

The fix was genuinely localised.

---

## Verification

- `npx tsc --noEmit` passed clean
- Local smoke test: `/place-order` → speed-dial position 4 now reads "WS"
- Click → opens WS family with 5 sub-product tabs (MAX, PROTECT, DUSTPROOF, RAINPROOF, POWERFLEXX)
- Keyboard shortcut `4` opens the same tile
- All other tiles (1-3, 5-9) unchanged

---

## Deployed

- Single commit: `fix(place-order): rename speed-dial tile MAX → WS to match catalog family rename`
- Pushed to `main`
- Vercel auto-deploy succeeded
- Production confirmed working

---

## Constraints honoured

- Branch `main` only (no feature branch, no PR — May 2026 strategy)
- No `prisma db push`
- No `prisma.$transaction`
- No new npm dependencies
- `tsc --noEmit` clean before commit
- API routes touched all retain `export const dynamic = 'force-dynamic'`
- DB columns referenced (none modified) — camelCase preserved

---

## Related

- Path A taxonomy changelog: `docs/prompts/drafts/web-update-2026-05-11-place-order-taxonomy-pathA-changelog.md` — section 5 (WS family) documents the DB-side rename
- v4 ship draft: `docs/prompts/drafts/web-update-2026-05-12-place-order-v4-shipped.md` — speed-dial v1 design
- Source prompt: paste-in prompt for Claude Code Step 1 audit (now consumed)

---

## Follow-ups (deferred — see Path A changelog "Deferred review items")

- PROTECT bucket structure review — RAINPROOF currently has own tab; Dulux markets it as `WS PROTECT RAINPROOF` (sub-line of PROTECT). May regroup later.
- TEXTURE family (RUSTIC + MATT) — not yet integrated into WS or any other family
- Speed dial v2 — operator preference toggle (curated tiles vs auto-data-derived top families) on the horizon
