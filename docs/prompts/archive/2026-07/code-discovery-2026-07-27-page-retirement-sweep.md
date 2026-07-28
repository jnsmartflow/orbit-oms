# Page retirement sweep — Operations pages, the Warehouse family, and /order
# 2026-07-27 · read-only · code-verified

Discovery only. Nothing was moved, edited, renamed or deleted. No SQL was run. No
schema changed. Every claim below carries a `file:line`; where a claim could not be
proved from code it is marked **unproven**.

Method note, per the playbook: every address sweep was run **twice, two different
ways** — once through `git grep` with a character-class prefix (`[/]warehouse`) to
dodge the Git Bash path-mangling trap, and once through a separate search engine
with the leading slash quoted. Both agreed. Where they agreed, it is stated as fact.

---

## 1. Verdict table

| Surface | Verdict | Why |
|---|---|---|
| `/operations/warehouse` | **SAFE** | A 9-line file that renders the same component as `/warehouse`. Nothing imports it, nothing links to it except its own nav entry. |
| `/operations/dispatch` | **SAFE** | Same shape — 9 lines, renders the same component as `/planning`. |
| `/warehouse` | **SAFE (but read §3 first)** | Its board queries a workflow stage **nothing in the codebase ever writes**, so it can only ever render empty. |
| `/warehouse/supervisor` | **SAFE** | A 4-line redirect stub to `/warehouse`. |
| `/warehouse/picker` | **SAFE** | A 4-line redirect stub to `/warehouse`. |
| `/planning` | **UNCLEAR** | Same empty-board problem as `/warehouse`, but it is a **write** surface (creates dispatch plans, assigns vehicles) and `/dispatcher` redirects into it. Owner call. |
| `app/api/warehouse/board` | **SAFE** | Called by one component only, the one that retires with it. |
| `app/api/warehouse/pickers` | **🔴 KEEP — LOAD-BEARING** | Called by the **live Picking boards**. Retiring it breaks `/picking`. |
| `app/api/warehouse/assign` | **SAFE** | Called only by the Warehouse board. |
| `app/api/planning/board` | **SAFE** | Called only by the Planning board. |
| `app/api/planning/orders/[id]/mark-picked` | **UNCLEAR** | Called by **both** Planning and Warehouse. Dies only if both go. |
| `/order` | **SAFE to retire — 3 things must move first** | Owns exactly one file. But a live redirect points at it, and `/po` depends on library code `/order` also uses. |
| `/orders` | **UNCLEAR — new finding** | Unrelated to this brief, but it is currently reachable **without login** as a side effect of the `/order` middleware entry (§4.4). |

**No BLOCKED rows.** The one question flagged as a potential blocker in the brief —
"is `/po` public?" — is settled: **it is** (§4.5). Retiring `/order` does not remove
the last no-login order-entry surface.

---

## 2. Job A — `/operations/warehouse` and `/operations/dispatch`

Both are **alternate mounts**, not separate screens. This is the exact shape Support
had, where three addresses rendered one component.

### What they own

| Address | File | Lines | What it renders |
|---|---|---|---|
| `/operations/warehouse` | `app/(operations)/operations/warehouse/page.tsx` | 10 | `<WarehousePage />` (`:3`) — the **same component** `/warehouse` renders |
| `/operations/dispatch` | `app/(operations)/operations/dispatch/page.tsx` | 10 | `<PlanningPage />` (`:3`) — the **same component** `/planning` renders |

Neither owns a layout, a component or an API route. `app/(operations)/operations/layout.tsx:25`
gates the whole group on role `operations` or `admin`; that layout is shared with
`/operations/tinting` and `/operations/tint-operator`, which are **not** in scope —
so the layout stays.

### What imports them

**Nothing.** A page file in Next.js is an entry point; no other file imports it.
Verified by searching for both component names across `app`, `components` and `lib`
— the only importers are the four page files listed in §3.

### Signposts pointing at them

| Signpost | file:line | Note |
|---|---|---|
| Nav entry "Dispatch" | `lib/permissions.ts:28` | `pageKey: "operations_dispatch"` → `/operations/dispatch` |
| Nav entry "Warehouse" | `lib/permissions.ts:29` | `pageKey: "operations_warehouse"` → `/operations/warehouse` |
| Sidebar icons | `components/shared/role-sidebar.tsx:42-43` | `operations_dispatch`, `operations_warehouse` |

That is the complete list. No login landing, no redirect, no plain-text URL anywhere
else in the repo.

### Their permission keys

| Key | PageKey union | ALL_PAGE_KEYS | PAGE_NAV_MAP | seed | admin permissions UI |
|---|---|---|---|---|---|
| `operations_dispatch` | `lib/permissions.ts:123` | `:185` | `:28` | **none** | not present |
| `operations_warehouse` | `lib/permissions.ts:124` | `:185` | `:29` | **none** | not present |

**Neither key is seeded** (`prisma/seed.ts` — searched for `pageKey: "operations`,
zero hits). This is exactly the `operations_support` pattern: the key exists in code,
grants exist only as hand-made live database rows. **The live table must be read
before these keys are removed** — see the SQL in §8.

### Successor

`/warehouse` and `/planning` respectively — the same component, at a different
address. Parity is not a question here; it is literally the same screen.

### Verdict

**SAFE.** These two are the cleanest retirement in this sweep: two 10-line files,
two nav entries, two permission keys, no dependencies in either direction.

---

## 3. Job B — the warehouse family

### The map

| Surface | Exists | Reachable | Imported by | Role lands on it | Verdict |
|---|---|---|---|---|---|
| `/operations/warehouse` | yes | yes (operations/admin) | nothing | no | **DEAD** |
| `/operations/dispatch` | yes | yes (operations/admin) | nothing | no | **DEAD** |
| `/warehouse` | yes | yes, gated on `warehouse` canView (`app/(warehouse)/warehouse/layout.tsx:29`) | nothing | **yes — indirectly**, both `floor_supervisor` and `picker` (§3.2) | **DEAD in effect** — board can never populate |
| `/warehouse/supervisor` | yes | yes | nothing | **yes** — `floor_supervisor` (`lib/rbac.ts:30`) | **DEAD** — 4-line redirect stub |
| `/warehouse/picker` | yes | yes | nothing | **yes** — `picker` (`lib/rbac.ts:31`) | **DEAD** — 4-line redirect stub |
| `app/api/warehouse/board/route.ts` | yes | yes | `warehouse-page.tsx:103` only | — | **DEAD** with its board |
| `app/api/warehouse/pickers/route.ts` | yes | yes | **Picking ×2** + Warehouse ×1 | — | **🔴 LIVE — KEEP** |
| `app/api/warehouse/assign/route.ts` | yes | yes | `warehouse-page.tsx:171` only | — | **DEAD** with its board |
| `app/api/planning/board/route.ts` | yes | yes | `planning-page.tsx:137` only | — | **DEAD** with its board |
| `/planning` | yes | yes, gated on `planning_board` canView (`app/(planning)/planning/layout.tsx:26`) | nothing | **indirectly** — `/dispatcher` redirects here (`app/(dispatcher)/dispatcher/page.tsx:4`) | **UNCLEAR** |

**The one that must not move: `app/api/warehouse/pickers/route.ts`.** It is called by
`components/picking/picking-board-mobile.tsx:936` and
`components/picking/picking-queue.tsx:686` — both live Picking surfaces. Its name says
"warehouse"; its users are Picking. This is the playbook's "do not delete by
name-matching" trap, and it is the single most dangerous item in this sweep.
(`lib/picking/picker-roster.ts:13` notes it deliberately does *not* reuse this route —
so a third, separate roster helper also exists.)

### B1 — which page does each board API actually serve?

**Answer: both mounts, because both mounts render the same component.**

- `app/api/warehouse/board/route.ts` is fetched by `components/warehouse/warehouse-page.tsx:103`.
  That component is rendered by **`/warehouse`** (`app/(warehouse)/warehouse/page.tsx:1`)
  **and** by **`/operations/warehouse`** (`app/(operations)/operations/warehouse/page.tsx:3`).
- `app/api/planning/board/route.ts` is fetched by `components/planning/planning-page.tsx:137`.
  That component is rendered by **`/planning`** (`app/(planning)/planning/page.tsx:1`)
  **and** by **`/operations/dispatch`** (`app/(operations)/operations/dispatch/page.tsx:3`).

So the hypothesis in the brief is **half right**: `/api/warehouse/board` does serve
`/warehouse`, but not *instead of* `/operations/warehouse` — it serves both, because
they are one screen at two addresses. Job A is indeed simpler than feared, but for a
different reason than expected.

### 🔴 B1 correction — a documentation error I introduced on 2026-07-27

**`CLAUDE_CORE.md` is currently WRONG about `lib/slot-cascade.ts` and
`lib/day-boundary.ts`, and I am the one who made it wrong.**

In step 7 of the Support retirement (commit `f6ace5b8`) I "corrected" CORE §9 and §13
to say those two files **are called** by the planning and warehouse board routes. That
correction was based on seeing the **import** statements. It did not check the call
sites. The calls are **commented out**:

```
app/api/planning/board/route.ts:21    // DISABLED: slot cascade removed — slots are fixed by obdEmailTime
app/api/planning/board/route.ts:22-26 //   if (date === todayIST) { await runDailyCleanupIfNeeded(); ... }

app/api/warehouse/board/route.ts:63   // DISABLED: slot cascade removed — slots are fixed by obdEmailTime
app/api/warehouse/board/route.ts:64-68 //   if (date === todayIST) { await runDailyCleanupIfNeeded(); ... }
```

The imports at `planning/board:5-6` and `warehouse/board:5-6` are live; the
invocations are not. **Neither function has ever run on these paths since the lines
were commented.** The ORIGINAL doc text — "present but never called" — was correct in
substance, and my edit made the canon less accurate, not more.

Two consequences:

1. **CORE §9 and §13 need re-correcting.** Not in this session (discovery only) — it
   is listed as an action in §8.
2. **The lesson generalises:** an import is not a call. The step-6 sweep grepped for
   the module name, found imports, and concluded "called". Reading the call site takes
   ten seconds and would have prevented a wrong doc claim shipping to `main`.

For the retirement itself this is **good news**: both files are genuinely dormant, so
retiring the two board routes carries no hidden scheduled-job risk.

### B2 — do `floor_supervisor` and `picker` land nowhere?

**In code, today, they land on a redirect stub that works.**

```
lib/rbac.ts:30   floor_supervisor: "/warehouse/supervisor",
lib/rbac.ts:31   picker:           "/warehouse/picker",
```

Both targets are 4-line files whose entire body is `redirect("/warehouse")`
(`app/(warehouse)/warehouse/supervisor/page.tsx:4`, `.../picker/page.tsx:4`). So both
roles currently land on `/warehouse` — a board that renders but is **always empty**
(§B3).

**`ROLE_REDIRECTS` is used in three places, not one** — this matters, because
repointing it fixes all three at once, and missing it breaks all three:

| Consumer | file:line | What breaks if the target dies |
|---|---|---|
| Post-login root redirect | `app/page.tsx` (imports `ROLE_REDIRECTS`) | The user lands on a dead page immediately after logging in |
| Already-authenticated guard | `app/login/page.tsx` | Same |
| "Go to my dashboard" link | `app/unauthorized/page.tsx:9-10` | The recovery link from an access-denied page is itself dead |

That third one is a trap worth naming: an access-denied page whose escape link is
also broken leaves the user with no way forward but the browser back button.

**Does any live user hold either role? Unproven from code.** `prisma/seed.ts:93-94`
grants `floor_supervisor` and `picker` the `warehouse` page key, and CORE §5 lists
`picker` as "seeded" with no named person and `floor_supervisor` with none at all —
but seed is not live. SQL in §8.

### B3 — is `/warehouse` a superseded ancestor, or a distinct live board?

**A superseded ancestor. Its board cannot show anything.**

`app/api/warehouse/board/route.ts:76` filters on `workflowStage: "dispatch_confirmation"`.
`app/api/planning/board/route.ts:29-30` filters on the same stage (plus `dispatched`
in the history view).

**Nothing in the codebase ever writes `dispatch_confirmation` to `orders.workflowStage`.**
Every occurrence is a read, a filter, or a comparison:

```
app/api/planning/board/route.ts:29,30          read filter
app/api/planning/plans/[id]/add-orders:60      read guard
app/api/warehouse/board/route.ts:76            read filter
app/api/warehouse/assign/route.ts:55           comment only
app/api/tint/operator/my-orders:161            reads SPLIT status, a different column
components/tint/split-builder-modal.tsx:562    reads SPLIT status
components/tint/tint-manager-content.tsx:1443  reads SPLIT status
prisma/seed.ts:159                             a status_master LABEL row, not an order write
lib/workflow-stages.ts:135                     the comment that already says nothing writes it
```

`lib/workflow-stages.ts:134-135` states it outright: *"zero production order has ever
reached 'dispatched'; the Planning pipeline that writes it requires
'dispatch_confirmation', a stage nothing in this codebase writes yet."*

Contrast with the live boards. `/picking` reads `PICKING_OPEN_STAGES`
(`lib/picking/queue.ts:188`) = `pending_picking` / `pick_assigned` / `pick_done`;
`/floor` reads the same universe (`CLAUDE_FLOOR.md §3`). **The two boards do not share
a single stage value.** `/warehouse` sits on a branch of the workflow that was never
connected.

**In plain English:** `/warehouse` and `/planning` are the older design for what
happens after picking. That design was never finished — the step that would move an
order into their view was never built. Picking and Floor took over the live work using
different stage names. So both screens open, render their frame, and show nothing.

⚠ **Confirm against live data before acting** — the SQL in §8 settles it in one query.
If it returns zero, both boards are provably empty. If it returns rows, something
outside this repo (a manual SQL update, the external PowerShell tooling) is writing
that stage, and this section is wrong.

---

## 4. Job C — `/order`

### 4.1 What `/order` owns

**Exactly one file: `app/order/page.tsx`.**

No layout (it sits directly under `app/`, deliberately — `CLAUDE_PLACE_ORDER.md §15`
notes it is "NOT under `app/(public)/`"). No components folder. No API route of its
own. Confirmed by listing every tracked file under `app/order/`.

### 4.2 🔴 The KEEP list — what `/order` uses that `/po` also needs

`/order` imports six library modules. **Every one is shared with `/po`. None may be
archived with `/order`.**

| Module | `/order` | `/po` | Verdict |
|---|---|---|---|
| `lib/place-order/mobile-search` (`rankProductsForQuery`) | `app/order/page.tsx:10` | `app/po/po-page.tsx:7` | **KEEP** — the mobile search matcher; `/place-order` does **not** use it (desktop uses `lib/place-order/queries.ts`), so `/po` would be its only user |
| `lib/place-order/pack-buckets` | `:5` | `:5` | **KEEP** |
| `lib/place-order/pack` | `:6` | `:8` | **KEEP** |
| `lib/place-order/email` | `:7` | `:10` | **KEEP** |
| `lib/place-order/base-aliases` | `:8` | `:9` | **KEEP** |
| `lib/place-order/sub-product-descriptors` | `:9` | `:11` | **KEEP** |

Plus the shared server route:

| Route | `/order` | `/po` | Verdict |
|---|---|---|---|
| `GET /api/order/data` | `app/order/page.tsx:230` | `app/po/po-page.tsx:752` | **KEEP** — confirms the doc claim (`CLAUDE_PLACE_ORDER.md §16`, cited at `po-page.tsx:752`) |

Also note `app/po/po-page.tsx:6` imports its types from
`@/app/(place-order)/place-order/types` — so `/po` additionally depends on the
**`/place-order` folder**, which is staying. Not at risk, but worth knowing that `/po`
is not self-contained either.

**Because `/order` owns one file and shares everything else, this retirement is
unusually clean: there is nothing to extract first.** The playbook's step 1 ("cut the
dependencies") has no work in it here — a first for these three jobs.

### 4.3 🔴 The narrow-window redirect — must be repointed BEFORE archiving

```
app/(place-order)/place-order/place-order-page.tsx:64   const MOBILE_BREAKPOINT_PX = 1024;
app/(place-order)/place-order/place-order-page.tsx:145  // < 1024px viewport → redirect to mobile /order. Runs on mount + resize.
app/(place-order)/place-order/place-order-page.tsx:150  if (matches) window.location.href = "/order";
```

A desktop user who narrows their browser window below 1024px is **thrown to `/order`**,
on mount *and* on every resize. Archive `/order` first and that user lands on a dead
page with no way back except typing a URL.

**Correct new target: `/po`.** It is the going-forward mobile PO page
(`CLAUDE_PLACE_ORDER.md:10`), it is public so no login prompt appears mid-resize
(§4.5), and it renders the same catalog from the same route. **This must ship before
the archive, not with it** — the playbook's step 3.

### 4.4 Middleware

```
middleware.ts:14   "/order",
middleware.ts:15   "/api/order",
middleware.ts:16   "/po",     // new public mobile order page (Phase 1) — reuses /api/order/data
```

| Entry | Action | Why |
|---|---|---|
| `"/api/order"` | **MUST STAY** | `/po` fetches `/api/order/data` (`po-page.tsx:752`). Removing it would force a login on a public page. |
| `"/po"` | **MUST STAY** | `/po` is public and is the successor. |
| `"/order"` | **May be removed — but read the next paragraph first** | Only `/order` needs it. |

⚠ **`"/order"` is doing more than it looks.** The check is
`PUBLIC_PATHS.some((p) => pathname.startsWith(p))` (`middleware.ts:26`) — a **prefix**
match, not an exact one. So `"/order"` currently also makes public:

- **`/orders`** — the ungated redirect-to-`/floor` page already on ROADMAP
- **`/order-demo.html`** — which has its own entry at `middleware.ts:18` anyway

Removing `"/order"` would therefore **newly require a login for `/orders`**. In
practice `/orders` immediately forwards to `/floor`, which has its own gate, so the
visible change is small — but it is a real behaviour change and should be a deliberate
choice, not a side effect. If `/orders` is deleted first (ROADMAP), the question
disappears.

### 4.5 Is `/po` public? — **YES. Settled.**

This was flagged as a potential blocker. It is not one.

```
middleware.ts:16   "/po",   // new public mobile order page (Phase 1)
```

and a search of every file under `app/po/` for `useSession`, `auth()`, `requireRole`
or `signIn` returns **nothing**. `app/po/page.tsx` is a plain server wrapper with
metadata only — no session check. `app/po/po-page.tsx` is a `"use client"` module with
no auth import.

**So both `/order` and `/po` are no-login order-entry surfaces.** Retiring `/order`
leaves `/po` serving exactly that audience at a public address. **No dealer or SO gets
locked out.** The owner's belief is correct and the blocker is cleared.

### 4.6 Traffic — can we tell if a real order came through `/order`?

**No. There is no reliable marker. Stating this plainly, as instructed.**

Neither page writes to the database on submit — both build a `mailto:` link
(`app/order/page.tsx:874`, and `/po` equivalently). The order only becomes data when
the resulting email is parsed into `mo_orders` by `Parse-MailOrders-v6_5.ps1`, which
lives **outside this repository** (`CLAUDE_CORE.md §4`) and could not be read.

What differs between the surfaces, and why none of it survives into the database:

| Signal | `/order` | `/po` | Usable? |
|---|---|---|---|
| Recipient | `surat.order@outlook.com` (`app/order/page.tsx:24`) | `surat.depot@akzonobel.com` (`app/po/po-page.tsx:89`) | **The only true discriminator — but `mo_orders` has no recipient/To column.** Every column was checked in `prisma/schema.prisma`; `soEmail` is the *sender*, not the recipient. |
| Subject | always `"Order …"`, built inline (`app/order/page.tsx:855`) | may be `"Truck Order"`, `"Bounce Order"`, `"DTS Order"`, `"Cross Billing Order …"` via `buildSubject` (`lib/place-order/email.ts:187`) | **One-way only.** A non-plain subject proves `/po` or `/place-order`. A plain `"Order …"` subject proves nothing — all three can emit it. |
| Body | plain order body | adds `Dispatch:` / remark / `Notes:` / `Ship To` lines when set | **One-way only** — and `CLAUDE_PLACE_ORDER.md:460` records that a plain `/po` order is **byte-identical** to `/order`'s body. |

So: a *decorated* order can be attributed to `/po`. A *plain* order cannot be
attributed to anything. Since a plain order is the common case, **the database cannot
answer "did anyone use `/order` in the last 90 days?"**

The SQL in §8 is still worth running — it establishes the **upper bound** (how many
plain-subject orders exist that *might* have come from `/order`) and shows the most
recent one. It cannot prove attribution, and the query says so in its own comment.

**Cheapest ways to actually measure it, in order of cost** (described, not built —
no code proposed):

1. **Read the hosting request logs for the `/order` path.** Zero code change, direct
   measurement of page loads. Caveat: log retention on the current Vercel plan may be
   short — **unproven**, needs checking in the dashboard.
2. **Give `/order`'s existing data fetch a distinguishing query parameter**, then count
   it in the logs. A one-line change to a URL already being requested; no user-visible
   change, no change to the email, no parser impact. This is the cheapest *reliable*
   option if logs alone prove insufficient.
3. **Ask the depot.** Both `/order` and `/po` are handed out deliberately; whoever
   distributes the link knows who has which. This is the fastest answer and costs
   nothing — and given the owner already confirmed nobody uses `/operations/*`, it may
   settle `/order` just as quickly.

⚠ **Do not attempt to distinguish them by changing the email format.** The parser reads
these emails; altering subject or body to add a marker risks the live mail-order
pipeline for a measurement question.

---

## 5. Shared code at risk

| Item | Status | Detail |
|---|---|---|
| `lib/slot-cascade.ts`, `lib/day-boundary.ts` | **Dormant — safe** | Imported by both board routes but **never called** (calls commented, §3 B1). If both boards retire, these become fully orphaned. Do not delete in the same commit — record and remove separately (playbook §6). |
| `components/shared/carried-over-badge.tsx` | **⚠ Becomes orphaned** | Used by exactly four files, all inside `components/planning/` and `components/warehouse/`. **If Planning and Warehouse both retire, nothing uses it.** Nothing else in the app imports it. |
| `components/shared/cascade-badge.tsx` | **Survives** | Also used by `components/shared/order-detail-panel.tsx`, which is mounted by `components/tint/tint-manager-content.tsx` — a live surface. Safe. |
| `components/universal-header.tsx` | **Survives** | Used by ten live surfaces including Mail Orders, Picking, Tint and Trip Report. |
| `app/api/warehouse/pickers/route.ts` | **🔴 KEEP** | Live Picking dependency (§3). |
| `app/api/planning/orders/[id]/mark-picked/route.ts` | **Shared between the two candidates** | Called by `planning-page.tsx:493` **and** `warehouse-page.tsx:231`. Retire only when both boards go. |
| `lib/place-order/*` (six modules) | **🔴 KEEP** | The `/order` KEEP list (§4.2). |
| `app/api/order/data/route.ts` | **🔴 KEEP** | Shared with `/po` (§4.2). |

**Nothing in any of the three jobs is the only entry point to a shared component**,
with the single exception of `carried-over-badge` above — which is a component with no
other user rather than a capability lost. This is the check that was missed during the
Support retirement (the missing-customer sheet); it was run deliberately here.

---

## 6. Recommended retirement order

Cheapest and safest first, so each step is provable before the next begins.

**1. `/operations/warehouse` + `/operations/dispatch`** — two 10-line files, two nav
entries, two unseeded permission keys. No dependencies either way. Do these first
because they are the smallest possible rehearsal of the full process, and because
removing them shrinks the surface for everything after.

**2. `/warehouse/supervisor` + `/warehouse/picker` — only after `ROLE_REDIRECTS` is
repointed.** These are redirect stubs, but two roles land on them at login, and the
same map feeds the `/unauthorized` recovery link (§B2). Repoint first, verify a login
for each role, then archive. ⚠ **Decide where they should land** — that is an owner
decision (§8).

**3. `/order` — after the `/place-order` narrow-window redirect is repointed at `/po`.**
Sequenced third because the redirect fix (§4.3) is a real code change on a live page
and deserves its own commit and its own smoke test. The archive itself is one file.

**4. `/warehouse` + `app/api/warehouse/board` + `app/api/warehouse/assign`** — after
the live-data check in §8 confirms the board is empty. ⚠ **`app/api/warehouse/pickers`
stays.** This is the step where a careless "move the whole `api/warehouse` folder"
would break `/picking`.

**5. `/planning` + `app/api/planning/*` — LAST, and only on an explicit owner decision.**
It is the only write surface in the family, `/dispatcher` redirects into it
(`app/(dispatcher)/dispatcher/page.tsx:4`), and it is the one screen here whose
retirement forecloses a design (§8). `mark-picked` can only retire with this step.

**Not in this sweep, but sequence-relevant:** if `/orders` is deleted (ROADMAP), do it
**before** removing `"/order"` from the middleware public list, so the prefix-match
side effect in §4.4 never arises.

---

## 7. What becomes unreachable

| Thing | When | Consequence |
|---|---|---|
| The Warehouse board UI | Step 4 | A board that could only ever render empty. No capability lost. |
| The Planning board UI | Step 5 | **A real capability**: creating dispatch plans, assigning vehicles, marking loading complete. It has never been usable end-to-end (nothing feeds it), but the code is a worked design. |
| `components/shared/carried-over-badge.tsx` | Steps 4+5 | Zero remaining users. |
| `lib/slot-cascade.ts`, `lib/day-boundary.ts` | Steps 4+5 | Already dormant; would lose even their imports. |
| `/order`'s public address | Step 3 | Anyone with the link bookmarked gets a dead page unless a redirect to `/po` is left behind. **See §8.** |
| `dispatch_change_queue`-style leftovers | — | None found in this family. |

**No workflow stage, table or column is written exclusively by any surface in this
sweep.** `dispatch_confirmation` is *read* exclusively by these two boards, but since
nothing writes it, retiring them orphans a stage value that was already inert.

---

## 8. Open questions for Smart Flow

**Decisions only you can make:**

1. **Where should `floor_supervisor` and `picker` land at login?** They currently land
   on `/warehouse` via two stubs. `/picking` is the live board for both roles — but
   `picker` holds `picking` canView **only** (`CLAUDE_PICKING.md §1`), so check the
   landing works for them before committing. This blocks retirement step 2.

2. **Retire `/planning`, or keep it?** It is the only surface here that forecloses a
   design rather than removing dead weight. Nothing feeds it today, but the code
   describes how dispatch planning was meant to work. Retiring is reversible only as
   reference (playbook §7).

3. **Leave a redirect at `/order`, or let it 404?** A public link may be in circulation
   — on paper, in WhatsApp, in a dealer's bookmarks. A permanent redirect to `/po`
   costs one line in `next.config.mjs` and is invisible to everyone else. Recommended,
   but it is your call.

4. **How do you want `/order` usage measured before it goes** — hosting logs, a query
   parameter, or simply asking the depot (§4.6)? The database cannot answer it.

**Actions arising, not decisions:**

5. **`CLAUDE_CORE.md` §9 and §13 must be re-corrected** — they currently claim
   `slot-cascade` / `day-boundary` are called. They are not (§3 B1). My error, in
   commit `f6ace5b8`. Should be fixed whether or not any retirement proceeds, because
   a doc that says "these run on every board load" invites someone to reason about
   scheduling that does not happen.

6. **Three SQL queries to run before acting.** None were run.

```sql
-- (a) B3: can the Warehouse / Planning boards EVER show a row?
--     Expect 0. Any non-zero result means something outside this repo writes
--     this stage, and section 3-B3 of this report is wrong.
SELECT "workflowStage", COUNT(*) AS n, MAX("createdAt") AS most_recent
FROM orders
WHERE "workflowStage" IN ('dispatch_confirmation', 'dispatched')
GROUP BY "workflowStage";

-- (b) B2: does any LIVE, ACTIVE user hold floor_supervisor or picker?
--     Covers BOTH the primary-role pointer and the multi-role table.
SELECT u.id, u.name, u.email, u."isActive",
       rm_primary.name  AS primary_role,
       STRING_AGG(rm_extra.name, ', ') AS all_roles
FROM users u
JOIN role_master rm_primary ON rm_primary.id = u."roleId"
LEFT JOIN user_roles ur     ON ur."userId"  = u.id
LEFT JOIN role_master rm_extra ON rm_extra.id = ur."roleId"
WHERE rm_primary.name IN ('floor_supervisor', 'picker')
   OR rm_extra.name   IN ('floor_supervisor', 'picker')
GROUP BY u.id, u.name, u.email, u."isActive", rm_primary.name
ORDER BY u."isActive" DESC, u.name;

-- (c) Jobs A + B: which permission rows exist LIVE for the keys in scope?
--     Seed grants only 'warehouse' (to floor_supervisor + picker) and nothing
--     for the two operations_* keys. Expect live to differ — the Support
--     retirement found 8 live rows where seed predicted 2.
SELECT "roleSlug", "pageKey", "canView", "canEdit", "updatedAt"
FROM role_permissions
WHERE "pageKey" IN ('warehouse', 'planning_board',
                    'operations_warehouse', 'operations_dispatch', 'dispatcher')
ORDER BY "pageKey", "roleSlug";
```

```sql
-- (d) C5: the /order traffic question — UPPER BOUND ONLY, NOT ATTRIBUTION.
--     There is no column recording which surface produced an order (section 4.6).
--     A plain "Order — ..." subject can come from /order, /po OR /place-order.
--     A decorated subject proves it was NOT /order. So:
--       * "could_be_order_page" is a CEILING, not a count of /order orders.
--       * If it is 0, nobody used /order (nor plain /po) in 90 days — decisive.
--       * If it is > 0, this query CANNOT tell you how many were /order.
SELECT
  COUNT(*) FILTER (
    WHERE m.subject NOT ILIKE 'Truck Order%'
      AND m.subject NOT ILIKE 'Bounce Order%'
      AND m.subject NOT ILIKE 'DTS Order%'
      AND m.subject NOT ILIKE 'Cross Billing Order%'
  ) AS could_be_order_page,
  COUNT(*) AS all_orders_90d,
  MAX(m."receivedAt") AS most_recent_any
FROM mo_orders m
WHERE m."receivedAt" >= NOW() - INTERVAL '90 days';
```

---

*Discovery only. Nothing moved, edited or deleted; no SQL run; no code proposed.
Every surface above needs separate approval before any step begins.*

---

# ⚠ CORRECTION + LIVE EVIDENCE — appended 2026-07-27

**This draft is still the working brief for steps 4-6. Nothing above has been
rewritten.** This block records what the live database said after the SQL in §8 was
finally run, and corrects one claim the data disproved. Read this block before acting
on §3.

## 1. The "both boards are always empty" claim is HALF FALSE

§1 (row `/warehouse`), §3-B3, §7 and the `/planning` row at §1 all say the Warehouse
**and** Planning boards can only ever render empty. Live counts, SELECT 2026-07-27:

| Stage | Rows | What it means |
|---|---|---|
| `workflowStage = 'dispatch_confirmation'` | **0** | **Warehouse's conclusion HOLDS** — its board filters on this stage alone (`app/api/warehouse/board/route.ts:76`), so it genuinely cannot populate. |
| `workflowStage = 'dispatched'` | **1,546** | **Planning is NOT always empty.** Its *history* view reads `['dispatch_confirmation','dispatched']` (`app/api/planning/board/route.ts:29-30`), so with `showDispatched=true` it has 1,546 rows to show. |

**Rows `:24` (the `/planning` verdict) and `:454` ("has never been usable end-to-end
— nothing feeds it") are WRONG.** Planning's *live* view is empty; its *history* view
is not. That distinction matters for step 5, because retiring Planning would remove a
surface that can actually display data today.

**How the error got in — worth more than the correction itself.** §3-B3 reasoned from
`lib/workflow-stages.ts:133-135`, a **code comment** claiming "zero production order
has ever reached `'dispatched'`". `docs/ROADMAP.md` had corrected that on **2026-07-24**,
three days before this draft was written. The comment was stale; the draft trusted it
and inherited its error. Both have since been fixed. **A code comment is not evidence
about live data.**

## 2. Live evidence for steps 4-6 (SELECT 2026-07-27)

Recorded here because the steps below will need it and the queries are already run.

**Users holding the two roles — B2 is now PROVEN, and the answer is "yes":**

| User | Role |
|---|---|
| Ramesh K. | `picker` |
| Sunil P. | `picker` |
| Test Floor Supervisor | `floor_supervisor` |

**Three ACTIVE users hold these roles.** §3-B2 left this unproven and step 5 was
scoped as a precaution. It is not — repointing `ROLE_REDIRECTS` before archiving
`/warehouse/supervisor` and `/warehouse/picker` is a **real fix for real logins**.

**`role_permissions`, live:**

| pageKey | roleSlug | canView | canEdit | vs seed |
|---|---|---|---|---|
| `picking` | `picker` | true | **false** | matches |
| `picking` | `floor_supervisor` | true | true | matches |
| `picking` | `operations` | true | true | matches |
| `warehouse` | `admin` | true | true | — |
| `warehouse` | `floor_supervisor` | true | true | matches |
| `warehouse` | `picker` | true | true | matches |
| **`operations_dispatch`** | `operations` | true | true | ⚠ **NOT SEEDED** |
| **`operations_warehouse`** | `operations` | true | true | ⚠ **NOT SEEDED** |

**The two `operations_*` keys have exactly ONE live row each, and neither is in
`prisma/seed.ts`.** Same shape as `operations_support` during the Support retirement:
a hand-made grant that exists only in the live database. **Step 4 must clear both** —
they will not disappear on their own, and a reseed would not create them.

The `picking` grants **match seed exactly**, which retires the "seeded but prod
unverified" caveat that had stood since 2026-07-20.

## 3. The `/order` traffic question — answered by decision, not by data

The query in §8(d) returned **7,693 plain-subject orders out of 7,760** in 90 days.
As that query's own comment warned, this is a **ceiling, not an attribution**: a plain
`"Order — …"` subject can come from `/order`, `/po` **or** `/place-order`, so the
number proves nothing about `/order` specifically. §4.6's conclusion — that the
database *cannot* answer this — held.

The owner resolved it by decision instead: **`/order` was retired 2026-07-27** with
**no redirect**, the address **parked** for future reuse. Full story:
`archive/2026-07-order/README.md`.

## 4. What this block does NOT change

Everything else in this draft stands as written and is still the brief for steps 4-6.
The `/order` work (its step 3) is **done**; §4 is now history rather than a plan. The
`~500 rows that moved to 'dispatched' between 2026-07-24 and 2026-07-27` are **not
investigated here** — that belongs to ROADMAP's `pick_checked → dispatched` drain item.

---

# ✅ CLOSED — appended 2026-07-28

**This brief is finished. Everything it proposed has been carried out.** It is archived
here as the record of how the decisions were reached, not as a live plan. Do not work
from it — work from `archive/RETIREMENT-PLAYBOOK.md` and the per-module READMEs, which
describe what the tree actually looks like now.

## 1. What shipped, in order

| Commit | Date | What |
|---|---|---|
| `83ec3fc1` | 2026-07-27 | **Job A** — `/operations/warehouse` + `/operations/dispatch` archived to `archive/2026-07-operations-pages/`, page keys `operations_warehouse` / `operations_dispatch` removed from `lib/permissions.ts`. |
| `c4323cd4` | 2026-07-28 | **The repoint, done first on purpose** — `ROLE_REDIRECTS` in `lib/rbac.ts` moved `floor_supervisor` and `picker` off the Warehouse stubs and onto `/picking`, **before** anything under Job B was archived. |
| `207e2a5c` | 2026-07-28 | **Job B, part 1** — `/warehouse` + its two stubs + the board API + its components archived to `archive/2026-07-warehouse-board/`; page key `warehouse` removed. 🔴 `app/api/warehouse/pickers/route.ts` was **kept** — it is called by the two live Picking boards and is now the only file left under `app/api/warehouse/`. |
| `639f8139` | 2026-07-28 | **Job B, part 2** — `/planning` + the `/dispatcher` index stub + all 8 `/api/planning/*` routes + components archived to `archive/2026-07-planning-board/`; page keys `planning_board` and `dispatcher` removed. 🔴 The **four live master-data pages** in `app/(dispatcher)/` (Customers / SKUs / Routes / Vehicles) were **kept** — a route group is not a module. |
| `9dce858b` + `de48357d` | 2026-07-27 | **Job C** — `/order` archived to `archive/2026-07-order/`, no redirect, address parked. |

Earlier in the same programme, before this brief was written: `bc42a948`→`63164ed2`
(Support screens and API routes).

**Permission rows.** Every page key removed from `lib/permissions.ts` above leaves
orphaned `role_permissions` rows behind — the code stops reading them, the database
keeps them. Those rows were cleared by the owner in the Supabase SQL editor, separately
from these commits. No SQL was ever run from this session.

## 2. 🔴 The correction block appended on 2026-07-27 was ITSELF WRONG

The block at the top of this appendix — *"The 'both boards are always empty' claim is
HALF FALSE"* — is **the third stale claim in this programme, and it is wrong in the same
way as the two before it.**

It argued that Planning is not always empty because
`app/api/planning/board/route.ts:29-30` reads `['dispatch_confirmation','dispatched']`
when `showDispatched=true`, and 1,546 rows sit at `'dispatched'`. That reading of the
**handler** was accurate. The conclusion was not: `components/planning/planning-page.tsx:137`
was the only caller, and it fetched the board with a date and nothing else. **No client
ever set `showDispatched`.** The branch existed and could never be entered. The board
rendered empty every time it was ever opened — the original claim was right, and the
"correction" broke it.

**The lesson, now in the playbook as its own entry: CAPABILITY IS NOT REACHABILITY.**
Reading a handler tells you what *can* happen. Only the caller tells you what *does*.
This is the sibling of *an import is not a call*, which had bitten this same programme
a week earlier — and note where it landed: **inside a correction block written to fix a
different stale claim.** Fixing one wrong claim is exactly when the next one gets in.

The 1,546 rows are real and the data is intact. What was wrong was the idea that any
screen ever showed them. They are **acknowledged and parked** — the owner intends a
proper lookup as a **report** feature; see ROADMAP, "Dispatched bills have no lookup".

## 3. Where the story lives now

- Method, and every trap that bit: `archive/RETIREMENT-PLAYBOOK.md`
- Index of all five retirements: `archive/README.md`
- Per-module detail: the `README.md` inside each `archive/2026-07-*/` folder
- Remaining follow-ups: `docs/ROADMAP.md`
