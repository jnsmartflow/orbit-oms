# /po-v2-8f4kd2 — the board, the drawer and the two list screens
# Code update · 2026-09-08 · covers d054a028 → 3c713282 · written from the code and the commits

**What this is.** `/po-v2-8f4kd2` is a hidden, unguarded salesman order page, live on
production and reachable only by typing its address. Between **d054a028** (2026-09-06) and
**3c713282** (2026-09-08) it went from a 32-tile board of one-product tiles to a 37-tile board
where a tile can hold several products, and grew a Drafts screen, a Sent screen and a shared
order detail.

**Who this is for.** A session six months from now that has never seen this work and has to
change something in it without breaking it. It is written so you can act on it without reading
twenty commit messages first — but every claim names the file, the function or the commit
behind it, so you can check any of it.

**What it is NOT.** It does not restate `/po`. `docs/CLAUDE_PLACE_ORDER.md §25` owns `/po`'s
bills model, its review options, its back-nav authority, its keyboard rules, Favourites and
Recents; `docs/CLAUDE_UI.md §55` owns `/po`'s pixels and §60 owns the mobile card type
discipline. **v2 shares none of `/po`'s code** — see §0 — so where the two look alike they are
alike by copy, not by import, and a change to one does not reach the other.

**Status.** Not in any canonical file. `docs/CLAUDE_UI.md` mentions the route twice (§1 and §3,
both about the red/amber rule, both added at 3c713282) and nothing else in `docs/` knows it
exists. When v2 merges into `/po` this document is the input to `CLAUDE_PLACE_ORDER.md`.

---

## 0. The shape of it

Twelve source files plus a manifest route, `app/po-v2-8f4kd2/`, nothing outside the folder:

| file | lines | what it is |
|---|---|---|
| `v2-data.ts` | 2304 | the BOARD literal, the catalog resolvers, every colour token, the image maps |
| `po-v2-page.tsx` | 1789 | the whole app — every screen, the cart, the send |
| `product-drawer.tsx` | 1792 | the bottom sheet a tile opens |
| `order-sheet.tsx` | 721 | the order DETAIL screen, the chips, the type scale |
| `v2-storage.ts` | 665 | every `po2_*` key, and the migration |
| `review-screen.tsx` | 438 | the pre-send review |
| `drafts-sent.tsx` | 353 | the two list screens |
| `v2-sheet.tsx` | 268 | the bottom-sheet shell, the scroll lock, the viewport pinning |
| `customer-list.tsx` | 221 | the dealer picker |
| `product-search.tsx` | 202 | the board's search |
| `v2-email.ts` | 110 | the wire — see §6 |
| `page.tsx` | 89 | the server wrapper, the per-route PWA metadata |
| `manifest.webmanifest/route.ts` | — | the route's own PWA manifest, served by a handler so nothing lands in `public/` |

**Two documented containment exceptions**, both read-only imports out of `lib/`, both stated at
the top of the file that does it:

- `v2-email.ts` imports `renderOrderBody` / `buildSubject` / `emailLineLabel` / `ORDER_TO` from
  `lib/place-order/email.ts`. Imported, never reimplemented.
- `product-drawer.tsx` imports `rankProductsForQuery` from `lib/place-order/mobile-search.ts`.
  One matcher, so a word cannot return two different result sets.

Everything else — pack formatting, colours, storage — is **copied in**, and each copy says so
and says it is a snapshot that does not follow the original.

---

## 1. The tile model

### A tile holds several products

Before **1129427d** a board tile *was* a product: one tile, one `sap`, one drawer. It is now a
container.

```ts
type V2Member    = { sap; label; slug?; option?; category? }   // v2-data.ts:1497
type V2BoardTile = { key; label; slug; members: readonly V2Member[] }
type V2BoardFamily = { name; tint; openTab?; tiles }
```

- **`sap`** is `COALESCE(product, subProduct)` — the catalog join key, the same one
  `buildCatalog` joins on and the same one a cart line stores. It is not a display string and
  renaming it renames the product.
- **`label`** is display only: what the rail says and what the cart line shows.
- The other three are §3.

**Today** (counted from the BOARD literal, 2026-09-08): **9 families · 37 tiles · 98 members**,
of which **18 tiles hold exactly one member** and 19 hold more.

| family | tiles | members |
|---|---|---|
| Enamel | 4 | 7 |
| Interior | 4 | 7 |
| VT | 4 | 9 |
| Promise | 4 | 6 |
| Exterior | 4 | 6 |
| Primer | 4 | 10 |
| Stainer | 4 | 4 |
| Aquatech | 4 | 19 |
| Wood | **5** | 30 |

Earlier commit messages say 104 or 106 members. They were right when written; membership has
been trimmed since (**7dca6d31** took More Exterior 9→3 and Crack Filler 4→3). **98 is the
number in the file today** — recount it, never quote a report.

### A single-product tile is a one-member tile, not a branch

Stated at **d054a028** and it is the load-bearing decision of the whole model. There is no
"simple tile" code path. A branch would have taken the 32 single tiles off the path everyone
edits, and the file records exactly what that has already cost twice:

- `needsShade` demanded a shade from nine products that had none, making them unorderable
  behind a screen that looked perfectly normal;
- an empty-string `baseColour` left 37 products unorderable the same way.

One shape, always an array, and the single case is the degenerate one.

### 🔴 Scheme A — a tile's key IS `members[0].sap`

`V2BoardTile.key` is not a synthetic string. It is the **top-selling member's own catalog join
key**, and members are ordered by 90-day line frequency descending.

**Why:** at the merge, 29 of the 32 old tile saps were still tile keys, so 29 of every 32
stored cart lines needed no migration at all. A synthetic key (`"tile-primers"`) would have
orphaned all 32 at once.

**Why it is safe — and it is safe only because of one function.** The key *moves* the day sales
reorder a tile's members. What makes that survivable is that the old key is still a **member**,
so a *derived* index still finds its tile:

```ts
tileKeyForMember(sap)   // v2-data.ts:2063 — MEMBER_TILE.get(sap) ?? null
boardTile(key)          // v2-data.ts:2068
```

`MEMBER_TILE` is filled by walking `BOARD` at module load — every member of every tile, not a
list of the ones that happen to move.

**🔴 Never replace that lookup with a table.** A hand-written map of "the three saps that moved"
would be correct for exactly one ranking. On the next re-rank it would orphan every stored draft
that used one — and the symptom is not an error anybody sees. It is a **duplicate cart line**:
`po-v2-page`'s `addLines` replaces by `tileSap`, so a line filed under a key the board no longer
recognises is *kept* while the edit writes a second one beside it. Two lines, same product, both
sent, nothing on screen saying so. That bug was live and is reproduced in **b088d8c7**'s proof 5.

`BOARD_INVARIANTS` enforces the key rule at load (`tile.key !== tile.members[0].sap`), plus: no
tile with zero members, no two tiles sharing a key, no member on two tiles. See §5.

---

## 2. The four layout shapes

`product-drawer.tsx` decides, once, what shape a tile's drawer is:

```ts
type Layout = "single" | "category-products" | "rail-products" | "strip-products";

const layout: Layout = !isMerged ? "single"
  : categories.length > 0 ? "category-products"
  : members.every((m) => !hasOptions(m, railsBy[m.sap])) ? "rail-products"
  : "strip-products";
```

| shape | when | what the drawer looks like |
|---|---|---|
| **single** | one member | no strip. The rail is that product's colours, exactly as before the merge. |
| **strip-products** | several members, **at least one** with a colour ladder | products across the top in a horizontal strip; that product's options in the rail; its packs in the pane. |
| **rail-products** | several members, **not one** with a colour ladder | the rail holds the PRODUCTS and the pane holds the packs. FBC Advance has eleven members — three sideways swipes in a strip, one flick down in a column, every name readable instead of clipped. |
| **category-products** | any member carries a `category` | category chips across the top, that category's products in the rail, that product's packs in the pane. |

Counts at **084520be**, the last commit that measured them: **18 single · 10 strip · 8 rail ·
1 category**. Two of those four are provable from the file alone today and still hold — 18
tiles have one member, and exactly one tile (`MULTI PURPOSE THINNER`, "Thinner & More", 17
members) carries categories. The strip/rail split needs the live catalog to recompute, because
"has a colour ladder" is a fact about the payload.

### 🔴 It is a property of the TILE, never of the selected member

The expression above reads `members` and `railsBy` — both memoised on the tile — and **never
mentions `cur`**, the selected member. That is deliberate and it is a usability rule, not a
performance one: **a drawer that reshapes itself when you tap a product moves the next target
out from under the thumb**, and the man doing it is holding the phone in one hand on a warehouse
floor.

What *is* per-member is `showRail` — whether the options column renders at all — and that is
safe for a measured reason stated at the call site: the rail is on the LEFT and the pack row's
stepper is right-aligned against the sheet edge, so dropping the rail widens the pane
*leftwards*. The +/− buttons do not move; only the label, which is not a tap target, slides.

### What was tried and removed — do not rediscover it

- **A two-level rail with a "‹ back" chevron** (61ee8cc7) shipped for exactly one commit and was
  replaced at **3eecd041**. A rail that is sometimes products and sometimes colours is a rail you
  have to read before you can use, and the chevron existed only to undo a move the design should
  not have asked for.
- **`chipLimit()`**, a top-4/top-9 cut on a horizontal chip row, went with the rail rewrite at
  **4165b750**. A cut only exists because the row was horizontal and finite; a column is neither.
- **`shadeRowMode()`**, a ΔE close-pair rule that chose colour-vs-text for a whole row, went at
  the same commit. Each tile decides for itself now (`isBaseOption()`), so the all-or-nothing
  question is not asked.
- **A Base/Shade segmented toggle inside the rail** (`GroupButton`) went at **a9732a8a**. It was
  a shape that existed only to fit an 88px column — stacked vertically, because side by side its
  halves would have been 41px wide. Base and Shade are a *filter over the list below them*,
  which is what a category chip already is, so they are drawn by the same `FilterChip` in the
  same `PickerZone`. One control, one appearance.

### 🔴 The toggle is two NAMED products, never a count

```ts
const TOGGLE_MEMBERS: ReadonlySet<string> = new Set(["GLOSS", "SUPER SATIN"]);
```

Gloss (38 options) and Super Satin (14) keep the Base/Shade split; everywhere else shows one
combined column — bases first in their numbered sequence, then shades in sales order.

**It must not become a threshold and the live data is why: Protect Dustproof has FIFTEEN
options, one MORE than Super Satin.** Any number that keeps Super Satin keeps the tile the
toggle is being taken off. What separates them is not size — one range is browsed, the other is
looked up. That is a curation judgement about two specific products, so it is written as two
specific names. The day a third tile wants it: add its sap and say in the commit which range
grew. **Do not "generalise" it back into a rule** — that is how Dustproof gets its toggle back
by accident.

---

## 3. Pinned members

```ts
option?: string;   // V2Member — v2-data.ts
```

**The problem.** Wood Primer ships in White and Pink and nothing else. Those are not "a colour
you choose", they are two things a dealer asks for by name. Left as one member with a two-option
rail, it forced the whole Primers tile to carry a product strip so that ONE of its seven members
could offer a choice — six products paying for the seventh.

**The fix (df445f08).** `option` pins a member to exactly one catalog row: the row whose
`baseColour` is exactly that string. A pinned member resolves to one row, shows no picker, and
its cart line carries **that row's** `product` / `baseColour` / `subProduct` — so the email
prints "Wood Primer White" and "Wood Primer Pink" with nothing in `v2-data.ts` touching the wire.
Primers became seven option-less members in a rail with no strip at all.

**Today: 15 pins across the board.** Thirteen of them are the Sadolin/Wood tail on the
category tile added at **5e4f2754** — ten `"Clear"`, three `"Int Clear"` — plus Wood Primer's
`"White"` and `"PINK"`. Eight more members on that tile need no pin: their `baseColour` is
genuinely null.

### 🔴 The case rule — read it from the catalog, never retype it

The match is `rows.find((r) => r.baseColour === member.option)`. **Raw equality, case-sensitive,
and it must stay so.** The live rows are `baseColour` `"White"` (id 21910) and `"PINK"`
(id 21911) — the catalog is not consistent about case, and that is precisely the reason not to
fold it. The string authored in `BOARD` has to be the string that is stored, so a typo is
**reported as a missing member at build time** rather than quietly matching the wrong row.
Folding case would hide the day two rows differ only by case.

Every pin in the file was read out of `mo_order_form_index_v2` and verified byte for byte
against the row it resolves to. Do the same for the next one. Do not copy a pin value out of a
prompt, a report, or this document.

### The twins are keyed apart

```ts
memberKey(sap, option)   // "WOOD PRIMER|||White"   — v2-data.ts:2132
```

`V2ResolvedMember.sap` is that string for a pinned member; `joinSap` is the real catalog key.
The drawer keys its quantity matrix, its selection and its count badges on `sap`. **Sharing it
would sum White's units into Pink's badge and let an edit of one wipe the other.** `"|||"` is
the same separator the pack map already uses and cannot occur in a catalog value.

Nothing downstream sees that string: a pick carries its ROW, and the cart line is built from the
row's own three catalog fields. `seatOf()` in the drawer translates incoming cart lines onto the
drawer's keys, and a pinned member's pick returns its **pin** as the option — so reopening a
saved order seats White and Pink in two different columns instead of collapsing them.

### The bug that made this a two-commit job

`memberLabelIn()` in `po-v2-page.tsx` used to map a row to a label with
`tile.members.find(m => m.sap === sap)`. With two pinned members sharing the sap `WOOD PRIMER`,
**both would take the first match** — a Pink line would be written into the cart labelled "Wood
Primer White". **And the email would still have been right**, which is what made it dangerous:
the wrong word on the screen the salesman checks, and nothing in the message that proves it. It
now matches on `baseColour`, **pinned members first**; the unpinned fallback deliberately
excludes pinned members, or a `WOOD PRIMER` row carrying some third colour would fall through
and take the first twin's label anyway — the same bug one branch lower.

**7dca6d31** stopped rather than patch this, because it needed a file that step did not own.
The stop is in that commit message; the fix is **df445f08**.

---

## 4. 🔴 The three-case orphan migration

`v2-storage.ts:237`, `migrateLine()`. Applied **on read**, in all three loaders —
`loadLiveDraft`, `readDrafts`, `readSentRaw`.

### What it is for

**1129427d** changed what `tileSap` means. Before it, `tileSap` was the product's own join key;
after it, `tileSap` is the TILE's key and `label` is the MEMBER's name. Every line written before
that commit carries the old pair, and localStorage still holds them.

An unmigrated line is **not merely cosmetic**. It renders, and it emits byte-identical email —
the three fields the wire reads are untouched by any of this. But `addLines` replaces by
`tileSap`, so the duplicate described in §1 is exactly what happens.

### The three cases

The member is identified **from the ROW** (`line.product ?? line.subProduct`), never from
`tileSap`. That is the catalog join key; it means the same thing on an old line and a new one,
and it is what makes the function idempotent by construction.

**Case 1 — the product IS a member of some tile.** Rewrite `tileSap` to that tile's key and
`label` to the member's label. Spread, so `product` / `baseColour` / `subProduct` / `qtys` /
`packOrder` / `rowId` / `option` / `id` pass through byte for byte. Neither rewritten field
reaches the email.

**Case 2 — on no tile, and the stored key is dead too.** Leave it exactly as it is. It renders,
it sends, it does not badge, and nothing can delete it because no tile replaces by a key that no
longer exists. That is the correct end state for a product that left the board.

**Case 3 — on no tile, but parked under a key that is STILL ALIVE.** Refile it under its **own
product key**.

### 🔴 Why case 3 exists, and what it silently deleted

VT Diamond Glo and VAF were members of the VT Specialty tile until **3eecd041**. A line saved
then carries `tileSap: "VELVETINO"`, and VELVETINO is **still that tile's key**. The original
two-case rule — "a sap on no tile keeps its stored key" — read that as already correct and left
it. Then `addLines`, which replaces every line whose `tileSap` matches the tile being edited,
**DELETED it the next time anybody touched VT Specialty.** The drawer could not save it either:
it seeds a member the tile no longer has, `rowFor()` returns null, and the pick is filtered out
before Add.

The line was gone and nothing on screen said so. **3eecd041** reproduced it end to end and
reported it without fixing it — `v2-storage.ts` was not that step's file. **0c78d5b5** is the fix.

**Why refiling under the product's own sap is the mechanism and not a workaround:** that is
exactly where `po-v2-page` files a line added by SEARCHING for the product (the group path
writes `tileSap` = the resolved product's sap). So the line stops being a stranger on somebody
else's tile and becomes the ordinary search-only line it now is — **editable again through
search**, which a sentinel or a flag would not have been. All four readers of `tileSap` land
right by construction: `addLines` never sees it, `existingFor` never seeds it into a drawer that
would drop it, `countsByTile` gives it no badge (correct — it is not on the board), and
`tileArtFor` gives it the neutral fill any off-board product already gets.

**Idempotent by construction, not by a flag.** A tile's key IS its top member's sap, so if the
product's own sap were a live tile key the product would be a member of that tile and case 1
would have returned. It cannot be one here, so a second pass takes case 2 and changes nothing.

### 🔴 Derived, not a list — and this is the rule to defend

`migrateLine` **names no product**. It is eight lines of logic over `tileKeyForMember()` and
`boardTile()`. Every membership change since has made new orphans and it has absorbed all of
them **with `v2-storage.ts` byte-identical**: seven dropped products at 7dca6d31, a retired tile
key and a new tile key at 5e4f2754, four products changing tiles at 084520be.

It was proved derived by removing an *arbitrary* member — 2K PU Gloss — from a scratch copy of
the board and running the byte-identical shipped function against it (0c78d5b5, proof 9).

**No version bump, deliberately.** The stored SHAPE is unchanged; one field's value is
corrected. `version: 1` still describes the data honestly, and bumping it would make every older
build treat these records as unreadable.

**On read, never on write.** localStorage can hold data written by an older build at any moment
— a phone that has not reloaded, a tab left open since yesterday, a draft restored after a
rollback. Migrating on write would fix only what this build happens to touch.

---

## 5. The build-time guards

Three, and each one has caught something real.

### The invariants list (`BOARD_INVARIANTS`, v2-data.ts:1989)

Violations are **recorded at module load, not thrown**. `v2-data` is imported by every screen,
so a throw there takes the whole page down for an authoring mistake. `buildBoard()` throws on a
non-empty list instead — loud exactly where it is consumed, silent where it would be a
catastrophe.

It catches: a family outside the tile bound, a tile with no members, a tile whose key is not
`members[0].sap`, two tiles sharing a key, one member on two tiles.

### The family bound — 2 to 8 (`FAMILY_MIN` / `FAMILY_MAX`)

This used to assert **exactly four**, and that assertion was never about the products: it was
about the grid being four across, so four tiles filled one clean row. That is a fact about the
LAYOUT, which does not need the data's help. Wood is the first family whose range genuinely
wants five (**084520be**, Hydro PU).

**It was replaced with a bound, not deleted, and the reason is that `BOARD` is a hand-authored
literal seventeen hundred lines long.** The realistic failure is not "a family that deserves five
tiles"; it is a misplaced bracket that swallows one family's tiles into its neighbour's array, or
a paste that duplicates a block. Both leave an absurd count, and both would otherwise reach a
phone as a missing row or a wall of tiles — **silently, because every individual tile in them is
still well-formed.**

2 because a family of one is a mislabelled tile. 8 because two full rows is already more than
the eye groups as one block, so going past it should be a deliberate decision made by raising
the number with a reason.

**Exercised, not asserted** (084520be): cutting Stainer from four tiles to one reports
`family "Stainer" has 1 tiles, outside the 2-8 bound` and `buildBoard` refuses to build.

### The category guard — thrown, by name, with the fix in the message

A category tile spends **both** zones — the strip holds categories, the rail holds products — so
nothing in it may have anything left to choose. `buildBoard` throws if a categorised member
resolves to any options and has no pin:

```
v2 board: "WOOD FILLER" is in the category tile "Thinner & Sealer" but has 3
option(s) and no pin. A category tile has no zone left to choose in — either
pin it with option: "<the exact baseColour>", or take it off the tile.
```

**Exercised** (5e4f2754): dropping Wood Filler, which has three real colours, into a category
produces exactly that. Loud on a developer's machine and in CI, never silent on a phone.

### `assertOwnRows()` — the anti-union assertion

Every row handed to a member's resolve must belong to that member; the first foreign row throws.
It cannot fire on any *data* — the rows come from a `groupBy` on the very key being checked — so
it can only fire on a **code change**, which is exactly what should stop loudly. See §8.

---

## 6. The email contract

**The wire is the one thing in this route that must never move.** `v2-email.ts` is a mirror of
`app/po/po-page.tsx`'s `buildEmailParts`, field for field, and it **imports** the builders rather
than reimplementing them: not the `" - "` separator, not the U+2007 figure-space line-number pad,
not `emailCase`'s KEEP_CAPS rules. Copying any of that would drift from `/po` the first time
somebody edits the original — and the drift would be silent: the mail still sends, the parser
just stops recognising the product.

### 🔴 A cart line's display label cannot reach the wire

```ts
name: emailLineLabel(line.product, line.baseColour, line.subProduct)
```

`emailLineLabel` reads **three fields off the menu row** and nothing else. `V2CartLine.label` —
the member name the board and the review screen show — is never passed to it. That matters
because the label changed meaning at 1129427d (tile name → member name) and changes again every
time a membership is edited.

**Proved, not assumed.** At **df445f08**, both Wood Primer colours were ordered in one message,
hex-dumped at 89 bytes — and **rewriting BOTH cart labels to nonsense changed not one byte**.
The same property is re-proved at every commit through the two standing fixtures.

### The two standing fixtures

Every commit in this range re-renders both and asserts them byte for byte:

- **Fixture 1 — 115 bytes**, a three-line order, asserted against a full hex string
  (`42696c6c…314c2a36`). Gloss Black `1L*6, 4L*4` · Gloss 90 Base `20L*2` · Super Satin Brown
  `1L*6`.
- **Fixture 2 — 430 bytes**, a twelve-line order carrying Urgent + Truck + a note, asserted on
  length **and** on containing `e2 80 87` — the **U+2007 figure space** that pads line numbers
  past nine. That byte is the reason fixture 2 exists: it is the one character in the format a
  well-meaning "cleanup" would replace with an ordinary space, and the parser would stop
  matching.

**If you change anything in this folder, re-render both.** A change that alters either is a
change to what the depot receives.

**No CC.** `buildV2MailtoUrl` builds the mailto inline rather than through
`buildMailtoUrl()`, which appends a desktop-only cc. `/po` has never carried it either.

---

## 7. The type scale

`order-sheet.tsx`, top of file. **Eleven roles.** Every text node on the detail screen and both
list screens carries its role tag in a comment, so the audit is a grep and not an opinion.

| | role | value |
|---|---|---|
| T1 | screen title | 20 / 700 / −.02em |
| T2 | header meta | 11 mono / MUTED |
| T3 | section label | 10 / 700 / +.13em caps |
| T4 | card title | **17 / 500** |
| T5 | card meta | 12 mono / MUTED |
| T6 | chip | 12 / 600 + a 13px icon |
| T7 | row label | 11 / 600 / +.1em caps |
| T8 | row value | 14 / 500 |
| T9 | product name | 15 / 600 · its colour 11 / 700 caps VIOLET |
| T10 | figures | 13 mono tabular |
| T11 | button | 15 / 600 |

**🔴 A twelfth role is a smell.** The scale exists because a screen assembled from ten unrelated
sizes looks assembled rather than designed. Before adding one, check whether an existing role
says the same thing at a different size — that is nearly always what is happening.

**T4 is 500, and that is the point.** `CLAUDE_UI.md §60`: *weight, not colour, is the heavy
dial; nothing on the card is 700.* The card name went from 15/700 to 17/500 at **a9732a8a** —
bigger AND lighter than what it replaced, and the only 17px thing on the card, so nothing has to
shout to be found. **T11 closed the last gap at 3c713282**: 25 sites at font-weight 800 across
`po-v2-page.tsx` went to zero — sixteen 15px buttons and one 14px button to 600, four sheet
titles / the "Order sent" line / a screen header to 700, two 10px labels to 700.

**The scale has one home.** It is written down once, in `order-sheet.tsx`, and `SectionLabel` is
literally the same exported component on the detail and on both lists — a section label that is
10/700/.13em on one screen and 11.5/800/.08em on the other is two scales.

---

## 8. The landmines

### 🔴 A nested `calc()` is dropped whole — keep CSS calc flat

**What it cost:** the last card of the Sent list sat under the bottom nav on a real iPhone and
scrolling to the end would not clear it.

**The arithmetic that found it.** The nav is `44 + I` (1 border + 8 `pt-2` + 18 icon + 2
`gap-0.5` + a 15px label line box — `text-[10px]` sets font-size only, so the box is Tailwind
preflight's `html { line-height: 1.5 }`), where `I` is `max(env(safe-area-inset-bottom), 8px)`.
`NAV_H` claimed `54 + I`. The list padded by `NAV_H + 16`, so its clearance was
`(54+I+16) − (44+I)` = **a constant 26px. The inset cancels.** No viewport model, safe area or
keyboard state can turn +26 into a card behind the nav — so the padding was not short, **it was
not applying.**

The one thing that made the list different from every site that worked:

```css
calc( calc(54px + max(env(safe-area-inset-bottom), 8px)) + 16px )
```

A calc wrapping a calc wrapping a max wrapping an env. Three sites did that; the two that used
`NAV_H` flat — the detail footer's `bottom`, the cart bar's `bottom` — were never reported wrong.
**A declaration a parser rejects is dropped whole**, giving `padding-bottom: 0`.

**The rule now** (`order-sheet.tsx`, **bba21b8c**): `belowNav(extra)` emits **one** calc, **one**
max, **one** env, whatever the caller wants underneath it. The arithmetic lives in JavaScript
where it can be read and proved; the CSS stays flat. `NAV_H = belowNav(0)`,
`LIST_PAD = belowNav(32)`, `DETAIL_PAD = belowNav(72 + 32)`. **Never wrap the result in another
calc — pass what you want added as the argument.**

**A second, separate defect on the details, and it was arithmetic not parsing:** the fixed button
bar is 72px tall and was **never in the sum**, so the last product row was −62px at every inset
— while a comment above the footer claimed "the page pads by nav + footer". It did not. See the
next landmine.

### 🔴 `drawerMode` on a union of members is wrong for most merged tiles

Measured on the live payload 2026-09-07: `drawerMode()` on a tile's **combined** rows returns
`"standard"` for **12 of the 17** merged tiles, and **six of those are made entirely of
single-mode, option-less products**. A standard base/shade shell over a product with no options
is a dead screen — no pack sizes, a nag where the quantity belongs, a grey Add button.

So `mode` and `pools` are computed **inside `buildBoard` from each member's own rows** and
carried on `V2ResolvedMember`. They are on that type precisely so no later caller can be tempted
to derive them: a caller that had to call `drawerMode()` itself would have a tile in hand, and
the union is the obvious thing to pass. `assertOwnRows()` throws if anyone tries.

### 🔴 "One row, one option" is not the same as "no options"

A pinned member has one row and no picker. A **flat** product has several options that all share
one pack, and it renders every option with its own stepper (`FlatBody`). They look similar in a
type signature and behave completely differently.

**What it cost:** at 3eecd041 `showRail` was made to ask the *current* product, and Velvetino —
a flat product leading the VT Specialty tile — fell through to the single-option pack list and
its GOLD and SILVER shades became **unreachable**. Caught before commit, and the fix is that the
pane's body is one question asked once (`paneBody`), with the branch above it only about whether
a rail stands beside it. The comment there records that it used to be a three-way with the flat
arm first, which is what made Velvetino unreachable.

The category guard rejects `mode === "flat"` for the same reason.

### 🔴 A stale code comment claiming a fact about live behaviour

This folder has shipped several, and each one was believed by a later session.

- **`tileArtFor` read the dead 32-tile `FAMILIES` constant for eleven commits.** Its own comment
  said *"Step 4 owns the switch-over"*. Step 4 never did it. Nine tiles — SuperClean, More
  Interior, Pearl Glo, Platinum Glo, VT Eterna, VT Specialty, Promise Sheen, Coats & Additives,
  More Wood — came back with a family wash from the *old* grouping, and those cart lines sat on
  the wrong tint. Fixed at **c98b4e8c**; both `tileArtFor` and `variantImage` read `BOARD` now.
- **`damp-base.webp` was described in a brief as unreferenced.** A sweep of all 1,468 tracked
  files found the slug twice, and one of them was live (`TILE_IMAGES`), so deleting the file
  without the set entry would have left a resolvable path to nothing (**e8779ce3**).
- **Four comments in `v2-data.ts` are stale RIGHT NOW.** Recorded here rather than edited,
  because this document changes no code — fix them the next time that file is in a fence:
  - `buildBoard`'s *"Nothing calls this yet. po-v2-page.tsx is Step 2's file."* — it is called
    at `po-v2-page.tsx:318`.
  - `BOARD_INVARIANTS`'s *"Nothing consumes buildBoard yet."* — same.
  - `boardTileArtFor`'s *"Step 4 owns the switch-over."* — the switch-over happened at
    `c98b4e8c`; `tileArtFor` is now a one-line delegate to `boardTileArtFor`.
  - The closing block's *"Step 2 points the page at BOARD and deletes FAMILIES in the same
    commit."* — **it did not.** `FAMILIES` is still exported and `buildCatalog` still walks it
    (`v2-data.ts:786`) to build the curated `byTile` map that `buildBoard` passes into
    `resolveGroup`. A second comment at `:483` flatly says *"FAMILIES is dead"*. It is not dead;
    it is the curation source for the 32 legacy products. See §11.

**The rule:** a comment that says what *another* file does, or what a *future* step will do, goes
out of date silently. When you touch a function, re-read the comment above it and check its
claims against the code you are looking at.

### 🔴 Red is destructive only; amber is urgent

`CLAUDE_UI.md §1` said `red=urgent/error/blocker` while its own attention-chip line had shipped
`bg-amber-50 / text-amber-700` for *"Bill Tomorrow, Cross XYZ, **Urgent**"* for over a year. The
rule was corrected at **3c713282**: **red is for something being WRONG, or about to be undone —
a failed send, a bounced order, a blocked dealer, a Delete or Clear button. Never for a
priority.** Spent on a priority, red has nothing left to say when something actually breaks, and
a column of red chips on a busy morning stops registering at all.

In this folder: the Urgent chip is `ATTENTION #B45309` on `ATTENTION_BG #FFFBEB` (amber-700 on
amber-50, `order-sheet.tsx`). `URGENT #DC2626` (`v2-data.ts:49`) survives at exactly four places,
all destructive: the two Delete buttons, Clear, and "Replace what is here".

⚠ **`CLAUDE_UI.md §3`'s Semantic table still says `Urgent | bg-red-50`, deliberately.** It is a
*record of shipped code* — `components/shared/status-badge.tsx`,
`components/floor/floor-table.tsx` and `components/shared/duplicate-so-tag.tsx` all still paint
it red — and canon must never claim a colour a screen does not paint. The row carries the
migration list beneath it. Flipping it ahead of the code is the failure `CLAUDE.md §4` exists to
prevent.

---

## 9. What is deliberately not done

Each of these is a decision, not an omission. Do not "fix" one without reading why.

**Favourites are not built.** `/po` has a curated 8-dealer Favourites list
(`CLAUDE_PLACE_ORDER.md §25`). v2 has a **starred dealers** list instead
(`po2_starred_dealers`), and its storage carries a two-step seed: it reads `po2_my_dealers` if
its own key is absent, and that in turn was seeded once from `po2_fav_customers`. The comment
says why — *"nobody loses their list twice in one night"*. Recognised by the key being **absent**
rather than empty, so a deliberately emptied list is not re-seeded.

**No per-salesman board.** `BOARD` is a hand-authored literal, frozen from a 90-day mail-order
ranking and re-ranked **deliberately, never on every deploy**. The reason is in the file: *the
board must not reshuffle under a salesman who has learned where things are.* A per-salesman or
auto-ranking board would break that and would also make Scheme A's key move per user, which
`tileKeyForMember` handles but nothing else does.

**Storage is browser-only, and it is a known limit.** `po2_draft` · `po2_saved_drafts` (cap 20)
· `po2_sent_orders` (5 IST calendar days, `MAX_SENT` 300 as a fuse) · `po2_starred_dealers`.
Per-phone, per-browser; lost on a browsing-data clear or a new handset. The 300 cap is measured,
not guessed: one six-line sent order is ~1,674 bytes, so 300 is 0.48 MB (0.94 MB at twelve lines
each) against a ~5 MB origin. It cannot bite in normal use — the depot's busiest single day in
90 days was 300 mail orders **across every salesman** (p95 211, average 86). When it does bite,
the oldest are dropped **silently**: a quota failure here is already silent by design, and a
toast about an order from four days ago would interrupt a salesman to tell him about something
he cannot act on. ⚠ Orders already pruned under the old two-day rule are **gone** — pruning
writes the shortened list back, so 7a9fd300 widened the window from that day onward only.

**Ten tiles have no photograph** (counted 2026-09-08, alias resolution included): More Interior,
VT Specialty, Acotone, Uni Stainer, Machine Tinter, GVA, Coats & Additives, Luxurio, Hydro PU,
Thinner & More. **29 of 98 members** carry their own tin, across 25 files — two of which are
deliberately shared (one Crackfiller tub for 5mm/10mm/20mm, one Roof Coat tub for
White/Teracotta/Grey; same tin, only the printed text differs). A tile with no art shows the
family wash, which is the board's own treatment for art that has not arrived.

**A non-leader member with no art gets NOTHING, deliberately.** `memberImage()` has exactly one
fallback — the tile's **leader** gets the tile's own picture, because a tile's photograph *is* a
photograph of its top seller. Extending that to every member is the bug the cart shipped for
eleven commits (nine Powerflexx products under one tub) and it is worse in the strip, whose whole
job is to tell nine products apart. The family wash says "no photo yet"; the leader's tin would
say "this is the leader", which is false.

**Four tiles borrow a photo by ALIAS, never by copy** (`TILE_ART_ALIAS`). Copying the bytes under
a fifth name would cost 100 KB and create two files that drift apart the day one is replaced. ⚠
The alias redirects the **file**, never the **slug** — a tile's slug is also the stem
`variantImage()` builds `<tile-slug>-<option-slug>` from, so renaming `smart-choice`'s slug to
the file it borrows would silently break all five Smart Choice bucket tins.

**Three 800-weight buttons survive outside the fence** — `review-screen.tsx:418` (Send order),
`product-drawer.tsx:884` (Cancel) and `:894` (Add) — plus twelve non-button 800s in those files
and `product-search.tsx`. They are T11 violations, reported at **3c713282** and left because
those files were not in that step's containment.

**`URGENT` is not renamed.** After 3c713282 that token is never urgency; it is the destructive
red. `DANGER` is what it means. It stays because `v2-data.ts` has been outside the containment
of the last three steps. Rename it — and move `ATTENTION` / `ATTENTION_BG` into `v2-data.ts`
beside it — the next time that file is open.

---

## 10. Ten things a future session gets wrong

1. **Quoting a count from a report.** Member counts, tile counts and layout splits have all
   moved. Recount from `BOARD`.
2. **Adding a hardcoded map of moved saps** instead of using `tileKeyForMember()`. §1.
3. **Passing a tile's union of rows to `drawerMode` or `optionPools`.** §8.
4. **Making the Base/Shade toggle a count threshold.** Protect Dustproof has more options than
   Super Satin. §2.
5. **Folding case on a pin.** The catalog ships `"White"` and `"PINK"`. §3.
6. **Wrapping `belowNav()` in another `calc()`.** §8.
7. **Passing `line.label` anywhere near the email.** §6.
8. **Deleting the family bound because a family legitimately wants five tiles.** It is a bound
   for a reason. §5.
9. **Believing a comment that describes another file or a future step.** §8.
10. **Editing anything in this folder without re-rendering both fixtures.** §6.

---

## 11. `FAMILIES` is not dead, whatever the comments say

Two comments in `v2-data.ts` state that the old 32-tile `FAMILIES` constant is dead and that
Step 2 deleted it. **Neither is true**, and a session that believes them will delete a constant
the board still depends on.

What actually happened:

- **`FAMILIES` is still exported** and still holds the pre-merge 32-tile grouping.
- **`buildCatalog()` still walks it** (`v2-data.ts:786`). For each of its tiles it looks up
  `CURATION[tile.sap]` and, where there is one, resolves that product's rows into a
  `V2Resolved` with **ranked** base/shade lists — the 90-day ordering that decides which colour
  a drawer pre-selects and which one leads the column.
- `buildBoard()` calls `buildCatalog()` once and passes `catalog.byTile` into `resolveGroup` for
  every member. So a member that is one of the 32 curated products keeps its ranked lists
  exactly as the old board gave them, and a member that is not gets its options straight from
  the payload in `sortOrder`. **One code path, both cases.**

So `FAMILIES` + `CURATION` are the **curation source**, and `BOARD` is the **layout**. What *did*
die is `FAMILIES` as a source of layout and of art: `tileArtFor` and `variantImage` were switched
to read `BOARD` at **c98b4e8c**, and `FAMILIES.slug` has been read by nothing since.

**If you want to remove `FAMILIES`,** the curated rankings have to move somewhere first — they
are not derivable from `BOARD`, which carries member *order* but not each product's base/shade
ordering. That is a real piece of work, not a tidy-up.

---

## Appendix — the commits

| commit | what changed |
|---|---|
| `d054a028` | `BOARD` lands beside the live 32-tile board, consumed by nothing. `V2Member`, `V2BoardTile`, `buildBoard`, `tileKeyForMember`, Scheme A, `assertOwnRows`. |
| `1129427d` | The page points at `BOARD`. 32 tiles → 36; a tile can hold several products. `addLines` / `existingFor` / `countsByTile` key on the TILE KEY. |
| `b088d8c7` | Stored lines migrate onto the current board, on read. Two cases. |
| `61ee8cc7` | The rail grows a member level; a merged tile becomes orderable. Nested quantity state. The drawer returns the WHOLE tile. |
| `3eecd041` | The two-level rail is replaced by a product strip after one commit. The orphaned-line hazard is reproduced and reported. |
| `0c78d5b5` | The three-case migration. Case 3 stops the deletion. |
| `4165b750` | The rail rewrite — 60px tiles, names below, `BigTile`. Toggle becomes two named products. Three layout shapes. |
| `33067b14` | The base glyph 800 → 600; air moves between pack rows rather than inside them. |
| `c98b4e8c` | 25 product photos; the cart stops showing the leader's tin; `tileArtFor` stops reading the dead `FAMILIES`. |
| `e8779ce3` | A tile's leader inherits the tile's art — a rule, not a copy. `damp-base.webp` removed. |
| `7dca6d31` | Four tiles borrow a photo by alias. Membership trims. Numbered bases lose a redundant caption. |
| `df445f08` | Pinned members (`option?`). Wood Primer becomes two. `memberLabelIn` matches on baseColour. |
| `5e4f2754` | The fourth layout — categories on top, products in the rail. Thirteen pins. The category guard. |
| `084520be` | The four-per-family assertion becomes a 2–8 bound. Hydro PU is Wood's fifth tile. |
| `94426d44` | The category tile regroups by RANGE, not by function. No key moves. |
| `7a9fd300` | Sent orders live 5 IST days; `MAX_SENT` 300; a saved draft can have a name. No version bump. |
| `0c9f0ab0` | One order sheet used twice; cards for both lists; merge-on-add; Continue does not delete; the bottom nav comes back. |
| `a5767810` | The detail becomes a SCREEN, not a sheet. Tins leave the list card. The last unit total goes. |
| `a9732a8a` | One type scale (ten roles). Icon chips, count first. `FilterChip` shared. `GroupButton` gone. |
| `bba21b8c` | `belowNav` — the flat calc. `DETAIL_PAD` includes the footer. Urgent goes amber. |
| `3c713282` | The delete icon is lit. 25 × 800 → 0; T11. The Note row may wrap. `CLAUDE_UI.md §1` corrected. |

---

*Written 2026-09-08 against the working tree at `3c713282`. Every count in it was taken from the
code on that date, not from a report. If a number here disagrees with the file, the file is
right — recount and correct this document.*
