# web-update-2026-07-16-picking-mobile-supervisor-board

**Session date:** 2026-07-16
**Module:** Picking (mobile supervisor board)
**Status:** Live in production on `/picking` (mobile viewport). Test-mode assign — all assignments tagged and reversible.
**Consolidate into:** `CLAUDE_UI.md` (new mobile board section) + `CLAUDE_CORE.md` (screens index) — and consider a new canonical `CLAUDE_PICKING.md` + router row, since picking now spans desktop + mobile + a dedicated API surface.

---

## 1. What shipped

A **mobile supervisor picking board** at `/picking`, rendered via a responsive switch on the same route:

- Desktop board: `hidden md:block` (unchanged — `picking-queue.tsx`)
- Mobile board: `block md:hidden` (new — `picking-board-mobile.tsx`)

One route, two faces. The desktop board was not touched at any point in this session.

### Commits (all direct to main, all pushed)

| Commit | What |
|---|---|
| `d2c7e87` | Board shell + flat list + filters (render-only) |
| `2693a3b6` | Assign wiring — bar, picker sheet, live POST |
| `c42308ac` | Undo on assigned bills |
| `530b74a4` | Detail screen + new `/api/picking/order/[orderId]` route |
| `6aec60f6` | Restructure into Assign / Check tabs |
| `a3b0dab2` | Check picker-sheet cutoff fix + type pills on Check |

*(Two intermediate commits — detail redesign, and title/assigner-name — were pushed but their hashes weren't captured in-session. Recover from `git log` if needed.)*

### Files created/changed

- `components/picking/picking-board-mobile.tsx` — **new**, the whole mobile board
- `app/picking/page.tsx` — responsive switch only
- `app/api/picking/order/[orderId]/route.ts` — **new**, on-demand line items for the detail screen
- `lib/picking/queue.ts` + `lib/picking/types.ts` — **additive only**: exposed the assigner's name. Confirmed desktop unaffected.

**Not touched:** `lib/picking/sort.ts` (the flat sort spine), the existing picking API routes, `picking-queue.tsx`.

---

## 2. The screen

### Two tabs = two jobs

The supervisor has **two jobs, not one**, in two places at two moments:

| | **Assign** | **Check** |
|---|---|---|
| Where | at the queue | at the dispatch point |
| Looking at | a list of bills | a physical pile of goods |
| Question | "who's free?" | "is this right?" |
| Action | hand out | verify + release |

Tabs mean **jobs, not stages**. "Picking" was explicitly rejected as a third tab — waiting isn't a job you do, and today nothing can move a bill out of it. The stage lives on the card, not in the navigation.

### Assign tab

```
Picking                                    🔍     ← title row
Assign 58    Check 17                            ← underline tabs
[All][Local][UPC]              All routes ▾      ← filters
All routes · 58 waiting · 10,146.4 L ready       ← lane strip
… flat card list …
```

- Flat list in **server sort order** (`data.rows` as given). No client re-sort, no grouping. Window leads the spine, so rows naturally cluster by window — the `·10:30` tag on each card explains it.
- Route dropdown is client-derived from the loaded rows; type pills filter client-side; both stack with search.
- Select (checkbox) → floating bar (`{N} bills · {L} L selected`) → picker sheet → `POST /api/picking/assign`.

### Check tab

```
[All][Local][UPC]              All pickers ▾
All pickers · 17 assigned · 17 over 30m
… assigned cards …
```

- Every assigned bill, flat. Not narrowed by the Assign tab's filters (mirrors desktop, where assigned rows ignore the route filter).
- Filters by **picker**, not route — at the dispatch point you think in people ("what does Ramesh still have?"), not lanes. Type pills kept because Upcountry goes on a different truck.
- Card footer: picker avatar + name, `by {assigner} · {time}`, and a proper **Undo** button.
- **Elapsed pill** top-right: grey <30m, amber 30m+, red 60m+. Ticks every 30s off a local clock — no refetch.

### The card (both tabs share the DNA)

```
☐   9108267692  ·10:30                    ★ ⚡
    Maruti Paints
    Parle Point · 1 Carton, 3 Tin
```

- OBD (mono, muted) + window tag · ★ `isKeyCustomer` · ⚡ `priorityLevel === 1` (strict `===`)
- Dealer name = hero
- Area · `articleTag` **verbatim** — no parsing
- Checkbox = select · card body = open detail

### Detail screen

Header: dealer, `{obdNumber} · {area} · {windowTime}` (no "OBD" label). Stat strip: **article tag as hero + LT supporting**. No KG — that's a loading number, not a picking number.

Line card, three fixed columns:

```
[1LT]  IN10300572                          6
       DN Sadolin NC Sanding Sealer 1L
```

- **Pack tile** (fixed ~56px, left): pack code only, no container word. Fixed width means packs **align down the left edge** — the column-scan is the point.
- **SKU** = hero (mono, loudest). **Qty** = plain large number, no `×`. **Name** = supporting.
- Search + pack chips (chips only render when the bill has 2+ distinct packs).
- Far right reserved for the picker's future tick-off checkbox.

---

## 3. Design principles locked this session

- **The picker, not the supervisor, lives on the detail screen.** Pickers match a *number on screen* to a *number on the box*. SKU is the matching key; the product name is confirmation after. Live proof: `DN SADOLIN NC SANDING SEALER 500ML` (IN10300573) vs `...SEALER 1L` (IN10300572) — near-identical names, SKUs differing in the last digit. **Pack** is what separates them. Hence the fixed pack column.
- **A count must never be a shape.** The first tab attempt was a pill-inside-a-pill; the white lozenge visibly resized as counts changed (72 → 8 → 140), wobbling the header. Underline tabs + plain-text counts + `tabular-nums` → only the digits change.
- **Filter, don't restructure.** Applied twice: no window dividers on the board, no pack grouping in detail. Flat list + filters beats sections.
- **Right-sized control per axis.** Few values → pills (delivery type). Many values → dropdown + sheet (route, picker).
- **Reuse the engine, rebuild the window.** Same queue API, same sort spine, same assign/unassign. Only presentation is new.
- **Design so the next thing bolts on.** Check's flat list becomes "Needs check / Still picking" sections when pickers can tap Done — no rebuild.

---

## 4. Data findings (from discovery)

- **`articleTag`** is a pre-composed string on `orders.querySnapshot` — e.g. `"2 Drum, 4 Carton, 2 Tin"`. Rendered verbatim; no drum/carton math client-side. Note there's a **third unit — Tin** — beyond drum/carton.
- **Flags:** `priorityLevel === 1` = P1 (strict equality, not `<= 1`). `isKeyCustomer` = plain boolean.
- **Dispatch windows** are server-computed from `dispatch_slot_master` (`isActive`, ordered by `sortOrder`). Window counts are **waiting-only by design** — a window and an "assigned" tab aren't the same kind of thing.
- **Delivery type** supports four values in `DELIVERY_TYPE_ORDER` (Local, Upcountry, Cross, IGT). Only Local/Upcountry in use today.
- **Route list** is client-derived from the loaded rows (distinct non-null `route`, unassigned only).
- **`/api/warehouse/pickers`** is richer than expected: returns `status: "picking"|"available"`, `assignedCount`, `pickedCount`, `pendingCount`, `totalKg`. The sheet's "Free" / "{n} jobs" pill uses these real fields.
- **Assign endpoint** validates per-order sequentially (no `$transaction`), records failures in a `failed` array without aborting the batch, and writes `order_status_logs`. Both the assignment notes and the log note contain `"(test)"` — it's explicitly test-mode.
- **No FK from `orders` to line items.** `import_raw_line_items` holds a plain `obdNumber` string. The new detail route matches on that string, reads the **entire active line set** (not just the enriched subset `/api/support/orders/[id]` uses), and left-joins `import_enriched_line_items` → `sku_master`, **falling back to the raw SAP description/code when a line was never enriched** — so nothing silently disappears. Line items are fetched **on demand**, not folded into the queue payload.

---

## 5. Bugs found and fixed

- **Float leak:** lane strip rendered `12131.199999999999 L`. Fixed at the display layer with one shared formatter, applied to every litre display on the screen (lane strip, assign bar, detail LT). Rounds to 1 decimal + thousands separators.
- **Header not pinned:** cards scrolled under the iOS status bar, colliding with the clock. Fixed using the `/po` sticky-header + safe-area pattern.
- **Shared bottom sheet cut off by the mobile shell** — *root cause worth remembering:* `FilterBottomSheet` anchored at `bottom: 0` with only `max(safe-area, 20px)` padding and **never reserved the mobile shell's 76px footprint**, unlike every other bottom-pinned element on the board (the assign bar adds 76px; the scroll region has `pb-[76px]`). The bug had existed since the sheet's first version but went unnoticed because route lists are long enough that only the last row or two fell into the dead zone — a short picker list (1–3 people) swallowed nearly the whole sheet. Z-index also sat at the same tier as `MobileShell`'s nav (both z-40); raised to 65/75. Fixed once in the shared component; added `max-h-[70vh] overflow-y-auto` as a guard.
- **Title regression:** the screen title was dropped when underline tabs went in, leaving a teal void. Restored.

### Process lesson

**Commit ≠ deploy.** Stage 4 was committed but never pushed — the phone served the old build and the "responsive switch is broken" diagnosis was actually "the code isn't live." Every build prompt from Stage 5 onward carries **`git push origin main` in the exit criteria**. A second time, an unrelated commit (`70b90bd6`, a search fix) was found sitting un-pushed on the depot PC and rode along with ours — un-pushed work accumulating locally is a recurring pattern worth watching.

---

## 6. Parked — pick these up next

### Must do before the floor gets this
- **`floor_supervisor` cannot open `/picking`.** Only `admin`/`operations` can today. Needs **both**: the SQL below in Supabase **and** the mirroring seed row (seed is source of truth — a live-only grant dies on the next reseed).

```sql
INSERT INTO role_permissions
  ("roleSlug", "pageKey", "canView", "canEdit", "canImport", "canExport", "canDelete", "updatedAt")
VALUES
  ('floor_supervisor', 'picking', true, false, false, false, false, now())
ON CONFLICT ("roleSlug", "pageKey")
DO UPDATE SET
  "canView"   = EXCLUDED."canView",
  "updatedAt" = now();

SELECT "roleSlug", "pageKey", "canView", "canEdit", "canImport", "canExport", "canDelete", "updatedAt"
FROM role_permissions
WHERE "roleSlug" = 'floor_supervisor'
ORDER BY "pageKey";
```

Seed row for `prisma/seed.ts`:
```ts
// floor_supervisor — /picking board. app/api/picking/assign + unassign both
// check canView on this pageKey (not canEdit) — granting only canView
// matches what the code actually reads; canEdit would be unused here.
{ roleSlug: "floor_supervisor", pageKey: "picking", canView: true, canEdit: false,
  canImport: false, canExport: false, canDelete: false },
```

### Known quirks / tech debt
- **`canView` gates writes.** `/api/picking/assign` and `/unassign` both check `checkAnyPermission(roles, "picking", "canView")` — the *same flag* as page view. There is no read-only picking access. Pre-existing; a real write should probably check `canEdit`. (Note: `checkAnyPermission` lives in `lib/permissions.ts`, **not** `lib/rbac.ts` — docs may imply otherwise.)
- **Doc drift:** `CLAUDE_CORE.md` §5 says `floor_supervisor` → `/warehouse`, but `lib/rbac.ts`'s `ROLE_REDIRECTS` sends them to `/warehouse/supervisor`.
- **Cross / IGT** delivery types have no pill — reachable only via "All".
- **`role_permissions`** has a real `@@unique([roleSlug, pageKey])` — `ON CONFLICT` is valid there.

### Open questions never answered
- **SKU `5961032`** (`DN WS Metallic Gold 0.5L`) renders with a **null pack** while IN-prefixed SKUs resolve fine. Is it absent from `sku_master`, present without a pack code, or is the join missing it? **Stray SKU, or a whole class of old numeric SAP codes that will show blank packs on the floor?** A blank pack is exactly the thing that prevents a mis-pick, so this matters.
- **`articleTag` is null on some bills** — e.g. "S. Mohanlal & Sons · Bhagal" shows area and nothing after. Handful of strays, or a pattern (an order type / import path that never gets one)? A bill with no article tag tells the supervisor nothing about its size. *(Asked for; the finding never came back.)*
- **Real pick durations.** The 30m amber / 60m red thresholds are a guess. What's a normal pick at this depot?

### Decided against (revisit only if real usage proves otherwise)
- **Pinning the filter row + lane strip.** Mechanically easy (a third `flex-shrink-0` sibling), but costs ~90–100px on top of the header's ~110–120px → **~200–215px permanently claimed on every screen**, roughly a full card of list density, in all scroll states. Same call as the no-jump guard: ship lean, watch the floor, add back if it actually bites.

---

## 7. Next session — the workflow forward

Everything downstream of assign is **unbuilt**. The deliberate stop point: a bill goes Assign → Check, and Check currently only shows it and offers Undo.

The designed-but-unbuilt flow (mockups exist, approved):

1. **Picker app** — picker opens their jobs, taps **Done** → goods land at the dispatch point.
2. **Check splits into two sections** — `Needs check` (green edge, picker done) on top, `Still picking` (greyed, clock running) below. Same tab, same card, no rebuild.
3. **The manual check** — supervisor opens the bill, ticks each line against the physical goods, progress bar fills, **Mark checked** stays disabled until every line is ticked. (Line-by-line, not one bill-level tick — the labour aren't educated and the risk is mis-picks; a single tap rubber-stamps, per-line forces eyes on each SKU.)
4. **Cleared** — bill leaves Check for dispatch.

**Blocking discovery before any of that** (a look, not a build):
- **What stage does "checked" land in?** Is there already a stage after `pick_assigned` that dispatch consumes, or does one need adding? If new → schema step (SQL Editor → hand-edit `schema.prisma` → `npx prisma generate` → mirror into seed). Don't bend an existing stage to mean something it doesn't.
- **What consumes picking output today** — does anything downstream (dispatch / trips / challan) wait on a particular stage?
- **`pick_assignments.status`** — free string or constrained? Could it carry `assigned` → `picked` → `checked` with no schema change?
- **Line ticks: ephemeral or persisted?** Recommendation: **ephemeral**. The tick is a forcing function so the supervisor's eyes land on every line — not an audit trail. Persisting needs a table for no clear gain. Confirm before building.

### Mockups (repo)
- `docs/mockups/picking/supervisor-assign-board.html` — the approved board
- Detail redesign, assigned card, tab options, and the 6-screen supervisor flow storyboard were produced in-session and should be saved into `docs/mockups/picking/` if not already.
