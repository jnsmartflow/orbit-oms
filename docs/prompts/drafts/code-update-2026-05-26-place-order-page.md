# Code Update — `/place-order` desktop order entry page
Session date: planning draft created 2026-05-06 · execute in next Claude Code session
Session type: code — new authenticated route, frontend-only, no schema change, no API change
Target files: new `app/(place-order)/place-order/*`, `lib/place-order/*`, `public/category-images/*`
Implementation status: NOT STARTED — do not write code until §0 confirmation gate is cleared

---

## 0. Confirmation gate (read this first, do not skip)

Before writing any code, Claude Code must:

1. Read this entire .md file end to end.
2. Read `docs/CLAUDE_CORE.md`, `docs/CLAUDE_UI.md`, `docs/CLAUDE_MAIL_ORDERS.md`, `middleware.ts`, `lib/permissions.ts`, `app/(public)/order/page.tsx`, `app/api/order/data/route.ts` (if it exists — find it via `app/api/order/`).
3. Reply with: "All files read · v72/v5.1/v1.0 confirmed · ready to start" plus a one-paragraph summary of the page being built — this is to verify understanding before any file is created.
4. Wait for user to say "go" before writing any code.

Skipping this gate is the most common cause of broken implementations. Do not skip.

---

## 1. What this page is

A standalone authenticated desktop page where depot operators (billing, tint manager, support) take customer phone orders. The operator types the customer name, then enters quantities into a category-organised variant grid using mostly the numeric keypad. On submit, the page opens the user's default mail client with a pre-filled `mailto:` to `surat.order@outlook.com` containing the order in the same body format the existing PowerShell parser already understands.

This is a **separate page from `/order`**. The existing `/order` is a public mobile-first page used externally (Sales Officers, dealers). It must not be touched. The new page is internal-only, behind auth, optimised for fast back-to-back desktop entry by depot staff.

This is also a **separate flow from `/mail-orders`**. `/mail-orders` is the *inbound* board where billing operators resolve forwarded customer emails. `/place-order` is the *outbound* compose surface for taking a phone order live and sending it as if it were an email.

### Why this exists
Phone orders currently take ~90 seconds and ~33 taps on the existing mobile page. The new page targets ~30 seconds and ~22 keystrokes per order, no mouse, by leaning on:
- numeric-keypad-only grid navigation (Excel-style cell movement)
- category shortcut keys `1`–`9`
- direct-to-cart on every keystroke (no "Add to Bill" button)
- product-photo cards for visual category recognition

---

## 2. Route, layout group, and access

### 2.1 Route

**`/place-order`**

Reasoning for the name: distinct from `/order` (public mobile, untouched), distinct from `/mail-orders` (inbound resolution), reads as an action ("place an order"), short enough to memorise. Lives at the top level not under `/orders/*`.

### 2.2 File path

```
app/(place-order)/place-order/
  page.tsx                          — bare wrapper, force-dynamic, role check
  place-order-page.tsx              — main client component
  components/
    customer-search.tsx             — pill + dropdown
    category-grid.tsx               — photo grid, expanded panel, variant table
    variant-cell.tsx                — single qty cell with Excel keyboard
    cart-panel.tsx                  — right-side cart, dispatch, marker, send button
    bill-tabs.tsx                   — multi-bill switcher
    send-confirm-overlay.tsx        — pre-mailto confirmation
    keyboard-help-overlay.tsx       — `?` / `Shift+/` overlay
  hooks/
    use-place-order-state.ts        — cart state, draft autosave, customer
    use-keyboard-routing.ts         — global key handler
    use-grid-navigation.ts          — Excel cell movement state machine
```

A separate route group `(place-order)` is used so the layout can be different from other authenticated pages — specifically, `/place-order` runs full-bleed without the standard sidebar, to maximise grid space.

### 2.3 Layout shell

`app/(place-order)/layout.tsx` — minimal layout, no sidebar. Just the topbar (custom, page-specific) and the content. Sidebar is intentionally hidden because the page needs every pixel for the photo grid + cart.

### 2.4 Access roles

Allowed: `admin`, `billing_operator`, `tint_manager`, `support`, `dispatcher`.

Denied: `tint_operator`, `floor_supervisor`, `picker`, `operations`.

Reasoning:
- `billing_operator` (Deepanshu, Bankim) — primary phone-order takers
- `tint_manager` (Chandresh) — backup when billing is busy or for tint-heavy orders
- `support` (Rahul) — handles customer queries that often turn into orders
- `dispatcher` — sometimes asked to log a customer's verbal order
- `admin` — always
- `tint_operator` / `picker` / `floor_supervisor` work the physical floor; they don't take phone orders
- `operations` is read-only across boards by design

### 2.5 Wiring access

Two places to update:

**`lib/permissions.ts`:**
- Add new `PageKey`: `"place_order"`
- Add to `PAGE_NAV_MAP`: `place_order: { label: "Place Order", href: "/place-order", roles: [...above list] }`
- Add to `ALL_PAGE_KEYS`
- The `buildNavItems()` helper will surface it in sidebars for those roles automatically — no per-layout edits needed (per CLAUDE_CORE §5).

**`middleware.ts`:**
- No change needed. Page is auto-protected by the global `auth()` redirect-to-login behaviour. `/place-order` is not in `PUBLIC_PATHS` and not in `PHASE1_BLOCKED`.

**Login redirect:** `lib/auth.ts` (or wherever per-role redirect is set) — no change. Operators will still land on their existing primary screen on login (e.g. billing → /mail-orders); they navigate to `/place-order` via the sidebar.

### 2.6 Sidebar nav placement

In whatever order sidebar items currently render for billing_operator (probably alphabetical or per `PAGE_NAV_MAP` order), `Place Order` should appear above `Mail Orders`. That visual hierarchy reinforces "create new" → "review existing".

---

## 3. Data feed (no API change)

The page reads from the existing `/api/order/data` endpoint (the same endpoint the public mobile `/order` page uses). That endpoint returns:

```ts
{
  customers: Array<{ name: string; code: string }>,
  products: Array<{
    family: string;          // category — "WS", "VT", "GLOSS", etc.
    subProduct: string;      // product line — "MAX", "ETERNA", "DIAMOND GLO", etc.
    baseColour: string;      // base/colour — "Brilliant White", "Deep Base", "90 Base", etc.
    displayName: string;     // composed display name
    searchTokens: string[];  // for fuzzy search
    tinterType: string;
    productType: string;
    packs: Array<{ size: string; multiplier: number; sku: string }>;
  }>
}
```

**Two implications:**
1. The page must group products by `family` to render the category grid. This is client-side derivation — same as the mobile page does.
2. The endpoint is currently public (used by the public mobile `/order`). It will continue to be public. The fact that an authenticated page also calls it is fine — no auth header needed on the GET.

Verify before implementing: `app/api/order/data/route.ts` exists and the JSON shape matches the description above. If the file is named differently or returns a different shape, **stop and ask**, do not invent a replacement endpoint.

---

## 4. Submit flow (no API change)

The "Send Email" button builds a `mailto:` URL identical in body shape to what the existing mobile `/order` page produces, then opens it via `window.location.href = mailto:...`.

Body format (must match exactly so the PowerShell parser doesn't break):

```
Customer: <Customer Name> (<Code>)

Bill 1
<SubProduct> <BaseColour> <pack rendering, e.g. 1L*6, 4L*4>
<more lines>

Bill 2
<more lines>
```

Pack rendering rules (copy from mobile page exactly — find these in `app/(public)/order/page.tsx`):
- `>= 50` → render as `XML*qty` (millilitre, e.g. `200ML*12`)
- `< 1` litre → millilitre with decimal (e.g. `500ML*6`)
- `1` to `40` → litres (e.g. `4L*4`, `20L*1`)

**Constraint:** if you find a discrepancy between this spec and the actual mobile page implementation, the **mobile page wins**. Match it byte-for-byte — the parser was trained on its output.

Subject line: `Order — <Customer Name> <Code>`

Recipient: `surat.order@outlook.com`

After submit:
1. Clear `localStorage` draft for the current customer
2. Show a small "Email opened in your mail client" toast for 3 seconds
3. Reset cart (back to empty state with same customer still selected, allowing a follow-up order)

---

## 5. Customer search

Customer pill is the **only** place letters are typed. This is by design — once customer is locked, the rest of the order is numpad-only.

### 5.1 Search modes

Both modes share the same input field:
- **Type letters** → name fuzzy search (e.g. `Mehta` → "Mehta Paints", "Mehta Hardware")
- **Type digits only** → SAP customer code search (e.g. `12389` → "Mehta Paints (12389)") — direct code-entry path for operators who memorise codes

Mode is auto-detected: if input contains only digits, treat as code search; if input has any letters, treat as name search. No mode toggle UI.

### 5.2 Behaviour

- Page mounts → focus the customer pill input (no other element should grab focus first)
- 4+ chars → dropdown opens with up to 8 matches
- `↓` / `↑` to navigate dropdown
- `Enter` to select highlighted result → customer locked, focus jumps to category grid
- Click X on selected pill → clears customer and current cart (after confirm if cart has items), focus returns to pill
- Selecting a different customer when cart has items → silent auto-save current cart as draft, switch context

### 5.3 Draft persistence

`localStorage` key: `orbitoms_place_order_draft_v1`
Schema:
```ts
type Draft = {
  byCustomer: {
    [customerCode: string]: {
      customer: { name: string; code: string };
      bills: Bill[];
      shipTo: string;
      dispatch: "normal" | "hold" | "urgent";
      marker: "truck" | "cross" | "dts" | "none";
      updatedAt: number;
    }
  }
}
```

Save triggers: any cart change, customer switch, page unload (`beforeunload`).

Load trigger: when a customer is selected, check for draft and restore if present (within 24 hours; older drafts dropped silently).

**No server persistence.** Drafts are per-browser. Acceptable because (a) operators take orders at a single fixed PC, (b) the actual record-of-truth is the email that gets sent, (c) avoiding any new API endpoint keeps this a pure frontend feature.

---

## 6. Category grid (the visual centerpiece)

### 6.1 Layout

- 4-column grid (5 cols at viewport ≥ 1700px)
- Cards are 170px wide × 200px tall
- Photo zone: top 130px, uniform light-gray `#fafbfc` background
- Info bar: bottom 70px, white background, contains: coloured dot (8px), depot code (14px semibold), SKU/product count meta line

### 6.2 Photo handling

Image source: `/category-images/{depotCode}.png` (lowercase, no special chars).

Render logic per card:
```tsx
<img
  src={`/category-images/${code.toLowerCase()}.png`}
  alt={code}
  onError={(e) => { e.currentTarget.style.display = 'none'; showFallback(code); }}
/>
```

Fallback when image missing or 404: render the letter monogram inline (gradient rounded square 90×90 with the 2-letter code in white). Same monogram style as v3 mockup.

**Add 12 starter images to the repo at `public/category-images/`** (filenames lowercase, snake_case if multi-word):
- `vt.png` — Velvet Touch
- `aquatech.png` — Aquatech Damp Protect
- `gloss.png` — Gloss Premium Enamel
- `satin.png` — Super PU Satin
- `weathercoat.png` — Weathershield Powerflexx
- `superclean.png` — SuperClean
- `promise_enml.png` — Promise Enamel
- `dulux.png` — SuperCover Ultra
- `sadolin.png` — Sadolin PU
- `promise.png` — Promise Exterior
- `ws.png` — (use Promise Exterior as proxy — Smart Flow may swap later)

Photos already gathered by Smart Flow during planning session. Will be supplied as separate file uploads when code session starts. Until photos arrive, fallback monogram covers all 12 — page renders cleanly without them.

`auto.png` deliberately not provided — Auto enamel monogram fallback is acceptable.

### 6.3 Photo zone CSS rules (consistency)

Every photo regardless of source must render under these rules:
```css
.photo img {
  max-height: 110px;
  max-width: 110px;
  width: auto;
  height: auto;
  object-fit: contain;
}
```

Photo zone background uniform: `background: #fafbfc;`. No per-card colour tints. The actual photos provide all visual variation.

### 6.4 Card states

- Default: white card, 1px gray-200 border
- Hover: lift `translateY(-2px)`, shadow, photo scales 1.05×, border `gray-300`
- Active (currently expanded): teal-600 border (handoff to expanded panel — the card itself doesn't change, the panel below it has the teal border)

### 6.5 Number badge

Top-right of photo zone, 22×22 frosted-glass box with the keyboard digit (`1`–`9`). Only shown for the top 9 categories, ordered by SKU count descending (per existing CSV data: WS, GLOSS, VT, SADOLIN, WEATHERCOAT, DULUX, PROMISE, AQUATECH, SATIN). The remaining 3 cards have no badge — accessed via mouse, search, or arrow nav.

Order of categories in the grid: by SKU count descending. So if the data ever changes which categories are in the top 9, the keyboard mapping moves with them.

### 6.6 Direct-colour badge

Single-product categories (1 product, multiple base colours — e.g. GLOSS, AUTO, PROMISE ENML) show a "N colours" badge at bottom-left of the photo. Otherwise omit.

### 6.7 Expanded panel (when category clicked or `1`–`9` pressed)

The card stays in the grid; an expanded panel slides in below the row containing the clicked card. Panel takes full grid-column width. Inside the panel:

- Header row: 40×40 product photo (same image as card) + depot code label + meta strip + close button
- Product chip ribbon (only when category has >1 product): horizontal row of chips `[1]MAX`, `[2]POWERFLEXX`, etc. First chip auto-active. Click or `Tab` to switch. Number prefix on chips matches local digit `1-9` for picking products within an open category.
- Filter input row (only when active product has ≥6 base colours): "Filter colours…" text input + keyboard hint strip
- Variant table (the qty grid)
- Bottom keyhint bar — single muted line

When the user closes the panel (`*`, `Esc`, or click close), it collapses smoothly. Cart entries from this category remain in the right panel.

---

## 7. Variant grid (Excel-style)

### 7.1 Cell visual states

- **Empty** — no border, no background, just a faint dot `·` glyph in `#d1d5db`
- **Active (qty > 0)** — soft mint background `#f0fdfa`, bold teal-700 number, no border
- **Focused** — white background, 2px teal ring, focus halo `rgba(20,184,166,.18)` outer
- **Unavailable SKU (this base × pack combo doesn't ship)** — em-dash `—` glyph in `#e5e7eb`, not interactive

Cell size: 64×36px, centred in its `<td>`.

### 7.2 Pack column headers

Each pack column header shows the pack size (`1L`, `4L`, `20L`) on top + "box of N" sub-label below in monospace gray.

The pack-multiplier label is **NOT** rendered inside each cell — it's in the header. This is a change from v2/v3 mockups; v4 finalised the move.

### 7.3 NA detection

A `(base, pack)` combo is "NA" (unavailable) when no SKU exists in the catalog for that combination. Detection logic: when rendering the row, check if the active product's `packs[]` array contains an entry with the matching pack size for this base. If not, render as NA. Cells in NA state are non-interactive (not in tab order, no keyboard input, cursor is `not-allowed`).

### 7.4 Direct-to-cart writing

Every keystroke that changes a cell value writes immediately to cart state. There is **no "Add to Bill" button**. No commit step. The cart panel on the right updates in real-time as the user types.

Removing all qty from a cell (typing 0, pressing backspace, or pressing `−` on a 1-value cell) removes that line from the cart. If a base row has no remaining cells with qty > 0, the cart line for that base disappears.

---

## 8. Keyboard model — locked spec

This section is the authoritative reference. Implement exactly as written.

### 8.1 Customer pill (only place letters are typed)

| Key | Action |
|---|---|
| any letter | Append to search query, filter dropdown by name |
| any digit (when query is digits-only so far) | Append to search query, filter dropdown by code |
| `↓` `↑` | Move highlight in dropdown |
| `Enter` | Select highlighted result, lock customer, focus jumps to category grid |
| `Esc` | Clear input |

### 8.2 Category grid (no panel open)

| Key | Action |
|---|---|
| `1`–`9` | Open the Nth top-9 category |
| `0` | (reserved — currently no action) |
| `*` | Toggle search bar focus (escape hatch when category not in 1–9) |
| `/` | Open send-confirm overlay (only enabled when cart has ≥1 line) |
| any letter | Implicitly opens search bar with that letter as first character |
| `?` (Shift+/) | Show keymap overlay |

### 8.3 Search bar active

| Key | Action |
|---|---|
| any letter / digit | Filter products in real-time |
| `↓` `↑` | Move highlight through results |
| `Enter` | Open the highlighted product (expands its parent category, jumps focus to its variant table, first matching base-row's first qty cell focused) |
| `*` or `Esc` | Close search, return to grid |

### 8.4 Category panel open + variant grid

| Key | Action |
|---|---|
| `←` `→` `↑` `↓` | Move focus one cell in that direction (Excel) |
| `Tab` | Next column (Excel: wraps to next row's first column at end of row) |
| `Shift+Tab` | Previous column |
| `Enter` | Move down one row, same column (Excel convention) |
| `0`–`9` | Type qty into focused cell (auto-saves to cart on every digit) |
| `+` (numpad plus) | Increment focused cell by 1 |
| `-` (numpad minus) | Decrement focused cell by 1 (floor 0) |
| `Backspace` / `Delete` | Clear focused cell |
| `*` (numpad asterisk) or `Esc` | Close panel, return to category grid |
| `1`–`9` (when in product chip ribbon focus) | Switch to Nth product chip |
| `/` | Open send-confirm overlay |

**NA cell behaviour:** arrow keys, Tab, and Enter all skip over NA cells automatically. Typing a digit while focused on an NA cell does nothing (visually flash the cell briefly to acknowledge and ignore).

### 8.5 Multi-bill keys

| Key | Action |
|---|---|
| `B` (when search closed) | Cycle to next bill tab |
| `Shift+B` | Add a new bill, focus jumps to its empty cart |

### 8.6 Send flow

| Key | Action |
|---|---|
| `/` (cart not empty) | Open send-confirm overlay (preview of email body) |
| `/` again or `Enter` (overlay open) | Submit — opens mailto: in default mail client |
| `*` or `Esc` (overlay open) | Cancel, return to grid |

### 8.7 Implementation pattern

Use a single document-level `keydown` listener that dispatches based on current "context" (which is one of: `customer`, `grid`, `search`, `panel`, `cell`, `confirm-overlay`). Context is held in a useState in `place-order-page.tsx` and updated by the relevant child components when they take/release focus.

Avoid scattering `onKeyDown` handlers across many components. The single listener pattern ensures no missed cases (especially around `*` and `/` which are global).

Do not use `react-hotkeys` or any third-party keyboard library. Plain DOM keydown is enough and avoids new deps.

---

## 9. Cart panel (right side)

Width: 360px fixed. Sticky positioned. Scrollable internally if cart grows long.

Sections top to bottom:
1. **Customer block** — name (semibold) + code (mono small)
2. **Bill tabs** (when ≥2 bills) — pill row, active tab teal-600
3. **Cart lines per bill** — each bill is its own labelled section
4. **Divider**
5. **Ship To** — text input, optional, single line
6. **Dispatch** — segment chip group: Normal / Hold / Urgent. Default Normal.
7. **Marker** — segment chip group: Truck / Cross / DTS / None. Default None.
8. **Divider**
9. **Totals row** — "N lines · XL total · M bills"
10. **Send Email button** — full width, 44px tall, dark gray-900 bg. Disabled (gray-100, gray-400 text) when cart empty.
11. **Send hint** — small text "⌘↵ to send" or "/ to send"

Cart line shape:
```
<sub-product name>
<base / colour>
<pack list, comma separated, monospace>
[× delete on hover]
```

Just-added animation: brief teal-100 background flash for 1.2s after a line first appears.

---

## 10. Constraints & engineering rules

Per CLAUDE_CORE.md §3 — must be observed:

- All API routes (if any added — none planned) need `export const dynamic = 'force-dynamic'`
- Never `prisma.$transaction` — sequential awaits only (not relevant here, no Prisma)
- Never `prisma db push`
- Tailwind + shadcn/ui only — no new libraries
- Plain DOM keydown for keyboard handling — no `react-hotkeys` etc.
- `npx tsc --noEmit` must pass with zero errors before any commit
- TypeScript strict — no `any`, no `// @ts-ignore`. Use `unknown` and type guards for genuinely unknown shapes.
- Photos under 200KB each, square aspect, white background. PNG or JPG. No SVG (won't match the real photos that arrive later).

Per CLAUDE_UI.md v5.1 — must be observed:

- Teal-600 reserved for: brand logo, customer pill (selected), focused cell ring, active bill tab, expanded category border. NOT used for CTA buttons.
- All CTA buttons `bg-gray-900 text-white` (Send Email button)
- Default page bg `#f9fafb`, card bg `#fff`, borders `#e5e7eb`
- Focus rings 3px, color teal-500 with `0.1` opacity halo

Per CLAUDE_MAIL_ORDERS.md — relevant:

- Email body shape must match existing mobile page output exactly so the PowerShell parser succeeds
- "Bill 1" / "Bill 2" labelling (not "Part 1 of 2")

---

## 11. Testing checklist

Before declaring done, manually verify:

1. Page loads at `/place-order` for billing_operator role
2. Page redirects to `/login` for unauthenticated users
3. Page redirects to `/unauthorized` (or 403) for `tint_operator` and `picker` roles
4. Customer search by name works
5. Customer search by code works (numeric input only)
6. After customer pick, focus auto-moves to category grid
7. Press `1` → top category opens
8. Arrow keys move cells correctly, including across rows via Tab
9. `+` / `-` increment/decrement focused cell
10. Typing a digit overwrites the cell value
11. `Backspace` clears the cell
12. NA cells are skipped by Tab and arrow keys
13. Cart line appears immediately when typing into a cell
14. Cart line removes when cell value goes to 0
15. `Shift+B` adds a new bill
16. `/` opens confirm overlay
17. `/` again or `Enter` triggers `mailto:`
18. The mailto body matches the format the existing mobile `/order` page produces (open both, build the same order, diff the body strings)
19. localStorage draft persists across page refresh
20. Switching customer auto-saves prior customer's draft
21. Photos load when present at `/category-images/{code}.png`
22. Letter monogram fallback renders cleanly when photo is missing
23. `tsc --noEmit` returns zero errors
24. Page renders correctly at 1280×720 (smallest target desktop), 1440×900 (typical), and 1920×1080 (large)
25. Below 1024px width: page redirects to existing mobile `/order` (or shows a "use mobile page" prompt)

---

## 12. Phasing — implement in this order

### Phase 1 — Skeleton route + auth wiring (no UI yet)
- Create `app/(place-order)/place-order/page.tsx` — bare wrapper, role check, force-dynamic
- Create `app/(place-order)/layout.tsx` — minimal layout
- Update `lib/permissions.ts` to register the new page key
- Verify: load /place-order → see "Place Order — coming soon" placeholder, sidebar shows the link for billing_operator
- Commit: "feat(place-order): scaffold route + auth + sidebar entry"

### Phase 2 — Data fetch + customer search
- Wire `/api/order/data` GET on mount, store in component state
- Build `customer-search.tsx` with name + code search, dropdown, draft restore stub
- Verify: type "Mehta" → see results; type "12389" → see code match; press Enter → customer pill locks
- Commit: "feat(place-order): customer search with name + code modes"

### Phase 3 — Category grid (cards only, no expansion yet)
- Build `category-grid.tsx` rendering all 12 categories as photo cards in 4-column grid
- Add `public/category-images/` folder with the 11 starter photos (Smart Flow supplies)
- Implement `<img>` + onError → monogram fallback
- Verify: photos render, hover lifts card, monogram shows for missing photos
- Commit: "feat(place-order): photo-first category grid"

### Phase 4 — Expanded panel + variant table (no keyboard yet)
- Build `variant-cell.tsx` with empty/active/focused/NA states
- Wire pack-multiplier in column headers
- Click category card → expand panel inline, render variant table
- Click pack cell → input mode, type qty, blur to commit
- Cart updates in real-time on cell change
- Verify: click works end-to-end with mouse, NA cells render dashes
- Commit: "feat(place-order): variant grid with mouse interaction"

### Phase 5 — Keyboard model (the hard part)
- Implement `use-keyboard-routing.ts` with the 6-context state machine
- Wire `1`–`9` to category open, arrow keys to cell movement, `+`/`-` to delta
- Test all key combos in §8 systematically — go through the table line by line
- Verify: full numpad-only order from customer-locked → cart full
- Commit: "feat(place-order): full keyboard model"

### Phase 6 — Cart panel polish + send flow
- Build `cart-panel.tsx` with all sections from §9
- Implement `send-confirm-overlay.tsx`
- Wire mailto: building (paste the format from mobile `/order` page exactly)
- Verify: full flow from page-load → customer pick → 6 lines added → send → mailto opens with correct body
- Commit: "feat(place-order): cart panel + mailto send"

### Phase 7 — Drafts + multi-bill + final polish
- localStorage draft autosave on every change
- Multi-bill add/cycle keys + cart sectioning
- Below-1024 redirect to /order (mobile)
- `?` keyboard help overlay
- Verify all 25 items in §11 testing checklist
- Commit: "feat(place-order): drafts, multi-bill, polish"

Each phase ends with `tsc --noEmit` green. Each phase commits independently. If any phase reveals the spec is wrong (e.g. mailto body shape doesn't match), **stop and ask** — do not invent a fix.

---

## 13. Out of scope / known follow-ups

- **Server-side draft persistence.** Drafts are localStorage-only. If operators move between PCs, drafts won't follow. Acceptable for now per Section 5.3.
- **Recent customer list.** No "last 10 customers" shortcut on customer pill. Pure search. Add later if needed.
- **Reorder previous order.** No "duplicate last order from this customer" button. Add later.
- **Save draft as named template.** Not in scope.
- **POST to API instead of mailto.** This page outputs mailto only. A future enhancement could send directly to `/api/orders/punch` or similar. Out of scope.
- **Voice input.** The mobile page has voice input. Desktop deliberately doesn't — operators are at keyboards.
- **AUTO category photo.** Not provided. Monogram fallback covers it. If a photo arrives, drop into folder.
- **Image hosting via Supabase storage.** All photos in `public/category-images/` for now. If catalog grows beyond 30 categories or photos need to update without redeploys, switch to Supabase storage with a tiny fetch hook. Out of scope this session.

---

## 14. Visual mockup reference

The visual end-state is captured in:
- `docs/mockups/place-order/desktop-order-mockup-v4.html` — main mockup (Smart Flow will move from `/mnt/user-data/outputs/` to repo before code session starts)
- `docs/mockups/place-order/keyboard-storyboard.html` — 8-frame keyboard walkthrough

Open these alongside the code session for visual ground truth. The HTML is opinionated about pixel-level styling (border radii, padding, colors). Match the mockup, don't re-invent.

If at any point the mockup contradicts this .md file, **the mockup wins on visual styling**, and **this .md wins on behaviour and architecture**.

---

## 15. Done definition

The page is "done" when:

1. All 25 items in §11 pass
2. `tsc --noEmit` returns zero errors
3. Lighthouse desktop score ≥ 90 for performance, accessibility, best practices
4. A real depot operator (Deepanshu) takes one full phone order on /place-order in under 60 seconds with no mouse use after customer pick

Until all four are true, do not merge to `main`. Stay on the feature branch.

---

*Place Order page · Schema unchanged at v26.6 · Mockup v4.1 · Planning draft May 2026 · Smart Flow / Orbit OMS*
