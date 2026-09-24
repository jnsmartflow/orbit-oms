# web-update-2026-09-24 — Billing · mail-order actions: CI/Cancel · Hand · typed Ship-to + challan · bottom action bar

**Status:** DESIGN LOCKED v4 — NOT BUILT. Nothing in this file is shipped.
**v4 (2026-09-24 10:36):** **§5 (typed ship-to + challan) is PARKED** by owner decision. This build covers the bottom bar, CI, Hand, the billing refusal rule and the Hold/Release fixes only. §5 is kept below as history. It will be redesigned after this build ships, around the owner's **"Orbit delivery points"** idea (see §5.0). Do not build any of §5 in this pass.
**v3 (same day):** the re-gate (`…-regate.md`) returned 5 STOPs on v2 wording. All are resolved, marked **[re-gate]**. No owner decision changed.
**Decided by:** Smart Flow, web session 2026-09-24.
**v2 (same day):** rewritten after the gate (`docs/prompts/drafts/code-discovery-2026-09-24-billing-mo-actions-gate.md`) returned 5 STOPs and 4 owner corrections. Every STOP is resolved below and marked **[gate]**. v1 is superseded and is not merged.
**Evidence:**
- `docs/prompts/drafts/code-discovery-2026-09-24-billing-mo-actions.md` (discovery)
- the gate report above

Both were written at `417485d2`. Re-read by symbol before building.
**Mockup:** `docs/mockups/billing-mo-actions/billing-mo-actions-mockup.html` (v12). Review it before any React is written.
**Owner files when built:**
- `CLAUDE_BILLING.md`: bar + actions
- `CLAUDE_FLOOR.md` / `CLAUDE_FLOOR_TRIPS.md`: Hand chip, Hand trips, totals, Cancel & CI
- `CLAUDE_CI.md`: billing-raised CI
- `CLAUDE_MAIL_ORDERS.md`: typed ship-to on `mo_orders`
- `CLAUDE_UI.md`: the new colour token

Cross-reference; never restate a rule in two files.

Tags: **[owner]** = Smart Flow said it · **[proposed]** = Claude's default, accepted · **[gate]** = forced or recommended by the gate, accepted ("ok all", 2026-09-24).

---

## 1. What changes

Billing gets three new decisions on a mail order:
- **CI** (bill-only, goods never leave)
- **Hand** (dealer collects)
- a **typed ship-to** with an optional challan copy

The Orders tab's buttons are regrouped:
- **Notes · Copy** stay on top.
- A pinned **bottom bar** holds **Hold · Hand · CI | Urgent · Slot**, then **Order No · Punch**.

On Floor:
- Hand shows as a chip. Hand bills are planned on a manual **Hand trip** and left out of the totals.
- A typed ship-to takes the Ship-to name slot and routes by the **area billing picked**.

---

## 2. Billing · Orders tab layout

| | Decision |
|---|---|
| Top row | **[owner]** Notes · Copy only. Unchanged. |
| Bottom bar | **[owner]** Pinned to the bottom of the right pane. Left: **⚑ Hold · ✋ Hand · ⊘ CI**, divider, **⚡ Urgent · 🕑 Slot**. Right: **Order No** + **Punch**. |
| No Dispatch button | **[owner]** Nothing lit = normal dispatch. Tapping a lit button clears it. |
| One of three | **[proposed]** Hold, Hand and CI are mutually exclusive. Urgent and Slot combine with normal or Hand. When CI is on, Urgent and Slot fade out. |
| CI confirm | **[proposed]** Asks once: "Raise a CI for this bill when it imports?" |
| Size | **[owner]** Equal buttons, 40px tall, **always one row**. As the **pane** narrows (container query), labels drop to icons: first Hold/Hand/CI/Urgent/Slot, then the "Order No." label. Punch keeps its word. Hover shows names. The row needs about 520px; below that it wraps as a last resort. |
| Colour | **[gate]** Grey + coloured icon until pressed. When on: Hold = solid `danger` · **Hand = solid new `data.brown`** (§7) · **CI = solid `ink-900`** · Urgent = `warn` tint · Slot = `brand-50` tint showing the time. Punch is the only solid `brand-600`. ~~Hand = `data.blue`~~: blue is Local + the Telephonic CI tag. Do not revert. |
| Focus | **[proposed]** After Copy, focus moves to Order No. |
| Shortcuts | Unchanged. Remove the dead "E · Slot email" label (BILLING §11). |
| Access | Buttons **hide** without their tick (BILLING §5). |
| Bar size (2026-09-24) | **[owner]** ~72px bar, padding 12px 16px. Buttons 48px, 15px semibold, 18px icon, gap 10px. Order No box 48px, min 220px. Punch 48px, min 140px. Mockup: `billing-bar-polish-mockup.html`. |
| Bar tint (2026-09-24) | **[owner]** Bar bg `ink-50`, border-top `ink-100`, top shadow `0 -4px 12px rgb(27 24 38/.06)`. No violet on the bar itself. |
| Punch states (2026-09-24) | **[owner]** Always reads "Punch". Not ready: `brand-50` bg, `brand-700` text, `brand-200` border. 10 digits: solid `brand-600`. |
| Narrow sizes (2026-09-24) | **[owner]** Pane ≤1150px: the five buttons become 48px icon squares (tooltip = name). ≤780px: "Order No." label hides, box min 150px, Punch min 110px. One row down to ~560px; wraps only below that. |
| Prev / Next (2026-09-24) | **[owner]** Footer row and its hint removed from the billing face. ↑↓ / Tab still navigate; the hint is in the ⌨ popover. |
| Table scroll (2026-09-24) | **[owner]** The page never scrolls. Only the lines body scrolls; its column header is sticky (`ink-25`). One thin scrollbar (8px, `ink-200` thumb). Bottom padding so the last row shows in full. |

---

## 3. CI / Cancel

### 3.1 What billing sees
**[owner]** Billing presses **CI**, then punches the SO as normal.

**Confirm card — [owner] 2026-09-24** (`billing-bar-polish-mockup.html`):
- Sits just above the bar. Title "⊘ CI · Raise a CI for this bill?".
- Text: "When the SAP bill imports, it will be cancelled and a full-bill CI raised." + "Reason: Wrong order by S.O. · Raised by: you".
- Amber line: "⚠ You can undo this only until the bill imports."
- Buttons: Cancel / **Yes, raise CI** (solid `ink-900`). Esc and Cancel close it. Enter confirms only when Yes itself has focus.
- Clicking a lit CI clears it — no card.
- A refusal (e.g. 409) shows its text inside the card; the card stays open.
- **Optional note (max 200 chars) — HIDDEN until a column exists.** It must land on `ci_returns.reasonRemark`, but it is typed at press time and the CI is raised at import. No existing column can carry it: `so_tags` has no text field; `mo_orders` notes / remarks / billRemarks / deliveryRemarks are all in use. Needs `mo_orders."billOnlyNote"` (or `so_tags."note"`), written by `markMoOrderCi`, copied by `raiseBillOnlyCi`. Flag in code: `SHOW_CI_NOTE`.

 When the OBD imports, a full-bill CI is raised automatically. The bill shows on **Floor › Cancel & CI** and on **/ci**. It never sits on the Hold tab.

### 3.2 Engine — reuse Telephonic (Shape 1)
- **[proposed]** The mark is stored on the mail order as `mo_orders.billOnlyAt` / `billOnlyById`.
- **[proposed]** Once the mail order has an SO (at the `[id]/so-number` punch, or at once if already punched), an `so_tags` row `tag='ci'` is written with **`fromMailOrder = true`** (§3.6).
- The existing hook `applySoTagHolds` (all four import sites) acts on it.
- CI fields:
  - `source='auto_bill_only'` (no CHECK change)
  - reason `WRONG_ORDER_BY_SO`
  - raiser = `so_tags.addedById` = the billing user who pressed CI
  - `raiseBillOnlyCi` also returns `reasonLabel` for the log note

### 3.3 Order of writes — **[gate] CLAIM → CI → cancel, fall back to hold**
For a `ci` tag, in this order, for Telephonic too. That is safe: 0 matches / 0 `auto_bill_only` CIs live on 2026-09-23.
1. **CLAIM** the `so_tag_matches` row (unchanged).
2. **Raise the CI** (`raiseBillOnlyCi`).
3. **(a) CI raised →** Floor Raise CI's three writes (`app/api/floor/ci/route.ts:322-338`):
   - `workflowStage='cancelled'`, `dispatchStatus=null`, no `heldAt`
   - `pick_assignments.deleteMany`
   - one log `CI raised — {ciNumber} · {reason}`
4. **(b) CI skipped or failed →** today's HOLD with `TELEPHONIC_HOLD_NOTE`, reason in `ciSkipReason`. A person looks at it.
5. **(c) CI raised, cancel incomplete — [re-gate] depends on WHICH write failed:**
   - **The `orders.update` itself failed →** try the hold and record "cancel failed".
   - **The `orders.update` landed, but `deleteMany` or the log failed →** record "cancel incomplete". Do **not** hold: the bill is already cancelled.
   - **The cancel AND the hold both failed →** the fallback in the same run may release the CI'd bill to picking. Nothing can stop that, so the Telephonic tab shows **"Cancel failed"** and Floor cancels by hand.
6. **TAG** → matched (unchanged).
7. **[re-gate] Telephonic tab statuses** gain **Cancelled** and **Cancel failed**, so these bills never read "Held" or "Released".
8. **[re-gate]** `raiseBillOnlyCi` also refuses when the bill has an **open draft CI** (Floor's check, `floor/ci/route.ts:240-247`). That counts as path (b).

### 3.4 Import must not move a CI bill first — **[gate]**
**[re-gate] The skip keys on the SO, not the newest mail order.** If **any** live mail order on that SO carries `billOnlyAt`, `applyMailOrderEnrichment`:
- does **not** carry the slot or priority
- does **not** auto-advance the bill to `pending_picking`
- **writes `dispatchStatus='hold'` + `heldAt`** with a new `BILLING_CI_HOLD_NOTE` (in `HOLD_LOG_NOTES`)

This hold is a **safety net**. If the tag is missing (a failed or colliding tag write, or the hook crashing), the bill sits on Floor's Hold tab and is never auto-released to picking with no CI. When the hook cancels the bill (path a), the cancel clears the hold.

The clash warning is skipped for tags marked "from mail order".

### 3.5 Which bills can be CI'd — **[gate] + owner C, E**
The planner's record-only rule widens, via the new `billingRefusal` (§6):

| Bill state | CI outcome |
|---|---|
| Dispatched, cancelled, removed | record-only (today) |
| **On a trip** | record-only, reason shown |
| **Tint room** (`tint_assigned`, `tinting_in_progress`) | record-only, reason shown |
| Picked (`pick_assigned` / `pick_done` / `pick_checked`) | **allowed [owner C]**. The pick assignment is cleared, as Floor does. |
| Everything else | CI + cancel |

### 3.6 One live tag per SO — **[gate]**
The partial unique `so_tags_soNumber_live_key` stays.

**The link [re-gate]:** one tag cannot point at two mail orders. So the tag carries a flag, **`so_tags.fromMailOrder boolean NOT NULL DEFAULT false`**, not a `moOrderId`. The owning mail orders are found by SO number (`mo_orders WHERE soNumber AND billOnlyAt IS NOT NULL`).

**"Matched" [re-gate]** means **at least one `so_tag_matches` row exists**, never "status = waiting". A tag can still read waiting after a bill matched.

Rules:
- **CI vs an existing Telephonic HOLD tag:** if the hold has no match rows, soft-remove it (`removedById` = the presser) and insert `ci`. If it has match rows, CI is refused with the reason.
- **[re-gate] CI vs an existing Telephonic CI tag:** no new tag. The mail order **joins** it: flip `fromMailOrder = true` and keep the tag.
- **A Telephonic tag added on an SO that has a mail-order CI:** reported as a duplicate, labelled "from mail order".
- **Two mail orders on one SO share one tag.** Un-pressing on one removes the tag only when no other marked mail order holds that SO. Every OBD on the SO gets its own CI (existing rule).
- **Read-only on the Telephonic tab:** labelled "from mail order". `removeTelephonicTag` refuses rows with `fromMailOrder` using a **new result `status:'locked'`** and the message "Remove it from the mail order". It must not report "already removed".
- **Re-punch:** a changed SO on a marked mail order moves the tag (remove the old one, add the new one) **while it has no match rows**. **Once matched, changing the SO is refused.**
- **No expiry [re-gate]:** mail-order tags get `expiresAt` far in the future (e.g. `2099-12-31`). The six existing expiry checks stay as they are.
- **Un-press is refused once the tag has match rows.** After that there is no undo from billing; a CI void goes on ROADMAP.

### 3.7 Screens
- **Floor › Cancel & CI [owner]:** widen arm (a) of `getFloorCancelled` from `source:'floor'` to **every source**, **but only for bills that are cancelled** (so auto-finding CIs on dispatched bills do not flood it).
- **Source chip [re-gate]:** there are four sources: `floor`, `auto_bill_only`, `auto_finding`, `manual`.
  - `auto_bill_only` splits into **Billing** (the bill's tag has `fromMailOrder`) or **Telephonic**, found by one batched lookup through `so_tag_matches` → `so_tags`.
  - Chips: **Floor · Billing · Telephonic · Auto · Manual**.
- **Finishing a bill left held with a bill-only CI [re-gate]:** Floor uses its plain **Cancel**. Raise CI refuses it ("already has CI-…"), by design.
- **Telephonic tab [gate]:** a new **Cancelled** status pill, from `bill.workflowStage`.
- **Guards [proposed]:** Floor Release, Floor Restore and Picking cancel refuse a bill with a live CI (Restore already does).

---

## 4. Hand — dealer collects

| | Decision |
|---|---|
| Mark | **[proposed]** `orders.handAt` / `handById` + `mo_orders.handAt` / `handById`, carried by enrichment and dual-written by the actions route. `dispatchStatus` stays `dispatch`. 🔴 Hand is **never** a `dispatchStatus` value. |
| Who sets it | **[proposed]** Billing (bar) and Floor (detail panel ⋯, `floor` canEdit). Either can clear it. |
| Floor look | **[owner]** A **✋ HAND** chip in `data.brown` beside the ship-to name, like BASE. No new column. The same chip goes on the picker card. |
| Hand trip | **[gate]** A new **`trips."isHand" boolean NOT NULL DEFAULT false`**. It is not the HAND transporter (fragile) and not a new trip letter (needs a fake delivery type). POST accepts it; PATCH refuses to change it. Vehicle and plate are **refused** on a Hand trip, so it stays `draft` for life, and draft blocks nothing (show, pick gate, send-to-billing and Print all work). Number, letter, delivery type and tab are unchanged. |
| Hand trip look | **[gate]** A Hand label replaces "Vehicle not set" (`trip-detail-header.tsx`) and "No driver yet" (`trip-rail.tsx`). The trip form gets a **Hand trip** switch that skips the Nagadhiraj preselect and the Upcountry vehicle-size rule. |
| Wrong trip | **[proposed]** Refused in the add route (`bills/route.ts`, `add` branch, the only writer of `tripDropId`): a Hand bill can't join a truck trip, and a non-Hand bill can't join a Hand trip. The reason goes in `failed[]`. |
| Totals **[owner + G]** | Hand bills are **left out of**: route-card kg/L/stops (with a "+N Hand · X kg — not counted" line), the **pool header kg/L**, load plan v1 (filter the input, keep `rowById`) and v2 (server where, which also covers the snapshot cron), and the gate's `unplanned` count. "Every bill is on a trip" changes **its test only** (`allPool.every(isHand)`), never the list. The **Hand trip counts its own bills** normally on the rail. The **load-plan day check skips Hand trips** (no truck to price). |
| `FloorBoardRow` | **[gate]** Gains `isHand`. |
| Notify | **[proposed]** Push to `getPickingSupervisorUserIds` on set, copying `picking/done/route.ts:153-186`. |
| Collected | No "Mark collected" button. No trip has a dispatch button today (FLOOR_TRIPS §14). It goes on ROADMAP with trip dispatch. |
| Seeding | **[proposed]** Manual only. |

---

## 5. Typed ship-to + challan copy — ⏸ PARKED (v4)

### 5.0 Why parked, and the idea to redesign around
**[owner, 2026-09-24]** Many "free-text" ship-tos are fixed places (e.g. Mohan Godown) that are not SAP dealers. The idea is to create them once as **Orbit delivery points** in `delivery_point_master`, with an Orbit-made code (e.g. `ORB-00001`), an area, an address, and a flag meaning "Orbit-only, not in SAP". Billing then picks them from master next time.

Why this looks better than the free-text boxes below: every screen already handles `shipToOverrideCustomerId` (name, area, route, trip stop), so most of §5's column and drop-key work disappears.

What the redesign must settle:
- Orbit-only points are hidden from every **bill-to** picker (place order, /po2, mail-order customer matching).
- Duplicate check before creating a new point.
- Code format.
- Whether the challan copy stays per order.

The table below is the v3 free-text design, kept only as history.

| | Decision |
|---|---|
| Pencil | **[owner]** Two tabs: **From master** / **Type address**. |
| Typed field | **[owner]** One box: a short name or a full address. The first line is the display name. |
| Area | **[owner]** An **Area dropdown**, required, defaulting to the bill-to dealer's area. **[gate]** It is fed by a new `GET /api/billing/areas` (gate `mail_orders` canView; active `area_master` rows `{id, name, deliveryType, primaryRoute{id,name}}`). |
| Storage | **[proposed]** `mo_orders.shipToText` + `shipToAreaId`, the same on `orders`. **[gate]** FK → `area_master(id)`, named relations `"OrderShipToArea"` / `"MoOrderShipToArea"` with named back-arrays, never Cascade. Typed text clears `shipToOverrideCustomerId`, and a master pick clears the text. `shipToOverride = true` in both cases. |
| Area everywhere | **[gate]** Every dealer→area read site must use **`shipToArea ?? dealer.area`**: Floor board / hold / cancelled + tab scope, load plan v1/v2, day check, trip drop snapshot, trip delivery types, picking. The full list is in gate G6's table. Otherwise the bill sits on the wrong tab and route. |
| Typed name everywhere | **[gate]** The flag alone shows only "→ ship-to changed". A typed-name field is added to `FloorBoardRow`, `FloorHoldRow`, `FloorCancelledRow`, `FloorDetail`, the billing Picking/detail rows, **the Print tab (`lib/billing/print.ts:241`)** and `PickingQueueRow`. |
| Floor table | **[owner]** The typed name takes the SHIP TO slot, with a **typed** chip, and a 📎 if a challan exists. |
| Project (site) bills | **[owner F]** Keep the 🏢 icon, show the typed name, and add "billed to …" underneath (a new render branch; today "billed to" shows only when `isSite`). The bill stays in the **Site** filter chip. |
| Marker | **[proposed]** `isShipToOverride` is true for typed text (drives the Redirect chip on non-project bills). |
| Trip stop | **[gate]** New column `trip_drops."shipToText" text NULL`. `chk_trip_drops_key` is rewritten with the t-branch first: `CASE WHEN "shipToText" IS NOT NULL THEN 't:'||"shipToText" WHEN "customerId" IS NOT NULL THEN 'c:'||"customerId"::text ELSE 's:'||"shipToCode" END`. The stored `shipToText` is **dealer-scoped and normalised**: `<scope>/<text>`, where **scope = the bill's `customerId`, falling back to its SAP `shipToCode`** [re-gate: there is no "dealerId" column]. The text is lower-cased, with **spaces and newlines collapsed**, **`|` and `#` stripped**, and capped at 80. **An empty result falls back to today's `c:`/`s:` key.** Stop name = the typed first line; area/route come from `shipToAreaId`. |
| Challan | **[owner]** Optional, up to 3 files, JPG/PNG/PDF. **[gate]** One file per request; client-side size check; images downscaled on the client; server cap `4_000_000`; a PDF over the cap is refused with a clear message. |
| Challan storage | **[proposed + gate]** A private bucket **`ship-to-challans`** (created by hand, steps in gate G10; no RLS policies). A row per file owned by the mail order, with `soNumber` on the row; compensating delete; signed URL, 300 s TTL; no purge. `ALLOWED_TYPES` map for jpg/png/pdf, extension from the map, `contentType: file.type`. A PDF opens in a new tab. |
| Out of scope | The tint challan, the CI dealer snapshot, the stale `[→ …]` suffix. All go on ROADMAP. |
| Fixes in the same build | The split route copies `shipToOverrideCustomerId` + the new columns. Floor's ship-to save stops wiping billing's flag and text. |

---

## 6. Billing refusal rule and the actions route — **[gate] + owner D, E**

A new **`billingRefusal(action, bill)`**, not `offFloorRefusal`:

| Action | Dispatched / cancelled | On a trip | Tint room | Picked |
|---|---|---|---|---|
| Hold | refuse | **allow** | allow | allow |
| Urgent | refuse | **allow** | allow | allow |
| Slot | refuse | **allow** | allow | allow |
| Ship-to | refuse | **refuse** | allow | allow |
| Hand | refuse | **refuse** | allow | allow |
| CI | refuse | **refuse** | **refuse** | allow (clears the pick assignment) |

- **Tint room [re-gate]** = exactly `tint_assigned` and `tinting_in_progress`.
- **[re-gate] Release is allowed on dispatched/cancelled bills when it only removes a hold.** Billing has held such bills in the past, and this lets them be cleaned up. The status then goes to `null`, per the stage rule below.
- **Floor's ship-to save [re-gate]** also refuses a bill on a trip, matching billing's rule.

**Write-2 becomes per bill:**
- Read every live order on the SO (with the trip link and trip number).
- Apply the refusal. **Skip repeat presses** (the value is already set) without writing.
- Then one update + one log per bill.
- **Response [re-gate]:** the mail order row (write 1) is always saved first, so a future OBD still carries the mark.
  - **200** `{ ok:true, moOrder, updated, skipped[], failed[] }` whenever write 1 landed, even if some or all bills were refused. The bar shows the new state plus "N bill(s) refused: reason".
  - **422** only when nothing was saved at all.
  - Billing's client treats any non-200 as "nothing changed", so a 422 after a saved write 1 would leave the button showing the wrong state.

**Hold writes** `{dispatchStatus:'hold', heldAt: obdEmailDate ?? now}` plus one log with a **new `BILLING_HOLD_NOTE` added to `HOLD_LOG_NOTES`**.

**Release copies Floor's unhold:** `dispatchStatus = FLOOR_CLEAR_HOLD_STAGES.includes(stage) ? 'dispatch' : null`, with its own note kept out of `HOLD_LOG_NOTES`.

---

## 7. Colour — **[gate] + owner A, B**

- **New identity token `data.brown`** (proposed hex `#8B5A2B`; the build confirms contrast on white and on its bg tint). It is added to `tailwind.config.ts` and `CLAUDE_UI.md §2.1`, owner **Hand**. It is used for the Hand chip, the bar button, the picker card and the route-card "+N Hand" line.
- **CI = `ink-900` everywhere.** Move the Telephonic tab's CI tag off `data.blue` (`billing-telephonic-tab.tsx:73-79`, `:542-547`). `data.blue` then belongs to Local only.
- **Record the palette note:** after this, **no `data.*` colour is free**. The next category needs a new token.
- **[re-gate] contrast passes:** 5.84:1 on white and 5.31:1 on its tint. No other token uses the hex.
- **Before locking, check on a real Floor row:** brown sits near Urgent's amber. View a Hand chip next to an Urgent mark; if they blur, darken the brown.
- **CI = the SOLID dark style** (`bg-ink-900 text-white`). The pale ink tag was dropped on 2026-09-23 because it "read as disabled"; do not use it.
- **The Telephonic CI colour move touches:**
  - `billing-telephonic-tab.tsx:73-79`, `:542-547`
  - `tailwind.config.ts` (the `data.blue` comment)
  - `CLAUDE_UI.md §2.1`
  - one line in the 2026-09-23 Telephonic record saying its "CI stays blue" rule is superseded

---

## 8. Access

- **[proposed]** Two new page keys, **`billing_hand`** and **`billing_ci`**. Typed ship-to rides on `billing_ship_to`; Floor's Hand toggle rides on `floor` canEdit.
- Registration follows discovery "Page keys" items 1–10. Not `PAGE_NAV_MAP`.
- **Grants:**
  - `billing_hand` is copied from the `billing_hold` holders.
  - `billing_ci` is all-false, then ticked per named user.
  - Both are `user_page_access`. SELECT first.

---

## 9. Build checklist

1. Design draft ✅ (v4)
2. Gate ✅ + re-gate ✅
3. SQL (ship-to parts removed):
   - `mo_orders.billOnlyAt/ById`, `handAt/ById`
   - `orders.handAt/ById`
   - `so_tags.fromMailOrder`
   - `trips.isHand`
   - the `mo_orders(soNumber) WHERE billOnlyAt` index

   **No** `shipToText`/`shipToAreaId`, **no** `trip_drops` change, **no** challan table or bucket.
4. Prisma + CORE schema chain (+ `data.brown` in UI)
5. CI: engine order, enrichment skip + safety-net hold, one-tag rules, Cancel & CI widening, Telephonic statuses, guards
6. Hand: billing + Floor toggle, `isHand` trips, refusal, totals, push
7. Billing bottom bar + `billingRefusal` + per-bill write-2 + Hold/Release fixes
8. Page keys + grants
9. Verify + `code-update` draft + canon fixes

**Later, separate build:** ship-to redesign (§5.0: Orbit delivery points + challan copy). The two small ship-to bugs (the split route dropping the id; Floor's save wiping the flag) go on ROADMAP until then.

Each code step: a diagnosis prompt, then an implementation prompt. `tsc --noEmit`, stage by name, commit to main.

---

## 10. Corrections recorded

- The 2026-09-24 session first said Telephonic was "half built at step 3". **Wrong:** it all shipped (`6353d2a9` → `486ce08e`); it has never run on a real bill.
- v1 of this design:
  - proposed Hand = `data.blue` without checking. Blue is Local + the Telephonic CI tag.
  - said "reuse `offFloorRefusal`". That refuses tint-room bills and allows picked ones.
  - said "hold → cancel" with the cancel first. That leaves a cancelled bill with no CI.
  - proposed a bare `t:` drop key. The database rejects it, and it collides across dealers.

  All four are replaced above. Do not revert.
- v2 was corrected by the re-gate:
  - it linked the tag by `moOrderId` (one tag can't hold two mail orders) → now `fromMailOrder`
  - it answered with 422 after a saved mail order → now 200 + `failed[]`
  - it keyed the enrichment skip on the newest mail order → now any mail order on the SO, plus a safety-net hold
  - it had one "cancel failed" path → now split by which write failed
- Owner note: a Hold on a picked bill drops it off the picker's board mid-pick. Floor's Hold does the same today; this is accepted, not a bug.
- Earlier mockup versions had Hand in orange, then blue, and a Dispatch button. All removed.
