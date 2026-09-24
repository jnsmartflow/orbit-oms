# CLAUDE_UI.md — OrbitOMS UI Design System
# v5.34 · September 2026 · updated 2026-09-24 · No Schema stamp BY DESIGN (decided 2026-08-04) — this file tracks components, not tables · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md

Single source of truth for visual styling across all screens.

---

## 1. Design philosophy

- **Neutral first.** White bg, gray borders, minimal colour.
- **Orbit violet is the brand.** `brand-600` (#7C3AED) is the single brand accent. The token
  families are defined in §2. Teal is not a brand colour: `data.teal` #0D9488 is the IGT
  delivery-type identity and nothing else (§2.1).
- **Three colour roles:**
  - Brand = brand action (commit button, focus, toggles ON, nav active, wordmark, active slot segment)
  - Gray / `ink` = structure (borders, text hierarchy, slot pills, filter chips) — avatars are identity and take `ink`, never brand (§10.1)
  - Semantic = status only (green=done, **red=ERROR AND DESTRUCTIVE ONLY**, amber=urgent/waiting/timing). A status pill is never brand.
- 🔴 **Red is for something being WRONG, or about to be undone — a failed send, a bounced
  order, a blocked dealer, a Delete/Clear button. Never for a PRIORITY.** *(Corrected
  2026-09-08. This line read `red=urgent/error/blocker` and contradicted §12's attention chip,
  which had shipped `bg-amber-50 / text-amber-700` for "Bill Tomorrow, Cross XYZ, **Urgent**"
  for over a year.)* Urgency is amber because it is a priority and not a fault: spent on a
  priority, red has nothing left to say when something actually breaks, and a list of red
  chips on a busy morning stops registering at all. **`/po2` ships this** — its
  Urgent chip is amber-700 on amber-50 and the only red left on the route is on Delete, Clear
  and "Replace what is here". ⚠ **Ten rendered elements in eight live files still ship Urgent
  in red and are the migration list, not counter-examples** — see the note under §3's
  Semantic table.
- **Minimal chrome.** Header + controls in 2 rows max.
- **Smart Title Case for display.** All DB text rendered with `smartTitleCase()` (§19).
- **One brand element rule** — except Sampling Library (§22), which is exempted. Mobile
  screens have their own budget (§59.9).
- **Universal header on ALL boards** (§6).

---

## 2. Orbit colour tokens — the brand system

**Source of truth: `tailwind.config.ts`, `theme.extend.colors`, the "Orbit palette" block.**
The design rationale is `docs/prompts/archive/2026-09/web-update-2026-09-06-orbit-colour-spec-v2.md`
(history only — where it and the config disagree, the config and this section win; two
spec lines are already overruled, §59.8 and §59.9). Rebrand commits: `5daa58fc` (2026-09-09,
57 non-brand teals reassigned to ok/warn/ink/tint/data) and `c96157ea` (2026-09-09, the
teal brand colour becomes violet). **The code has zero `teal-<n>` classes** — `grep -rE
"teal-[0-9]"` over `components/ app/ lib/` returns nothing (re-checked with the Grep tool;
the only hits are under `archive/` and `docs/`). **146 `.tsx` files use `brand-<n>`.** ⚠ The
config's own block comment still says "Added 2026-09-08 (rebrand step 1). NOTHING reads these
yet" — a stale claim; do not read it as current.

### 2.1 The families

| Family | Steps | Hex anchors | Rule |
|---|---|---|---|
| **`brand`** (violet) | 50 · 100 · 200 · 300 · 400 · 500 · 600 · 700 · 800 · 900 | 50 `#F5F3FF` · 600 **`#7C3AED`** · 700 `#6D28D9` · 800 `#5B21B6` · 900 `#43168B` | The brand. `brand-600` = commit button, active tab underline, focus, `themeColor`; `brand-700` = hover and tappable text; `brand-800` = the desk wordmark. ⚠ `brand-50` is the mobile masthead's hex (§59.8). |
| **`ink`** (violet-tinted neutral) | 0 · 25 · 50 · 100 · 200 · 400 · 500 · 600 · 700 · 900 — **no 300, no 800** | 25 `#FAFAFC` · 50 `#F4F3F8` · 100 `#E9E7F0` · 400 `#9C99AC` · 900 `#1B1826` | "Deliberately has no 300 and no 800 … do not invent the gaps" (config comment). Utility buttons are `ink-900` (primary Import, Download, New MRN, Generate PDF). |
| **`tint`** (sky) | `bg` `#F0F9FF` · `bd` `#BAE6FD` · 600 `#0284C7` · 700 `#0369A1` | — | **"Nothing but tint may use this family."** Tint strips, chips, the operator progress mid-range (`tint-operator-content.tsx` `progressColor`). 13 files. |
| **`ok`** | `DEFAULT` `#059669` · `bg` · `text` | — | Status: done, live, punched (e.g. the punched Mail Orders row §23, the /admin/access live banner §63, the attendance "Rollout activated" toast §50). Never brand, never tint. 14 files. |
| **`warn`** | `DEFAULT` `#D97706` · `bg` · `text` | — | Status: attention (e.g. the Tint Manager "Split" tag, `board-table.tsx:263`). 10 files. |
| **`danger`** | `DEFAULT` `#E11D48` · `bg` · `text` · `bd` | — | **NAMED `danger`, NOT `urgent`, and the name is the rule** — error and destructive only (§1). Only reader today: `app/login/login-form.tsx` (`border-danger`, `text-danger-text`). |
| **`fav`** | one value, `#F59E0B` | — | "The favourite star, and nothing else." No class reads it yet (`grep` for `-fav` in components/app/lib: 0). |
| **`data.*`** | `teal` `#0D9488` · `blue` `#2563EB` · `orange` `#EA580C` · `rose` `#E11D48` · `cyan` `#0891B2` · `lime` `#65A30D` · `pink` `#DB2777` · `slate` `#475569` · `brown` `#8B5A2B` | — | **IDENTITIES, never states. Never reassign a shipped data colour.** `data.rose` shares `danger`'s hex by a recorded decision — do not "resolve" it. `data.slate` is spoken for (§59.9). **`data.brown` · Hand** (the dealer collects; owner 2026-09-24) — 5.84:1 on white, 5.31:1 on its pale tint. **After brown, no `data.*` colour is free — the next category needs a new token.** |

🔴 **`data.teal` is the IGT delivery type, not the brand.** It keeps the exact hex teal
carried before the rebrand, so its users never moved: `bg-data-teal` in
`components/mail-orders/bill-to-card.tsx:26`, `ship-to-card.tsx:62`,
`components/tint/operator/party-cards.tsx:23`, `app/(mail-orders)/mail-orders/mail-orders-table.tsx:100`
and `review-view.tsx:186`, plus the hex `#0d9488` for IGT in
`components/reports/report-params.ts:35`. Any other teal in new code is a bug.

⚠ **Nothing in the config ENFORCES the `ink`-not-`gray` rule.** The Orbit families sit under
`theme.extend`, so Tailwind's own `gray-*`, `neutral-*`, `teal-*`, `red-*` and `amber-*` scales
still compile. The rule lives in comments: the neutral family is named `ink` so that a
collision cannot happen silently (`bg-gray-100` keeps meaning Tailwind's gray). Today 244
`.tsx` files still use `gray-*` and 76 use `ink-*`; `neutral-*` has no users.

### 2.2 Brand rules

- ONE primary CTA per screen — `brand-600`, hover `brand-700`
- Focus ring: `focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10` (50 / 41 sites)
- IosToggle ON: `bg-brand-600`
- Operator avatars: **not brand — see §10.1.** State-encoding ones are `bg-ink-400` / `bg-ink-900` with done = `bg-green-600`; user-identity ones are pale `ink-50`.
- Sidebar logo: the `OrbitWordmark` in `text-brand-800`, no tile (§2.3, §7)
- Sidebar accent: `borderLeft: "3px solid #7C3AED"` (`components/shared/role-sidebar.tsx:196`)
- OBD numbers: `text-gray-800 font-mono` (NOT brand)

### 2.3 The logo — `OrbitWordmark`, and there is no symbol

**The logo is the word.** `components/shared/orbit-wordmark.tsx` exports `OrbitWordmark
({ height, className })` — the letters "Orbit" as OUTLINED PATHS cut from Plus Jakarta Sans
Bold, viewBox `0 0 2316 769`, `ORBIT_WORDMARK_ASPECT = 3.0117`. "There is no symbol and no
tile baked in here — callers own both" (`orbit-wordmark.tsx:9-11`). Was a drawn orbit symbol
(circles r=7 / r=2.2 / cx=18) on a teal tile until 2026-09-09; now the wordmark alone
(`de7453bb`, "wordmark replaces the orbit mark at every site"). Do not revert.

- 🔴 **GENERATED — do not hand-edit.** `node scripts/generate-wordmark.mjs` writes
  `components/shared/orbit-wordmark.tsx`, `public/orbit-wordmark.svg` and
  `public/icon-source.svg`; `scripts/generate-icons.mjs` then renders the PNGs (§48).
- **Colour contract: `fill="currentColor"`.** Set the colour with a text class on the
  element or a parent — `text-brand-800` on the desk rail, `text-white` on a violet tile,
  `text-brand-600` on a pale masthead.
- **`height` is INK height**, not a font size (§12.2).
- **Call sites — 11 renders in 10 files** (import sweep, 2026-09-19):
  `components/shared/role-sidebar.tsx` (19/14px, `text-brand-800`) ·
  `components/admin/admin-sidebar.tsx` ×2 (rail 19/14px, and 11px `text-white` on a
  `bg-brand-600` tile in the phone top bar) · `app/login/page.tsx` ·
  `app/(place-order)/place-order/place-order-page.tsx` · `app/po/splash-screen.tsx` ·
  `app/po2/po-v2-page.tsx` · `components/trip-report/trip-report-page.tsx` ·
  `components/attendance/attendance-home.tsx` · `components/attendance/history-calendar.tsx`
  · `app/attendance/consent/consent-form.tsx`.

---

## 3. Colour palette

### Core
| Token | Tailwind | Usage |
|---|---|---|
| Page bg | `bg-white` | Body, sidebar |
| App bg | `bg-[#f9fafb]` | Login, full-page boards, Review View page tint |
| Surface | `bg-gray-50` | Info grids, column bgs, inputs |
| Border default | `border-gray-200` | Cards, dividers, rows |
| Text primary | `text-gray-900` | Customer names, headings |
| Text secondary | `text-gray-600` | Data values |
| Text muted | `text-gray-400` | Timestamps, labels |
| Text hint | `text-gray-300` | Placeholders, disabled |

### Semantic
| Purpose | Bg | Border | Text |
|---|---|---|---|
| Urgent | `bg-red-50` | `border-red-200` | `text-red-600` |
| Normal | `bg-gray-50` | `border-gray-200` | `text-gray-500` |
| Done/Dispatch | `bg-green-50` | `border-green-200` | `text-green-700` |
| Hold | `bg-red-50` | `border-red-200` | `text-red-700` |
| Waiting | `bg-amber-50` | `border-amber-200` | `text-amber-700` |
| Split | `bg-purple-50` | `border-purple-200` | `text-purple-700` |
| Voided / Removed | `bg-red-50` | `border-red-300` | `text-red-700` (with diagonal watermark on challan) |

🔴 **The `Urgent` row above is a RECORD OF SHIPPED CODE, NOT THE RULE, and the two now
disagree.** §1's palette rule changed on 2026-09-08 — red is error and destructive only, urgency
is amber — but this table describes what live components actually render, and canon must
never claim a colour a screen does not paint. Recounted 2026-09-19 at HEAD: **ten rendered
elements in eight live files** paint Urgent red:

| still red | what it draws |
|---|---|
| `components/shared/status-badge.tsx:31` + `:70` — the `urgent` badge and its default dot | `bg-red-50 text-red-700 border-red-200` · `bg-red-500` |
| `components/floor/floor-table.tsx:867` — the ⚡ mark-urgent toggle, ON | `border-red-200 bg-red-50 text-red-500` |
| `components/floor/floor-table.tsx:1044` — the ⚡ glyph in the row | `#ef4444` |
| `components/floor/hold-tab.tsx:110` · `cancelled-tab.tsx:139` — ⚡ glyph | `text-[#ef4444]` |
| `components/floor/detail-panel.tsx:542` — "⚡ Urgent" pill | `bg-[#fef2f2] text-[#b91c1c]` |
| `components/tint/manager/board-table.tsx:303` — ⚡ glyph | `#ef4444` |
| `components/tint/manager/board-rail.tsx:188` — "⚡ Urgent" pill | `bg-red-50 text-red-700 border-red-200` |
| `components/picking/bill-symbols.tsx:70` — `URGENT_COLOR` ⚡ glyph | `#DC2626` |

(`components/tint/tint-table-view.tsx:174` also paints a red "🚨 Urgent" badge, but that file
has no importer. `components/shared/duplicate-so-tag.tsx` cites this row for its own red — it
marks a duplicate SO, not urgency. The full inventory, and why the migration is deferred by
decision, is `docs/prompts/drafts/code-discovery-2026-09-08-urgent-red-migration.md`.)
⚠ **The `danger` block comment in `tailwind.config.ts` says "Twelve live sites" — a stale
claim:** it counted `components/floor/rail-card.tsx` (deleted in `79bcc412`) and the
orphaned `tint-table-view.tsx`. Ten is the live figure.

**That is a migration list.** `/po2` already ships Urgent in amber-700 on amber-50.
Move these to the `Waiting` row's amber and this row becomes `bg-amber-50 /
border-amber-200 / text-amber-700`; until somebody does, the row stays red because the pixels
are red. **Do not flip it to amber ahead of the code** — a stamp nobody earned is the failure
`CLAUDE.md §4` exists to prevent. `Hold` and `Voided / Removed` keep their red under the new
rule: both are a thing being stopped or undone.

### Delivery type dots
| Type | Colour |
|---|---|
| Local | `bg-blue-600` |
| UPC (Upcountry) | `bg-orange-600` |
| IGT | `bg-data-teal` (#0D9488 — the IGT identity, §2.1; `bill-to-card.tsx:26`) |
| Cross | `bg-rose-600` |

Dot: `w-[5px] h-[5px] rounded-full flex-shrink-0`.

### Tinter type dots
TINTER = `bg-blue-600`. ACOTONE = `bg-orange-500`.

### Attendance status chips
| Status | Colour |
|---|---|
| PRESENT | emerald |
| LATE / HALF_DAY | amber |
| INCOMPLETE / ABSENT | red |
| HOLIDAY / ON_LEAVE | blue |
| NOT_IN_YET / EXEMPT | gray |

### OT outcome banners (post-checkout)
| Status | Banner |
|---|---|
| AUTO_CREDITED | green — "OT credited: N min" |
| AUTO_CREDITED_GRACE | amber — "OT credited under grace · N of M used this month" |
| PENDING | amber — "OT submitted for admin approval · grace limit reached" |
| NOT_CLAIMED | no banner |

---

## 4. Typography

| Element | Classes |
|---|---|
| Page title | `text-[14px] font-semibold text-gray-900` |
| Inline stats | `text-[11px] text-gray-400`, numbers `text-gray-900 font-semibold` |
| Card customer name | `text-[13.5px] font-bold text-gray-900` |
| OBD code | `font-mono text-[11px] text-gray-800` |
| Table header | `text-[10px] font-medium text-gray-400 uppercase tracking-wider` |
| Table data primary | `text-[11px] text-gray-900 font-medium` |
| Table data secondary | `text-[11px] text-gray-600` |
| Table data muted | `text-[11px] text-gray-400` |
| Badge text | `text-[10.5px] font-semibold` |
| Button (table) | `text-[11px] font-medium` |
| Button (card/primary) | `text-[13px] font-medium` |
| Timestamp / clock | `text-[11px] text-gray-400` |
| Form label | `text-[11px] font-medium text-gray-500` |

---

## 5. Borders and spacing

| Element | Classes |
|---|---|
| Card | `border border-gray-200 rounded-lg`, hover `border-gray-300` |
| Table wrapper | `rounded-lg border border-gray-200 overflow-hidden` with `px-4 py-3` |
| Table row | `border-b border-gray-50 hover:bg-gray-50/50` |
| Sidebar | `bg-white` + `borderLeft: "3px solid #7C3AED"` + right `border-gray-200` (`role-sidebar.tsx:196`) |

No accent bars on cards. No zebra striping.

### SKU table wrapper pattern (Review View)

When wrapping an existing scrollable component:
- Wrapper provides `flex flex-col` context AND height containment via `min-h-0`
- Wrapped component keeps its `flex-1 overflow-y-auto`
- Wrapper bg `bg-white border border-gray-200 rounded-lg`

If either layer is missing, scroll breaks. Took 2 iterations to land — don't touch without understanding all 5 classes (`flex`, `flex-col`, `min-h-0`, `flex-1`, `overflow-y-auto`).

---

## 6. Universal header system

Desk boards use `<UniversalHeader />` from `components/universal-header.tsx`. Never hand-roll a new one.

**Live consumers (import sweep 2026-09-19) — 10 files:** Mail Orders / Billing (`app/(mail-orders)/mail-orders/mail-orders-page.tsx`), Tint Manager, Tint Operator, TI Report, Shade Master, Delivery Challan (`challan-content.tsx`), Sampling Library, Trip Report, **the CI desk** (`components/ci/billing-board.tsx`) and **the MRN desk** (`components/mrn/billing-board.tsx`). `review-view.tsx` does not render it — the header belongs to `mail-orders-page.tsx` alone. **Not consumers:** the attendance admin pages (own two-strip `components/admin/attendance/attendance-page-header.tsx` — "replaces the per-page UniversalHeader chrome", per `docs/mockups/attendance/admin-redesign.html`; detail belongs to `CLAUDE_ATTENDANCE.md §9.0`) and Admin Import (`import-page-content.tsx` renders no UniversalHeader).

**Neutral props added for the Billing v2 face (2026-08-01, commits `d08f3870`/`15e87e2b`/`f76b4c86`):** `searchLayout?: "compact" | "wide" | "wide-right"` (default compact, the 180→260px grow), `showShortcutsButton?: boolean` (default true — billing hides it in the header and renders the extracted **`components/header-shortcuts.tsx`** on its own control row), `importVariant?: "default" | "primary"` (primary = a 36px **`bg-ink-900 hover:bg-ink-700`** utility Import, `universal-header.tsx:433` — not brand; the prop's JSDoc at `:158-166` still says "brand-600" and is stale). The component imports nothing from `components/billing/` and never calls `useBillingV2()` — callers opt in; every non-billing board is byte-identical by default. Only `mail-orders-page.tsx` passes these (`:1342`, `:1430`); the Billing face itself → `CLAUDE_BILLING.md §3`.

### Shared pieces the header mounts

- **`ImportProgressPill`** (`components/import/import-progress-pill.tsx`, `37ceb57a`) —
  rendered by `UniversalHeader` immediately left of the Import button (`universal-header.tsx:422`),
  reading `ImportProgressProvider` from the root layout (`app/layout.tsx:90`). Returns `null`
  when idle, so an idle header's DOM is unchanged. Running = grey + spinner, done = green, failed
  = red with no ✕ (the panel must be opened). **Import is disabled while a run is running or a
  failure is unread** (`importBlockedReason`, `universal-header.tsx:416`). No percentage,
  nothing auto-hides. Behaviour → `CLAUDE_IMPORT.md §11`.
- **`useCanImportObds()`** (`lib/hooks/use-can-import-obds.ts`) — drives `showImport` on Mail
  Orders / Billing and the five tint screens (Manager, Operator, TI Report, Shade Master,
  Challan). "ONE helper for all of them; never a per-screen role list." Defaults to false and
  fails closed. Who may import → `CLAUDE_IMPORT.md §9.1`.
- **`HeaderViewToggle`** — the §21 view-toggle look as a shared component (§21).

⚠ **Tint Manager stayed a consumer through its 2026-09-06 board rebuild — it did NOT become a second exception.** The Kanban became a rail + one grouped table, and the only header prop dropped was the operator-workload segment group (`segments`/`activeSegment`/`onSegmentChange`); Import, the three filter groups, the shortcuts panel and `rightExtra` are wired exactly as before. Screen itself: `CLAUDE_TINT.md §1`.

**Named exception — `/floor` (Floor Control) is hand-rolled, deliberately.** `app/(floor)/floor/page.tsx` → `components/floor/floor-page.tsx` renders its OWN two-row header (Row 1: "Floor Control" title + IST date/time; Row 2: delivery-type scope chips + one search box + one filter) — no `<UniversalHeader />` anywhere in the floor tree. Reason: an approved divergence hand-rolled to the locked mockup `docs/mockups/floor-control/01-board.html` (scope chips + search/filter, a different shape from UniversalHeader's segmented control). This is ONE named exception, not a loosening of the rule — every other board still uses `<UniversalHeader />`. The screen itself is documented in `CLAUDE_FLOOR.md`; do not restate its layout here. Do not "fix" `/floor` back to `<UniversalHeader />`.

### Row 1 (52px sticky top-0, z-30)
Title (14px semibold) · Stats (11px gray-400) — left.
Clock IST HH:MM | ⌨ Shortcuts | [Download] | Search bar (180→260px) — right.
Title accepts ReactNode (for view toggles).

### Row 2 (40px sticky top-[52px], z-30)
Segmented control [+ leftExtra] — left.
[rightExtra] | Filter ▾ | ‹ Date stepper › — right.

### Segmented control
Container: `inline-flex bg-gray-100 rounded-[7px] p-[3px] gap-[2px]`
Inactive: `text-gray-500`, hover `bg-white/60`
Active: `bg-brand-600 text-white font-medium` (`universal-header.tsx:609`)
Click active → deselects. No "All" button. 4 slots max.

### Filter dropdown
Inactive: `border border-gray-200 text-gray-500`
Active: `border-gray-900 text-gray-900` + count badge `bg-gray-900 text-white`
Panel: `bg-white border-gray-200 rounded-lg shadow-lg p-3 w-[260px]`

**Multi-select group shape (2026-07-09, Support Filter rework):** a panel can hold several
independent groups (e.g. View / SMU / Delivery Type / Priority), each rendering its own options as
toggleable chips — multiple chips per group may be active at once (options within a group OR
together; groups AND together). The header count badge sums selections across **all** groups, not
per-group. **"Clear all"** renders inside the panel only when the total badge count is **> 0** —
hidden entirely at zero selections. (The pattern originated on the retired Support board; the
behaviour reference is archived at `archive/2026-07-support/docs/CLAUDE_SUPPORT.md §4.21`.)

### Date control
Click-to-open calendar popover. Format `‹ Today · 04 Apr ›`. Right arrow disabled when viewing today.

### Colour rule
**ONE brand element: active slot segment.** Sampling Library exempted (§22).

Per-board wiring summary:

| Board | Segments | Filters | Date | Extras |
|---|---|---|---|---|
| Tint Manager | **None** — segments removed 2026-09-06 | Del Type, Priority, Type | None | Missing-customer badge · Add to Tint · Reports link. **No view toggle** — one board now |
| Mail Orders | Slots (5) | Status, Match, Dispatch, Lock | Stepper | Column toggle, Table/Review toggle. ⚠ The Billing face rewires this header (`searchLayout="wide-right"`, the `ink-900` primary Import, shortcuts moved to the control row) — spec → `CLAUDE_BILLING.md §3` |
| Tint Operator | Job pill (`bg-brand-600`; amber when only paused work is left — `tint-operator-content.tsx:1649/1660`), dropdown, in `leftExtra` | — | None | Title = Jobs/History `HeaderViewToggle` · Progress bar (rightExtra) · behaviour → `CLAUDE_TINT.md §3.1`/`§3.13` |
| **CI desk** | — (counts in Row-1 `stats`, never `segments`) | — | Stepper (drives the Closed section only) | Register export (`leftExtra`) · Search · → `CLAUDE_CI.md §8` |
| **MRN desk** | — (counts in `stats`) | — | Stepper | New MRN `ink-900` utility (`leftExtra`) · Search · → `CLAUDE_MRN.md §1` |
| TI Report | Date presets | Tinter Type, Operator | None | Date range, Download |
| Shade Master | — | Tinter Type, Status | None | — |
| Delivery Challan | — | SMU, Route | Stepper | Search |
| Sampling Library | Type (TINTER/ACOTONE) | Pack, Status | None | Month picker |
| Trip Report | Local/Up-Country segment | — | Date filter | → `CLAUDE_TRIP_REPORT.md §1` |
| **Floor Control** | Scope chips | Status / Flags | None | Search · pick-gate switch · **⚠ HAND-ROLLED, NOT `<UniversalHeader />`** — named exception above; → `CLAUDE_FLOOR.md §2` |

*(Rows removed 2026-08-04: Support / Planning / Warehouse — boards retired 2026-07-27/28, wiring archived with them; Admin Import + OT Pending + OT Audit — no longer UniversalHeader consumers, see the roster above.)*

---

## 7. Sidebar — white + brand accent

`components/shared/role-sidebar.tsx`. The admin shell has its own sidebar — §64.

Shell: `bg-white` + 3px `#7C3AED` left accent + right gray-200 border (`:196`); 220px expanded, 72px collapsed.
Logo: `<OrbitWordmark height={isExpanded ? 19 : 14} className="text-brand-800" />` (`:213-215`) — no tile, and nothing beside it (§2.3).
Active nav: `bg-brand-50 text-brand-700 font-semibold border-l-2 border-brand-600` (`:143`); collapsed active icon `bg-brand-50 text-brand-600` (`:170`).
Inactive: `text-gray-500 hover:bg-gray-50 hover:text-gray-900`.
User avatar: **`bg-ink-50` · `text-ink-600` · 1px `border-ink-100`, hover `bg-ink-100`** — see §10.1. (Was `bg-teal-600`, then a solid `ink-900` disc.)

Behaviour spec: `CLAUDE_CORE.md §11`.

---

## 8. Card components

Structure: Icon row → Badge row → Customer name → OBD row → Info grid → Operator row.
No accent bars. Customer missing: inline ⚠ (AlertCircle 14px amber).

Age badge (1+ days old, on the Tint Manager rail — `components/tint/manager/board-rail.tsx:197-204`):
- 1 day: amber pill "1d" (`bg-amber-50 text-amber-700 border-amber-200`)
- 2+ days: red pill "Nd" (`bg-red-50 text-red-700 border-red-200`)
- IST-aware from `orderDateTime`.

**Route cards** — `components/floor/route-cards.tsx` (2026-09-19): Floor's By route view on a tab with route clubs — one grid of equal-size cards (4/3/2 per row at 1470/1100px) — the clubs, then one display-only "Other routes" card for every unclubbed route and No route — each a button showing name, big kilos, stops · litres and one line per route with a 4px status bar, opening its bills full width under its row. Behaviour → `CLAUDE_FLOOR.md §2.1`.

**Load plan cards** — `components/floor/load-plan.tsx` (2026-09-19): Floor's Upcountry Load plan — a summary line, then one card per suggested truck on the same equal-size grid (routes, big kilos, grey "Big truck · N stops", a 4px fill bar green ≥ 50% / amber below, a brief violet border flash when a regroup changed it) and one full-width panel with the reason and Make trip. Behaviour → `CLAUDE_FLOOR.md §2.2`.

---

## 9. Form inputs

Default: `h-[38px] px-3 text-[13px] border border-gray-200 rounded-lg`
Focus: `focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10`
Error: `border-red-300 ring-2 ring-red-500/6`

**Mobile rule:** all `<input>` elements that may surface a keyboard must be `text-[16px]` minimum on EVERY mobile surface (`/po`, and any future mobile page). iOS WebKit auto-zooms anything smaller. Android Chrome does not, but the rule applies for consistency. (Written as an `/order` rule until 2026-07-27; it was never specific to that page.)

---

## 10. Buttons

Primary CTA: `bg-brand-600 hover:bg-brand-700 text-white h-[38px] rounded-lg` (the `bg-brand-600 hover:bg-brand-700` pair: 42 sites)
Utility: `bg-ink-900 hover:bg-ink-700 text-white` — a tool, not a decision (Import primary, Download, New MRN, Generate PDF)
Secondary: `bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 h-7 rounded-md`
Modal save (gray): `bg-gray-900 hover:bg-gray-800 text-white` (NOT brand)
Tint Operator save CTAs: `bg-gray-900 text-white`
Tint Operator workflow CTAs: `bg-green-600 text-white`
Operator Pause CTA: `bg-amber-600 hover:bg-amber-700 text-white`
Skip CTA: `bg-gray-100 hover:bg-gray-200 text-gray-700` (passive — never primary)
Remove OBD destructive confirm: `bg-red-600 hover:bg-red-700 text-white`

### Action-surface rules (general canon — established 2026-07-26 on the Floor action-surfaces redesign, `docs/prompts/archive/2026-08/web-update-2026-07-26-floor-action-surfaces.md` §2; shipped 2026-07-27)

- **One brand button per surface, and it goes to the state's REAL job — not to a fixed button.** Exactly one brand button per state, never zero, never two; which button is brand may change with the bill's state (Floor's detail panel: Ship-to in most states, Release on a held bill).
- **Disabled buttons are grey, never faded primary** — `bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed`. A faded brand button reads as broken, not waiting. Box model identical in both states (border present even when invisible) so nothing shifts on enable.
- **An editable value gets a pencil, not a label.** A grey caption + chip reads as display-only; a chip carrying a small pencil is unambiguous.
- **Facts live in the header, jobs live in the action row.** A property of the record (slot, date, number) belongs on the identity line; the action row holds only things the operator *does*.
- **Selection summaries name what was selected** — one row shows the name; multiple show totals (volume, route count), derived from data already in the component.

---

### 10.1 Avatars — identity, not emphasis

**A user avatar is `bg-ink-50` · `text-ink-600` · 1px `border-ink-100`.** Applied
2026-09-09. Contrast of the initials on the fill is **7.26:1**, which clears AA and AAA
for normal text; the hairline edge is there to separate the pale disc from the white
surface behind it, not to carry meaning.

**Why it is pale.** The avatar went to a solid `ink-900` disc in rebrand step 3c, on the
correct principle that an avatar identifies a *person* and so must not carry the brand
colour. But solid near-black then made it the heaviest element on the rail — maximum
visual weight spent on something nobody is making a decision about, that people look at
twice a day. Identity should be legible and quiet. It is neither brand nor emphasis.

🔴 **An avatar whose colour encodes a STATE is a different thing and keeps its colour.**
The live example, deliberately untouched:

| | not-done | done |
|---|---|---|
| `OperatorAvatar` — `components/tint/manager/board-bits.tsx:147` | `bg-ink-400` | `bg-green-600` |

(`OperatorTd` in `components/tint/tint-table-view.tsx` follows the same pair, `bg-ink-900` /
`bg-green-600`, but that file has no importer since the 2026-09-06 Tint Manager rebuild —
retired, not deleted, per `tint-manager-content.tsx:24-30`.)

Those discs answer "is this finished?", not "who is this?". Recolouring only their dark
half would break the pair and delete a status signal.

Sales-officer role avatars (`SO_ROLE_AVATAR_CLASSES` in
`components/admin/customer-sheet.tsx`) also stay as they are — `brand-100`/`blue-50`/
`amber-50` encode Primary / Backup / Junior, and they already use a pale-fill-plus-dark-
text treatment of the same shape.

---

## 11. IosToggle

ON: `bg-brand-600`. OFF: `bg-gray-300`. Sizes: 36×20px compact, 46×26px large. Live copies:
`IosToggle` in `components/tint/shade-master-content.tsx:102` (36×20), `Toggle` in
`components/reports/customise-drawer.tsx:18` (`h-5 w-9`), and the 46×26 Notifications switch
in `components/push/push-toggle.tsx:152` (§59.1).

---

## 12. Login page

**Rebuilt 2026-09-09 (rebrand step 5).** The centred card on `#f9fafb` is gone. The page
is a split: brand panel left, white form right. Files: `app/login/page.tsx`,
`app/login/login-form.tsx`, plus one CSS block in `globals.css` marked "Login — panel
entrance".

| Item | What ships |
|---|---|
| Layout | `flex-col` on a phone, `md:flex-row` above. Panel `flex-[1.15]`, form side `flex-1`. |
| Panel | The brand ramp tuned for a wide surface, plus a grain layer. No drawn element — see §12.1, and §12.1.1 for why it is not the icon's exact ramp. |
| Content | `z-3`. Wordmark white at 45px of INK (30 / 38 / 45 stepping down), 56×3 `brand-400` accent bar, tagline 24px/18px/15px `brand-200` with the last word white and `whitespace-nowrap`. |
| Form | White, `max-w-[330px]`. Time-aware greeting + date. Focus `border-brand-500` + `ring-4 ring-[rgba(139,92,246,.13)]`. Sign in is the commit button, `bg-brand-600`, full width, spinner on click. |

### 12.1 The panel — brand ramp plus grain, and NO drawn element

🔴 **The panel carries no graphic, and that is a DECISION, not a deferral or a gap
somebody has not got to yet.** Eleven variations were tried on it across one session on
2026-09-09 — orbit arcs, ellipses, a node network, streaks, a depot scene. Every one held
together at mockup size and fell apart at full-screen size. The arcs got furthest and
actually shipped for a day as `app/login/login-rings.tsx`, through three rounds of
geometry and animation fixes, before being removed. **Do not reintroduce a graphic here
as a fresh idea.** The file is recoverable from git history if the argument is ever
reopened, but it needs new evidence that a drawn layer survives a 1920-wide panel, not a
new mockup.

What carries the panel instead:

```css
background-image: radial-gradient(105% 105% at 10% 2%,
  #7A55E8 0%, #7846E2 14%, #7C3AED 30%, #6428C4 66%, #4C1D95 100%);
```

Over it, one grain layer — `inset 0`, `opacity .12`, `pointer-events: none`, `z-1`, under
the content at `z-3` — tiling a 140px `feTurbulence` fractal-noise SVG as a data URI.

🔴 **The grain is the only reason the panel does not read as a flat CSS gradient.** A
five-stop violet ramp across a 780×900 area bands visibly without it. Keep it.

### 12.1.1 The panel and the icon use DIFFERENT ramps on purpose

🔴 **Do not "reconcile" these two back to one set of numbers.** It looks like drift, it is
the obvious tidy-up, and it is wrong. **The icon is square and the panel is wide, so the
same stops do not produce the same result.** A radial gradient's light falls off over the
ending shape's radius; on a square tile that is a short distance, and stretched across a
780×900 panel the same numbers put the light stop over a third of the surface and wash the
corner out. Same intent, different geometry, therefore different numbers.

| | ending shape | hot spot | stops |
|---|---|---|---|
| Icon — `public/icon-source.svg`, `scripts/generate-wordmark.mjs` | 125% | 14% 6% | `#8460EF` 0 · `#7F55EB` 18% · `#7C3AED` 36% · `#6428C4` 68% · `#4C1D95` 100% |
| Panel — `app/login/page.tsx` | 105% | 10% 2% | `#7A55E8` 0 · `#7846E2` 14% · `#7C3AED` 30% · `#6428C4` 66% · `#4C1D95` 100% |

Three deliberate differences, applied 2026-09-09 after the icon's ramp was tried on the
panel first and read too bright:

- **Light stop two steps down**, `#8460EF` → `#7A55E8`, so the corner is lit rather than
  washed.
- **Ending shape 125% → 105%**, which pulls the light in so it stops covering a third of
  the panel.
- **`brand.600` arrives at 30% instead of 36%**, so the brand colour holds more of the
  surface.

What the two DO share is the anchor and the fall: `#7C3AED` is the pivot in both, and both
step down through `#6428C4` to `#4C1D95`. That is what makes them read as one family. The
first two stops and the geometry are tuned per surface and are expected to differ.

### 12.2 The rest

**Greeting is computed on the SERVER in `Asia/Kolkata`** and passed down as a prop.
Everyone who signs in is at the depot, a server value renders identically on both sides,
and that avoids both a hydration mismatch and a one-frame flash of an empty heading.
Morning before 12:00, afternoon to 16:59, evening from 17:00.

**The wordmark height is INK height, not a font size.** `OrbitWordmark`'s viewBox is cut
tight to the letters — 769 units of a 1000-unit em (`scripts/generate-wordmark.mjs`) — so a
rendered height of H reads as roughly `H ÷ 0.769` of type. 45px here is ~59px of type,
which lands on the mockup's 58px and rebrand draft §6's 60px. An earlier cut passed 66,
which was ~86px of type and a third too big. **Anyone specifying this component in px must
say which of the two they mean.**

**Two entrances, and both rest on their arrived state** — the wordmark and tagline rise
(`.orbit-rise`, 0.85s, the tagline 0.18s behind), the accent bar draws from zero width
(`.orbit-draw`, 0.55s after a 0.5s wait, with the 56px width living on `.orbit-accent`).
`prefers-reduced-motion` switches both off with `animation: none`, which therefore lands
on the finished design rather than on an invisible wordmark or a 0px bar.

**Tagline: "Taking efficiency into new orbit"** — one tagline across the product. It
replaced "One system. Zero chaos.", which is retired and appears nowhere in shipping code.

**Nothing public-facing goes on this page** — no version number, no depot name, no
supplier name, no live figures.

Login field accepts email OR 10-digit mobile. The label reads **"Username"** (rebrand
spec), with the affordance moved into the placeholder, "Email or 10-digit mobile". Input
`type="text"` (not `email` — the browser blocks digit-only). `autoComplete="username"`.
Field `id`/`name` remains `email` — that is the auth contract, not a display choice.

**Tab order is username → password → Sign in.** The show/hide-password eye is
`tabIndex={-1}` and stays out of it. The "Ask the admin" helper is `brand-700` text, not a
link — there is no target to send anyone to.

**The wrong-password border is the only red on the page.** The Sign in button never turns
red.

---

## 13. Modal pattern

Backdrop: `bg-black/40`. Panel: `bg-white rounded-lg shadow-xl w-[400px]`. Confirm button: `bg-gray-900` (not brand). Destructive confirm: `bg-red-600`.

### Two-stage confirm (used by Mark Done partial qty, Remove OBD)

Stage 1: `[Cancel] [Confirm Done]` — default action visible.
Stage 2 (only if partial/risky): amber banner explains consequence → `[Back] [Yes, mark done]`.

---

## 14. Date range picker

Used in TI Report (`components/tint/ti-report-content.tsx`). Presets: Today/Yesterday/This Week/This Month with `bg-brand-600` active (`:249`). Calendar: `bg-brand-600` selected, `bg-brand-50 text-brand-700` range (`:304-305`). Download: the UniversalHeader download button, an `ink-900` utility (`universal-header.tsx:567`). The shared single-date `components/ui/date-picker-popover.tsx` marks the selected day `bg-brand-600` (`:183`).

---

## 15. Smart Title Case

Apply `smartTitleCase()` from `lib/mail-orders/utils.ts` to all DB text for display.

**Keep UPPERCASE:** CO, LLP, PVT, LTD, HW, H/W, JSW, SAP, OBD, IGT, UPC
**Keep lowercase (except first):** and, of, the, for, in, at, to, by

Apply to: customer name, SO name (strip "(JSW)" first), remarks, area, route, candidate names.
Do NOT apply to: codes, badges, column headers.

---

## 16. Mail Orders — lock column

Unlocked: LockOpen 14px `text-gray-300 hover:text-gray-400`
Locked: Lock 14px `text-red-500 bg-red-50 rounded p-1`
Auto-locks on OD, CI, Bill Tomorrow. Persisted via `isLocked` on `mo_orders`.

---

## 17. Mail Orders — code column

Exact: mono badge `text-gray-800 bg-gray-50 border-gray-200`. Click copies, flash `bg-brand-50 border-brand-200 text-brand-700` 1.5s (`mail-orders-table.tsx:547`).
Multiple: `text-amber-700 bg-amber-50 border-amber-200` "N found". Click → picker.
Unmatched: `text-gray-400` "Search". Click → search popover.

---

## 18. Mail Orders — customer column

Line 1: [delivery dot] Customer Name (`text-[12.5px] font-semibold`).
Line 2: `text-[10px] text-gray-400` — Volume (mono, green/amber) · Area · Route.

---

## 19. Mail Orders — table column widths

Parent: `Time(68) | SO Name(120) | Customer(208) | Lines(68) | Dispatch(80) | Remarks(120) | Code(90) | SKU(82) | SO No.(110) | Lock(46) | Status(80) | Punched By(100)`

Expanded: `# (38) | Raw Text (30%) | SKU Code (130) | Description (30%) | Pk (48) | Qty (52) | Vol (56) | Status (76)`

---

## 20. Mail Orders — signal badges (SignalPill component)

Shared component: `components/mail-orders/signal-pill.tsx`. Single source of truth.

`OrderSignal` interface:
```ts
{
  label: string;
  type: "blocker" | "attention" | "info" | "split" | "bill" | "status" | "truck-order";
  card: "bill" | "ship";   // routes to BillToCard or ShipToCard
  dot?: string;
}
```

| Type | Style | Triggers |
|---|---|---|
| blocker | `bg-red-50 text-red-700 border-red-200` | OD, CI, Bounce |
| attention | `bg-amber-50 text-amber-700 border-amber-200` | Bill Tomorrow, Cross XYZ, Urgent |
| info | `bg-gray-50 text-gray-500 border-gray-200` | 7 Days, Extension, DPL, Challan |
| split | `bg-purple-50 text-purple-600 border-purple-200` | ✂ Bill X-Y |
| bill | `bg-blue-50 text-blue-700 border-blue-200` | Bill N |
| status | rendered by ShipToCard | Hold (red), Dispatch (green), any dispatchStatus |
| truck-order | `bg-violet-50 text-violet-700 border-violet-200` | Truck-icon-only pill |

**Truck-order pill:** Lucide `Truck` 12×12, stroke-width 2. Icon-only. Tooltip `"Truck Order — punch when material received"`. 18px height, 4px border-radius, 5px horizontal padding.

Routing rules — every signal carries `card: "bill" | "ship"`:

| Signal | Card |
|---|---|
| OD / CI / Bounce / Bill N / Bill Tomorrow / Cross / ✂ Split / 7 Days / Extension / DPL / Truck Order | bill |
| Urgent / Challan / Hold / Dispatch (any dispatchStatus) | ship |

**Removed entirely:** `→ Ship-to` signal — replaced by amber left-bar + captured pill on ShipToCard.

---

## 21. Mail Orders — view toggle (Table / Review)

Rendered inside UniversalHeader title (ReactNode).

Container: `border border-gray-300 rounded-[5px] overflow-hidden`
Active: `bg-gray-800 text-white` (DARK — navigation, NOT brand)
Inactive: `bg-white text-gray-500 hover:bg-gray-50`
% badge after separator: ≥50% `bg-green-50 text-green-600`, <50% `bg-amber-50 text-amber-600`
Completed slots: "✓ Morning" prefix.

**Shared component: `HeaderViewToggle`** (`components/shared/header-view-toggle.tsx`) — this
section's look, class strings lifted verbatim from the Mail Orders inline toggle, generic over
`options: {value, label}[]` + `value` + `onChange` (+ optional `dataTutorial`, `ariaLabel`).
Consumer today: Tint Operator's Jobs/History toggle in its header title
(`tint-operator-content.tsx:1601`). Mail Orders still renders its own inline copy and is not
yet a consumer (the component's header says so). Use it for any new board view toggle —
never a third hand-rolled copy.

---

## 22. Per-screen brand exemption — Sampling Library

The "one brand element" rule (§6) does NOT apply on `/tint/sampling-library`. Brand is used on more than one element: the shared header's TINTER/ACOTONE segment, the active status pill (`sampling-library-detail-pane.tsx:395`, `bg-brand-50 text-brand-700`) and the active list row (`sampling-library-list-pane.tsx:254`, `bg-brand-50 border-l-brand-700`). That is every brand use in `components/sampling-library/` today; the per-element list is `CLAUDE_SAMPLING_LIBRARY.md §4` "Visual style — exemption".

Reason: Sampling Library is a deep-domain page (not a depot ops board). The accent density signals "this is a curated reference workspace" vs operational boards. No other page has the same exemption today.

Other Sampling Library deviations:
- Status pills, variant tabs, large tabular numerals: `font-semibold` or `font-medium` (drops one weight from `font-bold` originally specced) to match cousin convention.

---

## 23. Mail Orders — table row states

Normal pending: white. Focused: `#1B1826` (ink-900) left border + `bg-ink-25`. Flagged (manual flag, or auto on OD/CI): `#f87171` red left border. Punched: `#059669` (`ok`) left border + `bg-ok-bg/40` + opacity 0.75. Split: `#D6D3E0` (ink-200) left border. All 3px; source is the `borderLeft` chain in `app/(mail-orders)/mail-orders/mail-orders-table.tsx:851-865`. (Table View is dormant while Billing is on for all users — `CLAUDE_MAIL_ORDERS.md §9.1`.)

Punched orders separated to bottom per slot when slot selected. Collapsible "N punched ▸/▾" divider. `T` toggles globally.

---

## 24. Mail Orders — description toggle

In Review View SKU table header column, tiny `[long]` / `[short]` button. State `descMode: "long" | "short"` persisted to `localStorage` key `mo-review-desc-mode`. Default `"long"`.

---

## 25. Mail Orders — Bill N split labels

DB column `splitLabel` stays `A`/`B`. UI shows via `getSplitDisplayLabel(order)`:
- splitLabel `A` → "Bill 1"
- splitLabel `B` → "Bill 2"
- Compound: parent `Bill 2` + splitLabel `A` → `Bill 2-1`

---

## 26. Mail Orders — bill sort order

`receivedAt` ASC → bill number ASC → split label (A before B).

---

## 27. Fixed table layout standard

All data tables use `table-layout: fixed` with `<colgroup>` percentage widths.

### Pattern
```tsx
<table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
  <colgroup>
    <col style={{ width: "4%" }} />
    <col style={{ width: "24%" }} />
  </colgroup>
  ...
</table>
```

### Rules
- Always `table-layout: fixed`
- Always `<colgroup>`
- Always percentage widths (pixel only for padding/row height)
- Cell overflow: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`

### Standard row sizing
| Element | Value |
|---|---|
| Header row height | 32px |
| Data row height | 36px |
| Cell padding L/R | 14px (`px-3.5`) |
| First column padding | `pl-[10px] pr-[4px]`, text-align center |
| Last column padding | `pr-[12px]`, text-align center |
| Header border bottom | `1px solid #ebebeb` |
| Data row border bottom | `1px solid #f0f0f0` |

### Header typography
`font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af`

### Data typography
- Primary: 11px, font-weight 500, #111827 — customer/product names
- Secondary: 11px, #4b5563 — data values
- Muted: 11px, #9ca3af — timestamps, line numbers
- Mono: 11px, "SF Mono"/ui-monospace/Menlo — SKU codes, material numbers

### Applies to
- Review View SKU table: 4/24/11/26/5.5/5.5/5.5/12/6.5%
- Mail Orders expanded table
- Tint Manager board table (`components/tint/manager/board-table.tsx`; widths owned by `CLAUDE_TINT.md §1.3`)
- Challan line items: 5/13/35/15/8/12/12%
- Admin attendance roster
- Admin OT pending queue
- Admin OT audit user table
- Sampling Library recipe table
- Any future data table in any module

**Support never belonged on this list.** Its tables were CSS Grid, not `<table>` (board retired
2026-07-27 — §58); the live takeaway is the Grid-native equivalent rule below.

### Grid-native equivalent — percentage tracks on CSS Grid (2026-07-09)

When a table is built as **CSS Grid rows instead of `<table>`** (each row its own independent grid
instance, e.g. Support), `table-layout:fixed` + `<colgroup>` isn't available — but the same
content-blind column sync can still be achieved: **percentage grid-template-columns tracks**,
one shared string constant read by both the header and every row.

**Why this is the only scheme that works** (the reusable lesson — full narrative + measured drift
numbers are archived at `archive/2026-07-support/docs/CLAUDE_SUPPORT.md §4.19`):
- `fr` distributes *leftover* space, which depends on row content — one row's long value pools
  surplus into a column and shifts everything right, in that row only.
- `minmax(0, Nfr)` stops one value inflating its own track but doesn't fix the pooled surplus.
- `max-content` sizes each grid instance to its OWN content — two rows with different cell content
  land the same column at different pixel positions (measured drift up to ~67px). Structurally
  impossible to align across independent grid instances.
- Fixed `px` works but is content-blind by luck, not design, and leaves guessed/dead space.
- **Percentages resolve against the container width, never cell content** — since every row
  renders at the same container width, the same percentage string yields identical pixel columns
  across every independent instance. This is the Grid-native equivalent of `<table>` +
  `table-layout:fixed` + `<colgroup>` percentages — use it for any future per-row-grid table.

Rule: one shared percentage-string constant, read by header AND every row; never reintroduce `fr`,
`max-content`, or `auto` on such a table once percentages are locked in.

---

## 28. Review View — layout

Component: `review-view.tsx`. Master-detail third mode on `/mail-orders`.
Split panel: 320px left (order list) + flex-1 right.

Page background: `bg-gray-50`. Cards + SKU table sit as white islands.

### Layout structure

```
┌─────────────────────────────────────────────────────────────────┐
│  ┌─────────────────┐   ┌─────────────────┐                      │
│  │ BILL TO         │   │ SHIP TO  [⚑]    │  ← amber bar         │
│  │ ● Customer Name │   │ ● Customer Name │    if override       │
│  │   [code] · area │   │   [code] · area │                      │
│  │   [bill pills]  │   │   [ship pills]  │                      │
│  └─────────────────┘   └─────────────────┘                      │
├─────────────────────────────────────────────────────────────────┤
│  SO name · time · vol · ✓ 7/7 · punched · actions · SO# · Punch│
├─────────────────────────────────────────────────────────────────┤
│  ● delivery — "leave at gate"   ← gray-200 attention band      │
│  ● bill     — "split into 2"                                   │
│  ● notes    — "spoke to Mahesh"                                │
├─────────────────────────────────────────────────────────────────┤
│  Manual split banner (if triggered)                            │
├─────────────────────────────────────────────────────────────────┤
│  [ SKU TABLE — inside white wrapper on gray-50 page ]          │
└─────────────────────────────────────────────────────────────────┘
```

### Left panel (320px)

- Search input: 28px height, 11px font
- Order rows: `px-3.5 py-2.5`, border-bottom gray-100, border-left 3px
- States: selected (`bg-brand-50 border-l-brand-600`, `review-view.tsx:1129`), flagged (`border-l-amber-600`), punched (`opacity-40`), default (`border-l-transparent`)
- Line 1: delivery dot + customer name (13px semibold) + time (right, tabular-nums)
- Line 2: SO name (11px muted)
- Punched orders: third line `✓ {Name} {HH:MM}` (text-gray-400)
- Badges: Bill N (blue) + split (purple) only
- Sort: `receivedAt ASC → bill number ASC → split label ASC`. Punched section sort DESC.

### BillToCard component

Props:
```ts
{
  customerName, customerCode, customerArea,
  customerMatchStatus: "exact" | "multiple" | "unmatched" | null,
  deliveryType,
  signals: OrderSignal[],       // bill-class only
  onCodeClick?: () => void,
  popoverSlot?: React.ReactNode,
  chipFallbackLabel?: string,
}
```

Match status modifies code chip background:
- `exact` → gray (`bg-gray-100 border-gray-200 text-gray-700`)
- `multiple` → amber + `chipFallbackLabel="N found ▾"`
- `unmatched` → red + `chipFallbackLabel="Search…"`

Popover content (candidate list, search) is passed verbatim as `popoverSlot`.

### ShipToCard component

Props:
```ts
{
  shipToName, shipToCode, shipToArea, deliveryType,
  isOverride: boolean,
  signals: OrderSignal[],   // delivery-class only
}
```

- `isOverride=false` → mirrors Bill-to fully (code chip gray default, NOT match-modulated)
- `isOverride=true` → 3px amber left bar via `before:` pseudo + small amber `⚑ captured` pill inline with "SHIP TO" label

### MetaRibbon component

`px-5 pt-3 pb-[7px]`. SO name · time · vol · ✓ N/M · `✓ {Name} {HH:MM}` (if punched) · 4 icon-only action buttons (28×28: Copy/Reply/Flag/Printer) · SO Number input slot · Punch button slot.

### InstructionsStrip component

`components/mail-orders/instructions-strip.tsx`. Default tone: `bg-gray-200`, `border-t border-gray-100`, `pt-3 pb-3`, rows `px-5` (`:101`). Returns null when all three values are null/empty.

**`tone?: "default" | "notes"` prop (`:19`):** default = the gray strip above. `notes` = the Billing notes band: `bg-brand-50` + 3px `border-l-brand-600`, text `brand-800`, captions `brand-600`, and the notes dot `bg-brand-600` (`NOTES_DOT`, `:54`); the delivery (amber) and bill (blue) dots keep their colours in both tones. Only `review-view.tsx:2302` passes it, on the Billing face. The file's own comments still say "violet" and cite `components/floor/tint-strip.tsx`, which was archived to `archive/2026-09-floor-rail/` in `79bcc412` — stale comments.

**`fontSize?: number`** (default 11) sizes the remark text on all three rows in both tones; **`controlsSlot?: ReactNode`** renders top-right inside the band. The Billing face drives both from the per-user notes size and its −/+ stepper → `CLAUDE_BILLING.md §9`.

```
● delivery (amber dot)  — from deliveryRemarks minus [→ Name (Code)] suffix
● bill     (blue dot)   — from billRemarks
● notes    (gray dot)   — from remarks
```

### Active line highlight

Background `#fefce8` (yellow-50). First cell left border `3px solid #eab308` (yellow-500). `activeLineIndex` resets to 0 on order change.

### Manual split banner

Amber banner between detail header and SKU table when `!splitLabel && (totalVol > 1500 || lines > 20)`. Group A/B preview. Split button posts to `/api/mail-orders/{id}/split`. Pooler retry-poll loop (5 × 400ms) handles read-after-write lag.

### Print

4th icon-only action button (Printer, 28×28). Calls `window.print()`. Print CSS scoped under `#mo-print-area`. Nav footer + action buttons + SkuToggle hidden via `.mo-print-hide`. Print: A4 landscape, 10px base, footer `OrbitOMS · JSW Dulux Surat Depot · Printed {IST date time}`.

🔴 **DEFECT — recorded, not fixed.** The landscape rule is `@page mo-landscape` at
`app/globals.css:630`, and it sits **inside** the `@media print` block opened at `:422` (brace
depth 2 at `:630`). That breaks `CLAUDE.md §1` and §32's "`@page` rules MUST be top-level" —
the file's own comment at `globals.css:33-35` calls it "a pre-existing violation … Do not copy
it." Whether the mail-order print actually comes out landscape has not been tested; it needs a
real print test before anyone relies on "A4 landscape" above or moves the rule.

---

## 29. Review View — SKU row states

**Normal:** raw text #374151, SKU mono #6b7280, product bold #111827, qty bold #374151.

**Partial:** description + SKU in amber (#b45309 / #d97706). PARTIAL tag: `9px font-semibold, bg-amber-50 text-amber-700 border-amber-200`.

**Not-found (toggle OFF):** all text #d1d5db EXCEPT qty stays #374151. Status cell shows reason label.

**Unmatched:** description italic #9ca3af "No match found". UNMATCHED tag. "Resolve →" link: 10px `#7C3AED` (brand-600) weight 500, underline on hover (`review-view.tsx:2636`).

---

## 30. Review View — toggle + reason dropdown

**Toggle:** 28×14px. ON `bg-green-600`. OFF `bg-gray-300`. Knob 10×10px white.

**Reason dropdown:** 148px wide, white bg, rounded-lg. Options numbered 1-5: `out_of_stock`, `wrong_pack`, `discontinued`, `other_depot`, `other`. API expects snake_case — never display labels.

---

## 31. Delivery Challan — split view

Left panel (320px): compact 3-line rows: OBD mono + challan badge / customer name / SMU dot + route + articles. Selected: `#F5F3FF` (brand-50) background + 3px `#7C3AED` (brand-600) left border (`challan-content.tsx:386-387`). No search in panel.

Right panel: action bar (challan ID mono + OBD + customer gray-400 | Edit outline + Print dark) + challan document on `#f9fafb`.

UniversalHeader: no segments. Filter groups: SMU + Route. Date stepper. Search.

### Voided challan rendering

When `delivery_challans.isVoided === true`:
- Diagonal red watermark across document body (`VOIDED` text, ~30% opacity, 45° rotation)
- Print button + PDF action disabled
- Red banner above document: `VOIDED · {voidReason} · {voidRemark} · by {name} on {DD MMM YYYY HH:MM}`
- Document still rendered (audit trail)

---

## 32. Delivery Challan — document (B&W print)

**Palette (document only):** #111827, #374151, #6b7280, #9ca3af, #d1d5db, #e5e7eb, #f0f0f0, #f9fafb, #fff. **NO brand violet. NO blue.**

**Logo:** `/jsw-dulux-logo.png` (800×193, 101 KB, transparent PNG-24). Height 34px on web AND print. Container `paddingRight: 24px`. **Web view: NO inline filter (full colour).** **Print view: `filter: grayscale(100%) brightness(0) !important` via `@media print`.**

**Header layout:** Logo · "DELIVERY CHALLAN" centred · Challan number + OBD date right column (`minWidth: 165`). Right column: bold mono challan number stacked over light `DD MMM YYYY`. Labels removed.

**Structure:** Header → dark address bar (#374151, only dark section) → SMU/OBD/Warehouse fields → Bill To / Ship To (with #f9fafb sub-headers, billToAddress lookup via billToCustomerId) → Customer/SO/Receiver (S5) → Line items table → Footer.

**S5 contact rendering:** Name line 1 (`fontSize 11, color #374151, marginTop 3`), phone line 2 (`fontSize 10, color #6b7280, marginTop 1, fontFamily SF Mono`). Fallback `<div height:20>` preserves row height.

**Bottom bar:** `Regd. Office: <addr> · www.akzonobel.co.in · JSW Dulux Limited (formerly Akzo Nobel India Limited)`.

**Table:** `<colgroup>` 5/13/35/15/8/12/12%. Header 28px #f9fafb. Data rows 32px. Blank rows to minimum 8. Totals row 2px top border.

**Print CSS:** `@page` rules MUST be top-level in `globals.css` — cannot nest in `@media print`. Use `visibility: hidden` on body + `visibility: visible` on print area (not `display: none`).

---

## 33. TM table

The Tint Manager board is a rail + ONE grouped fixed table (`components/tint/manager/board-table.tsx`, §27 standard). Columns, widths, grouping and the `#` rank rule are owned by `CLAUDE_TINT.md §1.3`; statuses by `§1.4`. Was a four-column Kanban with a card/table toggle until 2026-09-06; now the rail + table (`a0f9378b` → `082eb92e`). Do not revert — `components/tint/tint-table-view.tsx` is retired with no importer.

---

## 34. Tint Operator v4 — layout

Business behaviour: `CLAUDE_TINT.md §3`.

- Row 1: UniversalHeader — title is the Jobs/History `HeaderViewToggle` (§21; the words "My Jobs" are gone), stats, clock, search
- Row 2: Job filter as a **`bg-brand-600` segment pill** (leftExtra; `tint-operator-content.tsx:1649`), amber `bg-amber-50 border-amber-200` when only paused work is left (`:1660`). Click opens 400px dropdown with 3 labelled sections: CURRENT / PAUSED / UP NEXT. Progress bar (rightExtra): amber <25%, `tint-600` 25-75%, green ≥75% (`progressColor`, `:1551`). The History face → `CLAUDE_TINT.md §3.13`.
- Below Row 2: Bill To / Ship To as equal-width cards (`grid-cols-2`)
- Main: 320px SKU left panel + flex TI form right. Mobile: left hidden below md.

**Colour budget:**
- Brand: sidebar + job pill segment ONLY (shared universal-header segmented control stays brand)
- Gray-900: save CTAs + selected card border
- Green-600: workflow CTAs (start, done)
- Amber-600: Pause CTA + paused-card amber accents
- Pigment colours: shade grid cells ONLY
- **Fini/Generic + Tinter/Acotone toggles → white-pill on gray-100 track** (active `bg-white text-gray-900 shadow-sm`), NOT `bg-gray-900`.
- **Reuse-list "Use" buttons → soft grey** (`bg-gray-200 text-gray-800`), not `bg-gray-900`.
- Everything else: white, gray-50, gray-100, gray-200, gray-400

**Status badges removed:** "Assigned" job-header badge removed ("In Progress" retained); "Pending" line-card pill → plain `text-amber-700 font-semibold` text (no box).

**Left panel card states:**
- Selected: `bg-gray-100 border-l-[3px] border-l-gray-900`
- Unselected: `bg-white border-gray-200 hover:bg-gray-50`

**CTA rules:**
- Save (Save TI, Update TI Entry): `bg-gray-900 text-white`
- Workflow (Save TI & Start, Start Job, Mark as Done): `bg-green-600 text-white`
- Pause: `bg-amber-600 text-white`
- Skip: passive ghost `bg-gray-100 text-gray-700`

### Search-first sampling reuse list

Single search row at parent level: `[PACK ▾] [Search…] [+ Add shade]`. Below it, a single **flat** suggestion list (`flat-suggestion-list.tsx`) — not the old exact/reference two-section split. Per-entry view mode `browse | confirm | newshade` (collapses on pick so the TI form never sits under a long list). Behaviour: `CLAUDE_TINT.md` / `CLAUDE_SAMPLING_LIBRARY.md`.

- **Columns** (fixed-table, §27): Sampling · Shade · Site · PACK · LAST USED · FORMULA (chips only) · Use.
- **Exact row** pinned top: `bg-[#eef1f4]` wash + `border-l-[3px] border-l-gray-900` + grey EXACT chip; pigment chips white-bg.
- **Reuse heading:** `text-gray-900 font-semibold` "REUSE A SHADE — ANY SITE".
- **Tinter-type tag** per card: TINTER (grey) / ACOTONE (orange).
- **PACK filter dropdown** (defaults to the line's pack bucket): `All packs · {total}`, then `1 LT`, `4 LT`, `10 LT`, `20 LT` — each `{n} LT · {count}`, the line's bucket tagged `· LINE`, 0-count buckets disabled. Four **nominal buckets only** (1/4/10/20 via `packDoseLitres`; folds 3.6/3.7→4, 0.9/0.925→1, 9/9.25→10, 18/18.5→20); rare packs (0.5/15/22/30/40/null) appear only under "All packs".
- **PACK pill** shows the NOMINAL label (a 3.7L/18L shade reads "4 LT"/"20 LT"). **Green** = same bucket as the line (exact fit); **grey** = different bucket (formula auto-scales to the line pack on **Use**, TINTER only). The list shows **raw stored values** — it is a FILTER, not an auto-scaler.
  - ⚠️ Superseded: the earlier flat "scale-everything-to-line-pack with ✓ (exact) / ×N (scaled) markers" list and the `scalingEnabled` prop are **removed** — do not reintroduce.
- **"Same shade found" / reuse modal** (`formula-match-modal.tsx`): scaled matched rows; **Cancel / Esc / backdrop aborts with NO new sampling number** — only **Use** (reuse, scaled) and **Create new** mint/save.

---

## 35. Pigment shade cells (Tint Operator)

Each shade input has tinted background + 3px top border in actual pigment colour. `border-radius: 0 0 6px 6px` (flat top, rounded bottom).

Colour constants at top of `tint-operator-content.tsx`: `TINTER_SHADE_COLORS` and `ACOTONE_SHADE_COLORS` maps.

### TINTER pigments (13)
| Code | Pigment | Hex |
|---|---|---|
| YOX | Yellow Oxide | #b8860b |
| LFY | Light Fast Yellow | #cccc00 |
| GRN | Phthalocyanine Green | #2e7d32 |
| TBL | Thalo Blue | #1565c0 |
| WHT | Titanium White | #757575 |
| MAG | Magenta | #c2185b |
| FFR | Fast Fire Red | #d32f2f |
| BLK | Carbon Black | #37474f |
| OXR | Oxide Red | #8d3c1a |
| HEY | Hansa Yellow | #c9a800 |
| HER | Hansa Red | #e53935 |
| COB | Cobalt Blue | #283593 |
| COG | Cobalt Green | #00695c |

### ACOTONE shades (14)
YE2/YE1, XY1, XR1, WH1, RE2/RE1, OR1, NO2/NO1, MA1, GR1, BU2/BU1.

Toggle: "+ Show all 13" expands. "− Show active only" collapses.

---

## 36. PauseJobModal (Tint Operator)

Used when operator pauses a `tinting_in_progress` job.

- 5 vertical radios: `lunch_break / shift_end / machine_breakdown / material_shortage / urgent_priority`
- Optional remark with 500-char counter
- Per-SKU steppers (whole int, `0 ≤ doneQty ≤ assignedQty`)
- Soft-cap red banner shown when this would be pause #3 of 3 on this job
- Amber-600 CTA "Pause Job"
- Sonner toast on success

---

## 37. PauseHistoryModal + SkipHistoryModal (TM side)

Both use same shell: chronological list (oldest first), one row per event.

**PauseHistoryModal row:** date+time · paused-by name · reason chip · remark · progress snapshot · elapsedAtPause minutes · resumeAt or "still paused" badge.

**SkipHistoryModal row:** date+time · skipped-by name · reason chip · tinter-type (if `TINTER_FINISHED`) · out-of-stock colours (chips) · remark · "Reassigned by {name} at {time}" trailing line if applicable.

Modal trigger: the Tint Manager detail panel's "View full pause history →" and skip-history links (`components/tint/manager/board-detail-panel.tsx:430`, `:448`, wired in `tint-manager-content.tsx:1020-1021`). The Kanban's five entry points went with the Kanban (§33).

---

## 38. MarkDoneConfirmModal (Tint Operator)

Per-SKU steppers pre-filled with `assignedQty`. "Total tinting time" summary line (`accumulatedMinutes` + final segment).

Two-stage confirm:
1. `[Cancel] [Confirm Done]` — visible always
2. If any SKU `doneQty < assignedQty` → amber banner "Short by N tins. Continue?" → `[Back] [Yes, mark done]`

Server validates `0 ≤ doneQty ≤ unitQty` per SKU + writes `currentProgress` snapshot.

---

## 39. RemoveObdModal (TM)

Two predefined reasons (radios): `CUSTOMER_CANCELLED`, `WRONG_ORDER`.
Mandatory free-text remark (500-char limit).
Warning banner: "Linked delivery challan will be voided."
Destructive confirm: `bg-red-600 text-white`.

Only available when `workflowStage === 'pending_tint_assignment'`. Server returns 409 otherwise.

---

## 40. OT prompt screens (check-out)

Used in `/attendance/check-out` flow when current IST time >= `otTriggerTime` (⚠ corrected 2026-08-05 — this line cited `otCutoffHourIST`, a column that does not exist; `CLAUDE_ATTENDANCE.md §16`).

### Choice screen
"Were you doing overtime work?" + amber callout with current time + trigger time.
Two buttons: "Yes, claim OT" (`bg-brand-600 hover:bg-brand-700`, `components/attendance/check-out-flow.tsx:492`) / "No, just clocking out" (white outline).
"Cancel and go back" link returns to camera (photo discarded).

### Reason screen
Textarea, amber callout showing "N min overtime so far".
Submit enabled when reason has non-whitespace content (1+ char).
Back link returns to choice (reason discarded).

### Success banners (DaySummaryView)

Per §3 OT outcome banners table.

---

## 41. Place Order — top bar

Sticky 52px. Logo+wordmark left · Customer pill centre (`px-2.5 py-1`, `max-w-full min-w-0 truncate`) · Send button + cart counter right. Wrapper around `<CustomerSearch>` must NOT have `overflow-hidden`.

Page title: "Purchase Order (PO)" (in sidebar nav + top bar).

---

## 42. Place Order — speed dial

9-tile fixed grid. Tiles in order:
`1 GLOSS · 2 Satin & PU · 3 PROMISE · 4 WS · 5 VELVET TOUCH · 6 SADOLIN · 7 STAINER · 8 Putty & Primer · 9 AQUATECH`

Some tiles are multi-family (one card, several families' tabs): "Satin & PU", "Putty & Primer". Spec: `CLAUDE_PLACE_ORDER.md §6/§23`.

Two render modes:
- **Browse mode** (`activeState.kind === "idle"`): full 9-tile grid
- **Work mode** (sub-product active): compact horizontal pill strip (~40px). Active pill `bg-brand-50 border-brand-600 text-brand-700` + `brand-500` ▸ marker (`speed-dial-grid.tsx:52`, `:60`). Tabs never wrap (`whitespace-nowrap shrink-0` button + `overflow-x-auto` row).

Digit shortcuts 1-9. No Tab cycle.

---

## 43. Place Order — variant grid

Sub-product tabs · pack header row · base × pack matrix. Card never scrolls internally.

**Pack header:** single-line, 10.5px. Format `{pack} · {containerLabel}` (mono gray-400). Helper: `packContainerLabel()`. Desktop columns come from a fixed bucket set, not the raw pack union (`CLAUDE_PLACE_ORDER.md §24`).

**Pack columns:** explicit 80px width via `style={{ width: "80px" }}` on each `<col>`. `table-layout: fixed`.

**Pagination:** `VARIANT_GRID_PAGE_SIZE = 20`, threshold = 22 (page-size + 2 buffer; no 1-row trailing pages). >22-base sub-products paginate.

**Row label:** single-product tab → `baseColour`; multi-product tab → `displayName` (so stacked brands read "2K PU Gloss - 90 Base"); `multiProductTab` computed over the FULL tab. Rule + collisions: `CLAUDE_PLACE_ORDER.md §7`.

**Tab strip:** never wraps (`whitespace-nowrap shrink-0` + `overflow-x-auto`); single-uiGroup family hides the tab bar (flat list). `TAB_DISPLAY` render-map merges/relabels tabs (e.g. WS "Tile & Metallic").

**Cell sizing:** 56×32px, font 13px.

### Two-line result display (descriptor)

Result rows and product headers can show a **muted second line** under the primary label: `text-[12px] text-gray-400 truncate mt-0.5`. Static map `lib/place-order/sub-product-descriptors.ts` (family|subProduct → descriptor) — no schema/seed field. Primary line is composed `"{displayName} — {baseColour}" + " · {alias}"`; the descriptor is a separate `<p>`.
- e.g. Satin Finish primary `Satin Finish — <base> · <alias>`, descriptor `Super Satin · Oil Base`.
- **Single-base / variant-qualifier tabs** (Promise SmartChoice/Primer): the per-variant qualifier moves to the second line via `getSecondLine(family, subProduct, qualifier)` (folds `{descriptor} · {qualifier}`, omits qualifier when null) and the line-1 alias suffix is suppressed; when the variant name already contains the tab word ("Primer"), the headline is the variant's own name.
- `/po` search rows fall back to `?? p.family` so plain products still show a grey line.
- Render sites: mobile (`app/po/po-page.tsx`) search/selected/picked/active header; desktop `big-search-bar.tsx`, `variant-grid.tsx`, `sub-product-direct.tsx`. Cart has no family → no descriptor.

---

## 44. Place Order — variant cell

Cell stores **UNITS** in `cart.packQtys[pack]`.

**Keyboard inside cell:**
- 0-9 → write units
- `+` or `=` → `qty + boxSize`
- `-` or `_` → `Math.max(0, qty - boxSize)`
- All call `e.preventDefault()`

**Hover/focus +/− buttons:** 2 absolute buttons 16×14px. `+` top-right, `−` bottom-right. `opacity-0` default → `opacity-100` on group-hover/focus-within. `tabIndex={-1}` + `onMouseDown={e.preventDefault()}`.

---

## 45. Place Order — cart panel

340px right column. Card list grouped by product/base.

**Row name:** desktop cart labels by **`baseColour`**; an empty string (`""`) blanks the line (not nullish) → fall back to `emailLineLabel(product, baseColour, subProduct)`. `/po` cart labels by `displayName` and never blanks.

**Chip format:** primary `×{units}` (mono gray-700 semibold). Conditional `· {N} box` (gray-400 normal) when `step > 1 && units > 0 && units % step === 0`.

**Volume total:** `sum += units * packToLitres(pack)`. NO `packStep` multiplier.

**Recently used:** shown only in browse state. Driven by `touchedAt?: number` on `CartLine`.

### Bill bar + options panel (desktop parity with /po, 2026-06-09)

- **Bill bar always visible** once a customer is selected — Add / Duplicate / Delete + inline delete-confirm reachable from the single-bill state. `id === index+1` enforced by `renumberBills()` after every add/delete/duplicate AND on draft restore; `activeBillId` never dangling. Delete-confirm only when the bill has lines; empty deletes immediately; disabled at 1 bill. Duplicate deep-copies lines + nested `packQtys`.
- **Options always open** (no "More options" collapse): Ship-to / Dispatch / Remarks / Notes.
  - **Dispatch dots** Normal / Urgent / Call (`#9C99AC` ink-400 / `#f59e0b` amber / `#ef4444` red — `app/(place-order)/place-order/components/cart-panel.tsx:438-440`); clicking Call opens an SO/Dealer picker.
  - **Remarks** 2×2 Truck / Cross / Bounce / DTS (re-tap clears, no "None"); Cross opens a depot picker (Dahisar/Ahmedabad/Rajkot/Pune). Pickers render only while their parent option is active.
  - **Notes** free text + Quick-add presets. **Ship-to** autocompletes; omitted from email when "same as billing".
- **Landing recents grid** (desktop): 2-col, borderless soft-fill rows, neutral gray avatars, medium-weight names, relative recency; shows only when no customer selected AND search empty AND recents non-empty (else the "Type a customer name… N loaded" hint). `area` shown when present, code-only when null.

---

## 46. Place Order — page layout

Fixed-height, no vertical scroll. Root `h-screen overflow-hidden flex flex-col`. Top bar `flex-shrink-0`. Content `flex-1 overflow-hidden`.

Viewport guard: `< 1024px` redirects to `/po` on mount AND on `resize` (repointed from `/order` 2026-07-27, commit `9dce858b`).

---

## 47. /order public mobile patterns — RETIRED 2026-07-27

`/order` no longer exists; the page is archived at `archive/2026-07-order/`, and
`archive/2026-07-order/README.md` owns the retirement story. Do not restate it here.

**Most of this section was NOT `/order`-specific and has been MOVED, not deleted** — the
Visual Viewport `--vvh` keyboard fix, the app-wide `app/layout.tsx` viewport export, the
empty-state row, and the qty-input / desktop-autofocus rules are all still live in `/po`
and now live in **§55** under "Mobile viewport, keyboard + input patterns".

What was genuinely `/order`-only, and is gone with it: its 3-state sticky header (`/po`'s
merged customer header is a different design — §55), the `data-pack-row` +
`scroll-mt-[140px]` picker-scroll target, the picker's ghost **Skip** / teal **Next**
buttons, and the `BILL N · X products · Y units` summary chip. The archived page is the
reference if any of it is ever wanted back.

`/po`'s visual spec is **§55**. Its behaviour is `CLAUDE_PLACE_ORDER.md §25`.

---

## 48. Attendance — mobile PWA patterns

Full-screen, no sidebar. 480px max column, centred on tablet/desktop.

**Bottom nav (end users):** Today + History tabs. No Profile tab.

**Status chips:** per §3 colour map.

**Photo preview:** 240×320 face frame guide overlay. Compressed client-side to 640px Q70 JPEG.

**Admin photo viewer:** lazy fetch signed URL (5min expiry) from `GET /api/admin/attendance/photo?recordId=N`.

**PWA manifest:** start_url `/` (the real `public/manifest.json` says `/`, NOT `/attendance` — corrected 2026-07-22; the installed app launches at root and the auth/role redirect takes over. `CLAUDE_ATTENDANCE.md §14`). `theme_color` `#7C3AED`. Icons: the white outlined wordmark on a five-stop violet radial tile (`#8460EF` → `#7C3AED` → `#4C1D95`, `public/icon-source.svg`, generated by `scripts/generate-wordmark.mjs` — §2.3, §12.1.1), rendered by `scripts/generate-icons.mjs` to `icon-192.png`, `icon-512.png` (also the maskable entry) and the 180px `apple-touch-icon.png` (`3b0490e6`, `67d734e2`).

---

## 49. Admin OT pending queue UI

Page `/admin/attendance/ot-pending`. Header: the attendance admin's own two-strip `attendance-page-header.tsx` — NOT UniversalHeader (corrected 2026-08-04; §6 roster). Title "OT Pending Approvals" + status filter.

Per row: user · date · claim reason · total worked · OT minutes raw · `[Approve]` · `[Reject]`.

Approve modal: optional adjusted-minutes input + confirm.
Reject modal: user/date/reason quote · amber warning "Rejected days still consume monthly grace" · optional admin note (500-char limit with counter).
On 409 (already actioned by other admin): inline error "Already actioned. Closing…" + parent refetches.

Empty state: lucide CheckCircle2 in emerald circle, "Nothing pending" headline.

---

## 50. Admin attendance settings UI

Page `/admin/attendance/settings`. Header: `attendance-page-header.tsx` (breadcrumb "Attendance · Settings") — NOT UniversalHeader (corrected 2026-08-04; §6 roster). "Last updated {date} by {name}".

6 sections (in order): Rollout · Work hours · Geofence · Photo policy · OT policy · Thresholds.

**OT kill switch:** `otPromptEnabled` toggle is PROMINENT at top of OT policy section. Toggling OFF opens a confirm modal first.

**Sticky save bar (bottom):** `position: sticky bottom-0`. Left: "Discard changes" link (only when dirty). Right: "{n} fields changed" + "Save changes" button (`bg-gray-900 text-white`, disabled when not dirty).

Dirty detection: only changed keys are sent in PATCH body.

Toast variants:
- 200 + `willForceReconsent: true` → amber "Re-consent triggered"
- 200 + `rolloutActivated: true` → green `ok` "Rollout activated" (`components/admin/attendance/settings-toast.tsx:26-29`)
- 200 → gray-900 "Settings saved"
- 400 with errors → red, distribute errors to fields/sections
- 403/401 → "Session expired — refresh and re-login"

---

## 51. Admin OT audit UI

Page `/admin/attendance/ot-audit?month=YYYY-MM`. Header: `attendance-page-header.tsx` — NOT UniversalHeader (corrected 2026-08-04; §6 roster). Month picker on right (`{Month} {YYYY} ▾`).

6-tile stats strip: Total OT credited · Auto credited · Grace credited · Admin approved · Pending (amber when >0) · Rejected.

User table: # · User · Days · Total OT · Auto · Grace · Approved · Pending · Rejected · expand chevron. Sort: Total OT DESC. Row click toggles expand (whole row hit target).

Expand panel: day-by-day rows with per-day breakdown.

---

## 52. Outlook email safety (mail order slot summary)

Non-negotiable for OWA paste survival:
- Zero `<div>`, zero `<p>`, zero margin
- `background-color` on `<td>` only (spans get stripped)
- `font-family` on every `<td>`
- No `border-radius`
- Nested `<table>` for layout
- Meta `format-detection` + `x-apple-disable-message-reformatting`

**Confirmed OWA behaviour:** paste strips `color:` on `<td>`. Only text suffixes survive.

---

## 53. ContactCard component (Customer Master + Missing Customer Resolver)

Component: `components/admin/contact-card.tsx`. Renders a single contact (Bill-to dealer or Ship-to site contact). Two states: auto-managed (synced from a Sales Officer) and manual.

### Layout

Three rows:
1. Avatar (32×32 circular initials, `w-8 h-8`, `contact-card.tsx:90`) · name · phone · remove
2. Email · contact-role select
3. Auto badge (auto contacts only) + "Primary" checkbox (`accent-brand-600`)

**Avatar colour** (`contact-card.tsx:76-78`): role-tinted from `SO_ROLE_AVATAR_CLASSES`
(`components/admin/customer-sheet.tsx:71-73`) when the contact is linked to an SO — PRIMARY
`bg-brand-100 text-brand-700`, BACKUP `bg-blue-50 text-blue-700`, JUNIOR `bg-amber-50
text-amber-700` (§10.1); otherwise `bg-gray-100 text-gray-700`.

### Auto-managed contact

When `contact.linkedSalesOfficerId` is non-null:
- Avatar: role-tinted, above
- Badge: `bg-brand-50 text-brand-700 border-brand-200` pill with a link icon (`contact-card.tsx:175`), label `Auto · {Role} SO` where Role is the SO's role on this customer (Primary / Backup / Junior). e.g. "Auto · Primary SO".
- Delete (×) button:
  - **Admin Customer Master** form: enabled, opens AutoContactDeleteDialog confirm modal
  - **Missing Customer Sheet** (`components/shared/customer-missing-sheet.tsx`, mounted by Tint Manager's customer-missing interceptor — `CLAUDE_TINT.md §1.5`; its Support mount retired 2026-07-27): DISABLED with tooltip "Remove via Sales Officers tab" (create-only flow)
- Name + phone are NOT editable inline — single source is the SO master record. Refreshed on every save via the SoSync backend stages.

### Manual contact

When `linkedSalesOfficerId` is null:
- Avatar: `bg-gray-100 text-gray-700` initials
- No badge in row 3
- Delete (×) button always enabled
- Name + phone editable inline

There is no separate "newly-converted" look: `contact-card.tsx` renders only the two states
above (no `Auto · Linked` label and no amber avatar in the file). A contact linked during
reconcile renders as auto-managed.

### Modal — AutoContactDeleteDialog

`components/admin/auto-contact-delete-dialog.tsx`. Confirms manual deletion of an auto-contact.

- Title: "Remove this auto-contact?"
- Body: "Removing {SO Name}'s auto-contact stops them from re-syncing here. To bring them back, re-add via Sales Officers."
- Buttons: `[Cancel]` (white outline) + `[Yes, remove]` (`bg-red-600 text-white`)
- On confirm, server stamps `customer_sales_officers.contactDismissed = true` and deletes the contact row.

---

## 54. Multi-SO list pattern (Customer Master)

`components/admin/sales-officers-list.tsx`. Sits in Sales & Classification section of customer form. Replaces the legacy single SO dropdown.

### Row anatomy (per assigned SO)

```
[ {SO Name} · {SO Phone}          ]  [Primary | Backup | Junior]  [×]
```

- No avatar on this row: a locked 34px name box (`{name} · {phone}`, phone `text-gray-400 text-[11px]`), then the role pill-group (`sales-officers-list.tsx:103-131`).
- Role pill-group: three joined 28px buttons. Active value is role-tinted (`ROLE_PILL_ACTIVE`, `:35-39`) — PRIMARY `border-brand-300 bg-brand-50 text-brand-700`, BACKUP `border-blue-300 bg-blue-50 text-blue-700`, JUNIOR `border-amber-300 bg-amber-50 text-amber-700`; inactive `border-gray-200 bg-white text-gray-400` (`:41`). Tap a value to set it.
- `×` removes the SO (cascades: deletes the matching auto-contact unless `contactDismissed`).
- Exactly one Primary allowed at a time. Promoting a second SO to PRIMARY demotes the previous Primary to BACKUP (per the §3 reconcile pattern).

### Empty state

Single CTA card: "+ Add Sales Officer" centered. Body: "Add 1 or more sales officers to this customer".

### Add SO modal

Search box + result list filtered against `sales_officer_master`. Active SOs only (legacy inactive SOs surface only during data migration). Tap to add as BACKUP by default; promote to Primary via the chip after add.

---

## 55. Place Order — /po mobile

Behaviour + architecture: `CLAUDE_PLACE_ORDER.md §25`. `/po` is live and runs alongside `/po2`
(+ its `/po9` mount); its retirement is planned but not scheduled — `/po2` and that
relationship are owned by `CLAUDE_PO2.md` (§2, §15). Visual specifics of `/po`:

- **Landing:** one elevated shadowed search field (rounded-16, shadow `0 8px 28px rgba(17,24,39,.09)`, `pt-8`) under the "Purchase Order" banner. No label/heading/recent list on the fresh page. Top gap (2026-07-14) tuned for taller phones (S20 Ultra, iPhone 12 Pro) to breathe under the header; on the shortest phones (Galaxy S8+, 740px) the 8th Favourites card needs a small scroll — accepted tradeoff, not a bug. Favourites cards themselves are unchanged.
- **Merged customer header:** once selected, the customer **name becomes the page title** (~16px), `code · area` below, single "New order" button (refresh icon + text, `text-brand-700` — a TEXT ACTION, §59.9; `po-page.tsx:2342`) top-right. The "Purchase Order" banner + gray customer block + "Change" button are gone (New order = full reset).
- **Bill + Multi:** one row — left `Bill {n}` + "+ Add bill" (collapses to "+" at 2+ bills); right "Multi" + switch.
- **Floating CTA pill** (`footerPill`): `bg-brand-600 active:bg-brand-700`, rounded-full, padding ~`15px 34px`, white 15px bold, shadow `0 8px 22px rgba(124,58,237,0.42)` (`po-page.tsx:2098-2102`); disabled `bg-gray-200 text-gray-400`, no shadow; safe-area inset `max(env(safe-area-inset-bottom),16px)`. Renders "Review order" / "Send order" / "Set quantities (N)" / "Add N products" by state. **All floating footers gate on `keyboardOpen`** (real keyboard), never `inputFocused`.
- **Selected bill chip:** a SELECTION pill (§59.9) — `bg-ink-25 border border-data-slate text-ink-900 font-semibold` + a 19px outline `×` in `text-ink-500`, no fill (`po-page.tsx:3109`, `:3118`). Inactive chips plain `text-gray-500` (no ×). × only renders at 2+ bills (last bill never shows one).
- **Bottom sheets** (Cross depot, Delete-bill confirm, Call SO/Dealer) share one pattern: `fixed inset-0 flex items-end`, `bg-black/40` backdrop, `max-w-[480px] bg-white rounded-t-[18px] p-5`, safe-area `paddingBottom`. The **Call sheet is a 1:1 clone of the Cross-depot sheet** (SO / Dealer buttons + × close).
- **Delete-bill confirm:** title "Delete Bill {n}?", body "{count} product(s)…", `[Cancel]` (`bg-gray-100 text-gray-700`) + `[Delete]` (`bg-red-600 text-white`). Empty bill → instant delete, no sheet.
- **Duplicate control:** quiet grey button in the review per-bill card header beside Edit (`<Copy 15px> Duplicate`, `text-[14px] text-gray-500`).
- **Dispatch pills** order **Normal · Urgent · Call** (Call last, red dot); label "Call" → "Call · SO" / "Call · Dealer" once a target is chosen.
- **Dispatch slot** section (date Today/Tomorrow/Pick + window 9–12/12–3/3–6) — **deferred/planned**, mockup only (`docs/mockups/dispatch-slot/`); not built.

### Mobile viewport, keyboard + input patterns [LIVE]

*Moved here from §47 on 2026-07-27 when `/order` retired. These were never
`/order`-specific — every one is live in `app/po/po-page.tsx` today, and the viewport
export is app-wide. Verified against the code at the time of the move.*

**Visual Viewport keyboard fix (Android Chrome).** `<main>` carries
`style={{ height: "var(--vvh, 100vh)" }}` + `overflow-y-auto`. A mount-effect listens to
`window.visualViewport` `resize`/`scroll` and writes the visible height into `--vvh` via
`documentElement.style.setProperty` — **never React state**, which would cause a render
storm. Live in `app/po/po-page.tsx` — the writer is the `setProperty("--vvh", …)` call in the
visualViewport mount-effect; the consumer is `<main>`'s `style={{ height: "var(--vvh, 100vh)" }}`
(symbols verified 2026-08-05; line numbers dropped per §62.1's rule — they had already rotted); the SSR fallback
`html { --vvh: 100vh }` is in `app/globals.css`. Full `/po` scroll-architecture rules
(the single `flex-1 min-h-0` scroll area, the `keyboardOpen` gate, the resize+scroll
double listener) are in `CLAUDE_PLACE_ORDER.md §25` — not restated here.

**`useKeyboardOpen()` — the `keyboardOpen` gate as a shared hook** (`lib/hooks/use-keyboard-open.ts`).
The same mechanism extracted: the tallest `visualViewport` height seen is "no keyboard", a drop
of more than 120px counts as open, debounced ~100ms, listening to both `resize` and `scroll`;
returns false without `visualViewport` and during SSR. It reads height only and never writes
`--vvh`. Consumers: `components/mrn/line-sheet.tsx`, `app/po2/product-drawer.tsx`,
`app/po2/v2-sheet.tsx`. `/po` keeps its own inline copy, fused with its `--vvh` writer
(`po-page.tsx` `keyboardOpen` state). **A new mobile footer imports the hook — never a
third derivation.**

**`app/layout.tsx` viewport export — app-wide, not per-page:**

```ts
export const viewport: Viewport = {
  themeColor: "#7C3AED",
  viewportFit: "cover",
  width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false,
  interactiveWidget: "resizes-content",
};
```

`interactiveWidget: "resizes-content"` tells Chromium 108+ to **shrink** the layout
viewport when the soft keyboard opens rather than overlay it — that is what pairs with
`--vvh`. iOS Safari already shrinks `visualViewport` natively. ⚠️ `themeColor` and
`viewportFit` were missing from this block until 2026-07-27; the code has always had them.

**Empty-state row.** Render gate is `inMultiSel && searchQuery.trim().length >= 2`. A
zero-match query shows an italic `"No products match {query}"` row rather than nothing
(the literal string is the anchor in `po-page.tsx` — de-lined 2026-08-05).

**Input + tap patterns:**
- Qty input `text-[16px]` — iOS auto-zoom prevention (§ the general rule at §12).
- Qty input gets `border-b border-dashed border-gray-300` while its value is 0.
- Single-pack products render `py-[18px]` + `text-[16px]` label (vs the default
  `py-[10px]` + `text-[14px]`).
- Mount / mode-transition auto-focus is **desktop-only**, gated on
  `window.matchMedia("(min-width: 768px)").matches` (three gate sites in `po-page.tsx` — grep that
  exact expression; de-lined 2026-08-05) — focusing an input on a phone would spring the keyboard
  over the content.

### Favourites — replaces Recents on Home [LIVE, 2026-07-14]

- Home "Recent" section replaced by "Favourites" — section label the word "Favourites" + a small
  gold star (lucide `Star`, filled, `amber-500`, no background box — reused from the Mail Orders
  star, `review-view.tsx` StarGlyph). Listed **one column, sorted A-Z** by name.
- **Star toggle sits in the customer BUILD header** (right of the name row, `items-center` against
  the two-line name+meta block; glyph nudged ~3px right to correct its optical inset from the
  5-point star's shape vs its bounding box). Present the whole time an order is being built for that
  customer — persists across build/search/quantities. Filled gold = favourite, outline grey = not;
  tap toggles.
- **Cap 8.** A 9th add is BLOCKED, not silently evicted — calm amber "Favourites full (8 of 8) —
  remove one first" message near the header, auto-dismiss.
- Favourites card: neutral grey **rounded-square initials avatar** (not a circle — businesses, not
  people; not brand), name + `code · area`, chevron. Customer name `15px / 500 / #1d2939`.
- Empty state: soft icon + "No favourites yet" + prompt.

### Visual polish pass — palette discipline [LIVE, 2026-07-14]

Overall direction: soft and light (Things / Apple Notes feel), not bold or hard.
- **Brand = actions only** — the commit pill, text actions (`brand-700`), the active tab. NOT
  used for avatars/chips/decoration (was diluting the brand colour). The favourite star is
  amber, not brand. The full mobile budget is §59.9.
- Primary text `#1d2939` (softened from pure black `#111827`). Greys `#667085` / `#98a2b3` /
  `#d0d5dd` for everything secondary.
- Cards: soft two-layer low-opacity shadow, no hard border, radius 14, roomier padding, subtle
  pressed state on tap.

### Review & send — back affordance [LIVE, 2026-07-14]

Soft-grey rounded back arrow + "Review & send" label (left) · "Back to products" `text-brand-700` hint (right; `po-page.tsx:2802`)
on the Review section row. Pure restyle of the existing back control — funnels through the same
`history.back()` → popstate → close-review flow as before (§25-safe, no new nav path).

### Launch — full feature set live [LIVE, 2026-07-14]

The feature set built behind the `?draft=on` gate this cycle is now live to all users on plain
`/po` (gate removed — see `CLAUDE_PLACE_ORDER.md §25`). Installed PWAs ("Add to Home Screen" strips
query params) now show the full set automatically without a reinstall.

---

## 56. Reports hub + print (`/reports`)

**Reports hub (Option C):** left rail (TINT group → Tint Summary + TI Report) · large live preview · top bar (date control + **Generate PDF**, an `ink-900` utility button — `components/reports/reports-top-bar.tsx:49`) + Customise right-drawer. Generate opens `/reports/tint-summary?…&print=1` (auto-print); print route honours `hide` + filters so the PDF matches the preview. **Customise drawer:** 10 section toggles (`bg-brand-600` ON, `customise-drawer.tsx:24`), operator chips, Show Hold toggle, SMU chips, Area chips (dot colours), 7/14/30 trend; Done button = `bg-gray-900` (modal CTA rule). URL params (only non-defaults written): `r, date, hide(csv), operators, includeHold, smu, area, trendDays`.

**Print document (`tint-summary-document.tsx`):** 4-page A4 portrait, today-only, litres. Inter via `next/font`.
- **Brand blue `#1c3f93` accent — the one-brand-element rule does NOT apply to this print document** (a per-document exemption, like Sampling Library §22).
- **Progress-bar boards** (SMU / Area): grey track `#d1d5db` (width = litres/maxLitres), green fill `#16a34a` (width = completedCount/count), category dot, "N done" green `#15803d` (grey if 0). Count = full workload (open + completed).
- **Category dot colours** — Area: Local `#2563eb`, Upcountry `#ea580c`, IGT `#0d9488` (`data.teal`, the IGT identity — `report-params.ts:35`), Cross `#e11d48`. SMU: Decorative Projects `#4f46e5`, Retail Offtake `#0891b2`, other → slate `#64748b` (`tint-summary-document.tsx:331-336`). ⚠ The `data.pink` comment in `tailwind.config.ts` says Decorative Projects "moves off #4F46E5"; this document has not moved — the comment is ahead of the code.
- **Print CSS:** `@page tint-report` (A4) rules **top-level in `globals.css`** (never nested in `@media print`); `visibility:hidden` isolation via `#tint-report-print-area`; `print-color-adjust: exact` so colours survive the PDF.

---

## 57. Settings › Hide (admin)

New admin area under a **Settings** section in `components/admin/admin-sidebar.tsx` (EyeOff icon). One "Hide" nav home with **three flat tabs** (`hide-settings-content.tsx`):

- **Rules** — list + "Add Rule" modal (HOLD, or older-than-N-days); toggle / edit / delete.
- **Hidden Orders** — every hidden order with *why*; manual hides get an **Un-hide** button; rule-hidden rows show **"Managed by rule"** (no per-order un-hide in v1).
- **Tags** — one row per tag, each with a **"Who sees it"** select (`abd495f4`, 2026-09-11). Four modes (`type TagMode`, `hide-settings-content.tsx:113`; labels `:115-120`): **Everyone** · **Nobody** · **Everyone except…** · **Only…**. The two exception modes carry **chips** under the select — each tagged ROLE or PERSON, `bg-brand-50 text-brand-800 border-brand-200` with an × — added through a `+ Exception` button that opens an audience picker of roles and people. A plain sentence under the row restates the choice ("Everyone sees it, except …", `audienceSentence`, `:174`). Important tags carry an amber `Important` chip and ask `window.confirm` whenever the choice hides the badge from anyone (`hidesFromSomeone`, `:190`; confirm at `:250-252`); dropping back to Everyone/Nobody with exceptions set asks too (`:376`). The picker's people and roles come from **`GET /api/admin/tag-audience`** (`:216`). What a tag suppresses, how the three audience rows resolve, and the write route → `CLAUDE_MAIL_ORDERS.md §21` (schema: `CLAUDE_CORE.md §7.10`).

**Manual hide:** admin-only (`canHideObd`, `tint-manager-content.tsx:101-104`). A **"Hide an OBD…"** select in the Tint Manager rail's "Pending bill actions" strip, below the list (`tint-manager-content.tsx:1025-1047`), opens `HideObdModal.tsx` → reason required; the order drops off all boards and appears in Hidden Orders. There is no row menu — the flat table has none. The routes are live: `app/api/admin/hide/rules`, `rules/[id]`, `hidden-orders`, `orders/[id]/hide`, `orders/[id]/unhide`. Default state (no rules, nothing hidden, every tag Everyone) = app looks exactly as before.

---

## 58. Support board — RETIRED 2026-07-27

The Support board no longer exists; its visual spec (column order, ship-to override cell, stacked
VOL cell, Hold tab) is archived verbatim at `archive/2026-07-support/docs/CLAUDE_SUPPORT.md`.
The reusable lesson it carried — content-blind **percentage** `grid-template-columns` for
Grid-native tables — is owned by **§27**, which remains the live rule. Floor Control's own surfaces
are specified in `CLAUDE_FLOOR.md`; do not resurrect this section's prose there.

---

## 59. Mobile app shell — provider + slotted bottom bar [LIVE]

The mobile shell is **three separable pieces**, not one welded block (rebuilt 2026-07-19, Direction A, commits `5eb0fd7e` → `6bdaff19`). Entirely scoped `block md:hidden` — mobile only; the desktop sidebar (§7) stays `hidden md:flex`, completely untouched by any of this.

### 59.1 `MobileShellProvider` — the sheets [LIVE]

`components/shared/mobile-shell-context.tsx`. Owns the **Menu sheet, You sheet, sign-out confirm, and scrim**, plus their state (`sheet` / `confirmOpen` / `filter`). Mounted **once**, in `role-layout-client.tsx`, wrapping the whole role-shelled subtree.

- **Menu sheet** — `z-[60]`, `rounded-t-[22px]`, slides via `translate-y-full`→`translate-y-0`. Lists every page the user can view + a "Find a page…" filter (`text-[16px]`, iOS zoom guard). Active row `bg-ink-25 text-ink-900 font-semibold border-l-brand-600`, icon `text-ink-900` — the brand-600 left bar is the only violet (NAV bucket, §59.9; `mobile-shell-context.tsx:157-161`). Reuses the **exact same** `ICON_MAP` / `DEFAULT_ICON` (keyed by `pageKey`, exported from `role-sidebar.tsx`) as the desktop sidebar (§7) — icons always match between the two.
- **You sheet** — same `z-[60]` shape, top to bottom:
  - identity row: 46px avatar `border-ink-100 bg-ink-50 text-ink-600` (an identity avatar, §10.1; `mobile-shell-context.tsx:185`) + userName (16px bold) + role label (`formatRoleLabel`);
  - **Notifications** — `<PushToggle />` (`:196`), the per-device push switch (46×26, `bg-brand-600` when on — `components/push/push-toggle.tsx:156`). Behaviour → `CLAUDE_NOTIFICATIONS.md §3`. ⚠ Open question, not a ruling: §59.9 buckets switches as SELECTION (`data.slate`); this one is still brand;
  - **Sign out** — `text-ink-500 hover:text-ink-700` with a `LogOut` icon (`:200`). **Not red**: it is not destructive, and the confirm dialog (`z-[70]`) → `signOut({ callbackUrl: "/login" })` is where the decision is made.
- **Scrim** — `z-50`, closes whatever is open. One sheet open at a time.

**The point of the lift:** `useMobileShell()` exposes `openMenu()` / `openYou()` / `closeAll()` **to any descendant**, so a module's own header can open the same sheet instances without re-mounting a second copy of the markup. The context also carries read-only `role` / `userName` / `userInitials` so a module-native header can render the signed-in avatar with no new prop-drilling.

### 59.2 The three-way bottom-bar SLOT [LIVE]

`components/shared/mobile-shell.tsx` is now **only the bottom bar**. It renders exactly one of three things, checked in this order:

| # | Branch | Trigger | Renders |
|---|---|---|---|
| 1 | **Hidden** | `hideBar` prop is true | nothing — no bar at all |
| 2 | **Module tabs** | `workflowTabs` supplied AND non-empty | that module's `<WorkflowTabBar>` |
| 3 | **Default** | neither of the above | the standard **Home · Menu · You** `<nav>` |

Branch 3 is unchanged from the original shell: **Home** → `navItems[0]?.href ?? "/"` (active when `pathname === that href`: `text-ink-900` label + a 3px `bg-brand-600` underline, inactive `text-gray-400` — `mobile-shell.tsx:88`, `:99`), **Menu** → `openMenu()`, **You** → `openYou()`.

**Threading:** all four props (`workflowTabs`, `activeTabKey`, `onTabChange`, `hideBar`) are optional pass-throughs on `<RoleLayoutClient>` — the same shape `navItems` already uses. Undefined on every call site that hasn't opted in, so **every existing page is pixel-identical by construction**.

**⚠️ LANDMINE — `workflowTabs={[]}` does NOT hide the bar.** An empty array is falsy in the `hasWorkflowTabs` check, so it falls through to the **default Home/Menu/You bar**, not to nothing. Hiding requires the explicit `hideBar` prop, which is deliberately a separate named prop checked *before* `hasWorkflowTabs`. Reusing the empty array for "hidden" would silently break the fallback semantic.

### 59.3 `WorkflowTabBar` — the reusable per-module primitive [LIVE]

`components/shared/workflow-tab-bar.tsx`. Generic and module-agnostic: `tabs: {key, label, count?, icon}[]` + `activeKey` + `onChange`.

- Icon-on-top layout, count badge top-right of the icon, `bg-brand-600` underline pill (`h-[3px] w-8`) on the active tab (`workflow-tab-bar.tsx:77`).
- **Count badge hides at 0** — a "0" badge is noise, not information. `>99` renders `99+`.
- **No badge is violet (§59.9, 2026-09-17):** active tab = `ink-900` icon, label and badge + the `brand-600` underline; inactive badge `ink-500`. (Was: the active badge brand, label brand-700.)

**⚠️ LANDMINE — its height is copied from the default nav ON PURPOSE.** It reuses the default `<nav>`'s exact classes (`fixed bottom-0 … z-40`, `flex-1 flex flex-col items-center gap-1 py-2 text-[11px] font-semibold`, `h-6 w-6` icon, bare `env(safe-area-inset-bottom)`) so the two bars are the same height **by construction**. An earlier `min-h-[58px]` guess was removed — **do not reintroduce a fixed height number**; it drifts out of sync with the real content and invalidates `MOBILE_NAV_CLEARANCE`.

### 59.4 How a future module plugs in [LIVE — sanctioned extension point]

Every future module (**Tint Operator, Trip Report** — this list named Support and Warehouse until 2026-08-04; both were retired 2026-07-27/28 before ever adopting it) now has a supported way to mount its own bottom tabs. **Do not rebuild the shell** — the frame, both sheets, and the wiring already exist. A module supplies only its own tabs and its own page contents:

1. Supply `workflowTabs` + `activeTabKey` + `onTabChange` through `<RoleLayoutClient>`.
2. For a Direction-A header, call `openMenu()` / `openYou()` from `useMobileShell()` on the header's grid icon / avatar.
3. Pass `hideBar` when a full-screen sub-view (e.g. a detail screen) should own the whole viewport.

**Three consumers pass `workflowTabs` today** (grep of `workflowTabs=`, 2026-09-19): Picking (`components/picking/picking-mobile-shell.tsx`), CI (`components/ci/ci-shell.tsx`) and MRN (`components/mrn/mrn-shell.tsx`). **Picking was the first** — its `SupervisorPickingShell` is the reference implementation and the pattern to copy: tab state and the queue fetch that drives the live counts are **owned one level above the board** (they must reach `RoleLayoutClient`, which renders above the board in the tree), and are handed back down to the page via the module's own context. One fetch, so the cards and the tab counts can never drift. Picking's screen-level detail is `CLAUDE_PICKING.md §5` — not repeated here.

**⚠️ Label and key — CORRECTED 2026-07-30.** This warning used to read *"Picking's third tab reads **"Done"** but its key stays `"checked"`."* **That is false.** The live union is `"assign" | "picking" | "done"` (`components/picking/picking-mobile-shell.tsx`) — label == key on all three.

The real rule is the one the correction demonstrates: **a relabel and a re-key are separate decisions, and each has to be made on purpose.** On 2026-07-19 Picking relabelled its third tab "Checked"→"Done" and deliberately did NOT touch the key — correct, because a visible label is not a state identifier. On 2026-07-20 the board re-cut moved label AND key **together**, because by then the old keys had *inverted against their labels*: `"check"` would have held `pick_assigned` (nothing is checked there) while `"checked"` held the actual needs-check work. **A key that lies is worse than a key that is merely ugly.** Two things made that second move safe, and both must be checked before re-keying anything: the keys are a TypeScript union, so `tsc` flagged every stale comparison; and nothing persists them (plain `useState` — no localStorage, no URL param, and `WorkflowTab.key` is a bare `string`), so there was no stored value to migrate. Tab semantics are `CLAUDE_PICKING.md §5.1`-§5.2's, not this file's.

⚠ **This warning sat wrong HERE for ten days while `CLAUDE_PICKING.md §5.1` had it right the whole time.** The 2026-07-20 correction was written into the module file and never into the shell file, and nothing forced a re-read of the copy. **A stale claim is rarely in only one file** — when you correct one, grep the rest for the same sentence. This file was the copy nobody checked.

### 59.5 Per-ROLE tabs vs per-MODULE tabs — the distinction that matters

These are different ideas and only one was rejected. Read both lines before proposing either:

- **Per-ROLE bottom tabs — still REJECTED.** The bottom anchors must not change identity depending on who signed in. Variable pages live behind **Menu**, not as their own tabs. This was rejected in the original design and that decision stands.
- **Per-MODULE workflow tabs — SANCTIONED, and LIVE.** A module may replace the bottom bar with its own **workflow-stage** tabs (Picking's supervisor board: Assign · Picking · Done) for the duration of that module's screens. Opt-in per page; the default for every page that says nothing stays Home/Menu/You. *(This line said "Assign · Check · Done" until 2026-07-30 — the same 2026-07-20 rename, and the same ten-day miss, as §59.4's corrected warning above.)*

The difference is what the tabs *are*: a role is an identity (the bar must not fork per user), a workflow stage is a step in the task the user is currently doing (the bar is the right place for it — the thumb zone). **Menu/You are not lost** when a module takes the bar; they demote to the module's own header, because module-switching is the less frequent action.

**Design history:** rejected per-role bottom tabs → rejected drawer-only → fixed Home/Menu/You anchors → **(2026-07-19)** kept those as the default, added the per-module slot beside them. Direction A (module-native bottom bar) was chosen over Direction B (split bar) and Direction C (floating FAB).

### 59.6 Mounting, clearance, and mechanics

**One global insertion point:** `components/shared/role-layout-client.tsx` mounts `<MobileShellProvider>` around `<RoleSidebar>` + `<MobileShell>` + the page content. Every page that wraps itself in it inherits the shell with no per-page work. **Mounted by 12 app files** (import sweep 2026-09-19): `app/(floor)/floor/layout.tsx`, `app/(import)/import/layout.tsx`, `app/(mail-orders)/mail-orders/layout.tsx`, `app/(operations)/operations/layout.tsx`, `app/(ops)/layout.tsx`, `app/(place-order)/layout.tsx`, the three `app/(tint)/tint/{manager,operator,sampling-library}/layout.tsx`, `app/ci/page.tsx`, `app/mrn/page.tsx`, `app/trips/page.tsx` — plus `/picking` through `components/picking/picking-mobile-shell.tsx`. Those that pass no `workflowTabs` take the default Home/Menu/You bar (branch 3); Picking, CI and MRN supply their own tabs (branch 2, §59.4). Inheriting the shell and replacing the bar are different things — this list means the former.

- The page content wrapper carries `pb-[76px] md:pb-0` so mobile content clears the fixed bar; no effect on desktop.
- **Pages that don't route through `role-layout-client.tsx` don't inherit the shell.** Attendance has its own full-screen wrapper with no sidebar (`app/attendance/layout.tsx`, `CLAUDE_ATTENDANCE.md §13`) and is unaffected.
- **`/po` is NOT a consumer of this shell** — it builds its own Home/Drafts/Sent bar inline in `po-page.tsx`. Shell changes never touch `/po`; do not add "protect /po" guards, it is not on the circuit.

**`MOBILE_NAV_CLEARANCE`** (exported from `mobile-shell.tsx`) = `calc(76px + env(safe-area-inset-bottom, 0px))`. Single source of truth for "how much room the fixed bar needs" — every bottom-pinned sheet or CTA must reserve at least this much. It is an **empirical** figure, not computed from the nav's classes: if that JSX's sizing changes, update the constant by hand. It was hand-copied as a bare `76px` literal three times before centralization, each time producing a render-behind-the-nav bug — **import it, never retype the number**.

**Mechanics landmines — cross-ref §55, do not re-derive:**
- **Floating footers gate on `keyboardOpen` (measured Visual Viewport height drop), never `inputFocused`.** Android can dismiss the keyboard without blurring the input, so a footer gated on focus stays stuck hidden. §55.
- **Safe-area floors:** §55's convention for page-level footers and sheets is `max(env(safe-area-inset-…), Npx)` — **never a bare `env()`**. Both bars in this section (default nav and `WorkflowTabBar`) deliberately use a **bare** `env(safe-area-inset-bottom)` with no floor — they match each other by construction (59.3), which is the stronger constraint here. Known, intentional divergence: do not "fix" one bar to the §55 floor without the other, and do not use the bars as the precedent for new page-level footers.
- **Dual shadow tokens:** `SOFT_CARD_SHADOW` and `ENRICHED_ROW_SHADOW` read almost identically but are pixel-matched to two different approved mocks (plain cards vs. enriched rows). **Do not merge them.** §55.

**Reference mobile user:** Praveen (`logistics` role, primary landing → Trip Report — `CLAUDE_TRIP_REPORT.md §1`).

**Approved mockups:** `docs/mockups/mobile/index.html` (v3 — the default Home/Menu/You shell; its grey role-switcher is a demo aid, not shipped) and `docs/mockups/picking/mobile-shell-v1.html` (the approved Direction-A shell, 6 states).

**[DEFERRED]**
- **~~Shared minimal header — extraction~~ — DONE 2026-07-29, see §59.7.** Realized as Picking's Direction-A header, then extracted verbatim to `components/shared/module-mobile-header.tsx` (`a2fb6889`) when the picker face needed the same one. **The other half of this item survives and is still true:** every page outside Picking keeps its own header, which is why `/trips` still looks right and was never disturbed. Adopting the shared one elsewhere is opt-in, module by module — candidates in §59.7. The "big search" half was never built and is not part of §59.7.
- Shell rollout/polish across the other role pages.
- PWA install (add-to-home-screen). Manifest + icons + root-layout metadata already exist (`public/manifest.json`, `app/layout.tsx` metadata + `appleWebApp` + viewport). **A service worker exists and is live:** `public/sw.js` (push + notificationclick only — no fetch handler, no cache), registered by `components/push/push-toggle.tsx:67` (`7f041c95`, 2026-07-22) → `CLAUDE_NOTIFICATIONS.md §5`. An install prompt is what is not built. Do NOT reintroduce a middleware-level redirect toward `/attendance` (the retired attendance auto-check-in gate — see `CLAUDE_TRIP_REPORT.md §7`) when building this.

### 59.7 `ModuleMobileHeader` — the shared Direction-A header [LIVE, 2026-07-29]

`components/shared/module-mobile-header.tsx`. The fourth shared piece, alongside the provider (§59.1), the bar slot (§59.2) and `WorkflowTabBar` (§59.3). Extracted **verbatim** from `picking-board-mobile.tsx` (`a2fb6889`), then **restyled 2026-09-09** — the one-commit-against-every-consumer change its own note asked for. See §59.8 for the treatment.

**Layout:** avatar (left) · title (centre) · grid + optional search (right). `flex-shrink-0`, on the pale masthead ground (§59.8), no longer a filled band. It does **not** position itself: the root is intended as a sibling of a `flex-1` scroll area inside a `fixed inset-0 flex flex-col` screen root, so the consumer keeps ownership of the surrounding frame.

| Prop | | Notes |
|---|---|---|
| `title` | `string` | The 19px extrabold centre label |
| `subtitle?` | `string` | Additive, default-off (`module-mobile-header.tsx:53`, `1ad903ef`). Undefined → the bare `<h1>` exactly as before; set → title + an `ink-500` 11.5px truncated line beneath (`:101-106`). Its one caller is the picker's My Picks header, for the Combined tab (`picker-my-picks-board.tsx:1259`) |
| `avatarInitials` | `string` | Rendered in the left circle |
| `onAvatarClick` | `() => void` | Required |
| `onMenuClick` | `() => void` | Required — the grid icon |
| `showSearch?` | `boolean` (default `true`) | When false the icon is omitted and **no gap is left behind**: it is the second child of a `gap-0.5` row, and a one-child flex row renders no gap, so the header stays balanced with no placeholder and no width change on the grid button |
| `searchActive?` | `boolean` | ⚠ **Accepted, but drives NO styling** — see below |
| `onSearchToggle?` | `() => void` | |

**⚠️ THE DESIGN RULE — handlers stay with the CALLER.** The header deliberately does **not** call `useMobileShell()` itself. Picking wires `onAvatarClick`→`openYou` and `onMenuClick`→`openMenu`, but that is Picking's choice, passed in. A future module can point the avatar and the grid at something else entirely without forking the component. Nothing module-specific is imported inside it, and nothing should be.

**⚠️ `searchActive` is inert — declared, never destructured, never read.** This is not an oversight and not a bug: the inline original rendered an identical search button in both states, and the extraction was pixel-for-pixel. Wiring an active-state look during that refactor would have smuggled a visual change into a commit whose entire claim was that nothing changed. It is a **one-className job** whenever the active treatment is actually designed — do it then, in its own commit, not as a side effect. A caller may pass its real state today; it just has no effect.

**Consumers today: SEVEN, across three routes** (recounted 2026-09-09 — this line said "both Picking faces, and nothing else", which had gone stale). `/picking`: `app/picking/page.tsx`, `picking-board-mobile.tsx` (supervisor, `showSearch` default true + `searchActive`/`onSearchToggle` wired to its own filter row) and `picker-my-picks-board.tsx` (picker, `showSearch={false}` — that face has no search). `/ci`: `ci/new-return.tsx`, `ci/submitted-board.tsx`. `/mrn`: `mrn/supervisor-board.tsx`, `mrn/line-sheet.tsx`. Behaviour and per-face detail: `CLAUDE_PICKING.md §5.3`-§5.4.

**Future adopters — a swap, not a rebuild.** **Tint Operator mobile** and **Trip Report mobile** are the two named candidates (§59.4's "how a future module plugs in"); both already have a hand-rolled header, so adopting is replacing markup, not designing anything. Explicitly **NOT `/po`** — it builds its own Home/Drafts/Sent bar and header inline and is deliberately off this circuit (§59.6); do not add "protect /po" guards. Explicitly **NOT `/floor`** — desktop-first, with no mobile-shell usage at all (`CLAUDE_FLOOR.md` mentions none of this machinery, verified 2026-07-30).

---

### 59.8 The pale masthead — the mobile header standard [2026-09-09]

**Every mobile header in the product is a pale `#F5F3FF` masthead. Filled brand-600
bands are gone.** The reference implementation is `app/po2/`, and the reasoning
is its own: a solid `#7C3AED` band was the largest, brightest block of violet in the
product, on the smallest screens, for a header that carries no decision.

| | |
|---|---|
| Ground | `#F5F3FF`, flat, no gradient. `brand-50` is the same hex — see the collision note below |
| Wordmark / title | `brand-600` `#7C3AED` |
| Bottom rule | 1px `ink-100` `#E9E7F0` |
| Avatar | **white** fill, `ink-600` initials, 1px `ink-100` border |
| Icon controls | `ink-600`, pressed `ink-100` |
| Subtitle | `ink-500` |
| Bottom nav | active `brand-700` `#6D28D9`, inactive `ink-400` `#9C99AC` |

Applied to `app/po/po-page.tsx` and to `ModuleMobileHeader` (§59.7), which covers all
seven of its consumers at once.

🔴 **The wordmark is `brand.600`, NOT the colour spec's `brand.800`, and that is a
RULING not a drift.** `docs/prompts/archive/2026-09/web-update-2026-09-06-orbit-colour-spec-v2.md`
line 42 assigns `#5B21B6` to "wordmark on white". On a white or near-white working screen
at header size that reads as a bruise; `#7C3AED` stays a brand colour. v2 diverged first
and was right. **The spec line is wrong and is superseded by this section — do not
"correct" the code back to it.**

🔴 **The avatar is WHITE here, and only here.** Everywhere else an identity avatar is
`ink-50` (§10.1). `ink-50` is `#F4F3F8` and this ground is `#F5F3FF`: seven units apart
in blue and identical in red and green, so on this one surface it measures **1.01:1** and
is a fill that is not a fill. White is 1.10:1 and reads as an object sitting ON the wash,
which is exactly why v2's search bar is white on the same ground.

🔴 **CHANGING THIS GROUND CHANGES THE STATUS BAR, AND THAT IS THE PART THAT BITES.**
`app/layout.tsx` sets `statusBarStyle: "black-translucent"` app-wide, which draws the page
under the status bar and paints the clock and battery **white** — correct over a violet
band, invisible over this wash. Every route rendering a pale masthead therefore carries
its own override, matching what `/po` and `/po-v2` already did:

```ts
export const metadata: Metadata = { appleWebApp: { capable: true, title: "Orbit", statusBarStyle: "default" } };
export const viewport: Viewport = { themeColor: "#F5F3FF" };
```

Live on `/picking`, `/ci`, `/mrn` and `/po`. **A new consumer of `ModuleMobileHeader` needs
one too** — without it the symptom is "the clock disappeared", which nobody connects to a
colour change. `themeColor` must be on the **viewport** export; in Next 14
`metadata.themeColor` is ignored with a warning. Next shallow-merges viewport per field,
so only `themeColor` is overridden and the layout's `viewportFit` and scale settings are
inherited. Android picks dark status icons from `#F5F3FF`'s luminance on its own.
`public/po.webmanifest`'s `theme_color` moved with it; its `background_color` stays
`#7C3AED` because that is the launch splash, which is still violet.

**Detail and sub-screen headers take the same ground** (added 2026-09-09, second pass —
the first pass reached the list screens through `ModuleMobileHeader` and missed every
screen with a hand-rolled header, so one flow carried two different headers). Same
geometry as before, recoloured:

| | |
|---|---|
| Ground | `#F5F3FF` + 1px `ink-100` bottom rule |
| Title | `brand-600`, size and weight unchanged |
| Second line | `ink-500` |
| Back button | white fill, `ink-600` chevron, 1px `ink-100` border — the avatar's treatment, for the avatar's reason |
| White action chips | gain a 1px `ink-100` border; a white chip on this wash is 1.10:1 |

Live on: the Picking bill detail, the My Picks bill detail, CI new-return, CI submitted
detail, the MRN detail, and both Trip Report mobile headers. `/trips` gained the
status-bar override with them.

🔴 **The DUPLICATE-SO branch is not a brand surface and keeps its red.** Both picking
detail headers swap the whole band to `DUP_SO_FILL` `#dc2626` when `hasDuplicateSo`, and
everything inside — title, back button, subtitle — flips back to white for it. That
branch was already conditional and stays conditional; the pale ground is the ELSE arm,
never a replacement for the warning.

⚠ **`brand-50` IS `#F5F3FF` — the same hex as this ground.** Any brand-50 surface on a
screen that has a masthead becomes a second identical wash and reads as a second header.
Picking's three filter summary strips hit exactly this and moved to `ink-50` on
2026-09-09. Check for it before painting anything `brand-50` on a mobile screen.

### 59.9 One violet per mobile screen — the buckets [2026-09-17]

The one-brand-element rule was written for desktop and had never reached the phone, where
violet had become the title, every selection ring, every tick, the active tab, the count
badges AND the commit button. The rule exists so the commit is findable. **A mobile
screen's violet budget is: its title, plus one commit.** The title is a NAMED brand element
(§59.8's ruling — module and detail titles, and the `/po` and Trip Report wordmarks, stay
`brand-600`), so it is never counted as a violation.

| Bucket | What | Colour |
|---|---|---|
| **COMMIT** | the action that finishes the task — one per screen | `brand-600` fill, hover/pressed `brand-700` |
| **TITLE** | masthead title / wordmark (§59.8) | `brand-600` text |
| **SELECTION** | chosen state: card ring, check badge, chosen chip/row/option, switches, checkboxes | **`data.slate` `#475569`** (`bg-data-slate` / `border-data-slate`), tint `ink-25`, label `ink-900` |
| **STATUS** | done, resolved, saved — incl. the supervisor's per-line "checked" tick | `ok` green |
| **COUNT** | badges and numbers | `ink-500`, `ink-900` when active |
| **NAV** | active tab / nav row | `ink-900` label and icon + `brand-600` underline (bars) or left bar (Menu sheet row) |
| **TEXT ACTION** | tappable text: Cancel, New order, Add another bill, Quick add, More, steppers, Plus | `brand-700` — never `brand-600` |
| **SURFACE** | the masthead ground (§59.8) | `#F5F3FF` |

Left violet on purpose: focus rings (`brand-500`/`brand-600`, colour spec §1), and `/po`'s mic
**listening** state and dots — the app doing something, which neither slate nor green means.
A **utility** button (Trip sheet) is `ink-900`, not brand. A **destructive trigger inside a
chip** (the × on `/po`'s active bill chip) is an outline glyph in `ink-500` with no fill.
The Picking selection bar is an **`ink-25` panel with an `ink-100` border**, not a black
pill; its Assign button is the commit and stays `brand-600`.

🔴 **`data.slate` IS NOW SPOKEN FOR.** It is the mobile SELECTION colour (on top of the admin
role colour and the unknown-category fallback it already carried in `tailwind.config.ts`).
Colour spec v2 §1 lists it as "free" — **it is not free any more; do not assign it to a
future data category.**

**Two named exceptions:**

1. **A sheet's commit takes over from the screen's commit.** While a bottom sheet or a
   confirm dialog is open (Release, Start unloading, finding Save, CI quantity Save, the
   sign-out and `/po` confirms), its button is the one commit; the screen's own commit is
   behind the scrim and does not count as a second.
2. **Read-only and list screens have NO commit — and none may be invented.** Every list tab
   (Picking / Done, My Picks Pending / Done, CI Submitted, MRN's three tabs, `/po` Home /
   Drafts / Sent), plus: Picking detail while the bill is **with the picker** or already
   checked, MRN detail while **checking**, and Trip Report list and detail.

⚠ **Standing question, not a ruling:** MRN's *End unloading* — the commit on the checking
detail — is `bg-green-600`, not brand. Left as it is (2026-09-17) pending a decision.

---

## 60. Mobile card type scale + 390px viewport (reusable standard)

Records the /po-derived type discipline so this is never re-discovered. **Reusable across any mobile card**, not Picking-only. Shipped 2026-07-21.

**App font (shared everywhere):** `Plus Jakarta Sans` via `--font-sans` (`app/layout.tsx`, next/font). Mono = `JetBrains Mono` via `--font-mono` (OBD numbers only). Cards and `/po` share this font — **there is no family difference; WEIGHT is the "heavy vs refined" lever, not the typeface.**

**The /po refinement principle:** exactly ONE line carries weight (the hero); everything else stays light (400–500). Making every line heavy (700 name + 600 area + 700 volume + 700 chips) is what read dense.

**Mobile card type tokens (as shipped):**

| Element | Size | Weight | Colour | Notes |
|---|---|---|---|---|
| Customer name (hero) | 16px | 600 | `#1d2939` | letter-spacing ~0 (NOT negative), line-height 1.25, `truncate` |
| Slot / time | 15px | 600 | `#475467` | keep `tabular-nums` |
| Area | 12px | 500 | `#667085` | |
| Volume count | 12px | 600 | `#667085` | `tabular-nums` |
| Volume "L" unit | 10.5px | 500 | `#98a2b3` | |
| Caption date | 11.5px | 400 | `#98a2b3` | middot `#d8dce1` |
| Caption OBD | 11.5px | 400 | `#98a0aa` | **mono** |
| Family chips | 10.5px | 600 | `#667085` on `#eef1f5` | |
| Route dot | 8px | — | Local `#2563eb` / Upcountry `#ea580c` / Cross `#e11d48` / else grey | colour only, no text |

**Hard rules (so discovery isn't needed again):**
- **Never CSS-uppercase customer names** — uppercase comes from SAP source data, not `text-transform` (would break `smartTitleCase`, §15).
- **Keep `tabular-nums`** on slot + volume (numbers align across stacked cards).
- **Weight, not colour, is the "heavy" dial.** If a card reads heavy, drop weights (700→600/500) and remove negative tracking before touching colour. Nothing on the card is 700; only the hero name is 600; chips/volume/area cap at 600.

**Viewport:** design + phone-verify target **390px** wide (iPhone reference); must stay **320px-safe** — hero name uses `truncate min-w-0`, slot + arrow are `shrink-0` and never clip. Tap targets **min 44–48px** for interactive controls.

---

## 61. Picking — desktop board — RETIRED 2026-07-28

The desktop `/picking` table no longer exists. `components/picking/picking-queue.tsx` was archived to
`archive/2026-07-picking-desktop/`; **`/picking` itself STAYS LIVE** and renders the mobile card
board (§62) at every screen width. Its story — why it went, what replaced it, what moved out first —
belongs to that folder's `README.md` *(exists — verified 2026-08-04; the discovery report
`docs/prompts/archive/2026-08/code-discovery-2026-07-28-picking-desktop-retirement.md` remains the dated
working record behind it)*.

**Why:** Floor Control (`/floor`) was built to replace it, the floor team works on Android phones
only, and a desk operator who needs a board uses `/floor`. Picking is also hidden from the desktop
sidebar now — the phone Menu sheet keeps it, and no permission changed.

**What was NOT desktop-only was moved out BEFORE this collapsed, and is still live** — do not look
for it here:

| Rule | Now owned by |
|---|---|
| Age tags `1d` / `{n}d`, from `row.ageDays`, + the §8 Tint pill-styling provenance | **§62.1** |
| Locked / Upcoming visual treatment | **§62.2** |
| Route as plain text, no route dot, and why (`RouteDot` keys on `deliveryType`) | **§62.3** |
| The rejected-feature list + its reason | **§62.4** |
| "Status pill is never brand" | **§1** |

What collapsed with the section was genuinely desktop-only: the 8-column
`4/3/19/27/14/7/9/17%` table layout, the four status-pill hex values, the List ⇄ By Route toggle
styling, the slot-band styling, the UniversalHeader filter-panel wiring note, and the
temporary-inline-Undo note. The archived file is the reference if any of it is ever wanted back.

Behaviour, tab semantics and date-zone scope were always `CLAUDE_PICKING.md`'s, not this file's.

---

## 62. Picking — mobile card visual states (tap-select · arrow-to-detail)

**Visual treatment only** — the interaction behaviour (what a tap does, variant gating) lives in `CLAUDE_PICKING.md`. Shipped 2026-07-21. Type scale is §60.

- **Selected (Assign card):** `ink-25` tint + `data.slate` border + a small **`data.slate` check badge, top-left corner**, only when selected (§59.9, 2026-09-17; `picking-board-mobile.tsx:677`, `:692`). Unselected = clean, no box, no placeholder.
- **Arrow-to-detail:** a **soft round arrow** to the right of the family chips — `~30px` circle, `bg #eceff3`, chevron `#8b93a0`. Pinned; families scroll to its left; **always rendered on Assign cards even with zero families** (detail is always reachable).
- **No brand on the card:** selection is `data.slate` (above); the arrow and family chips are slate. (Locked/Upcoming + the `1d`/`{n}d` age treatment are stated directly in §62.1-§62.2 below — they used to be a pointer at §61.)

### 62.1 Age tags — `1d` / `{n}d` [module-wide]

Moved here from §61 on 2026-07-28 (Picking desktop retirement, step 1). The rule was never
desktop-only: **both** mobile boards render this badge from the same field, through one shared
component — **`AgeBadge` in `components/picking/card-atoms.tsx`** (extracted 2026-07-29 when the
picker card gained the same signals). The days→colour scale lives inside that component and **nowhere
else**; never re-map days to colour at a call site.

*(This pointer named `picking-board-mobile.tsx:588-628` until 2026-07-30. Line numbers have rotted
twice on this section alone — name the file and the symbol, never the line.)*

**Age tags** next to the OBD for `ageDays >= 1`: **`1d`** amber, **`{n}d`** red (2+). Uses
`row.ageDays` from the payload — **not** recomputed from creation date (the §8 Tint age-badge
PILL STYLING is reused; its day math is not).

### 62.2 Locked / Upcoming treatment [module-wide]

Moved here from §61 on 2026-07-28, same reason: the mobile Assign board has its own locked zone —
the `assignLocked` card variant and its `UpcomingDayBadge`, both in
`components/picking/picking-board-mobile.tsx`. Supervisor-only, so unlike `AgeBadge` above these did
**not** move to `card-atoms.tsx`: the picker never sees a locked bill.

*(Line numbers dropped here too, 2026-07-30 — same reason as §62.1.)*

Rows muted, **lock glyph instead of checkbox**, `—` for `#`, and a `for {Day} {DD} {Mon} · {time}`
chip in the Status cell. ⚠ The **time** half of that chip is a desktop detail — the mobile
`UpcomingDayBadge` renders the day only. (Floor's Upcoming strip was deleted in `f41b52c9`;
Floor's future-dated rows now sit below an upcoming divider inside its table — `CLAUDE_FLOOR.md §2`.)

### 62.3 Route renders as plain text — no route dot

Moved here from §61 on 2026-07-28. This is a fact about the **payload** and about the **mobile**
`RouteDot`, so it survives the desktop board.

No route→colour data exists in the payload (`RouteDot` on mobile keys on `deliveryType`, not
route). Add a route-master colour later if wanted.

### 62.4 Rejected on the Picking module — do not reintroduce

Moved here from §61 on 2026-07-28. This is **decision history for the Picking module**, not for one
file, so it must outlive the desktop board.

Header "% ready for dispatch" bar · per-route progress roll-up · auto "Ready to load" status ·
header status-count stats. **Reason:** loading depends on vehicle/space, which the system does not
know.

⚠ **Scoped to PICKING deliberately — Floor is NOT bound by it, and on one item Floor went the other
way.** Floor Control ships a four-segment per-route progress roll-up
(`components/floor/progress-bar.tsx`, used by `route-row.tsx`, whose `RouteRow` is rendered by
`components/floor/trip-desk.tsx:36`) and sorts routes worst-first by completion (`ByRoute`,
`trip-desk.tsx:881-923`). Only the last item —
header status-count stats — matches Floor's own removal of the stats line (`CLAUDE_FLOOR.md §8`).
Do not read this list as an app-wide ban.

---

**Schema stamp — RESOLVED 2026-08-04: this file carries NO `Schema` stamp BY DESIGN.** It tracks
components, not tables — there is no schema for it to be in step with, so a stamp would only create
an obligation to bump a number this file never depends on. The decision is recorded in the header
AND here so no future inventory reads the absence as drift. `CLAUDE.md §4`'s check-against-CORE step
simply does not apply to this file. *(This replaces the ⚠ OPEN block that sat here 2026-07-30 →
2026-08-04.)*

---

## 63. Access — per-user page permissions (`/admin/access`)

Superuser-only. **The screen that decides what everybody can do** since 2026-09-04 (`CLAUDE_CORE.md §5`). Two panes inside one rounded, bordered container, 520px min height.

### Left rail — people (212px, `bg-[#fcfcfd]`)

- Search box at the top (name / email / job title), then every user, active first then by name.
- Each row: 26px circular avatar with initials, name at 12.5px semibold, job title at 10px `text-gray-400` beneath, `· +N` when they hold secondary roles, `· inactive` when they do not.
- Selected row: `border-l-2 border-brand-600 bg-brand-50`, avatar `bg-brand-600 text-white`, name `text-brand-700` (`components/admin/access-manager.tsx:292`, `:300`, `:309`). This filled avatar marks the SELECTED row, not a person's identity, so §10.1's pale-avatar rule does not govern it.
- **Inactive people are shown, muted to `opacity-55`** — never hidden. A deactivated person keeps their ticks so reactivating restores what they had, and a row you cannot see is a permission nobody can audit.
- **The amber dot** (`h-1.5 w-1.5 rounded-full bg-amber-500`, right-aligned) marks a person whose stored ticks differ from what their job title would grant. Above the list, a one-line count: *"N people differ from their role access"*.

### Right pane — the selected person

Header block: name at 16px bold, an `Inactive` chip when relevant, then a meta row — **Role**, **lands on `<route>` at login** (from `ROLE_REDIRECTS`, keyed on the PRIMARY role), and **N pages set differently from their role**. Beneath it one banner — `border-brand-100 bg-brand-50 text-brand-700` when the person matches their role exactly (`access-manager.tsx:393`), `border-amber-200 bg-amber-50 text-amber-800` when they do not, naming every differing page (`:380`).

### The table — `§27` fixed standard

```
colgroup: 40% | 12% | 12% | 12% | 12% | 12%
columns:  Page | View | Edit | Import | Export | Delete
rows:     all 39 ALL_PAGE_KEYS, in five sections (ACCESS_SECTIONS)
          Operations (15) · Tinting (13) · Master data (4) · Admin panel (5) · Attendance (2)
```

Source: `ACCESS_SECTIONS` in `lib/permissions.ts:558-584` ("The 39 keys grouped for display").
Every key in `ALL_PAGE_KEYS` appears exactly once, and the access page asserts it, so a key added
to one list and not the other is caught rather than silently dropped. What each key gates →
`CLAUDE_CORE.md §5`; the Billing family (`billing_picking`, `billing_print`, the four action
ticks) → `CLAUDE_BILLING.md §4`.

Header row 32px, data rows 36px, section rows 28px on `bg-[#fbfbfc]`. The Page cell is two lines: friendly label at 12.5px semibold over the raw page key in 10px mono `text-gray-400` — the key is always shown, so no label choice can mislead.

A checkbox is a 17px `rounded-[5px]` box, `border-brand-600 bg-brand-600` when on (`access-manager.tsx:611`), `border-gray-300` when off, with an amber ring when the value differs from the role baseline and a stronger amber ring while the change is unsaved. Rows with unsaved changes tint `bg-amber-50/60`.

### 🔴 The dash rule

A cell renders as a **dash (`–`, `text-gray-200`) instead of a checkbox where the app has no such check for that page.** Delete is asked on MRN and nowhere else; Export on MRN and `reports_ti_report` (the TI Report Download Excel button) — 2 keys; Import on Import OBDs, Sampling Library and the four master-data CSV buttons — 6 keys; Edit on **18** keys (`mrn`, `picking`, `tint_manager`, `tint_operator`, `mail_orders`, `floor`, `sampling_library`, `routes_areas`, `customers`, `skus`, `vehicles`, `billing_picking`, `billing_print`, `billing_hold`, `billing_slot`, `billing_urgent`, `billing_ship_to`, `place_order_ship_to`); View everywhere. Counted from `ACTION_PAGES`, `lib/permissions.ts:406-457`.

Source of truth: **`ACTION_PAGES` in `lib/permissions.ts`**, exposed as `isActionAvailable(pageKey, action)`. Its header cites the call-site census it was derived from and instructs any session adding or removing a permission check to update it.

**⚠ ADVISORY AND COSMETIC ONLY.** The row still stores all five booleans; the read, the save and the differs comparison all handle five. **A stale entry must never filter what is read, saved, compared or seeded** — it must degrade to "the screen drew a dash it should not have", never to a value being dropped. The save route deliberately does not validate against it, and `differingPageKeys()` deliberately ignores it.

Why it exists at all: without it an admin can switch on flags that gate nothing, which had already happened — eight `canExport` grants were true in the database and inert.

### 🔴 The live-source banner

Directly under the page title, and **it must never be softened into one hedged sentence** — being wrong in either direction is dangerous:

- **Live** (`ACCESS_SOURCE = user`): green `ok` — `border-ok/30 bg-ok-bg text-ok-text`, chip `bg-ok` (`access-manager.tsx:210`, `:222`) — **not brand**, `ShieldCheck`, chip *"Live — per-person ticks"* — *"The app is reading the ticks on this screen."*
- **Not live** (`role`): amber, `ShieldAlert`, chip *"Not live — job titles"* — *"a tick on this screen changes nothing yet"*, plus how to go live.

Both carry the raw value in mono and say a flip lands in ~30 seconds. It is driven by the **same cached value the resolvers read** (`lib/access/source.ts`), never a second query with its own opinion.

### Save bar

Sticky at the pane foot, shown only when there are pending changes: *Discard changes* on the left, *N changes* in amber and a `bg-brand-600 hover:bg-brand-700` **Save changes** on the right (`access-manager.tsx:485`). **Only the flags that actually moved are sent**; a toggle-and-toggle-back removes its own pending entry and never reaches the API. Switching person with unsaved edits asks first. After a save the server returns the recomputed `stored` and `differs`, and the banner updates from that answer rather than a client estimate.

### Legend
On · Off · *"The app has no such action on that page — nothing to switch"* · *"Set differently from their role"*.

---

## 64. Admin shell — `AdminSidebar` (rebuilt 2026-09-06)

`components/admin/admin-sidebar.tsx`, mounted through `components/admin/admin-layout-client.tsx`
by `app/(admin)/admin/layout.tsx:44` and by the admin path of `app/(ops)/layout.tsx:62`. The
role pages' sidebar is §7; this is the admin frame's own. Commits: `0fc145bb` (20 items in 5
groups), `8d7a3bef` (app switcher), `44125138` (visibility asks `isSuperuser`, not the job title),
`95b24352` (no content offset below md).

**Menu — `NAV_SECTIONS`, 20 items in five groups** (`admin-sidebar.tsx:70-129`):

| Group | Items |
|---|---|
| Overview | Dashboard |
| People & Access | Users · Access · **Job Titles** · Attendance |
| Customers | Customers · Sales Officers · SO Groups · Contact Roles |
| Depot Master | Routes · Areas · Sub-areas · Delivery Types · Slot Master · Slot Rules · Transporters · Vehicles |
| Settings | System Config · Hide · Removed Orders |

- **"Job Titles"** is the old "Roles" item, same href `/admin/roles`. 🔴 The `ICONS` map is
  keyed on the LABEL, so relabelling an item orphans its icon unless the key is renamed in the
  same edit (the file's own warning above `ICONS`).
- **Nothing was deleted to get from 28 to 20.** Eight items left the array only — Permissions,
  SKUs, Product Categories, Product Names, Base Colours, Import Orders, Tint Manager, Shade
  Master — and every page is still live by URL (`admin-sidebar.tsx:38-68`). `/admin/permissions`
  is the `ACCESS_SOURCE='role'` rollback editor: do not "finish the job" by removing it.
- **Visibility:** an item with a `pageKey` shows to a superuser or to anyone with that key's
  `canView`; a keyless item shows to a superuser only (`visibleItems`, `:289-296`, `44125138`).
- **My Attendance** is a footer link below the user block, not a menu item (`FOOTER_LINK`).
- **Active item:** `bg-brand-50 text-brand-700 font-semibold border-l-2 border-brand-600`, the
  same as §7.

**Chrome.** 240px expanded / 72px collapsed, 3px `#7C3AED` left accent (`:571-572`). The
brand block is `<OrbitWordmark height={collapsed ? 14 : 19} />` in `text-brand-800 hover:text-brand-600`,
and it IS the collapse toggle (`:525-532`); nothing sits beside it. The user-block avatar is
the §10.1 identity avatar (`bg-ink-50 text-ink-600 border-ink-100`). Below md: a 52px top bar
with a menu button and an 11px white wordmark on a 28px `bg-brand-600` tile (`:592-593`), and a
drawer that renders the menu, the footer link and the switcher.

**App switcher — "Open Orbit".** A button at the foot of the rail (a `Grid3x3` icon in
`text-brand-600`) opening an upward menu of **nine** destinations, in fixed order: Floor ·
Picking · Tint Manager · Billing · Import OBDs · Reports · MRN · CI · Trip Report
(`APP_SWITCHER_KEYS`, `lib/admin/app-switcher.ts:36-46`). Labels and hrefs are read from
`PAGE_NAV_MAP`, never hardcoded; the list is curated by key and **deliberately not
permission-filtered**. Rendered only for a superuser (`appSwitcher`, `admin-sidebar.tsx:450-451`).
Closes on outside click, Escape, or navigation. ⚠ The comment at `admin-sidebar.tsx:65-66`
("NO LINK OUT … deliberately not built here") is stale — the switcher is built.

---

## Change log — v5.31 (2026-09-19, canon sweep batch C1)

Evidence: `tailwind.config.ts`, import/grep sweeps over `components/ app/ lib/` at HEAD `b574cecc`, the sweep report `docs/prompts/drafts/code-discovery-2026-09-18-canon-sweep.md` (UI worker section), every changed claim re-read in code. No schema stamp, by design.

- §1, §2 (rewritten as **the Orbit token system** — `brand` / `ink` / `tint` / `ok` / `warn` / `danger` / `fav` / `data.*` from `tailwind.config.ts`; `data.teal` = IGT identity; the config enforces nothing about `gray`), §2.3 **`OrbitWordmark`** (generated, `currentColor`, 11 renders in 10 files; the orbit symbol retired in `de7453bb`).
- Teal → brand, checked against code, in §3 (IGT dot), §5, §6, §7, §9, §10, §11, §13, §14, §17, §21, §22, §23, §28, §29, §31, §32, §34, §40, §42, §45, §48, §50, §53, §54, §55, §56, §59.1, §59.2, §59.3, §61, §62, §63. Zero `teal-<n>` classes remain in code.
- §3: the red-Urgent migration list recounted — 10 rendered elements in 8 live files; the config's "Twelve" is stale.
- §6: roster recounted to 10 (CI and MRN desks added, `review-view.tsx` removed); primary Import is `ink-900`; new "Shared pieces the header mounts" — `ImportProgressPill`, `useCanImportObds`; CI/MRN wiring rows; Floor row loses the slot tabs.
- §21 `HeaderViewToggle`; §55 `useKeyboardOpen` and the `/po`–`/po2` pointer; §59.7 `subtitle` prop.
- §28: `InstructionsStrip` tone is `"notes"`, plus `fontSize` / `controlsSlot`; 🔴 `@page mo-landscape` nested in `@media print` recorded as a defect.
- §8, §10.1, §27, §33, §37, §53: the Tint Manager Kanban and `tint-table-view.tsx` no longer presented as live.
- §53/§54: ContactCard and the SO list re-described from code (32px role-tinted avatar; no newly-converted state; no avatar on the SO row).
- §57: Tags is the four-mode "Who sees it" picker (`abd495f4`); manual hide moved to the rail's "Hide an OBD…" select; the hide API exists.
- §59.1 You sheet (identity avatar, PushToggle row, Sign out not red); §59.4/§59.6 consumer lists recounted; §59.6 the service worker exists.
- §62.2/§62.4: dead Floor anchors (`floor-board.tsx`, `slot-band.tsx`, the upcoming strip) repointed to `trip-desk.tsx` / `CLAUDE_FLOOR.md §2`.
- §63: 39 keys in five sections; Edit on 18 keys, Export on 2; the live banner is green `ok`.
- §64 NEW: the admin shell — 20 items in 5 groups, "Job Titles", the "Open Orbit" app switcher, `OrbitWordmark`.

## Change log — v5.17 (2026-08-04 reconciliation pass, method v1.1)

Evidence: component import sweeps + folder listings + git log 2026-07-31→08-03. Claim IDs from the session report.

- UI-1 (header + footer): the missing-schema-stamp OPEN item resolved — no stamp BY DESIGN, recorded at both ends.
- UI-2/3 (§6): consumer roster stated from a 2026-08-04 import sweep (8 boards); attendance admin pages + Admin Import removed — they run their own headers (`attendance-page-header.tsx`; import has none).
- UI-4 (§6): wiring table — retired Support/Planning/Warehouse rows dropped; OT Pending/OT Audit/Admin Import rows dropped (not consumers); Trip Report row added; Mail Orders row flags the flag-gated billing-face divergence.
- UI-5 (§6): Billing v2's neutral header props documented (`searchLayout` / `showShortcutsButton` / `importVariant` + the `header-shortcuts.tsx` extraction) — commits confirmed in git log.
- UI-6 (§28): `InstructionsStrip` `tone` prop documented (violet = billing notes band).
- UI-7 (§49-§51): the three attendance admin pages no longer claim UniversalHeader.
- UI-8 (§53): Missing Customer Sheet's retired Support mount no longer described as live.
- UI-9 (§59.4): future-module candidate list no longer names the retired Support/Warehouse.
- UI-10 (§61): the picking-desktop archive README verified to exist; conditional wording removed.
- UI-11 (§27): Support tense fixed (retired board no longer described in the present).
- UI-12 (§47→§55): extraction re-verified — `--vvh` fix, app-wide viewport export, empty-state row, qty/autofocus rules all present in §55; §47 pointer stands.

- UI-13 (v5.18, final-pass 12b 2026-08-05): §55's four `po-page.tsx` line-number references replaced with file+symbol anchors per §62.1's own rule — each symbol re-verified live; the numbers had already drifted by 8 lines.

*UI v5.34 · OrbitOMS · updated 2026-09-24 · No Schema stamp by design (see above) — **§2.1: `data.brown` `#8B5A2B` added, owner Hand (dealer collects); after it no `data.*` colour is free.** (The Telephonic CI tag still sits on `data.blue` — its move to solid `ink-900` is a later build step.) Prior, v5.33 (2026-09-19): **§8: the Load plan cards (`components/floor/load-plan.tsx`) added, behaviour in `CLAUDE_FLOOR.md §2.2`.** Prior, v5.32 (2026-09-19): **§8: the Floor route cards (`components/floor/route-cards.tsx`) added, one line, behaviour in `CLAUDE_FLOOR.md §2.1`.** Prior, v5.31 (2026-09-19): **canon sweep C1: the file no longer says teal is the brand.** §2 is now the Orbit token system from `tailwind.config.ts` (`data.teal` = IGT only) plus `OrbitWordmark`; ~30 sections re-coloured against code; §57 Tags, §63 Access (39 keys) and the header roster recounted; §64 admin shell added; the nested `@page mo-landscape` recorded as a defect. Full list: the v5.31 change log above. Prior, v5.30 (2026-09-17): **§59.9 created: one violet per mobile screen.** A screen's budget is its title (§59.8's named brand element) plus one commit; selection moves to `data.slate` #475569 (now spoken for), status to `ok`, counts to ink, nav to ink-900 + a brand-600 underline, text actions to brand-700. Two named exceptions: a sheet's commit takes over from the screen's, and read-only/list screens have no commit. MRN's green End unloading recorded as a standing question. §59.3 and §62 updated to match. Prior, v5.29 (2026-09-09): **§59.8 extended to DETAIL and sub-screen headers.** The v5.28 pass reached the list screens through `ModuleMobileHeader` and missed every screen carrying a hand-rolled header, so opening a bill from Picking took you from a pale masthead to a filled brand-600 band — one flow, two headers. Seven more headers now take the same ground: the Picking bill detail, the My Picks bill detail, CI new-return, CI submitted detail, the MRN detail, and both Trip Report mobile headers. Title `brand-600` at unchanged size and weight, second line `ink-500`, back button white with an `ink-600` chevron and an `ink-100` border, white action chips given the same border. `/trips` gained the status-bar override alongside them. 🔴 Recorded so it is not flattened later: **the duplicate-SO branch keeps its red** — both picking detail headers swap the whole band to `#dc2626` when `hasDuplicateSo` and flip title, subtitle and back button back to white, and the pale ground is the ELSE arm of that condition, never a replacement for the warning. Prior, v5.28 (2026-09-09): §59.8 created — the pale masthead replaces the filled band on `/po` and across `ModuleMobileHeader`'s seven consumers, with the brand.600-over-brand.800 ruling, the white-avatar exception and the status-bar coupling. Prior, v5.27: §10.1, avatars are identity not emphasis. Prior, v5.26: the login panel's ramp dialled back. Prior, v5.25: the rings removed from the login panel.*
