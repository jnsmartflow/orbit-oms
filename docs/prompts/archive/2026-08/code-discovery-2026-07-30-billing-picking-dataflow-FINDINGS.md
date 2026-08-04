# Discovery — Billing/Picking data flow + rollout gating — FINDINGS
# 2026-07-30 · READ-ONLY diagnosis · no code, no SQL, no schema change proposed
# Lives in: orbit-oms/docs/prompts/drafts/

Diagnosis only. Every claim below cites the file and function that proves it. Where a thing could not
be proved from the repo, it is marked **UNVERIFIED** with the exact check needed — it is not asserted.

---

## ⚠ 0. TWO THINGS TO READ BEFORE THE TABLE

### 0.1 The design doc named in the brief does not exist

`docs/prompts/drafts/web-update-2026-07-30-billing-picking-shell.md` — **not on disk.** The only
2026-07-30 draft present is `doc-pass-2026-07-30-picker-face.md` (this session's canon pass, an
unrelated document).

So this discovery validates the data questions **as the brief itself states them** (A1-A5, B1-B5,
C1-C3), which are specific enough to answer. It does **not** validate "the design", because the
design could not be read. Anything in that doc not restated in the brief is unexamined here.

### 0.2 What could NOT be verified, and why

This session has no database access. **Every volume, latency and "is it running today" question below
is UNVERIFIED**, and the exact query needed is named at each point. Per the project's own checking
discipline: seed is not live, a doc is not live, and a dated SELECT is not today's SELECT.

---

## 1. THE TABLE — each data element

| # | Element | Verdict | Write location for a billing edit | Evidence |
|---|---|---|---|---|
| A1 | `orders.invoiceNo` | **PARTIAL** | n/a (SAP-owned) | See §2.1 — patch-on-existing runs on **manual-sap only** |
| A2 | `pick_checked` | **FLOWS** | n/a | `app/api/picking/approve/route.ts:75` — single writer |
| A3 | Pending filter | **PARTIAL** | n/a | Missing hide-exclusion + splits decision — §2.3 |
| A4 | "Marked invoiced" marker | **GAP** | `orders` (new columns) | No such column exists — §2.4 |
| A5 | Live-sync reuse | **GAP** | n/a | Picking marker is NARROWER than a billing list — §2.5 |
| B1 | Ship-to override | **FLOWS** | `mo_orders.shipToOverrideCustomerId` | `route.ts:272-274` → `orders`; Floor displays |
| B2 | Hold | **FLOWS** | `mo_orders.dispatchStatus` | `route.ts:250-252` lowercases; Floor hold feed reads `"hold"` |
| B3 | Urgent / priority | **FLOWS** | `mo_orders.dispatchPriority` | `route.ts:256-258`; Floor displays in all 4 feeds |
| B4 | **SLOT intent** | **GAP** | `mo_orders` (new column) | mo_orders has no date/window column at all — §3.4 |
| B5 | Notes | **PARTIAL** | `mo_orders` (exists) | 2 of 5 note sources don't carry; **Floor reads none** — §3.5 |

---

## 2. PART A — Picking tab

### 2.1 A1 · `orders.invoiceNo` — **PARTIAL**, and the reason matters

**Schema:** `orders.invoiceNo String?`, `orders.invoiceDate DateTime?` (`prisma/schema.prisma`, model
`orders`). Nullable, no default.

**Create-time fill — works on every path.** The SAP header cell `InvoiceNo` is read into the order
payload at `app/api/import/obd/route.ts:844` (manual-template), `:2441` and `:2693` (auto-json), and
written on create via `lib/import-upsert.ts:178/231`.

**Patch-on-existing (null → value) — this is where it narrows.** The planner is
`lib/import-upsert/header.ts:77`:

```
fillNull("invoiceNo", existing.invoiceNo, incoming.invoiceNo, "order");
```

That runs inside `patchHeader`, which only executes through `upsertObd`. **`upsertObd` has three call
sites and only ONE of them writes:**

| Call site | Source | `dryRun` | Writes? |
|---|---|---|---|
| `route.ts:1692` | `"manual-sap"` | **`false`** | ✅ **YES** |
| `route.ts:2049` | `"manual-template"` | `true` | ❌ shadow log only |
| `route.ts:2348` | `"auto-import"` | `true` | ❌ shadow log only |

This is the project's own "an import is not a call" trap: two of the three look like live patch paths
and are diagnostic shadow runners. The auto path additionally states at `route.ts:2617` *"Skip
duplicates entirely in auto-import"* — an existing OBD is not revisited there at all.

**The auto-import patch is a SEPARATE endpoint**, not part of the ingest:
`?action=patch-headers` → `handleAutoImportPatchHeaders` (`route.ts:3296`), whose invoice arm is
`route.ts:3357` (`existing.invoiceNo === null && incomingInvoiceNo`), paired with
`?action=pending-invoices` (`route.ts:3441`) which returns OBDs in a date window where
`invoiceNo: null`. Both are HMAC-v2. The caller is `docs/Powershell/Auto-Import-v2.ps1` (**tracked**;
Phase 9.5 at line 23, endpoints at lines 59-60, pointed at `https://www.orbitoms.in`).

**⚠ But the tool that calls it is documented PAUSED.** `CLAUDE_CORE.md §4` line 97 marks
`Auto-Import.ps1 v2.0` **PAUSED as of 2026-05-14**, and §13 line 938 repeats *"Auto-Import paused —
only manual SAP upload runs since 2026-05-14."*

**So, as documented:** the live invoice-fill path today is (a) create-time from the manual SAP upload,
and (b) `manual-sap` re-upload patching a previously-null `invoiceNo`. The `patch-headers` sweep is
attached to a paused tool.

**UNVERIFIED — and this is the single most important thing to check before designing an auto-confirm
column:**
- Is the depot Auto-Import task actually enabled today? (repo cannot know; check the depot PC's Task
  Scheduler, and/or `import_batches` for recent `[auto-import]` / `[auto-json]` headerFile rows)
- **How long after a bill is invoiced does `invoiceNo` land?** This is purely a function of when the
  operator uploads the SAP file. Suggested SELECT: distribution of
  `invoiceDate` → `orders.updatedAt` on rows where `invoiceNo IS NOT NULL`, last 30 days.
- **What fraction of `pick_checked` rows have a null `invoiceNo`?** That is the size of the tab.

**Design consequence:** an "auto-confirm" column driven by `invoiceNo` is only as fresh as the manual
SAP upload cadence. If that is once or twice a day, the column confirms in batches, not in real time —
which is fine, but the UI should not imply live confirmation. **Do not design around it until the two
SELECTs above are run.**

### 2.2 A2 · `pick_checked` — **FLOWS**

- Rank 90 in the central ladder: `lib/workflow-stages.ts:52`, exported as `PICK_CHECKED` (`:70`).
- **Exactly one writer:** `app/api/picking/approve/route.ts:75` — `data: { workflowStage: PICK_CHECKED }`,
  the supervisor's Approve, which also stamps `pick_assignments.checkedAt`/`checkedById` and writes an
  `order_status_logs` row (`:92`).
- Readers treat it strictly: `isChecked: order.workflowStage === PICK_CHECKED`
  (`lib/picking/queue.ts:488`, `lib/floor/queries.ts:420`, `app/api/floor/order/[orderId]/route.ts:155`).

**Volume — UNVERIFIED.** `CLAUDE_CORE.md §7.4` carries a dated live SELECT (2026-07-24: **195** rows
at `pick_checked`, oldest 2026-07-17). That is six days stale and cannot be re-run here. It is also
the number that proves the tab is non-empty — re-SELECT before building.

⚠ Related open item, already canon (`CLAUDE_PICKING.md §7`): **there is no automatic drain
`pick_checked` → `dispatched`.** So `pick_checked` accumulates. A billing Pending list filtered on
that stage inherits the entire backlog, not just today's — see A3.

### 2.3 A3 · The proposed Pending filter — **PARTIAL**

Proposed: `workflowStage='pick_checked' AND invoiceNo IS NULL AND (not-marked-done) AND isRemoved=false`.

**Correct as far as it goes.** Three things are missing or need a decision:

1. **The hide-exclusion is NOT automatic, and Picking does not apply it.** `getHideExclusion()`
   (`lib/hide/visibility.ts:110`) is AND-merged by Floor (`lib/floor/queries.ts:153/201/337/458/541`)
   and by the tint-summary report — **`lib/picking/queue.ts` never calls it** (verified: zero hits).
   So an admin-hidden order is invisible on Floor and visible on Picking. A billing list must choose
   deliberately which precedent it follows. My read: **billing should apply it** — a hidden order is
   hidden for a reason, and billing is a desk surface like Floor, not a floor-execution surface.
2. **`dispatchStatus` should be explicit.** Every Floor and Picking query pins
   `dispatchStatus: "dispatch"` (`lib/floor/queries.ts:136`, `lib/picking/queue.ts:208`). A held bill
   should not normally reach `pick_checked`, but leaving the column unpinned means a future data path
   can put one in the billing list silently. Pin it.
3. **Splits are unresolved.** `order_splits` carries its own `dispatchStatus` and `priorityLevel`
   (`prisma/schema.prisma`, model `order_splits`). Whether a split order is one invoice or several is a
   **domain question this discovery cannot answer** — it needs Chandresh/depot input. Flagged, not
   guessed.

### 2.4 A4 · The "Mark done" marker — **GAP**, confirmed by reading every column

`prisma/schema.prisma` model `orders` was read in full. **There is no column meaning "billing marked
this invoiced."** The near-misses, and why each is wrong to reuse:

| Existing column | Why it is NOT this |
|---|---|
| `invoiceNo` / `invoiceDate` | SAP's facts, not the operator's action. The whole point of the marker is to record a human decision *before* SAP confirms it |
| `isPicked` / `pickedAt` / `pickedById` | Legacy **Phase 4** pick fields (schema comment: *"Phase 4 pick fields (for non-tinting orders without splits)"*) — a different lifecycle, and `pick_assignments.pickedAt` is the live one. Reusing these would collide with picking semantics |
| `workflowStage` | Would need a new rank past 90, and would put billing on the stage ladder |

**Minimal recommendation:** two columns on `orders` — `invoicedAt DateTime? @db.Timestamptz(6)` +
`invoicedById Int?` (FK → `users`, named relation). This is the **exact pattern the project already
chose twice** for the same shape of problem — `pick_assignments.checkedAt`/`checkedById` for Approve
(`CLAUDE_PICKING.md §6`) and `orders.pickEarlyReleasedAt`/`pickEarlyReleasedById` for early release.
Both were deliberately modelled as timestamp+actor rather than a new status value.

**No new workflow stage is needed**, and none should be added: the ladder is a physical-progress
ladder, and invoicing is a parallel desk fact. Adding a rank would force a re-grep of every
`stageRank()` consumer for no gain.

⚠ `@db.Timestamptz(6)` is **required** on the timestamp — without it Prisma emits plain `timestamp`
and mismatches the live column (`CLAUDE_CORE.md §7.1.c`; the same note is inline on
`orders.pickEarlyReleasedAt`).

### 2.5 A5 · Live-sync — **the existing picking marker CANNOT drive this tab**

The marker is `COUNT(*)` + `MAX(orders.updatedAt)` over `buildPickingWhere()`
(`CLAUDE_PICKING.md §10`, `lib/hooks/use-picking-marker.ts`). The governing rule is **"Marker ⊇ queue,
never ⊂"** — a marker watching a *wider* set costs harmless extra refetches; a *narrower* set means
missed updates on the floor.

**The `openPending` scope fences checked bills to today** (`lib/picking/queue.ts:215`):

```
{ workflowStage: PICK_CHECKED, dispatchTargetDate: todayDateOnly }
```

A billing Pending list spanning **all dates** (which it must — see A2's no-drain note) is therefore a
**superset** of what the picking marker watches. Reusing it would silently miss every carry-over bill.
**This is the landmine, not a hypothetical.**

**Recommendation:** a new scope for the same marker route rather than a second polling mechanism —
`use-picking-marker` already takes optional `url` + `onProbe` params precisely so another module can
point it elsewhere (added 2026-07-24 for Floor; `CLAUDE_PICKING.md §10`). Build the billing WHERE once
in a shared helper and let both the list and the marker read it, exactly as `buildPickingWhere()` does.

**On the "no SECOND `orders.update`" landmine (`CLAUDE_CORE.md §3`):** writing `invoicedAt` is **one**
update on a path that has none today, so it does not violate the rule — and because `orders.updatedAt`
is `@updatedAt`, that single write is also what makes the change visible to any marker. The rule
forbids *adding a second* update to an existing path (e.g. bolting a notification write onto assign).
Marking done must remain exactly one `orders.update`.

---

## 3. PART B — mail → OBD → Floor

### 3.0 The key question first: where does a billing edit get written?

**The OBD row does not exist when the operator is working.** The chain is:

1. Mail arrives → `mo_orders` row created (`app/api/mail-orders/ingest/route.ts`).
2. Operator punches into SAP → `mo_orders.soNumber` filled.
3. SAP export imported → `orders` row created.
4. `applyMailOrderEnrichment(soNumbers)` (`app/api/import/obd/route.ts:229`) copies mo → orders,
   matching on `soNumber` via **`prisma.orders.updateMany({ where: { soNumber } })`** (`:313`) — 1:N,
   as the brief says.

**Therefore: an edit the operator makes before SAP import MUST be written to `mo_orders`, and there
must be a line in `applyMailOrderEnrichment` that carries it forward.** Writing to `orders` is
impossible at that moment; a field with no carry-forward line is silently dropped.

⚠ **Enrichment is fire-once-per-import, not a sync.** It runs at `route.ts:1182`, `:1731`, `:2992` —
all inside import handlers. An operator edit made to `mo_orders` *after* the OBD already exists will
**not** propagate unless that OBD is re-imported. Any design where the operator edits post-import
needs a second write path straight to `orders`. **This is a design decision, not a gap to plug blindly.**

### 3.1 B1 · Ship-to override — **FLOWS**

- **Carry:** `route.ts:272-274` — `if (mailOrder.shipToOverrideCustomerId != null) updateData.shipToOverrideCustomerId = ...`,
  plus the `shipToOverride` boolean at `:269-271`.
- **Floor reads it:** selected in all four feeds (`lib/floor/queries.ts:214, 315, 463, 548`), and the
  effective dealer is resolved as `order.shipToOverrideCustomer ?? order.customer`
  (`:241, 383, 490, 572`) — i.e. the override *wins* on the displayed name.
- **Floor displays it:** `isShipToOverride` (`:258, 400, 509, 586`), `shipToOverrideName` (`:255`), and
  in the detail panel `isShipToOverride` / `overrideName` / `overrideCode`
  (`app/api/floor/order/[orderId]/route.ts:146, 161-162`).
- Resolution logic for the mail side: `lib/mail-orders/delivery-match.ts`.

### 3.2 B2 · Hold — **FLOWS**, and the case mapping is real

- **Carry + case fix:** `route.ts:250-252` —
  `const loweredStatus = mailOrder.dispatchStatus.toLowerCase(); updateData.dispatchStatus = loweredStatus;`
  This is exactly the `'Hold'` → `'hold'` mapping `CLAUDE_CORE.md §13` warns about, handled correctly
  at the boundary. `mo_orders.dispatchStatus` defaults to `"Dispatch"` (capitalised); `orders` holds
  lowercase.
- **`heldAt` is stamped per-order** at `route.ts:384-395`, using each order's own `obdEmailDate` as the
  arrival anchor (`updateMany` cannot write per-row values, hence the separate loop).
- **Floor respects it, in both directions:** the hold feed is
  `where: { AND: [{ dispatchStatus: "hold", isRemoved: false }, hide] }` (`lib/floor/queries.ts:460`),
  and the live board *requires* `dispatchStatus: "dispatch"` (`:136`), so a held bill is off the live
  board by construction rather than by a filter someone must remember.

### 3.3 B3 · Urgent / priority — **FLOWS**

- **Carry:** `route.ts:256-258` — `updateData.priorityLevel = mailOrder.dispatchPriority === "Urgent" ? 1 : 3`.
  Note this is a **two-value** mapping: anything not exactly `"Urgent"` becomes 3. There is no P2.
- **Floor displays it:** `priorityLevel` selected in all four feeds (`lib/floor/queries.ts:264, 407,
  515, 592`) and in the detail (`app/api/floor/order/[orderId]/route.ts:150`).

### 3.4 B4 · SLOT — **GAP, confirmed at the schema level**

**`mo_orders` has no dispatch date and no dispatch window column.** The full model was read; the only
slot-adjacent field is `slotToOverride Boolean?` — a bare flag with **no value attached**, copied
across as a bare boolean at `route.ts:275-277`. There is nowhere on the mail order to *put* a slot.

**What does exist, and why it is not the same thing:** the dispatch engine runs **inside**
`applyMailOrderEnrichment` (`route.ts:318-381`) and does write the real columns —

```
data: { dispatchTargetDate: result.targetDate, dispatchWindowId,
        dispatchSlotRuleId: result.ruleId, dispatchSlotSource: "auto" }
```

— but it derives them from **rules** (`evaluateDispatchSlot({ smu, dispatchStatus, deliveryType,
emailDateTime, punchDateTime })`, `:350-356`), never from operator intent. So there is a path for a
slot **value** and no path for a slot **decision**.

**The manual-skip guard is real and is the hook to use** (`route.ts:344-347`):

```
if (ord.dispatchSlotSource === "manual") { ...skip...; continue; }
```

This confirms `CLAUDE_CORE.md §7.4` from the code: the engine never overrides a human's pick.

**Minimal add (for the design session, not proposed as a migration here):** a dispatch-window intent on
`mo_orders` (a target date + a `dispatch_slot_master` FK), copied at enrichment into
`orders.dispatchTargetDate` / `dispatchWindowId` with **`dispatchSlotSource: "manual"`**, written
*before* the engine loop so the existing guard skips it. No engine change required — the guard already
does the work.

⚠ Floor's own change-slot action writes the identical shape today
(`app/api/floor/actions/route.ts:111`: `{ dispatchTargetDate, dispatchWindowId, dispatchSlotSource: "manual" }`),
so the target state is already proven — only the mail-stage origin is missing.

### 3.5 B5 · Notes — **PARTIAL, and Floor sees none of it**

**Five distinct note stores exist on the mail side:**

| Field | Carried to `orders` by enrichment? |
|---|---|
| `mo_orders.deliveryRemarks` | ✅ joined |
| `mo_orders.remarks` | ✅ joined |
| `mo_orders.billRemarks` | ✅ joined |
| `mo_orders.notes` | ❌ **not copied** |
| `mo_order_remarks[]` (child table, per-line, typed) | ❌ **not copied** |

The carry is `route.ts:260-267` — three fields `.filter(Boolean).join(" | ")` into a single
`orders.remarks` string. Lossy and one-way: three sources collapse into one column with no
attribution, and there is no path back.

**⚠ Floor never reads `orders.remarks` at all.** Verified by sweep across `lib/floor/`,
`components/floor/` and `app/api/floor/` — **zero occurrences of `remarks`**. So even the three fields
that *do* carry forward reach a column no Floor surface displays.

**What this means for the design:**
- For the **billing operator's own follow-up/reference**, the existing mail-side notes are sufficient —
  `mo_orders.notes` plus `mo_order_remarks` are already there, already per-order, and
  `lib/mail-orders/utils.ts` already has the display helpers (`splitDeliveryRemarks` at `:844` splits
  ship-to identity out of `deliveryRemarks`; `getOrderSignals` reads the remark fields at `:627-770`).
  **No new field is needed for that use.**
- For notes to **reach Floor**, two separate things are missing: `mo_orders.notes` has no carry line,
  and Floor has no reader. Neither is hard; both are real work. **Whether Floor should see billing
  notes at all is a product question**, not a plumbing one — Floor's panels are deliberately terse.

---

## 4. GAP LIST — minimal additions (no migrations proposed)

| # | Gap | Minimal shape | Why |
|---|---|---|---|
| 1 | No "billing marked invoiced" marker | `orders.invoicedAt` (Timestamptz(6)) + `orders.invoicedById` (FK → users, **named relation**) | A4. Matches the `checkedAt`/`checkedById` and `pickEarlyReleasedAt`/`ById` precedents. No new stage |
| 2 | No slot intent at mail stage | A target date + `dispatch_slot_master` FK on `mo_orders`, carried at enrichment as `dispatchSlotSource: "manual"` | B4. The engine's manual-skip guard already exists |
| 3 | `mo_orders.notes` has no carry line | One line in `applyMailOrderEnrichment` — *only if* notes must reach the OBD | B5. Not needed for the operator's own reference |
| 4 | Floor displays no remarks | A reader in the Floor detail panel — *only if* the product wants it | B5. Currently zero references |
| 5 | Billing list needs its own marker scope | A shared WHERE helper + a scope on the marker route | A5. Reusing `openPending` would miss all carry-over |

⚠ **Relation-naming landmine for gap 1:** `orders` already has many named FKs to `users`
(`OrderPickedBy`, `OrderRemovedBy`, `OrderRestoredBy`, `OrderPickEarlyReleasedBy`, …). A new one **must**
carry its own `@relation("OrderInvoicedBy")` on both sides or Prisma throws an ambiguity error. Load
the `db-schema-safety` skill before writing any of this.

---

## 5. PART C — Rollout gating

### 5.1 C1 · The real hooks that exist today

| Hook | Granularity | Runtime-changeable? | Evidence |
|---|---|---|---|
| `role_permissions` via `checkAnyPermission` / `getAllPermissionsForRoles` | per **role** × page × action | Yes (DB rows) | `lib/permissions.ts`; every layout, e.g. `app/(mail-orders)/mail-orders/layout.tsx:26` |
| `PAGE_NAV_MAP` + `buildNavItems` | nav visibility | Partly | `lib/permissions.ts:100-128` |
| `middleware.ts` `PHASE1_BLOCKED` | route prefix × role | **No** — it is a code array, and it is currently **EMPTY** (`middleware.ts:30`) | Live mechanism, zero entries — capability, not reachability |
| **Attendance rollout pattern** | **per USER + a global stage** | **Yes, no redeploy** | `lib/auth.ts:29-72`, `lib/permissions.ts:112-121` |
| `system_config` key/value | global | **Value yes, key NO** | `app/api/admin/system-config/route.ts:40-50` |

**⚠ `system_config` cannot create new keys through the admin API.** The PUT explicitly refuses:
*"Fetch existing keys — never allow inserting new ones"* (`route.ts:40-50`), returning 400 on an
unknown key. A flag stored there needs **one SQL INSERT first**; only then is it togglable in the
admin UI without a redeploy. That is a footgun worth knowing before choosing this route.

**Also relevant: `billing_operator` already exists as a role.** `lib/rbac.ts:15`
(`BILLING_OPERATOR: "billing_operator"`), with `ROLE_REDIRECTS.billing_operator = "/mail-orders"`
(`:41`), and a seed row (`prisma/seed.ts:43`: *"Billing operator (mail orders + SAP punching)"*).
**UNVERIFIED:** whether it has live `role_permissions` rows or any live users — that needs a SELECT,
and the project has been bitten in both directions here (seeded-but-not-live, and live-but-not-seeded;
`CLAUDE_CORE.md §13`). The brief says "operations-only", but the design should decide consciously
whether the target is the `operations` role or this existing billing role.

### 5.2 C2 · Recommendation — copy the attendance pattern, in place

**Compared:**

| Option | Rollback | Verdict |
|---|---|---|
| (a) allowlist in `system_config`, read at the page | Edit a value in the admin UI — **but the key must be SQL-INSERTed once first** | Workable; the insert step is an avoidable trap |
| (b) new `/billing` route, linked only for allowlisted users | Unlink — but the route stays reachable by URL, and now there are two UIs to keep in step | ❌ Two live surfaces for the same job is how they drift |
| (c) **flag-in-place on `/mail-orders`** | Flip one DB value → OFF | ✅ **Recommended** |

**Recommended mechanism — the pattern already proven in production for Attendance:**

- A **global stage** row (`"OFF" | "TEST_USERS_ONLY" | "ALL_USERS"`), read server-side —
  `lib/auth.ts:39-44` reads `attendance_settings.rolloutStage` exactly this way.
- A **per-user boolean** — mirroring `users.attendanceTestUser` (`prisma/schema.prisma`, model `users`).
- The gate itself is five lines — `lib/auth.ts:65-72`:
  ```
  if (stage === "OFF") return false;
  if (stage === "TEST_USERS_ONLY") return flags.testUser;
  if (stage === "ALL_USERS") return true;
  ```
- Cached on the JWT with a **5-minute staleness window** (`STALE_MS`, `lib/auth.ts:20`) so an admin
  toggle propagates within five minutes without a redeploy or a re-login — the comment there records
  that exact trade-off.
- Nav visibility hangs off the same flags: `lib/permissions.ts:112-121` already special-cases a
  pageKey on `userFlags` rather than `role_permissions`.

**Why this over (a):** it is per-**user**, not per-role, so one operations user can pilot without
turning it on for the whole role; adding the second and third user is one boolean each; and the
rollback is one value → `OFF`, which the code already treats as "gate does not apply". It also needs
no new mechanism — a future reader recognises it from Attendance.

**Rollback story:** set stage → `OFF`. Every user falls back to the current Mail Orders UI within the
5-minute window (immediately on next sign-in). No deploy, no revert, no data change. The flag is read
server-side, so there is no client cache to bust.

### 5.3 C3 · Can one flag wrap the whole Billing module?

**Yes, provided the flag is read at ONE server boundary and passed down** — the same shape
`app/picking/page.tsx` uses to branch faces (`showPickerFace` resolved once in the server component,
then a single branch in the tree). One read in `app/(mail-orders)/mail-orders/layout.tsx` (which
already does the auth + permission work at `:20-27`) can gate the Picking tab, the Orders redesign and
the rename together.

**Clean deletion later:** yes, if two rules hold —
1. the flag is checked in **one place** and never re-derived deeper in the tree; and
2. the old UI is not *forked* — the new one is additive until the flag is removed, at which point the
   old branch is deleted whole.

⚠ **Do NOT gate this in `middleware.ts`.** `PHASE1_BLOCKED` is a hardcoded array (`middleware.ts:30`),
so every allowlist change would be a **redeploy** — the exact thing the brief rules out. Middleware
also runs on the Edge runtime and cannot reach Prisma (`CLAUDE_CORE.md §3`: `lib/auth.ts` = Node,
`auth.config.ts` = Edge, do not merge).

---

## 6. FINAL-DESIGN-DRAFT OUTLINE (for the next session)

**Before anything is designed, run these three checks.** Two of them can invalidate the Picking tab's
core premise:

1. `SELECT count(*) FROM orders WHERE "workflowStage"='pick_checked' AND "invoiceNo" IS NULL AND "isRemoved"=false;`
   — the actual size of the tab today.
2. The invoice-latency distribution (§2.1) — decides whether "auto-confirm" is a live column or a
   batch one, and therefore how the Done strip should read.
3. `SELECT` on `role_permissions` for `billing_operator` and on `users` for that role — decides whether
   the pilot targets `operations` or the billing role that already exists.

**Then, in this order:**

1. **Schema** — the two `orders` columns (gap 1) with the named relation; the `mo_orders` slot intent
   (gap 2) only if the slot feature is in scope for phase 1. Load `db-schema-safety` first. SQL via the
   Supabase editor + `npx prisma generate`; never `db push`.
2. **Flag** — the rollout stage row + per-user boolean + the five-line gate, mirroring Attendance.
   Ship this **first and alone**, verified OFF in production, before any UI rides on it.
3. **Picking tab** (phase 1, self-contained): the shared WHERE helper, the marker scope (A5), the list,
   the Done strip, and the mark-done write (exactly one `orders.update`).
4. **Orders redesign + rename** (phase 2): reuse `components/floor/dispatch-slot-picker.tsx` and the
   ship-to search (`app/api/floor/ship-to*`) rather than rebuilding them; decide the
   `mo_orders`-vs-`orders` write target per field using §3.0's rule; resolve the post-import edit
   question explicitly.
5. **Notes** — decide whether Floor should see them at all (§3.5) before adding either the carry line
   or the reader.

**Carry into the design doc as stated constraints:** the enrichment match is `updateMany` on
`soNumber` (1:N — an edit can touch several OBDs); enrichment fires only at import, not on mail-order
edit; the picking marker must never be narrower than the list it drives; and marking done must remain a
single `orders.update`.

---

*Discovery 2026-07-30 · read-only · no file outside this one was changed, no SQL was run.*

---

# ADDENDUM — the three pre-build checks, ANSWERED
# 2026-07-30, later the same day · read-only SELECTs against production · no writes

The footer above belongs to the original discovery pass. The three checks it left **UNVERIFIED**
(§8.1-8.3) have since been run as read-only queries against the live Supabase database. Numbers are
as of **2026-07-30**; re-measure before treating any of them as current.

## A1. Pending tab size — **11 bills**

Run through the real `buildBillingPendingWhere()` (`lib/billing/picking-where.ts`) via `tsx`, not a
re-typed predicate. Emitted where:

```json
{"AND":[{"workflowStage":"pick_checked","invoiceNo":null,"invoicedAt":null,
         "isRemoved":false,"dispatchStatus":"dispatch"},{"isHidden":false}]}
```

The hide arm collapses to `{isHidden:false}` because **both** `obd_visibility_rules` are currently
`isActive:false` (id 1 "Hold"/tag, id 2 "Day"/daysOld>3) and **0** orders carry `isHidden=true`. Hide
is a no-op *today* — it is still AND-merged, because activating either rule changes that instantly.

**🔴 The no-fence decision is now empirically proven.** Pending bills by `dispatchTargetDate`:

| dispatchTargetDate | bills |
|---|---|
| 2026-07-20 | 2 |
| 2026-07-21 | 2 |
| 2026-07-22 | 3 |
| 2026-07-25 | 4 |

**Not one is dated today (30 Jul).** A `dispatchTargetDate = today` fence — which is what
`buildPickingWhere`'s `openPending` arm applies to its checked band (`lib/picking/queue.ts`) — would
return **0 rows**: an empty tab with 11 real uninvoiced bills behind it. The oldest is 10 days old.
Carry-over is the normal case. **Never add a date fence to `buildBillingPendingWhere`.**

Also measured: `PENDING_NULL_CHECKEDAT = 0` — no `pick_checked` row has a null
`pick_assignments.checkedAt`, so the list route's relation `orderBy` has no null-position problem in
practice. Marker over the identical predicate returned `{count: 11, latest: 2026-07-29T04:16:55Z}`,
consistent with the list. `invoicedAt` is set on **0** rows (nothing can write it yet).

Route data validated against live rows, including a real override: OBD `9108370430` has
`shipToCustomerName` "MOHAN COLOUR CO" but `shipToOverrideCustomerId 1998` → **"Dev Colours"**, so
`shipToOverridden: true`. The override path is exercised by live data, not hypothetical.

## A2. Invoice latency — **batched, sub-hourly, spread across the working day**

**⚠ Measurement caveat that matters more than the numbers.** `orders.invoiceDate` is `timestamptz`
but carries **exactly one distinct value per day** (checked over 14 days) — it is midnight-stamped,
date-only in practice. So `updatedAt − invoiceDate` measures "hours since midnight", **not** latency,
and `orders.updatedAt` is bumped by *any* write. The raw figures (n=2825, p50 12.6h, p90 82.7h, max
303h) are **not invoice latency** and must not be quoted as such.

The usable signal is cadence:

- `import_batches`: **31–37 batches/day**, spanning roughly 07:00–23:00 IST — one every 30–45 min.
- Bills invoiced today had `updatedAt` land across **8 distinct IST hours** (10,11,12,13,15,16,17,18;
  87 bills).

**Conclusion: `invoiceNo` arrives in BATCHES through the day — not near-live, not once nightly.**

→ **LOCKED: the Done strip says "awaiting SAP" and promises no duration.** It is a real persistent
state a bill can sit in for tens of minutes, not a flicker; it must be styled as a legible state, not
a transient spinner.

Side finding: median `invoiceDate − checkedAt` is **−14.2h**, i.e. the invoice is dated the *same
calendar day* the bill was approved. Same-day invoicing is the norm — the 11 pending bills above are
exactly the stragglers the tab exists to catch.

## A3. Pilot target — **`operations` passes the gate; `billing_operator` is the end state**

`role_permissions` where `pageKey = 'mail_orders'`:

| roleSlug | canView | canEdit |
|---|---|---|
| `billing_operator` | ✅ | ✅ |
| `operations` | ✅ | ✅ |
| `operation_manager` | ✅ | ✅ |
| `tint_manager` | ✅ | ❌ |

Holders (active): **`operations`** — 1 user, id **20** "Operations User" (roles `logistics,operations`).
**`billing_operator`** — 2 users, id **25 Deepanshu Thakur**, id **26 Bankim**.

Both candidate roles clear the `mail_orders` / `canView` gate the two new routes use, so the routes
need no change either way.

⚠ **Schema trap for anyone writing these queries:** `role_master` has **no `slug` column** — it has
`id, name, description` only. `role_permissions.roleSlug` matches `role_master.name`. A query assuming
a slug column fails with P2010.

**LOCKED:** pilot on the **`operations` account (id 20)**; the feature flag must be keyed so it also
reaches **Deepanshu (25) + Bankim (26)** at rollout — the mockup's Done strip is literally captioned
"Deepanshu 19 · Bankim 15", i.e. the two live `billing_operator` accounts. They are who actually does
this work; `operations` is a pilot proxy.

## Still unverified

The **auth gate itself**. Read access to the database is not a login: `auth()`,
`checkAnyPermission`, and the 401/403 branches on `/api/billing/picking/list` + `/marker` have not
been exercised. Needs a real logged-in browser check (as `operations` → 200; as a role without
`mail_orders` canView → 403).

*Addendum 2026-07-30 · read-only SELECTs only · no INSERT/UPDATE/DELETE/ALTER was run. Operating rule
now in `CLAUDE_CORE.md §3`.*
