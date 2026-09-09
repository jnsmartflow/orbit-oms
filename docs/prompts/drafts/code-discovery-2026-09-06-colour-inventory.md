# code-discovery-2026-09-06 — Colour inventory (read-only stocktake)

# Scope: LIVE tree only — `app/`, `components/`, `lib/`, plus `tailwind.config.ts`, `app/globals.css`, `public/`.
# Excluded, and why: `archive/**`, `docs/dhruv-review/**`, `docs/_backup_*/**`, `docs/mockups/**`, `scripts/_*` —
# all four are outside `tsconfig.json`'s `include`/inside its `exclude`, so none of them ships. They carry a further
# ~450 teal occurrences that a naive repo-wide sweep would count and that no swap needs to touch.
# Method: `rg` over the live tree, every hex searched case-insensitively, all six colour vectors checked
# (Tailwind class, Tailwind arbitrary value, raw hex in .ts/.tsx, SVG attribute, inline style, rgba()).
#
# 🔴 CORRECTION, 2026-09-09 — THIS DOCUMENT ORIGINALLY SAID FIVE VECTORS. IT IS SIX.
# The sixth is **`rgba()`**, and this report missed it entirely: **17 occurrences across 9 files**
# encode the brand teal as an rgb TRIPLE, which no hex sweep and no class sweep can see.
#   rgba(13,148,136,…)  = #0d9488  — 16×, the mobile CTA pill shadow `0 8px 22px …0.42` on
#                                     Picking, CI and /po, plus the focus halos `…0.10` / `…0.08`
#   rgba(20,184,166,0.12) = #14b8a6 — 1×, components/.../speed-dial-tile.tsx's active halo
# Files: app/po/po-page.tsx · components/picking/picking-board-mobile.tsx ·
# components/picking/picker-my-picks-board.tsx · components/ci/new-return.tsx ·
# components/ci/qty-sheet.tsx · components/ci/submitted-detail.tsx · components/floor/search-box.tsx ·
# app/(place-order)/place-order/components/speed-dial-tile.tsx.
#
# **Why it matters beyond the count:** had the rebrand trusted this report's "five vectors", every
# mobile CTA in Picking, CI and /po would have kept a teal glow under a violet button — a defect
# visible only on a phone, on one state of one control, which is exactly the kind that ships.
# Found on 2026-09-09 during rebrand step 2 by sweeping the tree instead of the map. All 17 were
# converted in commit `c96157ea`. **Any future colour sweep must check six vectors, not five.**
#
# 🔴 SECOND CORRECTION, 2026-09-09 — A PAIRED SIGNAL MUST BE CLASSIFIED AS A PAIR, NEVER ALONE.
# This report classified the Mail Orders **punched row wash** (`mail-orders-table.tsx:852`,
# `bg-teal-50/40`) as STATUS and sent it to `ok`. It never recorded the **left border of the same
# row** (`:862`, `3px solid #0d9488`) — the other half of the same signal. That border fell to the
# BRAND bucket by default and went violet in step 2b, so for two commits a punched row carried a
# GREEN WASH AND A VIOLET BORDER. Fixed in `b585240f`.
#
# The rule this yields, and it generalises well beyond colour: **a wash and its border, a dot and
# its label, a fill and its ring are ONE signal. Classifying either half on its own will silently
# split it, and nothing fails — the two halves just stop agreeing.** When a row/card/chip carries
# more than one colour for one meaning, find every part before assigning a destination to any part.
# Known pairs in this codebase: row wash + row `borderLeft` (mail-orders-table), card fill + inset
# accent + ring (`duplicate-so-tag.tsx`), section dot + section pill (`tint-table-view` SCHEME_MAP),
# chip bg + chip text + chip border (everywhere).
# Every sweep run twice by two different expressions (class-name pass and hex pass) and reconciled.

---

## 1. Summary

1. **There is no central colour definition for the brand.** `tailwind.config.ts` extends `colors` with shadcn HSL variables only (`--primary`, `--border`, …) and **not one teal token**; `app/globals.css` has a `:root` design-token block with `--navy`, `--red`, `--green`, `--amber`, `--violet`, `--blue` — **and no teal at all** (`rg -i 'teal|0d9488' app/globals.css` → zero hits). Every teal in this app is written at its use site.
2. **Teal: 938 occurrences across 163 files** — 880 Tailwind class tokens (520 lines, 150 files) + 58 raw/arbitrary hex (22 files), plus 4 more in `public/` manifests and the icon SVG, plus one keyframe in `tailwind.config.ts`. Violet/purple 179, indigo 44, green 297, amber 625, red 601.
3. **The single biggest risk in the swap is that teal is not only the brand — it is also the IGT delivery-type dot, the "Normal" dispatch priority, the "live sync" indicator, the `ACCESS_SOURCE = user` safety banner, and the CI "Full bill" tag.** A repo-wide `teal-600 → X` would silently repaint six pieces of *data and state* meaning, and one of them (`/admin/access`'s live banner, `CLAUDE_UI.md §63`) is explicitly documented as "must never be softened — being wrong in either direction is dangerous".
4. **Violet is the worse trap of the two, per occurrence.** Almost none of it is decorative: violet means **tint** (droplet, "Tint · Mixing", tint-strip, split label, "With picker"), and 5 files carry a comment naming `components/floor/tint-strip.tsx` as the single owner of `#f5f3ff`/`#5b21b6`/`#7c3aed`. Only ~6 of 103 violet lines are brand-neutral.
5. **The swap is a use-site edit, not a token edit: ~579 lines across ~163 files for teal alone**, and there is no `--brand` variable to change instead. Before any swap, extracting a token layer is cheaper than the swap itself.

---

## 2. Findings A–J

### A. Where colour is defined

**Verdict: colours are written INLINE at each use site. There is no brand token, in any of the three places one could live.**

| Candidate home | File | What it actually holds | Teal? |
|---|---|---|---|
| Tailwind theme extension | `tailwind.config.ts:16-56` | shadcn semantic aliases only — `border`, `input`, `ring`, `background`, `foreground`, `primary`, `secondary`, `destructive`, `muted`, `accent`, `popover`, `card` — each `hsl(var(--…))` | **No** |
| CSS custom properties (shadcn) | `app/globals.css:76-98` (`@layer base { :root }`) + the `.dark` block below it | The same shadcn variables as HSL triples. `--primary: 222.2 47.4% 11.2%` = near-black, **not the brand teal** | **No** |
| CSS custom properties (Orbit design tokens) | `app/globals.css:139-179` — a **second, top-level `:root`**, separate from the shadcn one above | `--border-lt`, `--bg`, `--surface`, `--border`, `--t1..t4`; `--navy`(163) `--navy-mid`(164) `--navy-50`(165) `--navy-100`(166); semantic `--red`(169) `--green`(170) `--amber`(171) `--violet`(172) `--blue`(173), each with `-bg`/`-bd` companions; `--sh0..2` | **No — there is no `--teal`** |
| Tailwind palette | (default Tailwind `teal-*`) | Used directly as class names, 880 times | n/a |

Two consequences worth stating plainly:

- **`--primary` is not the brand.** Anything rendered through the shadcn `<Button variant="default">` gets near-black, not teal. That is why 30 of the 33 `components/ui/button.tsx` consumers override it with `className="… bg-teal-600 …"` (see H).
- **The `:root` token block already proves a token alone is not enough** — `--violet: #7c3aed` exists as a token and is *still* hand-typed as `#7c3aed` at 26 sites, because **nothing reads it**. Verified: `rg 'var\(--(violet|red|green|amber|blue)'` over `app/ components/ lib/` returns **zero** hits. (`--navy` is the sole exception, read by exactly two admin page titles.) A new `--brand` token would inherit the same problem unless the use sites are rewritten at the same time.

One near-miss: `tailwind.config.ts:62` hardcodes `backgroundColor: "#f0fdfa"` (teal-50) inside the `cart-flash` keyframe. It is the only teal in any config file.

### B. Teal inventory

See tables in §3. Headline: **880 class occurrences over 520 lines in 150 files, plus 58 hex occurrences in 22 files.** Shade distribution:

| Shade | Count | Shade | Count |
|---|---|---|---|
| `teal-600` | 355 | `teal-100` | 18 |
| `teal-700` | 242 | `teal-400` | 4 |
| `teal-500` | 107 | `teal-300` | 4 |
| `teal-50` | 97 | `teal-800` | 3 |
| `teal-200` | 49 | `teal-900` | 1 |

Hex forms found (**both cases searched; all live occurrences are lowercase**): `#0d9488` (brand), `#0f766e` (dark), `#f0fdfa` (tint bg), `#ccfbf1`, `#99f6e4`, `#5eead4`, `#2dd4bf`, `#14b8a6`. `#115e59` and `#134e4a` return **zero** hits in the live tree.

One non-Tailwind teal exists and would be missed by every sweep in the brief: **`#E7F4F2`** in `components/ci/ci-rail.tsx:279` and `components/ci/ci-detail-pane.tsx:458,497` — an off-palette teal wash paired with `text-teal-700`. It is the only uppercase-hex colour in the live tree.

### C. Violet inventory

**179 occurrences over 103 lines in 38 files** (77 class + 102 hex). Shades:

| Class | Count | Hex | Count |
|---|---|---|---|
| `purple-50` | 13 | `#7c3aed` | 26 |
| `purple-200` | 12 | `#6d28d9` | 16 |
| `violet-50` | 10 | `#f5f3ff` | 14 |
| `violet-700` | 8 | `#5b21b6` | 14 |
| `violet-600` | 8 | `#ede9fe` | 10 |
| `violet-200` | 8 | `#ddd6fe` | 7 |
| `purple-700` | 8 | `#a78bfa` | 4 |
| `purple-600` | 4 | `#4c1d95` | 4 |
| `purple-500` | 4 | `#e9d5ff` | 3 |
| `violet-500` / `violet-100` | 1 / 1 | `#faf5ff`, `#f3e8ff`, `#8b5cf6`, `#6b21a8` | 1 each |

**Two parallel violet families are in use for the same meanings** — Tailwind `violet-*`/`purple-*` classes AND hand-typed `#7c3aed`/`#5b21b6` arbitrary values — and the codebase knows it: `components/mrn/photos-button.tsx:132-140` says *"🔴 THE SHADE HAS ONE OWNER AND IT IS NOT THIS FILE … always the hexes, never purple-50."* `components/mail-orders/ship-to-card.tsx:40-41` and `app/(mail-orders)/mail-orders/review-view.tsx:2021-2022` name the same owner. `#c4b5fd` returns zero hits.

### D. Indigo inventory

**44 occurrences over 21 lines in 10 files.**

**`#4f46e5` IS the Decorative Projects SMU category colour — confirmed at three independent sites, all citing `CLAUDE_UI.md §1209` as the source of truth:**
- `components/reports/tint-summary-document.tsx:333` — `SMU_DOT["Decorative Projects"] = "#4f46e5"`
- `components/picking/card-atoms.tsx:137` — `"74": { bg: "#eef2ff", fg: "#4f46e5" } // Decorative Projects`
- `components/picking/picking-board-mobile.tsx:744` — `style={{ color: dup ? DUP_SO_TEXT : "#4f46e5" }}`, with the comment at `:733` *"#4f46e5 is UI §1209's own Decorative-Projects value"*

`#6366f1` appears **only** as a pigment/input-focus colour, never as a category: `app/globals.css:293,305` (admin form focus ring) and `components/tint/tint-operator-content.tsx:275,292` (COB/BU1 pigment swatches). The `#1a237e`/`#283593`/`#e8eaf6`/`#c5cae9` navy family in `globals.css` and `lib/tint/shade-colors.ts` is the *admin chrome + Cobalt pigment* palette and is unrelated to indigo-as-category.

### E. Status colours

| Family | Distinct class tokens | Distinct hex | Total occurrences | Consistent? |
|---|---|---|---|---|
| Green / emerald | **16** (`green-50…900` = 10, `emerald-50/100/200/500/600/700` = 6) | 15 | 297 (233 class + 64 hex) | **No — see below** |
| Amber / orange / yellow | **19** (`amber-50…900` = 10, `orange-50/500/600/700` = 4, `yellow-50/100/200/500/700` = 5) | 18 | 625 (508 + 117) | **No** |
| Red / rose | **11** (`red-50…900` = 10, `rose-600` = 1) | 13 | 601 (499 + 102) | **Mostly, with one exception** |

**Green — not consistent, in two distinct ways.**
1. **Two families for one meaning.** `emerald-*` is the Attendance module's green (`status-chip.tsx:21` PRESENT, `calendar-grid.tsx:74`, `confirm-view.tsx:138-140`, `camera-view.tsx:234`, `success-view.tsx:29`, `day-detail-card.tsx:181,218`, `ot-pending-table.tsx:262-263`, `user-detail-panel.tsx:200,226`, `day-summary-view.tsx:110`) while the rest of the app uses `green-*` for the same "good / present / done" idea. Only `app/(admin)/admin/page.tsx:97-99` and `components/tint/tint-operator-content.tsx:1953` mix emerald outside Attendance.
2. **Green is also an ACTION colour, not only a status.** `CLAUDE_UI.md §10` puts Tint Operator's *workflow CTAs* on `bg-green-600` — `components/tint/tint-operator-content.tsx:2525` (`btnGreen`), `components/mrn/end-sheet.tsx:287`, `components/mrn/supervisor-board.tsx:576`. A green button here means "go", not "done". Everything else green does mean done/ready: `board-bits.tsx:147` (`done ? bg-green-600`), `floor/tint-strip.tsx:30,43` (`ready` → `#f0fdf4`/`#15803d`/`#22c55e`), `tint-summary-document.tsx` `DONE_GREEN #15803d` / `FILL_GREEN #16a34a`, `order-audit-history.tsx:76,79` (obd_created / line_added).

**Amber — not consistent; it carries four unrelated jobs.**
- *Status:* waiting / late / half-day (`calendar-grid.tsx:76`, `status-chip.tsx`), the `1d` age badge (`CLAUDE_UI.md §8`, `picking/card-atoms.tsx` `AgeBadge`), OT grace banners.
- *Action:* the Pause CTA `bg-amber-600` (`CLAUDE_UI.md §10`; `board-detail-panel.tsx:185`, `PauseJobModal`).
- *Selection/attention state:* the Mail Orders focused row `bg-amber-50/70` and the ship-to-override 3px amber bar (`CLAUDE_UI.md §23`, `§28`).
- *Data:* the `/admin/access` "differs from role" amber dot (`access-manager.tsx`), the Floor activity Hold dot `#f59e0b` (`detail-activity.tsx:51`), the picking "Mostly same · one picker" bundle stripe `bg-amber-400` (`picking-board-mobile.tsx:705,934,2881,2897`).
- Plus a **fourth hue inside the family**: `orange-600`/`#ea580c` is the **Upcountry** delivery type and the **ACOTONE** tinter type — a data colour living in the amber bucket. `yellow-*`/`#eab308`/`#fefce8` is the Review View active-line highlight only.

**Red — the most consistent of the three, with one systematic exception.** Red is urgent / error / blocker / voided / destructive-confirm everywhere (`CLAUDE_UI.md §3`, `§10`, `§13`), and `bg-red-600` is reliably the destructive button. The exception is **`rose-600` / `#e11d48`**, which is the **Cross-Depot delivery type** dot (`report-params.ts:38`, `CLAUDE_UI.md §3`, `§60`) — a data colour, not a state. The Floor duplicate-SO card treatment (`floor/rail-card.tsx:159-167`, red-50 wash + red-200 hairline + red-500 inset accent) is also data ("this SO appears twice"), not a state.

### F. The orbit mark

**11 live render sites, all hand-inlined — there is no shared `<OrbitMark />` component.** Every one is `viewBox="0 0 22 22"` with `circle r=7` stroke + `circle r=2.2` fill + `circle cx=18 r=2` fill.

| File | Line | Size | What it renders |
|---|---|---|---|
| `components/shared/role-sidebar.tsx` | 213 | 22×22 white on `bg-teal-600` | The operational **sidebar logo tile** |
| `components/admin/admin-sidebar.tsx` | 528 | 22×22 white on `bg-teal-600` | The **admin sidebar** logo tile |
| `components/admin/admin-sidebar.tsx` | 596 | 18×18 white on `bg-teal-600` | Admin sidebar **app-switcher / footer** tile |
| `app/login/page.tsx` | 21 | 22×22 white on `bg-teal-600` | **Login** wordmark lockup |
| `app/po/splash-screen.tsx` | 126 | 112×112 white, `fill="#fff"` | `/po` **PWA splash** over the teal gradient |
| `app/attendance/consent/consent-form.tsx` | 58 | 22×22 white on `bg-teal-600` | Attendance **consent screen** header |
| `components/attendance/attendance-home.tsx` | 78 | 18×18 white on `bg-teal-600` | Attendance **mobile header** |
| `components/attendance/history-calendar.tsx` | 91 | 18×18 white on `bg-teal-600` | Attendance **History header** |
| `components/trip-report/trip-report-page.tsx` | 357 | 18×18 white, `fill="#fff"` | Trip Report **mobile header** band |
| `app/(place-order)/place-order/place-order-page.tsx` | 765 | 16×16 white on `bg-teal-600` | Place Order **top bar** |
| `public/order-demo.html` | 407 | 16×16 | The `/demo` static tutorial page |

Plus the **source of truth for every generated icon**: `public/icon-source.svg` — a 512×512 `<rect fill="#0d9488">` with the same three circles scaled 16.27×, white.

Nothing renders the teal-on-white variant `CLAUDE_UI.md §2` describes (`stroke/fill="#0d9488"`); every live instance is white-on-teal.

### G. Icon and manifest files

**themeColor — set in three places, all `#0d9488`, none of them sharing a constant:**
- `app/layout.tsx:45` — `export const viewport: Viewport = { themeColor: "#0d9488", … }` (app-wide)
- `public/manifest.json:8` — `"theme_color": "#0d9488"` (background `#f9fafb`)
- `public/po.webmanifest:10` — `"theme_color": "#0d9488"` **and** `"background_color": "#0d9488"` (`/po`'s own manifest, `start_url`/`scope` = `/po`)

**Icon generator:** `scripts/generate-icons.mjs` — run by hand (`node scripts/generate-icons.mjs`), uses `@resvg/resvg-js` (devDependency), reads `public/icon-source.svg` and writes **three** PNGs: `icon-192.png` (192), `icon-512.png` (512), `apple-touch-icon.png` (180). Its own header says *"Output PNGs are committed to git — production builds don't re-render. Edit icon-source.svg + re-run + commit if the brand mark changes."* It is **not** wired into any `package.json` script.

**Manifests:** `public/manifest.json` (app-wide, `start_url: "/"`), `public/po.webmanifest` (`/po` only). Both list the same three icon entries (192 any, 512 any, 512 maskable). There is **no favicon.ico** and no `app/icon.*` — `app/layout.tsx:36-42` declares `icon` as the two PNGs and `apple` as `apple-touch-icon.png`.

**Committed static image/icon assets in `public/`:**

| Path | Size | Note |
|---|---|---|
| `public/icon-source.svg` | 391 B | **The brand mark master.** Teal rect + white orbit |
| `public/icon-192.png` | 3.2 KB | generated |
| `public/icon-512.png` | 9.1 KB | generated |
| `public/apple-touch-icon.png` | 3.0 KB | generated (180×180) |
| `public/jsw-dulux-logo.png` | 101 KB | 800×193 transparent PNG-24 — the challan / trip-sheet logo (`CLAUDE_UI.md §32`) |
| `public/akzonobel-logo.png` | 74 KB | legacy |
| `public/JSW DULUX.png` | 2.1 MB | unreferenced source art |
| `public/JSW LOGO.png` | 2.1 MB | unreferenced source art |
| `public/order-demo.html` | 66 KB | `/demo`; carries its own `--teal: #0d9488` CSS variable block at `:12-15` |
| `public/sw.js` | 2.2 KB | push-only service worker, no colour |
| `public/category-images/`, `public/import-templates/` | — | non-brand assets |

### H. How buttons are built

**Both, and the split is almost exactly module-shaped.**

- A shared `components/ui/button.tsx` **does** exist — base-ui + `cva`, 6 variants (`default`/`outline`/`secondary`/`ghost`/`destructive`/`link`) × 9 sizes, coloured entirely from shadcn theme tokens (`bg-primary`, `bg-secondary`, `bg-destructive/10`).
- It is imported by **33 files, 30 of which are `components/admin/*`** (the other three are `components/ui/sheet.tsx`, `components/ui/dialog.tsx` and `components/shared/sign-out-button.tsx`, plus `tint-operator-content.tsx` and `shade-master-content.tsx`). **86 `<Button>` usages** total.
- The rest of the app writes raw `<button className="…">`: **755 sites across 376 scanned `.tsx` files.**
- **And the shared component is overridden almost every time it is used for a primary action.** The single most repeated string in the admin tree is `<Button type="submit" className="flex-1 h-10 text-sm bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold oa-btn-primary">` — 15 near-identical copies (`add-user-sheet.tsx:146`, `areas-table.tsx:320`, `base-colours-table.tsx:308`, `contact-roles-table.tsx:149`, `customer-sheet.tsx:711`, `edit-user-sheet.tsx:154`, `product-categories-table.tsx:289`, `product-names-table.tsx:350`, `routes-table.tsx:280`, `sales-officers-table.tsx:302`, `sku-sheet.tsx:377`, `slot-rules-table.tsx:565`, `slots-table.tsx:373`, `so-groups-table.tsx:337`, `sub-areas-table.tsx:258`, `transporters-table.tsx:366`, `vehicles-table.tsx:408`). Each also carries `oa-btn-primary`, a **fourth** definition of the same button living in `app/globals.css:331-334` — `background: #1a237e !important` (navy). Two brand colours are fighting on the same element; the Tailwind class wins on specificity for `background-color` only because `oa-btn-primary` uses `!important` — so **these buttons actually render NAVY, not teal**.

**Distinct button appearances currently in use — mechanically tallied (78 raw combinations; the meaningful set is below).**

| # | Appearance | Meaning | Example |
|---|---|---|---|
| 1 | `bg-teal-600 hover:bg-teal-700 text-white` | Primary CTA | `app/login/login-form.tsx:100` |
| 2 | `bg-gray-900 hover:bg-gray-800 text-white` | Modal save / neutral confirm | `components/admin/attendance/settings-form.tsx:396` |
| 3 | `bg-gray-800 text-white` | Table/Review nav toggle active | `app/(mail-orders)/mail-orders/mail-orders-page.tsx:1236` |
| 4 | `bg-white border border-gray-200 text-gray-600` | Secondary / outline | `app/(place-order)/place-order/components/cart-panel.tsx:194` |
| 5 | `bg-gray-100 hover:bg-gray-200 text-gray-700` | Passive / Skip (never primary) | `components/tint/tint-operator-content.tsx` Skip CTA |
| 6 | `bg-green-600 text-white` | Tint/MRN **workflow** go | `components/mrn/end-sheet.tsx:287`, `components/mrn/supervisor-board.tsx:576` |
| 7 | `bg-amber-600 hover:bg-amber-700 text-white` | Pause | `components/tint/manager/board-detail-panel.tsx:185` |
| 8 | `bg-red-600 hover:bg-red-700 text-white` | Destructive confirm | `components/picking/cancel-sheet.tsx:139` |
| 9 | `bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed` | Disabled (grey, never faded primary — `UI §10`) | `components/ci/ci-detail-pane.tsx:476` |
| 10 | `bg-teal-50 text-teal-700 border-teal-200` | Selected chip / soft teal action | `components/admin/vehicles-table.tsx:228` |
| 11 | `bg-teal-600 … rounded-full shadow-[0_8px_22px_rgba(13,148,136,0.42)]` | Mobile floating CTA pill | `components/ci/qty-sheet.tsx:131`, `components/picking/picking-board-mobile.tsx:3410` |
| 12 | `bg-gray-200 text-gray-800 hover:bg-gray-300` | Reuse-list "Use" (soft grey) | `components/tint/operator/flat-suggestion-list.tsx:265` |
| 13 | `<Button variant="default">` → `bg-primary` (near-black) | shadcn default, unoverridden | `components/admin/users-table.tsx` |
| 14 | `oa-btn-primary` → `#1a237e !important` navy | Admin CSS class | `app/globals.css:332` |
| 15 | `oa-btn-ghost` → white + `#374151` | Admin CSS class | `app/globals.css:339` |
| 16 | `oa-btn-danger` → `#dc2626 !important` | Admin CSS class | `app/globals.css:346` |
| 17 | `bg-red-500/15 text-red-200` on dark | Lightbox destructive-on-dark | `components/mrn/photo-lightbox.tsx:517` |
| 18 | `bg-white/10 text-white hover:bg-white/20` | Lightbox neutral-on-dark | `components/mrn/photo-lightbox.tsx:519` |

**Implication for a seven-button system:** the target is not 7 vs 18 — it is 7 vs **755 hand-written sites in 3 competing systems** (Tailwind inline, the `cva` component, and three `oa-btn-*` CSS classes with `!important`). The `!important` on `oa-btn-primary`/`oa-btn-danger` must be resolved first, or a new Button component will be overridden by stylesheet in the entire admin tree.

### I. The sidebar rail

**Two sidebars, not one, and they duplicate each other.**

| | Operational | Admin |
|---|---|---|
| File | `components/shared/role-sidebar.tsx` | `components/admin/admin-sidebar.tsx` |
| Width | **72px collapsed → 220px expanded** (`:197`), hover-driven overlay, no click toggle, no persistence | same 72/220 pattern |
| Chrome | `bg-white`, `borderLeft: "3px solid #0d9488"` (`:198` — raw hex inline style), `borderRight: 1px solid #e5e7eb` | `borderLeft: "3px solid #0d9488"` at **three** sites: `:575`, `:585`, `:611` |
| Labels | **Icon-only when collapsed** (`h-[17px] w-[17px]` + a `bg-gray-900` hover tooltip at `:181`); label + role sub-label when expanded | same |
| Active nav | `bg-teal-50 text-teal-700 font-semibold border-l-2 border-teal-600` (`:145`) | `:321`, `:428` — identical string |
| Fed by | `buildNavItems()` / `PAGE_NAV_MAP` | `NAV_SECTIONS` (hand-maintained; **not** `buildNavItems`) |

**The logo tile** (`role-sidebar.tsx:210-219`): a `w-9 h-9` `bg-teal-600 rounded-xl` square with `hover:bg-teal-700`, containing the 22×22 white orbit SVG inlined (§F). When expanded, "Orbit OMS" (14px bold) over the role label (10px gray-400) sits beside it. The admin copy at `:525-533` is byte-identical except `rounded-xl` and a `cursor-pointer`; the footer app-switcher at `:595-600` is a `w-7 h-7 bg-teal-600 rounded-lg` with the 18×18 mark.

**The user block** at the sidebar foot is a second `bg-teal-600` circle (`role-sidebar.tsx:240`, `admin-sidebar.tsx:551`) — so each sidebar has **two** teal fills plus the 3px teal accent, before any nav item is active. That is three-to-four teal elements on a single rail.

### J. The login page

**Two files:** `app/login/page.tsx` (server component, 46 lines — session check + `ROLE_REDIRECTS` bounce, then the shell) and `app/login/login-form.tsx` (client component, ~110 lines — the form).

`page.tsx` renders, top to bottom:
1. `<main>` — `min-h-screen`, centred, **`bg-[#f9fafb]`** (arbitrary value; matches `CLAUDE_UI.md §3` "App bg"), `px-4`
2. A `w-full max-w-sm` column
3. **Brand lockup** (`:19-32`): a `w-9 h-9 bg-teal-600 rounded-[9px]` tile holding the inline 22×22 white orbit SVG, beside the wordmark **"OrbitOMS"** at `text-[22px] font-semibold text-gray-900 tracking-[-0.5px]`
4. **Tagline** (`:31`): *"One system. Zero chaos."* — `text-[12.5px] text-gray-400`
5. **Form card** (`:35-37`): `rounded-xl border border-gray-200 bg-white p-6 shadow-sm`
6. **Footer** (`:40-42`): *"OrbitOMS · Internal Use Only"* — `text-[11px] text-gray-400`

`login-form.tsx` contains: a label **"Email or Mobile Number"** over an `id="email" type="text" autoComplete="username"` input, placeholder *"Enter email or 10-digit mobile"*; a Password input with an Eye/EyeOff toggle button (lucide, 15px, `text-gray-400`); both inputs `focus:border-teal-600` with the `WebkitBoxShadow: "0 0 0 1000px white inset"` autofill override; a red error strip (`border-red-200 bg-red-50` + a `bg-red-500` dot + `text-red-600`); and the submit button `w-full rounded-lg bg-teal-600 … text-white hover:bg-teal-700`.

**No imagery.** No JSW/Dulux logo, no illustration, no background art — teal appears exactly 4 times on the whole page (logo tile, two focus borders, submit button). There is no "Sign in" heading, matching `CLAUDE_UI.md §12`.

---

## 3. Inventories (tables)

### Table B1 — TEAL: every non-BRAND occurrence, exact

| file | line | string | verdict |
|---|---|---|---|
| `components/mail-orders/bill-to-card.tsx` | 26 | `case "IGT": return "bg-teal-600";` | **DATA** |
| `components/mail-orders/ship-to-card.tsx` | 62 | `case "IGT": return "bg-teal-600";` | **DATA** |
| `app/(mail-orders)/mail-orders/review-view.tsx` | 152 | `case "IGT": return "bg-teal-600";` | **DATA** |
| `app/(mail-orders)/mail-orders/mail-orders-table.tsx` | 100 | `case "IGT": return { color: "bg-teal-600", title: "IGT" };` | **DATA** |
| `components/tint/tint-table-view.tsx` | 126 | `if (type === "IGT") return "bg-teal-600";` | **DATA** |
| `components/tint/operator/party-cards.tsx` | 23 | `if (type === "IGT") return "bg-teal-600";` | **DATA** |
| `components/reports/report-params.ts` | 35 | `{ value: "IGT", dot: "#0d9488" }, // teal` | **DATA** |
| `app/(mail-orders)/mail-orders/mail-orders-table.tsx` | 1797 | `customer: 'bg-teal-50 text-teal-600 border-teal-200'` (remark-type map) | **DATA** |
| `components/admin/permissions-manager.tsx` | 20 | `{ slug: "picker", label: "Picker", color: "#0f766e" }` | **DATA** |
| `components/ci/ci-rail.tsx` | 279 | `row.returnType === "full" ? "bg-[#E7F4F2] text-teal-700" : …` | **DATA** |
| `components/ci/ci-detail-pane.tsx` | 497 | `full ? "bg-[#E7F4F2] text-teal-700" : "bg-[#f1f4f5] …"` (`ReturnTypeTag`) | **DATA** |
| `components/ci/ci-detail-pane.tsx` | 284 | `<span className="font-semibold text-teal-700">WHOLE BILL</span>` | **DATA** |
| `components/floor/detail-activity.tsx` | 51 | `e.synthetic ? "bg-[#0d9488]" : isHold ? "bg-[#f59e0b]" : "bg-[#e5e7eb]"` | **DATA** |
| `components/floor/detail-activity.tsx` | 62 | `bg-[#f0fdfa] … text-[#0f766e]` on the `enrichment` source tag | **DATA** |
| `components/picking/picking-board-mobile.tsx` | 705 | `stripe === "teal" ? "bg-teal-500" : "bg-amber-400"` | **DATA** |
| `components/picking/picking-board-mobile.tsx` | 934 | `tone === "teal" ? "bg-teal-500" : "bg-amber-400"` | **DATA** |
| `components/picking/picking-board-mobile.tsx` | 2864, 2870 | `<BundleHeading label="Same material · one picker" tone="teal" />` / `stripe="teal"` | **DATA** |
| `components/attendance/day-summary-view.tsx` | 133 | `isToday ? "bg-teal-500" : "bg-gray-400"` (week bar) | **DATA** |
| `components/attendance/day-summary-view.tsx` | 140 | `isToday ? "text-teal-600 font-semibold" : "text-gray-400"` | **DATA** |
| `components/attendance/calendar-grid.tsx` | 70 | `if (cell.isToday) bgText = "bg-teal-600 text-white font-bold";` — **overrides the emerald/amber/red/blue status ladder below it** | **DATA** |
| `app/po/po-page.tsx` | 2937 | `{ value: "Normal", dot: "bg-teal-500", on: "border-teal-500 bg-teal-50 text-teal-700" }` | **STATUS** |
| `app/(place-order)/place-order/components/cart-panel.tsx` | 435 | `{ value: "Normal", dot: "#0d9488" }` (dispatch priority) | **STATUS** |
| `components/tint/tint-operator-content.tsx` | 1552 | `progressPct < 25 ? "bg-amber-600" : progressPct < 75 ? "bg-teal-600" : "bg-green-600"` | **STATUS** |
| `components/tint/tint-operator-content.tsx` | 1553 | same ladder, text colour `text-teal-700` | **STATUS** |
| `components/tint/manager/board-bits.tsx` | 147 | `done ? "bg-green-600" : "bg-teal-600"` (`OperatorAvatar`) | **STATUS** |
| `components/tint/tint-table-view.tsx` | 204 | `SCHEME_MAP.teal = { … dot: "bg-teal-500" … }` | **STATUS** |
| `components/tint/tint-table-view.tsx` | 644 | `<SectionHeader dotClass="bg-teal-500" label="Pending Assignment" colorScheme="teal" />` | **STATUS** |
| `app/(mail-orders)/mail-orders/mail-orders-table.tsx` | 852 | `isPunched && 'bg-teal-50/40'` (punched row, `UI §23`) | **STATUS** |
| `app/(mail-orders)/mail-orders/review-view.tsx` | 2287 | `done ? "border-teal-600 bg-teal-600 text-white" : …` | **STATUS** |
| `components/shared/order-audit-history.tsx` | 82 | `line_restored: "bg-teal-50 border-teal-200 text-teal-700"` | **STATUS** |
| `components/admin/attendance/settings-toast.tsx` | 27, 29 | `container: "bg-teal-50 border-teal-200 text-teal-900"`, `iconClass: "text-teal-700"` — the "Rollout activated" toast (`UI §50`) | **STATUS** |
| `components/admin/access-manager.tsx` | 210 | `? "border-teal-200 bg-teal-50 text-teal-800"` — **the `ACCESS_SOURCE` live banner** (`UI §63`) | **STATUS** |
| `components/admin/access-manager.tsx` | 222 | `live ? "bg-teal-600" : "bg-amber-600"` | **STATUS** |
| `components/billing/billing-tab-bar.tsx` | 93 | `bg-teal-600 ring-2 ring-teal-600/15` — the `live` dot | **STATUS** |
| `components/billing/billing-picking-tab.tsx` | 349, 350 | `text-teal-700` + `bg-teal-600 ring-[3px]` beside the literal word `live` | **STATUS** |
| `components/picking/picking-board-mobile.tsx` | 4528 | `(free \|\| refreshing ? "bg-teal-600" : "bg-gray-400")` — picker availability | **STATUS** |
| `components/mrn/photo-lightbox.tsx` | 515 | `tone === "ok" ? "bg-teal-600 text-white" : tone === "bad" ? "bg-red-500/15 …"` | **STATUS** |
| `components/ci/ci-detail-pane.tsx` | 458 | `canClose ? "bg-[#E7F4F2] text-teal-700"` — the `Ready` pill | **STATUS** |
| `components/floor/search-box.tsx` | 96 | `t.count > 0 ? "border-[#ccfbf1] bg-white text-[#0f766e]" : "border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]"` | **STATUS** |
| `components/floor/rail-card.tsx` | 167 | `borderColor: highlighted ? "#2dd4bf" : DUP_SO_SOFT_BORDER` — search hit | **STATUS** |
| `components/floor/rail-card.tsx` | 172 | `…, 0 0 0 4px #0d9488` in the search-highlight boxShadow | **STATUS** |
| `components/floor/rail-card.tsx` | 208 | `highlighted ? "bg-white border-teal-400 ring-2 ring-teal-400/25"` | **STATUS** |
| `components/picking/picking-board-mobile.tsx` | 673 | `…, 0 0 0 4px #0d9488` — search-highlight ring | **STATUS** |
| `components/admin/attendance/roster-table.tsx` | 114, 115 | `isSelected ? "#f0fdfa"` / `"3px solid #14b8a6"` — selected row | **STATUS** |
| `components/admin/customers-table.tsx` | 335 | `<Badge className="bg-blue-500 hover:bg-teal-500">Key</Badge>` | **UNKNOWN** |
| `components/mrn/lines-table.tsx` | 728 | `bg-[#f0fdfa] … text-[#0f766e]` on the `+{extra}` batch-count chip | **UNKNOWN** |
| `components/mrn/line-sheet.tsx` | 738 | `bg-teal-50 … text-teal-700` on the photo-count chip | **UNKNOWN** |
| `components/tint/operator/formula-match-modal.tsx` | 213 | `<span className="text-teal-700 font-semibold">×{ratio}</span>` | **UNKNOWN** |
| `components/mrn/photo-capture.tsx` | 312 | `<Check size={13} className="text-teal-600" />` | **UNKNOWN** |
| `components/ci/spine.tsx` | 336 | `{selected && <Check … className="text-teal-600" …/>}` | **UNKNOWN** |
| `lib/mail-orders/email-template.ts` | 144, 156, 158, 161, 175, 367 | `#0d9488` / `#ccfbf1` in the outgoing HTML email (border-top, masthead cell, "ORDERS" label, section rule, phone number) | **UNKNOWN** |

### Table B2 — TEAL: BRAND occurrences, by file

Every remaining teal line. All are brand chrome per `CLAUDE_UI.md §1/§2/§7/§10/§11` — primary CTAs, focus rings (`focus:border-teal-500 focus:ring-teal-500/10`), `accent-teal-600` checkboxes, active nav/tab/segment, selected-row teal-50 washes, logo tiles, avatars, IosToggle ON, module mobile-header bands, floating CTA pills. Verdict for **every row: BRAND.**

| file | teal lines | n |
|---|---|---|
| `app/(admin)/admin/page.tsx` | 73, 74, 75, 110 | 4 |
| `app/(mail-orders)/mail-orders/line-status-panel.tsx` | 155, 248, 249, 250, 251, 254, 267, 279, 300, 318 | 10 |
| `app/(mail-orders)/mail-orders/mail-orders-page.tsx` | 105, 123, 143 | 3 |
| `app/(mail-orders)/mail-orders/mail-orders-table.tsx` | 396, 510, 547, 1107, 1152, 1224, 1259 | 7 |
| `app/(mail-orders)/mail-orders/resolve-line-panel.tsx` | 173, 190, 220, 261 | 4 |
| `app/(mail-orders)/mail-orders/review-view.tsx` | 1067, 1492, 1523, 1570, 1617, 1618, 1637, 1775, 2279, 2657, 2742, 3063 | 12 |
| `app/(mail-orders)/mail-orders/slot-completion-modal.tsx` | 201, 229 | 2 |
| `app/(mail-orders)/mail-orders/tutorial-overlay.tsx` | 303, 330, 353, 371 | 4 |
| `app/(place-order)/place-order/components/big-search-bar.tsx` | 135, 226 | 2 |
| `app/(place-order)/place-order/components/browse-all-families.tsx` | 63 | 1 |
| `app/(place-order)/place-order/components/cart-panel.tsx` | 406, 446, 466, 494, 497, 516, 536, 546, 583, 585 | 10 |
| `app/(place-order)/place-order/components/customer-search.tsx` | 108, 109, 110, 111, 116, 140, 160, 163 | 8 |
| `app/(place-order)/place-order/components/speed-dial-grid.tsx` | 52, 53, 56, 60 | 4 |
| `app/(place-order)/place-order/components/speed-dial-tile.tsx` | 6, 7, 23, 46, 47, 54 | 6 |
| `app/(place-order)/place-order/components/sub-product-tab-bar.tsx` | 55 | 1 |
| `app/(place-order)/place-order/components/variant-cell.tsx` | 9, 170 | 2 |
| `app/(place-order)/place-order/components/variant-grid.tsx` | 386, 402, 415, 439, 465 | 5 |
| `app/(place-order)/place-order/place-order-page.tsx` | 764 | 1 |
| `app/attendance/consent/consent-form.tsx` | 57, 101, 123 | 3 |
| `app/layout.tsx` | 45 (`themeColor: "#0d9488"`) | 1 |
| `app/login/login-form.tsx` | 58, 76, 100 | 3 |
| `app/login/page.tsx` | 20 | 1 |
| `app/mrn/[mrnId]/sheet/page.tsx` | 96, 131 | 2 |
| `app/picking/push-test/push-test-client.tsx` | 233 | 1 |
| `app/po/po-page.tsx` | 235, 512, 535, 541, 563, 2095, 2135, 2178, 2210, 2313, 2502, 2718, 2799, 2844, 2871, 2918, 2996, 3014, 3106, 3115, 3128, 3144, 3172, 3173, 3175, 3177, 3212, 3213, 3224, 3225, 3226, 3267, 3300, 3669, 3670, 3727, 3801, 3811, 3821 | 39 |
| `app/po/splash-screen.tsx` | 89, 90 (`#0e988b → #0d9488 → #0b8579` gradient) | 2 |
| `app/reports/page.tsx` | 88 | 1 |
| `app/trips/[tripNo]/sheet/page.tsx` | 91 | 1 |
| `components/admin/access-manager.tsx` | 266, 292, 300, 309, 393, 485, 496, 611, 612 | 9 |
| `components/admin/add-user-sheet.tsx` | 146 | 1 |
| `components/admin/admin-sidebar.tsx` | 321, 358, 403, 428, 469, 525, 551, 575, 585, 595, 611 | 11 |
| `components/admin/areas-table.tsx` | 194, 242, 320 | 3 |
| `components/admin/attendance/attendance-dashboard.tsx` | 266 | 1 |
| `components/admin/attendance/export-button.tsx` | 40 | 1 |
| `components/admin/attendance/ot-approve-modal.tsx` | 146 | 1 |
| `components/admin/attendance/ot-audit-day-breakdown.tsx` | 19 (`borderLeft: "2px solid #0d9488"`) | 1 |
| `components/admin/attendance/ot-pending-table.tsx` | 233 | 1 |
| `components/admin/attendance/ot-reject-modal.tsx` | 146 | 1 |
| `components/admin/attendance/user-detail-panel.tsx` | 61 | 1 |
| `components/admin/base-colours-table.tsx` | 189, 193, 302, 308 | 4 |
| `components/admin/contact-card.tsx` | 99, 111, 145, 175, 191 | 5 |
| `components/admin/contact-roles-table.tsx` | 90, 145, 149 | 3 |
| `components/admin/csv-import-modal.tsx` | 101 | 1 |
| `components/admin/customer-sheet.tsx` | 71, 633, 641, 672, 711 | 5 |
| `components/admin/customers-split-view.tsx` | 173, 190, 721, 753, 788, 790, 794, 796, 800, 819, 835, 854, 866, 896, 936, 989, 993, 1035, 1232, 1238, 1299, 1339 | 22 |
| `components/admin/customers-table.tsx` | 211, 219 | 2 |
| `components/admin/edit-user-sheet.tsx` | 154 | 1 |
| `components/admin/hide-settings-content.tsx` | 76, 416, 521, 628, 756, 771, 788, 802, 834 | 9 |
| `components/admin/permissions-manager.tsx` | 158, 250, 336, 420, 443 | 5 |
| `components/admin/product-categories-table.tsx` | 187, 191, 283, 289 | 4 |
| `components/admin/product-names-table.tsx` | 206, 210, 344, 350 | 4 |
| `components/admin/RestoreObdModal.tsx` | 195 | 1 |
| `components/admin/removed-orders-content.tsx` | 169 | 1 |
| `components/admin/routes-table.tsx` | 184, 226, 280 | 3 |
| `components/admin/sales-officers-list.tsx` | 36, 179 | 2 |
| `components/admin/sales-officers-table.tsx` | 187, 191, 302 | 3 |
| `components/admin/sku-sheet.tsx` | 362, 370, 377 | 3 |
| `components/admin/skus-table.tsx` | 162, 170 | 2 |
| `components/admin/slot-rules-table.tsx` | 288, 559, 565 | 3 |
| `components/admin/slots-table.tsx` | 228, 346, 354, 359, 367, 373 | 6 |
| `components/admin/so-groups-table.tsx` | 218, 331, 337 | 3 |
| `components/admin/sub-areas-table.tsx` | 154, 158, 258 | 3 |
| `components/admin/sub-skus-manager.tsx` | 77 | 1 |
| `components/admin/transporters-table.tsx` | 215, 219, 360, 366 | 4 |
| `components/admin/users-table.tsx` | 79 | 1 |
| `components/admin/vehicles-table.tsx` | 223, 228, 408 | 3 |
| `components/attendance/attendance-home.tsx` | 77, 87, 192 | 3 |
| `components/attendance/bottom-nav.tsx` | 52 | 1 |
| `components/attendance/check-out-flow.tsx` | 492, 571, 587 | 3 |
| `components/attendance/confirm-view.tsx` | 107 | 1 |
| `components/attendance/day-detail-card.tsx` | 68 | 1 |
| `components/attendance/history-calendar.tsx` | 90, 99 | 2 |
| `components/attendance/status-card.tsx` | 137 (`from-teal-600 to-teal-700` gradient) | 1 |
| `components/billing/billing-picking-tab.tsx` | 20, 394, 512, 592, 638, 801 | 6 |
| `components/billing/billing-ship-to-pencil.tsx` | 125 | 1 |
| `components/ci/ci-detail-pane.tsx` | 476, 540 | 2 |
| `components/ci/ci-rail.tsx` | 236, 251 | 2 |
| `components/ci/new-return.tsx` | 671, 676, 811, 870, 883, 1048, 1203 | 7 |
| `components/ci/qty-sheet.tsx` | 91, 131 | 2 |
| `components/ci/register-export.tsx` | 39, 56, 60 | 3 |
| `components/ci/spine.tsx` | 304 | 1 |
| `components/ci/submitted-detail.tsx` | 150, 430 | 2 |
| `components/floor/assign-bar.tsx` | 160 | 1 |
| `components/floor/cancelled-tab.tsx` | 104, 125, 172 | 3 |
| `components/floor/detail-panel.tsx` | 540, 557, 571, 723, 738 | 5 |
| `components/floor/filter-sheet.tsx` | 83, 88 | 2 |
| `components/floor/floor-board.tsx` | 435, 446 | 2 |
| `components/floor/floor-table.tsx` | 253, 396, 403 | 3 |
| `components/floor/floor-tabs.tsx` | 40 | 1 |
| `components/floor/group-row.tsx` | 61, 191, 212 | 3 |
| `components/floor/hold-bar.tsx` | 53 | 1 |
| `components/floor/hold-tab.tsx` | 73, 96 | 2 |
| `components/floor/pdf-preview.tsx` | 117 | 1 |
| `components/floor/rail-card.tsx` | 17, 154, 307, 329 | 4 |
| `components/floor/search-box.tsx` | 29, 77, 105 | 3 |
| `components/import/import-page-content.tsx` | 91, 94, 479, 494, 563, 578, 699, 884, 910, 949, 968, 1004 | 12 |
| `components/import/sap-preview.tsx` | 239, 258 | 2 |
| `components/mail-orders/so-email-panel.tsx` | 245 | 1 |
| `components/mrn/billing-board.tsx` | 239 | 1 |
| `components/mrn/detail-pane.tsx` | 603, 642 | 2 |
| `components/mrn/line-sheet.tsx` | 655, 818, 1068 | 3 |
| `components/mrn/photo-capture.tsx` | 263, 330, 343 | 3 |
| `components/mrn/print-sheet-button.tsx` | 25 | 1 |
| `components/mrn/rail-card.tsx` | 59, 68 | 2 |
| `components/mrn/supervisor-board.tsx` | 414, 554, 725 | 3 |
| `components/picking/finding-recorder.tsx` | 655 | 1 |
| `components/picking/picker-my-picks-board.tsx` | 1484, 1737, 2091, 2313 | 4 |
| `components/picking/picking-board-mobile.tsx` | 634, 642, 657, 1115, 1118, 1136, 1139, 2639, 2656, 2665, 2736, 2769, 2782, 3410, 3447, 3715, 4001, 4161, 4242, 4312 | 20 |
| `components/push/push-toggle.tsx` | 156 | 1 |
| `components/reports/customise-drawer.tsx` | 17, 24, 31, 38, 189 | 5 |
| `components/reports/reports-top-bar.tsx` | 44, 49 | 2 |
| `components/sampling-library/sampling-library-detail-pane.tsx` | 395 | 1 |
| `components/sampling-library/sampling-library-list-pane.tsx` | 254 | 1 |
| `components/shared/customer-missing-sheet.tsx` | 650, 659, 700, 915, 924, 965, 1064, 1119 | 8 |
| `components/shared/mobile-shell.tsx` | 88 | 1 |
| `components/shared/mobile-shell-context.tsx` | 155, 159, 178 | 3 |
| `components/shared/module-mobile-header.tsx` | 76 | 1 |
| `components/shared/order-audit-history.tsx` | 154 | 1 |
| `components/shared/order-detail-panel.tsx` | 284, 403 | 2 |
| `components/shared/role-nav.tsx` | 25 | 1 |
| `components/shared/role-sidebar.tsx` | 145, 172, 198, 211, 240 | 5 |
| `components/shared/workflow-tab-bar.tsx` | 15, 55, 63, 70, 76 | 5 |
| `components/tint/challan-content.tsx` | 293, 388, 389, 405, 425, 428, 430 | 7 |
| `components/tint/HideObdModal.tsx` | 161, 192 | 2 |
| `components/tint/manager/board-assign-bar.tsx` | 39, 70 | 2 |
| `components/tint/manager/board-bits.tsx` | 308 | 1 |
| `components/tint/manager/board-detail-panel.tsx` | 122, 192, 313 | 3 |
| `components/tint/manager/board-rail.tsx` | 64, 139 | 2 |
| `components/tint/manager/board-table.tsx` | 190 | 1 |
| `components/tint/manual-tint-entry-modal.tsx` | 307, 395, 428, 459 | 4 |
| `components/tint/manual-tint-revert-modal.tsx` | 176, 206 | 2 |
| `components/tint/PauseJobModal.tsx` | 273 | 1 |
| `components/tint/RemoveObdModal.tsx` | 211, 238 | 2 |
| `components/tint/shade-master-content.tsx` | 119 | 1 |
| `components/tint/SkipJobModal.tsx` | 242, 359 | 2 |
| `components/tint/split-builder-modal.tsx` | 376, 431, 460, 527, 563, 602, 672 | 7 |
| `components/tint/ti-report-content.tsx` | 226, 249, 304, 305, 590 | 5 |
| `components/tint/tint-operator-content.tsx` | 1649, 1699, 1869 | 3 |
| `components/tint/tint-table-view.tsx` | 778, 795, 845, 861 | 4 |
| `components/trip-report/trip-report-page.tsx` | 356, 593, 628, 725, 775, 883 | 6 |
| `components/trip-report/trip-sheet-print-button.tsx` | 8 | 1 |
| `components/ui/date-picker-popover.tsx` | 183 | 1 |
| `components/ui/tabs.tsx` | 33 | 1 |
| `components/universal-header.tsx` | 151, 156, 339, 401, 526, 568 | 6 |
| `tailwind.config.ts` | 62 (`"#f0fdfa"` cart-flash keyframe) | 1 |
| `public/manifest.json` | 8 | 1 |
| `public/po.webmanifest` | 9, 10 | 2 |
| `public/icon-source.svg` | 2 | 1 |
| `public/order-demo.html` | 12, 13, 14, 15, 116, 181, 368, 1328 | 8 |

### Table C — VIOLET / PURPLE, every occurrence

| file | line | string | verdict |
|---|---|---|---|
| `app/globals.css` | 172 | `--violet: #7c3aed; --violet-bg: #f5f3ff; --violet-bd: #ddd6fe;` | UNKNOWN (token; **zero readers found**) |
| `app/globals.css` | 260 | `.oa-badge-purple { background:#faf5ff; color:#6b21a8; border-color:#e9d5ff; }` | UNKNOWN (utility; no caller found) |
| `components/floor/tint-strip.tsx` | 30 | `ready ? "bg-[#f0fdf4] text-[#15803d]" : "bg-[#f5f3ff] text-[#5b21b6]"` | **STATUS** (tint ready vs not) |
| `components/floor/tint-strip.tsx` | 43 | `ready ? "bg-[#22c55e]" : "bg-[#7c3aed]"` (progress fill) | **STATUS** |
| `components/floor/status-pill.tsx` | 30 | `withPicker: { label: "With picker", cls: "bg-[#ede9fe] text-[#6d28d9]" }` | **STATUS** |
| `components/floor/progress-bar.tsx` | 10, 18 | `{ key: "withPicker", color: "#a78bfa" }` | **STATUS** |
| `components/floor/detail-panel.tsx` | 145, 153 | `d.isAssigned → "With picker" … bg-[#ede9fe] text-[#6d28d9]` | **STATUS** |
| `components/floor/detail-panel.tsx` | 157, 158, 159 | `Tint · Pending` / `Tint · Assigned` / `Tint · Mixing` — same violet pair | **STATUS** |
| `components/floor/detail-panel.tsx` | 498 | `bg-[#f5f3ff] … text-[#6d28d9]` tint chip | **DATA** (isTint) |
| `components/floor/detail-items.tsx` | 21 | `l.isTint && … bg-[#7c3aed]` line dot | **DATA** |
| `components/floor/hold-tab.tsx` | 110 | `row.isTint && <Droplet … text-[#7c3aed] />` | **DATA** |
| `components/floor/hold-tab.tsx` | 112 | `isRedirect && … text-[#6d28d9] "→ ship-to changed"` | **DATA** |
| `components/floor/cancelled-tab.tsx` | 139, 141 | same droplet + redirect pair | **DATA** |
| `components/floor/floor-table.tsx` | 515 | `style={{ color: "#7c3aed" }}` (tint droplet) | **DATA** |
| `components/floor/floor-table.tsx` | 540 | `text-[#6d28d9]` (ship-to changed) | **DATA** |
| `components/floor/assign-context-banner.tsx` | 49, 64, 74 | `border-l-[#7c3aed] bg-[#f5f3ff] text-[#5b21b6]` assign-context banner | **STATUS** |
| `components/floor/picker-card.tsx` | 55 | `NEEDS_CHECK_TAG = "bg-purple-50 text-purple-700 border-purple-200"` | **STATUS** |
| `components/shared/status-badge.tsx` | 29 | `tint: "bg-violet-50 text-violet-700 border border-violet-200"` | **DATA** (order type) |
| `components/shared/status-badge.tsx` | 68 | `tint: "bg-violet-500"` | **DATA** |
| `components/shared/order-detail-panel.tsx` | 276 | `li.isTinting ? … bg-purple-500 …` | **DATA** |
| `components/picking/picking-board-mobile.tsx` | 509, 530 | `row.isTint && <span className="… text-purple-500">🎨</span>` | **DATA** |
| `components/picking/picking-board-mobile.tsx` | 4545, 4554, 4565, 4575 | `"#6d28d9"` — "With picker" tone, comment cites `floor`'s value | **STATUS** |
| `components/picking/bill-symbols.tsx` | 53 | `const TINT_COLOR = "#e9d5ff"; // 🎨 tint` | **DATA** |
| `components/billing/billing-order-detail-panel.tsx` | 371 | `bg-[#7c3aed]` tint line dot | **DATA** |
| `components/billing/billing-picking-tab.tsx` | 756 | `border-violet-200 bg-violet-50 … text-violet-700` | **STATUS** |
| `components/mail-orders/instructions-strip.tsx` | 54, 87, 90, 100, 108, 118, 123 | `VIOLET_NOTES_DOT = "bg-[#7c3aed]"`; violet tone band `bg-[#f5f3ff]`, `border-l-[#7c3aed]`, `text-[#5b21b6]` | **DATA** (Billing v2 notes band; `UI §28`) |
| `components/mail-orders/ship-to-card.tsx` | 40, 41, 111, 131, 135, 155, 168, 170 | `#f5f3ff` / `#ddd6fe` / `#7c3aed` / `#5b21b6` / `#4c1d95` — the ship-to **override** tinted card | **STATUS** |
| `components/mail-orders/signal-pill.tsx` | 14 | `split: "bg-purple-50 text-purple-700 border-purple-200"` | **DATA** (split signal) |
| `components/mail-orders/signal-pill.tsx` | 22 | `bg-violet-50 text-violet-700 border-violet-200` truck-order pill | **DATA** (`UI §20`) |
| `app/(mail-orders)/mail-orders/review-view.tsx` | 163 | `<Truck … className="text-violet-700" />` | **DATA** |
| `app/(mail-orders)/mail-orders/review-view.tsx` | 1112 | `split: "bg-purple-50 text-purple-600 border-purple-200"` | **DATA** |
| `app/(mail-orders)/mail-orders/review-view.tsx` | 1772, 1778 | notes button `border-[#7c3aed]/40 bg-[#f5f3ff] text-[#5b21b6] hover:bg-[#ede9fe]` | **DATA** |
| `app/(mail-orders)/mail-orders/review-view.tsx` | 2021, 2022, 2066, 2068, 2073, 2098 | notes-band controls, `#ddd6fe` / `#5b21b6` / `#f5f3ff` | **DATA** |
| `app/(mail-orders)/mail-orders/mail-orders-table.tsx` | 74 | `Evening: "bg-purple-500"` — **the Evening slot dot** | **DATA** |
| `app/(mail-orders)/mail-orders/mail-orders-table.tsx` | 864 | `"3px solid #a78bfa"` row-state left border | **STATUS** |
| `app/(mail-orders)/mail-orders/mail-orders-table.tsx` | 1387, 1588 | `bg-purple-50 text-purple-600 border-purple-200` | **DATA** (split) |
| `app/(mail-orders)/mail-orders/mail-orders-table.tsx` | 1796 | `cross: 'bg-purple-50 text-purple-600 border-purple-200'` remark type | **DATA** |
| `components/mrn/photos-button.tsx` | 132-140, 146 | `bg-[#f5f3ff]` photo-count badge; comment names `floor/tint-strip.tsx:30` as owner | UNKNOWN (borrowed shade, no tint meaning here) |
| `components/ci/ci-detail-pane.tsx` | 254, 255, 256, 259 | `bg-[#f5f3ff] border-[#ddd6fe] text-[#7c3aed]/[#4c1d95]/[#6d28d9]` reason callout | **DATA** (return reason) |
| `components/tint/tint-table-view.tsx` | 472, 556 | `bg-purple-50 text-purple-700 border-purple-200` manual-tint pill | **DATA** |
| `components/tint/tint-operator-content.tsx` | 289 | `{ code: "MA1", bg: "#ede9fe", border: "#8b5cf6", text: "#4c1d95" }` | **DATA** (ACOTONE pigment) |
| `components/tint/tint-operator-content.tsx` | 1952 | `bg-violet-50 text-violet-700 border-violet-200` | **STATUS** |
| `components/tint/tint-manager-content.tsx` | 691 | `bg-purple-50 text-purple-600 border-purple-200` | **DATA** (split) |
| `components/tint/split-builder-modal.tsx` | 271, 275, 408, 484, 620 | `text-violet-600` / `bg-violet-50 … border-violet-200` split labels | **DATA** |
| `components/tint/sku-details-sheet.tsx` | 74, 89, 97, 102 | `text-violet-600`, `bg-violet-50/60 border-violet-200`, `bg-violet-100 text-violet-700` — `line.isTinting` | **DATA** |
| `components/tint/operator/history-panel.tsx` | 214, 262 | `bg-purple-50 border-purple-200 text-purple-700` | **DATA** |
| `components/tint/manager/board-table.tsx` | 263 | `bg-[#ede9fe] text-[#6d28d9]` | **STATUS** |
| `components/tint/manager/board-rail.tsx` | 130 | `bg-purple-50 text-purple-700 border-purple-200` title="Manually pulled into tint" | **DATA** |
| `components/tint/manager/board-detail-panel.tsx` | 274 | `bg-violet-50 text-violet-700 border-violet-200` | **DATA** |
| `components/tint/manager/board-bits.tsx` | 95 | `tinting_in_progress: { label: "In Progress", cls: "bg-[#ede9fe] text-[#6d28d9]" }` | **STATUS** |
| `components/admin/permissions-manager.tsx` | 16 | `{ slug: "support", label: "Support", color: "#7c3aed" }` | **DATA** (role colour) |
| `components/admin/customers-split-view.tsx` | 834 | `bg-[#f3e8ff] text-[#7c3aed] border-[#e9d5ff]` premises-type chip | **DATA** |
| `app/(admin)/admin/page.tsx` | 89, 90, 91 | `iconBg="bg-violet-50" iconColor="text-violet-600" valueColor="text-violet-600"` | UNKNOWN (dashboard stat tile) |

### Table D — INDIGO, every occurrence

| file | line | string | verdict |
|---|---|---|---|
| `components/reports/tint-summary-document.tsx` | 333 | `"Decorative Projects": "#4f46e5"` | **DATA — the Decorative Projects category colour** |
| `components/picking/card-atoms.tsx` | 118 | comment: *"indigo #4f46e5, Retail Offtake cyan #0891b2 — which is the source of truth"* | **DATA** |
| `components/picking/card-atoms.tsx` | 137 | `"74": { bg: "#eef2ff", fg: "#4f46e5" }, // Decorative Projects` | **DATA** |
| `components/picking/picking-board-mobile.tsx` | 733 | comment: *"#4f46e5 is UI §1209's own Decorative-Projects value"* | **DATA** |
| `components/picking/picking-board-mobile.tsx` | 744 | `style={{ color: dup ? DUP_SO_TEXT : "#4f46e5" }}` | **DATA** |
| `components/picking/bill-symbols.tsx` | 54 | `const SMU_COLOR = "#c7d2fe"; // the bare SMU number` | **DATA** |
| `app/(mail-orders)/mail-orders/mail-orders-table.tsx` | 75 | `"Late Evening": "bg-indigo-500"` | **DATA — the Late Evening slot dot** |
| `components/admin/permissions-manager.tsx` | 14 | `{ slug: "admin", label: "Admin", color: "#4338ca" }` | **DATA** (role colour) |
| `components/tint/tint-operator-content.tsx` | 275 | `{ code: "COB", bg: "#e0e7ff", border: "#6366f1", text: "#312e81" }` | **DATA** (Cobalt Blue pigment) |
| `components/tint/tint-operator-content.tsx` | 292 | `{ code: "BU1", bg: "#e0e7ff", border: "#6366f1", text: "#312e81" }` | **DATA** (ACOTONE BU1) |
| `lib/tint/shade-colors.ts` | 31 | `COB: { bg:"#e8eaf6", bgFill:"#c5cae9", border:"#7986cb", top:"#283593", topFill:"#1a237e", label:"#1a237e" }` | **DATA** (pigment) |
| `lib/tint/shade-colors.ts` | 49 | `BU1: { … same navy set … }` | **DATA** (pigment) |
| `app/po/po-page.tsx` | 2981, 3452, 3502 | `border-indigo-300 bg-indigo-50 text-indigo-700 font-semibold` | UNKNOWN (selected-state chip on `/po`) |
| `app/globals.css` | 163, 164, 165, 166 | `--navy: #1a237e; --navy-mid: #283593; --navy-50: #e8eaf6; --navy-100: #c5cae9;` | UNKNOWN (admin chrome token) |
| `app/globals.css` | 269, 323 | `color: #1a237e` on `[data-slot="sheet-title"]` and `.oa-form-section` | UNKNOWN (admin chrome) |
| `app/globals.css` | 293, 305 | `border-color: #6366f1 !important` — `.oa-sheet-form` input/textarea focus | UNKNOWN (admin chrome; conflicts with the app-wide teal focus ring) |
| `app/globals.css` | 333, 337 | `.oa-btn-primary { background: #1a237e !important }`, hover `#283593` | UNKNOWN (a **second** primary-button colour) |

### Table E — STATUS COLOURS, representative sites

| family | file | line | string | verdict |
|---|---|---|---|---|
| green | `app/globals.css` | 170 | `--green: #16a34a; --green-bg: #f0fdf4; --green-bd: #86efac;` | STATUS (token; no readers found) |
| green | `components/floor/tint-strip.tsx` | 30, 43 | `ready → "#f0fdf4"/"#15803d"`, fill `"#22c55e"` | STATUS |
| green | `components/reports/tint-summary-document.tsx` | 339, 340 | `DONE_GREEN = "#15803d"`, `FILL_GREEN = "#16a34a"` | STATUS |
| green | `components/tint/manager/board-bits.tsx` | 147 | `done ? "bg-green-600" : "bg-teal-600"` | STATUS |
| green | `components/shared/order-audit-history.tsx` | 76, 79 | `obd_created` / `line_added` → `bg-green-50 …` | STATUS |
| green | `components/mrn/end-sheet.tsx` | 287 | `bg-green-600 … active:bg-green-700` (END button) | **ACTION, not status** |
| green | `components/mrn/supervisor-board.tsx` | 576 | `bg-green-600 text-white active:bg-green-700` | **ACTION, not status** |
| green | `components/tint/tint-operator-content.tsx` | 2525 | `btnGreen = "… bg-green-600 …"` workflow CTA | **ACTION, not status** |
| green | `components/tint/tint-table-view.tsx` | 903, 926 | `<OperatorTd avatarColor="bg-green-600" />` | STATUS (done operator) |
| emerald | `components/attendance/status-chip.tsx` | 21 | `PRESENT: { bg:"bg-emerald-50", border:"border-emerald-200", text:"text-emerald-700" }` | STATUS (**second green family**) |
| emerald | `components/attendance/calendar-grid.tsx` | 74 | `status === "PRESENT" → "bg-emerald-100 text-emerald-700"` | STATUS |
| emerald | `app/(admin)/admin/page.tsx` | 97-99 | `iconBg="bg-emerald-50"` … | UNKNOWN (decorative tile) |
| amber | `app/globals.css` | 171 | `--amber: #d97706; --amber-bg: #fffbeb; --amber-bd: #fcd34d;` | STATUS (token; no readers found) |
| amber | `components/picking/card-atoms.tsx` | `AgeBadge` | `1d` amber / `{n}d` red | STATUS |
| amber | `components/tint/manager/board-detail-panel.tsx` | 185 | `bg-amber-600 …` Pause CTA | **ACTION, not status** |
| amber | `app/(mail-orders)/mail-orders/mail-orders-table.tsx` | 862-864 | focused row amber left border | STATUS (selection) |
| amber | `components/floor/detail-activity.tsx` | 51 | `isHold ? "bg-[#f59e0b]"` | STATUS |
| amber | `components/admin/access-manager.tsx` | 222 | `live ? "bg-teal-600" : "bg-amber-600"` | STATUS |
| amber | `components/picking/picking-board-mobile.tsx` | 705, 934, 2881 | `"Mostly same · one picker"` stripe/dot `bg-amber-400` | **DATA, not status** |
| orange | `components/reports/report-params.ts` | 37 | `{ value: "Upcountry", dot: "#ea580c" }` | **DATA (delivery type)** |
| orange | `components/tint/tint-operator-content.tsx` | (ACOTONE tag) | `orange-500` tinter-type dot (`UI §3`) | **DATA (tinter type)** |
| yellow | `app/(mail-orders)/mail-orders/review-view.tsx` | (active line) | `#fefce8` bg + `3px solid #eab308` | STATUS (active row) |
| red | `app/globals.css` | 169 | `--red: #dc2626; --red-bg: #fef2f2; --red-bd: #fecaca;` | STATUS (token; no readers found) |
| red | `app/globals.css` | 346-351 | `.oa-btn-danger { background:#dc2626 !important }` hover `#b91c1c` | ACTION |
| red | `components/picking/cancel-sheet.tsx` | 139 | `bg-red-600` destructive confirm | ACTION |
| red | `components/floor/search-box.tsx` | 96 | zero-result token → `bg-[#fef2f2] text-[#b91c1c]` | STATUS |
| red | `components/shared/order-audit-history.tsx` | 81 | `line_removed: "bg-red-50 border-red-200 text-red-700"` | STATUS |
| red | `components/shared/duplicate-so-tag.tsx` | 53-128 | 16 exported `DUP_SO_*` constants — `#dc2626`, `#b91c1c`, `#fecaca`, `#fef2f2`, `#fee2e2`, `#ef4444` | **DATA, not status** |
| red | `components/floor/rail-card.tsx` | 159-173 | duplicate-SO soft wash consuming those constants: `DUP_SO_SOFT_SURFACE` / `_BORDER` / `_BAR` | **DATA, not status** |
| rose | `components/reports/report-params.ts` | 39 | `{ value: "Cross Depot", dot: "#e11d48" }` | **DATA (delivery type)** |
| rose | `CLAUDE_UI.md §3` / `§60` | — | Cross = `bg-rose-600` / `#e11d48` | **DATA** |

---

## 4. COUNTS

Live tree (`app/` + `components/` + `lib/`), plus config/public where noted.

| family | class occ. | hex occ. | total | lines | files | BRAND | DATA | STATUS | UNKNOWN |
|---|---|---|---|---|---|---|---|---|---|
| **teal** | 880 | 58 (+13 in config/public) | **951** | 579 | 163 | ~468 lines | 20 lines | 25 lines | 12 lines |
| **violet / purple** | 77 | 102 | **179** | 103 | 38 | ~6 lines | 61 lines | 30 lines | 6 lines |
| **indigo** (incl. navy family) | 5 | 39 | **44** | 21 | 10 | 0 | 12 lines | 0 | 9 lines |
| **green / emerald** | 233 | 64 | **297** | — | — | 0 | ~10 | ~250 | ~37 (decorative tiles) |
| **amber / orange / yellow** | 508 | 117 | **625** | — | — | 0 | ~60 (Upcountry, ACOTONE, bundle stripe) | ~520 | ~45 |
| **red / rose** | 499 | 102 | **601** | — | — | 0 | ~25 (Cross, duplicate-SO) | ~550 | ~26 |

Verdict counts are per **line**, not per token — a single line often carries `bg-teal-50 text-teal-700 border-teal-200` (3 tokens, 1 decision). Teal line verdicts sum to 525 against 520 unique lines because five lines appear in both the class sweep and the hex sweep.

Distinct shades in use:

| family | distinct Tailwind tokens | distinct hex |
|---|---|---|
| teal | 10 (`50,100,200,300,400,500,600,700,800,900`) | 8 (+`#E7F4F2` off-palette) |
| violet + purple | 11 | 13 |
| indigo (+navy) | 4 | 11 |
| green + emerald | **16** | 15 |
| amber + orange + yellow | **19** | 18 |
| red + rose | **11** | 13 |

---

## 5. 🔴 DANGER LIST — what a find-and-replace would break

Every row below is a colour that means **something other than "this is Orbit"**. A blanket swap repaints the meaning and nothing fails, compiles wrong, or shows up in a screenshot diff.

### Teal that is NOT brand

| # | file:line | What it means today | What breaks |
|---|---|---|---|
| 1 | `components/mail-orders/bill-to-card.tsx:26`<br>`components/mail-orders/ship-to-card.tsx:62`<br>`app/(mail-orders)/mail-orders/review-view.tsx:152`<br>`app/(mail-orders)/mail-orders/mail-orders-table.tsx:100`<br>`components/tint/tint-table-view.tsx:126`<br>`components/tint/operator/party-cards.tsx:23`<br>`components/reports/report-params.ts:35` | **IGT** delivery type (`CLAUDE_UI.md §3`) | Seven sites, one meaning. Swap them and IGT becomes the new brand colour — and if the new brand is (say) violet, IGT collides with *tint*. **These must move to a colour of their own, not to the new brand.** |
| 2 | `components/admin/access-manager.tsx:210, 222` | The **`ACCESS_SOURCE` live banner** — teal = "per-person ticks are live", amber = "not live" | `CLAUDE_UI.md §63`: *"it must never be softened into one hedged sentence — being wrong in either direction is dangerous."* If teal becomes the ambient brand, the live/not-live distinction stops reading as a signal. |
| 3 | `components/billing/billing-tab-bar.tsx:93`<br>`components/billing/billing-picking-tab.tsx:349, 350` | The **live-sync dot** beside the literal word `live` | Loses the "this is fresh" signal against a teal-everywhere page. |
| 4 | `app/po/po-page.tsx:2937`<br>`app/(place-order)/place-order/components/cart-panel.tsx:435` | Dispatch priority **Normal** (teal) vs Urgent (amber) vs Call (red) | A three-colour priority ladder loses its low rung. |
| 5 | `components/tint/tint-operator-content.tsx:1552, 1553` | Progress **25–75%** (amber <25 → teal → green >75) | Three-stop progress ladder loses its middle. |
| 6 | `components/tint/manager/board-bits.tsx:147` | `OperatorAvatar`: `done ? green : teal` | "Not done yet" becomes indistinguishable from chrome. |
| 7 | `components/tint/tint-table-view.tsx:204, 644` | Section dot for **Pending Assignment** (teal vs amber vs blue vs green) | Four-section colour key loses one section. |
| 8 | `components/ci/ci-rail.tsx:279`<br>`components/ci/ci-detail-pane.tsx:458, 497, 284` | **`returnType === "full"`** ("Full bill" vs "Part") and the **`Ready`** close-pill. Uses off-palette **`#E7F4F2`** | ⚠ `#E7F4F2` is **uppercase** and not a Tailwind hex — every sweep in the brief would miss it. |
| 9 | `app/(mail-orders)/mail-orders/mail-orders-table.tsx:852` | **Punched** row wash `bg-teal-50/40` (`UI §23`) | Punched rows stop being visually separable. |
| 10 | `app/(mail-orders)/mail-orders/review-view.tsx:2287` | `done ? "border-teal-600 bg-teal-600 text-white"` | Done/not-done pill collapses. |
| 11 | `app/(mail-orders)/mail-orders/mail-orders-table.tsx:1797` | Remark type **`customer`** in a 5-colour map (gray/gray/purple/teal/amber) | One category of the remark key disappears. |
| 12 | `components/shared/order-audit-history.tsx:82` | Audit event **`line_restored`** in a 5-colour event key | Restored becomes indistinguishable from created/added (green). |
| 13 | `components/admin/permissions-manager.tsx:20` | Role colour for **`picker`** (`#0f766e`), in a per-role palette alongside `admin #4338ca`, `support #7c3aed` | The role legend loses one entry. |
| 14 | `components/floor/detail-activity.tsx:51, 62` | **`e.synthetic`** — an event written by the dispatch engine, vs amber Hold, vs grey manual | You can no longer tell an automatic slot from a human's. |
| 15 | `components/picking/picking-board-mobile.tsx:705, 934, 2864, 2870` | Bundle confidence: teal = **"Same material · one picker"**, amber = "Mostly same" | The two bundle kinds merge. |
| 16 | `components/attendance/calendar-grid.tsx:70` | **Today** — deliberately overrides the emerald/amber/red/blue status ladder below it | Today stops being findable in a month grid. |
| 17 | `components/attendance/day-summary-view.tsx:133, 140` | **Today's** bar in the week chart (teal vs gray-400) | Same. |
| 18 | `components/mrn/photo-lightbox.tsx:515` | `tone === "ok"` (paired with `bad` = red) | Confirm/reject pair loses its positive half. |
| 19 | `components/floor/search-box.tsx:96` | Token with **hits** (teal) vs **zero hits** (red) | Search feedback halves. |
| 20 | `components/floor/rail-card.tsx:167, 172, 208`<br>`components/picking/picking-board-mobile.tsx:673` | **Search-hit highlight** ring / border (`#0d9488`, `#2dd4bf`, `teal-400`) | The hit ring stops being a hit ring. |
| 21 | `components/admin/attendance/roster-table.tsx:114, 115` | **Selected** roster row (`#f0fdfa` + `3px solid #14b8a6`) | Selection lost on a table with no other selected treatment. |
| 22 | `components/picking/picking-board-mobile.tsx:4528` | Picker **available** vs busy (`bg-teal-600` / `bg-gray-400`) | Assign sheet stops showing who is free. |
| 23 | `components/admin/attendance/settings-toast.tsx:27, 29` | Toast variant **"Rollout activated"** — teal, distinct from gray-900 "saved", amber "re-consent", red error (`UI §50`) | Four toast variants become three. |

### Violet that is NOT decorative — the whole family, effectively

| # | file:line | What it means today |
|---|---|---|
| 24 | `components/floor/tint-strip.tsx:30, 43` | **The single owner** of `#f5f3ff` / `#5b21b6` / `#7c3aed` — 5 other files' comments point here. Tint **not ready** (violet) vs **ready** (green) |
| 25 | `components/floor/status-pill.tsx:30`, `detail-panel.tsx:145, 153, 157, 158, 159`, `progress-bar.tsx:18`, `manager/board-table.tsx:263`, `manager/board-bits.tsx:95`, `picking-board-mobile.tsx:4565, 4575` | **"With picker"** and **Tint · Pending / Assigned / Mixing** — `#ede9fe` / `#6d28d9` |
| 26 | `components/shared/status-badge.tsx:29, 68`, `order-detail-panel.tsx:276`, `picking-board-mobile.tsx:509, 530`, `bill-symbols.tsx:53`, `floor/detail-items.tsx:21`, `floor/hold-tab.tsx:110`, `floor/cancelled-tab.tsx:139`, `floor/floor-table.tsx:515`, `billing-order-detail-panel.tsx:371`, `tint/sku-details-sheet.tsx:74, 89, 97, 102` | **`isTint` / `isTinting`** — the tint droplet and 🎨 marker, app-wide |
| 27 | `components/mail-orders/signal-pill.tsx:14`, `review-view.tsx:1112`, `mail-orders-table.tsx:1387, 1588`, `tint-manager-content.tsx:691`, `tint/split-builder-modal.tsx:271, 275, 408, 484, 620` | **Split** signal / split labels (`UI §20`) |
| 28 | `components/mail-orders/signal-pill.tsx:22`, `review-view.tsx:163` | **Truck-order** pill (`UI §20`) |
| 29 | `components/mail-orders/ship-to-card.tsx:111, 131, 135, 155, 168, 170` | **Ship-to override captured** — the tinted card + `⚑ captured` pill (`UI §28`) |
| 30 | `components/mail-orders/instructions-strip.tsx:54, 87, 90, 100, 108, 118, 123`, `review-view.tsx:1772-1778, 2021-2098` | The Billing v2 **notes band** `tone="violet"` (`UI §28`) |
| 31 | `app/(mail-orders)/mail-orders/mail-orders-table.tsx:74` | **Evening slot** dot `bg-purple-500` — one of 5 slot colours |
| 32 | `components/tint/tint-operator-content.tsx:289` | **ACOTONE MA1 pigment** swatch `#ede9fe`/`#8b5cf6`/`#4c1d95` — a physical paint colour |
| 33 | `components/floor/picker-card.tsx:55` | `NEEDS_CHECK_TAG` |
| 34 | `components/tint/tint-table-view.tsx:472, 556`, `manager/board-rail.tsx:130`, `manager/board-detail-panel.tsx:274`, `operator/history-panel.tsx:214, 262` | **Manually pulled into tint** |
| 35 | `components/ci/ci-detail-pane.tsx:254-259` | CI **return reason** callout |
| 36 | `components/admin/permissions-manager.tsx:16` | Role colour for **`support`** (`#7c3aed`) |
| 37 | `components/admin/customers-split-view.tsx:834` | **Premises type** chip |
| 38 | `app/(mail-orders)/mail-orders/mail-orders-table.tsx:864` | Row-state left border `#a78bfa` |

### Indigo that is NOT decorative

| # | file:line | What it means today |
|---|---|---|
| 39 | `components/reports/tint-summary-document.tsx:333`, `components/picking/card-atoms.tsx:137`, `components/picking/picking-board-mobile.tsx:744` | **`#4f46e5` = Decorative Projects SMU.** Three call sites, all citing `UI §1209` as the source of truth, all hardcoded because *"nothing importable exists"* (`card-atoms.tsx:122-127`) |
| 40 | `app/(mail-orders)/mail-orders/mail-orders-table.tsx:75` | **Late Evening slot** dot `bg-indigo-500` |
| 41 | `components/admin/permissions-manager.tsx:14` | Role colour for **`admin`** (`#4338ca`) |
| 42 | `components/tint/tint-operator-content.tsx:275, 292`, `lib/tint/shade-colors.ts:31, 49` | **Cobalt Blue / BU1 pigment** swatches — physical paint colours |
| 43 | `components/picking/bill-symbols.tsx:54` | `SMU_COLOR = "#c7d2fe"` |

### Status colours that carry DATA

| # | file:line | What it means today |
|---|---|---|
| 44 | `components/reports/report-params.ts:36-39` | **The delivery-type key**: Local `#2563eb`, Upcountry `#ea580c`, IGT `#0d9488`, Cross `#e11d48`. Four colours, four data values — three of them live in the "status" families |
| 45 | `components/shared/duplicate-so-tag.tsx:53-128` (16 exported constants) → consumed by `components/floor/rail-card.tsx:159-173`, `floor-table.tsx:300`, `detail-panel.tsx`, `picking-board-mobile.tsx:498, 566, 718, 744` | **Duplicate SO** — red wash/hairline/accent. Red here is not an error. This is the app's **only** properly centralised colour set: one module owns the hexes and six files import them |
| 46 | `components/picking/picking-board-mobile.tsx:705, 934, 2881, 2897` | Bundle stripe amber = "Mostly same · one picker" |
| 47 | `CLAUDE_UI.md §3` / tint operator | **ACOTONE** = `orange-500`, TINTER = `blue-600` — tinter type, not state |

### Structural traps (not a colour, but they break the swap)

| # | Where | Trap |
|---|---|---|
| 48 | `app/globals.css:332-351` | `.oa-btn-primary` is `background: #1a237e !important` (**navy**, hover `#283593`) and `.oa-btn-danger` is `#dc2626 !important` (hover `#b91c1c`). 17 admin buttons carry BOTH `bg-teal-600` and `oa-btn-primary` — **they render navy today.** A Tailwind-only swap changes nothing on those 17 buttons |
| 49 | `app/globals.css:293, 305` | `.oa-sheet-form` inputs focus to `#6366f1 !important` while the rest of the app focuses to `teal-500`. A second, competing focus colour |
| 50 | `tailwind.config.ts:62` | `cart-flash` keyframe hardcodes `#f0fdfa`. Config, not a component — easy to miss |
| 51 | `lib/mail-orders/email-template.ts:144-367` | Six teal hexes inside an **outgoing HTML email**. `CLAUDE_UI.md §52`: Outlook strips `color:` on `<td>`. Changing these affects mail already in customers' inboxes' future siblings, not a screen — and cannot be verified by looking at the app |
| 52 | `public/order-demo.html:12-15` | `/demo` carries its own `--teal` / `--teal-dark` / `--teal-light` / `--teal-border` variable block. A separate, third colour system |
| 53 | `public/icon-source.svg:2` + `scripts/generate-icons.mjs` | Changing the mark colour means editing the SVG, **re-running the generator by hand**, and committing three PNGs. Nothing in `package.json` does this |

---

## 6. UNKNOWNS — resolve by hand

| file:line | string | why I could not classify it |
|---|---|---|
| `components/admin/customers-table.tsx:335` | `<Badge variant="default" className="bg-blue-500 hover:bg-teal-500">Key</Badge>` | A **blue** badge with a **teal** hover. Matches no rule in `CLAUDE_UI.md` and no other badge in the app does this. Reads like a copy-paste leftover, but "Key site" could legitimately be a data colour. |
| `components/mrn/lines-table.tsx:728` | `bg-[#f0fdfa] … text-[#0f766e]` on the `+{extra}` batch-count chip | Could be brand accent, or could be "this line has more batches" — a data signal. No comment. |
| `components/mrn/line-sheet.tsx:738` | `bg-teal-50 … text-teal-700` on the photo-count chip | Same shape as the row above. Count chips elsewhere are grey. |
| `components/tint/operator/formula-match-modal.tsx:213` | `<span className="text-teal-700 font-semibold">×{ratio}</span>` | Teal on a **scaling ratio**. Either "this value was computed" (data) or plain emphasis. |
| `components/mrn/photo-capture.tsx:312` / `components/ci/spine.tsx:336` | `<Check … className="text-teal-600" />` | A teal tick. Brand-as-affirmative, or a green-adjacent status the author chose not to make green. |
| `lib/mail-orders/email-template.ts:144, 156, 158, 161, 175, 367` | `#0d9488` masthead / `#ccfbf1` label / `#0d9488` phone | Brand in an **email**, which is outside the app's design system and outside `CLAUDE_UI.md`'s scope. Whether the email rebrands with the app is a product decision, not a code one. |
| `app/globals.css:172` | `--violet: #7c3aed; --violet-bg: #f5f3ff; --violet-bd: #ddd6fe;` | The token **exists and nothing reads it** — every violet in the app hand-types the same hexes. Keep, delete, or wire up? |
| `app/globals.css:260` | `.oa-badge-purple { background:#faf5ff; color:#6b21a8; … }` | No caller found for this class. Same question. |
| `app/globals.css:163-166, 269, 323, 333, 337` | `--navy` family + `.oa-btn-primary` `#1a237e` | Is navy a **second brand colour** for the admin panel, or drift? It is the only place in the app where a primary button is not teal, and it wins via `!important`. ⚠ Unlike the other five semantic tokens, `--navy` **does** have readers — `app/(admin)/admin/roles/page.tsx:12` and `app/(admin)/admin/delivery-types/page.tsx:12`, both `style={{ color: 'var(--navy)' }}` on a page title. |
| `app/globals.css:293, 305` | `border-color: #6366f1 !important` on admin form focus | Same question, one level down: is indigo the admin focus colour on purpose? |
| `app/po/po-page.tsx:2981, 3452, 3502` | `border-indigo-300 bg-indigo-50 text-indigo-700 font-semibold` | Indigo selection chips on `/po`, three sites. Nowhere else in the app uses indigo for selection (everywhere else that is teal). Could be an intentional non-brand selection state, or drift. |
| `app/(admin)/admin/page.tsx:73-75, 89-91, 97-99` | `iconBg`/`iconColor`/`valueColor` = teal / violet / emerald on three dashboard stat tiles | Three tiles, three colour families, no legend. If the colours encode *which metric*, they are DATA; if they are just variety, decoration. |
| `components/mrn/photos-button.tsx:132-146` | `bg-[#f5f3ff]` photo-count badge, with a comment insisting the shade must come from `floor/tint-strip.tsx` | It **borrows the tint shade for something that is not tint** (a photo count). Deliberate reuse of a shade, or an accidental meaning collision? |
| `components/tint/tint-table-view.tsx:204` | `SCHEME_MAP` also defines `blue` and `green` schemes | Only `teal` and `amber` have call sites found. Are `blue`/`green` dead, or reached from a path I did not trace? |

---

## 7. Estimated size of the swap

**Teal only, live tree + config + public:**

| | files | lines |
|---|---|---|
| Tailwind class occurrences | 150 | 520 |
| Raw / arbitrary hex in `.ts`/`.tsx`/`.css` | 22 | ~55 |
| Config (`tailwind.config.ts`) | 1 | 1 |
| `public/` (2 manifests, `icon-source.svg`, `order-demo.html`) | 4 | 12 |
| Inline SVG orbit marks (colour is on the parent tile, mark itself is white) | 10 | 0 |
| **Total, deduplicated** | **163** | **579** |

Plus, if the violet/indigo collision is resolved at the same time (unavoidable if the new brand is anywhere near violet): **+38 files / +103 lines** for violet, **+10 files / +21 lines** for indigo.

**Whole-brand ceiling: ~200 files, ~700 lines.**

Three multipliers on that figure, all of them structural rather than volume:

1. **There is no token to change.** Every one of the 579 lines is a use site. Introducing `--brand` first turns the swap into ~15 files (the token + the components that read it) but is itself a 579-line refactor. The cost is paid either way; the question is whether it is paid once or every time.
2. **57 of the 520 teal lines are not brand** (20 DATA + 25 STATUS + 12 UNKNOWN) and need a *destination colour of their own*, decided per meaning — IGT, live-sync, priority-Normal, tint-progress, search-highlight, today, full-bill, punched, restored, picker-free, "same material", the ACCESS_SOURCE banner. That is ~12 separate design decisions, not one.
3. **Three colour systems currently fight over the same buttons** — Tailwind inline (755 sites), the `cva` component (86 sites), and three `oa-btn-*` classes with `!important` (17 admin buttons that render navy despite carrying `bg-teal-600`). The `!important` must be removed before any swap is verifiable, or the admin tree will silently not change.

---

*Read-only stocktake. No code changed, nothing committed, no fix proposed. Evidence: `rg` sweeps over the live tree 2026-09-06, every hex searched case-insensitively, each family swept twice (class pass + hex pass) and the two reconciled; ambiguous sites resolved by reading the surrounding 15-30 lines. Counts are per occurrence unless a table says "lines".*
