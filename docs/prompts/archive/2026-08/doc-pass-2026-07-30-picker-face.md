# Doc pass — picker "My Picks" face rebuild
# 2026-07-30 · record of a five-batch canon pass · Lives in: orbit-oms/docs/prompts/drafts/

Record of the documentation pass that followed the picker-face rebuild. The pass edited five files
(`CLAUDE.md`, `CLAUDE_CORE.md`, `CLAUDE_PICKING.md`, `CLAUDE_UI.md`, `ROADMAP.md`) in batches, one
owner per file per batch, with a read-only verify sweep before the commit.

This file is the evidence trail, not canon. Where it disagrees with a canonical file, the canonical
file wins.

---

## 1. The commit range

**`a2fb6889` → `28986d0a`**, 2026-07-29 to 2026-07-30. The range holds **13** commits, of which
**12 are the picking work**:

| # | Commit | Subject |
|---|---|---|
| 1 | `a2fb6889` | `refactor(picking): extract ModuleMobileHeader from supervisor mobile` |
| 2 | `ee023b4a` | `feat(picking): picker mobile adopts shared shell + 2-tab nav` |
| 3 | `1eea6366` | `feat(picking): picker card gains age, star, families, volume` |
| 4 | `c1d6a481` | `fix(picking): picker CTA clearance now bar is hidden on detail` |
| 5 | `913b6a64` | `fix(picking): picker card matches supervisor card language` |
| 6 | `4f9d1324` | `feat(picking): picker back press closes the bill` |
| 7 | `9941bedb` | `fix(picking): defer picker refresh past the history pop` |
| 8 | `26264941` | `refactor(picking): extract picker pending/done split to lib` |
| 9 | `570b7078` | `fix(picking): picker face fetches its list instead of refreshing` |
| 10 | `dc32a476` | `feat(picking): swipe between bills on the picker face` |
| 11 | `129d87dc` | `feat(picking): private line ticks on the picker face` |
| 12 | `28986d0a` | `fix(picking): restore pack filter on the picker detail` |

⚠ **`f117bdde` sits inside this range and is NOT picking work** — it added two Claude Code skill
files and a `.gitignore` change. Any future "twelve commits" count that greps the range by date will
find thirteen; this is why.

---

## 2. Verified shipped

Each claim checked against `git log --stat`, then against the file on disk. A claim was not treated
as fact until the commit existed.

| Claim | Verdict | Commit(s) |
|---|---|---|
| `ModuleMobileHeader` extracted to `components/shared/` | ✅ | `a2fb6889` |
| Picker face on the shared shell, 2 tabs, badge on Pending, `hideBar` | ✅ | `ee023b4a` |
| `card-atoms.tsx` — six exports, shared by both boards | ✅ *with a nuance, below* | `1eea6366` + `913b6a64` |
| Picker card aligned to the supervisor's card language | ✅ | `913b6a64` |
| Back press closes the bill; ONE close path via `history.back()` | ✅ | `4f9d1324` |
| `lib/picking/picker-split.ts` — pending/done + today-IST, shared server+client | ✅ | `26264941` |
| Picker face fetches its list; `/api/picking/queue` gained `pickerId` | ✅ | `570b7078` |
| `use-bill-pager.ts` shared pager; supervisor adopted; `NO_BILL_SWIPE_ATTR` | ✅ | `dc32a476` + `28986d0a` |
| Device-local line ticks, 7-day / 50-bill prune | ✅ | `129d87dc` |

**The card-atoms nuance, recorded because it would send the next reader hunting:** all six exports
exist (`AgeBadge`, `FamilyChip`, `UnlistedChip`, `CARD_SHADOW_V2`, `RouteDot`, `CardShelf`), but both
boards import exactly **four** — `AgeBadge`, `CardShelf`, `CARD_SHADOW_V2`, `RouteDot`. `FamilyChip`
and `UnlistedChip` are **shelf internals**: `CardShelf` is their only consumer. Written into
`CLAUDE_PICKING.md §8`.

---

## 3. Stale claims found, and what each became

Every hit below was false on 2026-07-30 before this pass. Nothing here is outstanding.

### docs/CLAUDE_PICKING.md → v1.11

| § | The stale claim | Became |
|---|---|---|
| 1 | picker face listed without its tab shape | "Pending / Done — two **bottom** tabs", mirroring the supervisor's line |
| 5.1 | "The picker face gets the DEFAULT bar … keeps the standard Home/Menu/You bar untouched" | `PickingMobileShell` documented as a two-way branch; `PickerPickingShell` owns its tabs, rows, refetch, `detailOpen` → `usePickerBoard()` |
| 5.3 | swipe machinery implied to live in `picking-board-mobile.tsx` | `use-bill-pager.ts` named as owner for BOTH faces; supervisor adopted by import swap; `NO_BILL_SWIPE_ATTR` documented; "move it to `components/shared/` → re-home the docs in UI" trigger recorded |
| 5.4 | "still a **TOP** strip", "keeps the default Home/Menu/You bar", "local `TopBarTab` copy", "three-line card", "`pending`/`done` computed server-side in `page.tsx`" | **Every clause false.** Section rewritten end to end, plus new §5.4.1 for the ticks |
| 6 | "Ephemeral ticks, not persisted" — true, but written when only one surface had ticks | Scoped explicitly to the SUPERVISOR, with a ⚠ pointing at §5.4.1 and "do not unify the two" |
| 8 | six rows wrong (`page.tsx`, shell, supervisor board, picker board, queue route, `queue.ts`) | Corrected; four rows added (`card-atoms`, `use-bill-pager`, `module-mobile-header`, `picker-split`) |
| 10 | refresh cell said `router.refresh()`; "the picker's refresh is the expensive one" bullet | Cell → `refetchQueue()`. Bullet retitled *"the CONCLUSION outlived its reason"* — mechanism marked dead, narrowing kept on the two reasons that were always stronger |
| 4 | `GET /api/picking/queue` described as `getPickingQueue(dateParam)` only | Full contract: `scope` / `date` / `pickerId`, all validated not coerced, plus the `openPending`+`date` rejection |

### docs/CLAUDE_UI.md → v5.16

| § | The stale claim | Became |
|---|---|---|
| 59.4 | "Picking's third tab reads Done but its key stays `checked`" | **Not merely stale — inverted.** See §6 below |
| 59.5 | "(Picking: Assign · Check · Done)" | "Picking's supervisor board: Assign · Picking · Done", tagged with the same 2026-07-20 rename and the same ten-day miss |
| 59.6 | "[DEFERRED] … not yet extracted to a shared component … extracting it is the remaining work" | Struck through → §59.7. The surviving half — other pages keep their own headers, which is why `/trips` was never disturbed — kept verbatim |
| 62.1 | age badge pointed at `picking-board-mobile.tsx:588-628` | → `AgeBadge` in `card-atoms.tsx`, **line numbers dropped**, with a note saying why so nobody restores them |
| 62.2 | locked zone pointed at `picking-board-mobile.tsx:1947-1960`, `:634` | → the `assignLocked` variant + `UpcomingDayBadge`, still in `picking-board-mobile.tsx`, plus **why** those did NOT move to `card-atoms.tsx` (supervisor-only — the picker never sees a locked bill) |
| — | new | **§59.7 `ModuleMobileHeader`** — props contract, the handlers-stay-with-the-caller rule, consumers, the inert `searchActive`, adopters |

### CLAUDE.md → v1.9

| The stale claim | Became |
|---|---|
| §3 `/picking` row: "desktop + mobile supervisor board … **DESKTOP superseded by `/floor` — both still live**" | Desktop retirement named with its archive folder; `/picking` stays live at every width; the two mobile faces are the only live ones |
| Retired table listed **five** screens, omitting the picking desktop board retired the same week | Sixth row added, marked **⚠ NOT a screen — a BOARD**, with the intro paragraph amended: its route still resolves and still has a domain file, unlike the other five |

### docs/ROADMAP.md

| The stale claim | Became |
|---|---|
| UI (P2): "Extract the Direction-A header … **it is not yet extracted** … extract when a second module adopts Direction A, not before" — an OPEN checkbox | ✅ SHIPPED `a2fb6889`, condition met the same day by `ee023b4a`, pointing at `CLAUDE_UI.md §59.7`. Closed, not deleted |

---

## 4. The two landmines, as they now read in CORE §3

Both were placed in **§3 (Engineering rules — non-negotiable)**, not §13. §13 is "exists in code but
broken"; these are "never do this". Both are written as general engineering rules that cite a picking
example, because **the next screen to hit either one will not be a picking screen.**

### 4.1 The `router.refresh()` rule

> - **A `router.refresh()` is DISCARDED by a history pop — never pair the two.** Next's router action
>   queue gives navigations priority: an `ACTION_NAVIGATE`/`ACTION_RESTORE` — which is what a
>   `history.back()` becomes — marks any *pending* action `discarded = true`, so its result is never
>   applied (`node_modules/next/dist/shared/lib/router/action-queue.js`). Only a discarded **server
>   action** gets the `needsRefresh` rescue; a plain `router.refresh()` gets nothing. **Symptom:** any
>   screen that closes an overlay via `history.back()` AND refreshes through the router silently
>   loses that refresh, and shows stale data until some unrelated later refresh happens to win.
>   **THE FIX IS NOT TIMING.** Two attempts to order the calls shipped — awaiting the pop, then a
>   deferred flag plus an edge effect — and **both looked green in `tsc` and in the build while the
>   bug stayed live on production**; the ordering belongs to React's and Next's schedulers, not to
>   us, so no amount of re-sequencing at the call site can win it. **The fix is a client `fetch` +
>   `setState`:** it never enters that queue and cannot be discarded — which is why a sibling screen
>   doing the identical pop after its own write never had the bug at all. First hit: the picker "My
>   Picks" face (`4f9d1324` introduced the pop, `9941bedb` failed to fix it, `570b7078` fixed it) —
>   behaviour in `CLAUDE_PICKING.md §5.4`, not restated here. **No type-check, lint or build catches
>   this. Only a device does.**

### 4.2 The `Date.parse` rule

> - **`Date.parse()` on an offset-less ISO date-time is read in the HOST's timezone — normalise
>   before parsing.** Per the ES spec, `"2026-07-30T18:45:00"` (no `Z`, no `±HH:MM`) is **local**
>   time, while a date-ONLY string (`"2026-07-30"`) is UTC. This is harmless while a date rule runs
>   only on Vercel (UTC), and breaks the moment the same rule ALSO runs in a browser on a depot phone
>   in **Asia/Kolkata**: the two hosts disagree by **5.5 hours**, so the same row lands in a different
>   IST day depending on which one evaluated it — and **only near midnight**, so it passes every
>   daytime test and every test written on one host. Safe inputs, which is why this is rare rather
>   than constant: real `Date` objects (Prisma) and any string carrying `Z` or an offset (JSON and
>   RSC payloads always emit one). An offset-less string must be normalised to UTC first — reference
>   implementation `pickedAtMs()` in `lib/picking/picker-split.ts`. ⚠ **The trigger is "this logic now
>   runs in two places", NOT "this logic is new"** — moving an existing, correct, server-side date
>   rule to the client is exactly when it bites, and the rule itself will not have changed a
>   character.

**Read cold in the verify sweep, both pass as app-wide rules.** The `router.refresh()` rule names no
module until its trailing provenance clause; the contrasting screen is described generically. The
`Date.parse` rule's one concrete scenario — a depot phone in Asia/Kolkata — is company-wide context
(attendance, trips and picking all run on those phones), not a picking detail.

---

## 5. Verified NEGATIVES

Worth as much as the positives: each of these is a claim that could plausibly have been stale, was
checked, and was found sound. Recorded so the next pass does not re-investigate them.

- **`CLAUDE_FLOOR.md` carries no mobile-shell claim at all.** A grep for `mobile shell` /
  `MobileShell` / `WorkflowTabBar` / `MOBILE_NAV_CLEARANCE` / `ModuleMobileHeader` /
  `role-layout-client` / `§59` across that file returns **zero hits**. Floor is desktop-first and
  never described this machinery, so it had nothing to go stale. **FLOOR was not edited in this pass.**
- **`CLAUDE_UI.md §59.6`'s "live on `/trips`, `/place-order`, `/picking`" is TRUE** — verified
  2026-07-30 by reading the three call sites. `app/trips/page.tsx` and `app/(place-order)/layout.tsx`
  both render `RoleLayoutClient` and pass **no** `workflowTabs`, so both take the default
  Home/Menu/You bar (branch 3); `/picking` supplies its own tabs (branch 2). The claim now carries
  that date, plus the distinction it was silently relying on: **inheriting the shell and replacing
  the bar are different things**, and the list means the former.
- **The desktop picking board really is archived** — checked three ways before editing the router:
  `archive/2026-07-picking-desktop/` exists with `components/`, `mockups/`, `README.md`;
  `components/picking/` contains five files and no `picking-queue.tsx`; the archive commits are in
  history.
- **`prisma/schema.prisma` was untouched across the whole range** —
  `git log a2fb6889~1..28986d0a -- prisma/schema.prisma` returns 0. **Schema stayed v27.12** on every
  file that stamps it; no version bump implied a migration that did not happen.
- **One owner per behaviour holds.** The six swipe constants are stated only in
  `CLAUDE_PICKING.md §5.3`; the two landmines only in `CLAUDE_CORE.md §3`. Every other mention is a
  citation that states no value.
- **Archive files under `docs/prompts/archive/2026-07/**` matched the stale-claim greps and are
  correctly frozen** — dated records of what was true when written. Not stale by design; do not
  "fix" them.

---

## 6. Premises that turned out WRONG mid-pass

Both were assumptions carried INTO a batch that verification overturned. Recorded because the pattern
matters more than the two instances: **a pointer to a stale claim can itself be stale.**

### 6.1 The bad `§9` pointer was in CORE, not FLOOR/ROADMAP

`CLAUDE_PICKING.md §9` carried a note saying *"`CLAUDE_FLOOR.md §10` and `docs/ROADMAP.md` both point
at `CLAUDE_PICKING.md §9`"* for the `pick_checked → dispatched` drain hole, and that those pointers
needed repointing at §7. The Batch A plan took that at face value and scheduled the fix.

**Neither file points at §9.** A grep across `docs/` finds no `§9` pointer in either — ROADMAP's
picking pointers all resolve to §2 / §5 / §6 / §7 / §10, and FLOOR carries none at all. The one file
that still pointed at `§9` was **`CLAUDE_CORE.md §7.4`** (one line), which the note did not mention.

Outcome: the note was rewritten to name the right file, and CORE was repointed in the same pass. The
note now records that it is closed.

### 6.2 UI §59.4's warning was not merely stale — it was INVERTED

The plan expected a routine outdated sentence. What was there:

> **⚠️ Label ≠ key.** Picking's third tab reads **"Done"** but its key stays `"checked"`. A visible
> relabel must never rename the state key…

The live union is `"assign" | "picking" | "done"` — label == key on all three. The warning did not
just describe a key that no longer existed; **it instructed readers to preserve that key, using as
its worked example a case where the project had deliberately done the opposite.** A stale warning
still reads as authoritative, which makes this failure mode worse than a stale fact.

It was **restated, not deleted** — the real two-step history (2026-07-19 relabel-only was *correct*;
2026-07-20 moved both because the keys had inverted against their labels), plus the two preconditions
that made re-keying safe: the keys are a TypeScript union so `tsc` flags every stale comparison, and
nothing persists them.

**The general lesson, now written into §59.4:** this warning sat wrong in `CLAUDE_UI.md` for ten days
while `CLAUDE_PICKING.md §5.1` had it right the whole time. The 2026-07-20 correction went into the
module file and never into the shell file. **A stale claim is rarely in only one file — when you
correct one, grep the rest for the same sentence.**

---

## 7. Open follow-ups — NONE acted on

Surfaced by the verify sweep, deliberately left for a later decision.

- **`CLAUDE_CORE.md:784` describes the mobile shell as a "Home/Menu/You bottom bar" every page
  inherits.** Still accurate — that is the default branch — but it predates the per-module bottom-bar
  slot and never mentions it. **Incomplete, not wrong.** `CLAUDE_UI.md §59.2` owns the three-way slot,
  so CORE is pointing at the same truth from a narrower angle. Fix only if a reader is ever misled.
- **`CLAUDE_FLOOR.md`'s footer carries no date where its header does** — header
  `v1.3 … updated 2026-07-28`, footer `v1.3 · Schema v27.12 · OrbitOMS`. Pre-existing form drift in a
  file this pass deliberately did not open. Every file this pass DID edit now has header and footer
  agreeing in version, date and form.
- **`CLAUDE_UI.md` carries no `Schema` stamp at either end**, while CORE, PICKING and FLOOR all do.
  Deliberately **not** added — a stamp creates an obligation to keep it current, and omitting one
  should be a decision on the record rather than a drift nobody noticed. Recorded in-file above the
  UI footer as an open item, with the concrete consequence: `CLAUDE.md`'s session procedure tells
  every reader to check a file's header against CORE's schema stamp, and for UI that check silently
  checks nothing.

---

## 8. The three deferred DESIGN items, now in PICKING §7

Product decisions, not defects. None is a bug; none should be "fixed" unilaterally.

1. **The picker's viewer name came off his header** (2026-07-29). The hand-rolled teal strip that
   carried it went with the move to `ModuleMobileHeader`, so `viewerName` left `page.tsx` too.
   Identity is still reachable — the You sheet for a real picker, the "view as" dropdown for an admin
   previewing. **Fine for one-picker-one-phone, NOT fine for a shared terminal**, where the first
   question the screen must answer is "whose board is this?". A live dependency of §6's open
   picker-login question, not an afterthought.
2. **Pack-filter chips render only when a bill has ≥ 2 distinct pack sizes.** Original rule
   (`a114cff9`), shared by both detail screens, **not a regression** — field-reported 2026-07-30 as
   "the pack filter is missing", and the investigation found the chips rendering exactly where they
   always had, plus a different real bug alongside (the pager was stealing the chip strip's
   horizontal scroll, fixed by `NO_BILL_SWIPE_ATTR`). Flipping the gate to always-show — "All" plus a
   single chip — is a one-line change to a deliberate rule, so it needs a decision, not a patch.
3. **The picker's pinned stat row now carries four things and can read as one slab** —
   `articleTag` · "N of M ticked" · volume · `‹ N of M ›` bill arrows, with the pack-chip row directly
   beneath it in the same white, same border, similar pill shapes. Each piece earned its place
   separately and nobody chose the combination. Three options recorded, cheapest first: **(1)** tint
   the chip row (`bg-gray-50`) — smallest, diverges from the supervisor; **(2)** move the bill arrows
   into the teal header's right slot, freeing the stat row's right half; **(3)** move the tick counter
   down onto the chip row, leaving the stat row as `articleTag · volume · arrows`.

---

*Doc pass 2026-07-30 · OrbitOMS · files touched: CLAUDE.md v1.9 · CLAUDE_CORE.md v89 ·
CLAUDE_PICKING.md v1.11 · CLAUDE_UI.md v5.16 · ROADMAP.md*
