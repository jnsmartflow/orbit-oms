# Code discovery — master-data conversion gate: who would lose, who would gain
# 2026-09-06 · READ-ONLY · no application code changed · Lives in: docs/prompts/drafts/

**Type:** `code-discovery` — the GATE before converting the master-data screens and their API
routes from job-title gates to per-user ticks. **No code was written, edited, moved or proposed.**

**Method:** the same shape as `code-discovery-2026-09-06-tint-conversion-gate.md`, which gated the
tint conversion earlier today (`cd0ed055`, `64f897a9`, `74c51869`). Every set membership below was
derived by evaluating the live gate against live rows, not by reading a prior document.

**State verified before anything else:**

| Check | Required | Live | |
|---|---|---|---|
| `74c51869` in `git log -15` | present | present, at tip | ✅ |
| `SELECT value FROM system_config WHERE key='ACCESS_SOURCE'` | `user` | `user` | ✅ |
| `SELECT count(*) FROM user_page_access` | 1053 | 1053 | ✅ |
| `code-update-2026-09-04-user-based-access.md` | exists | exists | ✅ |
| `code-discovery-2026-09-06-tint-conversion-gate.md` | exists | exists | ✅ |

Read-only script: `scripts/_chk-masterdata-gate-20260906.ts` (underscore-prefixed, outside the
`tsc` gate). Every query is a `findMany`. Nothing was written.

---

## 0. The answer in one line

**The premise needs inverting.** The brief says the flag already decides, so deleting the role array
*widens*. That is true as a rule — and on **11 of the 14** master-data API handlers the widening is
**empty**, because on three of the four page keys **nobody but the superuser holds a tick at all**.

The real finding is the opposite one. **On three GET handlers the role array is not a narrowing
filter — it is a BYPASS that admits two named people who hold no tick.** Deleting it there would
**narrow**, and it would cost **Chandresh Kolgha and Priya Chaudhari** their access to the areas,
routes and sub-areas lists.

Two other things fell out of the sweep and matter more than the conversion itself:

- 🔴 **A live defect, created this morning by `64f897a9`.** Prakash gained `manual-entry` POST but
  `manual-entry/lookup` GET still gates on `[TINT_MANAGER, ADMIN]`. The modal calls the lookup
  first. **Manual tint entry is broken for him right now**, and it fails silently. §3.
- **The four `/dispatcher/*` master-data screens are reachable through the UI by nobody**, and 11
  of the 12 master-data pages across the three route groups render the *same component*. §5.

---

## 1. Group A — the master-data trio

### 1a. What is actually left

The four page keys (`customers`, `skus`, `routes_areas`, `vehicles`) are checked in **7 API route
files / 14 handlers** and on **12 pages** across three route groups.

⚠ **Most of the master-data API surface is already converted and the census is stale on it.** Every
`import` and `[id]` sibling moved to `requireSuperuser` on 2026-09-04 (`b915c88e`) — verified file by
file:

| Route family | Gate today |
|---|---|
| `customers/import` · `skus/import` · `vehicles/import` · `routes/import` · `areas/import` · `sub-areas/import` | `requireSuperuser` |
| `skus/[id]` · `vehicles/[id]` · `routes/[id]` · `areas/[id]` · `sub-areas/[id]` | `requireSuperuser` |
| **`customers/[id]`** | **still the 7-role array + flag** — the one `[id]` that was left, because it is the one with non-admin tick holders |

`sub-areas` POST is a **hybrid the census records wrongly**: §2b lists it as `requireRole([ADMIN])`,
but it reads `requireSuperuser(session)` today, followed by a `!== "admin"` bypass and a
`routes_areas`/`canEdit` check that **nothing can reach** — anyone who fails `requireSuperuser` is
already redirected, and anyone who passes it is admitted by `checkPermission`'s own superuser arm.
Dead code, not a gate.

### 1b. The population

Of 39 users (32 active), the master-data arrays and ticks between them touch **14 active people**.
Only **three** hold a tick on any of the four keys.

| Page key | `canView` holders | `canEdit` holders | `canImport`/`canExport`/`canDelete` |
|---|---|---|---|
| `customers` | **Harsh · Chandresh Kolgha · Prakash** | **Harsh · Chandresh Kolgha · Prakash** | Harsh |
| `skus` | **Harsh** | **Harsh** | Harsh |
| `routes_areas` | **Harsh** | **Harsh** | Harsh |
| `vehicles` | **Harsh** | **Harsh** | Harsh |

`role_permissions` (the fallback) agrees: `customers` is granted to `tint_manager` and
`operation_manager`; `skus`, `routes_areas` and `vehicles` are granted to **admin alone**, and
`dispatcher`, `support`, `floor_supervisor`, `picker` and `tint_operator` hold **NONE** on all four.

Active holders of every role named in the arrays:

| Role | Active holders |
|---|---|
| `admin` | Harsh |
| `dispatcher` | Ajay Vansiya · Dhanraj Shah |
| `support` | Priya Chaudhari |
| `tint_manager` | Chandresh Kolgha |
| `tint_operator` | Chandresh Kolgha · Deepak Vasava · Chandrasing Valvi |
| `floor_supervisor` | Test Supervisor 1 · Ravi Yadav · Ravi Valvi · Hitesh Patel · Bipin Mistry · Vinod Sharma |
| `operation_manager` | Prakash |

**14 people pass `requireRole` on the customers routes. Three of them hold the tick.** The other
eleven are stopped by the flag today and would be stopped by the tick tomorrow — which is exactly
why deleting the array changes nothing for them.

### 1c. Group A, handler by handler

**A** = who can act today (role array **and** the flag, evaluated in order).
**B** = who could act after conversion (tick alone, both superuser arms kept).

#### The eleven where the answer is "nothing moves"

| # | Handler | Gate today | A | B | LOSE | GAIN |
|---|---|---|---|---|---|---|
| 1 | `admin/customers/route.ts:93` GET | 7-role array → `!== "admin"` → `customers`/`canView` | Harsh · Chandresh · Prakash | same | **empty** | **empty** |
| 2 | `admin/customers/route.ts:148` POST | same → `customers`/`canEdit` | Harsh · Chandresh · Prakash | same | **empty** | **empty** |
| 3 | `admin/customers/[id]/route.ts:87` GET | same → `customers`/`canView` | Harsh · Chandresh · Prakash | same | **empty** | **empty** |
| 4 | `admin/customers/[id]/route.ts:125` PATCH | same → `customers`/`canEdit` | Harsh · Chandresh · Prakash | same | **empty** | **empty** |
| 5 | `admin/skus/route.ts:30` GET | 6-role array → `!== "admin"` → `skus`/`canView` | **Harsh** | **Harsh** | **empty** | **empty** |
| 6 | `admin/skus/route.ts:75` POST | same → `skus`/`canEdit` | **Harsh** | **Harsh** | **empty** | **empty** |
| 7 | `admin/vehicles/route.ts:11` GET | 6-role array → `!== "admin"` → `vehicles`/`canView` | **Harsh** | **Harsh** | **empty** | **empty** |
| 8 | `admin/vehicles/route.ts:38` POST | same → `vehicles`/`canEdit` | **Harsh** | **Harsh** | **empty** | **empty** |
| 9 | `admin/areas/route.ts:54` POST | 6-role array → `!== "admin"` → `routes_areas`/`canEdit` | **Harsh** | **Harsh** | **empty** | **empty** |
| 10 | `admin/routes/route.ts:38` POST | same → `routes_areas`/`canEdit` | **Harsh** | **Harsh** | **empty** | **empty** |
| 11 | `admin/sub-areas/route.ts:36` POST | `requireSuperuser` → dead `!== "admin"` → `routes_areas`/`canEdit` | **Harsh** | **Harsh** | **empty** | **empty** |

Row 11 is the one place the brief's rule bites in principle: converting it moves the gate from
"superuser" to "anyone holding `routes_areas`/`canEdit`". Today those are the same person, so B is
unchanged — but the *rule* changes, and that is a decision rather than a refactor.

#### 🔴 The three where deleting the array NARROWS

`admin/areas`, `admin/routes` and `admin/sub-areas` each open their GET with a **three-clause**
bypass, not the one-clause shape everywhere else:

```ts
requireRole(session, [ADMIN, DISPATCHER, SUPPORT, TINT_MANAGER, TINT_OPERATOR, FLOOR_SUPERVISOR]);
if (
  session!.user.role !== "admin" &&
  session!.user.role !== ROLES.TINT_MANAGER &&   // ← admits Chandresh with no tick
  session!.user.role !== ROLES.SUPPORT           // ← admits Priya with no tick
) {
  const allowed = await checkPermission(session!.user.role, "routes_areas", "canView");
```

`tint_manager` and `support` **skip the flag entirely**. Neither holds `routes_areas`/`canView` —
nobody but Harsh does.

| # | Handler | A — today | B — `routes_areas`/`canView` | LOSE | GAIN |
|---|---|---|---|---|---|
| 12 | `admin/areas/route.ts:11` GET | Harsh *(bypass)* · **Chandresh Kolgha** *(bypass)* · **Priya Chaudhari** *(bypass)* | Harsh | 🔴 **Chandresh Kolgha, Priya Chaudhari** | empty |
| 13 | `admin/routes/route.ts:11` GET | same three | Harsh | 🔴 **Chandresh Kolgha, Priya Chaudhari** | empty |
| 14 | `admin/sub-areas/route.ts:11` GET | same three | Harsh | 🔴 **Chandresh Kolgha, Priya Chaudhari** | empty |

**These three are the whole of Group A's risk.** Whether the bypass was deliberate is not
recoverable from the code — no comment on any of the three, and the same two names appear in all
three, which reads more like one shape copied twice than three decisions. What can be said from
data: the areas/routes/sub-areas lists are **reference data the customer editor consumes** (a
customer belongs to an area, an area to a route), so a tint manager editing a customer plausibly
needs to read them. If that is the intent, the answer is a `routes_areas`/`canView` **tick** for
Chandresh and Priya, not a preserved role name — but that is a grant, and grants are the owner's.

### 1d. The two questions the brief asked directly

**"Any route where the role array names a role that holds NO tick on that page key?"**
**All of them, and it is the point.** On `skus`, `routes_areas` and `vehicles` every one of the six
named roles except `admin` holds no tick — `dispatcher`, `support`, `tint_manager`, `tint_operator`,
`floor_supervisor`, and on customers also `operation_manager` (who *does* hold customers). Eleven
active people are named by an array and denied by the flag on every one of the 14 handlers. **They
do not lose anything, because they never had it.** The array is decorative on 11 handlers and
load-bearing in the *opposite* direction on 3.

**"Any tick holder NOT in the role array?"**
**None. Zero gains anywhere in Group A.** Checked person by person: `customers`' three holders are
Harsh (`admin` ✓), Chandresh (`tint_manager` ✓) and Prakash (`operation_manager` ✓ — present in the
seven-role array, which is why customers uses seven where the others use six). On `skus`,
`routes_areas` and `vehicles` the only holder is Harsh, and `admin` heads every array.

---

## 2. Group B — the redundant admin bypasses

### 2a. The answer

**No. There is no site where removing the admin bypass would change who gets in — not for the live
superuser set, and not for any session that could exist.**

This is provable from the resolver source rather than from today's data, which is the stronger form:

```ts
// lib/permissions.ts — checkAnyPermission
if (roleSlugs.includes("admin")) return true;      // ← identical to the bypass condition
if (roleSlugs.length === 0) return false;
const access = await sessionAccess();
if (access.isSuperuser) return true;               // ← the flag arm

// lib/permissions.ts — checkPermission
if (roleSlug === "admin") return true;             // ← identical to the bypass condition
const access = await sessionAccess();
if (access.isSuperuser) return true;
```

The bypass tests **the same value, by the same test**, that the resolver's own first line tests. The
wrapper can only skip a call that would have returned `true` anyway.

**The hypothetical the bypass was feared for does not bite either.** `CLAUDE_CORE.md §13` warns that
*"a superuser who is not ALSO role-admin would fall through into the permission check instead of
bypassing it, and would be denied wherever their ticks do not cover the page."* Read against the
source, that is **not true**: such a person falls into the resolver and is admitted by the
`isSuperuser` arm two lines later. The warning describes a risk that the 2026-09-04 resolver change
had already closed. Removing the bypasses is safe today **and** safe for the second superuser
nobody has created yet.

Confirmed against live data as well: exactly **one** superuser exists — **Harsh (u1)**, active,
`isSuperuser = true` **and** `admin` in his role set. Both arms fire for him at every site.

### 2b. The count, corrected

The census's "22" counted **mutating routes only**, excluded tint's 12, and predates both the
2026-09-04 admin conversion and today's tint work. Swept fresh across `app/**`:

| Shape | Sites |
|---|---|
| `if (!roles.includes("admin")) { … }` — merged role set | **54** |
| `if (session.user.role !== "admin") { … }` — singular primary | **27** |
| **Total bypass-then-check sites** | **81** |

Of the 27 singular, **9 are multi-clause and are NOT redundant** — they bypass for more than admin:

| Sites | Extra names bypassed | Redundant? |
|---|---|---|
| `admin/areas` · `admin/routes` · `admin/sub-areas` GET (3) | `tint_manager`, `support` | 🔴 **No** — §1c rows 12-14 |
| `reports/tint-summary:33` · `tint/manager/marker:65` · `missing-customers:14` · `operators:12` · `orders:97` · `ti-report:19` (6) | `operations` | 🔴 **No** — §3 |

**So: 72 of the 81 are purely redundant and provably safe to delete. 9 are not bypasses at all —
they are permission grants written as role names, and every one of the 9 changes somebody today.**

### 2c. One thing the bypasses still do

They read the **singular primary role** at 27 sites while `requireRole` beside them reads the
**merged** set. A person holding `admin` as a *secondary* role passes `requireRole` and then fails
`role !== "admin"`, falling into the flag check — where `checkPermission` is handed their *primary*
slug. Live impact today: **none**, because nobody holds admin as a secondary role (verified: the
only admin-touching account is Harsh, whose primary *is* admin). It is the same trap the 09-04
work found and fixed in the two layout resolvers.

---

## 3. Group C — the tint GETs left behind

Today's tint conversion moved 19 writes + 2 reads. **Nine manager GETs and two `tinter-issue` GETs
were left on job titles**, by scope, not by decision.

| # | Handler | Gate today | A — today | B — the tick | LOSE | GAIN |
|---|---|---|---|---|---|---|
| 1 | `manager/marker:62` GET | 4-role array → `!== admin && !== OPERATIONS` → `tint_manager`/`canView` | Harsh · **Operations User** · Chandresh · Prakash | Harsh · Chandresh · Prakash | **Operations User** | empty |
| 2 | `manager/missing-customers:11` GET | same | same four | same three | **Operations User** | empty |
| 3 | `manager/operators:9` GET | same | same four | same three | **Operations User** | empty |
| 4 | `manager/orders:94` GET | same | same four | same three | **Operations User** | empty |
| 5 | `manager/ti-report:16` GET | same | same four | same three | **Operations User** | empty |
| 6 | `manager/challans:11` GET | 4-role array, **no flag** | same four | same three | **Operations User** | empty |
| 7 | `manager/challans/[orderId]:24` GET | 4-role array, **no flag** | same four | same three | **Operations User** | empty |
| 8 | `manager/orders/[id]/splits:8` GET | 4-role array, **no flag** | same four | same three | **Operations User** | empty |
| 9 | **`manager/manual-entry/lookup:23` GET** | **`[TINT_MANAGER, ADMIN]`** | Harsh · Chandresh | Harsh · Chandresh · **Prakash** | **empty** | 🔴 **Prakash** |
| 10 | `operator/tinter-issue/[id]:11` GET | `hasRole([TINT_OPERATOR, ADMIN, OPERATIONS])` | Harsh · **Operations User** · Chandresh · Deepak · Chandrasing | Harsh · Chandresh · Deepak · Chandrasing | **Operations User** | empty |
| 11 | `operator/tinter-issue-b/[id]:11` GET | same | same five | same four | **Operations User** | empty |

*(`manager/orders/[id]/pause-history` and `skip-history` are NOT in this list — both already gate on
`checkAnyPermission(roles, "tint_manager", "canView")` with an admin bypass and no role array.)*

### 3a. 🔴 Row 9 is a live defect, and it shipped this morning

`64f897a9` converted `manager/manual-entry` POST to `tint_manager`/`canEdit`, which **added
Prakash** — an intended, owner-approved gain. It did **not** touch `manual-entry/lookup` GET, which
still requires `[TINT_MANAGER, ADMIN]` and therefore **excludes him**.

The modal calls them in that order:

```
components/tint/manual-tint-entry-modal.tsx:150   GET  /api/tint/manager/manual-entry/lookup?obd=…
components/tint/manual-tint-entry-modal.tsx:188   POST /api/tint/manager/manual-entry
```

Prakash is stopped at line 150. He never reaches 188. **The gain is unusable — manual tint entry is
broken for him.**

**And it fails silently.** `requireRole` calls `redirect()`, which is a 307 that `fetch` follows to
`/unauthorized`; the HTML response fails `res.json()` and lands in the modal's own catch at `:168`
(`console.error("[manual-entry] fetch failed")`). He gets an empty modal and a console line nobody
reads — not a permission error.

**Reverting is not the fix.** Widening the POST was the owner's decision (gate report §3). The lookup
GET should follow it to `tint_manager`/`canView`, which Prakash holds. `manual-entry/revert` is
unaffected — `manual-tint-revert-modal.tsx:91` posts directly and calls no lookup.

### 3b. Is the read/write split defensible on the three GET/PATCH files?

`challans/[orderId]`, `tinter-issue/[id]` and `tinter-issue-b/[id]` now each have a GET admitting
`operations` by title beside a PATCH that does not.

**As a rule, yes — read and write are separate questions, and that is the whole point of splitting
`canView` from `canEdit`.** As an *instance*, no: it is not expressing a decision that operations
may read but not write. It is expressing that reads were out of scope this morning. The evidence is
that the split lands inconsistently — `pause-history` and `skip-history` are reads on the same board
and are already tick-gated, so `operations` cannot read those. **A person who can read a challan but
not a pause history has not been given a coherent read permission; they have been given the residue
of two different conversion dates.**

Live effect of leaving it: **Operations User can still read eight tint manager endpoints and two
tinter-issue endpoints by direct HTTP call**, while holding no `tint_manager` or `tint_operator`
tick and being redirected by both tint layouts. Same shape as the gap the tint conversion closed on
the write side, one layer down.

---

## 4. What must keep the job title

The tint gate found nine FACE sites. **Here there are none.** Checked and rejected:

- **`ROLE_HREF_OVERRIDES` (`lib/permissions.ts:112-136`) looked like the obvious candidate** — one
  `customers` tick resolving to three different URLs by job title is textbook "which version of the
  screen", and census §9 item 1 left it open. **The code says otherwise. 11 of the 12 master-data
  pages render the SAME component:**

  | Page | Component |
  |---|---|
  | `/admin/customers` | `CustomersSplitView` |
  | `/tint/manager/customers` | **`CustomersSplitView`** — the same one |
  | `/dispatcher/customers` | `CustomersTable` |
  | all nine `skus` / `routes` / `vehicles` pages, all three groups | `SkusTable` · `RoutesTable` · `VehiclesTable` — identical per key |

  ⚠ **`CLAUDE_CORE.md §5` is wrong on this.** It says *"`/admin/customers` uses the richer split
  view, the other three the same tables."* `/tint/manager/customers` uses the split view too. The
  only page that differs from its siblings is `/dispatcher/customers` — and §5 is describing an
  override list whose sole real variation is on a screen nobody can reach (§5 below).

  So there is no face to preserve: the three route groups are **duplication, not variation**. The
  href override decides which *copy* of an identical screen you land on.

- **`(dispatcher)/layout.tsx`** — a bare `return <>{children}</>` with no session read at all. Not a
  gate, not a face.
- **`(admin)/admin/layout.tsx:15`** — `requireSuperuser(session)`. A permission question already
  converted, and it means every page-level `checkPermission` under `/admin/*` is unreachable
  second-guessing: nobody who fails the layout ever reaches the page, and nobody who passes it fails
  the page check.
- **The 9 multi-clause bypasses (§2b)** — permission grants written as role names, not faces. They
  answer "may this person", which a tick answers.

**Nothing in Group A, B or C needs to keep a job title.**

---

## 5. The four `/dispatcher` screens — settled

**Question:** the 08-28 discovery found `dispatcher` holds `canView = false` on all four
master-data keys, yet `/dispatcher/customers`, `/skus`, `/routes` and `/vehicles` exist for that
role. Are they reachable by anyone?

**Answer: through the UI, by nobody. By typing the URL, only by people for whom a different copy of
the same screen is the one their sidebar actually offers.**

Three independent facts, each verified:

**1 — `(dispatcher)/layout.tsx` has no gate.** It is five lines: `export const dynamic`, and a
component returning `{children}`. So each page's own check is the only gate.

**2 — No sidebar anywhere links to them.** `buildNavItems` includes an entry only when
`allPerms[pageKey].canView === true`, *then* applies `ROLE_HREF_OVERRIDES`. The override maps
`dispatcher` → `/dispatcher/customers` etc., but **no dispatcher-role user holds any of the four
ticks** — Ajay Vansiya and Dhanraj Shah hold none. The four `/dispatcher/*` hrefs are therefore
generated **for nobody**. The three people who *do* hold a tick are sent elsewhere by their own
primary role: Harsh (`admin`, no override) → `/admin/customers`; Chandresh (`tint_manager`) and
Prakash (`operation_manager`) → `/tint/manager/customers`.

**3 — By URL, evaluated per page:**

| Screen | Its own gate | Who gets in |
|---|---|---|
| `/dispatcher/customers` | `if (role !== "admin") checkPermission(role, "customers", "canView")` | **Harsh, Chandresh Kolgha, Prakash** |
| `/dispatcher/skus` | `checkPermission(role, "skus", "canView")`, unconditional | **Harsh only** |
| `/dispatcher/routes` | `checkPermission(role, "routes_areas", "canView")`, unconditional | **Harsh only** |
| `/dispatcher/vehicles` | `checkPermission(role, "vehicles", "canView")`, unconditional | **Harsh only** |

*(Harsh gets into the last three via `checkPermission`'s own `roleSlug === "admin"` short-circuit,
not via a tick — though he holds the ticks too.)*

**Neither user holding the `dispatcher` role can reach any of the four.** The route group is named
for a role that cannot open it.

**Consequence for the conversion:** these four pages are the cheapest thing in this report to
retire, and retiring them removes the only real variation `ROLE_HREF_OVERRIDES` has
(`CustomersTable` vs `CustomersSplitView`, §4) — which would collapse the override list for
master data to nothing. That is ROADMAP step 7/8 territory (census §9 item 1) and an owner
decision, recorded here because this sweep is what settles the premise it was waiting on.

---

## 6. What this gate settles, and what it does not

**Settled, from live data:**

- Group A is **14 handlers in 7 files**, not the larger block the census implies — every `import`
  and `[id]` sibling is already `requireSuperuser`, `customers/[id]` excepted.
- **11 of the 14 move nobody.** Zero gains anywhere in Group A.
- **Three GETs would LOSE Chandresh Kolgha and Priya Chaudhari** — the only real risk in the group.
- Group B: **81 bypass sites, 72 provably redundant, 9 that are grants in disguise.** Removing a
  redundant one cannot change who gets in, for any session, not merely today's.
- Group C: **Operations User** on 10 of the 11 tint GETs; **Prakash** gains the eleventh.
- The four `/dispatcher` screens are UI-unreachable by everyone.
- **No FACE sites.** Nothing here needs to keep a job title.

**Not settled — owner decisions, stated as questions, not answered:**

1. **Were the three `tint_manager`/`support` bypasses on the routes/areas GETs deliberate?** If the
   intent is that a tint manager reads reference data while editing customers, the answer is a
   `routes_areas`/`canView` tick for Chandresh and Priya — a grant, not a code change.
2. **Should `sub-areas` POST stay superuser-only, or become `routes_areas`/`canEdit` like its five
   siblings?** Same person either way today; a different rule tomorrow.
3. **Do the four `/dispatcher` screens get retired?** Nothing reaches them and one of them is the
   last thing making `ROLE_HREF_OVERRIDES` non-trivial for master data.
4. **`manual-entry/lookup` (§3a) is not a question — it is a live defect** and the only item here
   that should not wait for a conversion session.

---

*Discovery only. No application code was written, edited, archived or moved. No conversion was
written and none is proposed. One read-only query script was added at
`scripts/_chk-masterdata-gate-20260906.ts` (underscore-prefixed, outside the `tsc` gate per
`tsconfig.json`'s `exclude`). Where a prior document is quoted it is named and checked — two were
found stale and are corrected in place above (`CLAUDE_CORE.md §5` on the customers split view,
census §2b on `sub-areas` POST).*
