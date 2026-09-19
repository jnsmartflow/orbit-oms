# Picking — pick bundles on the supervisor's Assign tab

**2026-08-18 · commit `467c2afe` · pushed to `main`**

> Draft record, not canon. No canonical `CLAUDE_*.md` was edited — §9 lists what
> `CLAUDE_PICKING.md` is owed at the next reconciliation pass.
>
> Companion draft: `code-update-2026-08-18-floor-oil-grouping.md` (the two rules, the
> shared-SKU mistake that shaped Rule 2, and the engine's move into `lib/picking/`).

---

## 1. What shipped

The supervisor's **Assign tab** now groups its waiting bills, using the shared engine
`lib/picking/grouping.ts` **unmodified**. Rule 1 runs first over the whole Zone-1 set, Rule 2
over what Rule 1 left; a bill is never in both.

| File | What changed |
|---|---|
| `lib/picking/queue.ts` | `PICKING_GROUPING_ENABLED`, `PickingBillSkus`, two flag-gated sequential awaits, `waitingSkus` + `oilSkus` siblings on `PickingQueueResult` |
| `components/picking/picking-board-mobile.tsx` | `bundles` memo, `BundleHeading`, optional `stripe` prop on `PickingCard`, the grouped Zone-1 render |

**Two files. Nothing else.** No schema change, no new API route, no new write path, no
`orders.update`, nothing under `lib/floor/` or `components/floor/`.

### Explicitly untouched

- 🔒 **Zone 2 (upcoming / locked)** — never fed to the engine. An upcoming bill is not
  assignable, so bundling it would offer the supervisor work he is not allowed to hand out.
- 🔒 **The Picking tab and the Done tab** — outside every hunk.
- 🔒 **The picker's own board** (`picker-my-picks-board.tsx`) — **0 lines changed**.
- 🔒 **Selection, the assign path, and the live-refresh pauses** (`detailOpen || overlayBusy`)
  — untouched. `picking-mobile-shell.tsx`, `card-atoms.tsx`, `use-bill-pager.ts`,
  `finding-recorder.tsx` all **0 lines changed**.

The grouping is a **hint, not a control**: no new tap target, no new sheet, no change to the
assign call. He taps cards and uses the Assign bar exactly as he did yesterday.

---

## 2. 🔴 LANDMINE — TWO READERS OF `import_raw_line_items`, ON PURPOSE

**`lib/picking/queue.ts` now reads `import_raw_line_items` TWICE per call, with DIFFERENT
filters, and the two are NOT interchangeable. Do not "unify" them without reading all of
this section.**

| Reader | Where | Filter | Feeds |
|---|---|---|---|
| **A — family chips** | `getPickingQueue`, the product-family aggregation (2026-07-21) | `{ obdNumber: { in: … }, lineStatus: 'active', `**`rowStatus: 'valid'`**` }` | `row.families`, `row.unresolvedLineCount` → the card's pack/family shelf |
| **B — pick bundling** | `getPickingQueue`, the flag-gated block (2026-08-18) | `{ obdNumber: { in: … }, lineStatus: 'active' }` — **no `rowStatus`** | `waitingSkus` / `oilSkus` → the grouping engine |

Reader B also scopes to **waiting Zone-1 rows only**; reader A covers every loaded OBD.
Reader B's catalog query selects `material, category, paintType`; reader A's selects
`material, category, displayCategory` (`FAMILY_CATALOG_SELECT`).

### Why B must not reuse A

**B deliberately mirrors `lib/floor/queries.ts` `skusByObd()`, which omits `rowStatus` on
purpose** — its own comment: *"a parse-rejected row is still a tin the picker will be
holding."*

If B reused A's `rowStatus: 'valid'` set, then **for any OBD carrying a parse-rejected line
the phone would see a different SKU set than Floor does.** The engine is deterministic, so
identical bills would then produce **different bundles on the two screens**: the same two
bills could group on the desk and not on the phone. One supervisor, two screens, one shift —
a contradiction he cannot explain and would rightly stop trusting both screens over.

Avoiding exactly that is why the engine was moved to `lib/picking/` and is shared rather than
copied (`code-update-2026-08-18-floor-oil-grouping.md` §11). A shared engine fed two different
inputs is a copy with extra steps.

### Why A must not simply drop its filter instead

`rowStatus: 'valid'` is **load-bearing for the card**: A's own comment says it keeps *"only
lines a picker would actually handle."* Removing it would change `families` and
`unresolvedLineCount`, i.e. **the pack/family chips on every Assign card** — a visible
behaviour change to a shipped card, and out of scope for a grouping feature.

### The rule for anyone unifying them

> **FIRST decide which SKU set is correct** — "every active line" or "every active, valid
> line" — **then change BOTH screens together**, Floor's `skusByObd()` and Picking's reader B,
> in one commit, with the family-chip consequence understood and accepted.
>
> Making them one query *without* that decision silently picks a winner, and the losing screen
> is the one nobody is looking at.

The cost as shipped is **two extra SELECTs on one tab's rows**. That was chosen knowingly over
a silent desync between two screens one person uses in the same shift.

---

## 3. The stripe — how it is built, and why not otherwise

A grouped card gets a 4px full-height bar on its **left edge, inside the rounded corners**.
Teal = SAME MATERIAL, amber = MOSTLY SAME.

```
absolute left-0 inset-y-0 w-[4px] pointer-events-none
```

Four properties, each load-bearing:

- **`absolute`** — it takes **no part in layout**. Nothing below or beside it moves by a
  pixel. This is what lets the card's padding stay exactly as it was.
- **overlays the existing `px-4`** — the stripe sits on the leftmost 4px of the 16px left
  padding that was already there. **It is absorbed by existing space, never paid for with
  new space.** The card's content x-position is unchanged.
- **`inset-y-0` + the card's own `overflow-hidden`** — full height including the shelf, and
  clipped to the 20px corner radius, so it reads as part of the card rather than a bar beside
  it. The card div gained `relative` for this; `CardShelf`'s only absolute child already has
  its own `relative` ancestor, so nothing else re-anchored.
- **`pointer-events-none`** — it can never eat a tap meant for the card body. This is a hint;
  a hint must not be tappable.

> ⚠️ **Anyone "tidying" this into a `border-l`, a flex child, or a padding change will shift
> every grouped card's content and break its alignment with the ungrouped cards above and
> below it.** The stripe is absolute *because* the card must not move, not because absolute
> positioning was convenient.

The `stripe` prop is **optional and defaulted to `null`**, so every existing `PickingCard`
call site renders byte-identically and no other variant grew a stripe.

---

## 4. What was deliberately NOT added — do not rediscover these as missing

Each of the following exists on Floor's desk screen or was considered for the phone, and each
was **rejected for the phone specifically**:

| Not added | Why |
|---|---|
| `MAIN BILL` chip | A Rule 2 group has no main; on a Rule 1 group it is true but adds a third thing to read on a 6-line card |
| `FREE` chip | Same — the stripe already says "these travel together" |
| `+N steps · shares M` chip | Measures a rider against a main; Rule 2 has neither |
| Per-group buttons ("Assign all N") | **Would compete with the Assign bar that already exists.** Two ways to assign on one screen is how a supervisor ends up unsure which one he pressed |
| Checkboxes | Removed from this card in 2026-07-21; selection is the card tint + corner badge. Re-adding one for groups would resurrect a retired interaction |
| Group counts ("3 bills") | The cards under the heading are countable and few |
| "saves N trips" | Rule 2 has no such number, and showing it only for Rule 1 would make the two kinds read as different sorts of thing rather than two answers to the same question |

**The stripe and the heading carry the whole message.** That was the design decision, not an
oversight or an unfinished pass.

---

## 5. Labels are SHARED with Floor — change both or neither

```
SAME MATERIAL     Rule 1   teal
MOSTLY SAME       Rule 2   amber
SINGLE PICKS      ungrouped
```

Identical wording on `/floor`'s By-group view and on the phone, **by design**. One supervisor
moves between the desk screen and his phone inside a single shift; two vocabularies for the
same two ideas is a defect, not a detail.

> **Changing a label on one screen without the other is a regression even if it reads better
> in isolation.**

Phone-only differences, both deliberate: the heading carries a coloured **dot** (the desk uses
a pill), and the tail reads **"· one picker"** — the desk has an assign bar in view that says
so, the phone does not. The quiet non-oil line is identical on both:
*"Some items here are outside the oil paint area."*

The board's own established pattern is followed for the empty case: **no `SINGLE PICKS`
heading when there are no groups at all** — with nothing to distinguish them from it would be
chrome labelling the obvious, the same call this tab already makes for its "Due now" header.

---

## 6. Why a separate flag

| Flag | Where | Gates |
|---|---|---|
| `PICKING_GROUPING_ENABLED` | `lib/picking/queue.ts` | **Both** rules on the phone |
| `RULE2_ENABLED` | `lib/floor/queries.ts` | Floor's **second** rule only |

Same engine, **independent rollout**. The phone is used by three supervisors on the floor and
Floor by the operations desk; either has to be switchable off alone without taking the other
with it. One shared flag would make the first bad reaction on either screen cost both.

The phone's flag gates **both** rules because the whole grouping display is new there —
`false` must mean the board it has always been, not a board missing half a feature it never
had. Floor's gates only Rule 2 because Rule 1 already shipped there.

**False on the phone means:** neither query is issued, both siblings ship `[]`, every
candidate has zero SKUs, the engine drops them all, and the client renders today's flat list.
The FIELDS always exist, so no caller's type moves with the flag.

---

## 7. Measured

The live Assign tab had **0 waiting bills** during the build (waiting is transient — it was 4
earlier the same day), so asserting against it would have passed vacuously. The proof
(`scripts/_picking-grouping-check.ts`, scratch, uncommitted) falls back to a **real past day's
bills** — real orders, real lines, real catalog.

**124 real bills:**

| | count |
|---|---|
| SAME MATERIAL groups | **21** |
| MOSTLY SAME groups | **7** |
| SINGLE PICKS | **52** |

Asserts, all passing: no bill in both kinds · identical input → identical JSON on a second run
· `waitingSkus` covers exactly the waiting due-zone rows.

**Flag off, on the same 124 bills:** 0 same-material groups, 0 mostly-same groups, **124/124
ungrouped** — which is the exact condition selecting the flat-list branch. That branch's JSX
was extracted from the working tree and from `git show HEAD:` and compared: **identical**. No
`stripe` prop reaches any card there, so no stripe, no heading, no `SINGLE PICKS`.

`npx tsc --noEmit` exit 0. `git diff --stat lib/picking/grouping.ts` **empty** — the engine
was used, not modified.

---

## 8. 🔴 Still unverified

- **No grouped card has been seen rendered on a real device.** The engine output is proven on
  124 real bills; **the stripe is not proven at all.** A full DOM render was not possible
  without exporting the board's module-private context, which would have been a production
  edit made purely for a test.
- **First two things to check on a phone, in this order:**
  1. **The stripe shifts no card content.** Put a grouped and an ungrouped card on screen
     together and confirm the OBD line, dealer name, slot, route dot, litres, pack chips and
     arrow sit at *exactly* the same x. This is the easiest thing here to get wrong.
  2. **The stripe under the selected state.** A selected SAME MATERIAL card is teal stripe on
     `bg-teal-50` tint — confirm it stays legible. And the floating teal check badge sits at
     `-top-[7px] -left-[7px]`, i.e. **over the stripe's top corner** — confirm that reads as
     intentional and not as a smudge.
- Then: the two kinds distinguishable at a glance in depot light on a real phone; the non-oil
  line reading as information rather than a warning; selection + assign behaving exactly as
  before across groups; a quick pass over Zone 2 / Picking / Done / the picker's board.
- **Not tested:** rapid double-press of the Assign bar with a multi-group selection.

---

## 9. Corrections owed to `docs/CLAUDE_PICKING.md`

Nothing below has been applied. Listed for the next reconciliation pass.

| § | What needs saying |
|---|---|
| **§8 key files** | New row: `lib/picking/grouping.ts` — the two pick-bundling rules, pure, no prisma/clock/IO. Consumers: Floor's By-group view and this board's Assign tab |
| **§8 key files** | `lib/picking/types.ts` row: now also carries `PickGroupCandidate` / `PickGroup` / `OilGroup` (moved from `lib/floor/types.ts`, commit `3fdd0e13`) |
| **§8 key files** | `lib/picking/queue.ts` row: now also returns `waitingSkus` / `oilSkus` siblings and owns `PICKING_GROUPING_ENABLED` |
| **§5 (supervisor board)** | The Assign tab's Zone-1 list is grouped when the flag is on; Zone 2 is never grouped. The card is unchanged apart from an optional left stripe |
| **NEW landmine entry** | §2 above, verbatim — the two `import_raw_line_items` readers and the rule for unifying them. **This is the one that must not be lost**; the rest is recoverable from the code |
| **A rules section** | Worth its own §, lifted from the Floor draft's §2-§3 — especially the shared-SKU mistake, which is the part a future reader most needs and the part least visible in the code |
| **Cross-ref** | `CLAUDE_FLOOR.md`'s ownership table needs the matching row change (Floor is a CALLER of the rules) — tracked in the Floor draft, listed here so the two passes do not each assume the other did it |

---

*Draft · 2026-08-18 · commit `467c2afe` · Picking · OrbitOMS*
