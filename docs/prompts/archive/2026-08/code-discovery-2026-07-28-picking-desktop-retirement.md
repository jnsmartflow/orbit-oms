# Retiring the Picking DESKTOP board — discovery report

**Date:** 2026-07-28 · **Status:** DISCOVERY ONLY — nothing moved, edited, renamed or deleted.
No SQL run. No commit. **Read-only.**

**What is being considered:** removing the desktop half of `/picking` — the wide-screen table
(`components/picking/picking-queue.tsx`) — because Floor Control (`/floor`) was built to replace it.

**What is NOT in scope:** the two mobile boards. The supervisor board
(`components/picking/picking-board-mobile.tsx`) and the picker's "My Picks" face
(`components/picking/picker-my-picks-board.tsx`) stay. `/picking` itself stays live.

> **This is a different shape from the last five retirements.** Nothing gets archived. There is no
> route to switch off, no permission key to remove, no orphaned database rows to clear. `/picking`
> is ONE address with two faces chosen by screen width; this job removes **one branch from inside a
> live file** (`app/picking/page.tsx:186-188`). The playbook's *gates* and *sequencing* still apply.
> Its *steps* (archive the screens, remove the page key, clear the permission rows) mostly do not.

---

## 1. Verdict

**Not blocked — but not at parity either. This is an owner decision, not a technical one.**

Three separate findings, in order of weight:

**(a) Nothing breaks technically.** The desktop file is imported in exactly one place
(`app/picking/page.tsx:7`). Every shared thing it touches — the picker list route, the sort spine,
the live-sync hook, the assign/unassign endpoints — has at least one other live caller that survives
untouched. There is no "last door" problem of the kind the Support retirement hit. Full evidence: §4
and §5.

**(b) `/floor` does NOT do everything the desktop board does.** Seven real gaps, listed in §2. Four
are cosmetic-to-mild. **Three matter operationally:**

1. **The `#` number is not the same number.** Desktop numbers the whole day 1..N and that number
   never changes as work moves (`picking-queue.tsx:880-884`). Floor restarts at 1 inside every slot
   band and every route group (`floor-table.tsx:255`). If anyone on the floor says "do number 14
   next", that phrase stops meaning one thing.
2. **The slot-tab and header counts mean something different.** Desktop counts *bills that still
   need a picker* (`lib/picking/queue.ts:502-503`). Floor counts *all bills in that slot, whatever
   their state* (`floor-tabs.tsx:23`, `lib/floor/queries.ts:441-445`). Neither is wrong; they answer
   different questions, and the desktop question has no answer on Floor.
3. **`floor_supervisor` cannot open `/floor` at all.** Floor is granted to `admin` + `operations`
   only (`prisma/seed.ts:117-118`, `CLAUDE_FLOOR.md §1`). A floor supervisor at a PC would be left
   with no desk board whatsoever. This is the single biggest gap and it is a **permissions** decision,
   not a layout one.

**(c) The successor-parity gate did its job again.** It also found the reverse: Floor is *richer*
than desktop in six places (a real detail panel, reassign, per-bill Hold/Cancel, six flag filters,
multi-OBD paste search with auto-tick, a Picker column). And it retired one supposed gap: the doc
line saying "a `pick_checked` row has no home on desktop, by design" (`CLAUDE_PICKING.md:388`) has
been **stale since 2026-07-22** — desktop renders all four states inline
(`picking-queue.tsx:157-162`).

**Recommended shape:** proceed, with option (a) from §3 (render the mobile board at all widths), and
either accept the three gaps on the record or close #1 and #2 in Floor first. Do **not** proceed with
a redirect to `/floor` without first deciding the `floor_supervisor` permission question.

---

## 2. Parity table — desktop `/picking` vs `/floor`

*(Terms: "row" = one bill/OBD. "endpoint"/"route" = the server address a button talks to.
"scope" = which slice of days a board asks the database for.)*

| # | Capability | Desktop `/picking` | `/floor` | Verdict |
|---|---|---|---|---|
| 1 | **Bulk assign to a picker** | `picking-queue.tsx:979-1015` → `POST /api/picking/assign` (`:983`); picker list from `/api/warehouse/pickers` (`:686`) | `assign-bar.tsx:137-144` → `floor-page.tsx:240-249` → the **same** endpoint (`:246`); picker list carries on-hand load (`assign-bar.tsx:133`) | ✅ **covered, and richer** — Floor also *reassigns* (unassigns first, `floor-page.tsx:242-245`), which desktop cannot do |
| 2 | **Undo / unassign** | one-hover inline "Undo" on any assigned row (`picking-queue.tsx:602-612` → `:802-828` → `POST /api/picking/unassign` `:807`) | no row-level Undo. Lives in the detail panel's ⋯ menu (`floor-page.tsx:404-407`); the ⋯ opens the panel (`floor-table.tsx:225-232`) | ⚠️ **covered, two clicks deeper.** The desktop Undo is explicitly a *stopgap until the row-click detail panel lands* (`picking-queue.tsx:1357`, `CLAUDE_UI.md §61`) — Floor **is** that panel. Arguably resolved, not lost |
| 3 | **Release (early-unlock a future-dated bill)** | **desktop does not have it.** The Upcoming section is read-only — a lock glyph, no unlock button (`picking-queue.tsx:401-404`) | Floor's "Release" is a *different* action (moving a rail bill onto the floor, `floor-page.tsx:187-194`) | ✅ **nothing to lose.** Early-unlock is **mobile-only** (`picking-board-mobile.tsx:1630` → `POST /api/picking/release`) and stays |
| 4 | **Approve (supervisor check)** | **desktop does not have it** | **Floor does not have it either** — a whole-folder search of `components/floor`, `lib/floor`, `app/api/floor` finds no approve action (only an unrelated word at `lib/floor/suggest.ts:51`) | ✅ **not a loss from this change** — but state plainly: after this, there is still **no way to approve a picked bill from a PC**, on any screen. Approve is mobile-only (`picking-board-mobile.tsx:1667`). That is true today and stays true |
| 5 | **Per-window (slot) header badges** | counts = *still needs a picker today* (`picking-queue.tsx:830-843`, formula `lib/picking/queue.ts:502-510`) | counts = *every due bill in that slot, any state* (`floor-tabs.tsx:23-28`) | 🔴 **GAP — different meaning.** "How many still need a picker in the 12:30 slot" has no answer on Floor |
| 6 | **"OBDs" / All segment count** | `data.totalCount`, again *still-waiting only* (`picking-queue.tsx:837`, `:1021`; `queue.ts:519`) | `total` = all due rows (`lib/floor/queries.ts:445`); tab pill uses it (`floor-page.tsx:288`, `:530`) | 🔴 **GAP — same cause as #5** |
| 7 | **Header stats line** | "OBDs: N" in the universal header (`picking-queue.tsx:1021`) | none — the stats line was **deliberately removed** from Floor's design (`CLAUDE_FLOOR.md §8`) | ⚠️ **GAP, knowingly by Floor's design** |
| 8 | **Filter panel** | 3 groups: **Route** (runtime-derived, `:915-921`) · **Status** (4 fixed, `:193-198`) · **Delivery type** (runtime-derived, `:922-928`) + applied-filter pills (`:1070-1089`) | Status (4) + **6 flags** — key dealer, urgent, tint, site, carried-over, ship-to-changed (`lib/floor/filter.ts:20-33`). Route is served by the By-route grouping, delivery type by the scope chips — the file says so at `lib/floor/filter.ts:2-4` | ⚠️ **mixed.** Floor adds 6 filters desktop lacks. **One real gap:** Floor's scope chips are hardcoded `All / Local / Upcountry / IGT` (`floor-page.tsx:35`) — **no Cross**, while desktop's list is data-derived and would show Cross if any bill had it |
| 9 | **Search** | dealer OR OBD, live as you type (`picking-queue.tsx:907`) | ship-to name, route OR OBD; runs on Enter; plus pasted OBD lists and auto-ticking of matches (`lib/floor/search.ts:48-58`, `floor-page.tsx:313-329`) | ✅ **covered, and richer.** Behaviour differs (Enter vs live) — worth a heads-up to whoever uses it daily. Neither searches by picker name |
| 10 | **List ⇄ By Route toggle** | always available, including on the All tab (`picking-queue.tsx:1032-1053`) | Flat / By-route only when a **single** slot tab is open (`floor-page.tsx:618`); the All tab forces slot bands (`floor-board.tsx:166-191`) | 🔴 **GAP — no whole-day By-route view** |
| 11 | **Locked "Upcoming" section** | collapsed section, lock glyph, "for {Wed 30 Jul} · {16:00}" chip, excluded from `#`/Select-All/filters (`picking-queue.tsx:358-446`, `:850-875`) | collapsed strip → the same table in `upcoming` mode, "for {Wed 30 Jul}" chip (`upcoming-strip.tsx:12-30`, `floor-table.tsx:179-184`) | ✅ **covered.** Tiny loss: Floor's chip omits the **time** |
| 12 | **Date stepper** | full calendar popover, any date forward or back (`picking-queue.tsx:1061-1063`, `:664-666`), re-anchors the whole rolling scope (`:672`) | History mode only: **backwards one day at a time, never past yesterday** (`floor-board.tsx:105`, `floor-page.tsx:418-426`), read-only, and it asks a **different question** — "what was promised for day D" (`lib/floor/queries.ts:349-357`) vs desktop's rolling anchor | 🔴 **GAP — no arbitrary-date look-back with the same meaning, and no look-ahead at all** |
| 13 | **Stable global `#`** | 1..N over the whole day; identical in every slot tab and inside every route group; never renumbers as status changes (`picking-queue.tsx:880-884`, `:216-218`) | `i + 1` **within each rendered table** — restarts at 1 in every slot band and every route group (`floor-table.tsx:255`) | 🔴 **GAP — the most operationally visible one.** The number a supervisor calls out stops being unique |
| 14 | **Selection + Select-All** | Set of ids; "Select All / Deselect All" over everything currently visible and waiting (`picking-queue.tsx:957-968`, `:1090-1097`); stale ticks pruned on refresh (`:784-800`) | Set of ids (`floor-page.tsx:127`); header checkbox **per table only** (`floor-table.tsx:150-158`); cleared on any tab/scope/date change (`:176-178`); reconciled with a toast when a ticked bill changes elsewhere (`:457-484`) | ⚠️ **mixed.** Floor can tick *With-picker* rows too (`floor-table.tsx:173`), desktop only Waiting (`:549`). **Gap:** no one-click "select everything waiting today" |
| 15 | **Inline Undo stopgap** | see #2 | — | ✅ **resolved by design** — Floor shipped the panel this was waiting for |
| 16 | **A `pick_checked` row's home on desktop** | **the doc claim is STALE.** `CLAUDE_PICKING.md:388` says "a `pick_checked` row has no home on desktop, by design". Since the 2026-07-22 redesign desktop renders all four states inline with a green **Ready** pill (`picking-queue.tsx:157-162`, `CLAUDE_UI.md §61` "All four states render inline") | Floor renders it as a green **Done** pill (`components/floor/status-pill.tsx:31`) and keeps it visible all day via the checked-today arm (`CLAUDE_FLOOR.md §3`) | ✅ **no gap — and a doc line to correct** (§7) |
| 17 | **"Unmatched" tab** (bills whose customer never matched) | its own header segment when any exist (`picking-queue.tsx:838-841`, test at `:32-34`) | none. An unmatched bill shows the words "(Unmatched)" as its dealer name (`lib/floor/queries.ts:394`) but cannot be filtered to | 🔴 **GAP.** After Support's retirement, only Tint Manager can resolve an unmatched customer (ROADMAP, "Missing-customer resolver has no Floor entry point") — this removes the last desktop *list* of them |
| 18 | **Product families / Picker column** | desktop shows neither (columns: ☐ · # · OBD · Dealer · Route · LT · Flags · Status, `picking-queue.tsx:47`) | Floor adds a **Picker** column and an **Article** column (`floor-table.tsx:161-167`); skips families deliberately (`queries.ts:410-412`) | ✅ **Floor is richer** |
| 19 | **Who can even open it** | `floor_supervisor`, `picker`, `operations`, `admin` (`app/picking/page.tsx:63-66`) | `admin` + `operations` only (`prisma/seed.ts:117-118`; gate at `app/(floor)/floor/layout.tsx:32-35`) | 🔴 **THE BIG ONE — see §3 and §6** |

### Summary of the seven gaps
🔴 #5/#6 (counts mean something else) · #10 (no whole-day By-route) · #12 (date stepper) ·
#13 (global `#`) · #17 (Unmatched list) · #19 (audience).
⚠️ #7 (stats line) · #8 (no Cross scope chip) · #14 (no board-wide Select-All) · #2 (Undo depth).

---

## 3. What a desktop visitor sees afterwards — the three options, costed

**The mechanism today, so the trade-offs are readable.** `app/picking/page.tsx` renders **both**
faces at once and lets CSS pick which is visible: `hidden md:block` wraps the desktop table
(`:186-188`) and `block md:hidden` wraps the mobile one (`:189-202`). Because both are *mounted*,
**narrowing a desktop browser window swaps faces instantly, with no page reload.** That is exactly
how Smart Flow tests the mobile boards, and it is the constraint every option below is judged against.

> ⚠️ **A side-effect worth knowing.** Because both branches mount, a desktop `/picking` session today
> runs **two** queue fetches and **two** 15-second live-sync polls: the shell fetches `openPending`
> (`picking-mobile-shell.tsx:148`, marker at `:198`) *and* the desktop table fetches `rolling`
> (`picking-queue.tsx:672`, marker at `:770`). Removing the desktop branch halves that.

### Option (a) — render the mobile board at every width **[recommended]**

*What it is:* delete the `hidden md:block` wrapper and the `PickingQueue` import; drop `md:hidden`
from the remaining wrapper. `/picking` then shows the card board on a phone and on a PC alike.

| | |
|---|---|
| **Cost** | Smallest. Two edits in `app/picking/page.tsx` (`:7`, `:186-188`) plus one file deleted or archived. |
| **Picker landing** | Unchanged. He lands on `/picking` (`lib/rbac.ts:39`) and gets his "My Picks" board — which he already gets today at any width, because the picker branch is inside the mobile wrapper (`:190-198`). **On a wide screen today he sees the full supervisor desktop table instead** (the desktop wrapper is rendered for *every* role, `:186`). Option (a) actually **fixes** that oddity. |
| **floor_supervisor landing** | Unchanged. He lands on `/picking` (`lib/rbac.ts:38`) and gets the supervisor card board. He keeps a working screen. |
| **Narrow-window test** | ✅ **Safe — and simpler.** There is nothing left to swap; the same board renders at all widths. |
| **Honest unknown** | **Unproven:** how the mobile card board looks at 1920px. `CLAUDE_UI.md §60` designs for 390px and guarantees down to 320px; it says nothing about an upper bound. The cards will stretch. Smart Flow should eyeball this on a real PC before committing. A `max-width` wrapper would be a small, separate polish step. |

### Option (b) — redirect a wide screen to `/floor`

| | |
|---|---|
| **Cost** | Highest, and it is not a layout change. |
| **Picker landing** | 🔴 **Broken.** `picker` has no `floor` permission (`prisma/seed.ts` grants floor to `admin` + `operations` only, `:117-118`). The gate at `app/(floor)/floor/layout.tsx:32-35` calls `checkAnyPermission(roles, "floor", "canView")` (`lib/permissions.ts:220-234`) and, on false, sends him to `/unauthorized`. **A picker logging in on a PC would land on a permission denial.** |
| **floor_supervisor landing** | 🔴 **Broken, same reason.** No `floor` row exists for him either. |
| **To make it work** | Grant `floor` to both roles — a live SQL insert **plus** a `prisma/seed.ts` edit. But `floor` is `canView`+`canEdit` over Hold, Cancel, Release and slot changes: this hands the whole gatekeeper desk to the floor team. That is a business decision about authority, not a fix for a blank page. |
| **Narrow-window test** | 🔴 **Broken.** The redirect fires on load at desktop width, so you can never reach `/picking` from a wide window and then narrow it. |

### Option (c) — a short "open this on your phone" screen

| | |
|---|---|
| **Cost** | Middle. One small new component; no permission changes. |
| **Picker / floor_supervisor landing** | Both still land on `/picking` and are **not** denied — but a supervisor at the depot PC gets an instruction screen instead of a board. He loses desk access entirely. |
| **Narrow-window test** | ⚠️ **Depends entirely on how it is built.** As a CSS swap (`hidden md:block` on the interstitial), narrowing still works. As a server-side or `useEffect` redirect, it does not. If this option is chosen, **it must be the CSS form.** |

### Recommendation
**(a).** It is the cheapest, it keeps both landing pages working, it is the only option that makes the
narrow-window test *easier* rather than riskier, and it removes a real oddity (a picker seeing the
supervisor desktop table on a PC). It leaves the §2 gaps open — those are a separate, deliberate
conversation about whether to build #5/#6 and #13 into Floor.

---

## 4. DESKTOP-ONLY vs SHARED

### 4a. DESKTOP-ONLY — becomes dead when the branch goes

| What | Where | Proof it is desktop-only |
|---|---|---|
| The desktop board itself (1,217 lines) | `components/picking/picking-queue.tsx` | one importer, `app/picking/page.tsx:7` |
| The responsive wrapper | `app/picking/page.tsx:186-188` | — |
| The **`rolling`** scope arm | `lib/picking/queue.ts:192-217` | sole caller `picking-queue.tsx:672`. Its validation branches live at `app/api/picking/queue/route.ts:40`, `app/api/picking/marker/route.ts:68`, and the hook's type `lib/hooks/use-picking-marker.ts:9` |
| `windows[]` · `totalCount` · `unmatchedCount` · `assignedCount` on the queue payload | `lib/picking/queue.ts:114-133`, `:505-521` | consumed only at `picking-queue.tsx:715`, `:832-841`, `:1021`. The mobile shell reads `data.rows` only (`picking-mobile-shell.tsx:233`). **`assignedCount` already has zero readers today** |
| The `isStillWaiting` counting rule | `lib/picking/queue.ts:502-503` | feeds only the four fields above |
| The nine desktop mockups | `docs/mockups/picking/desktop-picking-v3…v9.html`, `desktop-picking-status-board*.html`, `desktop-picking-upcoming.html` | referenced from `picking-queue.tsx:47` |
| Most of `CLAUDE_UI.md §61` | `docs/CLAUDE_UI.md:1343-1371` | see §8 — **not all of it** |

### 4b. SHARED — the must-not-touch list

| What | Where | Who else needs it |
|---|---|---|
| 🔴 **The picker-list route** | `app/api/warehouse/pickers/route.ts` | `picking-queue.tsx:686` **and** `picking-board-mobile.tsx:936`. The mobile caller survives. **Never archive `app/api/warehouse/` as a folder** — this is the only file left in it |
| 🔴 **The sort spine** | `lib/picking/sort.ts` | `sortPickingQueue` runs the **server-side** sort for every scope (`lib/picking/queue.ts:494`) — mobile depends on it. The five rule **objects** are imported by `lib/floor/sort.ts:16` to build `FLOOR_SPINE`; `sortPickingQueue` is imported by `lib/floor/queries.ts:20` and `components/floor/floor-board.tsx:13`. `byAssigned` (`sort.ts:80-84`) is used only inside `PICKING_SPINE` — which is what the server applies to mobile rows, so **it stays live**. The desktop file's `DISPLAY_RULES` (`picking-queue.tsx:53`) is a *local copy* of the list minus `byAssigned`; it dies with the file, and `FLOOR_SPINE` is that same list, already living elsewhere |
| 🔴 **The live-sync hook** | `lib/hooks/use-picking-marker.ts` | four call sites: `picking-queue.tsx:770` (dies) · `picking-mobile-shell.tsx:198` · `picker-my-picks-board.tsx:159` · `components/floor/floor-page.tsx:493`. **Three survive untouched.** Only the `"rolling"` value in the `MarkerScope` type (`:9`) becomes unused |
| 🔴 **The picker "My Picks" split** | `app/picking/page.tsx:118-171` | the picker's whole board. It sits in the same file as the wrapper being edited — **do not disturb it.** It calls `getPickingQueue({ scope: "openPending" })` (`:144`), unrelated to `rolling` |
| The queue + marker endpoints | `app/api/picking/queue/route.ts`, `app/api/picking/marker/route.ts` | still serve mobile (`openPending`) and the picker face |
| Assign / unassign | `app/api/picking/assign`, `/unassign` | Floor calls both (`floor-page.tsx:244`, `:246`, `:387`, `:389`, `:405`); mobile calls both (`picking-board-mobile.tsx:1535`, `:1589`) |
| The queue builder | `lib/picking/queue.ts` | `app/picking/page.tsx:144` + the queue route + the marker route |
| The row type | `lib/picking/types.ts` | imported by `lib/floor/types.ts:6` |
| Mobile shell clearance | `MOBILE_NAV_CLEARANCE`, `components/shared/mobile-shell.tsx:24` | `picking-board-mobile.tsx:6`,`:708` and `picker-my-picks-board.tsx:7`,`:491`. **The desktop board never imports it** |
| Sheet geometry | `SHEET_GEOMETRY`, defined **inside** `components/picking/picking-board-mobile.tsx:704` | used only in that same file (`:735-738`, `:2156-2164`, `:2683-2691`). Mobile-only |
| App-wide bits | `components/universal-header.tsx` (7 boards use `filterGroups`), `components/ui/checkbox.tsx`, `getTodayIST` in `lib/dates.ts` | unaffected |

---

## 5. Sole-entry-point findings

*"An import is not a call, and capability is not reachability" — each of these was checked at the
call site, not by name-matching.*

| Question | Answer | Evidence |
|---|---|---|
| Is the desktop board the last door into `MOBILE_NAV_CLEARANCE`? | **No.** It never imports it at all. | `picking-queue.tsx` has no such import; the two real consumers are both mobile files (§4b) |
| …into `SHEET_GEOMETRY`? | **No.** It lives inside the mobile board file and is used only there. | `picking-board-mobile.tsx:704` and its three uses in the same file |
| …into `/api/warehouse/pickers`? | **No** — the mobile board calls it too. | `picking-board-mobile.tsx:936` |
| …into the push-test diagnostic page? | **No.** Two doors: the desktop pill (`picking-queue.tsx:1102-1108`) and a mobile-only fixed link (`picking-mobile-shell.tsx:111-119`). The mobile door survives | both are marked `⚠️ TEMPORARY SCAFFOLDING`; removal is already a ROADMAP item |
| …into any dialog, sheet or modal? | **No.** `picking-queue.tsx` imports no sheet, dialog or modal — only `UniversalHeader`, `Checkbox` and icons | `picking-queue.tsx:1-20` |
| Does any API route lose its last caller? | **No.** Checked one by one: queue, marker, assign, unassign, done, approve, release, order-detail, warehouse/pickers — every one retains a mobile or Floor caller | §4b |
| Anything NEW that this strands? | **Yes, three small things, all inert:** the `rolling` scope arm and its two validation branches; the four count fields on the queue payload; and the `indeterminate` checkbox prop — whose only use in the whole app is `picking-queue.tsx:498`. That prop belongs to the third-party `base-ui` component, so there is no code of ours to clean up | §4a |
| Is the "Unmatched bills" list a sole entry point? | **Yes, in effect.** It is the only place on any desktop board that *lists* bills whose customer never matched. Floor shows the words "(Unmatched)" on a row but offers no way to find them. Losing it is real, though the *fix* path (Tint Manager's resolver) is unaffected | `picking-queue.tsx:32-34`, `:838-841`; `lib/floor/queries.ts:394` |

---

## 6. Who uses it — and the unrun live SQL

**From the code (this much is proven):**

| Role | Can open `/picking` today? | Holds `/floor`? | What they'd see under option (a) |
|---|---|---|---|
| `admin` | yes — bypass (`app/picking/page.tsx:63`) | yes (bypass + seeded row) | mobile board; can still use `/floor` |
| `operations` | yes (`prisma/seed.ts:114`) | **yes** (`prisma/seed.ts:118`) | mobile board; already lands on `/floor` (`lib/rbac.ts`) |
| `floor_supervisor` | yes, view+edit (`prisma/seed.ts:112`) | **no row** | mobile board — **his only board** |
| `picker` | yes, view only (`prisma/seed.ts:113`) | **no row** | his "My Picks" board (unchanged) |

⚠️ **That table describes the SEED FILE, not the live database.** Seed and live have disagreed three
times in one week (playbook §4). `CLAUDE_CORE.md:169` and `CLAUDE_PICKING.md:47` claim the picking
grants were SELECT-verified live on 2026-07-27, while `CLAUDE_CORE.md:945` and `docs/ROADMAP.md:346`
still say "seed only, prod unverified" — **the canon contradicts itself.** Run this before planning
anything that depends on it.

### UNRUN — paste into the Supabase SQL Editor

```sql
SELECT 'A. picking grants (live)' AS chk,
       "roleSlug"                 AS detail,
       "canView"::text            AS v1,
       "canEdit"::text            AS v2
  FROM role_permissions
 WHERE "pageKey" = 'picking'
UNION ALL
SELECT 'B. floor grants (live)',
       "roleSlug",
       "canView"::text,
       "canEdit"::text
  FROM role_permissions
 WHERE "pageKey" = 'floor'
UNION ALL
SELECT 'C. holds picking but NOT floor',
       p."roleSlug",
       p."canView"::text,
       ''
  FROM role_permissions p
 WHERE p."pageKey" = 'picking'
   AND p."canView" = true
   AND NOT EXISTS (
         SELECT 1 FROM role_permissions f
          WHERE f."pageKey" = 'floor'
            AND f."roleSlug" = p."roleSlug"
            AND f."canView"  = true)
UNION ALL
SELECT 'D. active users on those roles',
       r.slug,
       COUNT(*)::text,
       ''
  FROM users u
  JOIN role_master r ON r.id = u."roleId"
 WHERE r.slug IN ('floor_supervisor','picker','operations','admin')
 GROUP BY r.slug
UNION ALL
SELECT 'E. secondary-role holders',
       r.slug,
       COUNT(*)::text,
       ''
  FROM user_roles ur
  JOIN role_master r ON r.id = ur."roleId"
 WHERE r.slug IN ('floor_supervisor','picker','operations')
   AND ur."isPrimary" = false
 GROUP BY r.slug
UNION ALL
SELECT 'F. sample live picking rows',
       s."workflowStage",
       s.n::text,
       ''
  FROM (SELECT "workflowStage", COUNT(*) AS n
          FROM orders
         WHERE "isRemoved" = false
           AND "workflowStage" IN ('pending_picking','pick_assigned','pick_done','pick_checked')
         GROUP BY "workflowStage"
         ORDER BY n DESC
         LIMIT 10) s
ORDER BY 1, 2;
```

**What to look at:** block **C** is the decision. Every role it returns is a role that would hit a
permission wall under option (b). If C returns `floor_supervisor` and `picker` — as the seed
predicts — option (b) is off the table without a deliberate permission grant.

---

## 7. Signposts and stale doc lines

### 7a. The sweep — and why it comes back almost empty

Run two ways, per playbook §4, with a character class on every branch so the Windows path-rewriting
trap cannot fire:

- **Sweep A** — ripgrep, pattern `[/]picking\b`, whole repo excluding `archive/`.
- **Sweep B** — MSYS `grep -rn '/picking\b'` over `.ts/.tsx/.md/.json/.mjs/.html`.

**Reconciled by line number, not by eyeball.** Every code hit in B appears in A at the identical
line. A additionally returned `public/sw.js:37`,`:53` and `prisma/schema.prisma:753`,`:763` — B
missed those purely because its `--include` list had no `*.js` and no `.prisma`, **not** because of
the search trap. No discrepancy survives.

**The finding is the emptiness itself:** `/picking` is ONE web address with two faces. **No link,
redirect, sidebar row or nav entry anywhere points at "the desktop board"** — there is nothing to
repoint. This is why playbook step 3 ("repoint every signpost") has almost no work in it here.

**Live pointers to `/picking` — all must SURVIVE untouched:**

| Where | Line | What it is |
|---|---|---|
| `lib/rbac.ts` | `:38`, `:39` | login landing for `floor_supervisor` and `picker` |
| `lib/permissions.ts` | `:33` | the sidebar/menu entry |
| `public/sw.js` | `:37`, `:53` | where a push notification opens to |
| `app/api/push/test-saved/route.ts` | `:27` | push payload target |
| `app/api/picking/assign/route.ts` | `:199` | "new pick assigned" push target |
| `app/api/picking/done/route.ts` | `:172` | "bill picked" push target |
| `app/api/picking/push-test/route.ts` | `:54` | diagnostic push target |

`middleware.ts` `PHASE1_BLOCKED` is `[]` — `/picking` is not gated there and needs no change.
`next.config.mjs` has no redirect or rewrite touching `/picking`.

### 7b. Stale lines to correct — including two stale CODE COMMENTS

| # | Where | What it says | Why it is wrong |
|---|---|---|---|
| 1 | `docs/CLAUDE_PICKING.md:386-388` | "No desktop Checked view was built — a `pick_checked` row has no home on desktop, by design" | Contradicted by §9 of the same file and by `picking-queue.tsx:157-162` — desktop has shown a green **Ready** pill since 2026-07-22. **Stale doc, quoted in this prompt's brief; correct it whatever is decided** |
| 2 | `components/picking/picking-mobile-shell.tsx:145-146` | "Desktop (`picking-queue.tsx`) still sends `?date=` and no scope, so it keeps the unchanged `'single'` path." | **False since 2026-07-22.** Desktop sends `?scope=rolling&date=…` (`picking-queue.tsx:672`). A **stale code comment** — playbook §4's own warned class |
| 3 | `lib/picking/queue.ts:75-80` | the `'single'` scope "…The desktop board depends on this exactly as-is" | **False.** `'single'` has **zero live callers**. Its only user is the scratch script `scripts/_chk-scope-parity.ts:35`,`:53`, which is outside the type-check gate. `'single'` is already dead code today, before this retirement |
| 4 | `lib/workflow-stages.ts:11-15` | "Today only Support reads this file." | Support was retired 2026-07-27. Picking and Floor both read it |
| 5 | `docs/CLAUDE_PICKING.md:6-18`, `:31-33`, `:587-588`, `§9` (`:612-660`) | describe the desktop board as live | update at step 7, not before |
| 6 | `docs/CLAUDE_CORE.md:816` | "Desktop queue + mobile supervisor board (**Assign/Check** tabs)" | the mobile tabs were renamed **Assign/Picking/Done** on 2026-07-20 (`CLAUDE_PICKING.md §5.1`). Wrong already, independently of this work |
| 7 | `docs/CLAUDE_FLOOR.md:37`, `:176` | "retiring the Picking DESKTOP board is intended but unplanned" | update at step 7 |
| 8 | `docs/ROADMAP.md:399-406` | the P0 "retirement dependency list" item | this report **is** that list; close or fold it |
| 9 | `archive/RETIREMENT-PLAYBOOK.md:337` | the §8 candidate row, "Step 0/1 not done" | Step 0 is now done |
| 10 | `docs/CLAUDE_CORE.md:945` + `docs/ROADMAP.md:346-349` | picking grants "seed only, prod verification pending" | contradicted by `CLAUDE_CORE.md:169` and `CLAUDE_PICKING.md:47`, which say verified live 2026-07-27. **Canon disagrees with itself** — settle it with the §6 SQL |
| 11 | `docs/CLAUDE_UI.md:1343-1371` (§61) | the whole desktop visual spec | see §8 — **extract before collapsing** |

---

## 8. UI — what must be extracted from §61 BEFORE anything collapses

**The rule from the §47 precedent: seven live items were moved out before five were collapsed.
Deleting live knowledge is worse than a slightly wrong section title.**

§61 (`docs/CLAUDE_UI.md:1343-1371`) is *mostly* desktop-only. But six things inside it are **still
live elsewhere** and would be silently lost:

| # | What | Where it lives in §61 | Who still needs it | Where it should go |
|---|---|---|---|---|
| 1 | **Age tags — `1d` amber, `{n}d` red, read from `row.ageDays`, never recomputed** | `:1365` | The **mobile** board renders its own age badge (`picking-board-mobile.tsx:588-628`), and **§62 points AT §61 for it** — `:1381` says "Locked/Upcoming + `1d/2d` age treatment mirror §61" | **§62** (or a shared note). If §61 collapses first, §62's pointer dangles |
| 2 | **Locked / Upcoming visual treatment** — muted rows, lock glyph instead of a control, "for {Day}" chip | `:1367` | Same §62 pointer at `:1381`; mobile has its own locked zone (`picking-board-mobile.tsx:1947-1960`, badge at `:634`) | **§62** |
| 3 | **"Age badge pill styling is reused from §8's Tint badge; its day maths is NOT"** | `:1365` | a cross-module reuse fact that outlives the desktop board | **§62**, alongside #1 |
| 4 | **The rejected list** — no "% ready for dispatch" bar, no per-route progress roll-up, no auto "Ready to load" status, no header status-count stats; and *why* ("loading depends on vehicle/space, which the system doesn't know") | `:1361`, `:1369` | This is **decision history for any picking or floor board**, not for one file. Floor independently reached the same answer (`CLAUDE_FLOOR.md §8` removed the stats line) | **`CLAUDE_FLOOR.md`** or a standing "rejected on this module" note in §62 — **must not be deleted** |
| 5 | **"Route renders as plain text, no route dot — there is no route→colour data in the payload; `RouteDot` on mobile keys on `deliveryType`, not route"** | `:1350` | A fact about the **mobile** component and the shared payload. Still true after desktop goes | **§62** |
| 6 | **"Status pill is never teal — teal is spent on the active slot tab"** | `:1353` | An application of the one-teal rule (§1). Floor states its own version at `components/floor/status-pill.tsx:3-4` and in its §7.6 design | keep a one-line pointer in **§1** or **§62**; the four desktop hexes themselves can go |

**Genuinely desktop-only inside §61, safe to collapse:** the 8-column `4/3/19/27/14/7/9/17%` layout,
the four status-pill hex values, the List ⇄ By Route toggle styling, the slot-band styling, the
filter-panel wiring note, and the temporary-inline-Undo note.

⚠️ **Also check on the way past:** Floor's own four status pills (Waiting grey / With picker violet /
Needs check amber / Done green, `components/floor/status-pill.tsx:27-32`) appear to have **no home in
`CLAUDE_UI.md` at all** — `CLAUDE_FLOOR.md §2` mentions "four status pills" without their colours.
That is a pre-existing hole, not caused by this work, but it is the natural place to fix it while
§61's pills are being read. **Unproven** whether it is deliberate.

---

## 9. Recommended step order

Sequenced so each step is separately reviewable and separately reversible. **The playbook's rule —
"move the people out before you demolish the building" — is the reason steps 1-3 come before 4.**

| Step | What | Why HERE | Reversible? |
|---|---|---|---|
| **0** | *(done — this report)* | | |
| **1** | **Owner decision on the three real gaps** (§2 #5/#6 counts, #13 the global `#`, #19 the audience) — accept on the record, or build into Floor first | Every later step assumes an answer. Accepting a loss knowingly is fine; discovering it later is not | n/a |
| **2** | **Run the §6 SQL.** Confirm who holds `picking` and `floor` **live**, and settle the canon's self-contradiction (§7b #10) | Seed ≠ live has bitten three times in one week. Step 3's choice depends on the answer | read-only |
| **3** | **Choose the desktop-visitor option** (§3). If anything other than (a), the permission grant is decided and applied **here**, before any file changes | This is the "repoint the signposts while the old screen still works" step. Nobody should be able to reach a dead end | yes |
| **4** | **Extract the six live items out of `CLAUDE_UI.md §61`** into §62 / `CLAUDE_FLOOR.md` (§8) — **its own commit, before any code moves** | §47's precedent. Documentation-only, so it is safe to land early and it de-risks step 5 | yes |
| **5** | **Fix the two stale CODE comments** (§7b #2 and #3) — `picking-mobile-shell.tsx:145-146` and `lib/picking/queue.ts:75-80` — **before** touching the code they describe | A stale comment that is *about to become* differently stale is worse. Small, isolated, no behaviour change | yes |
| **6** | **Remove the desktop branch.** `app/picking/page.tsx:7` and `:186-188`; `git mv components/picking/picking-queue.tsx` into `archive/2026-07-picking-desktop/components/picking/`. Confirm the picker split at `:118-171` is untouched. `npx tsc --noEmit` | The one irreversible-ish move; everything it depended on has already been handled. `git mv`, never copy-and-delete | via git |
| **7** | **Verify by hand — Smart Flow only.** Four logins on a real PC and a real phone: `floor_supervisor`, `picker`, `operations`, `admin`. Plus the narrow-window swap. Plus how the card board looks at full desktop width (§3's honest unknown) | Claude Code has no credentials — anything behind auth returns `307 → /login`, so a retired route and a live one look identical from outside. **This step cannot be automated here** | n/a |
| **8** | **Remove the now-dead `rolling` scope** — `lib/picking/queue.ts:192-217` plus its three validation branches, and the four unread count fields (§4a) | Deliberately AFTER step 7. If step 6 has to be undone, `rolling` must still exist. Do not bundle a cleanup into a removal | yes |
| **9** | **Correct the documentation** (§7b) — `CLAUDE_PICKING.md`, `CLAUDE_CORE.md`, `CLAUDE_FLOOR.md`, `ROADMAP.md`, the playbook's §8 candidate row; write `archive/2026-07-picking-desktop/README.md`; add a row to `archive/README.md` and to the playbook's §7b table | Last, because only now is it known what is actually true | yes |
| **—** | **Explicitly NOT part of this job:** removing a page key · clearing orphaned permission rows · deleting any API route · touching `app/api/warehouse/` · touching either mobile board | `/picking` stays live and keeps its permission. There are no orphaned rows to clear — **this retirement has no step 5b** | |

**Two things that would normally be in a retirement and are absent here, on purpose:**
`tsconfig.json` already excludes `archive/`, so no exclusion needs adding (it went in with the Support
retirement). And there is no seed edit and no SQL write anywhere in this plan — the only SQL is the
**read-only** query at step 2.

---

## 10. Open questions for Smart Flow

1. **The three gaps (§2 #5/#6, #13, #19) — accept, or build into Floor first?** The `#` numbering
   (#13) is the one most likely to be felt on the floor: on Floor the number restarts inside every
   slot band and every route group. Is the `#` actually spoken aloud at the depot, or is it just
   screen furniture?
2. **`floor_supervisor` — should he get `/floor`?** Not needed for option (a). It is the whole
   question for option (b). Granting it hands him Hold / Cancel / Release over the gatekeeper rail —
   an authority decision, not a screen decision.
3. **Which desktop-visitor option (§3)?** Recommendation is (a).
4. **Has anyone actually used the desktop board for real work recently?** The playbook's own gate is
   "nobody depends on the old screen, confirmed by the owner, out loud, before any file moves." The
   floor team is Android-only (`CLAUDE_PICKING.md §1`) — but `operations` and `admin` sit at PCs.
   **Unproven from code; only you can answer it.**
5. **The "Unmatched" list (§2 #17).** Losing it removes the last desktop *list* of bills whose
   customer never matched. Does anyone use that tab, or is Tint Manager's resolver the real path?
6. **Should the mobile board get a `max-width` at desktop widths?** Related to §3's honest unknown.
   A small polish step, better decided after you have looked at it once.
7. **Timing vs the push rollout.** The desktop "Push test (temporary)" pill (`picking-queue.tsx:1102`)
   disappears with this change; the mobile one survives. Is the push rollout far enough along that
   this does not matter?
8. **Floor's status-pill colours have no home in `CLAUDE_UI.md` (§8, last note).** Fix while §61 is
   open, or leave as a separate item?

---

## Method notes — what could NOT be proven here

- **No login credentials.** Anything behind auth returns `307 → /login`, so a retired route and a live
  one look identical from outside. **No board rendering, no role's landing page, and no permission
  wall was observed.** Every access claim in this report is read from `prisma/seed.ts` and
  `lib/permissions.ts` — i.e. from **code**, not from the live database or a real session.
- **Seed is not live.** §6's table describes the seed file. The SQL in §6 is the only way to settle it,
  and it has **not been run**.
- **How the mobile card board looks above ~800px is unproven.** `CLAUDE_UI.md §60` documents a 390px
  design target and a 320px floor, and says nothing about an upper bound.
- **Every claim above carries a `file:line`.** Where a fact could not be established from the code,
  it is written **"unproven"** rather than guessed.

---

*Discovery only — 2026-07-28. No file moved, edited, renamed or deleted. No SQL run. No commit.*
