# Gate — Mail Orders permission fix: who would be blocked
# 2026-09-01 · READ-ONLY · no code written, no file edited except this one · Lives in: docs/prompts/drafts/

**The question.** Eleven Mail Orders write routes check only "is there a session". The fix adds the
`checkAnyPermission(roles, "mail_orders", "canEdit")` block that 37 other write routes already carry.
Adding a check can take away access. **Who loses it?**

**Answer, up front: nobody. The blocked-by-name list is EMPTY.** All six people who can reach the
Mail Orders screen today also hold `canEdit` live. Details and the one caveat in §1/§2.

**Method.** One read-only `SELECT` against production via `scripts/_chk-mo-gate-20260901.ts`
(`role_permissions` filtered to `pageKey='mail_orders'`, joined to `users` and `user_roles` through
`role_master`). No INSERT/UPDATE/DELETE/ALTER issued. Every call site in §3 was OPENED, not grepped —
where a grep hit turned out to be a prop-thread rather than an invocation, it is reported as a zero.

Files read: `CLAUDE.md`, `docs/CLAUDE_CORE.md` (v94, Schema v27.15), `docs/CLAUDE_UI.md` (v5.18),
`docs/CLAUDE_MAIL_ORDERS.md` (v1.12, Schema v27.15, Parser v7.3.0, Enrichment v3),
`docs/prompts/drafts/code-discovery-2026-08-30-permission-actions.md`,
`docs/prompts/drafts/code-discovery-2026-08-31-role-census.md`,
`app/api/billing/mail-order/actions/route.ts`.

---

## 1. Who holds Mail Orders rights, live

### The grid — read-only SELECT, 2026-09-01

```
=== role_permissions WHERE pageKey='mail_orders' : 4 rows ===
roleSlug           View  Import Export Edit  Delete
billing_operator   true  false  false  true  false
operation_manager  true  false  false  true  false
operations         true  false  false  true  false
tint_manager       true  false  false  true  false
```

Four rows. Every one is `canView=true` AND `canEdit=true`. No `canImport` / `canExport` /
`canDelete` grant exists on this page key for any role. `admin` holds no row and does not need one —
`checkAnyPermission` short-circuits on `roleSlugs.includes("admin")` before the table is read.

### 🔴 The `tint_manager` ruling — CORE §5 and MAIL_ORDERS §22 are BOTH WRONG

> `CLAUDE_CORE.md §5`: *"`mail_orders` | … tint_manager (**view only**, previously undocumented)"*
>
> `CLAUDE_MAIL_ORDERS.md §22`: *"| `tint_manager` | true | **false** (view-only) |"*, and again under
> "Facts this grant surfaced": *"`tint_manager` holds a **view-only** `mail_orders` grant"*.

**Live says `tint_manager` holds `canEdit = TRUE`.** The 2026-08-30 report's grid is correct; the two
canonical docs are stale. Both were last stamped against a SELECT of 2026-08-04, so the row was either
flipped after that date or the 08-04 reading was wrong. Which of those it is, is a doc correction and
out of scope here.

⚠ **This matters to the gate in the opposite direction to the obvious one.** The docs say Chandresh
Kolgha (u21, `tint_manager`) is view-only. He is not. If anyone "corrects" the DB row to match the
docs *and* the eleven routes get the `canEdit` check, **Chandresh loses every Mail Orders write in the
same stroke** — and today he loses nothing, because nothing server-side has ever enforced view-only on
this module (`MAIL_ORDERS §18`: *"view-only is a UI illusion only"*). **Fix the routes or fix the row —
never both in one session without asking whether Chandresh is meant to keep editing.**

### The named, active people

`users`: 38 rows, 32 active. Joined through `users.roleId` (primary) **and** `user_roles` (secondary).

**Holding `mail_orders` canView — 6 people, all ACTIVE:**

| User | Roles (primary + secondary) | canView | canEdit |
|---|---|---|---|
| u1 Harsh | `admin` | ✅ (bypass) | ✅ (bypass) |
| u20 Operations User | `operations`, `logistics` | ✅ | ✅ |
| u21 Chandresh Kolgha | `tint_manager`, `tint_operator` | ✅ | ✅ |
| u25 Deepanshu Thakur | `billing_operator` | ✅ | ✅ |
| u26 Bankim | `billing_operator` | ✅ | ✅ |
| u32 Prakash | `operation_manager`, `floor_access` | ✅ | ✅ |

**Holding `mail_orders` canEdit — the same 6 people.** The two sets are identical.

No inactive user holds either. No secondary role delivers `mail_orders` to anyone — every one of the
six gets it from their PRIMARY role (consistent with the role-census §7a finding that the only things
a secondary row delivers today are `trip_report` and `floor`).

---

## 2. 🔴 WHO WOULD BE BLOCKED — **EMPTY**

```
🔴 === WOULD BE BLOCKED: canView TRUE, canEdit FALSE === 🔴
  (none)
  blocked ACTIVE count: 0
```

**Empty.** Not one person — active or inactive — can reach the Mail Orders screen without also holding
`canEdit`. Adding the check to all eleven routes takes access away from **nobody**, and nobody starts
seeing errors behind buttons that used to work.

The reason is structural, not luck: all four `mail_orders` rows are `View+Edit` together, so the
"canView without canEdit" population on this page key is empty **at the role level**, before you even
get to people. The 08-30 report already established that the app-wide canView-without-canEdit set is
five non-admin rows (`logistics`/`trip_report`, `ops_admin`/`attendance_admin`, `picker`/`picking`,
`operation_manager`/`ti_report`, `tint_manager`/`ti_report`) — **none of them is `mail_orders`.**

**What this gate does NOT clear:** the fix closes a real hole. Today **any logged-in user of any role**
— every picker, every tint operator, the logistics user, both ops_admins — can PATCH/POST Mail Orders
data by calling these URLs directly (`CORE §13` security entry, `MAIL_ORDERS §18`). That population is
32 active users. After the fix it is 6. Nobody who *uses the screen* loses anything; 26 people who
were never supposed to write lose a capability they were never given a button for.

---

## 3. Who actually calls these eleven routes

Every client write goes through the wrapper module `lib/mail-orders/api.ts` — one thin `fetch` per
route — except `split`, which two components fetch directly. **`re-enrich`, `backfill-customers` and
`backfill-enrich` have no wrapper and no fetch anywhere.**

| # | Route | Method | Callers | Verdict |
|---|---|---|---|---|
| 1 | `mail-orders/[id]/customer` | PATCH | **1** | live |
| 2 | `mail-orders/[id]/lock` | PATCH | **1** | live |
| 3 | `mail-orders/[id]/note` | PATCH | **1** | live |
| 4 | `mail-orders/[id]/punch` | PATCH | **0** | 🔴 **dead prop — see 3.4** |
| 5 | `mail-orders/[id]/so-number` | PATCH | **1** | live — this is the real punch |
| 6 | `mail-orders/[id]/split` | POST | **2** | live |
| 7 | `mail-orders/lines/[lineId]/resolve` | POST | **2** | live |
| 8 | `mail-orders/lines/[lineId]/status` | PATCH | **4** | live |
| 9 | `mail-orders/re-enrich` | POST | **0** | tool |
| 10 | `mail-orders/backfill-customers` | POST | **0** | tool |
| 11 | `mail-orders/learn-customer` | POST | **1** | live (fire-and-forget) |
| — | `mail-orders/backfill-enrich` | GET | **0** | tool — unauthenticated |

### 3.1 `[id]/customer` PATCH — 1 caller

`lib/mail-orders/api.ts:85` `saveCustomer()` ← `mail-orders-page.tsx:789`, inside
`handleSaveCustomer` (`:763`). Passed down as `onSaveCustomer` to **both** view modes —
`mail-orders-table.tsx` (`:1358`) and `review-view.tsx` (`:1468`). The customer-picker save in each.
On failure it refetches the day and drops the optimistic row back (`:799-801`).

### 3.2 `[id]/lock` PATCH — 1 caller

`api.ts:112` `toggleLock()` ← `mail-orders-page.tsx:599`, inside `handleFlag` (`:585`). Three entry
points into that one handler: the flag button in Table mode (`mail-orders-table.tsx:1120` and `:1127`,
both `onClick → onFlag(order.id)`), the flag button in Review mode (`review-view.tsx:1974`), and the
keyboard shortcut (`mail-orders-page.tsx:1044`).

### 3.3 `[id]/note` PATCH — 1 caller

`api.ts:124` `saveNotes()` ← `review-view.tsx:928`. **Review View only** — Table mode has no notes
field. Failure path is `console.error` (`:936`) with no user-visible message.

### 3.4 🔴 `[id]/punch` PATCH — **ZERO callers. Explicit zero.**

The chain exists and dead-ends:

```
api.ts:22  punchOrder()               ← the only fetch
  ← mail-orders-page.tsx:630          inside handlePunch (:612)
  ← mail-orders-page.tsx:1465         passed as onPunch={handlePunch} to <MailOrdersTable>
  ← mail-orders-table.tsx  :49 type · :118 destructure · :219 forward
                           :258 · :286 · :331 forward again
                           :629 destructured at the leaf row component
  ← ✗ NEVER INVOKED. No `onPunch(` anywhere in the tree.
```

`grep -n "onPunch(" mail-orders-table.tsx` → **no results**. `grep -n "handlePunch(" mail-orders-page.tsx`
→ **no results**. The prop is threaded through four component levels and dropped on the floor.
(`review-view.tsx:832 handlePunchClick` is a different function — it calls `onSaveSoNumber`, not
`onPunch`.)

**Punching actually happens through `[id]/so-number`**, which sets the status itself
(`so-number/route.ts:43-51`): `soNumber`, `status: "punched"`, `punchedAt`, `punchedById`. The
`[id]/punch` route is a reachable, session-only, unattributed write with no button behind it.

This does not change the fix — copy the block into it anyway, it is a live URL — but **do not spend
time testing a punch button for it; there isn't one.** Whether the route should be retired instead is
an owner decision, not this gate's.

### 3.5 `[id]/so-number` PATCH — 1 caller

`api.ts:53` `saveSoNumber()` ← `mail-orders-page.tsx:711`, inside `handleSaveSoNumber` (`:682`).
Passed as `onSaveSoNumber` to Table (`:1357`) and Review (`:1467`). In Review it is reached by
`handlePunchClick` (`review-view.tsx:832`) — the SO-number box, buttons at `:1582` and `:1633`, plus
Enter (`:857`). **This is the busiest write on the screen and the one that punches.**

### 3.6 `[id]/split` POST — 2 callers, both direct `fetch` (no wrapper)

- `mail-orders-table.tsx:1517` in `handleSplit` (`:1515`) — button at `:1565`.
- `review-view.tsx:946` in `handleSplitClick` (`:941`) — button at `:2892`.

Both post `{ groups: [groupA.lineIds, groupB.lineIds] }` and call `onSplitComplete` on success. Both
swallow a non-OK response into `console.error` — a 403 would show as the split silently not happening.

### 3.7 `lines/[lineId]/resolve` POST — 2 callers

`api.ts:40` `resolveLine()` ←
- `resolve-line-panel.tsx:103`, inside `handleSave()` (`:98`) — the resolve panel's Save, and the only
  path that passes `saveKeyword: true`.
- `review-view.tsx:1215`, inside `handleResolveLine` (`:1207`) — always `saveKeyword: false`.

### 3.8 `lines/[lineId]/status` PATCH — 4 callers

`api.ts:164` `saveLineStatus()` ←
- `mail-orders-table.tsx:734` and `:760` (the two not-found / alt-SKU arms in Table mode)
- `review-view.tsx:1170` (`{ found: true }` — clear) and `:1195` (`{ found: false, reason }` — set)

### 3.9 `re-enrich` POST — **ZERO callers. Explicit zero.** → §4

### 3.10 `backfill-customers` POST — **ZERO callers. Explicit zero.** → §4

### 3.11 `learn-customer` POST — 1 caller, fire-and-forget

`api.ts:143` `learnCustomer()` ← `mail-orders-page.tsx:796`, fired only when the order it just saved a
customer onto was `unmatched` or `multiple`. **The wrapper has its own try/catch that swallows
everything into `console.error` (`api.ts:145-147`)** — so after the fix a 403 here is completely
invisible, and the only symptom is that the learned-keyword engine quietly stops learning. Same
behaviour before and after; the fix does not make it worse for the six who hold `canEdit`.

---

## 4. The three tool routes — live or abandoned?

None of the three is reachable from any button, link, menu item, or keyboard shortcut. A repo-wide
sweep for each string across `app/`, `components/`, `lib/`, `scripts/`, `prisma/`, `middleware.ts`,
`vercel.json` and every `.ps1` returns **zero call sites** — the only hits outside the route files
themselves are `.next/types/**` (generated build stubs, not code) and `docs/archive/context-bases/**`
(historical session notes).

### `re-enrich` — POST, session-only

**Reachable only by hand-writing a `fetch` in devtools.** Not by typing the address: it exports POST
only, so a browser GET returns 405.

**Not marked TEMPORARY.** Its source carries no such comment. It is the *current* re-enrichment tool —
the archived notes are explicit that it superseded `backfill-enrich`:

> `docs/archive/context-bases/CLAUDE_CONTEXT_v56.md:177` — *"22. **Backfill endpoint:**
> `/api/mail-orders/backfill-enrich` -- DEPRECATED for re-enrichment. Use `/api/mail-orders/re-enrich`
> instead (v2, all 8 args)."*
>
> `…v55.md:244` — *"`fetch('/api/mail-orders/re-enrich', { method: 'POST' })`"* — the recorded way to
> run it: paste into the console.

**Verdict: still doing a job.** It is the maintained tool for re-running enrichment after a keyword or
SKU-lookup change, it uses the current engine with all arguments, and `marker/route.ts:33` lists it
among the eleven write paths the live-sync marker is trusted to cover. It has no UI **by design** — an
operator was never meant to fire a 300-second bulk re-enrich from a button.

### `backfill-customers` — POST, session-only

**Reachable only by hand-writing a `fetch`.** POST only, so the address alone does nothing.

⚠ **Correction to the brief: there is no "TEMPORARY" comment in this file.** `route.ts` is 60 lines
and contains **zero** comments — a `grep -in "temporary|one-time|delete after|deprecated"` over it
returns nothing. The TEMPORARY label is real but lives *outside* the source:

> `CLAUDE_CORE.md §13` — *"**One-time backfill endpoints** (keep for emergency): … `POST
> /api/mail-orders/backfill-customers` — marked TEMPORARY"*
>
> `docs/archive/context-bases/CLAUDE_CONTEXT_v45.md:188` — *"**TEMPORARY v45.** One-time backfill —
> runs customer matching on all existing unmatched orders. Delete after confirming production works."*
>
> `…v45.md:67` — *"`app/api/mail-orders/backfill-customers/route.ts` is a temporary endpoint, delete
> after confirming customer matching works in production."*

**Verdict: leftover, deliberately kept.** Its stated job — one-time backfill of customer matching on
historical unmatched orders — finished long ago; CORE §13 files it under "keep for emergency". It
re-runs `matchCustomer` over every `mo_orders` row whose `customerMatchStatus` is null or `unmatched`,
so it stays useful as a repair tool after a customer-master change. Not abandoned, not routine.

### `backfill-enrich` — POST is HMAC; **GET is the security entry**

**The GET is reachable by typing the address into a browser** — and that is the whole problem.

Its own source, `app/api/mail-orders/backfill-enrich/route.ts:161-162`:

```ts
// TEMPORARY — delete after backfill
export async function GET() {
  try {
    const result = await runBackfill();
```

**This is the one file of the three that really does carry the comment.** The POST above it
(`:142-160`) verifies an HMAC over the body (`MAIL_ORDER_HMAC_SECRET`, `verifyHmac` at `:17-27`); the
GET calls the identical `runBackfill()` with **no session check, no HMAC, no check of any kind**.
`runBackfill()` reads all three keyword/SKU tables and writes across `mo_order_lines` plus the
`matchedLines`/`totalLines` counters on `mo_orders`.

Both canon files already record it and both are still accurate:

> `CLAUDE_CORE.md §13` — *"**SECURITY — `GET /api/mail-orders/backfill-enrich` is fully
> unauthenticated** — no session check, no HMAC. Marked `TEMPORARY — delete after backfill` in its own
> source but still live. Performs a bulk write across `mo_order_lines`. Reachable by anyone with the
> URL. Surfaced 2026-07-10, not fixed."*
>
> `CLAUDE_MAIL_ORDERS.md §18` — the same entry, same date, same "not fixed".

**Verdict: leftover, and superseded.** It runs the **v1** enrichment (six arguments, no
`productProfiles`), which `CONTEXT_v56.md:113-116` warns against by name: *"NOTE: The old
backfill-enrich endpoint still exists at `app/api/mail-orders/backfill-enrich/route.ts` but uses v1
… **Do NOT use it for re-enrichment. Always use `/api/mail-orders/re-enrich`.**"* Live enrichment is
v3. So the unauthenticated GET is not only open, it writes **worse** data than the tool that replaced
it.

⚠ It is not in the eleven and **the `canEdit` copy does not fix it** — a permission check needs a
session, and this handler never calls `auth()`. It is a separate decision: delete the GET, or gate it.
Flagged here, not fixed here.

---

## 5. The reference pattern, quoted exactly

`app/api/billing/mail-order/actions/route.ts:66-77` — the whole guard, verbatim:

```ts
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // canEdit — these are writes. Admin bypass is inside checkAnyPermission.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "mail_orders", "canEdit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

with the import at `:3`:

```ts
import { checkAnyPermission } from "@/lib/permissions";
```

### It uses `checkAnyPermission` — and that is the right one

`checkAnyPermission` (`lib/permissions.ts:241-255`) takes **all** the user's roles
(`session.user.roles ?? [session.user.role]`) and admin-bypasses on `roleSlugs.includes("admin")`
(`:246`). `checkPermission` (`:226-239`) takes **one** slug — callers pass `session.user.role`, the
primary only — and would deny a user whose grant sits on a secondary role.

**Use `checkAnyPermission`. Do not use `checkPermission`.** It makes no difference to the six people
in §1 (all six get `mail_orders` from their primary role), but `checkPermission` would be a latent
trap the first time anyone is granted `mail_orders` as a secondary role — exactly the split recorded
in the 08-30 report and in `code-discovery-2026-08-28-admin-panel.md §6c`. Every route built since
Floor uses `checkAnyPermission`; all 37 correct write routes follow this shape.

There is no `roles.includes("admin")` pre-check in this pattern (MRN's export/delete routes wrap one
around the call). It is redundant — the bypass is inside the helper — so copy the block as it stands.

---

## 6. Anything that would make the copy unsafe

**None found**, on every criterion asked:

| Risk | Finding |
|---|---|
| Called by a cron | **No.** `vercel.json` declares exactly two crons — `/api/cron/attendance-rollover`, `/api/cron/attendance-purge`. Neither touches Mail Orders. |
| Called by an external script | **No.** All 18 `.ps1` files in the repo were swept: not one references `mail-orders`. `Parse-MailOrders-V7.ps1` makes two HTTP calls — a GET to the keywords URL (`:310`) and its POST to `$ApiBaseUrl` (`:2089`), which is `ingest` (HMAC, deliberately exempt, not in the eleven). The Auto-Import scripts hit `/api/import/obd` only. |
| Called by the PowerShell parser | **No** — same sweep. The parser's only two Mail Orders surfaces are `keywords` (deliberately public) and `ingest` (HMAC). Both are outside the eleven and untouched by the fix. |
| Called before a session exists | **No.** All eleven already open with `const session = await auth(); if (!session?.user) return 401`, at the top of the handler in every file. The new block goes immediately after an existing 401 that already runs. |
| Carries its own ownership check that would conflict | **No.** Not one of the eleven has an ownership guard. Four read `session.user.id` and **write it as the actor**, never compare it: `punch:15→34 punchedById`, `so-number:41→49 punchedById`, `lines/[lineId]/status:50→60,69 updatedBy`, `learn-customer:39 operatorId`. Nothing to conflict with. (Contrast `tint/operator/skip`, which does hold an ownership check — it is not in scope.) |

### Three things to know before writing the fix — none of them blocking

1. **`[id]/punch` has no button (§3.4).** Gate it anyway, but a smoke test of "the punch button" will
   be testing `so-number`. Say so in the commit message so the next reader isn't misled.
2. **A 403 will be silent on five of the eleven.** `note` (`review-view.tsx:936`), `split` (both call
   sites), `line status`, and `learn-customer` (`api.ts:145`) swallow failures into `console.error`
   with no user-visible message; the four handlers in `mail-orders-page.tsx` refetch and visibly revert
   the optimistic row, also with no message. Since §2 is empty this affects nobody who uses the screen
   today — but if a grant is ever narrowed, the symptom will be "the button does nothing", not an
   error. Whether to add an error banner is a separate UI decision, not part of the copy.
3. **The `tint_manager` doc/live conflict (§1) is a loaded gun.** The docs say view-only, live says
   edit. Fixing the routes is safe today *because live says edit*. Do not let a doc-correction session
   "fix" the row to match the prose without deciding, out loud, whether Chandresh keeps editing Mail
   Orders. Settle §1 in the docs — CORE §5 and MAIL_ORDERS §22 both — before or with the route fix.

---

*Gate only. No application code was written, edited, archived or moved. One read-only query script
was added at `scripts/_chk-mo-gate-20260901.ts` (underscore-prefixed, outside the `tsc` gate per
`tsconfig.json`'s `exclude`). No fix is proposed here.*
