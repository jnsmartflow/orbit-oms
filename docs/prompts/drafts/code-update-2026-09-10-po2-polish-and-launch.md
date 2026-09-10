# code-update · 2026-09-10 · /po2 polish and launch

**Type:** `code-update` — SHIPPED work, written after the fact.
**Status:** draft, pre-canonical. **Merge as current reality at the next consolidation.**
**Module:** `/po2` (was `/po-v2-8f4kd2`).
**Predecessor record:** `docs/prompts/drafts/code-update-2026-09-08-po-v2-board.md`.

---

## Read this first

**v2 is LIVE at `/po2`.** It is **public**, with no session, exactly as `/po` is. `/po` is
**still live** and is the fallback; nothing about it changed except one stale comment.

**It has no canonical file and no row in the router (`CLAUDE.md §3`).** That was correct while it
was a hidden test address. **It is no longer correct.** A live production module gets its own
canonical file plus a router row, and `/po2` now qualifies on both counts: it is reachable by
anyone, it is being used by salesmen, and its behaviour is documented nowhere a session would
find by following the router.

**This draft argues that it qualifies. It does not do the work.** Creating
`docs/CLAUDE_PO2.md` and adding the router row is a **consolidation job** with its own
reconciliation pass, and doing it here would produce a canonical file nobody had reviewed. This
prompt deliberately created no canonical file and touched no router.

Paths below are the **new** ones, `app/po2/`. The old folder name appears only where history
requires it.

### Commit verification

All 34 hashes below were confirmed present on `origin/main` with their subjects read from
`git log`, 2026-09-10. **No hash was missing and no subject contradicted its claim.**

| Group | Hashes |
|---|---|
| Stepper + labels | `e16f7a59` `fdf31da8` `5e3319de` `c4a4eb90` `eb6d8e2f` |
| Compare mockup | `1882c9bc` |
| Favourites | `a988ab41` `f4c0444c` `bc2cad7c` `b54ae21c` `73cceb16` |
| Frozen keys | `479f74d8` `3aa2c200` |
| Board art | `4cc6ff2e` `91f2bf53` `3cd56262` `49f48298` `2ac3da61` |
| Grouping + data | `66bef27d` `77674f1e` `4e8ca379` |
| Headers + chips | `cd85e189` `120cc5a3` `c76067e5` `9f42be29` `c5631c74` |
| Identity + splash | `e2bc0ad3` `d17354ce` |
| Interaction | `0d1ca1eb` `34384765` `3421f1bc` `fd8a7b43` `8954014a` |
| Launch | `145b5f32` |

### Guard numbers at the time of writing

```
BOARD_INVARIANTS violations : 0
tiles                       : 37
broken art paths            : 0
cut-out / legacy / blank    : 34 / 0 / 3
blank tiles                 : Stainer/GVA, Wood/Hydro PU, Wood/Thinner & More
npx tsc --noEmit            : 0 errors
email fixture 1             : 115 bytes
email fixture 2             : 499 bytes
missing shades              : 56 total = 22 colourant + 34 finished
```

⚠ Every blank tile is blank **on purpose**. Thinner & More joined the list in `77674f1e`
because its photograph was of a different product, and a tin that is not the thing is worse
than no tin.

---

## 1. The route, as it now stands

**`/po2`, public, no session.** Fourteen files:

```
app/po2/  page.tsx  po-v2-page.tsx  product-drawer.tsx  product-search.tsx
          review-screen.tsx  customer-list.tsx  drafts-sent.tsx  order-sheet.tsx
          v2-sheet.tsx  v2-search-input.tsx  v2-data.ts  v2-storage.ts  v2-email.ts
          manifest.webmanifest/route.ts
```

**The old address is a permanent redirect**, `app/po-v2-8f4kd2/page.tsx`, a server
`redirect("/po2")` with no client bundle. Anyone who typed, bookmarked or installed the old
address keeps working through the switchover.

⚠ **This is deliberately unlike `/order`**, which was retired in July 2026 and **parked with a
404, no redirect**. The rule is the same in both cases and the facts are opposite: `/order` had
**no successor**, so a redirect would have implied one. `/po-v2-8f4kd2` has a successor. Removing
this redirect is P3 on the ROADMAP.

### The containment rule, and its three documented exceptions

**v2 modifies nothing outside `app/po2/`.** Colours are exported constants used as inline
styles, never CSS variables in `globals.css` and never entries in `tailwind.config.ts`. Shared
logic is **copied in with its source named**, so the module is readable in one place and
removable in one command.

Three read-only imports are documented exceptions:

1. **`lib/place-order/email.ts`** (`v2-email.ts`) — the wire builders. Reimplementing the format
   would drift from `/po` the first time somebody edited the original, and the drift would be
   silent: the mail still sends, the parser just stops recognising the product.
2. **`lib/place-order/mobile-search.ts`** (`product-search.tsx`, `product-drawer.tsx`) — the
   tested matcher. A second matcher is a second set of results for the same word.
3. **`components/shared/orbit-wordmark.tsx`** (`po-v2-page.tsx`, **splash only**) — see §13.

`lib/place-order/pack.ts` is also imported by `v2-data.ts` for `packStep`, `packKey` and
`sortPacks` — see §4.

### Relationship to `/po` and `/place-order`

Three screens share one catalogue endpoint, `/api/order/data`, and one wire format. `/po2` and
`/po` are **peers** today. `/place-order` is the desktop page and is **not** retiring.

**Ownership boundary:** `app/po/` is off limits to v2 — no imports from it, no edits to it. The
one exception in this session was a single stale comment at `app/po/po-page.tsx:2314` naming the
old folder path.

---

## 2. What the launch gate found

**This section is the one a future session will thank us for.** None of it was changed; all of
it was discovered by reading the code before the rename.

### middleware's prefix match

`middleware.ts:36` is:

```ts
if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();
```

**`startsWith`, a prefix match.** `PUBLIC_PATHS` carries `"/po"`, so **`/po`, `/po2`,
`/po-v2-8f4kd2` and anything else beginning `/po` is public.** No middleware edit was needed to
go live, and none was made.

The `"/order"` entry does the same thing: it keeps `/orders` public, which its own comment
records as a deliberate second reason for keeping it after `/order` retired.

🔴 **NEVER NAME A ROUTE THAT MUST BE PRIVATE WITH ONE OF THOSE PREFIXES.** `/portal`,
`/policies`, `/po-admin` and `/orders-export` would all be public the moment they existed, with
nothing in the new route saying so.

### `/po` has been public for months

This is not new exposure. `app/po/page.tsx` and `po-page.tsx` contain **no `useSession`, no
`auth()`** — grep returns nothing — and `po-page.tsx:3789` says so in its own comment. v2 being
public changes how easy the page is to find, not what is protected.

### Orders leave by `mailto:` — there is no server send route

```
review "Send order"
  -> handleSend()                         po-v2-page.tsx
  -> buildV2Email({dealer, shipTo, lines, order})   v2-email.ts
  -> buildV2MailtoUrl(subject, body)
  -> window.location.href = "mailto:surat.depot@akzonobel.com?subject=…&body=…"
```

**No API route sends mail.** The order leaves through the user's own client, from their own
address. **No forged order can be pushed into the depot through this app**, there is nothing to
rate-limit, and nothing to abuse. The exposure is a read, not a write.

### 🔴 P0 — `/api/order/data` is unauthenticated

`app/api/order/data/route.ts` has **zero session checks**, and its own header says so: "Public,
unauthenticated endpoint". Any request returns **every customer name, code and area the depot
holds** (`mo_customer_keywords`) plus the entire active catalogue and pack list. **No rate
limit, no origin check, no referer check** — grep for `rateLimit`, `Origin`, `referer` returns
nothing.

⚠ **Gating it must ship ALONE.** It is shared by `/po`, `/po2` and, through its sibling,
`/place-order`. And **it swallows its own errors and answers 200 with empty arrays**
(`route.ts:140`), so a wrong gate does not throw — it hands a salesman standing in a shop a
board with no products and no explanation. Prove who calls it first, then verify `/po` still
loads a full board **while logged out**, before and after.

**Putting a login on the page while this stands would be theatre.**

### No order records who sent it

**Neither version stamps a sender.** `/po` has no session at all. v2's `snapshotOf` stores
`customer`, `lines`, `shipToCode`, `dispatch`, `callTarget`, `marker`, `crossDepot`, `notes` —
no user, no id, no name. **The From address is the only trace.**

🔴 **This is an open design decision, named here so it is not discovered later.** The moment
`/po2` sits behind a login the app will know who the salesman is and the order still will not
say. If two salesmen share a handset, or if the send ever moves server-side, that identification
is gone.

---

## 3. Frozen tile keys

**A tile's `key` no longer derives from `members[0].sap`.** `479f74d8` removed the invariant
that enforced it; every tile now carries an **explicit key literal whose value is exactly what
it derived to on that day**.

**Four invariants remain** in `BOARD_INVARIANTS` (`v2-data.ts`): a tile must have members, two
tiles may not share a key, a family must hold between `FAMILY_MIN` and `FAMILY_MAX` tiles, and
every member must resolve. The removed fifth was `key === members[0].sap`.

### Why — the failure it prevents

`addLines` filters `l.tileSap === tileKey` (`po-v2-page.tsx`). **A tile whose key names a member
that has LEFT the tile silently deletes every stored line filed under it** the next time the
drawer adds anything. Not an error — a deletion the salesman never sees. This is the VELVETINO
incident, and it is why two proposed reorders were **refused** rather than shipped, and why
Spray Paint (`2ac3da61`) **removed** the More Interior tile instead of renaming it: removing a
tile leaves its key naming nothing, which is safe; renaming leaves it naming a departed member,
which is not.

`3aa2c200` shipped the two reorders the freeze unblocked.

### The four stores carrying tile keys

```
po2_draft            the live draft         (line.tileSap)
po2_saved_drafts     saved drafts           (line.tileSap)
po2_sent_orders      sent orders            (line.tileSap)
po2_fav_products     favourite products     (fav.key)
```

A key change is therefore a **data migration**, not a rename.

### `migrateLine`'s three cases

It identifies the member from the **ROW** (`product ?? subProduct`), never from `tileSap`.

1. **The line's member now lives on a different tile** → refiled under the new tile key.
2. **`tileSap` names no live tile** → the line is returned **unchanged — the SAME object**. It
   renders, it sends, it does not badge. This is the documented correct end state for a product
   that left the board.
3. **An orphan** → refiled under its own sap.

⚠ **Case 2 is idempotent, and the identity comparison is why.** `migrateLines` compares each
result to its input by reference; if nothing moved, every result is the same object, the array
is unchanged, and **nothing is written back to localStorage**. Returning a shallow copy would
rewrite the store on every read.

---

## 4. The step rule and the pack sort

### One owner for the step

`lib/place-order/pack.ts` owns the carton step for **both** `/po` and `/po2` (`fdf31da8` — v2
adopted `PRODUCT_CARTON_OVERRIDES` rather than keeping a second table).

🔴 **Units are stored directly. The step drives only the +/- buttons and the box hint.**
`e16f7a59` removed `snapToBox`, which rounded a typed figure to the nearest whole carton — nine
typed on a six-per pack became twelve. **A typed 9 is stored as 9.** The depot can pick part of
a carton; a salesman who could not ask for nine was the larger problem.

### The pack sort — `4e8ca379`

🔴 **`packToMl` returns 0 for every KG, GM and PC pack** (`pack.ts:47`), because they are not
litres. The API's `sortRawPacks` (`app/api/order/data/route.ts:21-28`) compares `packToMl`, so
for a KG product it compares **0 against 0**, the sort is stable, and the packs come back in
**database insertion order**. Acrylic Distemper arrived as `10KG, 20KG, 5KG`.

v2 now routes both its display labels and its `packOrder` through **`sortedPacks()`**
(`v2-data.ts`), which wraps `pack.ts`'s **`sortPacks`** — that function already has a dedicated
KG branch comparing the numeric pack code. **pack.ts already knew how; no second rule was
written.**

**Six of 347 multi-pack rows reordered. Every one is KG. No ML or L product moved.**

```
PROMISE SMARTCHOICE / Acrylic Distemper   10,20,5      -> 5,10,20
VT CONCRETE FINISH                        5,10,25,15   -> 5,10,15,25
MAGIK / BRILLIANT WHITE                   1,10,2,20,5  -> 1,2,5,10,20
MAGIK / 90 BASE                           1,10,2,20,5  -> 1,2,5,10,20
ACRYLIC DISTEMPER / DUWEL                 10,20,5      -> 5,10,20
ACRYLIC PUTTY                             1,20,5       -> 1,5,20
```

### 🔴 This changed v2's EMAIL for those six, and diverged it from `/po`

`packOrder` feeds `v2-email.ts`, so a Distemper line now emits `5KG*1, 10KG*2` where it used to
emit `10KG*2, 5KG*1`.

Sorting only the display would have left the drawer, the review screen and the email
disagreeing, which is worse than the bug. So both were sorted.

⚠ **`/po` still has the defect.** Its `sortPackEntries` (`po-page.tsx:101`) uses the same
`packToMl`. So v2's wire is now **correct and different from `/po`'s**, which cuts against the
fixture guard's stated purpose of byte-identity.

⚠ **THE FIXTURES COULD NOT CATCH THIS AND DID NOT.** Both contain only L-unit products.
**A green fixture check is not a statement about KG.** Anyone reading "the wire has not moved"
after a pack-ordering change must confirm the unit class themselves.

⚠ **`/place-order` has the same defect and is NOT retiring.** Fixing `pack.ts`'s `packToMl`
would touch all three screens at once.

---

## 5. Grid labels

**Centred, one size, on a fixed two-line block, and a long name WRAPS.** `TILE_LABEL_PX = 11`,
`lineHeight: 1.2`, `minHeight: 2.4em` — in `em`, not pixels, so the block is two lines whatever
the size becomes. `min-height` and not `height`, because a label that legitimately runs to three
lines must be allowed to rather than be cut through the middle of the third.

### 🔴 Record the mistake, because a future session will be tempted to repeat it

An earlier pass (`5e3319de`) sized **every** label to fit the **longest** string in the grid.
One defective name dragged **198 of 221 labels down two sizes**. `c4a4eb90` reverted it: the
size is fixed at 11px and a long name wraps.

**Do not "fix" the wrap back into a shrink.** Fitting the worst case by shrinking everything
optimises for the one tile nobody is looking at.

⚠ `overflowWrap: "anywhere"` is a **safety net, not the wrap rule**. Words still break at spaces
wherever they can; it only lets a single run wider than the cell break mid-word rather than
spill. Today that is one string, `FASTYELLOWGREEN`, and it is a data defect (§21).

---

## 6. Drawer labels and the flat-member heading rule

### A member label never repeats its parent tile's words

`eb6d8e2f`. Inside the Gloss drawer, a member reads "Matt", not "Gloss Matt" — the tile above it
already said Gloss. **"& More" tiles are exempt**, because their label names a category rather
than a product, so "NC Wood Thinner" under "Thinner & More" repeats nothing.

### 🔴 A flat product's heading names the PRODUCT — `77674f1e`

The pane's `NameBar` read:

```tsx
value={selectedOption ? selectedOption.value : cur.label}
```

Correct for a **standard** product, where the pane shows exactly that one option's packs. **A
lie for a FLAT one**, where the pane is `FlatBody` and renders **every** option with its own
stepper — naming one of them picks a winner out of a list the salesman is looking at.

**The symptom was Velvetino**, headed "GOLD" where its own name belongs. **It was never about
Velvetino.** Walking the live catalogue found **six** flat members reading a shade or a base
instead of a product name:

| Tile | Member | Showed |
|---|---|---|
| More Enamels | M900 Gloss | BRILLIANT WHITE |
| Spray Paint | Spray Paint | BRILLIANT WHITE |
| Luxury Finish | Velvetino | GOLD |
| Machine Tinter | Machine Tinter | YOX |
| Acotone | Acotone | NO1 |
| GVA | GVA | RED OXIDE |

**The fix is the rule, gated on the existing `matrixMode`, naming no member.** The other **37**
non-flat members that correctly show an option are unchanged — do not "simplify" this to always
show `cur.label`.

🔴 **The general lesson: a wrong claim is never in one place only.** When one member's heading
falls back to a shade, check every member before fixing the one that was reported.

---

## 7. The art pipeline

```
public/PO/board/<slug>.webp     board tiles
public/PO/drawer/<slug>.webp    drawer rail members
```

`artPath(slug, kind)` picks the folder by **which resolver is asking**, not by a flag on the
file. `public/category-images/` is LEGACY and shrinks.

### 🔴 ONE constant decides three things at once

**`TRANSPARENT_ART`** (`v2-data.ts`). A slug in that set means all three of:

1. read from `/PO/` rather than the legacy folder,
2. **no pale square** behind the tin,
3. the two-layer `drop-shadow`.

**Do not build two parallel switches.** These three always travel together, and a second flag is
how a tile ends up with a shadow and a square.

### The shadow, verbatim

```
CUTOUT_SHADOW      drop-shadow(0 1px 1px rgba(27,24,38,.10))
                   drop-shadow(0 8px 10px rgba(27,24,38,.16))
CUTOUT_SHADOW_RAIL the same, scaled ~0.7x for the 60px rail cell
```

🔴 **`drop-shadow`, NOT `box-shadow`.** `box-shadow` follows the element's rectangle; a cut-out
has no rectangle, so it would draw a shadow around empty space. `drop-shadow` follows the
**alpha channel**, so it follows the tin's own outline.

⚠ **The rail's factor is 0.7 and is not copied from the board's 79px cell.** A shadow tuned for
79px reads as a smudge at 60px.

---

## 8. Background removal — three rules, each with the case that produced it

1. **Uniform background of any colour** → **flood-fill from the border**. Cheap, exact, no model.
   Most of the catalogue.
2. **The product's own white touching its outline** → **model plus hole-filling**. A flood-fill
   eats into the tin. **Promise Enamel** produced this rule: its label is white and meets the
   edge, so the fill walked straight into the product.
3. **Scenic backdrop** → **model, and expect a fight.** Budget time; some will not come out
   clean and are better left alone than shipped half-cut.

### Two traps

🔴 **An image AI can PAINT a transparency chequerboard into real pixels.** Four PNGs arrived
looking like cut-outs and were opaque photographs of a chequerboard. **Detect it by run-length
analysis of the border band** — a real chequerboard has a constant pitch (measured: 41px, 41px,
57px, 51px runs at 79–100% identical). A naive "is the corner grey?" heuristic reports the
opposite and did.

🔴 **A bottom-fringe clipper shaves the tin's own base rim.** A generic "remove the bottom N
rows of soft alpha" step cannot tell a shadow fringe from the product. Inspect before trusting.

⚠ Never wire a file that is not a genuine cut-out, and never wire one with a coloured background
under `mixBlendMode: multiply` — multiply exists for **opaque white** files and will darken a
coloured ground into mud.

---

## 9. 🔴 THE BLANK-TILE LANDMINE

**An undeclared or misnamed slug renders a BLANK tile with no compile error and no build
failure. `tsc` passes clean.**

`tileImage()` and `memberImage()` check **presence SETS** — `TILE_IMAGES`, `MEMBER_IMAGES`,
`VARIANT_IMAGES`. A slug that is not in the set returns `null` and the tile draws its plain
family wash. To TypeScript a slug is just letters.

**This has bitten twice**, both times found by a filesystem walk and never by the type-checker:
adding `product-supercover` to `TRANSPARENT_ART` and `MEMBER_IMAGES` with no file on disk, and
emptying `TILE_ART_ALIAS`, which blanked five tiles.

🔴 **`TILE_IMAGES` and `TRANSPARENT_ART` must be edited TOGETHER.** `TRANSPARENT_ART` alone
declares a rendering contract for a slug `tileImage()` will never return. `TILE_IMAGES` alone
gives a tile a pale square and no shadow. `77674f1e` removed `thinner` from both, deliberately.

🔴 **The only gate that works is a filesystem walk** over every tile and every member, resolving
each through `boardTileArtFor` / `memberImage` / `tileImage` and checking `fs.existsSync`.
**A clean `tsc` is not evidence.**

⚠ **This belongs in `CLAUDE_CORE.md`'s landmines section at consolidation.** It is a
general-purpose trap — a presence set checked at runtime with no compile-time link to the
filesystem — not a `/po2` curiosity.

---

## 10. Favourites

### Products — tile grain, not member grain

**`po2_fav_products`, version 2, keyed on the BOARD TILE key.** Cap **8**, sorted **A-Z**,
**pruned on read** (`loadFavProducts` drops any key `boardTile()` no longer resolves).

🔴 **Member grain was tried first and was wrong.** `a988ab41` shipped member grain; `b54ae21c`
corrected it after the owner saw it live. A favourite is a **place on the board he taps**, not a
catalogue row: starring "Gloss" and getting one of Gloss's forty options back is not what the
star meant. The `{sap, at}` → `{key, at}` migration runs on read, and version 2 is what marks a
store that has been through it.

⚠ **A tile key change silently deletes a favourite** — see §3. `po2_fav_products` is the fourth
store carrying tile keys.

### The entry point is an always-visible header icon

`bc2cad7c`. The gear first lived **on the Favourites card**, and that card **hides when there
are no favourites** — so a phone with none had no gear and no way to make one. Reported from a
real phone. The gear now rides in the page header, on a row that is always drawn, and the
drawer star came out.

⚠ **That row scrolls away.** Only the search row below it is sticky, by an earlier decision that
a logo need not follow a salesman down a page. The gear is always **there**; it is not always
**on screen**. If that matters, move it into the sticky row — do not make it conditional again.

### Dealers — TWO stores — `73cceb16`

| | Key | Shape | Seeded from |
|---|---|---|---|
| Customer picker | `po2_starred_dealers` | `{version:1, dealers: V2Star[]}` | its existing migration chain |
| Ship-to picker | `po2_starred_shipto` | identical | **nothing — starts empty** |

Both screens used one list until now, so starring a delivery address promoted it among the shops
he bills, and every shop he bills was offered as a delivery address. **They answer different
questions:** "whose account is this billed to" versus "where do the goods physically go", and
ship-to routinely names a third party he has never billed.

🔴 **The star's filled state comes from the ACTIVE mode's list**, never from a merged set and
never from "is this code starred anywhere". The same dealer can be a customer favourite and not
a ship-to favourite, and both screens must render that correctly at once. Verified across all
four combinations.

⚠ **Only the customer list carries the migration chain**
(`po2_fav_customers` → `po2_my_dealers` → `po2_starred_dealers`). Ship-to is never seeded — every
star that exists was made on the customer picker, and seeding would hand every salesman a
delivery shortlist he never chose. Reading an absent ship-to list also **writes nothing**, so
the key stays absent rather than appearing because a screen was opened.

⚠ **Both legacy keys are read-only seeds with zero call sites outside `v2-storage.ts`.** Left in
place; named here so a cleanup can find them.

### 🔴 An open decision: dealer favourites have no cap of 8

`MAX_STARRED = 200`, documented in its own comment as **a storage fuse, not a policy** — nothing
evicts at forty. v1 caps favourites at **8**, sorts A-Z and **blocks the ninth**. v2's product
favourites cap at 8. **v2's dealer favourites do neither**, and evict the oldest rather than
refusing.

**That inconsistency is unresolved and is recorded in §21.**

---

## 11. Shade colours

**`SHADE_HEX` (`v2-data.ts`) is hand-authored, keyed on the exact `baseColour` string
uppercased.** **The catalogue has no colour column** — `mo_order_form_index_v2` supplies only the
shade NAME. `shadeHex(value)` trims and upper-cases, so lookup is case-insensitive.

🔴 **Its rule is never to guess.** Not a nearest match, not a hash of the string — a name that is
not in the table gets **no colour and a text chip**. *"A wrong colour on a paint order is worse
than no colour: the salesman reads the swatch, not the code, and a plausible-but-wrong brown
ships the wrong tin."*

### `4e8ca379` added 13, **sampled from the printed Dulux enamel shade card by Smart Flow,
2026-09-10**

🔴 **That provenance is what satisfies the rule.** A value may go in when somebody can say where
it came from. Note this is a **different source** from the block above it, which came from
dulux.in's per-shade pages — so if one of these thirteen is ever questioned, **the card is what
to check it against**, not the website.

```
ROYAL IVORY #F5CF98   SKY BLUE #2EA4C5      LIGHT GREY #CCCCCB
DAWN #D8BAA3          MINT GREEN #419343    DEEP GREEN #1D2F28
TRUCK BROWN #634F35   WILD PURPLE #A7A3C8   AQUAMARINE #53B88D
OFF WHITE #F3D5A0     PALE CREAM #E7C482    CASCADE GREEN #A2AF73
OPALINE GREEN #7C9971
```

**Nine submitted values already matched the stored value exactly** — MIDDLE BUFF, DARK BROWN,
GOLDEN BROWN, SMOKE GREY, GOLDEN YELLOW, PO RED, PHIROZA, BUS GREEN, SIGNAL RED, OXFORD BLUE,
LEAF BROWN. Nothing to do. **BLAZING WHITE** came with no value and stays unmapped.

### 🔴 FIVE CONFLICTS, UNRESOLVED

| Shade | Stored (dulux.in) | Sampled (card) |
|---|---|---|
| **CHERRY** | `#5C2428` | `#DB7680` |
| MAHOGANY | `#6E2C1F` | `#623133` |
| DA GREY | `#6E7175` | `#5C6061` |
| SAND STONE | `#9A7C62` | `#B28D80` |
| DEEP ORANGE | `#D2540B` | `#CB390D` |

🔴 **CHERRY is not a close call and needs looking at first.** `#5C2428` is a **dark maroon**;
`#DB7680` is a **salmon pink**. Those are not two readings of one swatch — one of them is a
different colour, and CHERRY appears on **Gloss and 5in1 Gloss**, both high-volume.

The other four are plausibly two readings of the same chip. **None was overwritten**: an
authoritative published value is not replaced by a sampled one without somebody choosing.

### The fallback, and four rules that must not be simplified

**The fallback splits by kind** (`product-drawer.tsx`):
- **A BASE** gets a **text badge** — "BW", "90" — and never a colour. A tinting base has no
  colour until it is tinted.
- **A SHADE with no hex** gets `fill: undefined` and `badge: null`, so the square falls through
  to the **plain family wash with nothing in it**. The name appears only in the caption below.
- Smart Choice's five shades are the exception: no hex, but they resolve a `variantImage`, so
  they show a tin photograph.

🔴 **PHIROZA and PHIROZA BLUE are deliberately different colours on different products.**
`PHIROZA` is `#0081B0` (Dulux's own published value, on PU Enamel / Gloss / 5in1);
`PHIROZA BLUE` is `#1B8A9E` (hand-authored, on M900 Gloss / Promise Enamel). They never meet in
one rail column. **Do not copy one across to the other.** If Dulux publishes a Phiroza Blue page,
take that value.

🔴 **SIGNAL RED and SIGNAL RED PLUS must never be conflated.** Two different products. `SIGNAL
RED` (`#B3312C`) is on Gloss, WS Protect and Floor Plus. **`SIGNAL RED PLUS` has no hex** and is
on Floor Plus only.

🔴 **The colourant codes are never to be mapped.** Every Acotone (`NO1`, `XY1`…) and Machine
Tinter (`YOX`, `TBL`…) code, 22 names in all, plus GVA GREEN. They are colorant codes, not
finished shades.

⚠ **Roughly half the 34 remaining unmapped names are not colours at all** — `Clear`, `Int
Clear`, `Ext Clear`, `2in1 Primer`, `Interior`, `Ext Primer`, `Promise Primer`, `Acrylic
Distemper`. A swatch cannot represent clear varnish. Moving them to the never-map list is in §21.

⚠ **Universal Stainer is a stainer and carries ten hexes**, including `FASTYELLOWGREEN`. That
contradicts the colourant exclusion and is unresolved (§21).

---

## 12. Identity — three sets of letterforms, two icon sets

**The real logo** is `components/shared/orbit-wordmark.tsx` — outlined **path data**, one
`<path>`, `viewBox="0 0 2316 769"`, aspect **3.0117**, generated by
`scripts/generate-wordmark.mjs` from `scripts/fonts/PlusJakartaSans-Bold.ttf` at -0.046em
tracking. Ten call sites across login, `/po`, both sidebars, attendance and trips. Colour comes
from `currentColor`; it takes `height` and `className` and **has no colour prop**.

**v2's local `Wordmark`** (`po-v2-page.tsx`) is **live text** — a `<span>` reading "Orbit" in
`font-sans font-bold` at -0.045em, resolving through `tailwind.config.ts` to `var(--font-sans)`,
Plus Jakarta Sans via next/font with `display: "swap"`. Same typeface, so nearly the same
letterforms; it can fall back to system-ui if the download fails.

**A third set lives in `public/brand/`** — `orbit-wordmark.svg` and `-white.svg`,
`viewBox="0 -22 2216 771"`, aspect **2.8742**. A different aspect ratio means a **different
design**, not a different export: these are the older hand-built outlines whose O read as a zero.
**Referenced by no code.**

### What `d17354ce` changed

v2's app icons pointed at `public/brand/`, on the belief that those were v2's own mark and the
root icons were a "teal Orbit ring". **Both halves were wrong**, established by inspecting the
pixels. The root icons were regenerated 2026-09-09 from `public/icon-source.svg`, which carries
the **same generated outlines** as the shared component — a violet tile with the real wordmark,
no ring anywhere. `public/brand/` carries the superseded drawing. **v2 was showing the superseded
mark on the one surface a salesman sees every morning.** All three references now point at the
root set. All six icon files are **fully opaque**, zero transparent pixels, so none depends on a
background.

### Three manifests

```
public/manifest.json                      the app   background #f9fafb  theme #7C3AED
public/po.webmanifest                     /po       background #7C3AED  theme #F5F3FF
app/po2/manifest.webmanifest/route.ts     /po2      background #FFFFFF  theme #F5F3FF
```

⚠ **Consolidating them waits for `/po`'s retirement.** The separate `id` / `scope` / `start_url`
is exactly what keeps the two home-screen apps from folding into one.

### The manifest `id` decision

**`/po2` is a DIFFERENT PWA from the old address.** Its `id` is `"/po2"`, and an installed PWA is
keyed on `id` — so it **installs alongside** the old one rather than replacing it. **That is why
the rollout message says to delete the old Orbit app first.** Two identical icons on one home
screen is how an order gets sent twice. The redirect rescues **the address, not the install**.

### The title is "Orbit" from the first `/po2` install onward

It read "Orbit v2" while the address was hidden, with a note saying to revert when v2 replaced
`/po`. **That was the wrong moment to pick: neither platform re-reads the name.** iOS and Android
cache the title and icon **at install time**, so everyone installing at `/po2` would have had to
delete and re-add later purely to lose a version number. **The final name from the first
install, chosen deliberately so nobody reinstalls twice.**

---

## 13. The splash

**White ground, the mark in `BRAND`, "Trail" motion, 640ms.** A 6px dot runs the width of the
word dragging a fading gradient tail, which resolves into the solid rule that is the end state.
Three layers; the mark is readable at 380ms and the line lands at 640ms. Spec:
`docs/mockups/po-v2/splash-motion.html`, keyframes lifted verbatim from its "ready to lift"
block. Keyframes are prefixed **`v2Splash*`** to sit beside `v2SheetUp` / `v2ScrimIn` and stay
clear of `globals.css`'s `orbit-rise` / `orbit-draw`.

### 🔴 Why the splash uses the SVG and the board does not

**The splash is the earliest paint in the app.** The local component is live text loaded with
`display: "swap"`, so on a cold start it drew "Orbit" in the phone's **system face and then
swapped it under the reader** — on the one screen whose entire job is to say whose app this is.
**Outlined path data has no such moment**: correct in the first frame, and on a device with no
network at all.

⚠ **The board masthead keeps the local text, deliberately.** By the time the board renders the
font has arrived, and the masthead is the one place a size can be nudged without dragging ten
other screens with it.

### The size conversion

🔴 **`OrbitWordmark` takes INK height; the local component takes FONT size.** The viewBox is cut
tight to the letters — **769 units of a 1000-unit em** — so:

```
SPLASH_WORDMARK_INK = 33.8      // 44px font size x 0.769
```

Passing 44 straight through would have drawn the mark **~30% too large**. The login page made
exactly that mistake once, at 66 for 45.

⚠ **The ratio lives at `docs/CLAUDE_UI.md:411-416`, inside §12 Login page — NOT in §60.** §60 is
the mobile card type scale. The rule's closing sentence: *"Anyone specifying this component in px
must say which of the two they mean."*

⚠ Colour comes from a **wrapper** carrying an inline `color`, because `OrbitWordmark` paints with
`currentColor` and accepts no colour prop.

### 🔴 The splash must never gate the load

**No timeout, no minimum duration, no "animation finished" state.** The `load.kind === "loading"`
branch is the only thing deciding whether the screen exists. If the catalogue arrives at 300ms
the splash goes at 300ms, mid-animation, and **that is correct** — a salesman opening a warm app
should see a flash and nothing more.

⚠ **`prefers-reduced-motion` lands on the FINISHED state**, not a blank one: every layer rests on
its arrived value, so `animation: none` shows the mark and the solid rule instantly.

---

## 14. The type scale

| Constant | Owns | Value |
|---|---|---|
| `MASTHEAD_WORDMARK` | board masthead wordmark | `31` (a **font size**) |
| `SPLASH_WORDMARK_INK` | splash wordmark | `33.8` (an **ink height**) |
| `SCREEN_TITLE` | dealer and ship-to picker titles | `20 / 700 / -0.02em / 1.25` |
| `DEALER_TITLE` | checkout header's dealer name | `17 / 600 / -0.02em / 21px` |

⚠ The first two are **not interchangeable** — different units for the same visual size. Never
point one at the other. The splash's white 44 is a literal, deliberately not routed through the
constant.

### Why `SCREEN_TITLE` and `DEALER_TITLE` forked

`SCREEN_TITLE` is *"the biggest text on the screen, and it names the screen"* — one line, alone,
nothing beside it. That still describes both pickers. **The checkout header stopped being that
shape:** the name shares its row with two 44px icon buttons and its column with a code line, and
it has to **wrap** in what is left. At 20px it fitted about 17 characters a line and cut real
dealers in half; at 17px it fits about 21.

🔴 **`DEALER_TITLE`'s `lineHeight` is px, not a ratio, and that is load-bearing** — the header's
fixed block is two of that line box plus the code line, and arithmetic on a unitless ratio is how
a reservation quietly stops matching what it reserves.

### The fixed two-line block

```
two name lines   21 x 2 = 42
the gap (mt-0.5)        =  2
the code line           = 15
                          --
                          59      -> header 59 + 16 + 16 = 91px, constant
```

🔴 **The reservation is on the BLOCK, not inside the name.** It sat on the name span together
with its clamp, so a **one-line dealer still occupied two lines** and the code line started a
full empty line below the text — a visible hole in every header whose dealer was short, which is
most of them.

🔴 **Why a fixed height at all:** `9f42be29` removed wrapping outright because a header that grew
by a line when a long dealer was picked **shoved the items list down under a thumb already
reaching for it**. The wrap is back and that defect must not come with it.

⚠ **320px still truncates a 35-character name, and that is accepted.** The name column is
**146px** at 320 and **216px** at 390. `AAI SHREE KHODIYAR HARDWARE & PAINT` fits at 390 and
loses two words at 320. Word wrapping is what hurts: the line breaks at spaces, so a long word
strands the rest of its line. The `">"` chevron was **removed** (`c5631c74`) to give the name 22px
back — it fired the same `onOpenDealer` the name already fires.

---

## 15. The chip rows

### Dispatch — three chips with dots, plus a Call sheet — `120cc5a3`

Was four flat chips (Normal, Urgent, Call · SO, Call · Dealer). Now **three** — Normal, Urgent,
Call — each with a 7px dot, and **Call opens a sheet** offering SO or Dealer. That is what `/po`
has always shown and what a salesman actually answers: is this normal, urgent, or does somebody
need phoning. **Who to phone is a second question and gets a second screen.**

🔴 **UI-ONLY. Nothing stored changed and the wire did not move.**

| Stored | Wire, before | Wire, after |
|---|---|---|
| `Normal` + `SO` | line omitted | line omitted |
| `Urgent` + `SO` | `Dispatch: Urgent` | `Dispatch: Urgent` |
| `Call` + `SO` | `Dispatch: Call to SO` | `Dispatch: Call to SO` |
| `Call` + `Dealer` | `Dispatch: Call to Dealer` | `Dispatch: Call to Dealer` |

No union gained a member, no draft needed migrating, `v2-email.ts` was not opened. Normal and
Urgent keep writing `callTarget: "SO"` because that is what the four-chip row wrote —
`V2CallTarget` has no null.

🔴 **The commit rule:** opening either sheet writes **nothing**. Only picking a target or a depot
calls `onOrderChange`. **A half-set "Call" with no target is impossible**, and so is Cross with no
depot.

### Remarks — four chips, one line, equal columns

Truck / Cross / Bounce / DTS, `flex gap-2` with `min-w-0 flex-1 truncate` so equal columns cannot
overflow at any width. **Cross opens a depot picker** and the free-text input is gone.

⚠ **v2 HAD a "None" chip and it is gone.** A fifth chip whose entire job was to un-pick the other
four explained a gesture every phone user already has. **All four now toggle**, which is what
`/po` does, and it is what made a single row possible — five chips do not fit one line at 320px
and four do. **Null is still reachable.**

⚠ **v1 has emoji on these chips; v2 never has and did not gain them.** Four bare words fit with
margin; four words each preceded by an emoji do not.

🔴 **A stored depot is never validated against `CROSS_DEPOTS`.** Drafts saved before the picker
existed hold hand-typed depots — a fifth name, a misspelling, a lowercase one. Those still render
and still reach `buildSubject` exactly as typed. **The list is what the SHEET OFFERS, never a
whitelist**; the moment it becomes one, somebody's saved order loses its depot.

### `DOT_CALL` is red, against `CLAUDE_UI §1`

§1 reserves red for something being **wrong or about to be undone**, and this app ships Urgent in
**amber** precisely because of that rule. **The exception was accepted and is narrow:** a dot is
not a chip, a pill or a button — no text, 7px, and it is the one mark separating "this ships"
from "somebody must be phoned first". It exists because the owner asked v2 to match /po's row,
**and it stops at the dot** — the Call chip's border, ground and text still come from `chipStyle`
like every other chip. **Do not grow it into a red chip.**

### `CROSS_DEPOTS` exists twice

`app/po2/v2-data.ts` **and** `app/po/po-page.tsx:89`, both holding
`["Dahisar", "Ahmedabad", "Rajkot", "Pune"]`. v2 got a copy rather than an import because it
modifies nothing outside its own folder and `/po` is live. **The two must be edited together**
until the fence comes down at cutover. Tracked on `docs/ROADMAP.md` as a P3.

---

## 16. The keyboard

### `keyboardOpen` from a REAL height drop, never from focus — `3421f1bc`

`CLAUDE_UI §55`: *"All floating footers gate on `keyboardOpen` (real keyboard), never
`inputFocused`."* Focus is wrong in both directions — Android's down-caret closes the keyboard
while the input keeps focus, and iOS can focus a field a frame before the keys arrive.

```
THRESHOLD  120px    below this is the URL bar collapsing, not a keyboard
DEBOUNCE   100ms    the open ramp reports several intermediate heights
```

Both numbers are /po's (`po-page.tsx:961`). **One listener for the whole app**, ref-counted like
the body lock, attaching on the first subscriber and detaching on the last. The measure runs on
every ramp frame but only notifies **when the boolean flips** — at most twice per cycle.

### Compact mode needs `keyboardOpen` **AND** `searchOpen`

⚠ **Not the keyboard alone.** The number keypad on a pack row also raises the keyboard, and there
**the product strip is exactly what he needs** to reach the next product. `searchOpen` is what
says "he is choosing from the rail", which is the state the strip and chips are redundant in.

When compact, the **category chips and product strip collapse** via `display: none` — not an
unmount, so the strip's horizontal scroll position and the selected chip survive.

### The gate numbers

At 320x568 with the keyboard up, the sheet is ~290px and the `shrink-0` siblings came to ~379px:

```
before collapse : -89px  for the rail and pane   <- the overflow
after  collapse : +81px
```

**Every sibling above the rail is `shrink-0`**, so `flex-1` collapsed to nothing and the fixed
parts overflowed a section that is `overflow-hidden` **but still scrollable by script**. That
overflow is what let the footer be dragged over the pack rows.

### The sheet goes to 100% of `--vvh` while the keyboard is up

The 94% exists so a strip of screen behind the sheet stays visible. With the keyboard up there is
nothing behind it worth seeing, and at 320px that 6% is **18.5px** — the difference between ~37px
and ~56px of pack rows. Reverts the moment the keyboard goes.

### `PACK_TRAILING`

Replaced `calc(76px + env(safe-area-inset-bottom))`. **76 was the footer's height** (measured
71.5px) — a reservation for a collision that cannot happen, since the footer is a flex sibling.
And the safe-area term **paid for the home-indicator inset twice**, because the footer already
carries it. Now a named **24px**, half a pack row of breathing room, which is what `nearest` still
needs so the last row does not read as half-hidden.

### The footer has its own background

It carried a border and padding and **relied on the section's white being behind it**. That held
until something scrolled the section — then the pack rows slid **under a transparent footer** and
read as printing through the Add button. A bar that sits over content must be opaque on its own
account.

### 🔴 The drawer search no longer auto-focuses on mobile — `0d1ca1eb`

**This was the entry condition for the whole defect.** Tapping the magnifier sprang the keyboard,
which halved the viewport, which produced everything above. Gated on §55's own expression,
`window.matchMedia("(min-width: 768px)").matches`, so it still focuses on a desk.

⚠ **The quantity input's `autoFocus` is NOT this and stays.** It mounts only after a tap has set
`editing`, so it is the tap-to-edit swap, not a mount focus; gating it would mean tapping a number
and getting no keyboard.

⚠ **One rule for clearing the query:** only the X on the search row, or closing the drawer. Three
handlers used to wipe it, so typing "teak" and then **tapping the result** threw the search away
at the moment it had done its job.

---

## 17. Sheet mechanics

### The body-scroll lock runs BEFORE paint — `34384765`

It was a plain `useEffect`, which React runs **after** the browser paints. The slide-up is a CSS
animation, so it starts on that same first paint — and `position: fixed` on `<body>` takes the
document out of flow and **collapses its height**. Frame 1 painted the sheet at `translateY(100%)`
with the page still in flow; the effect then reflowed everything underneath it. **That was the
jitter, and it was never the animation** — `v2SheetUp` touches `transform` only.

It is now an **isomorphic layout effect**: `useLayoutEffect` on the client, `useEffect` on the
server, because the hook is called as a top-level hook from `po-v2-page` and therefore runs during
SSR, where a bare `useLayoutEffect` warns on every request.

🔴 **The internals and the ref counting were NOT touched.** Not one line inside changed — the
`window.scrollY` capture, the saved previous styles, the write order, the count, the
`window.scrollTo` restore. **That is deliberate**, because the hook's own note records a
scroll-position bug: per-sheet locking made the body go `fixed -> static -> fixed` inside one
frame during a handoff, and `scrollTo` clamped to zero against an unsettled layout, throwing the
salesman to the top of the board. The counting plus the page-level lock is what fixes that, and it
depends on the count, not on the timing.

### `useKeepFocusVisible` uses `"nearest"`, not `"center"`

`"center"` was right for a row inside `PackList` and wrong for the **search input**, which sits
outside any inner scroller — so its nearest scrollable ancestor is the `<section>` itself, which
is `overflow-hidden` but **still scrollable by script**. Centring it scrolled the whole sheet,
dragging the footer up over the pack rows.

⚠ **This was the belt, not the braces.** Collapsing the chips and strip (§16) is what stops the
section overflowing in the first place, and **a section that cannot overflow cannot be scrolled by
any `block` value**. `"nearest"` makes the failure impossible rather than unlikely.

---

## 18. Navigation — written for someone who has never seen it

Before this, **eleven of twelve overlays leaked a back press out of the app.** Android's back
button closed nothing and walked off the order; only the favourites picker behaved, through
private history code of its own.

### One live snapshot ref

```ts
const navRef = useRef({ sheet, reviewSheet, favManage, drawer, screen });
navRef.current = { sheet, reviewSheet, favManage,
                   drawer: openTile !== null || openGroup !== null, screen };
```

Rewritten **every render**. A ref, not state — reading it triggers no render, and it is read at
**call** time, so a handler created on the first render cannot capture stale values.

### One ordered closer — the if-chain IS the z-order

```ts
function closeTopLayer(): ClosedLayer {
  const s = navRef.current;
  if (s.sheet !== null) {                       // 1. confirms over ANY screen
    setSheet(null);
    setPendingLoad(null); setRenameTarget(null); setDeleteTarget(null);
    return "sheet";
  }
  if (s.reviewSheet !== null) { setReviewSheet(null); return "reviewSheet"; }   // 2. Call / Cross
  if (s.favManage)  { closeFavPicker(); return "favPicker"; }                   // 3. over the board
  if (s.drawer)     { setOpenTile(null); setOpenGroup(null); return "drawer"; } // 4. over the board
  if (s.screen === "draftDetail") { setOpenDraftDetail(null); setScreen("drafts");   return "detail"; }
  if (s.screen === "sentDetail")  { setOpenSent(null);        setScreen("sentList"); return "detail"; }
  if (s.screen === "dealer" || s.screen === "shipto") {                          // 6. back to review
    setQuery(""); setScreen("review"); return "screen";
  }
  if (s.screen !== "order") { setScreen("order"); return "screen"; }             // 7. back to the board
  return null;                                                                   // 8. nothing open
}
```

**`null` means nothing was open — the board with no overlay, a state the app may be exited from.**
That is correct behaviour, not a bug.

**Why that order.** Screens are mutually exclusive because each is an early `return` from the
component. `sheet` is one enum, `reviewSheet` another, and the drawer and favourites picker each
cover the board with their own scrim — so **at most one overlay sits on one screen**. The order
therefore encodes which layer *would* win, and it follows the DOM: on review, `sheet === "clear"`
renders **after** `<ReviewScreen>`, so it paints over the Call and Cross pickers and is checked
first.

🔴 **It reads the live snapshot and nothing else** — never an argument saying what to close, never
a tag left by whoever opened it. /po makes the same point: its handler *"never reads a pushed
entry's tag, only this live enum"*. A tag can be stale; what is on screen cannot.

**Each branch calls the layer's own existing close, side effects and all.** The load sheet still
drops its pending snapshot, the drawer still takes its search query down by unmounting, the dealer
screen still clears the query, and the clear confirm still clears **nothing** on dismiss.

### One popstate listener, three helpers, two guards

```
openLayer()      forward. pushState once, depth++.
requestClose()   a DISMISS. Pops one entry; the HANDLER does the closing.
commitClose(n)   a COMMIT. The caller already changed state; this only consumes.
```

```ts
const depthRef       = useRef(0);      // entries WE pushed above the base
const suppressPopRef = useRef(false);  // marks a popstate WE caused
```

- **`depthRef`** — without it a close cannot tell "there is an entry to consume" from "we are at
  the base and back means exit".
- **`suppressPopRef`** — without it a commit runs its close twice: once itself, once through the
  handler.
- /po carries a third, `backConfirmRef`, for its discard confirm. **v2 has no equivalent
  confirm**, so it was not ported.

⚠ **The handler decrements only when it ACTS.** A suppressed pop had its depth adjusted by
`commitClose` already; decrementing again would drift the count low and leave stale entries — the
"back does nothing and he presses it twice" failure.

### The dismiss-versus-commit distinction

**This is the thing that looks contradictory in /po until you sort its 29 `history.back()` calls
into two piles.**

- **A DISMISS control and hardware back are deliberately the SAME PATH.** The scrim, Cancel and
  the back chevron call `requestClose()`, which pops one entry; the popstate handler does the
  closing. A button and a hardware press then run identical code and cannot drift.
- **A COMMIT control changes state itself and suppresses the resulting pop.** Picking a depot,
  Clear, Delete, Replace, Add — each does something *more* than close, so letting the handler also
  run would close a second layer or undo the commit. /po splits 19 bare `back()` against 10
  `suppress + back()` for exactly this reason.

### Two details worth knowing

- **Detail screens return to their LIST**, not the board — branch 5, checked before the plain
  screens, so one close is one level.
- **The delete confirm is the only site consuming a variable number of entries**: `2` from a draft
  detail, `1` from the drafts list, read from `navRef` at click time.
- **The favourites picker's private history is gone.** It had its own `pushState`, its own
  `back()` and its own `popstate` listener — the only history code in the folder. It is now an
  ordinary layer. **One authority.**

### 🔴 NONE of this is verified by any tool in this repo

**There is no test runner.** Playwright, Puppeteer, jsdom, Jest and Vitest are all absent from
`package.json` and `node_modules`, and none was added. **`tsc` cannot tell whether a back press
closes one layer or two.** The hand-test list in the session transcript is this feature's only
check, and it must be run on a physical Android phone with a real hardware back button.

---

## 19. The live-draft flush

**This fixed a data loss that predated everything above.**

The live draft is written **400ms after the last change**, in a debounced effect, and was **never
written on the way out**. No `beforeunload`, no `pagehide`, no `visibilitychange` anywhere in the
folder. On a real navigation the component unmounts, the cleanup clears the pending timer, and
**whatever changed in that window is gone** — a back press off the board, a swipe-away, an
incoming call, the OS reclaiming memory.

⚠ **/po has never had this problem** because it saves **synchronously** at every mutation
(`savePoDraft`, ~40 call sites, no debounce). v2 traded that for the keystroke cost and owed this
in return.

```ts
const flush = (): void => {
  const s = liveRef.current;
  if (!s.hydrated) return;
  if (s.lines.length > 0) saveLiveDraft(snapshotOf(s.dealer, s.lines, s.shipTo, s.order));
  else clearLiveDraft();
};
window.addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flush();
});
```

🔴 **`pagehide` AND `visibilitychange`, not `beforeunload`.** `beforeunload` is unreliable on
mobile — iOS Safari fires it inconsistently and Chrome ignores it for bfcache-eligible
navigations. `pagehide` is the one both fire on a real navigation; `visibilitychange` to `hidden`
catches the app being **backgrounded without unloading at all**, which is the commonest way a
depot phone leaves this screen.

🔴 **BOTH PATHS, the same rule as the debounced effect** — lines present saves, **no lines
CLEARS**. Saving only would resurrect an order the salesman had emptied.

🔴 **It reads a REF, and that is the trap it avoids.** The listener is registered **once**, empty
dependency array, so a closure would capture the cart as it was on mount and faithfully save an
empty order for the rest of the session. Putting the state in the deps instead would
**re-register both listeners on every keystroke**, which is the same churn the debounce exists to
prevent.

⚠ **The 400ms debounce STAYS.** `order` carries the notes textarea; an undebounced write would hit
localStorage synchronously on every keystroke, on a phone.

**Idempotent:** a second write stores a byte-identical snapshot; only `updatedAt` refreshes.

---

## 20. The rollout

**Recorded because the next module will need the same.** It went out over **WhatsApp, in five
messages**:

1. **The upgrade, plus the link** — `https://orbitoms.in/po2`. **Pinned**, so it stays findable
   above the day's traffic.
2. **Install steps**, per platform. See the two traps below.
3. **An ordering video**, with a three-step caption so it is usable without sound.
4. **A favourites video** — the feature nobody discovers on their own.
5. **A request for feedback.**

### 🔴 Two install traps that had to be spelled out

- **iPhone: the link must be opened in Safari, not inside WhatsApp.** WhatsApp's in-app browser
  has **no Add to Home Screen** at all. The instruction has to say "open in Safari" explicitly, or
  the user hunts for a menu item that is not there.
- **Android: Chrome offers both "Install" and "Create shortcut", and they are not the same
  thing.** A shortcut is **only a bookmark** — it keeps the address bar and does not run
  standalone.

🔴 **The check for a correct install is the ABSENCE OF AN ADDRESS BAR.** That one observation
separates a real PWA install from a bookmark on both platforms, and it is what to tell people to
look for.

⚠ **Delete the old Orbit app first.** `/po2` is a different PWA (§12) and installs alongside the
old one. Two identical icons is how an order gets sent twice.

⚠ **Old-app drafts do not transfer.** Different keys, different order book:

```
/po   po_saved_drafts   po_sent_orders   po_fav_customers   po_recent_customers
/po2  po2_saved_drafts  po2_sent_orders  po2_fav_customers  po2_starred_dealers ...
```

`v2-storage.ts` states the rule: v2 never reads or writes a `po_*` key, because sharing a slot
would mean two independent order books silently eating each other's drafts. **A salesman moving
from `/po` to `/po2` starts with an empty draft list**, and his old drafts remain readable by /po
only.

---

## 21. Still open — each with enough detail to resume cold

### 🔴 P0 — gate `/api/order/data`. Alone.
Unauthenticated full-catalogue and full-customer dump. **Never ship it alongside anything else.**
Shared with `/po` and `/place-order`; answers errors with 200 and empty arrays, so a wrong gate
shows an empty board rather than an error. Prove who calls it, then verify `/po` loads a full
board **while logged out**, before and after. See §2.

### The five shade conflicts — **CHERRY first**
`#5C2428` dark maroon vs sampled `#DB7680` salmon pink. Not two readings of one swatch, and CHERRY
is on Gloss and 5in1 Gloss. Then MAHOGANY, DA GREY, SAND STONE, DEEP ORANGE. See §11.

### Move the non-colour names to the never-map list
`Clear`, `Int Clear`, `Ext Clear`, `Opaque Black`, and the Promise Primer rows (`2in1 Primer`,
`Freedom 2in1 Primer`, `Promise Primer`). A swatch cannot represent clear varnish.
⚠ **`GVA GREEN` is misfiled with the colourants** by the survey's tile test — GVA behaves like a
finished-shade product and its other eleven shades carry hexes.
⚠ **Universal Stainer carries ten hexes despite the stainer exclusion.** Unresolved.

### The `MEMBER_SLUG` keying fix — blocks 7 finished cut-outs
`MEMBER_SLUG` is keyed on **sap**. `wood-white` and `wood-pink` are two members sharing **one
sap**, so they cannot carry different art. Smart Choice's five `sc-*` shade files are **shades,
not products**, and the member resolver has nowhere to put them. Seven finished cut-outs sit
unwired in `public/PO/drawer/` because of this.

### The checkout cart row shows the TILE's art, not the member's
The review screen and order detail were fixed; **the cart bar was not**. A Lustre line and an M900
Gloss line both draw `pu-enamel.webp`.

### Art with no agreed home
- **Cement WB** has no art. `cement-wb.webp` is untracked in `public/PO/board/` and it is unclear
  whether it is repaired Cement SB art under the old name, or a genuine Cement WB tin.
  ⚠ `cement-sb` is currently **fed by a file named `cement-wb`**, on the owner's explicit
  placement made twice. WB is water-based and SB is solvent-based and BOARD holds them as two
  different products, so **this tile may be showing a photograph of a different product**.
- **`white-primer`** and **`waterproof-basecoat-advance`** have no agreed home.
- **GVA, Hydro PU and Thinner & More are blank DELIBERATELY** — Thinner joined the list because
  its photograph was of a different product.

### `packToMl` returns 0 for KG / GM / PC
So `/po` **and `/place-order`** still mis-sort those packs. v2 works around it locally with
`sortedPacks`; the shared defect is untouched. See §4.

### The drafts card count chip counts bills, not lines
On the drafts and sent cards.

### Dealer favourites have no cap of 8
200-row fuse, evicts oldest. Products cap at 8 and v1 blocks the ninth. **Inconsistent, open.**
See §10.

### A stray em-dash on the Ship-to line
`shipTo?.area ?? shipTo?.code ?? "—"` renders a bare em-dash when there is no dealer.

### The keyboard listener could not merge into the `--vvh` writer
The writer lives in `po-v2-page.tsx`, which **imports** `v2-sheet.tsx`, so it cannot publish into
the store without an import cycle. The app therefore has two `visualViewport` handlers reading the
same height for two different outputs. **One source of truth for the boolean**, which is what
matters; merging is a tidy-up for whoever next has both files open.

### `handleSend` pushes no history entry
Review's entry becomes the sent screen's, so depth stays 1 and back from Sent lands on the board —
correct. But it leaves `sent` state populated behind an unused screen.

### The review screen's Edit control is under the touch floor
`review-screen.tsx`, text only, roughly **30x18px**. `CLAUDE_UI §60` requires **44-48px**.

### The `FASTYELLOWGREEN` catalogue defect
Seed-owned, missing a space, and it **reaches the email**. Also the one string that forces
`overflowWrap: "anywhere"` to earn its keep in the tile labels (§5).

### Retire `/po`
Per `archive/RETIREMENT-PLAYBOOK.md`, **successor-parity gate first** — `/po2` must prove it does
at least as much as `/po`, feature for feature. That gate caught a real gap last time, when
`/order` turned out to offer a **Hold** dispatch option `/po` does not. **Then** remove the
`/po-v2-8f4kd2` redirect.

---

## 22. The mockups

`docs/mockups/po-v2/` holds **two** files:

| File | What it settled |
|---|---|
| `drafts-sent-compare.html` (`1882c9bc`) | v1 and v2 Drafts/Sent cards side by side, every class string copied verbatim. Settled the card's type scale, the chip row, and what the count chip should say. |
| `splash-motion.html` (`e2bc0ad3`) | Four splash motions — Streak, Orbit, **Trail** (chosen), Split. Settled the 640ms timing, the three-layer structure, the no-tagline decision and the reduced-motion behaviour. Its "ready to lift" block is the source the shipped keyframes were lifted from. |

### One line corrected in this pass

`splash-motion.html:405` wrote the tail's start colour as **`transparent`**:

```css
background: linear-gradient(90deg, transparent 0%, var(--brand) 100%);        /* was */
background: linear-gradient(90deg, rgba(124,58,237,0) 0%, var(--brand) 100%); /* now */
```

🔴 **Several engines interpolate `transparent` through transparent BLACK**, which smears grey
through the middle of the tail. Brand-at-zero-alpha fades cleanly and is what the shipped code
already uses — and what the mockup's own **rendered** `.tail` rule already used. The code block
and the rendered page disagreed; they now agree.

### ⚠ Two mockups are NOT in the folder

**`boot-sequence.html` and `button-violet.html` are absent.** They were produced this session and
settled the app icon and the button colour, but neither was ever written to
`docs/mockups/po-v2/`. **They should be added at consolidation**, or those two decisions have no
record beyond the commits that implemented them.

---

## What this prompt did NOT do

- **No canonical file** was created. `/po2` qualifies for one; writing it is a consolidation job.
- **No router row** was added to `CLAUDE.md §3`.
- **No code file** was changed. `tsc` is 0 errors and every guard number above is unchanged from
  before this document was written.
- **One line** of `docs/mockups/po-v2/splash-motion.html` was corrected, as instructed.
