# Code discovery — missing Mail Order hide tags + a "notes" tag
# 2026-09-11 · DIAGNOSIS ONLY, no code written, no SQL run · Claude Code session

**Files read:** `CLAUDE.md` (router v1.12) · `docs/CLAUDE_CORE.md` (v104, Schema v27.24) ·
`docs/CLAUDE_UI.md` (v5.29, no schema stamp by design) · `docs/CLAUDE_MAIL_ORDERS.md`
(v1.13, Schema v27.15, Parser v7.3.0, Enrichment v3).

MAIL_ORDERS lags CORE by 9 schema points. Per router §4 that is normal and not a defect: nothing
in this diagnosis touched a table whose shape the file describes wrongly. No stamp was bumped.

---

## 0. How a tag actually works today — the three gates

A badge is hideable only when all three hold:

1. it is emitted with a `tagKey` (almost always from `getOrderSignals()`, `lib/mail-orders/utils.ts:726`);
2. that key has a row in `TAG_CATALOG` (`lib/hide/tag-catalog.ts:44`), which is what draws the toggle;
3. the key is consulted where the badge renders.

Gate 3 is normally free: `getOrderSignals()` filters its own output against
`opts.disabledTagKeys` (`utils.ts:791-795`), so every consumer of that array is gated by
construction. Every badge that does **not** come through that array has to be gated by hand, and
today none of them are.

**Plumbing, verified end to end.** `GET /api/mail-orders` reads `getTagSettings()` and returns
`disabledTags` (`app/api/mail-orders/route.ts:270-275`) → `mail-orders-page.tsx:269` stores a `Set`
→ drilled to `review-view.tsx` (`:1369`) and `mail-orders-table.tsx` (`:1480`) → `SlotGroup` →
`OrderRow`. `ExpandRow` is the one component on that chain that never receives it
(`mail-orders-table.tsx:1403`).

`disabledTags` is **not** filtered against the catalog — every disabled row in `app_tag_settings`
reaches the client whatever its key. So a new key needs no API change to travel.

---

## A. Full badge inventory

### A.1 The Focus / Review face — `review-view.tsx` (renders for BOTH billing ON and OFF)

| Label shown | File:line | Via getOrderSignals? | tagKey | In TAG_CATALOG? | Filtered at render? | Face(s) |
|---|---|---|---|---|---|---|
| ★ Key star (rail row) | `review-view.tsx:1100` (glyph `:158`) | No | — | — | **No** | both |
| 🚚 Truck glyph (rail row) | `review-view.tsx:1101` | Yes (`sigs` `:1063`) | `mail_orders.truck_order` | Yes | Yes — `utils.ts:791` | both |
| Bill N mini badge (rail row) | `review-view.tsx:1106-1118` | Yes | `mail_orders.bill` | Yes | Yes | both |
| ✂ Bill X-Y mini badge (rail row) | `review-view.tsx:1106-1118` | Yes | `mail_orders.split_label` | Yes | Yes | both |
| ⚠ Split mini badge (rail row) | `review-view.tsx:1106-1118` | Yes | `mail_orders.split_suggestion` | Yes | Yes | both |
| Delivery-type dot (rail row) | `review-view.tsx:1096` | No | — | — | No | both |
| ★ "Key" pill (bill-to card) | `bill-to-card.tsx:90-95`, prop set `review-view.tsx:2140` | No | — | — | **No** | both |
| OD | `utils.ts:736` → `bill-to-card.tsx:110` | Yes | `mail_orders.od` | Yes | Yes | both |
| CI | `utils.ts:738` → `bill-to-card.tsx:110` | Yes | `mail_orders.ci` | Yes | Yes | both |
| Bounce | `utils.ts:740` → `bill-to-card.tsx:110` | Yes | `mail_orders.bounce` | Yes | Yes | both |
| Bill Tomorrow | `utils.ts:744` | Yes | `mail_orders.bill_tomorrow` | Yes | Yes | both |
| Cross XYZ | `utils.ts:747` | Yes | `mail_orders.cross` | Yes | Yes | both |
| 7 Days | `utils.ts:754` | Yes | `mail_orders.seven_days` | Yes | Yes | both |
| Extension | `utils.ts:756` | Yes | `mail_orders.extension` | Yes | Yes | both |
| Bill N | `utils.ts:763` | Yes | `mail_orders.bill` | Yes | Yes | both |
| DPL | `utils.ts:767` | Yes | `mail_orders.dpl` | Yes | Yes | both |
| Truck Order pill | `utils.ts:771` → `signal-pill.tsx:19-29` | Yes | `mail_orders.truck_order` | Yes | Yes | both |
| ✂ Bill X-Y pill | `utils.ts:776` | Yes | `mail_orders.split_label` | Yes | Yes | both |
| ⚠ Split pill | `utils.ts:781` | Yes | `mail_orders.split_suggestion` | Yes | Yes | both |
| Customer code chip (grey / amber / red by match status) | `bill-to-card.tsx:32-39, :100` | No | — | — | No | both |
| ⚑ captured pill (ship card) | `ship-to-card.tsx:141-146` | **No** — the card reads the key itself | `mail_orders.captured` | Yes | **Yes** — `ship-to-card.tsx:84, :100` | OFF face |
| `changed` pill (ship card, violet) | `ship-to-card.tsx:133-139` | No — same path | `mail_orders.captured` | Yes | Yes — same | billing |
| Amber 3px override bar (ship card) | `ship-to-card.tsx:112` | No — same path | `mail_orders.captured` | Yes | Yes — via `useBillToFallback` `:90` | OFF face |
| Urgent (ship card) | `utils.ts:750` | Yes | `mail_orders.urgent` | Yes | Yes; **additionally removed on the billing face** at the call site `review-view.tsx:1436` | both |
| Hold (ship card) | `utils.ts:787` | Yes | `mail_orders.hold` | Yes | Yes; also call-site-removed on billing `:1436` | both |
| **Dispatch (ship card, green)** | `utils.ts:787` | Yes, but `tagKey: undefined` | **none** | n/a | **No — ungateable** | OFF face only (call-site-removed on billing `:1436`) |
| Challan (ship card) | `utils.ts:769` | Yes | `mail_orders.challan` | Yes | Yes | both |
| "Punched" green pill | `review-view.tsx:1682-1684` | No | — | — | **No** | OFF face |
| ✓ + SO number green pill | `review-view.tsx:1651-1654` | No | — | — | **No** | billing |
| Notes-button violet tint + dot | `review-view.tsx:1727-1741` (OFF), `:1780-1784` (billing) | No | — | — | **No** | both |
| DELIVERY row + amber dot (instructions band) | `instructions-strip.tsx:79, :49, :113` | No | — | — | **No** | both |
| BILL row + blue dot (instructions band) | `instructions-strip.tsx:80, :50` | No | — | — | **No** | both |
| **NOTES row + grey/violet dot (instructions band)** | `instructions-strip.tsx:81, :51, :54` | No | — | — | **No** | both |

### A.2 The Table view — `mail-orders-table.tsx` (billingV2 OFF only; hidden on the billing face)

| Label shown | File:line | Via getOrderSignals? | tagKey | In TAG_CATALOG? | Filtered at render? | Face(s) |
|---|---|---|---|---|---|---|
| Delivery-type dot (Customer cell) | `:928` | No | — | — | No | Table |
| 🔒 Lock icon inline (Customer cell) | `:941-943` | No | — | — | **No** | Table |
| **Dispatch column: "Hold · Urgent" / "Hold" / "Urgent" / "Dispatch"** | `:988-1007` | **No — hardcoded from `dispatchStatus`/`dispatchPriority`** | — | — | **No** | Table |
| Remarks column signal pills (all 12 signal types) | `:1012-1018`, fed by `:871` | Yes | as above | Yes | Yes | Table |
| 🔒 / 🔓 Lock column button | `:1114-1131` | No | — | — | No | Table |
| Status "✓ Done" pill | `:1136-1143` | No | — | — | **No** | Table |
| Punched-by initials avatar | `:1150-1158` | No | — | — | No | Table |
| **Remark-type chips — Contact / Instruction / Cross / Customer / Unknown** (expand row) | `:1802-1808` | No | — | — | **No** (and `ExpandRow` never receives `disabledTagKeys`, `:1403`) | Table |
| Slot section dot + counts | `:135-140` and the slot header | No | — | — | No | Table |

### A.3 The Billing Picking tab — `components/billing/billing-picking-tab.tsx`

These sit on the billing face but describe **OBD rows (`orders`)**, not `mo_orders`. No MO signal
reaches them and none carries a tagKey. Listed for completeness; see §D for why they should not
join the Mail Orders group.

| Label shown | File:line | tagKey | Gated? |
|---|---|---|---|
| Amber `!` (not selectable — confirmed finding) | `:627-634` | none | No |
| ⚑ ship-to overridden | `:648-655` | none | No |
| Slot chip (e.g. `11-09 · 14:00`) | `:659-663` | none | No |
| TINT flag | `:671-677`, source `lib/billing/types.ts:218` | none | No |
| STOCK TFR flag | `:671-677`, source `lib/billing/types.ts:219` | none | No |
| ⚠ confirmed shortage glyph | `:690-697` | none | No |
| "Already invoiced" violet pill | `:752-758` | none | No |
| "awaiting SAP" amber pill | `:768-771` | none | No |

`billing-tab-bar.tsx:91-100` renders the live dot and the Orders/Picking count badges — counters,
not order badges. `billing-order-info.tsx` is orphaned and renders nowhere (MAIL_ORDERS §23.6,
confirmed: no import outside its own file).

### A.4 Line-level statuses — flagged "line status, probably not a tag" for owner decision

| Label shown | File:line | Note |
|---|---|---|
| `✓ n/n` / `⚠ n/n` / `✗ 0/n` readiness chip | `meta-ribbon.tsx:228-239` (chip built `:170-191`); billing caption re-uses it at `review-view.tsx:2325-2331` | One derivation, two render sites |
| PARTIAL | `review-view.tsx:2513-2518` | per line |
| UNMATCHED + "No match found" + "Resolve →" | `review-view.tsx:2522-2529` | per line |
| ⇄ N alt-SKU chip | `review-view.tsx:2476-2487` | per line, informational |
| Not-found reason pill (Out of stock, …) | `review-view.tsx:2591-2603` | per line |
| Lines cell `matched/total` + volume (amber/green) | `mail-orders-table.tsx:959-985` | per order, derived from lines |
| ⚠ Fix / ✓ / ✕ per-line controls (expand row) | `mail-orders-table.tsx:1719-1750` | control + status |
| Shortfall card + "Found 9 · Old MFG · Mar 2024 · Name" | `billing-order-detail-panel.tsx:383-405` | OBD line, read-only panel |
| `Unrecognized base: …` | written by `lib/mail-orders/enrich.ts:821` into `skuDescription`, rendered as plain description text | **Not a badge at all** — it is SKU description text, so hiding it would blank the cell |

### A.5 Excluded as controls (per the brief)

`Urgent · Hold · Slot · Notes · Copy · Punch` on the billing ribbon
(`billing-action-ribbon.tsx:84-140`, `review-view.tsx:1760-1786`), the ✎ ship-to pencil
(`billing-ship-to-pencil.tsx`), the Print button, the description long/short toggle
(`review-view.tsx:2370-2390`), the SKU copy button.

**Three borderline calls, stated out loud:**
- The **Slot button carries state in its label** (`billing-action-ribbon.tsx:117` renders
  `11-09 · 14:00` when a slot is set). It is a control that doubles as a badge. Treated as a control.
- The **Lock / LockOpen column button** (`mail-orders-table.tsx:1114-1131`) is a control, but the
  **red lock glyph in the Customer cell** (`:941-943`) is pure display. Treated as two things.
- The **Notes button's violet tint** is a control's state, not a badge — but it is the visible tell
  that an operator note exists, which is why §B4 treats it explicitly.

---

## The three buckets

### 1. MISSING — rendered outside `getOrderSignals` / no usable tagKey (11 on the MO faces)

| # | Badge | Where | Face |
|---|---|---|---|
| 1 | ★ Key star, rail row | `review-view.tsx:1100` | both |
| 2 | ★ "Key" pill, bill-to card | `bill-to-card.tsx:90-95` | both |
| 3 | **Dispatch** green chip, ship card | `utils.ts:787` (`tagKey: undefined`) | OFF face |
| 4 | Dispatch column badge (Hold · Urgent / Hold / Urgent / Dispatch) | `mail-orders-table.tsx:988-1007` | Table |
| 5 | 🔒 Lock glyph, Customer cell | `mail-orders-table.tsx:941-943` | Table |
| 6 | Status "✓ Done" pill | `mail-orders-table.tsx:1136-1143` | Table |
| 7 | "Punched" pill / green SO pill | `review-view.tsx:1682-1684` / `:1651-1654` | OFF / billing |
| 8 | Remark-type chips (Contact/Instruction/Cross/Customer/Unknown) | `mail-orders-table.tsx:1802-1808` | Table |
| 9 | **NOTES row of the instructions band** | `instructions-strip.tsx:81` | both |
| 10 | DELIVERY row of the instructions band | `instructions-strip.tsx:79` | both |
| 11 | BILL row of the instructions band | `instructions-strip.tsx:80` | both |

Plus the 8 Billing-Picking-tab flags in §A.3, which belong to a different data domain.

Item 3 is the sharpest: the Dispatch chip **is** a signal, pushed by the same line as Hold
(`utils.ts:787`), but the ternary hands it `undefined`, so the filter at `:793` waves it through.
`review-view.tsx:1414-1421` already describes it as "the one chip Hide settings cannot suppress" —
the code comment and the code agree, and the billing face works around it by filtering the whole
`status` type at the call site. Non-billing users have no such escape.

### 2. UNLISTED — tagKeys emitted but absent from TAG_CATALOG

**None.** All fifteen keys pushed by `getOrderSignals()` appear in the sixteen-entry catalog.

### 3. GHOST — TAG_CATALOG entries nothing emits

**None that are dead.** `mail_orders.captured` is the only catalog key `getOrderSignals()` never
pushes, but it is not a dead toggle: `ShipToCard` imports `MO_TAG` and reads the key directly
(`ship-to-card.tsx:4, :84, :90-102`), turning it into the bill-to-fallback behaviour MAIL_ORDERS
§21 documents. It is a working toggle on a non-signal path — worth knowing, because it is the
existing precedent for gating a badge that `getOrderSignals` does not emit.

---

## B. Notes — where it comes from and where it renders

### B1. Which field feeds the violet band — **not the one the name suggests**

The NOTES row of the violet band is built at `review-view.tsx:1440-1445`:

```ts
const notesText = (order.remarks_list ?? [])
  .filter((r) => r.remarkType !== "delivery" && r.remarkType !== "billing")
  .map((r) => r.rawText)
  .filter((t) => t && t.trim().length > 0)
  .join(" · ");
```

So the band's notes row is **`mo_order_remarks`**, every row whose `remarkType` is neither
`delivery` nor `billing` — i.e. `contact`, `instruction`, `cross`, `customer`, `area`, `unknown`,
whatever the parser could not classify. The rows are written by
`app/api/mail-orders/ingest/route.ts:424-450` from the parser's output
(`docs/Parser/Parse-MailOrders-V7.ps1:820-875`), and `noise` is dropped at ingest (`:424`).

The band's other two rows come from different places again: `delivery` is
`splitDeliveryRemarks(order.deliveryRemarks).deliveryInstruction` and `bill` is
`order.billRemarks` (`review-view.tsx:2200-2201`).

**`mo_orders.notes` does not render in the band at all.** It is the operator's own note, written by
`PATCH /api/mail-orders/[id]/note`, and read in exactly three places, all in `review-view.tsx`:
the modal draft (`:917`), the OFF-face icon button (`:1699`), the billing labelled button
(`:1760`). A repo-wide grep for `order.notes` outside Place Order / PO2 returns nothing else.

> ⚠ **Docs vs code.** MAIL_ORDERS §9.2's diagram labels the strip
> "InstructionsStrip (delivery · bill · notes)" and §23.2 calls the violet band "Notes", which
> reads as though `mo_orders.notes` is what appears there. It is not. §23.5 separately notes
> "`mo_orders.notes` has NO enrichment carry line" — consistent with what the code does, but the
> naming collision is real and is the likeliest reason the owner expects one switch to cover both.
> **The code wins: two fields, two surfaces, no overlap.**

### B2. Every place notes text shows

| Surface | File:line | Source field | Face |
|---|---|---|---|
| Violet band, NOTES row | `instructions-strip.tsx:81`, fed `review-view.tsx:1440-1445, :2202` | `mo_order_remarks` (not delivery/billing) | billing (violet) |
| Grey band, NOTES row | same code path, `tone="default"` | same | OFF Focus face |
| Table view "Order Notes" block, with a type chip per remark | `mail-orders-table.tsx:1783-1812` | same `remarks_list`, **same filter** (`:1787-1789`) | Table |
| Notes button tint + corner dot (OFF face) | `review-view.tsx:1727-1741` | `mo_orders.notes` | OFF Focus |
| Notes button violet fill (billing) | `review-view.tsx:1780-1784` | `mo_orders.notes` | billing |
| Notes modal textarea | `review-view.tsx:2990-3110` | `mo_orders.notes` | both |

`mo_orders.notes` reaches no other screen — Floor, Picking and the trip sheet read `orders`, never
`mo_orders`, and MAIL_ORDERS §23.5 already parks "should billing notes reach Floor" as an open
product question.

### B3. Does the strip still return null when notes is suppressed?

**Yes.** `InstructionsStrip` builds `rows` from the three trimmed values and returns `null` when
`rows.length === 0` (`instructions-strip.tsx:73-83`). Passing `notes={null}` simply does not push
that row, so an order with no delivery and no bill remark renders nothing at all — no empty violet
strip, no stray border.

One consequence to state, not a bug: `controlsSlot` (the billing notes font-size stepper,
`review-view.tsx:2084-2105`) rides that same null return, so it disappears with the band. The
component's own comment already calls this intended (`instructions-strip.tsx:37-39`) — there is
nothing to resize when there is no text. If the owner disables a notes tag on a day with no other
remarks, the stepper goes with it.

### B4. Options for a "notes" tag

**(a) Hide the band row only; the Notes button still opens and edits.**
Suppresses the `mo_order_remarks`-fed row on all three surfaces (violet band, grey band, Table
view block). The operator note stays fully available. Cost: nothing, because the two are different
fields — the button was never showing what the band shows.

**(b) Hide the band AND the button tint.**
Reject. The band is `mo_order_remarks`; the tint is `mo_orders.notes`. One switch would suppress two
unrelated facts, and worse, it would hide the only visible tell that an operator note exists while
leaving the note itself in the database and reachable only by clicking a button that now looks
empty. That is a switch that makes the screen lie.

**(c) — RECOMMENDED. One tag, `mail_orders.notes_band`, scoped explicitly to the parser-remark
row, plus two sibling tags for the band's other two rows.**
Same mechanism as (a), but the catalog `description` says what the switch actually covers
("parser-detected remarks — not the operator's own note"), and Delivery and Bill get their own
keys so the owner can thin the band without losing it entirely. If he later wants the operator note
hideable too, that is a separate key on a separate field, named so — never folded into this one.

All three options are render-suppression only. `mo_order_remarks` rows and `mo_orders.notes` are
never touched, exactly like `mail_orders.captured` today.

---

## C. How the admin Tags tab is built

**Adding a TAG_CATALOG entry is enough to draw a toggle.** `hide-settings-content.tsx:164-170`
groups `TAG_CATALOG` by its `group` field in first-seen order and renders every entry
(`:188-222`). Nothing about the list is hardcoded in the UI.

**"Important" is the `important: boolean` on the entry.** It does two things: an amber
"Important" chip beside the label (`:208-212`) and a `window.confirm` before turning the tag OFF
(`:133-136`). Turning one back ON never confirms.

**What else a new key touches:**

| Thing | Needed? |
|---|---|
| `PATCH /api/admin/tag-settings` validation | **No allow-list exists.** It accepts any non-empty string `tagKey` (`route.ts:50-52`) and upserts it. Superuser-gated (`:20, :34`) |
| `GET /api/mail-orders` `disabledTags` | No change — it returns every key with `isEnabled=false`, catalog membership irrelevant (`route.ts:270-274`) |
| Types | Only if a **new group** is introduced: `TagCatalogEntry.group` is the literal type `"Mail Orders"` (`tag-catalog.ts:17`). A second group means widening that union |
| Schema | None. `app_tag_settings` is `tagKey TEXT UNIQUE` + `isEnabled` (CORE §7.10) |
| `prisma/seed.ts` | None, and **none exists today** — zero `app_tag_settings` rows are seeded. Correct by design: default-ON means an empty table is the intended state, so CORE §3's seed-is-source-of-truth rule is satisfied rather than violated |

**The real work is gate 3**, per badge. For anything `getOrderSignals()` emits, adding a `tagKey`
is the whole change. For the hardcoded ones, each render site needs an explicit read of
`disabledTagKeys` — and `ExpandRow` needs the prop threaded to it first.

---

## D. Proposed change list (plan only — nothing written)

### D.1 New keys

| Proposed tagKey | Admin label | Group | Important | Covers | Gate site |
|---|---|---|---|---|---|
| `mail_orders.key_customer` | Key dealer (★) | Mail Orders | no | rail star + bill-to "Key" pill | call site: `review-view.tsx:1100` and `:2140` |
| `mail_orders.dispatch` | Dispatch (green) | Mail Orders | no | the green Dispatch chip | `utils.ts:787` — replace `undefined` with this key |
| `mail_orders.punched` | Punched / Done | Mail Orders | no | "Punched" pill, green SO pill, Table "✓ Done" | 3 call sites |
| `mail_orders.locked` | Locked (🔒) | Mail Orders | **yes** | the red lock glyph in the Customer cell | `mail-orders-table.tsx:941` |
| `mail_orders.remark_type` | Remark type chips | Mail Orders | no | Contact / Instruction / Cross / Customer / Unknown chips | `mail-orders-table.tsx:1802` (needs the prop threaded) |
| `mail_orders.notes_band` | Notes band | Mail Orders | no | the NOTES row of the instructions band, all three surfaces | `review-view.tsx:2202` + `mail-orders-table.tsx:1786` |
| `mail_orders.delivery_band` | Delivery instruction band | Mail Orders | no | the DELIVERY row | `review-view.tsx:2200` |
| `mail_orders.bill_band` | Bill instruction band | Mail Orders | no | the BILL row | `review-view.tsx:2201` |

`mail_orders.locked` is marked important because the lock is a *blocker* affordance — the same
reason Hold / OD / CI are important today.

**Reuse, don't invent, for the Table Dispatch column** (`:988-1007`). It renders one of four
labels from `dispatchStatus` + `dispatchPriority`, which are the same two fields
`mail_orders.hold`, `mail_orders.urgent` and the new `mail_orders.dispatch` already describe. Gate
that cell on those three keys rather than a fourth "dispatch column" key; otherwise the same fact
gets two switches that can disagree.

### D.2 Deliberately NOT proposed

- **The eight Billing Picking tab flags (§A.3).** They describe `orders` rows, are computed
  server-side in `lib/billing/picking-where.ts` / `lib/billing/types.ts`, and would need their own
  catalog group ("Billing" or "Picking") plus a union widening. A separate decision, and one that
  should wait until the pilot rolls out.
- **Line-level statuses (§A.4).** Hiding PARTIAL or `✗ 0/n` hides the operator's own work queue.
  Owner call, but the default should be no.
- **`mo_orders.notes` / the Notes button tint.** See §B4(b).

### D.3 Predicted file list for the implementation session

| File | Change |
|---|---|
| `lib/hide/tag-catalog.ts` | 8 new `MO_TAG` constants + 8 `TAG_CATALOG` entries |
| `lib/mail-orders/utils.ts` | one line — `:787`'s ternary gives Dispatch `MO_TAG.dispatch` instead of `undefined` |
| `app/(mail-orders)/mail-orders/review-view.tsx` | 5 call-site gates: rail star `:1100`, `isKeyCustomer` prop `:2140`, the three `InstructionsStrip` props `:2200-2202`, the two punched pills `:1651` / `:1682` |
| `app/(mail-orders)/mail-orders/mail-orders-table.tsx` | Dispatch cell `:988`, lock glyph `:941`, Done pill `:1136`, notes block `:1786`, remark chips `:1802`, **plus threading `disabledTagKeys` into `ExpandRow` (`:1403`, call site `:1224`)** |

No API route, no schema, no seed, no migration. Estimated at one focused session.

### D.4 Risks

- 🔴 **The Dispatch tagKey change reaches the billing face too.** `review-view.tsx:1436` filters
  `s.type === "status"` at the call site, which already catches Dispatch whatever its tagKey, so
  the billing face is unaffected — but the comment block at `:1414-1421` explicitly reasons from
  "its tagKey is undefined" and will be **stale the moment the key is added**. Update it in the
  same commit or it becomes a lie about live behaviour.
- ⚠ **§23.1's OFF-path byte-identical rule is about the billing FLAG, not about tags.** A tag is
  app-wide by design and is meant to change both faces. The rule is still satisfied as long as
  every gate is a call-site expression that evaluates to today's value when the tag is ON
  (default). No new wrapper divs, no `null`/`<></>` where `undefined` is expected — the pattern
  `ship-to-card.tsx` already uses.
- ⚠ **§23.6 — shared cards.** `BillToCard` does not receive `disabledTagKeys` and should not start
  to. Gate the star by computing the prop at the call site
  (`isKeyCustomer={order.isKeyCustomer && !disabled.has(...)}`), never by teaching the card about
  tags. `ShipToCard` is the deliberate exception and already does its own read.
- ⚠ **Turning the notes band off on a quiet order removes the font-size stepper with it**
  (§B3). Expected, but worth telling the owner before he finds it.
- ⚠ **A tag hides the badge, not the row.** Hiding `mail_orders.locked` still leaves the row
  amber-bordered (`review-view.tsx:1067-1073`) and the Copy button disabled
  (`mail-orders-table.tsx:675`), because both read `isOdCiFlagged()` directly. Hiding a badge must
  not be sold as hiding its effect.
- ⚠ `app_tag_settings` rows live only in the live DB. That is correct for a default-ON table, but
  it means a disabled tag is invisible in git — the catalog entry is the only durable record that
  the switch exists.

---

*Diagnosis only. No files changed outside this document, no SQL executed, no dev server run.*
