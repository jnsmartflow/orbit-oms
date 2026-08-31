# Code update — Picking SAP-name fallback + "not in master" marker

**Date:** 2026-08-31 · **Module:** Picking · **Type:** behaviour fix (no schema change, no SQL, no backfill)
**Follows:** the diagnosis run the same day (print-site trace → read chain → import path → consumer sweep)

---

## 1. The defect, in one paragraph

`lib/picking/queue.ts` printed the literal `"(Unmatched)"` as the card hero whenever the dealer FK
did not resolve against `delivery_point_master` — so a supervisor saw a bill with **no dealer name
anywhere on it**, and the where-row beside it showed a bare `—` for the same reason. The real SAP
dealer name was sitting **unread on the same in-memory object**: the `findMany` uses `include` with
no top-level `select`, so every base scalar of `orders` comes back, and the file already leans on
that for `order.smu`, `order.orderType` and `order.orderDateTime`. Picking was the **only** surface
in the app without this fallback.

**This is missing master data, not a matching bug.** These ship-to codes are genuinely absent from
`delivery_point_master`; a near-miss check on leading zeros and whitespace returned no rows. Adding
the customers to master is a **separate step and was explicitly not this change's job.**

---

## 2. Live numbers behind the decision (read-only SELECT, 31 Aug 2026)

| Population | Non-empty `orders.shipToCustomerName` |
|---|---|
| Unmatched bills in the **picking-visible set** | **39 of 39** |
| Unmatched bills **ever recorded** | **472 of 472** |
| Blanks / whitespace-only | **ZERO** |
| Near-miss master rows (leading zeros, whitespace) | **none** |

There is no case in live data where the fallback finds nothing. The `"(Unmatched)"` literal is kept
as the last resort anyway — it is now a genuinely unreachable branch on today's data, which is the
correct shape for a last resort.

---

## 3. What changed

### A · `lib/picking/queue.ts` — the fallback

```
dealerName:
  nonBlank(effectiveDealer?.customerName) ??
  nonBlank(order.shipToCustomerName) ??
  "(Unmatched)"
```

- **Verified before editing** that the `findMany` still has no top-level `select` (it does not — it
  is `include`-only), so `order.shipToCustomerName` genuinely rides along. No new query, no join, no
  extra await, no `$transaction` (CORE §3).
- **`nonBlank`, not a bare `??`.** A whitespace-only value would pass a `??` and render a **blank
  hero**, which reads as a render bug rather than a data gap — strictly worse than the literal. The
  helper returns the **original** string when it survives, never the trimmed one, so **no
  currently-rendering name changes a single byte.**
- The override-first / plain-`customerId`-second resolution at `:628-634` was **not touched.**

### B · `lib/picking/types.ts` — `dealerInMaster: boolean`

New field on `PickingQueueRow`, set in `queue.ts` as `effectiveDealer != null`.

🔴 **Derived from RESOLUTION, never from `orders.customerMissing`.** That column is stamped once at
import and goes **stale** the moment an admin backfills the customer: the admin routes clear it, but
nothing re-runs it on the ~10-minute auto-import path (`?action=patch-headers` never touches
`customerId` / `customerMissing` / `shipToCustomerName` — verified by grepping the whole handler
body). Whether the FK resolved *at render time* is the only truthful test.

`dealerName` stays typed `string`, non-nullable — deliberately **not** widened.

⚠ **A trap this creates, recorded on the type itself:** before this change,
`dealerName === "(Unmatched)"` was a usable (if ugly) test for "dealer not on file". It now silently
returns `false` for exactly the bills it used to catch. Nothing in the repo did that test (grepped —
`dealerName ===` / `!==` / `.startsWith` / `.includes` all clean on the picking row), but the next
person to reach for it must read `dealerInMaster` instead.

### C · The two cards — the marker in the route slot

`components/picking/picking-board-mobile.tsx` and `components/picking/picker-my-picks-board.tsx`.

Both rendered `{row.route ?? "—"}`. When the dealer is not in master, that `—` is **the same null
that emptied the name** — one dead FK empties `route`, `area`, `deliveryType` and `bayNumber`
together, and SAP supplies no equivalent for any of them. So the marker **replaces** the em-dash
rather than joining it: the slot was already saying nothing, and spending it keeps the row
width-neutral, which is what 320px (`CLAUDE_UI.md §60`) can afford.

**If a route somehow IS present it wins** — a real lane name is worth more to a supervisor than a
note about master data. That two-part rule lives in one exported predicate,
`showsRouteSlotMarker()`, so both cards ask it identically.

### D · The two detail headers — the marker beside the name

Same two files. The header has **no route slot any more** (the route moved to `BillBand` on
2026-08-22), so the chip sits beside the 18px hero, gated on the bare `!dealerInMaster`. Name keeps
`truncate min-w-0`, chip is `shrink-0` — so the **name** gives way, which is the ordering
`bill-symbols.tsx` already states ("a name is recoverable by opening the bill, a flag you cannot see
is not"). Both faces are byte-identical to each other.

### E · `lib/picking/search.ts` — "unmatched" preserved DELIBERATELY

Before this change an unmastered bill's `dealerName` **was** the literal, so typing `unmatched`
found every one of them. Nobody designed that — but it became the **only** way to find them, because
the route filter cannot reach a bill whose route is null (`routeCounts` skips it), so these bills
vanish the instant any route is selected.

Giving them their real name would have **silently deleted that escape hatch on the same commit that
made them findable by name.** One clause preserves it as a *synthetic* term, not as a leftover of how
the name used to read:

```
(row.dealerInMaster ? "" : "unmatched").includes(q)
```

Same shape as the existing `route`/`area` clauses: `""` for most rows, and `"".includes(q)` is false
for every non-empty `q`. It widens the match for unmastered bills **only** and cannot affect any
other row. The other five match fields are untouched.

### F · The three push-notification routes

`assign` / `done` / `cancel` build the string **independently** from their own relation includes —
they never go through `queue.ts`, so the fix at `queue.ts:675` alone would have left every push
still saying "(Unmatched)" while the card behind it named the dealer.

All three use an **explicit `select`**, unlike `queue.ts`'s `include`, so `shipToCustomerName` had to
be **added to each select** — it does not ride along. Verified per route, at the call site.

**No marker in notification text.** A push body is a few words on a lock screen, not a place for a
data-quality badge.

### G · `lib/floor/queries.ts` — ONE line, compile-required, NOT a Floor change

⚠ **This file was named out of scope, and this is a declared exception with a hard reason.**

`FloorBoardRow extends PickingQueueRow` (`lib/floor/types.ts:97`). Adding a required field to the
base interface **breaks Floor's build** — `tsc` named exactly one construction site
(`lib/floor/queries.ts:695`) and the repo does not compile without it. This is precisely the
cross-module dependency `CLAUDE_PICKING.md §7`'s "grep every consumer before shipping" rule exists to
catch, and it caught it.

What was added: `dealerInMaster: dealer != null` — the same expression as Picking's, so the flag
cannot come to mean two things.

🔴 **Nothing on Floor reads it and nothing on Floor changed.** Floor's own `dealerName` still prints
the literal, deliberately: Floor already shows a real name through `billToName` (`billToByObd`), so
it never had Picking's blank-card problem. Whether Floor should *also* fall back to
`orders.shipToCustomerName` is a **Floor decision for a Floor session** (`CLAUDE_FLOOR.md §1` — Floor
is a CALLER of Picking, and Picking must not reach in here to change what that board renders).

---

## 4. Marker visual

Shared atom `NotInMasterChip` + predicate `showsRouteSlotMarker` in
`components/picking/card-atoms.tsx` — the module's established one-owner-per-visual-rule home,
alongside `AgeBadge` and `SmuBadge`.

| Ground | Classes |
|---|---|
| Card where-row (white) | `text-[10.5px] font-semibold px-2 py-[3px] rounded-full shrink-0 whitespace-nowrap bg-amber-50 text-amber-700` |
| `onDark` — duplicate-SO red card **and** teal detail header | same, with `bg-white text-amber-700` |

Label: **`not in master`**. Chosen over "Missing" (which in a route slot reads as *route* missing)
and over "unmastered" (jargon). `title` + `aria-label` carry the long form.

**Why this satisfies §60 / §62:**

- **§60 chip token** — 10.5px / weight 600 is the documented chip size+weight, and the geometry is
  `AgeBadge`'s to the pixel. No new spacing scale was invented, for the same reason `SmuBadge`
  did not invent one.
- **§60 "weight, not colour, is the heavy dial"** — nothing on the row went to 700; the hero stays
  the only 600-weight line of consequence.
- **§60 320px-safe** — the marker *replaces* the em-dash rather than adding an element, so the
  row's element count is unchanged. Worst realistic case (Picking tab: dot + chip + `·` + volume +
  picker name + SMU badge + card padding) measures ≈ 303px, inside 320. On the Assign tab, where
  unmastered bills actually sit, there is no picker name at all.
- **§62 one-teal** — amber, never teal. Teal on this board is the Assign CTA and the selected-card
  tint only.
- **§62.3 no second dot** — `RouteDot` sits immediately left, keys on `deliveryType`, and already
  renders grey `#9ca3af` on the null that comes with an unmastered dealer. A coloured dot here would
  be a second status light on one 12px line.
- **Quiet by construction** — it takes `AgeBadge`'s *quietest* tier (the `1d` "yesterday is not a
  crisis" nudge), never the 2d+/4d+ amber-100/300 solids or the 4d+ red. Those belong to staleness,
  and putting a data-quality note on that ladder would claim an urgency the data does not support —
  the same argument `AgeBadge` already makes for sending `noDispatchDate` to grey.
- **Not `DUP_SO_BADGE_CLASS`** on the red card, though that is the established flip idiom: that
  pill's text is `#b91c1c`, and wearing the duplicate-SO red would make this read as *part of* the
  duplicate-SO treatment. White + amber-700 keeps the register distinct on both dark grounds.

---

## 5. Doc correction surfaced by the diagnosis — for the next consolidation pass

**`docs/CLAUDE_PICKING.md` says the card's where-row shows AREA. The live code has rendered ROUTE
since 2026-08-21.** Two places:

- **§5.1, line ~363:** *"**where-row = route dot + area + volume**, with the picker name at its right
  end on Picking/Done"*
- **§5.4, line ~634:** *"Four rows, not three: caption + signals · dealer name + slot hero · route
  dot + **area** + `articleTag` + volume · the family-chip shelf"*

The code at both call sites renders `{row.route ?? "—"}` and carries an in-source comment saying
`ROUTE, not area (2026-08-21)`. The doc is v1.15, updated 2026-08-19 — **two days before the swap**,
so it is lag, not a contradiction anyone introduced. **Code wins** (CORE §3 / router §5).

`row.area` is still fetched and still fed to the search predicate; it is simply no longer *printed*
on either card. The `RouteDot` beside it does still key on `deliveryType`, which the doc has right.

**Not edited in this pass, by instruction.** Two further §8 nits for the same pass:

- §8's `card-atoms.tsx` row says *"Both import exactly four: `AgeBadge`, `CardShelf`,
  `CARD_SHADOW_V2`, `RouteDot`"* — already stale before today (`SmuBadge` / `isSmuBadged` landed
  2026-08-19); this change makes it **seven** (`NotInMasterChip`, `showsRouteSlotMarker`).
- §8's `lib/picking/types.ts` row should gain `dealerInMaster`.

---

## 6. Consumer grep (CLAUDE_PICKING.md §7 standing rule)

`dealerInMaster` — 12 hits, all accounted for: 1 producer (`queue.ts`), 1 type, 1 search field,
1 predicate, 2 header call sites, 1 compile-required Floor fill, 5 comments/doc-lines.

Every remaining `dealerName` reader was checked against a name that is now **longer and differently
shaped** (SAP names are uppercase and run longer than master names):

| Reader | Verdict |
|---|---|
| Both card heroes | `truncate min-w-0` — truncates |
| Both detail headers | `truncate min-w-0`, chip `shrink-0` — name gives way |
| Combined bill pills (`picker-my-picks-board.tsx:1216`) | `max-w-[132px] truncate` — safe |
| 5 toasts + 2 `aria-label`s | plain interpolation — no layout |
| Release / cancel confirm sheets | inline `<b>` in flowing text — wraps |
| `app/api/picking/combined/route.ts:109` | copies `r.dealerName` — inherits the better name for free; no marker there (not in scope) |
| 3 push bodies | fixed in Part F |
| **Assign-picker sheet subtitle** (`:4162`) | ⚠ the **one** place a longer name changes layout: a plain `<p>`, so a very long SAP name **wraps to a second line** and nudges the picker list down a few px. Degrades gracefully — no clipping, no overflow. Left as-is. |

No code anywhere string-compares `dealerName` against the literal (`dealerName ===` / `!==` /
`.startsWith` / `.includes` all clean on the picking row; the `dealerName` hits under
`app/api/sampling-library/**` are a different, unrelated field on `sampling_register`).

---

## 7. Out of scope — noted, deliberately not done

- **`components/shared/order-detail-panel.tsx:157`** — `o?.customer?.customerName ?? "—"`, the same
  gap. Its own API (`app/api/orders/[id]/detail/route.ts:78`) **already fetches**
  `importSummary.shipToCustomerName` and the panel ignores it, so the fix is one line. **Left
  alone:** the panel is shared by Tint Manager *and* Floor, so changing it here widens the blast
  radius past Picking. Genuinely worth doing in its own session.
- **Floor's own `dealerName`** (4 sites in `lib/floor/queries.ts`) — see §3.G.
- **`components/picking/bill-band.tsx`** prints `"Unmatched"` in its ROUTE slot when `route` is null.
  Now that the header names the dealer and carries the chip, that word is arguably redundant and
  arguably ambiguous (it sits under a `Route` caption). Its own file-comment explains why it is
  there. **Not touched** — a deliberate design decision from 2026-08-22 needs a decision to undo, not
  a drive-by.
- **Adding the 39 (472) missing customers to `delivery_point_master`** — the actual root cause. A
  data task, not a code task.
- `PICKING_SPINE` / `lib/picking/sort.ts` — no sort rule reads the name; untouched.
- Route filter, `routeCounts`, type filter, `grouping.ts` — untouched.
- The `shipToCustomerId ?? obdNumber` import padding — live count returned 0 rows in that state.
- No schema change ⇒ no `prisma db push`, no `prisma generate`, no SQL, no backfill.

---

## 8. Verification

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **clean, exit 0** (re-run after `next build`) |
| `npx next build` | **succeeded**; `/picking` compiled, 27.3 kB / 159 kB First Load |
| ESLint | **not configured in this repo** — `next lint` prompts to create a config; not run, and no config was created. CORE §3's gate is `tsc`. |
| Board rendered with real data | ❌ **NOT VERIFIED — no credentials.** `/picking` and `/api/picking/queue` both 307 → `/login` behind the middleware auth gate. The dev server also points at the **production** DB, so no test login was created. What a build proves is that all four edited components compile and the client boundary is sound; it does **not** prove the marker's on-screen placement, its 320px fit, or that an unmatched bill now shows its SAP name. **Those need a phone and a real login.** |

### What to check on the first real login

1. A **matched** bill still shows its master name + its route (should be byte-identical to before).
2. An **unmatched** bill shows the SAP name as the hero **and** the amber `not in master` chip where
   the `—` used to be.
3. The chip does not clip at 320px on the **Picking** tab (worst case: chip + volume + picker name +
   SMU badge).
4. Typing `unmatched` in the search box still returns exactly those bills.
5. Both detail headers show the chip beside the name, on both faces.
