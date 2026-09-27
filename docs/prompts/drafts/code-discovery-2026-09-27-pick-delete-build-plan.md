# code-discovery-2026-09-27 — Billing "Pick delete": build plan

**Mode:** PLAN ONLY. No code, no SQL run, nothing staged. Code read at HEAD `d66bfb20`.
**Decisions (locked):** `docs/prompts/drafts/web-update-2026-09-27-billing-pick-delete.md`.
**Discovery:** `docs/prompts/drafts/code-discovery-2026-09-27-billing-duplicate-so.md`.
**Mockup:** `docs/mockups/billing/pick-delete-review.html`.
**Owner answers:** recorded 2026-09-27 — §11 is now a list of rulings, and §3/§5/§9/§10 follow them.
**Step-3 SQL (final, copy-paste block):** `docs/prompts/drafts/2026-09-27-pick-delete-table.sql` — supersedes the sketch in §1. **RUN LIVE 2026-09-27 by Smart Flow; the verify block returned the expected 35 rows.** Minted as CORE Schema v27.42 in step 4.

## 0. Ownership boundary

- **The RULE stays Picking's.** "Which live bills share an SO, and which groups are still flagged"
  lives in `lib/picking/duplicate-so.ts`. Picking owns the file; Floor and Billing import it. The
  acknowledgement filter goes inside it, so every screen gets the same answer.
- **The DECISION is Billing's.** Billing alone writes `pick_delete_decisions` (All OK, Pick delete,
  Undo), through `/api/billing/pick-delete/*`, gated on `billing_pick_delete`. Picking and Floor only
  READ decisions (the rule filter, the markers, the pick-deleted card).
- **Floor's routes are not called from billing.** Billing staff do not hold the `floor` tick
  (`app/api/floor/actions/route.ts:64`). Billing reuses Floor's HELPERS — `offFloorRefusal`
  (`lib/floor/off-floor.ts:65`) and `buildCancelNote("duplicate_bill")` (`lib/picking/cancel-reasons.ts:115`) —
  and Floor restore's live-CI refusal (`actions/route.ts:269-280`). Undo does NOT copy Floor's restore
  write — it releases to `pending_picking` (owner ruling, §11.1).

---

## 1. Table — `pick_delete_decisions`

The real id types are `Int` in both tables (`prisma/schema.prisma:112` `users.id`, `:1012`
`orders.id`). Step 2 confirms them live as `integer`.

One row per decision. An Undo stamps the row; it never deletes it (the Decided list is history).

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | serial PK | no | |
| `soNumber` | text | no | the SO, stored raw — the rule matches raw strings (`duplicate-so.ts:35-40`) |
| `kind` | text + CHECK | no | `all_ok` \| `pick_delete` |
| `orderIds` | integer[] | no | the exact SET decided on, **sorted ascending** by the app, ≥ 2 |
| `deletedOrderId` | integer → orders | pick_delete only | the bill cancelled |
| `deletedFromStage` | text | pick_delete only | the bill's stage at delete time (history, and which band the card belongs to) |
| `deletedPickerId` | integer → users | yes | who held the pick assignment at delete time; null if nobody |
| `keptOrderIds` | integer[] | no, default `{}` | the survivors ("Correct pick") |
| `decidedById` / `decidedAt` | integer → users / timestamptz | no | |
| `undoneById` / `undoneAt` | integer → users / timestamptz | yes | |
| `createdAt` / `updatedAt` | timestamptz | no | `updatedAt` is Prisma `@updatedAt`, with no trigger (the same shape as `so_tags`) |

### Step 3 SQL — `sql/2026-09-2x-pick-delete-decisions.sql` (Supabase-editor safe: no BEGIN/COMMIT)

```sql
-- PART 1 — create
CREATE TABLE pick_delete_decisions (
  "id"               SERIAL PRIMARY KEY,
  "soNumber"         text        NOT NULL,
  "kind"             text        NOT NULL,
  "orderIds"         integer[]   NOT NULL,
  "deletedOrderId"   integer     NULL,
  "deletedFromStage" text        NULL,
  "deletedPickerId"  integer     NULL,
  "keptOrderIds"     integer[]   NOT NULL DEFAULT '{}',
  "decidedById"      integer     NOT NULL,
  "decidedAt"        timestamptz(6) NOT NULL DEFAULT now(),
  "undoneAt"         timestamptz(6) NULL,
  "undoneById"       integer     NULL,
  "createdAt"        timestamptz(6) NOT NULL DEFAULT now(),
  "updatedAt"        timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "pick_delete_decisions_deletedOrderId_fkey"  FOREIGN KEY ("deletedOrderId")  REFERENCES orders(id) ON DELETE RESTRICT,
  CONSTRAINT "pick_delete_decisions_deletedPickerId_fkey" FOREIGN KEY ("deletedPickerId") REFERENCES users(id)  ON DELETE SET NULL,
  CONSTRAINT "pick_delete_decisions_decidedById_fkey"     FOREIGN KEY ("decidedById")     REFERENCES users(id)  ON DELETE RESTRICT,
  CONSTRAINT "pick_delete_decisions_undoneById_fkey"      FOREIGN KEY ("undoneById")      REFERENCES users(id)  ON DELETE SET NULL,
  CONSTRAINT chk_pick_delete_decisions_kind  CHECK ("kind" IN ('all_ok', 'pick_delete')),
  CONSTRAINT chk_pick_delete_decisions_shape CHECK (
       ("kind" = 'all_ok'      AND "deletedOrderId" IS NULL     AND "deletedFromStage" IS NULL     AND "deletedPickerId" IS NULL)
    OR ("kind" = 'pick_delete' AND "deletedOrderId" IS NOT NULL AND "deletedFromStage" IS NOT NULL)),
  CONSTRAINT chk_pick_delete_decisions_set     CHECK (cardinality("orderIds") >= 2),
  CONSTRAINT chk_pick_delete_decisions_member  CHECK ("deletedOrderId" IS NULL OR "deletedOrderId" = ANY ("orderIds")),
  CONSTRAINT chk_pick_delete_decisions_undo    CHECK ("undoneById" IS NULL OR "undoneAt" IS NOT NULL)
);

-- One ACTIVE All OK per exact set (a double press → P2002 → the route treats it as done).
CREATE UNIQUE INDEX pick_delete_decisions_all_ok_live_key
  ON pick_delete_decisions ("soNumber", "orderIds") WHERE "kind" = 'all_ok' AND "undoneAt" IS NULL;
-- One ACTIVE Pick delete per bill.
CREATE UNIQUE INDEX pick_delete_decisions_deleted_live_key
  ON pick_delete_decisions ("deletedOrderId") WHERE "kind" = 'pick_delete' AND "undoneAt" IS NULL;
CREATE INDEX pick_delete_decisions_so_idx            ON pick_delete_decisions ("soNumber");
CREATE INDEX pick_delete_decisions_decided_idx       ON pick_delete_decisions ("decidedAt" DESC);
CREATE INDEX pick_delete_decisions_picker_idx        ON pick_delete_decisions ("deletedPickerId", "decidedAt");
CREATE INDEX pick_delete_decisions_deleted_order_idx ON pick_delete_decisions ("deletedOrderId"); -- FK referencing side (RESTRICT)

-- PART 2 — verify (read-only): paste the output into the CORE v27.42 entry
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'pick_delete_decisions'::regclass
UNION ALL
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'pick_delete_decisions';
```

⚠ `undoneById` is SET NULL, so the undo CHECK is one-directional on purpose. A user delete must never
violate it (users are deactivated, never deleted — the same reasoning as `so_tags.removedById`).
⚠ The partial unique on `("soNumber","orderIds")` works only if the arrays are **sorted** — every
writer sorts before it inserts.

### schema.prisma model (step 4)

```prisma
// pick_delete_decisions — Billing's same-SO decisions (Schema v27.42).
// ⚠ Two PARTIAL unique indexes live only in SQL — pick_delete_decisions_all_ok_live_key
//   ("soNumber","orderIds") WHERE kind='all_ok' AND "undoneAt" IS NULL, and
//   pick_delete_decisions_deleted_live_key ("deletedOrderId") WHERE kind='pick_delete' AND "undoneAt" IS NULL.
//   Not expressible in Prisma: no @@unique, no findUnique on them. Five CHECKs, SQL only.
model pick_delete_decisions {
  id               Int       @id @default(autoincrement())
  soNumber         String
  kind             String
  orderIds         Int[]
  deletedOrderId   Int?
  deletedOrder     orders?   @relation("PickDeleteDeletedOrder", fields: [deletedOrderId], references: [id], onDelete: Restrict)
  deletedFromStage String?
  deletedPickerId  Int?
  deletedPicker    users?    @relation("PickDeleteDeletedPicker", fields: [deletedPickerId], references: [id], onDelete: SetNull)
  keptOrderIds     Int[]     @default([])
  decidedById      Int
  decidedBy        users     @relation("PickDeleteDecidedBy", fields: [decidedById], references: [id], onDelete: Restrict)
  decidedAt        DateTime  @default(now()) @db.Timestamptz(6)
  undoneAt         DateTime? @db.Timestamptz(6)
  undoneById       Int?
  undoneBy         users?    @relation("PickDeleteUndoneBy", fields: [undoneById], references: [id], onDelete: SetNull)
  createdAt        DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt        DateTime  @default(now()) @updatedAt @db.Timestamptz(6)

  @@index([soNumber], map: "pick_delete_decisions_so_idx")
  @@index([decidedAt(sort: Desc)], map: "pick_delete_decisions_decided_idx")
  @@index([deletedPickerId, decidedAt], map: "pick_delete_decisions_picker_idx")
  @@index([deletedOrderId], map: "pick_delete_decisions_deleted_order_idx")
}
```

Back-relations:
- `users`: three FKs hit it, so all three relations are named on both sides (CORE §7.3) —
  `pickDeleteDecided pick_delete_decisions[] @relation("PickDeleteDecidedBy")`,
  `pickDeleteUndone pick_delete_decisions[] @relation("PickDeleteUndoneBy")`,
  `pickDeleteHeld pick_delete_decisions[] @relation("PickDeleteDeletedPicker")`.
- `orders`: `pickDeleteDecisions pick_delete_decisions[] @relation("PickDeleteDeletedOrder")`.

Optional in the same step: model the live `idx_orders_sonumber` as
`@@index([soNumber], map: "idx_orders_sonumber")`, but **only if** step 2's `indexdef` shows a
plain btree on `("soNumber")`. It records the canon drift the decisions file noted.

---

## 2. Permission — `billing_pick_delete`

I copied the `billing_telephonic` pattern exactly. Every site that key touches (grep of app, lib and
components):

| File | Change | Step |
|---|---|---|
| `lib/permissions.ts` | `PageKey` union (after `"billing_telephonic"`, `:285`) · `ALL_PAGE_KEYS` (`:383`) · `ACTION_PAGES.canEdit` (`:443`) · `PAGE_LABEL_OVERRIDES` `billing_pick_delete: "Billing · Pick delete"` (`:531`) · `ACCESS_SECTIONS` Operations (`:588`) · the list comment (`:508`) | 4 |
| `components/billing/billing-pick-delete-access-provider.tsx` (NEW) | a copy of `billing-telephonic-access-provider.tsx` | 7 |
| `app/(mail-orders)/mail-orders/layout.tsx` | read `allPerms["billing_pick_delete"]` (beside `:84`) and nest the provider (beside `:168`) | 7 |
| `app/(mail-orders)/mail-orders/mail-orders-page.tsx` | `useBillingPickDeleteAccess()` (beside `:278`); an `effectiveBillingTab` term (`:289-294`) | 7 |
| `components/billing/billing-tab-bar.tsx` | `showPickDelete` prop + the pill | 7 |
| `app/(mail-orders)/mail-orders/review-view.tsx` | a `billingPickDeleteCanView`/`CanEdit` prop (beside `:135`, `:590`), passed to the tab bar (`:2993`) and to the body arm (`:3009`) | 7 |

- **NOT in `PAGE_NAV_MAP`** and not in `ICON_MAP` (`components/shared/role-sidebar.tsx:40`) — it is a
  tab inside `/mail-orders`, exactly like Telephonic.
- **The `/admin/access` screen needs no file change.** It renders from `ALL_PAGE_KEYS` and
  `ACCESS_SECTIONS` and asserts the two agree. Grep finds no `billing_telephonic` under `app/(admin)`.
- **The old `/admin/permissions` screen** (`components/admin/permissions-manager.tsx:68` hardcodes
  `billing_print`) is **not** touched. `billing_telephonic` was not added there either, and ROADMAP
  records that this screen resurrects keys and is slated for retirement.
- Known limit, inherited: a person holding the key but not `mail_orders` cannot open the page
  (`layout.tsx:66-70`).

---

## 3. Routes — `app/api/billing/pick-delete/*`

Every route: `export const dynamic = "force-dynamic"`, `auth()` → 401, then
`checkAnyPermission(roles, "billing_pick_delete", …)` → 403. The admin bypass lives inside it. All
awaits are sequential; no `$transaction`. Server logic lives in `lib/billing/pick-delete.ts` (writes,
server-only); wire types live in `lib/billing/pick-delete-types.ts` (pure, client-safe).

**The group read** comes from `getDuplicateGroups()`, added to `lib/picking/duplicate-so.ts` (§4).

**Tab scope.** A group shows when it has ≥ 2 twins (the twin rule: not removed, not cancelled) and at
least one of them is before dispatch (stage not `dispatched` / `closed`). It is read in two steps:
- (1) `orders.findMany({ where: { isRemoved: false, workflowStage: { notIn: ["cancelled","dispatched","closed"] }, soNumber: { not: null } }, select: { soNumber } })`
  gives the distinct SOs of open bills (hundreds).
- (2) `getDuplicateGroups(thoseSOs)` runs the bounded `in` read on `idx_orders_sonumber` and applies
  the acknowledgement filter.

This is never a full-table group-by.

| Route | Method · gate | Input | Writes | Reuses |
|---|---|---|---|---|
| `/list` | GET · **canView** | `?month=YYYY-MM` | none | `getDuplicateGroups`. Per bill: OBD, stage, `obdEmailDate`, `querySnapshot` volume/articleTag, active line count, dispatchStatus, trip number, `refusal` (from `offFloorRefusal`, so the Pick delete button is hidden on a refused bill) + the group hint (identical multiset of active `(skuCodeRaw, unitQty)` → "looks like a double punch", otherwise "split"), from ONE batched `import_raw_line_items` read. **Decided**: decisions with `decidedAt` in the IST month, newest first, plus live state (bill still cancelled? restored on Floor?) |
| `/marker` | GET · **canView** | — | none | `{ count, latest }` for `usePickingMarker`. `count` = open groups (the same read as `/list`); `latest` = the later of `MAX(pick_delete_decisions.updatedAt)` and `MAX(orders.updatedAt)` over the open bills. Returns `count` and `latest` exactly (CLAUDE_PICKING §10 four-field contract) |
| `/bill/[orderId]` | GET · **canView** | orderId | none | the line read of `app/api/billing/picking/order/[orderId]/route.ts` — active `import_raw_line_items` by `obdNumber`, names via `resolveCatalogByCode` (`lib/picking/resolve-lines.ts`). No findings, no `isPending`. Own gate, per the decisions file — it does not borrow `billing_picking` |
| `/all-ok` | POST · **canEdit** | `{ soNumber, orderIds }` | ONE `pick_delete_decisions.create` (kind `all_ok`, sorted ids) | re-reads the SO's current twin set. **409** if it differs from `orderIds` ("group changed — refresh") or if < 2. P2002 on the live key → 200 `{ alreadyDone: true }` |
| `/delete` | POST · **canEdit** | `{ orderId, soNumber, orderIds }` | per §3a | `offFloorRefusal` · `findLiveCi` + `liveCiRefusal` (`lib/ci/live-ci.ts`) · `buildCancelNote("duplicate_bill")` · Picking cancel's write order (`app/api/picking/cancel/route.ts:198-243`) and push block (`:274-285`, with new text) |
| `/undo` | POST · **canEdit** | `{ decisionId }` | per §3b | Floor restore's live-CI refusal (`actions/route.ts:269-280`); the write is the import fallback's release shape (`pending_picking` + `dispatch`), NOT Floor's restore write |

### 3a. Pick delete — order of work

1. Read the order: `id, obdNumber, soNumber, workflowStage, isRemoved, tripDropId, tripDrop.trip.tripNumber, pickAssignment.pickerId`, the dealer names for the push.
2. Refuse, returning 409 with a message:
   - removed;
   - `soNumber` does not match;
   - `offFloorRefusal` (already cancelled, dispatched, on a trip, tint room);
   - legacy `closed` (not covered by `offFloorRefusal`) — owner ruling 2026-09-27;
   - a live CI on the bill (`findLiveCi`, the same rule and wording as Picking cancel,
     `app/api/picking/cancel/route.ts:179-181`) — owner ruling 2026-09-27;
   - the current twin set is not equal to the posted `orderIds` ("group changed");
   - the bill is the last live twin.
3. `orders.update { workflowStage: "cancelled", dispatchStatus: null }` — ONE update.
4. `pick_assignments.deleteMany({ where: { orderId } })` — after the stage write, never before (the orphan fix).
5. ONE `order_status_logs` row: `fromStage`, `toStage: "cancelled"`, `changedById`,
   `note: buildCancelNote("duplicate_bill")` → "Cancelled — Duplicate bill".
6. `pick_delete_decisions.create`: kind `pick_delete`, `orderIds` (sorted), `deletedOrderId`,
   `deletedFromStage`, `deletedPickerId` (read in step 1), `keptOrderIds`, `decidedById`.
   **If this throws**: `console.error` and return 200 with a `warning`. The bill is cancelled and sits
   on Floor's Cancel & CI tab, but it gets no card and cannot be undone from Billing. A double press
   is already stopped at step 2 ("Already cancelled").
7. Push to `deletedPickerId` unless it is the actor. Text: **"Bill {OBD} pick deleted. Correct pick
   {OBD(s)}"** (owner ruling 2026-09-27 — not "stop picking"). Copied block, awaited and
   swallowed (NOTIFICATIONS §2 rule). Response `{ ok, decisionId, keptObdNumbers }`.

The same writes as Floor cancel, with no CI raised and no invoice / SAP check (locked decision). An
existing live CI on the bill is a REFUSAL (step 2), matching Picking cancel.

### 3b. Undo

- **all_ok** → `update { undoneAt, undoneById }`. The flag returns on the next rule read.
- **pick_delete**:
  - Refuse if the decision was already undone.
  - If the bill is **no longer `cancelled`** (restored on Floor meanwhile), only stamp the decision
    undone and write nothing to the bill.
  - Refuse if the bill has any live CI (Floor restore's rule, `actions/route.ts:269-280`).
  - Otherwise: ONE `orders.update { workflowStage: "pending_picking", dispatchStatus: "dispatch" }`
    (the import fallback's release shape, `SUPPORT_DONE_OUTPUT`; slot fields untouched), ONE log
    `cancelled → pending_picking` "Restored — pick delete undone", then stamp the decision undone.
  - The bill is back on the Assign tab. The old assignment is gone, so a supervisor re-assigns.
  - *History: `pending_support` (Floor's restore write) was proposed first and rejected — it strands
    the bill, because an unheld `pending_support` bill has no Release button (`detail-panel.tsx:631`).*
  - **Tint exception (owner ruling 2026-09-27):** if `deletedFromStage = 'pending_tint_assignment'`
    ("Awaiting Tint", rank 20 — the only waiting-for-tint stage Pick delete can cancel;
    `tint_assigned` / `tinting_in_progress` are refused by `offFloorRefusal`), the Undo writes
    `{ workflowStage: "pending_tint_assignment", dispatchStatus: null }` and logs
    `cancelled → pending_tint_assignment`. Not stranded: Tint Manager's Set A reads
    `orderType "tint"` at `pending_tint_assignment` (`app/api/tint/manager/orders/route.ts:127`)
    and its rail takes exactly that stage; Floor shows it on the Tinting tab (board arm 2); tint
    done releases a non-held bill itself (`app/api/tint/operator/done/route.ts:196-224`).
    *Refusing it was proposed first and rejected.*

---

## 4. Rule change — `getDuplicateSoNumbers()`

**Today:** one `groupBy` returning counts only (`duplicate-so.ts:63-71`). It never sees ids.

**New shape** — the bounded input is unchanged:

```
getDuplicateGroups(soNumbers): Promise<Map<string, number[]>>     // NEW export, step 5
  candidates = non-blank distinct soNumbers                          // unchanged (:56-61)
  Q1 rows = orders.findMany({ where: { soNumber: { in: candidates }, isRemoved: false,
                                       workflowStage: { not: "cancelled" } },       // same twin rule
                             select: { id: true, soNumber: true } })                // idx_orders_sonumber
  groups = so → sorted ids, keep length ≥ 2
  if groups empty → return
  Q2 acks = pick_delete_decisions.findMany({ where: { kind: "all_ok", undoneAt: null,
                                             soNumber: { in: [...groups.keys()] } },
                                   select: { soNumber: true, orderIds: true } })
  drop SO when isAcknowledged(currentIds, ackSets)                     // pure, exported
  return groups

isAcknowledged(current, ackSets) = ackSets.some(ack => current.every(id => ack.includes(id)))

getDuplicateSoNumbers(soNumbers) = new Set((await getDuplicateGroups(soNumbers)).keys())   // step 6
```

- **Acknowledged = every current twin is in an active All OK set.** A NEW bill joining the SO brings
  the flag back. A twin that later leaves (cancelled or removed) does not bring it back — the rest were
  already approved. This satisfies both lines of the decisions file ("saved against the exact SET" and
  "a new bill joining brings the group back"). **Owner ruling 2026-09-27: this rule, not strict
  equality** (§11.3).
- It reads only SOs already on screen: Q1 replaces the `groupBy` with the same `in` list, and Q2 runs
  only when a group exists. That is two queries instead of one, both bounded.
- **Both callers are unchanged** — `lib/picking/queue.ts:670` and `lib/floor/queries.ts:851` keep
  calling `getDuplicateSoNumbers`, and the return type is unchanged.
- Pick delete needs **nothing** here: a cancelled bill is not a twin (`:68`), so the survivor clears
  on its own.

**Billing pill count** — computed cheaply from `/api/billing/pick-delete/marker`:
- step 1: open-bill SOs;
- step 2: the `in` read on `idx_orders_sonumber`;
- step 3: the acknowledgement read over the dup SOs only.

The table is tiny, so no scan is unbounded. The tab bar also fetches the count once on mount, gated on
`showPickDelete` (the Telephonic pattern, `billing-tab-bar.tsx:92-115`).

---

## 5. Picker + supervisor card — pick-deleted bills stay until end of day (IST)

**Constraint.** A cancelled bill falls out of `buildPickingWhere` (every branch pins
`dispatchStatus: "dispatch"`, `queue.ts:344-356`), and the cancel deletes `pick_assignments`, so the
picker narrowing `{ pickAssignment: { pickerId } }` (`queue.ts:551-552`, `marker/route.ts:111-112`)
can never find it.

**Design: a SIBLING array, never a row.**

- `PickingQueueResult` (`lib/picking/queue.ts:257`) gains `pickDeleted: PickDeletedCard[]` beside
  `waitingSkus` and `oilSkus`.
- It is built in `getPickingQueue()` (`queue.ts:526`) by ONE read, only for `scope: "openPending"`:
  - `pick_delete_decisions` where `kind = 'pick_delete'`, `undoneAt IS NULL`, `decidedAt` in
    `getISTDayRange()`, and `deletedOrder.workflowStage = 'cancelled'` (so a bill restored on Floor
    drops out);
  - plus, for a `pickerId` request, `deletedPickerId = options.pickerId` — **scoped by the decision
    row, not the deleted assignment**;
  - then one `orders.findMany` over the `keptOrderIds` for the "Correct pick" OBDs (live, still-live
    only).
- `PickDeletedCard` (`lib/picking/types.ts`):
  `{ orderId, obdNumber, dealerName, deletedFromStage, pickerId, pickerName, decidedAt, correctObds: string[] }`.
  The dealer name uses the same fallback chain as the queue (`queue.ts:844-847`).
- **Why not a row flag:** the standing PICKING §7 rule — every `!isAssigned && !isDone && !isChecked`
  filter (`queue.ts:979`, `picker-split.ts:126`, the boards' waiting lists) would read a cancelled row
  as "waiting". Keeping them out of `rows` means no count, no bundle, no selection, and no Mark done,
  Approve or Assign can ever reach them. `splitPickerRows` (`lib/picking/picker-split.ts:115`) is
  **unchanged**.
- **The queue is not widened.** Only today's pick-delete decisions are read — never "all cancelled bills".

**Render.**
- Supervisor (`components/picking/picking-board-mobile.tsx`): a read-only band, "Pick deleted today",
  at the foot of the **Done** tab.
- Picker (`components/picking/picker-my-picks-board.tsx`): the same band at the foot of **Pending**.
- Each card is a slim variant with no tap-select, no arrow, no CTA:
  - a new `PickDeleteTag` (`components/picking/pick-delete-tag.tsx`: `bg-danger-bg text-danger-text`,
    label "Pick delete");
  - one plain line, "Correct pick: 9108841163" (comma-joined if several), `text-ink-600`;
  - no red card fill.
- Tap does nothing. There is no button and no jump.
- The correct bill shows no tag because its row's `hasDuplicateSo` is false (§4).

**Plumbing.**
- `components/picking/picking-mobile-shell.tsx`: both shells already hold the whole
  `PickingQueueResult`. `PickerPickingShell` keeps `rows` separately, so it also keeps `pickDeleted`
  from its fetch (`:330`).
- `app/picking/page.tsx:180` seeds the picker's first paint with `pickerFaceData.pickDeleted`.

**Live sync.**
- A pick delete of a bill that was in the picking set moves the marker by itself: the bill leaves the
  set, `count` drops, and the one `orders.update` moves `latest`.
- For deletes of bills outside the set, for Undo, and for All OK, the Picking marker folds in the
  decisions clock (§7, step 6).

---

## 6. Floor

- **A pick-deleted bill lands on the Cancel & CI tab with no new code.** `getFloorCancelled`
  (`lib/floor/queries.ts:1319`) lists bills with a `toStage: "cancelled"` log today (`:1378`) that are
  still cancelled.
- **What the row shows** (`FloorCancelledRow`, `lib/floor/types.ts:477-499`):
  - `action: "cancel"`, OBD, live invoice number, party, weight;
  - reason **"Duplicate bill"** (`parseCancelNote`, `lib/floor/off-floor.ts:99`, reading
    "Cancelled — Duplicate bill");
  - `byName` = the billing user, `at` = the cancel time.
- Floor's **Restore** is offered (no CI) and still works for floor holders. If used, the billing
  decision stays active: `/undo` then only stamps it, the picker card disappears (it checks
  `workflowStage = 'cancelled'`), and the flag returns on its own.
- **The correct bill loses the soft tag automatically.** Its `hasDuplicateSo` is recomputed with no
  live twin (`duplicate-so.ts:68`). It reaches the screen on the next board load: the floor marker
  fires because the deleted bill left the floor set, or else through the 30 s full poll.

---

## 7. Live refresh — recommendation

**Pick: do NOT touch `orders.updatedAt`. Fold the decisions clock into the Picking and Floor markers'
`latest`** — the variant of "accept the poll" that loses nothing.

- `app/api/picking/marker/route.ts` (after `:115`) and `app/api/floor/marker/route.ts` (`:40-47`):
  `latest = max(MAX(orders.updatedAt) over the set, MAX(pick_delete_decisions.updatedAt))`.
- That adds one aggregate on a tiny table. The response shape is unchanged (`count`, `latest`), so
  the hook contract holds — the same trick as the tint-workload marker returning the later of two
  clocks (CLAUDE_PICKING §10).
- **Why not touch the orders.** An All OK is not an order-state change. Writing `updatedAt` on two or
  three bills (possibly picked, checked, or on a trip) is exactly the "second write for sync"
  CORE §3 warns against. It would fire every other board's marker (billing Picking, Print), and it
  records nothing in `order_status_logs`.
- **Why not just accept the miss.** Picking has no full poll — its board would stay red until an
  unrelated change. Floor's 30 s poll also pauses while the panel is open or a selection is up
  (CLAUDE_FLOOR §5).
- **Cost:** any decision anywhere refetches every open board once. Decisions are rare (0 new groups
  in 7 days), so this is acceptable.

---

## 8. Billing UI

| File | What |
|---|---|
| `components/billing/billing-pick-delete-access-provider.tsx` (new) | `canView` / `canEdit` courier |
| `components/billing/billing-marker-provider.tsx` | `BillingPickDeleteMarkerProvider` + subscribe/pause hooks — a copy of the Telephonic trio (`:223-270`), url `/api/billing/pick-delete/marker` |
| `components/billing/billing-tab-bar.tsx` | `BillingTab` adds `"pick_delete"` (`:21`); `showPickDelete` + a count fetch; the pill after Telephonic (`:228`), rendered as its own warn pill (below), never hidden at 0 — grey |
| `components/billing/billing-pick-delete-tab.tsx` (new) | the tab body: "Needs your decision" (one group at a time, ‹ Prev / Next ›, Group N of M), the confirmation panel, the Decided table |
| `app/(mail-orders)/mail-orders/mail-orders-page.tsx` | access hook; `effectiveBillingTab` term; the header slot shows the month picker on this tab too (`:1316` — reuse `TelephonicMonthPicker`, `billing-telephonic-tab.tsx:143`, with its own month state); mount the marker provider (`:1543`). The keyboard guards are already `!== "orders"` (`:975`, `:1081`) — no edit |
| `app/(mail-orders)/mail-orders/review-view.tsx` | props; the inbox column hidden on this tab too (`:2846`); `showPickDelete` to the tab bar (`:2993`); a body arm after Telephonic (`:3009`), full width like Telephonic; the bottom bar belongs to the selected-order arm, so it does not show |
| `app/(mail-orders)/mail-orders/layout.tsx` | read the key, nest the provider |

**Behaviour.**
- The confirmation panel replaces the group and shows:
  - ✓ **All OK** + customer, or ✕ **Pick deleted** + customer · "Correct pick {OBD}";
  - a 6 s countdown bar;
  - **Undo** (calls `/undo`, cancels the timer) and **Next group ›** (skips the wait).
- When the timer ends it opens the next group, or "Nothing to decide".
- `prefers-reduced-motion` → a static bar; the timer still runs.
- The marker is paused while a write is in flight or the panel is up (the Picking-tab pause pattern,
  `billing-picking-tab.tsx:190`).

**Mockup → Orbit tokens** (CLAUDE_UI §1, §2.1, §10; no raw colours):

| Mockup | Orbit class |
|---|---|
| `.pd-pill` (warn) | `border border-warn/30 bg-warn-bg text-warn-text`; dot `bg-warn`; count `bg-warn-text text-white` (check the contrast at build) |
| `.pd-pill.zero` | `border border-ink-100 bg-ink-50 text-ink-500`; dot `bg-ink-400`; count `bg-ink-400 text-white` |
| `.new-tag` "NEW" | **omit** — a mockup aid, and brand is reserved for the commit |
| `.group` left bar | `border-l-[3px] border-l-warn` |
| `.btn-ok` "All OK, keep all bills" / "Next group ›" | the commit: `bg-brand-600 hover:bg-brand-700 text-white` — one per surface state |
| `.btn-cx` "Pick delete this bill" | danger outline: `border border-danger-bd bg-white text-danger-text hover:bg-danger-bg` |
| `.hint-dup` | `border border-warn/30 bg-warn-bg text-warn-text` |
| `.hint-split` | `border border-ok/30 bg-ok-bg text-ok-text` |
| `.ltab tr.same` / `.same-chip` | `bg-warn-bg` / `text-warn-text` |
| `.donep` (All OK) | `border border-ok/30 border-l-[3px] border-l-ok`; tick `bg-ok-bg text-ok-text` |
| `.donep.del` | `border border-danger-bd border-l-[3px] border-l-danger`; tick `bg-danger-bg text-danger-text` |
| `.bar6` countdown | track `bg-ink-100`, fill `bg-ink-500` |
| `.btn-sm` Undo, Prev/Next, `.stage` pill | secondary: `border border-gray-200 bg-white text-gray-600` (UI §10); stage `bg-ink-50 text-ink-700` |
| `.p-del` / `.p-ok` / `.p-undone` | `bg-danger-bg text-danger-text` / `bg-ok-bg text-ok-text` / `bg-ink-50 text-ink-500` |
| Decided table | UI §27 fixed table (`table-layout: fixed`, `<colgroup>` %) |
| `.toast` (Undo from the Decided list) | reuse the tab's existing notice pattern, text only — no new toast library |

---

## 9. Commit plan

Everything goes to `main`; files are staged by name. Each code step exits on `npx tsc --noEmit`
passing. Before any push, the unpushed commits are re-listed and shown (another session commits to
`main`).

| Step | Commit | Files | Notes |
|---|---|---|---|
| 3 | `sql: pick_delete_decisions` | `sql/2026-09-2x-pick-delete-decisions.sql` | Smart Flow runs PART 1, then PART 2's read-only verify. The commit records what ran |
| 4 | `schema v27.42 + billing_pick_delete key` | `prisma/schema.prisma` (model + 4 back-relations; optionally `idx_orders_sonumber`), `docs/CLAUDE_CORE.md` (§7 chain entry v27.42 with the live constraint text from PART 2), `lib/permissions.ts` | then `npx prisma generate` |
| 5 | `billing: pick-delete routes` | `lib/picking/duplicate-so.ts` (**additive only**: `getDuplicateGroups`, `isAcknowledged`; `getDuplicateSoNumbers` untouched), `lib/billing/pick-delete.ts` (new), `lib/billing/pick-delete-types.ts` (new), `app/api/billing/pick-delete/{list,marker,all-ok,delete,undo}/route.ts`, `app/api/billing/pick-delete/bill/[orderId]/route.ts` | ⚠ `duplicate-so.ts` is edited in steps 5 AND 6 — stated deliberately; step 5 adds, step 6 re-points |
| 5b | `import: enrichment never rewrites cancelled or removed bills` | `app/api/import/obd/route.ts` only | Owner ruling 2026-09-27 (no longer ROADMAP). Add `isRemoved: false, workflowStage: { not: "cancelled" }` to the `orders.updateMany` at `:368-371` and to the `heldAt` loop's `findMany` at `:491` (the block is `:490-501`, a per-bill `orders.update`, not an `updateMany`). Line numbers verified at HEAD `d66bfb20`; re-read before editing. Touches nothing else in the file |
| 6 | `picking: duplicate rule honours All OK; markers fold the decisions clock` | `lib/picking/duplicate-so.ts` (`getDuplicateSoNumbers` → `getDuplicateGroups`; fix the stale `:49` comment), `app/api/picking/marker/route.ts`, `app/api/floor/marker/route.ts` | queue.ts and floor queries unchanged |
| 7 | `billing: Pick delete tab` | `components/billing/billing-pick-delete-access-provider.tsx` (new), `billing-pick-delete-tab.tsx` (new), `billing-tab-bar.tsx`, `billing-marker-provider.tsx`, `app/(mail-orders)/mail-orders/layout.tsx`, `mail-orders-page.tsx`, `review-view.tsx` | |
| 8 | `picking: today's pick-deleted cards` | `lib/picking/queue.ts`, `lib/picking/types.ts`, `components/picking/pick-delete-tag.tsx` (new), `picking-mobile-shell.tsx`, `picking-board-mobile.tsx`, `picker-my-picks-board.tsx`, `app/picking/page.tsx` | |
| 9 | `sql: billing_pick_delete grants` | `sql/2026-09-2x-billing-pick-delete-grants.sql` | the shape of `sql/2026-09-24-billing-hand-ci-grants.sql`: an all-false row per user, then canView + canEdit for exactly five users — **Deepanshu Thakur, Prakash, Bankim, Chandresh Kolgha, Operations User** (the holders of `billing_print` / `billing_telephonic` / `billing_ci`, live SELECT 2026-09-27). Match users by id resolved from name in the SQL, never hardcoded ids. **Data, never from seed** |
| 10 | smoke | none (or a small `scripts/_smoke-pick-delete.ts`, outside the tsc gate) | `tsc`; `next build`; unit-check `isAcknowledged`/the hint with fixtures; read-only SELECTs before and after the grants. **No logging in with anyone's credentials** — the dev server points at production. The owner hand-tests on production: All OK, Pick delete, Undo ×2, a picker card, the Floor tab |
| 11 | `docs: code-update draft` | `docs/prompts/drafts/code-update-2026-09-2x-billing-pick-delete.md` | for the next consolidation: BILLING (tab 5, the key, routes), PICKING §5.2 (ownership: the rule stays Picking's, the decision is Billing's; the sibling card), FLOOR (Cancel & CI reason), NOTIFICATIONS §2 (a new push caller), CORE §5 key table |

No file is edited by two steps except `lib/picking/duplicate-so.ts` (5 and 6), as stated.
Step 3 ships `docs/prompts/drafts/2026-09-27-pick-delete-table.sql`, copied to `sql/` in its commit.

---

## 10. Step 2 — the one read-only SELECT

```sql
-- READ-ONLY. Step 2 of the Pick delete build. Run in the Supabase SQL Editor.
SELECT 'grant_holder'::text AS q, u.name::text AS a, upa."pageKey"::text AS b,
       upa."canView"::text AS c, upa."canEdit"::text AS d
FROM user_page_access upa JOIN users u ON u.id = upa."userId"
WHERE upa."pageKey" IN ('billing_print', 'billing_telephonic', 'billing_ci', 'mail_orders')
  AND (upa."canView" OR upa."canEdit")
UNION ALL
SELECT 'grant_rows', upa."pageKey"::text, count(*)::text,
       sum(CASE WHEN upa."canView" THEN 1 ELSE 0 END)::text,
       sum(CASE WHEN upa."canEdit" THEN 1 ELSE 0 END)::text
FROM user_page_access upa
WHERE upa."pageKey" IN ('billing_print', 'billing_telephonic', 'billing_ci', 'billing_pick_delete')
GROUP BY upa."pageKey"
UNION ALL
SELECT 'table_exists', table_name::text, table_schema::text, NULL::text, NULL::text
FROM information_schema.tables
WHERE table_schema = 'public'
  AND (table_name ILIKE '%pick_delete%' OR table_name ILIKE '%decision%' OR table_name ILIKE '%so_ack%')
UNION ALL
SELECT 'index_exists', indexname::text, tablename::text, indexdef::text, NULL::text
FROM pg_indexes
WHERE schemaname = 'public'
  AND (indexname ILIKE '%pick_delete%' OR indexname ILIKE '%decision%' OR indexname ILIKE '%sonumber%')
UNION ALL
SELECT 'col_type', table_name::text, column_name::text, data_type::text, column_default::text
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'orders' AND column_name IN ('id', 'soNumber', 'updatedAt'))
    OR (table_name = 'users'  AND column_name = 'id'))
UNION ALL
SELECT 'open_groups', count(*)::text, sum(g.n)::text, sum(g.on_trip)::text, NULL::text
FROM (
  SELECT o."soNumber", count(*) AS n,
         sum(CASE WHEN o."tripDropId" IS NOT NULL THEN 1 ELSE 0 END) AS on_trip
  FROM orders o
  WHERE o."isRemoved" = false
    AND o."workflowStage" <> 'cancelled'
    AND o."soNumber" IS NOT NULL AND btrim(o."soNumber") <> ''
  GROUP BY o."soNumber"
  HAVING count(*) > 1
     AND bool_or(o."workflowStage" NOT IN ('dispatched', 'closed'))
) g
UNION ALL
SELECT 'users', count(*)::text, sum(CASE WHEN "isActive" THEN 1 ELSE 0 END)::text, NULL::text, NULL::text
FROM users
UNION ALL
SELECT 'access_source', value::text, NULL::text, NULL::text, NULL::text
FROM system_config WHERE key = 'ACCESS_SOURCE';
```

(`open_groups` returns groups · bills · bills on a trip.)

**Result, run by Smart Flow 2026-09-27:**
- no table or index named like `pick_delete` / `decision` / `so_ack` exists — no conflict;
- `orders.id` and `users.id` are `integer`;
- `ACCESS_SOURCE = user`;
- open groups under the new rule: **10 groups / 21 bills, 10 of those bills on a trip** (a trip bill
  is refused by Pick delete, so some groups can only be answered with All OK or by taking the bill
  off its trip first);
- `billing_print`, `billing_telephonic` and `billing_ci` are held (view + edit) by the same five users:
  Deepanshu Thakur, Prakash, Bankim, Chandresh Kolgha, Operations User.

---

## 11. Owner rulings (2026-09-27) — was "Risks and open questions"

1. **Undo of a Pick delete returns the bill to `pending_picking` with `dispatchStatus = 'dispatch'`**
   (ready to assign, slot kept) — §3b. *History: `pending_support` was proposed first and rejected —
   it strands the bill* (no Release button for an unheld bill, `detail-panel.tsx:631`).
   A bill deleted from `pending_tint_assignment` returns to that stage (the tint queue) instead
   (§3b; refusing it was proposed first and rejected).
2. **The pick-deleted card sits at the FOOT of the list** — supervisor Done tab, picker Pending tab (§5).
3. **All OK = every current twin is in an approved set;** a new bill joining brings the flag back (§4).
4. **Pick delete REFUSES a bill with a live CI** — `findLiveCi`, as Picking cancel does (§3a).
5. **Bills at the legacy `closed` stage are refused** (§3a).
6. **Picker push text: "Bill {OBD} pick deleted. Correct pick {OBD(s)}"** — not "stop picking" (§3a step 7).
7. **One refresh of every open board per decision is accepted** (§7).
8. **The enrichment re-hold bug is fixed inside this build**, as its own commit (step 5b, §9). It is
   no longer a ROADMAP item.
9. **Grants (step 9):** `billing_pick_delete` canView + canEdit to exactly Deepanshu Thakur, Prakash,
   Bankim, Chandresh Kolgha and Operations User (§9, §10 result).

Remaining risk, recorded rather than open: 10 of today's 21 bills in open groups are on a trip, and
Pick delete refuses a bill on a trip (`offFloorRefusal`) — such a bill is taken off its trip on Floor
first, or its group is answered with All OK.
