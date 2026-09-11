Supersedes code-discovery-2026-09-11-hide-tags.md (wrong scope — old face, skipped action buttons).

# Code discovery — hide tags on the BILLING face (billingV2 ON)
# 2026-09-11 · DIAGNOSIS ONLY, no code written, no SQL run · Claude Code session

**Files read:** `CLAUDE.md` (router v1.12) · `docs/CLAUDE_CORE.md` (v104, Schema v27.24) ·
`docs/CLAUDE_UI.md` (v5.29, no schema stamp by design) · `docs/CLAUDE_MAIL_ORDERS.md` (v1.13,
Schema v27.15) · the superseded draft · `lib/hide/tag-catalog.ts` · `lib/hide/tag-settings.ts` ·
`app/api/admin/tag-settings/route.ts` · `components/admin/hide-settings-content.tsx` ·
`lib/mail-orders/utils.ts` · `lib/billing/flag.ts` · `lib/billing/mo-actions.ts` ·
`components/billing/*` (all 8) · `mail-orders-page.tsx` · `review-view.tsx` ·
`components/mail-orders/*` · `app/api/mail-orders/route.ts` ·
`app/api/billing/mail-order/actions/route.ts` · `app/(mail-orders)/mail-orders/layout.tsx` ·
`prisma/schema.prisma`.

**Scope:** the Billing face, Orders tab, only. Picking tab out of scope. Nothing below proposes a
change to the flag-OFF face.

---

## A. Every existing TAG_CATALOG entry against the Billing face

The Billing face composes badges from three places, all in `review-view.tsx`:

- **rail row** — `renderOrderRow`, `sigs = getOrderSignals(order, { disabledTagKeys })` (`:1063`);
- **Bill To card** — `billSignals` = signals with `card === "bill"` (`:1409`), handed to
  `BillToCard` at `:2141`;
- **Ship To card** — `shipSignalsForCard` (`:1436`), which is `shipSignals` **minus** anything
  whose `tagKey === MO_TAG.urgent` **or** whose `type === "status"`.

That last filter is why three toggles are dead on this face.

| tagKey | Admin label | Where it shows on the Billing face | Off hides it? | Notes |
|---|---|---|---|---|
| `mail_orders.hold` | Hold | **Not rendered** — the ship card drops `type: "status"` at `:1436` | **NO — no-op** | The Hold *button* is a separate, ungated control (§B) |
| `mail_orders.urgent` | Urgent | **Not rendered** — dropped by name at `:1436` | **NO — no-op** | The Urgent *button* is a separate, ungated control (§B) |
| `mail_orders.od` | OD (Overdue) | Bill To card | YES — `utils.ts:736` emit, filter `:791-795`, render `bill-to-card.tsx:110` | important |
| `mail_orders.ci` | CI (Credit Issue) | Bill To card | YES — `utils.ts:738` → `bill-to-card.tsx:110` | important |
| `mail_orders.bounce` | Bounce | Bill To card | YES — `utils.ts:740` → `bill-to-card.tsx:110` | |
| `mail_orders.bill_tomorrow` | Bill Tomorrow | Bill To card | YES — `utils.ts:744` | |
| `mail_orders.cross` | Cross Billing | Bill To card | YES — `utils.ts:747` | |
| `mail_orders.seven_days` | 7 Days | Bill To card | YES — `utils.ts:754` | |
| `mail_orders.extension` | Extension | Bill To card | YES — `utils.ts:756` | |
| `mail_orders.bill` | Bill N | Bill To card **and** rail mini badge | YES — both read the filtered array (`:1063`, `:1106-1118`) | |
| `mail_orders.dpl` | DPL | Bill To card | YES — `utils.ts:767` | |
| `mail_orders.challan` | Challan | **Ship To card** | YES — `utils.ts:769`, `type: "info"`, survives the `:1436` filter | the only ship-card chip left on this face |
| `mail_orders.truck_order` | Truck Order | Bill To card pill **and** rail truck glyph | YES — glyph derives from the same filtered `sigs` (`:1064`) | |
| `mail_orders.split_label` | Split (✂ Bill) | Bill To card **and** rail mini badge | YES — both | |
| `mail_orders.split_suggestion` | Split suggestion | Bill To card **and** rail mini badge | YES — both | ⚠ see the rail/card mismatch below |
| `mail_orders.captured` | Ship-to captured | Ship To card — the violet `changed` pill, the violet left bar, **and the dealer identity itself** | YES — and it does **more** than hide a badge (see A.2) | ⚠ see A.2 |

**Dead toggles on this face: 2** — Hold and Urgent. (A third ship chip, Dispatch, is also filtered
out here, but it has no catalog entry at all, so there is no toggle to be dead.) Both remain live
and correct on the flag-OFF face, so neither entry should be removed from the catalog — they are
face-scoped no-ops, not defects.

### A.1 One real mismatch found: `split_suggestion` on punched orders

`getOrderSignals` only emits the `⚠ Split` suggestion when `!opts?.isPunched` (`utils.ts:779-781`).
The detail call passes `isPunched` (`:1356`); **the rail call does not** (`:1063`). So a punched
order over 1500 L or 20 lines shows `⚠ Split` on the rail row and nothing on the Bill To card. The
tag hides both, so this is not a gating hole — but it is a live inconsistency worth a line in the
implementation session.

### A.2 Ship-to "captured" on the Billing face — it still applies, and that is the problem

The question was whether `useBillToFallback` survives the FK rewrite (`e545af29`). **It does, and
it is more dangerous here than on the old face.**

The FK path and the tag path are independent. `review-view.tsx:1380-1406` resolves the override
dealer through `order.shipToOverrideCustomer` and passes the result as `shipToName/Code/Area/
DeliveryType`. Separately, `ShipToCard` receives `disabledTagKeys` at `:2153` and the bill-to
identity at `:2166-2169`, and computes `useBillToFallback = isOverride && capturedDisabled`
(`ship-to-card.tsx:90`). When the fallback fires, `effectiveName` and its three siblings are
reassigned to the **bill-to** values (`:92-95`) — the FK-resolved dealer is simply discarded — and
`showOverrideStyling` goes false (`:102`), which also forces `tinted` false (`:107`), so the violet
card reverts to plain white and the `changed` pill disappears (`:100`, `:129-146`).

🔴 **On the old face that is defensible; on the Billing face it is not.** There, an override is
something the *parser* detected from an email remark, and falling back to the bill-to is a way of
saying "ignore what the email claimed". Here, an override is something the *operator* set two
clicks ago with the ✎ pencil. Turning this tag off makes the card display a dealer the bill is not
going to, with no indication anything was changed, while the pencil sits right there ready to
change it again. That is a screen that lies about data the reader just entered.

**Recommendation, independent of everything else in this report:** mark `mail_orders.captured`
`important: true` so it at least confirms, and treat "should the bill-to fallback apply on the
Billing face at all" as an owner decision. It is documented behaviour (MAIL_ORDERS §21), so this is
a change of intent, not a bug fix.

---

## B. Hold, Slot and Urgent on the Billing face

All three are `BillingActionRibbon` buttons (`components/billing/billing-action-ribbon.tsx`),
mounted inside the billing ribbon row at `review-view.tsx:1837-1841` (and again via `actionsSlot`
at `:1904-1910`, which the `contentOverride` path does not render). All three write through
`POST /api/billing/mail-order/actions`, which **dual-writes** `mo_orders` then `orders`
(MAIL_ORDERS §23.3). None of them is gated by any tag today.

### B.1 Every visual each one produces on this face

| Action | Button | "On" state | Label change | Rail row | Cards |
|---|---|---|---|---|---|
| **Urgent** | `⚡ Urgent`, `billing-action-ribbon.tsx:84-92` | amber-50 / amber-200 / amber-700 (`BTN_URGENT_ON` `:33`); the ⚡ also loses its `text-gray-400` | none | **nothing** | **nothing** — the Urgent chip is filtered at `review-view.tsx:1436` |
| **Hold** | `⚑ Hold`, `:94-102` | red-50 / red-200 / red-700 (`BTN_HOLD_ON` `:32`) | none | **nothing** | **nothing** — filtered by `type === "status"` at `:1436` |
| **Slot** | `🕑 Slot`, `:108-118`, with the Floor `DispatchSlotPicker` overlaid invisibly to anchor its popover (`:119-139`) | gray-100 / gray-300 / gray-800 (`BTN_SLOT_ON` `:34`) | **yes** — the word "Slot" is replaced by `DD-MM · HH:MM` (`:117`) | **nothing** | **nothing** |

Two consequences worth stating plainly:

- **Option (3) — "hide only the secondary indicators" — is already the state of the world.** All
  three actions have exactly ONE visual on this face: their own button. There are no rail badges
  and no card chips left to suppress, because `:1436` removed them all months ago. Option (3) is a
  no-op for all three.
- **The rail row is blind to all three.** `isFlagged` at `:1059` reads `order.isLocked ||
  isOdCiFlagged(order)`, and `isOdCiFlagged` (`utils.ts:623-633`) matches text patterns in
  `remarks` / `subject` / `billRemarks` — never `dispatchStatus` or `dispatchPriority`. So a bill
  held from this screen looks identical to one that is not, anywhere except the button.

### B.2 Options and recommendation

**(1) Hide the whole button.** Removes the ability to SET the state from Billing. This is a
**feature switch, not a badge** — the data is untouched, but the operator loses a capability.
Floor keeps its own Hold / Slot / Urgent controls (`CLAUDE_FLOOR.md`), so nothing becomes
unreachable depot-wide.

**(2) Keep the button, drop the coloured "on" state.** **Reject for all three.** The tint is the
only thing on this face that says whether the state is set. Keeping a toggle whose state you cannot
read is worse than either extreme: the operator cannot tell Hold-on from Hold-off, and the obvious
recovery is to click it — which flips it, and writes to `orders`. For Slot it is worse still,
because the "on state" is the date-and-window text: dropping it would leave a button reading
"Slot" on a bill that already has one.

**(3) Hide only secondary indicators.** No-op, per B.1.

| Action | Recommendation | Why |
|---|---|---|
| **Hold** | **(1) hide the button** | Dispatch hold is a Floor decision. It writes lowercase `hold` to `orders` and drops the bill off Floor's live board (§23.3) — a large effect from a billing screen. `heldAt` is not written either, so Floor shows `heldSinceSource:"unknown"` for every hold set here |
| **Slot** | **(1) hide the button** | Same reasoning, plus a clearing write sets `dispatchSlotSource: null` to hand the bill back to the rules engine; setting one pins `'manual'` and the engine skips it forever (§23.3). That is a scheduling decision, not a billing one |
| **Urgent** | **leave as is, or (1) if the owner wants it gone** | Lowest blast radius of the three — `priorityLevel` 1/3, no board membership change. It is the one of the three a billing operator plausibly owns. No half-measure: (1) or nothing |

🔴 **These are action switches, not badge tags.** If they go into the same Hide screen they must
sit in their own group with their own wording ("Hide the control" rather than "Hide the badge"),
because an admin reading the current copy — *"Switch a badge on/off across the whole app. Data
stays — only the visual badge changes"* (`hide-settings-content.tsx:181`) — would reasonably expect
a toggle there to be cosmetic. A switch that removes a write capability under that sentence is a
trap. A new `group` also means widening the `TagCatalogEntry.group` literal type
(`tag-catalog.ts:17`), which is currently just `"Mail Orders"`.

---

## B.3 The ✎ ship-to pencil

`components/billing/billing-ship-to-pencil.tsx`, mounted only on this face — `ShipToCard`'s
`actionSlot` prop is `billingV2 ? <BillingShipToPencil …/> : undefined` (`review-view.tsx:2157-2165`),
and the card renders it as an absolutely-positioned sibling at `ship-to-card.tsx:124`
(`absolute right-2 top-2 z-10`). With the flag off the prop is `undefined`, which React emits as
nothing at all.

**What it shows, before anything is set:**

- the 26×26 ✎ button itself (`:106-115`), grey border, title "Change ship-to";
- on click, a 300px popover (`:117-168`): a dealer search box, debounced 250 ms against
  `/api/billing/ship-to-search`, a results list of code + name + area/route, and — **only when the
  order already has an override** (`hasOverride`, `:153`) — a "Clear ship-to redirect" link;
- an inline red error line if the write fails (`:166`).

**What changes on the Ship To card after a dealer is picked.** The write is
`{ shipToOverride: true, shipToOverrideCustomerId: customerId }` on both tables
(`app/api/billing/mail-order/actions/route.ts`, the `shipTo` arm). **`deliveryRemarks` is never
touched** — that is the whole reason the Billing face resolves through the FK. So `isOverride`
flips true and the card changes in four ways at once:

| # | Change | Where |
|---|---|---|
| 1 | **The dealer identity swaps** — name, code, area and delivery type all re-resolve from `shipToOverrideCustomer` | `review-view.tsx:1380-1406` |
| 2 | **The card turns violet** — `bg-brand-50` fill + `border-brand-200`, name in `text-brand-800`, code chip white-on-violet instead of grey | `ship-to-card.tsx:109-111`, `:153-156`, `:166-172` |
| 3 | **A 3px violet left bar** appears (`before:` pseudo). On the flag-OFF face this same state is an **amber** bar — the tone prop is what differs, not the state | `ship-to-card.tsx:110` vs `:112` |
| 4 | **A solid violet `changed` pill** appears beside the "SHIP TO" caption. The old face shows `⚑ captured` instead; the ⚑ was deliberately dropped here because that glyph means Hold elsewhere on this face | `ship-to-card.tsx:133-139` vs `:141-146` |

Nothing changes on the rail row, on the Bill To card, or in the ribbon. The `[&>div]:min-h-[108px]`
floor at `:2133` keeps the card pair from jumping.

One documented side effect, not caused by any tag: because the pencil writes only the FK, a
**non-billing** user opening the same order sees a blank ship-to name until the SAP import runs,
since `overrideDealer` is gated on `billingV2` at `:1382` and the text encoding the parse wants was
never written. MAIL_ORDERS §23.2 already parks this as the "option-(a) caveat".

### Options

**(1) Hide the pencil.** Removes the ability to change ship-to from Billing. A feature switch, same
class as Hold and Slot. Everything already set stays visible and correct; Floor keeps its own
ship-to control.

**(2) Keep the pencil, hide only the "changed" indicators.** The operator can still redirect a bill,
but the card stops saying it was redirected.

### Should it share `mail_orders.captured`, or get its own key?

**Its own key. Sharing `captured` would be actively wrong, for two separate reasons.**

- **`captured` does not do what option (2) describes.** It does not hide indicators — it *replaces
  the data*. `useBillToFallback` (`ship-to-card.tsx:90-95`) swaps the whole identity back to the
  bill-to dealer. So "keep the pencil, hide the changed indicators" via `captured` produces a card
  showing the **wrong dealer**, with a pencil next to it, on a bill the operator personally
  redirected. See A.2.
- **The two switches answer different questions.** `captured` is about a **parser-detected**
  redirect on the old face — "ignore what the email claimed". The pencil is about an
  **operator-entered** redirect on this face. One key over both means the admin cannot suppress a
  noisy parser guess without also blinding the operator to their own edit.

**Recommendation: option (1), under a new key `mail_orders.ship_to_pencil`, hiding the pencil and
nothing else.** Rationale in one line: hiding the setter is coherent — Billing stops redirecting
ship-to and every existing redirect still renders truthfully — whereas hiding the indicators while
keeping the setter is the one combination that makes the card disagree with the database.

The gate is a call-site expression at `review-view.tsx:2157`, and it must stay `undefined` when
suppressed (never `null`, never `<></>`) so the card's own markup is unchanged — the same contract
the prop's own comment sets out at `ship-to-card.tsx:27-33`.

---

## C. The violet notes band on the Billing face

**Source, on this face: `mo_order_remarks` — not `mo_orders.notes`.** `review-view.tsx:1440-1445`
builds the band's notes row from `order.remarks_list`, keeping every row whose `remarkType` is
neither `delivery` nor `billing`, joined with `" · "`. The other two rows come from elsewhere
again: `delivery` from `splitDeliveryRemarks(order.deliveryRemarks).deliveryInstruction`, `bill`
from `order.billRemarks` (`:2200-2201`).

`mo_orders.notes` — the operator's own note, written by `PATCH /api/mail-orders/[id]/note` — renders
in exactly three places on this face, none of them the band: the Notes button's violet fill
(`:1780-1784`), its "has notes" state, and the modal textarea (`:2990-3110`).

> ⚠ **Docs vs code.** MAIL_ORDERS §23.2 calls the violet band "**Notes**" and §9.2's diagram labels
> the strip "delivery · bill · notes", which reads as though the operator note is what appears
> there. It is not. **The code wins: two fields, two surfaces, no overlap.** §23.5's open item
> ("`mo_orders.notes` has NO enrichment carry line") is consistent with the code and is a separate
> question.

**What else disappears with the band.** `InstructionsStrip` returns `null` when all three rows are
empty (`instructions-strip.tsx:73-83`), and `controlsSlot` — the billing notes font-size stepper
(`review-view.tsx:2084-2105`, the `− 12 +` control) — is rendered *inside* that guard
(`instructions-strip.tsx:127-129`). So on an order with no delivery and no bill remark, hiding the
notes row takes the stepper with it. The component's own comment calls this intended
(`:37-39`): there is nothing to resize when there is no text.

**No empty band is left behind.** Confirmed at `instructions-strip.tsx:83` — the `null` return is
before any markup, so nothing renders: no violet fill, no left accent, no border. Passing
`notes={null}` simply does not push that row.

---

## D. Everything else on the Billing face with no switch

Only what actually renders with the flag ON.

| What | Meaning | File:line | Gated? |
|---|---|---|---|
| **Coloured dot before the dealer name** — on BOTH cards | **Delivery type.** blue = LOCAL · orange = UPCOUNTRY/UPC · teal = IGT · rose = CROSS · grey = unknown | `bill-to-card.tsx:21-30, :86` and `ship-to-card.tsx:57-66, :152` (identical duplicated helper) | **No** |
| **Same dot on the rail row** | same | `review-view.tsx:1096` | **No** |
| **★ key-dealer star, rail row** | `delivery_point_master.isKeyCustomer`, joined on the **bill-to** code (`app/api/mail-orders/route.ts:183-196`) | `review-view.tsx:1100`, glyph `:158` | **No** |
| **★ "Key" pill, Bill To card** | same field, same order | `bill-to-card.tsx:90-95`, prop set `review-view.tsx:2140` | **No** |
| **Customer code chip colour** | match status — grey exact / amber multiple / red unmatched | `bill-to-card.tsx:32-39, :100` | **No** |
| **`✓ N/N` / `⚠ N/N` / `✗ 0/N` readiness chip** | SKU enrichment match rate. On this face it lives on the SKU caption, **not** the ribbon | `review-view.tsx:2325-2331`, chip built by `getMatchChip` (`meta-ribbon.tsx:170-191`) | **No** |
| **`N lines` count + 💧 volume**, SKU caption | order size | `review-view.tsx:2320-2340` | **No** |
| **Ribbon provenance line** — `{sales officer} · {HH:MM}` and, once punched, `· punched by {name} {HH:MM}` | who sent it, when it arrived, who punched it | `review-view.tsx:1832-1835` | **No** |
| **Green `✓ {SO number}` pill + ✎** | punched state | `review-view.tsx:1651-1665` | **No** |
| **Rail head `N orders · X% punched`** | day progress; green at 100, blue below | `review-view.tsx:2721-2734`, derived `:824-828` | **No** — a counter, not an order badge |
| **Notes button violet fill** | an operator note exists on `mo_orders.notes` | `review-view.tsx:1780-1784` | **No** |
| **Rail row amber left border** | `order.isLocked \|\| isOdCiFlagged(order)` — text patterns, **not** dispatch state | `review-view.tsx:1059, :1067-1073` | **No** |
| **Punched rows at 40% opacity / grace period** | done-ness | `review-view.tsx:1071` | **No** — a view state |

Not on this face at all, despite being in the superseded report: the green **Dispatch** chip
(filtered at `:1436`), the **lock glyph** and **Dispatch column** (Table view only — the Table/Focus
toggle is hidden for billing users, `mail-orders-page.tsx:1230`), and the remark-type chips (Table
view expand row).

---

## E. Rollout — who sees which face

Two fields decide it, and **nothing else**:

1. `billing_settings.rolloutStage` where `scope = 'GLOBAL'` — `OFF` / `TEST_USERS_ONLY` /
   `ALL_USERS` (`lib/billing/flag.ts:49-67`);
2. `users.billingV2TestUser` — consulted **only** in the `TEST_USERS_ONLY` arm (`:88-97`).

`OFF` means nobody, whatever the per-user flag says. `ALL_USERS` means everyone who can already
reach `/mail-orders`, and skips the per-user lookup entirely. The flag is read **fresh on every page
load**, server-side in `app/(mail-orders)/mail-orders/layout.tsx:56`, and couriered by
`BillingV2Provider` (`:77`) — deliberately not JWT-cached, so a flip takes effect on the next
reload rather than after a token refresh. It **fails closed**: any error resolves to OFF.

Everyone the flag does not select gets the old face, which is Table + Focus with the view toggle
visible.

**Read-only SELECT — run this yourself in the Supabase SQL Editor.** No writes, no DDL.

```sql
-- READ-ONLY. Who sees the Billing face right now.
-- Row 1 = the global stage. It alone decides OFF (nobody) and ALL_USERS (everyone).
-- The listed users matter ONLY when the stage is TEST_USERS_ONLY.
SELECT
  (SELECT "rolloutStage" FROM billing_settings WHERE scope = 'GLOBAL') AS global_stage,
  u.id,
  u.name,
  u.email,
  u."isActive",
  u."billingV2TestUser",
  r."roleSlug"
FROM users u
JOIN role_master r ON r.id = u."roleId"
WHERE u."billingV2TestUser" = true
ORDER BY u.id;
```

If it returns no rows while `global_stage` is `TEST_USERS_ONLY`, nobody is on the Billing face and
every tag below would be shipping dark. MAIL_ORDERS §23 records the expected state as
`TEST_USERS_ONLY` with exactly one flagged user, Operations User (id 20), as of a 2026-08-04
SELECT — worth re-confirming rather than assuming, since the two rollout targets (Deepanshu 25,
Bankim 26) may have been flipped since.

---

## F. Proposal

### F.1 New keys

| Proposed tagKey | Admin label | What it hides | Important? |
|---|---|---|---|
| `mail_orders.key_customer` | Key dealer (★) | the rail star and the Bill To "Key" pill, together | no |
| `mail_orders.delivery_dot` | Delivery-type dot | the coloured dot on both cards and the rail row | no |
| `mail_orders.match_chip` | Match chip (✓ N/N) | the readiness chip on the SKU caption | no |
| `mail_orders.punched_by` | Punched-by line | `· punched by {name} {time}` on the ribbon | no |
| `mail_orders.notes_band` | Notes band | the parser-remark row of the violet band — **not** the operator's own note | no |
| `mail_orders.delivery_band` | Delivery instruction band | the delivery row of the band | no |
| `mail_orders.bill_band` | Bill instruction band | the bill row of the band | no |

### F.2 New ACTION switches — separate group, separate wording

| Proposed key | Admin label | What it hides | Important? |
|---|---|---|---|
| `billing.action_hold` | Hold button | the ⚑ Hold control on the billing ribbon | **yes** |
| `billing.action_slot` | Slot button | the 🕑 Slot control and its picker | **yes** |
| `billing.action_urgent` | Urgent button | the ⚡ Urgent control | **yes** |
| `billing.ship_to_pencil` | Ship-to pencil (✎) | the ✎ on the Ship To card and its dealer search | **yes** |

All four remove a write capability, not a badge. All four are `important` for that reason alone.

### F.3 One change to an existing entry

`mail_orders.captured` → `important: true`, and its description reworded to say what it actually
does ("shows the bill-to dealer instead of the redirect" — not "hides a pill"). See A.2.

### F.4 Predicted file list

| File | Change |
|---|---|
| `lib/hide/tag-catalog.ts` | 7 `MO_TAG` + 4 action constants; 11 new `TAG_CATALOG` entries; widen the `group` literal to include the action group; flip `captured` to important |
| `components/admin/hide-settings-content.tsx` | per-group copy, so the action group does not inherit "only the visual badge changes" (`:181`) |
| `app/(mail-orders)/mail-orders/review-view.tsx` | ~10 call-site gates: rail star `:1100`, `isKeyCustomer` prop `:2140`, the three `InstructionsStrip` props `:2200-2202`, SKU caption chip `:2325-2331`, ribbon punched-by `:1832-1835`, `BillingActionRibbon` mount `:1837`, ship-to pencil `actionSlot` `:2158`, the two delivery dots `:1096` / card props |
| `components/mail-orders/bill-to-card.tsx`, `ship-to-card.tsx` | **only if** the delivery dot is taken — the dot is computed *inside* both cards, so it is the one item that cannot be gated purely at the call site (see risks) |
| `components/billing/billing-action-ribbon.tsx` | per-button gating if the three actions are hidden individually rather than as a block |

No API route change (`PATCH /api/admin/tag-settings` has no allow-list — `route.ts:50-52` accepts
any non-empty string; `GET /api/mail-orders` returns every disabled key regardless of catalog —
`route.ts:270-274`). No schema change (`app_tag_settings` is `tagKey TEXT UNIQUE` + `isEnabled`).
No seed change — zero rows are seeded today, which is correct for a default-ON table.

### F.5 Risks

- 🔴 **The action switches are feature switches wearing a badge switch's clothes.** §B.2. If they
  ship under the current Tags copy, an admin will turn one off expecting cosmetics and silently
  revoke a capability. Separate group, separate wording, `important: true` on all four.
- 🔴 **`captured` already has the failure mode we are trying to avoid** (A.2): on this face it
  substitutes the wrong dealer rather than hiding a badge. Decide this one before adding anything
  near it.
- ⚠ **§23.6 — shared cards.** `BillToCard` does not receive `disabledTagKeys` and should not start
  to; gate the star by computing the prop at the call site. `ShipToCard` is the deliberate
  exception and already reads the set itself. **The delivery dot is the exception to the
  exception** — both cards compute it internally from their own `deliveryType` prop, so gating it
  means either a new prop on both cards or passing `null` for the type, and passing `null` would
  also blank the "· LOCAL" text beside it. Recommend leaving the dot alone in v1.
- ⚠ **§23.1 — OFF-path byte-identical.** That rule is about the billing FLAG, not about tags; a tag
  is app-wide by design. It stays satisfied as long as every gate is a call-site expression that
  evaluates to today's value when the tag is ON (the default), with no new wrapper divs and
  `undefined` — never `null` or `<></>` — for suppressed slot props.
- ⚠ **Hiding the notes band on a quiet order takes the font-size stepper with it** (§C). Expected,
  but tell the owner before he finds it.
- ⚠ **Hold and Slot write to `orders`, not just `mo_orders`** (§23.3). Hiding the buttons stops new
  writes; it does not undo existing ones. Any bill already held stays held, and the only surface
  that showed it on this face was the button that just disappeared — so after this change a billing
  operator has no way to see, or release, a hold set before it. That is an argument for hiding
  Hold **together with** a Floor handover, not on its own.
- ⚠ `app_tag_settings` rows live only in the live DB, so a disabled tag is invisible in git. The
  catalog entry is the only durable record that the switch exists.

---

*Diagnosis only. No files changed outside this document, no SQL executed, no dev server run.*
