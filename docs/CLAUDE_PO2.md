# CLAUDE_PO2.md — /po2 and /po9 (public order page, v2)
# v1.0 · Schema v27.24 · September 2026 · updated 2026-09-18 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md + docs/CLAUDE_PLACE_ORDER.md

---

## 1. What it is, and the ownership boundary

`/po2` is the v2 salesman order page: a public, no-login phone page where a salesman
builds one order from a board of product tiles, picks the dealer at review, and sends
it as a `mailto:` to the depot inbox. It has been live since 2026-09-10
(`app/po2/page.tsx:4`, commit `145b5f32`). `/po9` is the same page with ship-to
switched off (`app/po9/page.tsx:47`, commit `23804504`, 2026-09-15).

Nothing is written to the database. The page reads the catalogue from one API route
(§12), keeps all of its state in the phone's `localStorage` (§8), and hands the order
to the phone's mail app (§11).

### What this file owns

- the `/po2` route and every file in `app/po2/`
- `/po9`: `app/po9/page.tsx` and `app/po9/manifest.webmanifest/route.ts`
- the `/po-v2-8f4kd2` redirect stub, `app/po-v2-8f4kd2/page.tsx`
- the two v2 PWA manifests and their shared builder, `app/po2/v2-manifest.ts`
- every `po2_*` `localStorage` key
- the email-contract test, `scripts/po-v2-email-fixtures.ts`

### What it does not own

| /po2 uses | Owner | /po2's position |
|---|---|---|
| `/place-order` (desktop), `/po` (v1 mobile) | `CLAUDE_PLACE_ORDER.md` (§5, §25) | Compared in §2 only |
| The email body/subject builders: `renderOrderBody`, `buildSubject`, `emailLineLabel`, `emailCase`, `ORDER_TO`, `ORDER_CC` | `CLAUDE_PLACE_ORDER.md §11`, `lib/place-order/email.ts` | Imported read-only (§11). Never re-implemented |
| Pack/carton rules: `packStep`, `packKey`, `sortPacks`, `packToMl` | `CLAUDE_PLACE_ORDER.md §9 / §24`, `lib/place-order/pack.ts` | Imported read-only (`app/po2/v2-data.ts:17`) |
| The mobile product matcher, `rankProductsForQuery` | `CLAUDE_PLACE_ORDER.md §13 / §16`, `lib/place-order/mobile-search.ts` | Imported read-only (`app/po2/product-search.tsx:7`, `app/po2/product-drawer.tsx:6`) |
| The v2 catalogue tables (`mo_order_form_index_v2`, `mo_sku_lookup_v2`) and their seed | `CLAUDE_PLACE_ORDER.md §2 / §14 / §18` | Read through `/api/order/data` only |
| `/api/order/data`, the route itself | `CLAUDE_PLACE_ORDER.md §16` | §12 records only that /po2 and /po9 call it and that it is an open security item |
| `middleware.ts` `PUBLIC_PATHS` | `CLAUDE_CORE.md §12` | §4 records only the consequence for `/po*` |
| The shared wordmark, `components/shared/orbit-wordmark` | `CLAUDE_UI.md` | Imported read-only, splash only (§5) |
| Colour/type conventions that other screens copy from `app/po2/` | `CLAUDE_UI.md §1, §3, §59` | UI owns the pixels; this file owns behaviour |

**When `/po` retires, this file and `CLAUDE_PLACE_ORDER.md` get merged.** Until then, a
rule about /po2 lives here and a rule about /po lives there.

---

## 2. Three order pages

| Address | Login? | Codebase (folder) | Storage keys (prefix) | Email CC? | Status |
|---|---|---|---|---|---|
| `/place-order` | **Yes.** It needs a session plus `place_order` canView, a PageKey (`app/(place-order)/layout.tsx:28-35`) | `app/(place-order)/place-order/` + `lib/place-order/` | `orbitoms_place_order_*` (`lib/place-order/draft-storage.ts:15`), `place_order_*` (`lib/place-order/recents.ts:11`) | **Yes.** `ORDER_CC` via `buildMailtoUrl` (`lib/place-order/email.ts:282-287`; caller `place-order-page.tsx:644`) | Live. Viewports narrower than desktop are sent to `/po` (`place-order-page.tsx:160`) |
| `/po` | No | `app/po/` (`po-page.tsx`, `splash-screen.tsx`) + `lib/place-order/` | `orbitoms_po_*` (`app/po/po-page.tsx:302`), `po_*` (`po-page.tsx:387`; `lib/place-order/saved-drafts.ts:10`, `sent-orders.ts:17`, `fav-customers.ts:13`) | **No.** Inline mailto (`app/po/po-page.tsx:1959`) | Live. Retirement is planned but not scheduled (§16) |
| `/po2` | No | `app/po2/` (15 files, 11,999 lines at `ec6343ba`) | `po2_*` only (`app/po2/v2-storage.ts:25-36`) | **No** (`app/po2/v2-email.ts:108-110`) | Live since 2026-09-10 (`145b5f32`) |
| ↳ `/po9` | No | `app/po9/`: a **mount** of `app/po2/`, not a copy (`app/po9/page.tsx:6-10, 47`) | The **same** `po2_*` keys as /po2 (§8) | No (same code as /po2) | Live since 2026-09-15 (`23804504`) |

Each prefix is kept apart on purpose. `/po2` never reads or writes a `po_*` or
`orbitoms_*` key (`app/po2/v2-storage.ts:3-11`).

---

## 3. Routes

| Path | File | What it does |
|---|---|---|
| `/po2` | `app/po2/page.tsx` | A server wrapper (`force-dynamic`, `:32`) that renders `PoV2Page` from `app/po2/po-v2-page.tsx`. It links its own manifest (`:72`) and sets `appleWebApp.title` to `"Orbit"` (`:92`) and `themeColor` to `#F5F3FF` on the viewport export (`:122-124`) |
| `/po9` | `app/po9/page.tsx` | The same component with `shipToEnabled={false}` (`:47`). Its metadata copies /po2's value for value, except for the manifest (`:31`) |
| `/po2/manifest.webmanifest` | `app/po2/manifest.webmanifest/route.ts` | `GET` returns `v2Manifest("/po2", "Orbit")` (`:54-56`) |
| `/po9/manifest.webmanifest` | `app/po9/manifest.webmanifest/route.ts` | `GET` returns `v2Manifest("/po9", "Orbit")` (`:16-18`) |
| `/po-v2-8f4kd2` | `app/po-v2-8f4kd2/page.tsx` | A server `redirect("/po2")` (`:32`). Nothing renders |
| `GET /api/order/data` | `app/api/order/data/route.ts` | The only network call the page makes (`app/po2/po-v2-page.tsx:557`). Owned by PLACE_ORDER. See §12 |

**Manifests.** Both handlers call one builder, `v2Manifest(mount, name)` in
`app/po2/v2-manifest.ts:55`. It sets `id`, `start_url` and `scope` to the mount
(`:60-62`), and `v2ManifestResponse` serves the result as `application/manifest+json`
(`:80-84`). **The manifest `id` is the mount.** That is why /po2 and /po9 install as
two separate home-screen apps, and why neither can merge with /po's
`public/po.webmanifest`, which has no `id` at all. The key order in the builder is the
bytes on the wire (`v2-manifest.ts:15-17`).

**The redirect does not rescue an installed PWA.** The stub's own header says so
(`app/po-v2-8f4kd2/page.tsx:18-21`): /po2's manifest `id` is `"/po2"`, so a shortcut
installed at the old address is a different app. The redirect sends that shortcut to
the new page, but it stays a separate icon. Staff are told to delete the old app
before installing the new one (`app/po2/page.tsx:87-91`). The stub calls `redirect()`,
not `permanentRedirect()`, so its header's word "permanent" (`:27`) is only a claim.
Its removal is on ROADMAP (§16).

There is **no PageKey, no role slug and no sidebar entry** for /po2 or /po9. Neither
appears in `lib/permissions.ts` (grep for `po2|po9` finds nothing).

---

## 4. Why it is public, and the prefix landmine

`middleware.ts:26` lists `"/po"` in `PUBLIC_PATHS`, and `middleware.ts:36` passes a
request when `PUBLIC_PATHS.some((p) => pathname.startsWith(p))`. That is a
**prefix** match, so `/po`, `/po2`, `/po9` and `/po-v2-8f4kd2` are all public. No
middleware edit was made for any of them (`app/po2/page.tsx:10-13`,
`app/po9/page.tsx:12-13`).

The two manifest URLs never reach middleware at all. The matcher at `middleware.ts:90`
skips every path that contains a dot.

🔴 **LANDMINE: any future path that starts with `/po` is public.** Names like `/portal`,
`/policies` or `/po-admin` would get no session check, and nothing in the new route
would show it. Never give a private route one of these prefixes: `/po`, `/order`
(which also covers `/orders`), `/api/order`, `/demo` (`middleware.ts:8-29`).

---

## 5. The containment rule

**v2 must never modify anything outside `app/po2/`.** If it needs a shared helper
changed, it copies the helper into `app/po2/` instead. It never imports from or edits
`app/po/` (`app/po2/page.tsx:25-30`). Colours are inline styles, so `globals.css` and
`tailwind.config.ts` are untouched (`app/po2/po-v2-page.tsx:59-60`).

At HEAD, the folder imports these things from outside itself, all read-only:

| Import | Where | Why |
|---|---|---|
| `lib/place-order/email.ts`: `ORDER_TO`, `buildSubject`, `emailLineLabel`, `renderOrderBody` | `app/po2/v2-email.ts:12-15` | Copying the email format would drift silently from /po, and the parser would stop recognising products (`v2-email.ts:1-8`) |
| `lib/place-order/mobile-search.ts`: `rankProductsForQuery` | `product-search.tsx:7`, `product-drawer.tsx:6` | One matcher, so one set of results for the same word |
| `lib/place-order/pack.ts`: `packKey`, `packStep`, `sortPacks` | `app/po2/v2-data.ts:17` | One owner for the step and the KG sort (§11) |
| `components/shared/orbit-wordmark` | `app/po2/po-v2-page.tsx:7` | **Splash only.** It is outlined path data, so it does not wait for the web font to load (`po-v2-page.tsx:48-56`) |

⚠ The code comments do not agree on how many exceptions there are. `page.tsx:29-30`
says "two documented exceptions", `po-v2-page.tsx:40-56` numbers email+ranking as 1 and
the wordmark as 2, and `v2-email.ts:1` calls itself "THE SECOND". The table above is
what the imports actually are.

**/po9 is a mount, not a fork.** `app/po9/page.tsx:6-10` says never to copy a file from
`app/po2/` into `app/po9/`: add a prop to `PoV2Page` instead. Because of this, deleting
`app/po2/` alone breaks the /po9 build, and it fails loudly with a missing module
(`app/po2/manifest.webmanifest/route.ts:50-52`).

---

## 6. The board: families, tiles and art

**The board is the landing screen, and it never asks for a dealer.** A tile tap opens
that tile's drawer and does nothing else. The dealer is asked for once, at review
(`app/po2/po-v2-page.tsx:62-71`).

The board is the `BOARD` constant (`app/po2/v2-data.ts:2116`), built on every load by
`buildBoard()` (`po-v2-page.tsx:571`). Its shape at `ec6343ba`, counted by importing the
module:

| Family | Tiles |
|---|---|
| Enamel | Gloss · Super Satin · Promise Enamel · More Enamels |
| Interior | Stay Bright · Supercover · SuperClean · Spray Paint |
| VT | Pearl Glo · Platinum Glo · Eterna · Luxury Finish |
| Promise | Smart Choice · Promise · Promise Primer · Promise Sheen |
| Exterior | Protect Dustproof · Protect Hi-Sheen · Max · More Exterior |
| Primer | Cement SB · Zinc Yellow · Red Oxide · Primers |
| Stainer | Universal Stainer · Machine Tinter · Acotone · GVA |
| Aquatech | Damp Protect · Roof Coat · Other Coat · Crack Filler and Additives |
| Wood | PU Prime · 2K PU · Luxurio · Hydro PU · Thinner & More |

That is **9 families, 37 tiles and 97 members**, with `BOARD_INVARIANTS` empty.

- **A tile is one or more products (members).** Each member is resolved on its own
  catalogue rows. There is only one code path, and a single product is simply a
  one-member tile (`v2-data.ts:1974-1988`).
- **Each family holds 2 to 8 tiles** (`FAMILY_MIN` / `FAMILY_MAX`, `v2-data.ts:2680-2681`).
  Problems are recorded in `BOARD_INVARIANTS` rather than thrown when the module loads,
  and `buildBoard()` throws when the list is not empty (`v2-data.ts:2640-2652`).
- 🔴 **Tile keys are frozen identifiers** (`V2BoardTile.key`, `v2-data.ts:2041-2090`).
  Favourites and cart lines are stored on tile keys, so **changing a key deletes
  people's favourites**. Some keys no longer match the tile's first member, and that is
  correct. Stored lines whose key has gone stale are moved by `migrateLine` in
  `v2-storage.ts`, using the derived index `tileKeyForMember()`
  (`v2-data.ts:2728`). Never use a hand-written table for this.
- **Search results are titled from `FAMILIES`, not `BOARD`** (`po-v2-page.tsx:1456`).
  `FAMILIES` (`v2-data.ts:267`) is still read for that purpose.
- **Order.** Members are ranked by 90-day line frequency and then frozen by hand
  (`v2-data.ts:2100-2111`). Re-rank on purpose, never on every deploy.

**Art.** `boardTileArtFor(key)` is the only source of tile art (`v2-data.ts:2751`).
`tileImage(slug)` returns a file path only when the slug is in one of the three
presence sets (`TILE_IMAGES` `:393`, `MEMBER_IMAGES` `:494`, `VARIANT_IMAGES` `:456`).
Otherwise it returns `null` and the tile draws its family wash (`v2-data.ts:782-789`).
`artPath` serves `/PO/{board|drawer}/` for slugs in `TRANSPARENT_ART` and
`/category-images/` for everything else (`v2-data.ts:591-595`). `TILE_ART_ALIAS` is
empty (`v2-data.ts:637`).

- **At `ec6343ba`, 34 of 37 tiles resolve to a picture. Three do not: GVA, Hydro PU and
  Thinner & More.** Every path that resolves exists under `public/`, checked with a
  filesystem walk.
- 🔴 **An undeclared or misspelt slug gives a blank tile with no compile error.**
  `tsc` cannot see the filesystem. After any art change, the check is a filesystem walk
  over `boardTileArtFor` / `memberImage` / `tileImage`, and `TILE_IMAGES` and
  `TRANSPARENT_ART` are edited together.

---

## 7. Screens and flow

`PoV2Page` switches screens with state, not routing, so the catalogue and the order
survive every switch on one URL (`po-v2-page.tsx:73-76`). The screen union is
`"order" | "review" | "dealer" | "shipto" | "sent" | "drafts" | "sentList" |
"draftDetail" | "sentDetail"` (`po-v2-page.tsx:312-313`), and the sheets are
`"clear" | "load" | "rename" | "delete"` (`:317`).

- **One bill per order.** `buildV2Email` always emits a single bill with no label
  (`v2-email.ts:45-46, 90-92`). /po's multi-bill model (`CLAUDE_PLACE_ORDER.md §25`) is
  not in v2.
- **Send** (`handleSend`, `po-v2-page.tsx:1104-1127`). With no dealer, it opens the
  dealer picker and sends nothing. Otherwise it builds the email, sets
  `window.location.href` to the mailto **first**, then logs the sent order, then clears
  the board and shows the `sent` screen.
- **Back navigation.** The favourites picker is the only thing in v2 that pushes a
  history entry (`po-v2-page.tsx:1201-1210`). /po's single-back-authority model
  (`CLAUDE_PLACE_ORDER.md §25`) does not apply here.
- **Loading.** The fetch uses `cache: "no-store"`. An empty `products` array counts as a
  failure, not a valid empty catalogue, because the route answers 200 with empty arrays
  on error (`po-v2-page.tsx:554-565`; `app/api/order/data/route.ts:138-140`).
  Catalogue-gate problems only produce a `console.warn` (`po-v2-page.tsx:575-580`).

---

## 8. Storage: every `po2_*` key

All in `localStorage`. Every read and write is wrapped, so private mode or a full
quota starts fresh and never crashes the page (`app/po2/v2-storage.ts:13-15`,
`:150-172`).

| Key | Holds | Rule | Cite |
|---|---|---|---|
| `po2_draft` | The live, in-progress order | Discarded, and the key cleared, after 24 h | `v2-storage.ts:25, 86, 340-378` |
| `po2_saved_drafts` | Named drafts | Upsert by id, newest first, capped at 20 | `:26, 39, 393-410` |
| `po2_sent_orders` | Sent orders (append-only log) | Kept for 5 IST days, capped at 300 as a safety fuse, pruned on read and written back | `:27, 52, 85, 484-530` |
| `po2_fav_customers` | Legacy customer favourites | Read only, as the start of the seed chain (cap 12 on read) | `:28, 38, 554-561` |
| `po2_my_dealers` | Legacy send-built dealer list | Read only, as the middle of the seed chain | `:29, 682-695` |
| `po2_starred_dealers` | Starred dealers (customer picker) | Toggle; seeded once from the chain above; storage fuse of 200 | `:30, 610, 637-677` |
| `po2_starred_shipto` | Starred ship-to dealers | Toggle; **never seeded**; reading an absent key writes nothing | `:33, 613-636` |
| `po2_fav_products` | Favourite board tiles | Version 2, keyed on tile key, capped at 8, pruned on read | `:36, 733-835` |

🔴 **/po2 and /po9 share every key.** They are one origin, so drafts, sent orders, stars
and favourites are the same data on both (`app/po9/page.tsx:15-19`). All of it lives
on one phone only. Nothing reaches the server, and a new handset or a cleared browser
starts empty. Whether to move it to the database is an open decision (§16).

---

## 9. Favourites and stars

- **Favourite products are board tiles, capped at 8.** A ninth is **refused** with the
  toast "Favourites full (8 of 8) — remove one first", never evicted
  (`po-v2-page.tsx:1442-1454`; `v2-storage.ts:738-745`). They show as a Favourites card
  above the families, sorted A-Z by caption and hidden when empty
  (`po-v2-page.tsx:1150-1166, 2224-2250`). The only way to set them is the picker sheet
  opened from the page header. It lists every board tile, grouped by family
  (`po-v2-page.tsx:1191-1199, 2580-2600`). No label or art is stored, so both come from
  `boardTile(key)` at render time (`v2-storage.ts:729-731`).
- **Dealer stars are two separate lists**, one for the customer picker and one for the
  ship-to picker. `toggleStarred(c, list)` reads and writes only the list it is given
  (`v2-storage.ts:660-677`; callers `po-v2-page.tsx:2052, 2108`). Sending an order stars
  nobody (`po-v2-page.tsx:1119-1121`). Dealer stars have no cap of 8. `MAX_STARRED = 200`
  is a storage fuse (`v2-storage.ts:606-610`).

---

## 10. Ship-to, and what /po9 changes

`PoV2Page({ shipToEnabled = true })` (`po-v2-page.tsx:355-377`). /po2 passes nothing,
and /po9 passes `false`.

With `shipToEnabled` false:
- review draws no Change control (`review-screen.tsx:597`)
- `onOpenShipTo` returns early, which makes the ship-to picker unreachable, not merely
  unlinked (`po-v2-page.tsx:1978-1985`)
- a new order stores no ship-to and emails none (`po-v2-page.tsx:364-366`)

🔴 **Read-only ship-to on /po9.** Storage is shared, so a /po2 draft or a "Send again"
that carries a ship-to opens on /po9 **with** it, and `buildV2Email` will put a
"Ship To:" line on the email. Review shows that row read-only, as a `<div>` with no
Change control. It is neither hidden nor stripped (`review-screen.tsx:619-640`). The
only ways it leaves the order are clearing the order or sending it.

---

## 11. The email contract

- **Builder.** `buildV2Email` (`app/po2/v2-email.ts:48`) calls the shared
  `renderOrderBody`, `buildSubject` and `emailLineLabel` from `lib/place-order/email.ts`
  (imports at `v2-email.ts:12-15`). The format rules belong to
  `CLAUDE_PLACE_ORDER.md §11` and are not restated here.
- **Recipient: `ORDER_TO` only.** The mailto is built inline as
  `mailto:${ORDER_TO}?subject=…&body=…` (`v2-email.ts:108-110`). **/po2 and /po9 send no
  CC.** In contrast, desktop `/place-order` CCs the parser inbox: `ORDER_CC` is defined at
  `lib/place-order/email.ts:66` and added only in `buildMailtoUrl`
  (`email.ts:282-287`). /po2 deliberately does not call that helper
  (`v2-email.ts:102-107`).
- **The order has no sender stamp.** `snapshotOf` stores the customer, lines, ship-to,
  dispatch, call target, marker, cross depot and notes, and nothing that identifies the
  salesman (`v2-storage.ts:105-131, 315-330`).
- **Ship To** is `name (code)` only when the ship-to dealer is different from the
  billing dealer, and absent otherwise (`v2-email.ts:62-65`).

**KG pack order: /po2 differs from /po.** A cart line's `packOrder`, and the drawer's
pack labels, go through `sortedPacks()` (`app/po2/v2-data.ts:1732-1738`; callers
`po-v2-page.tsx:997`, `product-drawer.tsx:778`). That function wraps `sortPacks`, and
`sortPacks` has a KG branch that orders KG packs by their number
(`lib/place-order/pack.ts:91-105`). /po sorts with `sortPackEntries`
(`app/po/po-page.tsx:101-108`), which compares `packToMl`, and `packToMl` returns 0 for
every KG, GM and PC pack (`pack.ts:47`). **On /po, KG packs keep whatever order they
arrive in. On /po2 they go smallest first.** Desktop's `buildEmail` also uses
`sortPacks` (`lib/place-order/email.ts:245`).

The affected products, as named in the code comment that records the 2026-09-10
measurement ("6 of 347 multi-pack rows", `v2-data.ts:1720-1723`):
- Smart Choice Acrylic Distemper
- VT Concrete Finish
- both Magik bases
- Acrylic Distemper's Duwel row
- Acrylic Putty

Was database insertion order until 2026-09-10; now `sortPacks` order (`4e8ca379`). Do not revert.

**The email-contract test** is `scripts/po-v2-email-fixtures.ts` (`npx tsx
scripts/po-v2-email-fixtures.ts`). Run it before any commit that touches the send path
(`:1-13`). It **reads the production catalogue through Prisma** (`:46-47, 81, 92`), with
pinned byte counts `F1_BYTES = 115` and `F2_BYTES = 499` (`:222, 288`).

---

## 12. `/api/order/data`: an open security item

`app/api/order/data/route.ts` has **no auth**. It is public through the `"/api/order"`
entry in `PUBLIC_PATHS` (`middleware.ts:25`). Its own header calls it a "Public,
unauthenticated endpoint" (`route.ts:6-8`). Every call returns every customer name,
code and area from `mo_customer_keywords` (`route.ts:33-36, 64-79`), plus the active
catalogue with its packs. On any error it answers 200 with empty arrays
(`route.ts:138-140`).

Its callers at HEAD are `app/po/po-page.tsx:763` and `app/po2/po-v2-page.tsx:557`, and
through the latter, /po9.

**This is OPEN.** It is tracked as a P0 at `docs/ROADMAP.md:1540-1550`. This file
proposes no fix.

---

## 13. Landmines

1. **The `/po` prefix is public** (§4). Any new `/po…` route gets no session check.
2. **Changing a tile key deletes favourites** (§6).
3. **A blank tile is not a type error** (§6). Check with a filesystem walk after any art
   change.
4. **/po2 and /po9 share storage** (§8, §10). A change to any `po2_*` shape affects both
   mounts at once.
5. **Two manifests with separate `id`s must stay separate** while /po, /po2 and /po9 can
   all be installed. Merging them folds home-screen apps together
   (`app/po2/v2-manifest.ts:49-53`).
6. **The route's 200-with-empty-arrays error** (§7, §12). A broken catalogue call looks
   like an empty board unless the page treats empty as failure, which it does.
7. **A passing fixture run says nothing about KG order** unless a fixture contains a KG
   product (§11).

### Stale code comments (claims, not facts; for a later code-comment pass)

| Where | Claim | Code |
|---|---|---|
| `app/po2/v2-email.ts:21-22, 41-44` | Body is "byte-identical to what /po would send"; "packOrder is already in /po's emitted order" | False for KG packs since `4e8ca379` (§11) |
| `app/po2/manifest.webmanifest/route.ts:17` | "middleware.ts:86 is matcher" | The matcher is at `middleware.ts:90` |
| `app/po2/page.tsx:115` | "The teal comes from app/layout.tsx:45 … #0d9488" | `app/layout.tsx:54` is `themeColor: "#7C3AED"` |
| `app/po-v2-8f4kd2/page.tsx:27` | "A SERVER redirect, permanent" | It calls `redirect()`, not `permanentRedirect()` |
| `app/po2/po-v2-page.tsx:309` | "The 9x4 board" | 37 tiles; Wood holds 5 |
| `app/po2/po-v2-page.tsx:72` | "SEVEN SCREENS, ONE URL" | The `Screen` union has nine members (`:312-313`) |
| `app/po2/v2-data.ts:1960-1968` | BOARD is "NOT YET CONSUMED"; "FAMILIES still holds the live 32-tile board" | `BOARD` is the live board (`po-v2-page.tsx:571`) |
| `app/po2/v2-data.ts:381` | "7 of the 32 tiles have no art" | 3 of 37 (§6) |
| `app/po2/v2-data.ts:2112` | "36 tiles, 106 members" | 37 tiles, 97 members |
| `app/po2/po-v2-page.tsx:2588` | Favourites picker lists "all 98 members" | It lists tiles (`po-v2-page.tsx:1191-1199`) |
| `app/po2/v2-email.ts:103` | "as po-page.tsx:1956 does" | The /po send line is `po-page.tsx:1959` |

---

## 14. Key files

| File | Role |
|---|---|
| `app/po2/page.tsx` | /po2 route entry, metadata, containment rule |
| `app/po2/po-v2-page.tsx` | `PoV2Page`: every screen, send, favourites, `shipToEnabled` |
| `app/po2/v2-data.ts` | Tokens, payload types, `FAMILIES`, `BOARD`, art sets, `buildCatalog`, `buildBoard`, `sortedPacks`, `CROSS_DEPOTS` (`:1818`) |
| `app/po2/v2-storage.ts` | Every `po2_*` key, migrations, pruning |
| `app/po2/v2-email.ts` | `buildV2Email`, `buildV2MailtoUrl` |
| `app/po2/v2-manifest.ts` | `v2Manifest`, `v2ManifestResponse` |
| `app/po2/review-screen.tsx` | Review: dispatch, remarks, notes, ship-to row |
| `app/po2/product-drawer.tsx`, `product-search.tsx` | The drawer and search results |
| `app/po2/customer-list.tsx` | Dealer / ship-to picker body |
| `app/po2/drafts-sent.tsx`, `order-sheet.tsx` | Drafts and Sent lists, and the order detail screen |
| `app/po2/v2-sheet.tsx`, `v2-search-input.tsx` | Bottom sheet and search input primitives |
| `app/po2/manifest.webmanifest/route.ts` | /po2 manifest handler |
| `app/po9/page.tsx`, `app/po9/manifest.webmanifest/route.ts` | /po9 mount and its manifest |
| `app/po-v2-8f4kd2/page.tsx` | Redirect stub |
| `scripts/po-v2-email-fixtures.ts` | Email-contract test |

---

## 15. Relationship to /po's retirement

`/po` is still live and unchanged, and it runs alongside /po2
(`docs/ROADMAP.md:1531`). The direction is to retire `/po` through the playbook, after a
feature-for-feature parity check against /po2. That item is **not scheduled**
(`docs/ROADMAP.md:1552-1556`). Known v2 gaps the parity check will raise:
- no multi-bill (§7)
- tools step by 1 (`docs/ROADMAP.md:1640-1653`)

---

## 16. Open items (ROADMAP pointers only)

| Item | ROADMAP |
|---|---|
| P0: `/api/order/data` is unauthenticated | `docs/ROADMAP.md:1540-1550` |
| P2: retire `/po` (not scheduled) | `:1552-1556` |
| P3: remove the `/po-v2-8f4kd2` redirect | `:1558-1563` |
| P1: decide whether storage is local or in the database | `:1585-1589` |
| P3: consolidate the manifests | `:1596-1600` |
| P3: `CROSS_DEPOTS` is duplicated in /po and /po2 | `:1610-1615` |
| P2: v2 tools step by 1 | `:1640-1653` |
| P2: stale comments from `23a4a502` | `:1655-1667` |

⚠ **Two ROADMAP entries disagree with the code at `ec6343ba`.**
- "Fav block on the board — BLOCKED" (`:1565-1570`): the Favourites card and picker are
  live (§9).
- "Ten board tiles still have no tin photograph" (`:1572-1578`): three tiles lack art,
  and the ten tile names it lists are no longer all on the board (§6).

Fixing those entries belongs to the ROADMAP pass.

---

*CLAUDE_PO2.md v1.0 · Schema v27.24 · OrbitOMS · updated 2026-09-18 — first canonical file for /po2, /po9, the /po-v2-8f4kd2 redirect, the v2 manifests and po2_* storage. Written from the code at ec6343ba and the live results of 2026-09-18; drafts are history.*
