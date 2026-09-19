# Code discovery — CI (Goods Return Note) module readiness

**Date:** 2026-08-31 · **Step:** 0 of the CI build · **Type:** read-only discovery. No code written, no file edited but this one, no SQL write.
**Method:** live read-only SELECTs (CORE §3) + source trace. Where a doc and the code disagreed, the code won and it is called out.

---

## 0. 🔴 THE SPEC NAMED IN THE PROMPT DOES NOT EXIST

`docs/prompts/drafts/web-update-2026-08-31-ci-module.md` — **file not found.** Confirmed three ways:

```
find . -iname '*ci-module*'                      → nothing
find . -iname '*2026-08-31*'                     → 3 files, none is the CI spec
rg -l -i 'Goods Return Note|credit note|GRN'     → no CI spec among the hits
git log --all --name-only | grep -i 'ci-module'  → nothing (never committed, never deleted)
git status                                        → not untracked either
```

It is not tracked, not untracked, not in history under that or any similar name, and nothing in the repo mentions "Goods Return Note".

**Consequence:** section 3 of this report — "Spec corrections", i.e. every place the CI spec is wrong — **cannot be written.** There is no spec to check. Everything else in the prompt asks about the LIVE CODE AND DATA, so **A–F are complete and unaffected**, and they are what step-1 SQL actually needs. Section 3 below records what would have been checked against it.

---

## 1. Files read

**Docs**
| File | Version read |
|---|---|
| `CLAUDE.md` (router) | v1.10 |
| `docs/CLAUDE_CORE.md` | v96 · Schema v27.18 · updated 2026-09-01 |
| `docs/CLAUDE_UI.md` | v5.18 · updated 2026-08-05 (no schema stamp, by design) |
| `docs/prompts/drafts/web-update-2026-08-31-ci-module.md` | ⛔ **DOES NOT EXIST** — see §0 |

**MRN module — every file opened**

| File | What it does |
|---|---|
| `app/mrn/page.tsx` | Server page. Role branch → billing desk face vs supervisor phone face. Copies `app/picking/page.tsx`. Seeds **no** first-paint data |
| `app/mrn/[mrnId]/sheet/page.tsx` | Standalone printable A4 landscape sheet, read-only; fetches its own MRN server-side |
| `app/api/mrn/board/route.ts` | GET — **both** faces off one route. Read-only, zero writes |
| `app/api/mrn/create/route.ts` | POST — billing raises a header |
| `app/api/mrn/marker/route.ts` | GET — the 15s change-marker probe. **Supervisor only, by design** |
| `app/api/mrn/resolve-skus/route.ts` | POST — raw SAP codes → name + pack |
| `app/api/mrn/[mrnId]/route.ts` | GET — one MRN: header + lines + batches, SKU-resolved |
| `app/api/mrn/[mrnId]/start/route.ts` | POST — Start unloading (`status='checking'`) |
| `app/api/mrn/[mrnId]/end/route.ts` | POST — End unloading (`status='done'`) |
| `app/api/mrn/[mrnId]/lines/route.ts` | PUT — **replaces** every line from a pasted STI block |
| `app/api/mrn/[mrnId]/line/[lineId]/route.ts` | PUT — supervisor confirms ONE line (qty + condition counts + batches) |
| `app/api/mrn/[mrnId]/header/route.ts` | PATCH — billing edits the header |
| `app/api/mrn/[mrnId]/export/route.ts` | GET — the MRN as `.xlsx` |
| `app/api/mrn/[mrnId]/delete/route.ts` | POST — soft-remove; lines/batches stay |
| `components/mrn/mrn-shell.tsx` | Two shells in one file (Direction-A, Picking's shape). Owns tabs, fetch, marker polling |
| `components/mrn/supervisor-board.tsx` | **The supervisor phone board** + its detail screen |
| `components/mrn/supervisor-card.tsx` | One truck on the supervisor's phone |
| `components/mrn/line-list.tsx` | 🔴 **`MrnLineBand` + `MrnLineRows` + `LineRow` — the supervisor's LINE ROW.** See A2 |
| `components/mrn/line-sheet.tsx` | The confirm sheet — qty, condition counts, batches. "The heart of the module" |
| `components/mrn/billing-board.tsx` | Billing's desk composition root |
| `components/mrn/mrn-rail.tsx` | Billing's left rail, flat list |
| `components/mrn/rail-card.tsx` | One truck on the rail |
| `components/mrn/detail-pane.tsx` | Billing's right-hand working pane |
| `components/mrn/lines-table.tsx` | Billing's **desktop** line table (not the phone one) |
| `components/mrn/line-drawer.tsx` | Billing's per-line drawer |
| `components/mrn/new-mrn-modal.tsx` · `edit-header-modal.tsx` · `delete-mrn-modal.tsx` · `paste-lines-modal.tsx` · `end-sheet.tsx` | P1 / P4 / P5 / P2+P3 / S10 modals |
| `components/mrn/modal-shell.tsx` | The shared modal shell (`CLAUDE_UI.md §13`) |
| `components/mrn/status-pill.tsx` · `format.ts` · `print-sheet.tsx` · `print-sheet-button.tsx` | Status pill · display formatters · A4 print sheet · print trigger |
| `lib/mrn/types.ts` | Wire shapes — `MrnDetail`, `MrnDetailLine`, board payloads |
| `lib/mrn/queries.ts` | Read feeds + `buildMrnSupervisorWhere()` (shared by board **and** marker) |
| `lib/mrn/number.ts` | 🔴 `allocateMrnIdentity()` — the number allocator. See B |
| `lib/mrn/derive.ts` | Every derived value. Pure — no Prisma, no clock |
| `lib/mrn/resolve-lines.ts` | 🔴 SKU resolution, `sku_master_v2.material` only. See D3 |
| `lib/mrn/paste.ts` · `report.ts` · `workbook.ts` | STI paste parser · report shape · `.xlsx` builder |

**Followed out of MRN**
`lib/hooks/use-picking-marker.ts` · `lib/permissions.ts` · `lib/rbac.ts` · `middleware.ts` · `components/shared/role-sidebar.tsx` · `components/admin/permissions-manager.tsx` · `lib/hide/tag-catalog.ts` · `lib/mail-orders/utils.ts` · `lib/mail-orders/customer-match.ts` · `prisma/schema.prisma` (`mrn`, `mrn_lines`, `mrn_line_batches`, `orders`, `delivery_challans`, `import_raw_line_items`) · `app/api/import/obd/route.ts` · `app/api/tint/manager/manual-entry/route.ts` · `app/api/admin/fix-challans/route.ts` · `prisma/seed.ts`

---

## 2. Findings

### A. MRN layout — what CI reuses

#### A1 · Inventory
Above, in §1. **43 files**: 2 pages, 12 API routes, 21 components, 8 lib modules.

Shape worth copying wholesale: **one route, two faces branching on `primaryRole`, never on viewport** (`app/mrn/page.tsx`); **both faces served by ONE read route** (`/api/mrn/board`); **all pure logic in `lib/mrn/*`, zero Prisma in `derive.ts`**.

#### A2 · 🔴 The line-row component

**`LineRow`, a module-private function inside `components/mrn/line-list.tsx`**, rendered through the exported `MrnLineRows`. It is *not* `lines-table.tsx` — that is billing's desktop table, reached via `detail-pane.tsx`. Import trace (`supervisor-board.tsx:13-14`):

```ts
import { MrnLineBand, MrnLineRows } from "./line-list";
import { LineSheet } from "./line-sheet";
```

**Exported props:**
```ts
MrnLineRows({ detail, activePackFilter, onOpenLine }: {
  detail: MrnDetail;
  activePackFilter: string;
  onOpenLine: (line: MrnDetailLine, index: number) => void;
})

MrnLineBand({ detail, activePackFilter, onPackFilter }: {
  detail: MrnDetail;
  activePackFilter: string;
  onPackFilter: (key: string) => void;
})
```
`LineRow` itself takes `{ line: MrnDetailLine; onClick: () => void }`.

**Columns rendered, in order:**
1. **Pack gutter** — `w-14` (56px) `shrink-0`, full card height via `items-stretch`, `bg-#f8fafa` + right border. `line.pack ?? "—"`, 13px bold.
2. **Body** — `flex-1 min-w-0`. Line 1: `line.skuCode`, `font-mono text-[17px] font-bold truncate`. Line 2 (**checked rows only**): batch text `MM/YY · qty  +  MM/YY · qty` and/or a derived issue label (`Short n` / `Excess n` / `Leaky n` / `Damage n` / `Empty n`), 11.5px. Whole body drops to `opacity-55` once checked.
3. **Qty** — `shrink-0 px-3.5`, one centred `text-[26px] font-extrabold tabular-nums`. Value is `line.physicalQty ?? line.qtySti`; **red `#b42318`** when confirmed and physical ≠ STI, grey `#b6bcc6` when confirmed and equal.

Deliberately absent, both documented in-source: **no tick circle** (a supervisor cannot confirm from the list — confirming needs qty + mfg dates, which only the sheet takes) and **no description** (the row is the mono SKU he matches against the shelf).

**Reusable as-is? NO — and it should not be forced.** Three reasons, in order of severity:

1. **It is not exported.** `LineRow` is module-private; only `MrnLineRows` is public, and that takes a whole `MrnDetail`.
2. **It is typed on `MrnDetailLine`**, which is MRN-shaped through and through: `qtySti`, `physicalQty`, `cartonQty`, `batches[]`, plus `MrnConditionCounts` (SND/Lky/Damage/Empty/QTD/REJ) and `MrnLineDerived`. A CI line has none of `qtySti`/`batches` and needs an invoiced-qty and a returned-qty instead.
3. **`MrnLineRows` reads `detail.lines`, `detail.checkedLineCount`, `detail.lineCount`, `detail.issueLineCount`, `detail.unloadingStartAt`** — MRN header fields that do not exist on a CI.

**The right move — and it is the one this codebase already made twice.** `line-list.tsx`'s own header says it was **COPIED verbatim from picking's detail screen, not approximated**, and its tokens are duplicated from `picking-board-mobile.tsx` "because that file does not export them — the same way `picker-my-picks-board.tsx` carries its own copies. **Tokens, not rules.**" That is the module's stated convention: *copy the layout, never share the row component across modules.*

So CI gets **`components/ci/line-list.tsx`, a copy**, typed on its own `CiDetailLine`, with every className, padding, radius, size, weight and colour lifted byte-for-byte. That satisfies "same layout as MRN, no layout change" exactly, and it is what Picking→MRN already did.

⚠ **The one genuinely shared thing to reuse, not copy:** `sortPackLabels` from `@/lib/picking/pack-sort` (imported at `line-list.tsx:4`). That IS a rule — alphabetical would put "100ML" before "1L".
⚠ **Do not lose `items-stretch`** on the card `<button>`. In-source note: Tailwind's `flex` sets display only, and a `<button>` does not inherit the initial `align-items: stretch` a `<div>` gets. Without it the pack gutter renders short. This bit MRN already.

#### A3 · Mfg month/year and the problem counts

**Two different tables.** This is the part most likely to be mis-specced.

**Condition counts — six nullable `Int` columns on `mrn_lines`** (`prisma/schema.prisma`):
```
sndQty      Int?      leakyQty    Int?      damageQty   Int?
emptyQty    Int?      qtdQty      Int?      rejQty      Int?
```
Plus `qtySti Int` (NOT NULL), `cartonQty Int?`, `physicalQty Int?` (null until confirmed; **0 is a real value**), `isChecked Boolean @default(false)`, `checkedAt Timestamptz(6)?`, `checkedById Int?`.

**Manufacturing month/year is NOT on the line — it is on `mrn_line_batches`, one row per batch:**
```
model mrn_line_batches {
  id       Int @id @default(autoincrement())
  lineId   Int          → mrn_lines, onDelete: Cascade
  batchNo  Int
  qty      Int
  mfgMonth Int          NOT NULL
  mfgYear  Int          NOT NULL
  bestBeforeMonth Int?  ← nullable since v27.17, retired from every surface
  bestBeforeYear  Int?  ← same
  @@unique([lineId, batchNo])
}
```
This one-to-many is what lets one line split across manufacturing dates and render `06/26 · 30  +  07/26 · 16`. **If CI needs mfg dates per returned line, it needs the same child table — a pair of columns on the line cannot express a split.**

⚠ Two live CHECK constraints are **not expressible in Prisma** and are hand-recorded (CORE §7.4): `chk_pick_findings_mfg_month` is Picking's; MRN's month bounds live the same way. Any CI equivalent must be ALTERed in the Supabase SQL Editor, never assumed from `schema.prisma`.

#### A4 · How the header reaches the phone

**Client polling on a lightweight change-marker.** Not a server render, not SSE.

`components/mrn/mrn-shell.tsx:246-253`:
```ts
usePickingMarker({
  scope: "openPending",
  url: `/api/mrn/marker?tab=${activeTab}`,
  onChange: () => { void refetchBoard(); },
  paused: detailOpen || overlayBusy,
});
```

The marker is `(count, latest)` in ONE aggregate — `COUNT(*)` **and** `MAX(mrn.updatedAt)`. `app/api/mrn/marker/route.ts` explains why both halves are needed: when an MRN leaves a tab, `MAX(updatedAt)` over the tab it left can move *backwards*, so only the count reports the departure.

Three rules CI must copy:
- 🔴 **The marker's WHERE comes from `buildMrnSupervisorWhere()`** — the *same* function the board renders with. Never re-declare the predicate: a marker watching a narrower set silently misses updates and nobody notices until a truck is missed.
- 🔴 **The marker route is READ-ONLY and load-bearingly so.** A write there bumps `updatedAt` and fires a false "changed" on every polling phone forever (CORE §3, Picking §10).
- 🔴 **Refresh is a client `fetch` + `setState`, NEVER `router.refresh()`** — CORE §3's action-queue rule. Two attempts to fix that by timing shipped green and stayed broken on production.

**And the intentional asymmetry CI must decide about explicitly:** *there is deliberately no BILLING marker.* Owner ruling, design §5 — while the supervisor holds an MRN, billing's screen shows the lines exactly as billing left them, behind an amber "Locked" banner, and everything lands in ONE write at End unloading. The marker route says in terms: "this looks exactly like an oversight to anyone who has just read /picking and /floor. It is not one."

> **CI's stage-1 → stage-2 handoff should follow this**, but "follow the same mechanism" has to mean *supervisor polls, the other side does not* — not "add a marker for both sides".

---

### B. CI numbering

#### B1 · Where CHN is allocated
**There is no single allocator.** `CHN-{YEAR}-{5}` is built at **five** call sites, none sharing a function:

| File:line | Context |
|---|---|
| `app/api/import/obd/route.ts:512` | `createChallanForOrder()` — the main path |
| `app/api/import/obd/route.ts:535` | its P2002 retry |
| `app/api/import/obd/route.ts:1261` | manual-SAP confirm effect loop |
| `app/api/import/obd/route.ts:3122` | auto-json confirm effect loop |
| `app/api/tint/manager/manual-entry/route.ts:265` | manual tint pull |
| `app/api/admin/fix-challans/route.ts:72` | admin backfill |

The baseline query is the same copy-pasted four lines everywhere, e.g. `app/api/import/obd/route.ts:1246-1256`:
```ts
const lastChallan = await prisma.delivery_challans.findFirst({
  orderBy: { id: "desc" },
  select: { challanNumber: true },
});
let nextSeq = 1;
if (lastChallan?.challanNumber) {
  const parts = lastChallan.challanNumber.split("-");
  const lastNum = parseInt(parts[parts.length - 1], 10);
  if (!isNaN(lastNum)) nextSeq = lastNum + 1;
}
```

#### B2 · Does it include voided rows? ✅ YES
**Proof — the query has no `where` clause at all**, therefore no `isVoided` filter:
```ts
const lastChallan = await prisma.delivery_challans.findFirst({
  orderBy: { id: "desc" },          // ← no `where:` on this call
  select: { challanNumber: true },
});
```
All four baselines are identical in this respect. CORE §3/§13's rule is satisfied.

The contrast that proves it is deliberate — `app/api/tint/manager/manual-entry/route.ts:259-262`, the *existence* check in the same function, **does** filter:
```ts
// isVoided: false — a voided challan shouldn't block recreation.
const existingChallan = await prisma.delivery_challans.findFirst({
  where: { orderId: order.id, isVoided: false },
  select: { id: true },
});
```
Existence filters voided; sequence does not. Exactly the split CORE §3 describes.

#### B3 · Can CI reuse it? **No — and it should copy MRN's, not the challan one.**

Reuse is impossible: there is nothing to import. It is six inline copies keyed to `delivery_challans`.

More importantly, **the challan allocator is the weaker of the two patterns**, and `lib/mrn/number.ts` is a deliberate improvement on it. Four differences, all in MRN's favour:

| | Challan (`import/obd`) | MRN (`lib/mrn/number.ts`) |
|---|---|---|
| Scope | **Global max**, `orderBy: { id: "desc" }` | **Year-prefixed**, `where: { startsWith: "MRN-{year}-" }` |
| Ordering | by surrogate `id` | by the number itself, lexicographic DESC over a zero-padded fixed-width suffix — rides the btree |
| Malformed suffix | `if (!isNaN(...))` at the call site only | explicit `Number.isFinite` guard, documented ("would poison the sequence with NaN, which formats as `MRN-2026-000NaN` and passes the unique index") |
| Year rollover | 🔴 **does not reset** — `CHN-${year}-${globalMax+1}`, so January 2027 continues at `CHN-2027-00543` | resets to `00001` each year |

🔴 **This is a real decision CI must make, not inherit by accident.** Copy MRN's `allocateMrnIdentity()` shape and CI restarts at `CI-2027-00001`; copy the challan shape and it does not. MRN's is the newer, better-reasoned code and carries its no-filter rule in a screaming header. **Recommend copying `lib/mrn/number.ts` to `lib/ci/number.ts`.**

Two rules that travel with it: **no `isRemoved`/`isVoided` filter on the sequence query** (a removed row still owns its number under the UNIQUE index — filtering hands out a number that throws P2002 on a screen where the operator did nothing wrong); and **MAX+1, never COUNT+1** (a count collides the moment the sequence has a gap, and gaps are expected).

⚠ `allocateMrnIdentity` is **not atomic**, by accepted trade — two creates on the same millisecond can collide, and the UNIQUE index is the backstop. Do **not** "fix" it with `prisma.$transaction` (banned, CORE §3). The create route must surface P2002 as "please try again".

---

### C. Invoice-number search — does the data support it?

*All queries below are READ-ONLY SELECTs against production, run 2026-08-31 via a scratchpad script (not added to the repo).*

#### C1 · Coverage

```sql
-- READ-ONLY
SELECT count(*) AS total, count("invoiceNo") AS with_invoice,
       (count(*) - count("invoiceNo")) AS without_invoice
FROM orders WHERE "isRemoved" = false;                              -- all-time
-- + the same with AND "orderDateTime" >= now() - interval '90 days'
```

| Window | Total | With invoiceNo | Without |
|---|---|---|---|
| **All time** | 12,480 | **6,950 (55.7%)** | 5,530 |
| **Last 90 days** | 10,099 | **6,950 (68.8%)** | 3,149 |

🔴 **`with_invoice` is 6,950 in BOTH rows — identical.** Every invoiced order in the database falls inside the last 90 days. The 2,381 orders older than that carry **zero** invoice numbers. This is a data-history artefact (invoice capture began roughly 90 days ago), not a live-workflow signal, and it makes the all-time 55.7% figure misleading. **Quote the 90-day number, never the all-time one.**

Where the remaining gap sits (last 90 days, by stage):

| workflowStage | n | with invoice | % |
|---|---|---|---|
| `closed` | 4,539 | 1,845 | **40.6%** |
| `dispatched` | 4,077 | 3,708 | 90.9% |
| `pick_checked` | 1,339 | 1,278 | 95.4% |
| `pending_support` | 90 | 86 | 95.6% |
| `cancelled` | 42 | 28 | 66.7% |

The `closed` bucket is the legacy pile (CORE / the known 5,071-row legacy `closed` population) and is not live workflow. **Among bills that actually reach dispatch, coverage is 91–95%.**

#### C2 · Uniqueness — NOT unique, but the fan-out is tiny and structured

```sql
-- READ-ONLY
SELECT count(*) AS dup_invoice_values, sum(n) AS rows_involved, max(n) AS max_fanout
FROM (SELECT "invoiceNo", count(*) AS n FROM orders
      WHERE "isRemoved" = false AND "invoiceNo" IS NOT NULL
      GROUP BY 1 HAVING count(*) > 1) t;
```
→ **11 duplicate invoice values · 22 rows involved · max fan-out 2.**

Five examples (all `smu` Deco/Deco Retail):

| invoiceNo | obdNumber | soNumber | stage |
|---|---|---|---|
| `I536221211` | 9108133412 | 1046168365 | closed |
| `I536221211` | 9108133413 | 1046168365 | closed |
| `I536221645` | 9108026580 | 1046214233 | dispatched |
| `I536221645` | 9108223013 | 1046214233 | dispatched |
| `I536221850` | 9108101798 | 1046214977 | dispatched |
| `I536221850` | 9108191284 | 1046214977 | dispatched |
| `I536224119` | 9108643265 | 1046448633 | dispatched |
| `I536224119` | 9108757001 | 1046448633 | dispatched |
| `I536570070` | 9108386418 | 4516789254 | dispatched |
| `I536570070` | 9108386419 | 4516789254 | dispatched |

🔴 **Every duplicate pair shares the SAME `soNumber`.** This is exactly the split-bill shape the prompt anticipated: one SAP invoice → one sales order → two OBDs. It is real and must be handled.

**Design consequence:** the stage-1 search must return a **LIST** and let the supervisor pick the OBD, even when the list is usually length 1. It must never `findFirst` on `invoiceNo`. At 11 values out of 6,950 (0.16%) it is rare enough to be forgotten and common enough to be hit — and silently picking the wrong OBD would put returned goods against the wrong bill. Two consecutive OBD numbers with one invoice is also visually confusing, so the picker UI should show `obdNumber` **and** dealer name.

#### C3 · Physical shape — perfectly uniform, barely needs normalising

Ten real samples: `I536226470` `I536226469` `I536226471` `I536226468` `I536226492` `I536226466` `I536226472` `I536226467` `I536226465` `I536226473`

Census over all 6,950 — **a single row came back**, i.e. every value shares one shape:

| len | all digits | outer space | inner space | leading zero | alpha prefix | n |
|---|---|---|---|---|---|---|
| **10** | false | **false** | **false** | **false** | **`I`** | **6,950** |

Case: **0 lowercase, 6,950 uppercase.**

So: `I` + 9 digits, length 10, no padding, no whitespace, always uppercase. **Normalising needs only `.trim().toUpperCase()`.**

⚠ **One UX call, not a data problem:** a supervisor reading off a paper invoice may well type the 9 digits without the `I`. The data cannot tell you whether he will. **Recommend accepting a bare 9-digit entry and prefixing `I`** — cheap, and the alternative is a search that returns nothing for a correctly-read number. Flag for the owner.

#### C4 · 🔴 Timing — THERE IS A REAL WORKFLOW HOLE

First, what the data *can* say. `invoiceDate` vs `obdEmailDate`, last 90 days:

| day gap | n |
|---|---|
| **0** | 6,933 |
| 1 | 16 |
| 2 | 1 |

So SAP dates the invoice the same day as the OBD, essentially always.

⚠ **But that is the SAP invoice DATE, not when the number arrived in OrbitOMS**, and those are different questions. `invoiceNo` is written by `?action=patch-headers` on the ~10-minute Auto-Import timer, and **no column records when that write happened** — `orders.updatedAt` moves on every write, so it cannot serve as a proxy. **I cannot measure the sub-hourly arrival lag from the data.** MAIL_ORDERS §23.4's "sub-hourly batches, not live" stands and is not contradicted here.

What I *can* measure is whether it ever arrives at all — and this is the finding:

```sql
-- READ-ONLY
SELECT "workflowStage", count(*) AS n, min("orderDateTime") AS oldest, max("orderDateTime") AS newest
FROM orders
WHERE "isRemoved" = false AND "invoiceNo" IS NULL
  AND "workflowStage" IN ('pick_done','pick_checked','dispatched','delivered')
GROUP BY 1 ORDER BY n DESC;
```

| stage | n | oldest | newest |
|---|---|---|---|
| `dispatched` | **429** | 2026-05-15 | 2026-08-17 |
| `pick_checked` | **61** | 2026-08-17 | **2026-08-31 (today)** |

And the sharpest version:
```sql
-- READ-ONLY
SELECT count(*) AS dispatched_30d, count(*) FILTER (WHERE "invoiceNo" IS NULL) AS still_no_invoice
FROM orders WHERE "isRemoved" = false
  AND "workflowStage" IN ('pick_checked','dispatched','delivered')
  AND "orderDateTime" >= now() - interval '30 days';
```
→ **2,971 bills dispatched in the last 30 days · 149 of them (5.0%) still have NO invoice number today.**

🔴 **ANSWER TO THE QUESTION ASKED: YES. A supervisor can be holding returned goods for a bill that has no invoice number in OrbitOMS — and not merely for a few minutes.** 429 dispatched bills going back to May have never received one. 61 are `pick_checked` as of today. Five percent of the last month's dispatches are still uninvoiced.

This is not a latency window that closes on its own. **CI cannot be invoice-number-only.** It needs at minimum a fallback search on `obdNumber` (never null, `@unique`) and probably `soNumber`. Raised as a blocking question in §4.

---

### D. Per-line invoiced quantity

#### D1 · The column
**`import_raw_line_items.unitQty` (integer, nullable).** Verified against `information_schema.columns`; the full column list is:
`id · createdAt · rawSummaryId · obdNumber · lineId · skuCodeRaw · skuDescriptionRaw · batchCode · unitQty · volumeLine · isTinting · rowStatus · rowError · article · articleTag · lineStatus · removedAt · removedReason · netWeight · totalWeight`

🔴 **Read the name carefully. There is NO invoiced-quantity column anywhere in this database.** `unitQty` is SAP's **"Delivery quantity"** — `CLAUDE_IMPORT.md §3.1` column 15 (manual) and `"Delivery Qty"` in the §10 FormGetData map (auto). It is what the OBD says was *shipped*, captured at import, and it is never revised against the invoice afterwards.

For a depot where the invoice is raised off the delivery, delivered qty and invoiced qty are the same number in practice — but **they are not the same field, and the spec must not call `unitQty` "invoiced quantity"** or the next reader will go looking for a reconciliation that does not exist.

**Join key:** `import_raw_line_items.obdNumber` — a plain TEXT column. **There is no FK from `orders` to its line items** (stated in `lib/floor/queries.ts:225-228` and `CLAUDE_PICKING.md §8`). CI joins on the `obdNumber` string, exactly as Picking and Floor do.

#### D2 · Reliable enough to pre-fill "Full bill"? **Yes, with one mandatory filter.**

```sql
-- READ-ONLY
SELECT "lineStatus", count(*) FROM import_raw_line_items GROUP BY 1;
SELECT "rowStatus",  count(*) FROM import_raw_line_items GROUP BY 1;
SELECT count(DISTINCT "obdNumber") FROM import_raw_line_items WHERE "lineStatus"='removed_by_import';
```

| result | |
|---|---|
| `lineStatus` = `active` | **40,548** |
| `lineStatus` = `removed_by_import` | **113** |
| `rowStatus` = `valid` | **40,661 (100%)** |
| OBDs carrying ≥1 removed line | **100** |

**How a post-import change shows up:** a re-import **PATCHES a matched line in place** and **SOFT-removes** an absent one — `lineStatus='removed_by_import'` + `removedAt` + `removedReason`. **There is no hard delete of this table** (`lib/import-upsert/lines.ts`; CORE §7.4 relies on this for `pick_findings`' FK safety). Quantities on a surviving line are patched, so a late SAP correction silently changes `unitQty` under a CI that was raised earlier.

🔴 **Two consequences for the build:**
1. **CI must filter `lineStatus: 'active'`.** 113 rows across 100 OBDs would otherwise pre-fill returns against lines SAP has withdrawn. `rowStatus` needs no filter — it is 100% `valid`, because non-valid rows are never inserted.
2. **CI must SNAPSHOT the invoiced qty onto its own line at creation, not read it live.** A re-import patching `unitQty` after a CI is raised would retroactively change what the CI claims was billed. This is the same denormalisation MRN and `pick_findings` both chose deliberately — CORE §7.4: *"denormalised copies on purpose — a finding is a record of what a human observed and must still read correctly if its line is later soft-removed."* Same argument, same answer.

#### D3 · SKU join rule — ✅ CONFIRMED

**The raw SAP material code lives in `import_raw_line_items.skuCodeRaw` (text).** CI resolves it against **`sku_master_v2.material`** and never against any internal catalog id.

Live proof it is safe as a join key:
```sql
-- READ-ONLY
SELECT count(*) FILTER (WHERE "skuCodeRaw" IS NULL)  AS null_code,
       count(*) FILTER (WHERE btrim(coalesce("skuCodeRaw",''))='') AS blank_code,
       count(*) AS active_lines
FROM import_raw_line_items WHERE "lineStatus"='active';
```
→ **null 0 · blank 0 · 40,548 active lines.** Never null, never blank.

Coverage:
```sql
-- READ-ONLY
SELECT count(*) AS active_lines,
       count(*) FILTER (WHERE s.material IS NOT NULL) AS resolved,
       count(*) FILTER (WHERE s.material IS NULL)     AS unresolved
FROM import_raw_line_items l
LEFT JOIN sku_master_v2 s ON s.material = l."skuCodeRaw"
WHERE l."lineStatus"='active';
```
→ **40,548 active lines · 38,168 resolved (94.1%) · 2,380 unresolved (5.9%).**

⚠ **Do not confuse this with CORE §7.1.c's "~73%".** That figure is **distinct CODE** coverage (~1,152 distinct active codes, ~309 in neither table). **94.1% is LINE-weighted** — the unmastered codes are long-tail and appear on few lines. Both are correct; they answer different questions. For "how many CI rows will show a bare code instead of a name", **94.1% is the right number**; for "how much catalog cleanup is owed", 73% is.

The rule and its reason are already written twice, in `lib/mrn/resolve-lines.ts:5-16` and `lib/picking/resolve-lines.ts`:
> *"MATCHES ON `sku_master_v2.material` AND NOTHING ELSE. Never a catalog row id… The OLD `sku_master` and `sku_master_v2` assign COMPLETELY DIFFERENT ids to the same material code — zero overlap, verified against production, not reasoned (CORE §13). Following an id would render a confidently WRONG product name on a live goods-receipt sheet, which is worse than a blank."*

**CI copies that file's shape and that warning.** Also copy: **no `isPrimary` filter** — a duplicate twin is still a real SAP code that can physically be in the return.

---

### E. Name collisions

#### E1 · 🔴 "CI" IS ALREADY TAKEN — and it is user-visible

The prompt asked me to confirm the mail parser's `\bCI\b` detector is *unrelated*. **The detector is unrelated to goods returns — but the ABBREVIATION is not free.** "CI" is an established, live, user-facing term in this product meaning **"Credit Issue"** (credit hold / block), and it is rendered as a **red BLOCKER badge** on the mail-orders bill card.

| Where | Evidence |
|---|---|
| Tag key | `lib/hide/tag-catalog.ts:27` — `ci: "mail_orders.ci"` in `MO_TAG` |
| **User-facing label** | `tag-catalog.ts:47` — `label: "CI (Credit Issue)"`, group "Mail Orders", `important: true`, *"Red blocker when the order is on credit hold / block"* |
| Signal badge | `lib/mail-orders/utils.ts:737-738` — `result.push({ label: "CI", type: "blocker", card: "bill", tagKey: MO_TAG.ci })` |
| Flag extractor | `lib/mail-orders/utils.ts:709` — `if (/\b(ci\|credit\s*(hold\|block\|issue))\b/i.test(combined)) flags.push("CI")` |
| Customer-match remark | `lib/mail-orders/customer-match.ts:27` — `{ pattern: /\bCI\b/, remarkType: "blocker", label: "CI" }` |
| Doc | `CLAUDE_CORE.md:893` — *"OD/CI detection: word-boundary regex `\bOD\b`, `\bCI\b`"* |

**Code-level collisions: NONE.** Verified:
```sql
-- READ-ONLY
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND (table_name LIKE 'ci%' OR table_name LIKE '%\_ci\_%' OR table_name LIKE '%\_ci');
SELECT DISTINCT "pageKey" FROM role_permissions WHERE "pageKey" ILIKE '%ci%';
```
→ both `[]`. No `ci*` table, no `ci` page key, no `app/ci`, no `CI`-named component.

⚠ **So the collision is in VOCABULARY, not in code — which is the harder kind to undo later.** Ship this and the same depot staff see two different "CI"s: a red badge on `/mail-orders` meaning *"credit hold, do not dispatch"*, and a whole module meaning *"goods came back"*. The mail-orders badge is `important: true` and toggleable in Settings → Hide; billing_operator holds `mail_orders` view+edit **and** would hold the new key, so **one role sees both**.

The `\bCI\b` regexes themselves are safe — they run only over `remarks` / `billRemarks` / `deliveryRemarks` on `mo_orders` and would not be affected by a new module. **The risk is human, not technical.** Raised in §4.

#### E2 · Is `/ci` free as a route? ✅ YES

`app/` at depth 1: `(admin) (dispatcher) (floor) (import) (mail-orders) (operations) (ops) (place-order) (tint) api attendance globals.css layout.tsx login mrn not-found.tsx not-ready orders page.tsx picking po reports trips unauthorized`
→ no `ci`. `app/ci` and `app/api/ci` both do not exist.

**Middleware — no change needed.** `middleware.ts:8-29`: `PUBLIC_PATHS` does not contain `/ci` and nothing in it prefixes it; `PHASE1_BLOCKED` is `[]`. The matcher is `["/((?!_next/static|_next/image|.*\\..*).*)"]`, so `/ci` is caught and falls straight through to the auth gate — **exactly like `/mrn`, which also required no middleware entry.**

⚠ **One trap to respect if CI ever needs a public path:** the check is `PUBLIC_PATHS.some(p => pathname.startsWith(p))` — a **prefix** match. The file documents this biting once already (`"/order"` also makes `/orders` public). A `/ci` entry would also expose any future `/circulars`.

---

### F. Permissions shape

#### F1 · Live rows (SELECT, not seed)

```sql
-- READ-ONLY
SELECT "roleSlug","pageKey","canView","canEdit","canImport","canExport","canDelete"
FROM role_permissions WHERE "roleSlug" IN ('floor_supervisor','billing_operator')
ORDER BY "roleSlug","pageKey";
```

**`billing_operator` — 4 rows, all it holds:**
| pageKey | View | Edit | Import | Export | Delete |
|---|---|---|---|---|---|
| `import_obd` | ✗ | ✗ | **✓** | ✗ | ✗ |
| `mail_orders` | ✓ | ✓ | ✗ | ✗ | ✗ |
| **`mrn`** | **✓** | **✓** | ✗ | **✓** | **✓** |
| `place_order` | ✓ | ✓ | ✗ | ✗ | ✗ |

**`floor_supervisor` — 13 rows, only 2 grant anything:**
| pageKey | View | Edit |
|---|---|---|
| **`mrn`** | **✓** | **✓** |
| **`picking`** | **✓** | **✓** |
| `customers` `dashboard` `import_obd` `permissions` `routes_areas` `skus` `system_config` `tint_manager` `tint_operator` `users` `vehicles` | ✗ | ✗ |

**The precedent CI should copy — MRN's live grant, exactly 3 roles:**
```sql
-- READ-ONLY
SELECT "roleSlug","pageKey","canView","canEdit" FROM role_permissions WHERE "pageKey" ILIKE '%mrn%';
```
| role | View | Edit |
|---|---|---|
| `billing_operator` | ✓ | ✓ |
| `floor_supervisor` | ✓ | ✓ |
| `operations` | ✓ | ✓ |

(billing_operator additionally holds export + delete on `mrn`.) Live matches `prisma/seed.ts:141-143` for this key — no drift here, unlike `import_obd`/`customers` (CORE §5).

#### F2 · Where a new page key must be registered — **five places, and one of them is already broken**

| # | File | Symbol | Required? |
|---|---|---|---|
| 1 | `lib/permissions.ts:172` | **`PageKey` union** — add `\| "ci"` | ✅ Mandatory (TypeScript) |
| 2 | `lib/permissions.ts:212-222` | **`ALL_PAGE_KEYS`** array | ✅ Mandatory |
| 3 | `lib/permissions.ts:17-` | **`PAGE_NAV_MAP`** — `{ pageKey: "ci", label: "…", href: "/ci" }` | ✅ Mandatory for nav — ⚠ **position is behaviour**, see F3 |
| 4 | `prisma/seed.ts:141-143` (beside `mrn`) | seed grant rows | ✅ Mandatory — **seed is the durable source** (CORE §3: "any change applied directly to a live DB will be wiped by the next wipe-and-reseed") |
| 5 | `components/shared/role-sidebar.tsx:39-` | **`ICON_MAP`** entry | ⚠ Optional — line 121/148 fall back to `DEFAULT_ICON`, so a missing icon degrades gracefully. MRN uses `Container` |
| — | **live `role_permissions` rows** | via Smart Flow in the Supabase SQL Editor | ✅ Mandatory — **and separate from the seed.** Both, or the key works in dev and not in production |

🔴 **A sixth place exists and MRN never registered in it.** `components/admin/permissions-manager.tsx:25-42` holds `PAGES_CONFIG`, a **separate hardcoded list** driving the `/admin/permissions` UI. It contains 13 keys and is **badly stale**: it has **no `mrn`, no `picking`, no `floor`, no `mail_orders`, no `place_order`, no `trip_report`, no `sampling_library`, no `delivery_challans`, no `ti_report`, no `attendance*`** — and still lists retired **`dispatcher`** and **`warehouse`**.

**Consequence: MRN's permissions cannot be managed from the admin UI at all** — they exist only via seed + SQL. CI would inherit exactly that. Not a blocker (MRN ships fine), but the owner should know it is a choice, not an oversight, before it becomes a third module in the same position.

#### F3 · Login landing — ✅ unaffected, but the phone Home button is NOT

**Login landing is safe.** `lib/rbac.ts:39` — `floor_supervisor: "/picking"`, a hardcoded entry in `ROLE_REDIRECTS`, entirely independent of `role_permissions` and of `PAGE_NAV_MAP`. **Adding a `ci` key changes nothing about it.**

⚠ **But `PAGE_NAV_MAP` ORDER is load-bearing, and it is a documented trap.** `lib/permissions.ts:60-70`:
> *"THIS POSITION IS BEHAVIOUR, NOT COSMETICS. MobileShell's phone Home target is `navItems[0]?.href`, and `buildNavItems` preserves this array's order — so an entry becomes Home for any role whose first GRANTED entry it displaces."*

Current order and the roles at risk:

```
idx  0 operations_tinting        ← operations' Home
idx  1 operations_tint_operator
idx  2 picking                   ← floor_supervisor's Home
idx  3 floor
… idx 12 place_order             ← billing_operator's Home
   idx 13 mail_orders
   idx 14 mrn                    ← MRN sat here precisely because it displaces nobody
```

🔴 **A `ci` entry inserted at index ≤ 2 would steal floor_supervisor's phone Home button from `/picking`.** Insert it **after `mrn` (index 15 or later)** and all three roles are unchanged — the same reasoning and the same slot MRN used. **Re-derive this against the live grants before placing the line; do not trust this table or that comment.**

---

## 3. Spec corrections

⛔ **CANNOT BE WRITTEN — the spec does not exist (§0).**

Had it existed, these are the findings that would most likely have contradicted it, and each is the kind of thing a spec typically gets wrong. Check every one when the spec surfaces:

1. **`unitQty` is DELIVERY quantity, not invoiced quantity** (D1). No invoiced-qty column exists anywhere.
2. **Mfg month/year is a CHILD TABLE, not two columns on the line** (A3). A pair of columns cannot express a split batch.
3. **`invoiceNo` is NOT unique** — 11 values fan out to 2 OBDs each, always sharing a `soNumber` (C2).
4. **5% of dispatched bills have no invoice number, some for months** (C4). Invoice-only search is not viable.
5. **The MRN line row is not reusable** — private, and typed on an MRN-shaped interface (A2). The module's own convention is *copy the layout, never share the row*.
6. **SKU coverage is 94.1% line-weighted, not ~73%** — that is the distinct-code figure and answers a different question (D3).
7. **CHN's allocator does not reset at year end; MRN's does** (B3). CI must pick one deliberately.
8. **"CI" already means Credit Issue in this product, on a red badge** (E1).
9. **There is deliberately no billing-side live marker in MRN** (A4). "Follow MRN's mechanism" must not become "add a marker to both sides".

---

## 4. Blocking questions for Smart Flow

**Must be answered before step-1 SQL can be written.**

1. 🔴 **Where is the spec?** Nothing downstream can be validated against intent without it. Everything below is a *data* finding; the *product* answers are the owner's.

2. 🔴 **What does CI do when the bill has no invoice number?** 429 dispatched bills (back to May) and 61 `pick_checked` bills as of today have none, and 5.0% of the last 30 days' dispatches are still uninvoiced (C4). Options: search `obdNumber` as well (never null, `@unique`) · search `soNumber` too · allow a CI to be raised against an OBD and back-fill the invoice later · block CI on those bills entirely. **The answer changes the stage-1 schema**, so it cannot wait for step 4.

3. 🔴 **Is the module really called "CI"?** It already means **Credit Issue** on a red blocker badge in `/mail-orders`, and `billing_operator` would see both (E1). No code collision — a genuine vocabulary one. If the name stands, that is a decision worth recording so nobody "fixes" it later.

4. **Search behaviour on a split bill** — one invoice → 2 OBDs (C2). Confirm the supervisor picks from a list. Confirm whether a CI is ever raised against *both* OBDs of one invoice at once, or always exactly one.

5. **Does the search box accept a bare 9-digit number?** Every value is `I` + 9 digits (C3); a supervisor reading paper may omit the `I`. Cheap to accept, and rejecting it looks like a broken search.

6. **Does the CI number reset each January?** MRN's allocator resets, the challan one does not (B3). Both live in this codebase. Pick one.

7. **Does CI snapshot the invoiced qty onto its own line?** Strongly recommended (D2) — a re-import patches `unitQty` in place and would retroactively change what an already-raised CI claims. Same call MRN and `pick_findings` both made.

8. **Does CI need a `bestBefore` pair?** `mrn_line_batches` has them nullable since v27.17 and **retired from every surface**. Do not add them to CI by copying MRN's table blind.

9. **Should CI register in the admin Permissions UI** (`PAGES_CONFIG`), which MRN skipped and which is stale by ~10 keys (F2)? Fixing it is out of CI's scope but the choice should be conscious.

---

## 5. Ready / not ready for step 1

🔴 **NOT READY.** The technical ground is solid — layout, numbering, SKU join, permissions and the `/ci` route are all confirmed and unblocked — but **the spec is missing entirely (§0), and the live data has surfaced one hole that changes the stage-1 schema rather than the stage-4 UI: 5% of dispatched bills have no invoice number, some for months, so an invoice-only search cannot be the design (C4 / question 2).** Answer questions 1, 2 and 3, and step 1 can be written immediately against everything else in this report.
