# Code discovery — `/po2` (Purchase Order v2), source material for a client-facing presentation
# 2026-09-12 · READ-ONLY · the CODE is the source of truth, the docs are not

Scope: **`app/po2/` only.** Everything below was read out of the working tree on 2026-09-12
(branch `main`, HEAD `e2afa43f`). Where a `docs/` file disagrees, the code wins and the
disagreement is recorded in **section H**. Nothing was tested in a browser — there are no
credentials and no dev server was started; the evidence is the code and the route list.

---

## A. Which page is live

### The live Purchase Order page

**`/po2`** — files:

| File | Role |
|---|---|
| `app/po2/page.tsx` | server wrapper: `force-dynamic`, per-route PWA metadata + viewport |
| `app/po2/po-v2-page.tsx` | the whole app — 2,879 lines, every screen switched by state |
| `app/po2/product-drawer.tsx` | the bottom sheet a tile opens (2,095 lines) |
| `app/po2/review-screen.tsx` | checkout (734) |
| `app/po2/order-sheet.tsx` | the read-only order detail + the shared chip/card pieces (721) |
| `app/po2/drafts-sent.tsx` | the two list screens (353) |
| `app/po2/customer-list.tsx` | the dealer row + list body, shared by both pickers (219) |
| `app/po2/product-search.tsx` | product search input + grouped results (159) |
| `app/po2/v2-search-input.tsx` | the ONE search field, shared by all three searches (93) |
| `app/po2/v2-sheet.tsx` | the ONE bottom-sheet shell + scroll-lock + keyboard hooks (455) |
| `app/po2/v2-data.ts` | tokens, the BOARD, curation, catalog join, pack rules (2,988) |
| `app/po2/v2-email.ts` | subject + body + mailto (110) |
| `app/po2/v2-storage.ts` | every `po2_*` localStorage key (858) |
| `app/po2/manifest.webmanifest/route.ts` | the installable app's manifest, served by a route handler |

The only outside imports are three documented, read-only exceptions:
`lib/place-order/email.ts` (wire format), `lib/place-order/pack.ts` (`packKey`, `packStep`,
`sortPacks`), `lib/place-order/mobile-search.ts` (`rankProductsForQuery`), plus
`components/shared/orbit-wordmark` for the splash mark only.

### Public or login-required — settled from `middleware.ts`, not from a doc

**`/po2` is PUBLIC. No login, no session, no role.**

`middleware.ts:36` is `PUBLIC_PATHS.some((p) => pathname.startsWith(p))` — a **prefix** match —
and `PUBLIC_PATHS` (`middleware.ts:26`) carries `"/po"`. `"/po2"` starts with `"/po"`, so it is
waved through. **Nothing was added to that list for v2.** The manifest route
(`/po2/manifest.webmanifest`) never reaches middleware at all: the matcher
`["/((?!_next/static|_next/image|.*\\..*).*)"]` excludes any path containing a dot.

**Which roles land on it: none.** `lib/rbac.ts`'s `ROLE_REDIRECTS` maps every role to somewhere
else (`admin → /admin`, `dispatcher → /place-order`, `support → /place-order`,
`tint_manager → /tint/manager`, `operations → /floor`, `floor_supervisor`/`picker` → `/picking`,
`billing_operator → /mail-orders`, `logistics → /trips`, …). `/po2` is not a landing route, has
no `pageKey`, appears in no sidebar and in no nav map — a sales officer reaches it by URL or by
the installed home-screen icon. Verified by grep: outside `app/po2/` the string `po2` appears
only in comments and in the old address's redirect.

### The other two order surfaces — one line each, then they leave this report

- **`/po`** (`app/po/po-page.tsx`) — the previous public mobile order page. **Still live and
  unchanged**; `/po2` runs beside it, and retiring `/po` is a not-scheduled P2 on
  `docs/ROADMAP.md` behind a successor-parity gate. Superseded in intent, not yet in fact.
- **`/place-order`** (`app/(place-order)/place-order/page.tsx`) — the desktop, logged-in phone-order
  screen used by admin / billing_operator / tint_manager / support / dispatcher. Not superseded
  by `/po2`; different surface, different users.

Neither appears again below.

### When v2 landed — from `git log`

| Commit | Date | What |
|---|---|---|
| `1129427d` | — | Step 2 pointed the page at `BOARD` (referenced in code comments; the build ran at the hidden address `/po-v2-8f4kd2` from early September) |
| `4cc6ff2e` | 2026-09-10 | 26 board tiles + 38 rail members on cut-out art |
| `91f2bf53` | 2026-09-10 | the last five board tiles — every tile with art is a cut-out |
| `f4c0444c` · `a988ab41` · `b54ae21c` · `bc2cad7c` | 2026-09-09/10 | favourite products: storage, the board block, the gear, "a favourite is a BOARD TILE" |
| `fd8a7b43` · `8954014a` | 2026-09-10 | one ordered closing authority for every overlay; hardware back |
| `e2bc0ad3` · `d17354ce` | 2026-09-10 | white splash with the trail motion; correct icons |
| **`145b5f32`** | **2026-09-10** | **"po-v2 goes live at /po2: folder moved, manifest repointed, old address redirected"** ← the launch |
| `4e8ca379` | 2026-09-10 | shade hexes sampled from the printed card; Smart Choice pack order |
| `94a90573` | 2026-09-10 | the launch session record (draft, pre-canonical) |

**`145b5f32` is the go-live commit.** Everything before it ran at the obfuscated address; nothing
after it has touched `app/po2/` (the tree's last `app/po2/` change is `4e8ca379`, 2026-09-10).

---

## B. Screen inventory

Order in which a sales officer meets them. `screen` / `sheet` names are the literal state values
in `po-v2-page.tsx` (`type Screen`, `type Sheet`). **"NEW IN V2"** marks a row that has no
counterpart in the previous mobile page — each such claim is evidenced in the row's notes.

| # | State name in code | What the user sees | What they can do | What it leads to |
|---|---|---|---|---|
| 1 | `load.kind === "loading"` | White screen, violet **Orbit** wordmark, a dot running a fading tail into a solid rule beneath it | Nothing — it is not gated | The board, the moment `/api/order/data` answers |
| 2 | `load.kind === "error"` | "Could not load" + the reason + a violet **Retry** | Retry | Back to 1 |
| 3 | `screen: "order"` — **the board** | Pale violet masthead (wordmark + gear), sticky white search bar, then family cards of square tin photographs | Tap a tile · type a search · open favourites · open the cart · switch tab | 4 / 5 / 6 / 7 |
| 3a | board · masthead | "Orbit" at 31px in `#7C3AED` on `#F5F3FF`; a white 44px circle with a violet gear | Tap the gear | 7 (favourites picker) |
| 3b | board · sticky search row | 52px white field, magnifier, "Search product" | Type ≥2 characters | 4 |
| 3c | `searching` (≥2 chars) | The board is **replaced** by one row per product: name, family, an "Add" chip | Tap a row | 8 (drawer, opened on that product) |
| 3d | favourites card (`favViews.length > 0`) | A family-shaped card headed "Favourites" with a count pill and up to 8 tiles | Tap a tile | 8 |
| 3e | family cards (9) | One card per family: name, count pill, 4-across grid of tiles; in-cart tiles carry a violet count badge | Tap a tile | 8 |
| 3f | cart bar (`cartOpen`) | Fixed bar above the nav: violet cart tile, "N lines", the dealer or "No dealer yet", a violet **View** pill | Tap View | 9 (review) |
| 3g | `BottomNav` | Board · Drafts · Sent | Tap a tab | 3 / 15 / 18 |
| 4 | product search results | see 3c | — | — |
| 5 | — | — | — | — |
| 7 | `favManage` (sheet) | Fixed-height sheet, "Favourites", "N of 8 · they show first on the board", every board tile grouped under sticky family headings, a star per row | Star / unstar (max 8) · Done | Back to the board |
| 8 | `openTile` / `openGroup` — **the product drawer** | 94%-tall sheet: product name + family, optional pickers, a left rail of 60px squares, a violet name bar, pack rows with −/+ steppers, Cancel + Add | Choose a product / colour / pack, type or step a quantity | Adds cart lines, returns to the board |
| 8a | drawer layout `single` | No strip. Rail = this product's colours (or nothing at all) | — | — |
| 8b | drawer layout `strip-products` | A scrollable strip of product tiles above the rail | Tap a product | Rail + packs swap |
| 8c | drawer layout `rail-products` | The rail itself holds the products (no strip) | Tap a product | Packs swap |
| 8d | drawer layout `category-products` | A row of pill chips (Thinner · NC · Melamine · Other), rail = that chip's products | Tap a chip | Rail swaps |
| 8e | drawer · base/shade chips | Only on Gloss and Super Satin: "Base" / "Shade" pills | Filter the rail | — |
| 8f | drawer · search | Magnifier in the header → full-width field | Filter the rail | — |
| 8g | drawer · flat body | Every colour listed with its own stepper, one pack size stated in the header | Set quantities | — |
| 9 | `screen: "review"` | Checkout: dealer name as the title, Items, Dispatch, Remark, Notes, and a pinned footer with ship-to over **Send order** | Everything below | 10–14 |
| 10 | `reviewSheet: "call"` | Sheet, "Call to?", two 48px rows | Pick SO or Dealer | Back to review |
| 11 | `reviewSheet: "cross"` | Sheet, "Cross billing from?", four rows | Pick a depot | Back to review |
| 12 | `sheet: "clear"` | Sheet, "Clear all N items?" | Keep / Clear | Board (order emptied, dealer kept) |
| 13 | `screen: "dealer"` | Full screen: back chevron, title, pinned search, starred dealers | Search · star · pick | Back to review with the dealer set |
| 14 | `screen: "shipto"` | Same shell, "Ship to", a fixed "Same as billing" row first | Pick | Back to review |
| 15 | `screen: "sent"` | Green tick, "Order sent", the dealer, "N lines · N units", two buttons | Another order / different customer | Board |
| 16 | `screen: "drafts"` | "Drafts": "In progress" (violet-edged) then "Saved" cards | Open · delete | 17 |
| 17 | `screen: "draftDetail"` | Read-only order: header, Order card of facts, product card, footer Delete / Rename / Continue | — | 19 / 20 / board |
| 18 | `screen: "sentList"` | "Sent", cards grouped by day | Open | 21 |
| 21 | `screen: "sentDetail"` | The same read-only view, one footer button "Send again" | — | 22 |
| 19 | `sheet: "rename"` | Sheet, "Name this draft", a text field | Save name / Cancel | Draft detail |
| 20 | `sheet: "delete"` | Sheet, "Delete this draft?" | Keep it / Delete | Drafts |
| 22 | `sheet: "load"` | Sheet, "You have an order on the board" | Add to this order / Replace what is here / Cancel | Board |
| — | `toastHost` | A dark (or amber) pill above the nav, 1.8s | — | — |

### B.1 — Splash (`load.kind === "loading"`) — **NEW IN V2**

- No text at all. The outlined `OrbitWordmark` SVG at **33.8px ink height** (= 44px type ×
  0.769) in `#7C3AED`, centred on **white**, with a 3px rule 13px beneath it.
- Motion "Trail" (`SPLASH_CSS`): mark rises 380ms; a 6px dot runs the word's width from 100ms
  dragging a `linear-gradient(90deg, rgba(124,58,237,0) 0%, #7C3AED 100%)` tail; the rule fades
  in at 460ms. 640ms end to end. `@media (prefers-reduced-motion: reduce)` lands on the finished
  state.
- **Conditional:** rendered only while the catalogue request is in flight. Nothing gates the
  load on the animation — a warm app shows a flash.
- Why it exists, in the code's own words: iOS declares no `apple-touch-startup-image`, so it
  paints a screenshot of the last render while the app boots; rendering the brand here makes
  that screenshot the brand instead of a wall of paint tins.

### B.2 — Load failure

Exact strings:

- Heading: `Could not load`
- Message, one of: `Catalog request failed ({status})` · `Catalog came back empty` ·
  `Could not load the catalog`
- Button: `Retry`

**Conditional:** an empty `products` array is treated as a FAILURE, not as an empty catalogue —
`/api/order/data` swallows its own errors and answers 200 with empty arrays.

### B.3 — The board (`screen: "order"`) — **NEW IN V2**

Evidence for NEW: `app/po/po-page.tsx` contains no `<img>` element and no reference to
`category-images` or `/PO/` — the previous page has no product photography and no tile grid at
all.

- Ground `#FAFAFC`; masthead band `#F5F3FF` running up under the status bar
  (`paddingTop: calc(env(safe-area-inset-top) + 16px)`).
- Wordmark: the word **`Orbit`** set as live text, Plus Jakarta Sans bold, 31px,
  `letterSpacing: -0.045em`, `#7C3AED`.
- Gear button: `aria-label="Choose favourite products"`, 44×44 white circle, `CARD_SHADOW`.
  **Conditional on nothing — always drawn**, but it scrolls away with the brand row (only the
  search row is sticky).
- Search input placeholder: **`Search product`**; clear button `aria-label="Clear search"`.
- Family card header: the family name at 14px bold, and a mono count pill.
  The nine names, in order: **Enamel · Interior · VT · Promise · Exterior · Primer · Stainer ·
  Aquatech · Wood** (`BOARD`, `v2-data.ts`).
- Favourites card: heading **`Favourites`**, count pill. **Conditional:** renders nothing at all
  when the list is empty — no prompt, no placeholder.
- Tile: square photo (or the family wash), name centred underneath at 12px on a fixed two-line
  block; a violet count badge top-right when the tile has lines in the order.
- Cart bar, **conditional on `lines.length > 0`**:
  `{n} lines` / `{n} line`, then the dealer name or **`No dealer yet`**, then the pill **`View`**.
- Bottom nav labels: **`Board`** · **`Drafts`** · **`Sent`**. Active `#6D28D9`, inactive `#9C99AC`.

### B.4 — Product search results

- Empty state: **`No product matches {query}`** (query trimmed).
- Row: product name (the curated tile label where the product is on a tile, else the catalogue
  `displayName` with a trailing " - {baseColour}" stripped), the family underneath, and a chip
  reading **`Add`**.
- **Conditional:** the whole board is replaced at `MIN_QUERY = 2` characters.

### B.5 — Favourites picker (`favManage`) — **NEW IN V2**

- Title **`Favourites`**; subtitle **`{n} of 8 · they show first on the board`**.
- Sticky family headings (the nine `BOARD` family names) over one row per tile: 38px thumbnail,
  the tile label, a star.
- Footer button: **`Done`**.
- Refusal toast (amber): **`Favourites full (8 of 8) — remove one first`**.
- **Conditional:** un-starring asks nothing. Adding and removing are silent; only the refusal
  speaks.
- Evidence for NEW: the previous page's favourites are **customers** (`po_fav_customers`,
  `lib/place-order/fav-customers.ts`); favourite **products** are a v2 concept stored under
  `po2_fav_products`.

### B.6 — The product drawer (`ProductDrawer`)

Header:
- Title: the **tile** label (e.g. `More Enamels`, `Crack Filler and Additives`), or the product's
  own label on a search hit.
- Sub-line: the family (e.g. `Enamel`), **or** — in flat mode only — the single pack size in
  violet caps.
- Buttons: `aria-label="Search this product's colours"` (**conditional:** only when a rail is
  shown and the search is closed) and `aria-label="Close"`.

Search row (**conditional on `searchOpen`**):
- Placeholder, by layout: **`Find a product`** (rail holds products) · **`Find`** (variants) ·
  **`Find a shade`** / **`Find a base`** (Gloss and Super Satin only) · **`Find a colour`**
  (everything else). `aria-label="Filter the rail"`; close button
  `aria-label="Close the search"`.
- No-match line: **`Nothing in this list matches {query}`**.
- Does **not** auto-focus on a phone (`autoFocusAllowed()` gates on `min-width: 768px`).

Pickers above the rail (each **conditional**):
- `category-products` → chips **`Thinner`** · **`NC`** · **`Melamine`** · **`Other`** (the one
  category tile today: "Thinner & More").
- Gloss / Super Satin only → chips **`Base`** · **`Shade`**.
- `strip-products` → a horizontal strip of product tiles.
- All three collapse to `display:none` when the keyboard is open **and** the search is open.

Rail: 104px column, 60px squares, name underneath at 11px on a fixed 2.4em block, up to 3 lines.
A shade shows its own colour, a base shows its short form set large (`BW`, `90`, `GREEN`), a
variant shows its tin, anything else shows the family wash. Selected = a violet ring with a white
gap. Units carried = a violet badge inside the square's corner.

Name bar: the selected colour at 15px in `#6D28D9`, with a 22px swatch when the colour has a
published hex. In flat mode it shows the **product** name instead.

Pack rows: the pack label at 15px, and **`per {step}`** underneath — **conditional on
`step > 1`**. Stepper `aria-label`s: **`Remove one box of {label}`** / **`Add one box of {label}`**.
The number is a button: `aria-label="Quantity for {label}, {qty} units. Tap to type."`; tapped, it
becomes an input `aria-label="Quantity for {label}, in units"`.

Footer: **`Cancel`**, then the commit button, whose label is one of:
- **`Add to order`** (nothing entered — disabled, grey `#9C99AC`)
- **`Add · {n} units`**
- **`Update · {n} units`** (**conditional:** the tile already has lines in the cart)

### B.7 — Review (`screen: "review"`)

- Header band, same `#F5F3FF` wash. Back button `aria-label="Back to products"`.
- Title = the dealer's name in `#7C3AED`, wrapping to two lines, with the code and area beneath
  in mono; with no dealer it reads **`Choose dealer`** in `#6D28D9`. The whole block is the
  change-dealer button — there is no chevron.
- Two icon buttons, **disabled (not hidden) when the order is empty**:
  `aria-label="Save draft"` (bookmark) and `aria-label="Clear order"` (X).
- **`Items`** + a violet **`Edit`**.
  - Each line: a 46px tin, the product name (never truncated, wraps), the chosen colour in
    violet caps underneath (**conditional on there being one**), a fixed 96px column of
    `{pack} ×{qty}` in mono, and a remove button `aria-label="Remove {label}"`.
  - **There is no total.** No per-line unit subtotal and no order total anywhere.
- **`Dispatch`** — three equal chips, each with a 7px dot:
  **`Normal`** (grey `#B9B6C6`) · **`Urgent`** (amber `#F59E0B`) · **`Call`** (red `#EF4444`).
  When Call is chosen the chip reads **`Call · SO`** or **`Call · Dealer`**.
- **`Remark`** — four equal chips: **`Truck`** · **`Cross`** · **`Bounce`** · **`DTS`**.
  Tapping the lit one clears it. Choosing Cross opens the depot sheet first and commits nothing
  until a depot is picked.
  - **Conditional line** when Cross is set and a depot is stored:
    `Cross billing from {depot} · ` + a violet **`change`**.
- **`Notes`** — a 3-row textarea, placeholder **`Notes · optional`**.
- Footer, always visible:
  - Ship-to row: **`Ship to · same as billing`** or **`Ship to · {name}`**, the area or code
    underneath, and a violet **`Change`**. Turns violet when it is not the billing dealer.
  - Send: **`Send order`**, or **`Choose dealer to send`** when there is no dealer. It is
    `aria-disabled`, **never `disabled`** — tapping it with no dealer opens the dealer picker
    and comes back.

### B.8 — Call picker (`reviewSheet: "call"`)

Title **`Call to?`**; options **`SO`** · **`Dealer`**. No Cancel button — the scrim is the
dismiss, and dismissing writes nothing.

### B.9 — Cross-depot picker (`reviewSheet: "cross"`)

Title **`Cross billing from?`**; options **`Dahisar`** · **`Ahmedabad`** · **`Rajkot`** ·
**`Pune`**. Dismissing leaves the remark exactly as it was, so "Cross with no depot" cannot be
stored.

### B.10 — Clear confirm (`sheet: "clear"`)

- Heading: **`Clear all {n} items?`** (`item` when n is 1)
- Body, two variants:
  - `The order empties and you go back to the board. {dealer} stays.`
  - `The order empties and you go back to the board.`
- Buttons: **`Keep`** (outlined) · **`Clear`** (solid `#DC2626`)

### B.11 — Dealer picker (`screen: "dealer"`)

- Title: **`Who is this order for?`**, or **`Change dealer`** when one is already set.
- Search placeholder: **`Search dealer or code`**. **No auto-focus** — deliberately, so the
  keyboard does not spring on open.
- Empty query → **the starred dealers only, A–Z**. Nothing starred → **the screen renders
  nothing at all** (no illustration, no instruction).
- With a query → matches from the full master list. Empty result:
  **`No dealer matches {query}`**.
- Row: name at 14px, `{code} · {area}` in mono underneath, a star
  (`aria-label="Star {name}"` / `Unstar {name}`), then a chevron — or a violet tick when this is
  the dealer already on the order.
- Picking a dealer **never sends**; it returns to review.

### B.12 — Ship-to (`screen: "shipto"`) — **NEW IN V2 (its own shortlist)**

- Title **`Ship to`**.
- A fixed first row, **conditional on an empty query**: a pin icon and **`Same as billing`**,
  ticked when that is the current state.
- Then the same dealer list — but reading and writing **`po2_starred_shipto`**, a separate store
  from the customer stars, so starring a delivery address does not promote it among the shops he
  bills.

### B.13 — Sent confirmation (`screen: "sent"`)

- Green `CheckCircle2` (`#16A34A`), then **`Order sent`**, the dealer's name, and
  **`{n} lines · {n} units`** in mono.
- Buttons: **`Another order for {firstWord of dealer name}`** (violet) and
  **`Different customer`** (outlined).
- The wording is deliberate: "Sent" means handed to the mail app, and the screen does not claim
  the mail left.

### B.14 — Drafts (`screen: "drafts"`) — **NEW IN V2 (the in-progress split)**

- Title **`Drafts`**. Empty state: **`No drafts yet.`**
- Section labels: **`In progress`** (the live auto-save, drawn with a 3px violet left edge and
  **no** delete icon) and **`Saved`**.
- Card: the dealer's name (or the draft's own name, or **`No dealer yet`**), `{code} · {area}`
  or **`No dealer yet`** beneath it, then a chip row and the time.
  - Chips, in this order and each conditional: a box glyph + the line count (**always**),
    **`Urgent`** (amber), **`Call · SO`** / **`Call · Dealer`**, **`Ship to`** (violet), and the
    remark word.
  - Delete: `aria-label="Delete {title}"`, **conditional — saved cards only**.
- Timestamps: `10:42` today · **`Yesterday`** · `Fri 18:05`.

### B.15 — Order detail (`screen: "draftDetail"` / `"sentDetail"`)

One component (`OrderDetail`) used twice.

- Header: the dealer's name at 20px, `{code} · {area}` in mono, and a status chip —
  **conditional:** shown on the draft detail (`Saved` / `Auto-saved`), hidden on the sent detail.
- Section label **`Order`**, then a card of facts. Rows render **only when they carry a value**:
  - first row: the status word as the label, the timestamp as the value
    (`Today, 4:12 pm` / `Yesterday, …` / `08 Sep, …`)
  - **`Dispatch`** — conditional on it not being Normal
  - **`Remark`** — `Cross Delivery from {depot}` when a depot is stored
  - **`Ship to`** — `{name} · {code}`, or the bare code if that dealer has since gone
  - **`Note`** — the only row allowed to grow, clamped at two lines
- Section label **`{n} products`** / **`1 product`**, then the line rows (46px tin, name, colour,
  `{pack} ×{qty}`).
- Footer:
  - draft: **`Delete`** · **`Rename`** · **`Continue`**
  - sent: **`Send again`** (violet `#6D28D9`) — and it is a *fresh* order, never a re-send: it
    puts the order on the board and never re-fires the mailto.

### B.16 — Rename (`sheet: "rename"`) — **NEW IN V2**

- Heading **`Name this draft`**; sub-line is the generated label (`AMBIKA PAINTS · 3 lines`).
- Field: placeholder **`Wednesday route`**, `aria-label="Draft name"`, `maxLength={40}`, 16px so
  Safari does not zoom.
- Hint: **`Leave it empty to go back to the dealer's name.`**
- Buttons: **`Cancel`** · **`Save name`**

### B.17 — Delete confirm (`sheet: "delete"`)

- Heading **`Delete this draft?`**
- Then the draft's display name, then **`{n} products · saved {when}`**.
- Buttons: **`Keep it`** · **`Delete`** (solid `#DC2626`)

### B.18 — Sent list (`screen: "sentList"`)

- Title **`Sent`**. Empty state: **`Nothing sent in the last five days.`**
- Day headings: **`Today`** · **`Yesterday`** · `Fri 5 Sep`. Inside a group the card shows the
  clock only.
- **No delete icon** — a sent order is a record; it ages out after five IST days
  (`SENT_RETAIN_DAYS = 5`).

### B.19 — Replace-or-add (`sheet: "load"`) — **NEW IN V2**

Opened when Continue or Send again is tapped **and the board already has lines** (with an empty
board there is no question and the order is simply loaded).

- Heading **`You have an order on the board`**; sub-line **`{n} products already added`**.
- Option 1: **`Add to this order`** —
  `{n} products joins what is here; the same product twice is added up`
- Option 2: **`Replace what is here`** (red text) —
  `The {n} products on the board are removed, and its dealer is used`
- Footer: **`Cancel`**

### B.20 — Toasts (`toastHost`, mounted on every screen)

| String | When | Tone |
|---|---|---|
| `Draft saved` | Save draft on review | ink |
| `Draft deleted` | after the delete confirm | ink |
| `Added {n} products` / `Added 1 product` | "Add to this order" with no overlap | ink |
| `Added · {n} lines merged` / `Added · 1 line merged` | "Add to this order" when rows merged | ink |
| `Favourites full (8 of 8) — remove one first` | starring a 9th | **amber** `#B45309` on `#FFFBEB` |

Amber is used for the one message that reports something that did **not** happen; every other
toast reports something that did.

### B.21 — Cross-cutting behaviours worth showing

- **One closing authority.** Every dismiss — scrim, Cancel, a back chevron, the Android hardware
  back button — routes through one ordered `closeTopLayer()`. Opening a layer pushes exactly one
  history entry; committing consumes it. **NEW IN V2** as a single mechanism covering all twelve
  overlays (the previous page has its own back authority for its own screens; v2's covers the
  drawer, both review pickers, the favourites picker and the four confirms).
- **Nothing is asked before adding.** The board holds no dealer state; a tile tap opens its
  drawer and nothing else happens. The dealer is asked once, at review. **NEW IN V2** — the
  previous page starts an order by choosing a customer from Home.
- **The order survives everything.** A debounced 400ms write to `po2_draft`, plus an immediate
  flush on `pagehide` and on `visibilitychange → hidden`.
- **Quantities survive every move inside a drawer** — they are keyed member → option → pack.
- **A typed quantity is stored as typed.** 9 stays 9; there is no snap-to-carton.

---

## C. The brand

`/po2` paints **every colour as an inline style**. It reads no CSS variable from `globals.css`
and no class from `tailwind.config.ts`. Both are recorded below because they are the app the
page sits inside, but the page's own palette is `app/po2/v2-data.ts`.

### C.1 — `/po2`'s own tokens (`app/po2/v2-data.ts`, exported constants)

| Token | Hex | Role, in the file's own words |
|---|---|---|
| `BRAND` | `#7C3AED` | brand.600 — THE ONE commit button per screen, the theme colour, the focus ring |
| `VIOLET` | `#6D28D9` | brand.700 — every tappable TEXT |
| `BRAND_DEEP` | `#5B21B6` | brand.800 — the wordmark on white |
| `BRAND_WASH` | `#F5F3FF` | the ONLY violet ground in the app — the masthead band |
| `VIOLET_BG` | `#F5F1FE` | selected-chip / in-cart tile wash |
| `SURFACE` | `#FFFFFF` | cards, sheets, bars |
| `PAGE` | `#FAFAFC` | the page behind them |
| `FILL` | `#F4F3F8` | inputs, inert squares (also the list screens' ground, `LIST_BG`) |
| `RULE` (= `DIVIDER`) | `#E9E7F0` | EVERY border, without exception |
| `FAINT` | `#9C99AC` | placeholders, disabled, chevrons |
| `MUTED` | `#74718A` | second lines, captions |
| `BODY` | `#3A3748` | ordinary text |
| `INK` | `#1B1826` | headings and anything that must land |
| `FOCUS` | `#8B5CF6` | the focused input border |
| `FOCUS_RING` | `rgba(124,58,237,.13)` | brand.600 at 13% — the ring, never a fill |
| `URGENT` | `#DC2626` | the ONE destructive colour; only ever inside a confirm |
| `STAR` / `FAVOURITE` | `#F59E0B` | the favourite star, and nothing else |
| `DOT_NORMAL` | `#B9B6C6` | Dispatch dot — nothing to do |
| `DOT_URGENT` | `#F59E0B` | Dispatch dot — a PRIORITY, never a fault |
| `DOT_CALL` | `#EF4444` | Dispatch dot — phone somebody before it goes |
| `SCRIM` | `rgba(18,14,26,.42)` | behind every sheet |
| `ATTENTION` / `ATTENTION_BG` | `#B45309` / `#FFFBEB` | amber-700 on amber-50 — the Urgent chip and the refusal toast (`order-sheet.tsx`) |
| `BRAND_GRADIENT` | `radial-gradient(125% 125% at 26% 20%, #A78BFA 0%, #7C3AED 100%)` | **zero call sites today** — kept deliberately, was the splash's ground |

Family tints (`BOARD`, washed to 55% toward white by `mixToWhite(tint, TILE_WASH)` behind tile
art): Enamel `#F8F0E0` · Interior `#E8EFFA` · VT `#EDEBF5` · Promise `#FBECEF` ·
Exterior `#EAF4E8` · Primer `#E3F1F8` · Stainer `#F6E8C8` · Aquatech `#E0F1EA` · Wood `#EFE6DA`.

Shadows:

```
CARD_SHADOW        0 1px 2px rgba(27,24,38,.04), 0 6px 16px -8px rgba(27,24,38,.10)
CARD_EDGE          0 1px 2px rgba(27,24,38,.06)                      (list + detail cards)
CUTOUT_SHADOW      drop-shadow(0 1.5px 2px rgba(24,20,38,0.35)) drop-shadow(0 4px 6.5px rgba(24,20,38,0.21))
CUTOUT_SHADOW_RAIL drop-shadow(0 1px 1.5px rgba(24,20,38,0.35)) drop-shadow(0 3px 4.5px rgba(24,20,38,0.21))
search resting     0 1px 2px rgba(27,24,38,.04)
search focused     0 0 0 3px rgba(124,58,237,.13)
sheet              0 -8px 32px rgba(18,14,26,.16)
```

Radii actually used: 20 (sheet top corners) · 16 (family card) · 14 (tile square, search bar) ·
13 (every button) · 12 (textarea, drawer search) · 11 (chip, 46px tin, cart glyph tile) ·
10 (favourites-row thumbnail) · 8 (list chip) · 6 (colour swatch) · `999`/`rounded-full` (pills,
badges, steppers).

Type scale (`order-sheet.tsx` states it in full, eleven roles):

```
T1  screen title   20 / 700 / -.02em      T7  row label     11 / 600 / +.1em caps
T2  header meta    11 mono / MUTED        T8  row value     14 / 500
T3  section label  10 / 700 / +.13em caps T9  product name  15 / 600 · colour 11 / 700 caps violet
T4  card title     17 / 500               T10 figures       13 mono tabular
T5  card meta      12 mono / MUTED        T11 button        15 / 600
T6  chip           12 / 600 + 13px icon
```

Plus `SCREEN_TITLE` (20 / 700 / -0.02em / 1.25) and `DEALER_TITLE` (17 / 600 / -0.02em / 21px)
in `v2-data.ts`, and `MASTHEAD_WORDMARK = 31`, `SPLASH_WORDMARK_INK = 33.8`.

### C.2 — The app-wide theme (context, not what `/po2` paints with)

**`tailwind.config.ts`** — added 2026-09-08 in rebrand step 1:

```
brand   50 #F5F3FF · 100 #EDE9FE · 200 #DDD6FE · 300 #C4B5FD · 400 #A78BFA
        500 #8B5CF6 · 600 #7C3AED · 700 #6D28D9 · 800 #5B21B6 · 900 #43168B
ink     0 #FFFFFF · 25 #FAFAFC · 50 #F4F3F8 · 100 #E9E7F0 · 200 #D6D3E0
        400 #9C99AC · 500 #74718A · 600 #514E63 · 700 #3A3748 · 900 #1B1826   (no 300, no 800)
tint    bg #F0F9FF · bd #BAE6FD · 600 #0284C7 · 700 #0369A1        (tinting only)
ok      #059669 · bg #ECFDF5 · text #047857
warn    #D97706 · bg #FFFBEB · text #B45309
danger  #E11D48 · bg #FFF1F2 · text #BE123C · bd #FECDD3           (error + destructive ONLY)
fav     #F59E0B
data    teal #0D9488 · blue #2563EB · orange #EA580C · rose #E11D48
        cyan #0891B2 · lime #65A30D · pink #DB2777 · slate #475569  (identities, never states)
```

**`app/globals.css`** — the shadcn HSL block (`--background 0 0% 100%`, `--foreground 222.2 84%
4.9%`, `--primary 222.2 47.4% 11.2%`, `--destructive 0 84.2% 60.2%`, `--border 214.3 31.8% 91.4%`,
`--radius: 0.5rem`, …) plus a second, older Orbit set at `:root`:

```
--bg #f0f2f8 · --surface #ffffff · --surface2 #f7f8fc · --border #e2e5f1 · --border2 #cdd1e8
--t1 #111827 · --t2 #374151 · --t3 #6b7280 · --t4 #9ca3af
--sh0 0 1px 2px rgba(0,0,0,.04) · --sh1 … · --sh2 …
legacy: --white #ffffff · --text #111827 · --text-2 #374151 · --muted #6b7280 · --muted-lt #9ca3af
        --hover-row #f9fafb · --sel-row #eff6ff · --shadow-sm/-/-lg
```

Nineteen tokens (the `--navy` family and the whole semantic block) were **deleted** on
2026-09-08 for having zero readers. Two navy hexes survive as raw values in admin chrome:
`[data-slot="sheet-title"]` and `.oa-form-section`, both `#1a237e`.

**Fonts.** `app/layout.tsx`, `next/font/google`:
- `Plus_Jakarta_Sans` → `--font-sans`, subset `latin`, `display: "swap"`, variable weights.
- `JetBrains_Mono` → `--font-mono`, weights **400, 500, 600, 700**, `display: "swap"`.
- `body { font-size: 13px }` in `globals.css`. Mono is used for codes, areas, timestamps and
  quantities; everything else is Jakarta.

**Dark mode: none in practice.** `tailwind.config.ts` sets `darkMode: ["class"]` and
`globals.css` carries a `.dark` block, but nothing ever applies the class — there is no
`ThemeProvider` in `app/layout.tsx`, and the only `next-themes` consumer is
`components/ui/sonner.tsx`, which `/po2` does not render. No theme switch exists anywhere in the
UI.

### C.3 — The app identity: `/po2` is an installable app of its own

Served by a **route handler**, not a file in `public/`:
`app/po2/manifest.webmanifest/route.ts`, `Content-Type: application/manifest+json`.

Verbatim:

```json
{
  "name": "Orbit",
  "short_name": "Orbit",
  "description": "Place a depot order — JSW Dulux Surat Depot",
  "id": "/po2",
  "start_url": "/po2",
  "scope": "/po2",
  "display": "standalone",
  "display_override": ["standalone"],
  "background_color": "#FFFFFF",
  "theme_color": "#F5F3FF",
  "orientation": "portrait",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

Alongside it, `app/po2/page.tsx` declares the iOS half, because **iOS ignores the manifest for
home-screen icons** and reads the `apple-touch-icon` link instead:

```ts
export const metadata: Metadata = {
  title: "Orbit",
  manifest: "/po2/manifest.webmanifest",
  icons: { apple: { url: "/apple-touch-icon.png", sizes: "180x180" } },
  appleWebApp: { capable: true, title: "Orbit", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#F5F3FF" };
```

Notes that matter for the presentation:

- **`theme_color` `#F5F3FF` is the masthead's own wash**, so the status bar continues the header
  instead of cutting a strip above it. It is deliberately *not* brand.600.
- **`background_color` `#FFFFFF`** is the launch ground, matching the white splash the page
  paints a moment later. It used to be violet, which produced a violet flash into a white screen.
- **Every icon is `"any maskable"`** and the PNGs are full-bleed with **no baked corner radius** —
  both platforms apply their own mask. The word sits at 62% of the tile.
- The manifest `id` is `"/po2"`, so it installs as a **separate** home-screen app.
- The home-screen name is **`Orbit`** — final from the first install, because both platforms
  cache the name and icon at install time.

**Every brand asset the live app uses**

| File | Pixel size | File size | Where it is rendered |
|---|---|---|---|
| `public/icon-192.png` | 192×192 | 24,213 B | `/po2` manifest (any maskable) · root `manifest.json` · `app/layout.tsx` icons |
| `public/icon-512.png` | 512×512 | 92,860 B | `/po2` manifest (any maskable) · root `manifest.json` (any + maskable) · `app/layout.tsx` |
| `public/apple-touch-icon.png` | 180×180 | 21,922 B | the iOS home-screen icon for `/po2` (`app/po2/page.tsx`) and app-wide |
| `public/icon-source.svg` | 512×512 | 2,366 B | **source only** — the three PNGs are generated from it by `scripts/generate-wordmark.mjs`; not served to any page |
| `public/orbit-wordmark.svg` | viewBox `0 0 2316 769` | 1,829 B | standalone copy of the wordmark path; the component below is what `/po2` actually renders |
| `components/shared/orbit-wordmark.tsx` | viewBox `0 0 2316 769`, aspect **3.0117** | — | the **splash** mark on `/po2` (the only surface in this module that uses it) |

The board masthead does **not** use the SVG — it sets the word `Orbit` as live text in Plus
Jakarta Sans Bold, 31px, `-0.045em`, `#7C3AED` (`Wordmark` in `po-v2-page.tsx`). The SVG is used
on the splash only, because the splash is the earliest paint and a webfont would swap under the
salesman's eyes.

**Not used by the live app:** `public/brand/` (`apple-touch-icon.png` 11,389 B ·
`icon-192.png` 12,980 B · `icon-512.png` 36,954 B · `orbit-wordmark.svg` 1,472 B ·
`orbit-wordmark-white.svg` 1,472 B). Referenced by nothing in `app/`, `components/` or `lib/`
since 2026-09-10; they carry the **older hand-built letterforms** (viewBox `0 -22 2216 771`)
whose O read as a zero. Do not put them in a deck.

**The icon artwork, as SVG source** (`public/icon-source.svg`) — a five-stop radial violet tile
with the outlined wordmark in white at 62% of the tile:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="orbit-tile" cx="0.14" cy="0.06" r="1.25">
      <stop offset="0" stop-color="#8460EF"/>
      <stop offset="0.18" stop-color="#7F55EB"/>
      <stop offset="0.36" stop-color="#7C3AED"/>
      <stop offset="0.68" stop-color="#6428C4"/>
      <stop offset="1" stop-color="#4C1D95"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#orbit-tile)"/>
  <g transform="translate(106 206.19) scale(0.129534)">
    <path fill="#FFFFFF" fill-rule="nonzero" d="…the Orbit wordmark path, identical to the block below…"/>
  </g>
</svg>
```

**The wordmark path** (`components/shared/orbit-wordmark.tsx` and `public/orbit-wordmark.svg`,
byte-identical `d`; `fill="currentColor"`, `viewBox="0 0 2316 769"`, aspect 3.0117):

```svg
<path fill-rule="nonzero" d="M389 769L389 769Q306 769 235.5 740Q165 711 112 659Q59 607 29.5 537Q0 467 0 384L0 384Q0 301 29 231Q58 161 111 109Q164 57 235 28.5Q306 0 389 0L389 0Q472 0 543 29Q614 58 667 109.5Q720 161 749.5 231Q779 301 779 384L779 384Q779 467 749 537Q719 607 666 659Q613 711 542.5 740Q472 769 389 769M389 645L389 645Q462 645 519 611Q576 577 609 518Q642 459 642 384L642 384Q642 309 609 250Q576 191 519 157.5Q462 124 389 124L389 124Q316 124 259 157.5Q202 191 169 250Q136 309 136 384L136 384Q136 459 169 518Q202 577 259.5 611Q317 645 389 645M974 757L843 757L843 213L966 213L966 289Q987 244 1025 225.5Q1063 207 1113 207L1113 207L1145 207L1145 323L1098 323Q1043 323 1008.5 357.5Q974 392 974 454L974 454L974 757M1468 769L1468 769Q1415 769 1369.5 750.5Q1324 732 1294 696L1294 696L1294 757L1171 757L1171 0L1302 0L1302 268Q1331 236 1373.5 218.5Q1416 201 1469 201L1469 201Q1546 201 1608 239Q1670 277 1706.5 341Q1743 405 1743 485L1743 485Q1743 565 1707 629.5Q1671 694 1609 731.5Q1547 769 1468 769M1453 649L1453 649Q1498 649 1532.5 628Q1567 607 1587 570Q1607 533 1607 485L1607 485Q1607 438 1587 401Q1567 364 1532.5 342.5Q1498 321 1453 321L1453 321Q1409 321 1375 342.5Q1341 364 1321.5 401Q1302 438 1302 485L1302 485Q1302 533 1321.5 570Q1341 607 1375 628Q1409 649 1453 649M1928 152L1797 152L1797 12L1928 12L1928 152M1928 757L1797 757L1797 213L1928 213L1928 757M2251 763L2251 763Q2159 763 2108.5 712.5Q2058 662 2058 570L2058 570L2058 330L1964 330L1964 213L1974 213Q2014 213 2036 192Q2058 171 2058 131L2058 131L2058 89L2189 89L2189 213L2314 213L2314 330L2189 330L2189 563Q2189 604 2211 626Q2233 648 2281 648L2281 648Q2296 648 2316 645L2316 645L2316 757Q2302 759 2284 761Q2266 763 2251 763"/>
```

### C.4 — The icon files, inlined as base64

Two of the three are at or under 60 KB and are inlined below. **`public/icon-512.png` is
92,860 B and is deliberately NOT inlined** — use the file itself.

**`public/apple-touch-icon.png`** — 180x180, 21,922 bytes, `image/png`

```
data:image/png;base64,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
```

**`public/icon-192.png`** — 192x192, 24,213 bytes, `image/png`

```
data:image/png;base64,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
```

**`public/icon-512.png`** — 512x512, 92,860 bytes, `image/png` — over the 60 KB rule, not inlined.

---

## D. The catalogue

### D.1 — What feeds the page

**One request, once per load:** `fetch("/api/order/data", { cache: "no-store" })`
(`po-v2-page.tsx`, `fetchData`). There is no other network call anywhere in `app/po2/` — no
POST, no save, no lookup. Sending is a `mailto:`.

`app/api/order/data/route.ts` reads **three tables** with sequential awaits (no
`prisma.$transaction`):

| Table | Filter | Used for |
|---|---|---|
| `mo_customer_keywords` | none; `orderBy customerName asc` | the dealer list — deduped to one entry per `customerCode`, carrying the first non-null `area` |
| `mo_order_form_index_v2` | `isActive = true`; `orderBy family asc, sortOrder asc` | the menu rows (one row per product × option) |
| `mo_sku_lookup_v2` | `isPrimary = true` | the pack list, keyed `product` and `product\|\|\|baseColour` |

Pack de-duplication is on the **rendered** label (`formatPack`), so a litre pack stored as both
`L` and `LT` cannot double a column. Packs are sorted by millilitre magnitude with KG anchored
last.

**Exact payload shape** (`ApiPayload` in `v2-data.ts`, mirroring the route field for field):

```ts
{
  customers: [ { name: string; code: string; area: string | null } ],
  products: [ {
    id:           number,
    family:       string,        // "GLOSS", "PROMISE", "WS", "AQUATECH", …
    section:      string,        // UTILITY | INTERIORS | EXTERIORS | ENAMELS | WOODCARE | MULTI-USE | PROMISE
    subgroup:     string,
    subProduct:   string,        // NOT NULL
    product:      string | null, // SAP-clean stock name; NULLABLE
    uiGroup:      string | null,
    baseColour:   string | null, // ALSO sometimes "" — see the blank-option rule below
    displayName:  string,
    searchTokens: string,
    tinterType:   string | null,
    productType:  string,
    sortOrder:    number,
    region:       string | null,
    packs: [ { packCode: string; unit: string | null; material: string } ]
  } ]
}
```

Two rules the page depends on, both stated in `v2-data.ts`:

- **The join key is `COALESCE(product, subProduct)`, never `product`.** `product` is nullable and
  many live rows carry NULL — Gloss itself, all four primers, all four Aquatech, the Wood/Sadolin
  rows and Thinner among them. Joining on `product` alone opens those tiles empty.
- **A blank `baseColour` is the absence of a colour, not a colour.** Both `null` and `""` map to
  the sentinel `" NULL"`. Before that rule existed, `""` became a selectable option whose value
  was the empty string and 37 products were impossible to order while the screen looked normal.

**Repo snapshots of the two catalogue tables** (what the examples below were read from — not the
live DB): `docs/SKU/mo_order_form_index_v2_rows.csv` (478 data rows) and
`docs/SKU/mo_sku_lookup_v2_rows.csv` (1,708 data rows, ~1,381 with `isPrimary = true`). Both are
untracked exports sitting in the working tree; the index export is dated 2026-08-10.

### D.2 — The board's own shape (what the page renders on top of that payload)

`BOARD` in `v2-data.ts`: **9 families, 37 tiles, 98 members.** A tile may hold several products
(members); a one-product tile is simply a one-member tile.

| Family | Tint | Tiles |
|---|---|---|
| Enamel | `#F8F0E0` | Gloss · Super Satin · Promise Enamel · More Enamels |
| Interior | `#E8EFFA` | Stay Bright · Supercover · SuperClean · Spray Paint |
| VT | `#EDEBF5` | Pearl Glo · Platinum Glo · Eterna · Luxury Finish |
| Promise | `#FBECEF` | Smart Choice · Promise · Promise Primer · Promise Sheen |
| Exterior | `#EAF4E8` | Protect Dustproof · Protect Hi-Sheen · Max · More Exterior |
| Primer | `#E3F1F8` | Cement SB · Zinc Yellow · Red Oxide · Primers |
| Stainer | `#F6E8C8` | Universal Stainer · Machine Tinter · Acotone · GVA |
| Aquatech | `#E0F1EA` | Damp Protect · Roof Coat · Other Coat · Crack Filler and Additives |
| Wood | `#EFE6DA` | PU Prime · 2K PU · Luxurio · Hydro PU · Thinner & More |

A tile's `key` is a **frozen historical string** — it is not derived from the first member, and
changing one deletes somebody's stored favourite.

Curation (`CURATION`, 32 entries) holds each product's bases and shades **in 90-day order
frequency**, plus which tab the drawer opens on. Anything the catalogue has that the curation
does not name is appended after it in the depot's own `sortOrder`, so the rail is always the
complete list.

### D.3 — Real example products, four+ families

Read out of `docs/SKU/mo_order_form_index_v2_rows.csv` and
`docs/SKU/mo_sku_lookup_v2_rows.csv`. "Packs that render" is the payload's own sort order
(millilitres ascending, KG last); "step" is what one tap of `+` moves, from `packStep()`.

| # | Board family | Board tile | Product (`sap`) | Base / variant | Display name | Packs that render, in order | Step per pack |
|---|---|---|---|---|---|---|---|
| 1 | Enamel | Gloss | `GLOSS` (product NULL → joins on subProduct) | `90 BASE` | Gloss | 500ML · 1L · 4L · 10L · 20L | 12 · 6 · 4 · 1 · 1 |
| 2 | Enamel | Promise Enamel | `PROMISE ENAMEL` | `CLASSIC WHITE` | Promise Enamel | 500ML · 1L · 4L · 10L · 20L | 12 · 6 · 4 · 1 · 1 |
| 3 | Enamel | Super Satin | `SUPER SATIN` | `90 BASE` | Satin Finish | 500ML · 1L · 4L · 10L · 20L | 12 · 6 · 4 · 1 · 1 |
| 4 | Interior | Supercover | `SUPERCOVER` | `94 BASE` | SuperCover | 250ML · 1L · 4L · 10L · 20L | **1** · 6 · 4 · 1 · 1 |
| 5 | Exterior | Max | `WS MAX` | `92 BASE` | WS Max | 1L · 4L · 10L · 20L | 6 · 4 · 1 · 1 |
| 6 | Primer | Cement SB | `CEMENT PRIMER SB` (product NULL) | *(no options)* | Cement Primer SB | 1L · 4L · 10L · 20L | 6 · 4 · 1 · 1 |
| 7 | Aquatech | Damp Protect | `DAMP PROTECT 2IN1` (product NULL) | *(no options)* | Damp Protect 2in1 | 1L · 4L · 10L · 20L | 6 · 4 · 1 · 1 |
| 8 | Aquatech | Crack Filler and Additives | `CRACKFILLER 5MM` (product NULL) | *(no options)* | Crackfiller 5mm | 400GM · 1KG | **12 · 6** (product override) |
| 9 | Stainer | Universal Stainer | `UNIVERSAL STAINER` | `FAST RED` | Universal | 50ML · 100ML · 200ML | **20 · 20 · 10** (product override) |
| 10 | Wood | PU Prime | `PU PRIME MATT` (product NULL) | `90 Base` *(title case — real)* | PU Prime Matt - 90 Base | 1L · 4L · 20L | 6 · 4 · 1 |
| 11 | Promise | Smart Choice | `PROMISE SMARTCHOICE` | `Acrylic Distemper` | Promise SmartChoice | 5KG · 10KG · 20KG | 1 · 1 · 1 |
| 12 | Aquatech | Roof Coat | `ROOF COAT WHITE` (product NULL) | *(no options)* | Roof Coat White | 1L · 4L · 10L · 20L | 6 · 4 · 1 · 1 |

Notes a demo should not trip over:

- **`Acrylic Distemper` is the only KG ladder here, and its order is fixed in `/po2`, not in the
  API.** The payload's comparator returns 0 for every KG pack, so KG products arrive in database
  insertion order (10KG, 20KG, 5KG). `sortedPacks()` re-sorts them through `lib/place-order/pack`'s
  KG branch. Six of 347 multi-pack rows are affected, all KG.
- **Wood/Sadolin stores its bases in title case** — `"90 Base"`, not `"90 BASE"`. Curation matches
  literally, including case, and that difference is real.
- **`250ML` is not in `PACK_STEP_MAP`**, so Supercover's 250ML steps by 1 and shows no "per N"
  hint. UNVERIFIED — whether the depot really sells 250ML loose; only the depot's carton table
  would settle it.
- **`WS MAX` 1L carries `piecesPerCarton = 9` in `mo_sku_lookup_v2`** but the app steps it by 6
  (the global 1L value), because there is no product override for it. UNVERIFIED — whether 9 or 6
  is the depot's real WS Max carton; only the depot can settle it.
- `CRACKFILLER 5MM` also has one `mo_sku_lookup_v2` row with an **empty `packCode`**, which the
  route skips (`if (!r.product || !r.packCode) continue`).

### D.4 — The pack maps, in full, as they exist in code today

`lib/place-order/pack.ts` — the ONE owner. `/po2` delegates to it via
`stepForLabel(label, productKey)` → `packStep(packLabel, productKey)`.

**Global carton step (`PACK_STEP_MAP`)** — units moved by one tap:

```
50ML   12      1L     6       10L    1       40KG   1
100ML  24      4L     4       20L    1       25KG   1
200ML  12                     30L    1       30KG   1
500ML  12                                    5KG    1
1 pc   1
```

Anything not listed falls back to **1**.

**Product-scoped overrides (`PRODUCT_CARTON_OVERRIDES`)** — checked BEFORE the global map, keyed
on `COALESCE(product, subProduct)`:

```
UNIVERSAL STAINER   50ML 20 · 100ML 20 · 200ML 10
MACHINE TINTER      1L 1
ACOTONE             1L 1
GVA                 1L 1
CRACKFILLER 5MM     1KG 6  · 400GM 12
CRACKFILLER 10MM    1KG 4  · 500GM 12
CRACKFILLER 20MM    1KG 4
```

An override of exactly **1** is the signal that the product is sold **loose** — the "per N" hint
and the container label are both suppressed.

**Piece step (`PIECE_BOX_STEP`)** — tools, reached only by `packStepForPack(packCode, unit, …)`:

```
25PC  25   (rollers)     12PC  12   (brushes)     500PC  500  (stickers)
```

⚠ `/po2` cannot reach this table: `formatPack` collapses every PC pack to the single label
`"1 pc"`, and the drawer steps by label. 31 live products (9 brushes, 21 rollers, 1 stickers row)
therefore step by **1** in `/po2`. All 31 are search-only; none is on the board. Owner-deferred
2026-09-09 and recorded on `docs/ROADMAP.md`.

**Container labels (`PACK_CONTAINER_MAP`)** — display text only, deliberately decoupled from the
step:

```
50ML  "box 12"    1L   "box 6"    10L  "drum"    40KG  "bag"    25PC  "box of 25"
100ML "box 24"    4L   "box 4"    20L  "drum"    25KG  "bag"    12PC  "box of 12"
200ML "box 12"                    30L  "drum"    30KG  "bag"    500PC "pack of 500"
500ML "box 12"                                                  400ML "can"
```

⚠ `/po2` does **not** render container labels. It shows **`per {step}`** under the pack label,
and only when the step is greater than 1.

**Pack label rendering (`formatPack`, copied verbatim into `v2-data.ts`)**:

```
unit KG  →  "{packCode}KG"        packCode 400 + ML → "400 ml"
unit GM  →  "{packCode}GM"        num >= 50         → "{num}ML"
unit PC  →  "1 pc"                num <  1          → "{num*1000}ML"
                                  otherwise         → "{num}L"
```

**The drawer's shape is decided once**, by `drawerMode(rows)`:

```
1 option              → "single"    no picker, straight to packs
2+ options, 1 pack    → "flat"      every option listed, a stepper on each
2+ options, 2+ packs  → "standard"  pick an option, then its packs
```

Measured live on 2026-09-07: **9 single, 4 flat, 19 standard**.

**Shade swatches.** `SHADE_HEX` maps roughly sixty exact `baseColour` strings to a hex,
hand-authored from **dulux.in's own per-shade pages**, with thirteen values sampled from the
printed Dulux enamel shade card on 2026-09-10. A name that is not in the table gets **no swatch
and a text tile** — never a guess, never a nearest match. Acotone and Machine Tinter colorant
codes (`NO1`, `YOX`, …) are permanently unmapped, and so are `Clear` / `Int Clear` / `Ext Clear`,
which are transparent products.

### D.5 — How a customer is searched, and what a row shows

`searchCustomers()` in `v2-data.ts` — written for `/po2`, not shared:

1. **code PREFIX** match, then
2. **name CONTAINS** match, then
3. **code SUBSTRING** match.

Case-insensitive, each tier sorted alphabetically by name, the whole list capped at **30**
(`SEARCH_CAP`). The tiers matter: as a flat rule, typing "24" matches every six-digit code with a
24 anywhere in it and floods the top.

With an empty query the screen shows **only the starred dealers, A–Z** — there is no
browse-everything list, by design. Typing reaches the full master, which is what makes a ship-to
to a third party possible.

A customer row (`CustomerRow`, `customer-list.tsx`) shows exactly:

- the **name**, 14px, not bold, `#1B1826`, truncated
- **`{code} · {area}`** on one mono 12px line in `#74718A` (the separator and area are dropped
  when the dealer has no area)
- a **star**, in its own 44px target, amber `#F59E0B` when set
- a **chevron** — or a violet **tick** when this is the dealer already on the order, and the whole
  row is washed `#F5F1FE`

There is no monogram/initials square: it was removed everywhere.

---

## E. The order options

Five order-level fields, one set per order (there is no multi-bill in `/po2`). The unions are
`V2Order` in `v2-data.ts`; the defaults are `EMPTY_ORDER`, chosen so that a plain order emits no
`Dispatch:` and no `Remark:` line at all.

```ts
type V2Dispatch   = "Normal" | "Urgent" | "Call";
type V2CallTarget = "SO" | "Dealer";
type V2Marker     = "Truck" | "Cross Delivery" | "Bounce" | "DTS" | null;
type V2Order = { dispatch; callTarget; marker; crossDepot: string; notes: string };
const EMPTY_ORDER = { dispatch: "Normal", callTarget: "SO", marker: null, crossDepot: "", notes: "" };
```

### Dispatch — three chips, two stored fields

| Chip label | Dot | Stored | Email line |
|---|---|---|---|
| `Normal` | `#B9B6C6` grey | `dispatch: "Normal", callTarget: "SO"` | **omitted entirely** |
| `Urgent` | `#F59E0B` amber | `dispatch: "Urgent", callTarget: "SO"` | `Dispatch: Urgent` |
| `Call · SO` | `#EF4444` red | `dispatch: "Call", callTarget: "SO"` | `Dispatch: Call to SO` |
| `Call · Dealer` | `#EF4444` red | `dispatch: "Call", callTarget: "Dealer"` | `Dispatch: Call to Dealer` |

The Call chip opens a sheet (`Call to?` → `SO` / `Dealer`) and commits **only on a pick**, so a
"Call" with nobody to call cannot be stored. Leaving Call resets `callTarget` to `"SO"`.

There is **no Hold option** — `V2Dispatch` has three members.

### Remark — four chips, single-select, re-tap clears

| Chip | Stored `marker` | Body line | Subject prefix |
|---|---|---|---|
| `Truck` | `"Truck"` | `Remark: Truck order` | `Truck Order` |
| `Cross` | `"Cross Delivery"` | `Remark: Cross billing from {depot}` | `Cross Billing Order From {depot}` |
| `Bounce` | `"Bounce"` | `Remark: Bounce order` | `Bounce Order` |
| `DTS` | `"DTS"` | `Remark: DTS order` | `DTS Order` |
| *(none)* | `null` | omitted | `Order` |

Choosing **Cross** opens `Cross billing from?` first and writes nothing until a depot is chosen.
Choosing anything else — including tapping Cross to turn it **off** — clears `crossDepot`, so a
depot cannot be left behind on a non-Cross order.

`CROSS_DEPOTS = ["Dahisar", "Ahmedabad", "Rajkot", "Pune"]`. The list is **what the sheet offers,
never a whitelist**: `crossDepot` stays a free string, and a draft saved before the picker
existed holds a hand-typed depot which renders and emails exactly as typed.

### Notes

Free text, placeholder `Notes · optional`, three rows, no presets and no length cap. Emitted as
`Note: {notes.trim()}`; omitted when blank. It is the only value the salesman types rather than
chooses, and the only detail-card row allowed to grow (clamped at two lines there).

### Ship-to

Modelled as a **customer or null**, not free text. `null` means "same as billing" and the email
line is omitted. When set to a different dealer, the line is `Ship To: {name} ({code})`.

`snapshotOf()` stores `shipToCode` **only when it differs from the billing dealer**, so a
non-null stored code already means "somewhere else" — there is no second comparison anywhere and
no way for the two to disagree. On load the code is re-resolved against the freshly fetched
dealer list; a dealer removed since then prints as the bare code rather than inventing a name.

### Multi-bill

**Absent by design.** `v2-email.ts` builds exactly one bill with `label: null`, and
`renderOrderBody` prints a `Bill N` header only when there are two or more — so a `/po2` order
emits the blank line and the numbered items and nothing else. `review-screen.tsx` says so at the
top of the file: "SINGLE BILL. No 'Bill 1', no Add bill, no multi."

---

## F. The email — exact current output

### F.1 — The builder

`app/po2/v2-email.ts` (110 lines). It **imports** the wire format read-only from
`lib/place-order/email.ts` — `ORDER_TO`, `buildSubject`, `emailLineLabel`, `renderOrderBody` —
and reimplements none of it: not the `" - "` separator, not the U+2007 figure-space serial
padding, not `emailCase`'s KEEP_CAPS_3 rules.

```
buildV2Email({ dealer, shipTo, lines, order }) → { subject, body, valid }
buildV2MailtoUrl(subject, body)                → the mailto: URL
```

`valid` is `!!dealer && itemLines.length > 0`. `handleSend()` returns without sending when it is
false, and with no dealer it opens the dealer picker instead.

### F.2 — Recipients

```ts
export const ORDER_TO = "surat.depot@akzonobel.com";
```

**To:** `surat.depot@akzonobel.com`
**CC:** *none.* `buildV2MailtoUrl` builds the URL inline and deliberately does **not** use
`buildMailtoUrl()`, which appends `cc=surat.order@outlook.com` and is the desktop send path only.

```ts
`mailto:${ORDER_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
```

### F.3 — The subject line rule, in full

`buildSubject(customer, marker, crossDepot)`:

```
tail   = (name ? " — " + name : "") + (code ? " " + code : "")     // an em dash, U+2014
prefix = "Truck Order"                       when marker = "Truck"
       | "Bounce Order"                      when marker = "Bounce"
       | "DTS Order"                         when marker = "DTS"
       | "Cross Billing Order From {depot}"  when marker = "Cross Delivery" and a depot is stored
       | "Cross Billing Order"               when marker = "Cross Delivery" and none is
       | "Order"                             when marker is null
subject = prefix + tail
```

Every case, with a dealer named Ambika Paints / 447636:

| marker | crossDepot | subject |
|---|---|---|
| null | — | `Order — Ambika Paints 447636` |
| `Truck` | — | `Truck Order — Ambika Paints 447636` |
| `Bounce` | — | `Bounce Order — Ambika Paints 447636` |
| `DTS` | — | `DTS Order — Ambika Paints 447636` |
| `Cross Delivery` | `Dahisar` | `Cross Billing Order From Dahisar — Ambika Paints 447636` |
| `Cross Delivery` | *(empty)* | `Cross Billing Order — Ambika Paints 447636` |

No date, by design. Dispatch does **not** reach the subject.

### F.4 — The body template

`renderOrderBody()` — plain text, no HTML, no bold. Header lines render **only when they carry a
value**, in this locked order:

```
Bill To: {name} ({code})
Ship To: {name} ({code})        ← only when shipping somewhere other than the billing dealer
Dispatch: Urgent | Call to SO | Call to Dealer    ← omitted on Normal
Remark: Truck order | Cross billing from {depot} | Bounce order | DTS order
Note: {notes}
                                ← ALWAYS one blank line before the items
 1. {Product Name} - {pack}*{qty}, {pack}*{qty}
 2. …
```

Per-line format:

- serial, then `". "`, then the product name, then **`" - "`** (space-hyphen-space), then the
  pack string.
- **Serial padding:** right-aligned with **U+2007 FIGURE SPACE**, width = the digit count of that
  bill's line total. So an order of 3 lines pads to width 1 (no padding at all) and an order of
  12 lines renders the single-digit serials with one leading figure space so the names line up.
- **Pack string:** `{label}*{qty}` joined by `", "` — an **asterisk**, not the `×` the review
  screen displays. Packs appear in **catalogue order** (`packOrder`, snapshotted at add time by
  `sortedPacks`), never in the order the salesman tapped, and zero quantities are dropped.
- **Product name** comes from `emailLineLabel(product, baseColour, subProduct)` off the **menu
  row** — never from the board's curated tile label — then through `emailCase()`:
  - `PROMISE PRIMER` + a base is a scoped special case, printing the variant name alone.
  - When `baseColour` already contains the product name, the base is printed alone (which avoids
    "ACRYLIC DISTEMPER DUWEL ACRYLIC DISTEMPER").
  - Otherwise `{product ?? subProduct} {baseColour}`, or just the name when there is no colour.
  - `emailCase` title-cases each alphanumeric token but keeps it UPPERCASE when it contains a
    digit (`5IN1`, `M900`, `2K`, `10MM`), when it has two or fewer letters (`WS`, `VT`, `PU`,
    `SB`), or when it is one of
    `GVA FBC IBC WBC FFR GRN LFY MAG OXR TBL YOX NCR VAF WRP`.

### F.5 — One complete worked example

Three lines, using real products and real packs from section D. Dealer name and code are the
worked example from `lib/place-order/email.ts`'s own docblock (no customer rows live in the
repo). Dispatch = **Call · Dealer**, no remark, one note, ship-to left as "same as billing".

**Subject**

```
Order — Ambika Paints 447636
```

**Body**

```
Bill To: Ambika Paints (447636)
Dispatch: Call to Dealer
Note: Pls send shade card

1. Gloss 90 Base - 1L*12, 4L*8
2. Promise Enamel Classic White - 500ML*24
3. Cement Primer SB - 20L*2
```

Derivation of each line, so it can be checked:

| Cart line | `emailLineLabel(product, baseColour, subProduct)` | after `emailCase` | pack string |
|---|---|---|---|
| Gloss, 90 BASE, 12 × 1L + 8 × 4L | `(null, "90 BASE", "GLOSS")` → `GLOSS 90 BASE` | `Gloss 90 Base` | `1L*12, 4L*8` |
| Promise Enamel, CLASSIC WHITE, 24 × 500ML | `("PROMISE ENAMEL", "CLASSIC WHITE", "PROMISE ENAMEL")` → `PROMISE ENAMEL CLASSIC WHITE` | `Promise Enamel Classic White` | `500ML*24` |
| Cement Primer SB, no option, 2 × 20L | `(null, "", "CEMENT PRIMER SB")` → `CEMENT PRIMER SB` | `Cement Primer SB` | `20L*2` |

**The URL the phone actually opens**

```
mailto:surat.depot@akzonobel.com?subject=Order%20%E2%80%94%20Ambika%20Paints%20447636&body=Bill%20To%3A%20Ambika%20Paints%20(447636)%0ADispatch%3A%20Call%20to%20Dealer%0ANote%3A%20Pls%20send%20shade%20card%0A%0A1.%20Gloss%2090%20Base%20-%201L*12%2C%204L*8%0A2.%20Promise%20Enamel%20Classic%20White%20-%20500ML*24%0A3.%20Cement%20Primer%20SB%20-%2020L*2
```

**Order of operations on Send** (`handleSend`): the mailto fires **first**, inside the tap
gesture, before any state changes — a synchronous navigation in the same tick cancels the
external handoff. The sent order is logged to `po2_sent_orders` immediately after, and the cart
is cleared only then, so backing out of the mail app without sending does not lose the order.

**Regression guard:** `scripts/po-v2-email-fixtures.ts` holds committed email fixtures. Per
`docs/ROADMAP.md`, run it before any commit that touches the send path.

---

## G. What happens next

The phone hands the message to its own mail app and the salesman presses send; it arrives at
`surat.depot@akzonobel.com`, the depot's AkzoNobel inbox, and reaches the mailbox the Mail Orders
pipeline watches. A PowerShell parser reads the body — this is its app-format branch, which is
why the header order, the `" - "` separator and the `{pack}*{qty}` spelling are fixed contracts
and not styling — and posts the parsed order to `app/api/mail-orders/ingest/route.ts` under an
HMAC signature. That route enriches each line against the catalogue (`lib/mail-orders/enrich.ts`),
matches the dealer (`lib/mail-orders/customer-match.ts`, `lib/mail-orders/delivery-match.ts`) and
writes the `mo_*` tables, so the order appears on the Billing team's `/mail-orders` screen
(`app/(mail-orders)/mail-orders/`) as a reviewable record with its lines already resolved to
SKUs. From there it is punched to SAP, imported back as a bill (`app/api/import/obd/route.ts`),
and worked on the depot floor — `/floor`, `/picking`, `/trips`. The salesman's phone writes
nothing to the database at any point: the email **is** the handoff, and the loop closes when the
bill he caused shows up on the floor board.

*(The mail-forwarding hop between the two inboxes is documented in `docs/CLAUDE_PLACE_ORDER.md`
§1/§13 and is UNVERIFIED from code — mail routing does not live in this repo. Everything from the
ingest route onward was read in the tree.)*

---

## H. Doc-vs-code drift

Every item below is a `docs/` claim that the code contradicts. **Nothing was fixed.**

| # | Doc file | The stale claim | What the code actually does |
|---|---|---|---|
| H1 | `docs/CLAUDE_PLACE_ORDER.md` v1.8, header + §1 + §25 | The module's routes are `/place-order`, `/po` and the retired `/order`. `/po` is "the **going-forward** depot mobile PO page". **`/po2` is not mentioned anywhere in the file.** | `/po2` has been live since 2026-09-10 (`145b5f32`) and is the v2 order page. The canonical Place Order file has no section for it; the only written record is `docs/prompts/drafts/code-update-2026-09-08-po-v2-board.md` plus the ROADMAP block. |
| H2 | `docs/CLAUDE_PLACE_ORDER.md` §25 | "All work in **`app/po/po-page.tsx`** (single file)." | v2 is thirteen files under `app/po2/`, and `app/po/po-page.tsx` is a different page. |
| H3 | `docs/CLAUDE_PLACE_ORDER.md` §25 → "Review & options" | Remarks are a **2×2** grid; Dispatch is chips with Call last; Notes carry **Quick-add presets**. | `/po2` renders Remark as **one row of four equal chips** and Dispatch as **three** equal chips; its Notes field has **no presets**. |
| H4 | `docs/CLAUDE_PLACE_ORDER.md` §16 / §17 | The API-endpoint list and files map describe `/api/order/data` as serving `/po` (and its sibling serving `/place-order`). | It also serves `/po2` — and `/po2` calls **no other endpoint at all**. |
| H5 | `docs/CLAUDE_UI.md` v5.29 §1 | "**Teal is the brand.** `teal-600` (#0d9488) is the single brand accent." | The brand is violet. `tailwind.config.ts` ships a `brand` ramp anchored on `#7C3AED`; the login page, every mobile masthead and all of `/po2` are violet. Teal survives only as `data.teal` — the IGT **delivery type** identity. |
| H6 | `docs/CLAUDE_UI.md` §2, "Teal brand system" table and "Logo mark — Orbit symbol" | Brand `teal-600`; focus ring `focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10`; sidebar logo `bg-teal-600`; the logo is **three circles** in a 22×22 viewBox. | The logo is the outlined **Orbit wordmark**, viewBox `0 0 2316 769`, generated from Plus Jakarta Sans (`components/shared/orbit-wordmark.tsx`, `scripts/generate-wordmark.mjs`). There is no ring anywhere. `/po2`'s focus treatment is `#8B5CF6` plus `rgba(124,58,237,.13)`. |
| H7 | `docs/CLAUDE_UI.md` §3, Semantic table, `Urgent` row | `Urgent` = `bg-red-50 / border-red-200 / text-red-600`. | `/po2` ships Urgent in **amber** — `#B45309` on `#FFFBEB` — and reserves red for destructive only. The doc flags this itself as a migration list for three other components, so the row is knowingly stale rather than wrong by accident. |
| H8 | `docs/CLAUDE_UI.md` §59.8 | "`public/po.webmanifest`'s … `background_color` stays `#7C3AED` because that is the launch splash, which is still violet." | True of the other manifest, **not** of `/po2`: `app/po2/manifest.webmanifest/route.ts` sets `background_color: "#FFFFFF"`, because v2's splash is white with a violet mark. |
| H9 | `docs/ROADMAP.md`, `/po2` P2 "Ten board tiles still have no tin photograph" | Lists **More Interior, VT Specialty, Acotone, Uni Stainer, Machine Tinter, GVA, Coats & Additives, Luxurio, Hydro PU, Thinner & More** as artless (as of 2026-09-09). | Six of those ten now resolve art: `vt-specialty`, `acotone`, `uni-stainer`, `machine-tinter`, `coats-additives` and `luxurio` are all declared in `TILE_IMAGES`. **More Interior no longer exists** — the tile was removed on 2026-09-10 and Spray Paint took its slot. Still artless today: **GVA · Hydro PU · Thinner & More** (the last deliberately — its file is on disk but undeclared, because the photograph is of the wrong product). |
| H10 | `docs/ROADMAP.md`, `/po2` P2 "Fav block on the board — BLOCKED on the storage decision" | Describes the favourites block as not yet built and blocked until the storage model is settled. | It shipped (`a988ab41`, `f4c0444c`, `bc2cad7c`, `b54ae21c`) against `localStorage`, which is exactly what the item warned against. The block, the gear and the 8-slot cap are all live; the storage decision is still open. |
| H11 | `docs/ROADMAP.md`, `/po2` P2 "Three stale comments left over from `23a4a502`" | Lists three in-code comments as still wrong, including `po-v2-page.tsx` "all 36" and "the 9x4 board". | Two of the three are fixed in the code: the `BOARD` section header in `v2-data.ts` no longer claims BOARD is unconsumed, and the "Step 4" notes now record that both `addLines` call sites pass `memberSap: null`. The "9x4 board" wording near the top of `po-v2-page.tsx` is still there. Board reality: **9 families, 37 tiles, 98 members**, Wood holding five. |
| H12 | `docs/ROADMAP.md`, `/po2` P3 "Rename the `URGENT` token to `DANGER`" | Says the token survives at exactly four places, all destructive. | Still true and still unrenamed. Recorded so nobody re-diagnoses it; not a defect. |
| H13 | `CLAUDE.md` (repo-root router) §3 | The `/place-order`, `/po` row points at `docs/CLAUDE_PLACE_ORDER.md`; there is **no row for `/po2`**. | `/po2` has no domain file and no router row, so a session told to work on the v2 order page is routed to a file describing v1. |

Not drift, recorded because a reader could mistake it for drift: `docs/CLAUDE_UI.md` §59.8
explicitly names `app/po2/` as the **reference implementation** of the pale masthead, and rules
that the wordmark is `brand.600` and not the colour spec's `brand.800`. The code and that section
agree.

---

## I. What a presentation should not show

1. **🔴 `/po-v2-8f4kd2` — the obfuscated soft-launch address. Never put it on a screen, in a URL
   bar, in a screenshot or in a deck.** It is what it looks like: a deliberately unguessable
   address used to run v2 in front of real users before launch, on a page that has no login.
   **Confirmed: `app/po-v2-8f4kd2/page.tsx` is a redirect and nothing else** — 33 lines, no
   component, no client bundle, `export default function Page(): never { redirect("/po2"); }`, a
   permanent server redirect kept only so an old bookmark or an installed shortcut keeps working
   through the switchover. Removing it is a P3 on `docs/ROADMAP.md`. Showing it tells a client
   that the security model for a public order page was an unguessable string.

2. **🔴 `/api/order/data` is an unauthenticated full-catalogue dump, and it is P0 on the
   roadmap.** Any request to it — no session, no token, no rate limit, no origin check — returns
   **every customer name, code and area the depot holds** plus the full active catalogue and pack
   list. `app/po2/page.tsx` says so in its own header comment. Do not demo the endpoint, do not
   show a network tab, and do not describe the page as "secure". If asked directly, the honest
   answer is that the page is deliberately public for salesmen and that gating the catalogue is
   scheduled work.

3. **The page is public with no login.** That is a design decision, but a client may read it as an
   oversight. Frame it deliberately or not at all — and be aware it means anyone with the URL can
   place an order in a dealer's name.

4. **All data lives in one phone's `localStorage`.** Drafts, sent orders, starred dealers,
   favourite products — nothing is shared between devices, nothing survives a cleared browser or
   a new handset, and nothing is visible to anyone but that phone. The storage model is an **open
   P1 decision** on the roadmap. Do not promise sync, history or multi-device.

5. **Sent orders age out after five IST days** (`SENT_RETAIN_DAYS = 5`) and saved drafts are
   capped at 20 per phone. "Sent" also only means *handed to the mail app* — the page cannot know
   the mail left, and its confirmation screen is careful not to claim it. Do not present the Sent
   tab as an order history.

6. **Three tiles still show no product photograph** — GVA, Hydro PU and "Thinner & More". They
   render as a plain family wash. If the board is shown, favour a fully photographed family
   (Enamel, Promise or Exterior).

7. **Tools step by 1 where the depot ships them by 25 / 12 / 500** (31 live products — rollers,
   brushes, stickers). Search-only, none on the board, owner-deferred — but do not put a tools
   order on screen.

8. **`FASTYELLOWGREEN`** — a catalogue data defect (a Universal Stainer option missing its
   spaces, `mo_order_form_index_v2` row 21700). It is the widest string in the tile set and
   breaks mid-word in the rail on purpose. Do not open Universal Stainer in a demo.

9. **The `Cement SB` tile is fed by a file named `cement-wb`.** WB is water-based and SB is
   solvent-based, and the board holds them as two different products, so that tile may be showing
   a photograph of a different product. Recorded in `v2-data.ts` as the owner's explicit
   placement, made twice. Do not zoom in on it.

10. **Developer-facing surfaces that must not appear in the same deck:** the `console.warn`
    catalogue and board gates (`[po-v2] catalog gate`, `[po-v2] board gate`), the
    `BOARD_INVARIANTS` build-time throw text, and the `assertOwnRows` error message.

11. **Wording to avoid in a client deck:** "v2", "pilot", "test address", "hidden", "not yet
    gated". The app's own name everywhere the user sees it is simply **Orbit** — the manifest, the
    home-screen title and the splash all say exactly that, deliberately, so nobody ever has to
    reinstall to lose a version number.

12. **Assets that must not be used:** anything under `public/brand/`. Those five files carry the
    superseded hand-built letterforms whose O reads as a zero; they are referenced by nothing and
    are the wrong drawing. Use `public/icon-192.png`, `public/icon-512.png`,
    `public/apple-touch-icon.png` and the wordmark path in section C.

---

*Read-only discovery. No code, docs, database or configuration was changed; nothing was
committed. Source of truth throughout: the working tree at `main` / `e2afa43f`, 2026-09-12.*
