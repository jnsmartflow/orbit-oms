# code-update-2026-08-20 — Duplicate SO Number highlight (Picking supervisor + Floor Control)

**Status:** SHIPPED — commits `4f21b7da` (data) + `57cd274d` (screens), both pushed to `main`.
**Hand-verification: PENDING.** Claude Code has no login and rendered nothing; every visual claim
below is reasoned, not observed. The hand-test list is §8.

**Owner:** Picking. Floor imports the helper and the shared tag, exactly as it already imports
`/api/picking/assign`. → one owner per behaviour.

---

## 1. What it does

When two or more live orders carry the **same `orders.soNumber`**, every one of them renders as a
solid red card/row on the Picking supervisor board and on Floor Control, plus a red header on the
detail screen. The supervisor opens them and decides which is the real bill.

**The SO number itself is never rendered** and never reaches the card payload — only a boolean.
Smart Flow was explicit: the number is noise on a card, the warning is the signal.

The flag says *"same SO, go check"*. It does **not** say which copy is wrong. Nothing in the
database can answer that today (§6).

---

## 2. The rule (locked 2026-08-20, do not re-open without new evidence)

A row is flagged when 2+ orders share its `soNumber`, counting orders where:

```
isRemoved = false  AND  workflowStage <> 'cancelled'
```

Three deliberate choices inside that:

- **Already-dispatched and closed twins DO count.** A re-punch of a bill that already shipped is
  precisely the case the feature exists for. Choosing "only twins still on a board" would have gone
  silent on it.
- **Blank/null `soNumber` is never flagged.** A null-vs-null match is not a duplicate. Postgres
  groups all NULLs into one group, so an unguarded `groupBy` would paint every un-punched bill red.
  The guard is load-bearing even though live data currently has zero nulls (§5).
- **Genuine SAP split bills are flagged too, and that is accepted.** See §6.

**The flag is computed on every load and never stored.** This is what makes the case Smart Flow
asked for work: a bill already assigned to a picker turns red when a twin arrives *afterwards*,
because it is re-evaluated on the same refresh as everything else — Picking's 15s marker,
Floor's 30s rail poll.

---

## 3. Data layer — `4f21b7da`

`lib/picking/duplicate-so.ts` (NEW) — `getDuplicateSoNumbers(soNumbers)` → `Set<string>`.

```ts
const groups = await prisma.orders.groupBy({
  by: ["soNumber"],
  where: {
    soNumber: { in: candidates },
    isRemoved: false,
    workflowStage: { not: "cancelled" },
  },
  _count: { _all: true },
});
```

- **Bounded on purpose.** It asks only about the SO numbers on the rows being returned, never an
  unbounded `having` scan of the ~11,400-row table. Do not "simplify" it into one.
- Empty candidate list → returns an empty Set **without querying**.
- One sequential await per feed, sitting alongside the existing post-fetch enrichments. Never
  `$transaction`, never inside a per-row loop.

`hasDuplicateSo: boolean` added to `PickingQueueRow` (`lib/picking/types.ts`) and `FloorRailCard`
(`lib/floor/types.ts`). `FloorBoardRow` extends `PickingQueueRow` so it inherited the field — but
`lib/floor/queries.ts` still has to FILL it or `tsc` fails. Filled at three call sites:
`getPickingQueue()`, `getFloorRail()`, `getFloorBoard()`.

**Nothing else was touched.** `buildPickingWhere`, `floorLiveBaseWhere` and
`getFloorLiveMarkerWhere` are byte-identical; neither marker route changed. Both live-sync markers
still aggregate over exactly the set they did before, so no board's row set moved.

**Candidate scoping consequence, intended:** the duplicate set is scoped to the SO numbers on each
feed's own rows, so Picking and Floor can each flag a bill whose twin the other surface is not
showing. That is the correct reading of "same SO, go check" — and it is why the count deliberately
ignores `dispatchStatus` and the hide filter.

---

## 4. Screens — `57cd274d`

**`components/shared/duplicate-so-tag.tsx` (NEW) — the single owner of the red.** Exports
`DuplicateSoTag` plus every token (fill, border, text, muted, divider, wash, band, badge class, row
class). Both modules import from here. **Never re-declare the hex values at a call site** — two
screens declaring their own red is how they drift apart.

Approved treatment (option A of the mockup): fill `#dc2626`, border `#b91c1c`, white name/OBD,
`#fecaca` secondary, white-alpha wash on chips/arrow/buttons, tag reads **"SAME SO"** in white on
red-700.

**The non-obvious half of this work:** every badge that is normally red or amber — `AgeBadge`,
the elapsed pill, urgent ⚡, `StatusPill` — flips to a **white pill with `#b91c1c` text** on a red
card, or it disappears into the fill. `card-atoms.tsx` and `status-pill.tsx` gained an optional
`onRed` prop, defaulted `false`, so every existing call site renders byte-identical DOM.

Traps hit and handled — each is a class, not a one-off:

- **Inline style beats className.** `assignLocked` set `background: "#fcfcfd"` inline; the red would
  have lost. Resolved by gating the locked arm on `!dup` so the two can never both be live, in one
  visible place. The lock glyph also had to go white.
- **`doneChecked` renders at `opacity-75`.** A dimmed duplicate is the opposite of the point —
  dimming means "settled, stop looking". Now `variant === "doneChecked" && !dup`.
- **Selection and search-highlight both signal in teal, and red has taken the fill.** Both now use a
  white+teal outward ring via `box-shadow` (`0 0 0 2px #fff, 0 0 0 4px #0d9488`) — no layout cost,
  not clipped by the card's `overflow-hidden`, and the list padding (px-4 picking / p-2.5 rail)
  clears it. Picking additionally keeps its teal check badge, so selection has two independent
  signals. **Unverified on a real device** — hand-test items 2 and 9.
- **The detail-panel flag is keyed on the LIVE `detail.orderId`, not the row clicked.** `navigateDetail`
  walks Prev/Next to another bill without re-opening the panel; a value captured at click time
  describes the wrong bill from the second one onward. Same class as any "capture at open" bug.
- **The header flag-row guard had to be widened.** The same trap the file already documents for
  `isSmuBadged`: a flagged bill that is not a key dealer, urgent or a tint would have had the whole
  row suppressed and lost its tag.

Floor's detail panel got the flag **by prop** from `floor-page.tsx` off already-loaded rows —
`app/api/floor/order/[orderId]/route.ts` untouched, so there is no second source of truth.

**Sort order unchanged.** Red cards hold their position; they are not floated or grouped.

**The picker face is untouched** — `picker-my-picks-board.tsx` shows no diff. The decision belongs to
the supervisor; the picker keeps picking.

---

## 5. Live-data evidence (measured 2026-08-20, cite as-dated)

- **221** SO numbers are shared by 2+ orders, out of **11,102** distinct — about **2%**.
- **213** have 2+ live copies. Mostly pairs (189); one SO carries **10** orders.
- Only **19** of those rows were on a board at the time of measuring (1 waiting, 6 held, 12 checked)
  — the rest are `closed`/`dispatched` history.
- Typical day: **1–4** duplicate groups. 06-08 spiked to 23. **This will not flood the board.**
- **178** of 213 are same customer + same day; 17 reuse the SO on a different day; 8 sit on
  different customers.
- **141** groups have different unit qty, **72** identical — i.e. most duplicates are *not* clean
  copies.
- `soNumber <> btrim(soNumber)` → **0**. No blank strings either (`toStr(...) || null` collapses
  them). No normalisation debt. The null/blank guards stay regardless — the column is nullable.

⚠ **`closed` is a real `workflowStage`.** A survey query written for this session excluded
`cancelled` and `dispatched` but not `closed`, and reported 213 orders as "on a board today" when
the true figure was 19. Corrected before any decision was taken. Any future "still open" predicate
must name `closed` explicitly.

---

## 6. Known gaps — do not rediscover as bugs

- **A genuine SAP split bill and a double-punch are indistinguishable in the data.** There is no
  marker on `orders`: `order_splits` is *tint* splits of one order, and `mo_orders.splitLabel` A/B
  children are created without a soNumber and punched separately, so they get distinct SOs. The
  billing actions route already documents "one soNumber can map to SEVERAL OBDs (split bills)…
  intended, confirmed 2026-07-31". **Splits will show red.** Accepted deliberately — the signal is
  neutral, so a false red costs one look, while a filter built on a guess costs a missed
  double-punch. → ROADMAP: add a real split marker at import time, then narrow the flag.
- **Floor's Hold tab and Cancelled tab are NOT flagged.** Separate feeds, two more call sites of the
  same helper. Known gap, not a failure.
- **The picker face is not flagged** — deliberate scope decision, see §4.
- **This cannot say which copy is correct.** In the KRISHNA PAINTS case (SO `1046574001`, three OBDs
  at 259 / 259 / 273 units) all three go red and a person decides.

---

## 7. Where this belongs at consolidation

- **`CLAUDE_PICKING.md`** — owner. The rule (§2), the helper and its bounded-groupBy discipline
  (§3), the card treatment across all five variants, the supervisor detail header.
- **`CLAUDE_FLOOR.md`** — cross-reference only. Name the three surfaces that render it (rail card,
  board row, detail panel) and the by-prop threading; do not restate the rule.
- **`CLAUDE_UI.md`** — the red treatment itself: the shared token file as sole owner, the `onRed`
  badge convention, and the white+teal ring device for "selection when the fill is taken".
- **`CLAUDE_CORE.md`** — one line only, if anything: `closed` belongs in any stage list that claims
  to mean "still open".
- **`ROADMAP.md`** — the split marker; Hold/Cancelled tabs; picker face if it is ever wanted.

No schema change, so no schema version bump.

---

## 8. Hand-test list (PENDING — nothing below has been observed)

Needs a bill with a live twin. Today's: SO `1046574001` → KRISHNA PAINTS, OBDs `9108975467`,
`9108990880`, `9109013523`, all checked (Done → Checked). SO `1046574550` → SILVER PAINTS, with
`9109032100` still waiting (Assign tab + Floor).

**/picking — supervisor, on a phone**

1. Assign tab, unselected — solid red, "SAME SO" tag leading the caption cluster, white name/OBD,
   `#fecaca` area, chips and arrow legible, route dot keeps its colour with a white ring.
2. Assign tab, tap to select — teal check badge **and** the white+teal ring. Confirm the ring is not
   clipped at the list's left edge on a 390px viewport, and that selected still reads at a glance.
3. Zone 2 (locked/upcoming) duplicate — red, not `#fcfcfd`; lock glyph white; "for {Day}" a white pill.
4. Picking tab — elapsed pill is a white pill, and still updates on the 30s tick.
5. Done tab, both bands — white pills; a checked duplicate at **full strength**, not dimmed.
6. Open a red card → detail header red with the tag; Back returns to the list, card still red.
7. Regression: a non-duplicate card on every tab looks exactly as before. Same for the whole picker
   face (`?view=picker&as=<id>`).

**/floor — desk**

8. Rail card — red, tag, Hold/✕ washed white, the teal Release split button still the loudest thing.
9. Rail + search — a query matching a red card: white border + white/teal ring, reading as "search
   hit" and not as a second status.
10. Board rows — red row, tag beside the OBD, StatusPill a white pill, ⚡ and ★ white, ship-to
    redirect legible. **Hover must darken to `#b91c1c`** — check this one first; the fill is a class
    specifically so hover survives.
11. By-group / By-picker views, All + slot tabs, History day, Upcoming strip — same treatment in all.
12. Tick a red row, use the assign bar — the teal checkbox must still read as ticked on red.
13. Detail panel — open a flagged bill from the rail **and** from the board; then Prev/Next onto a
    non-flagged bill: the header must go back to white. (This is the bug the `detail.orderId` keying
    prevents — worth proving.)
14. Hold and Cancelled tabs — no red. Known gap, not a failure.

**The live case worth waiting for:** a bill already assigned to a picker, then a twin arrives from
SAP. Within one refresh cycle the assigned card should turn red on its own, with nobody touching
anything. That is the behaviour the whole feature was asked for.
