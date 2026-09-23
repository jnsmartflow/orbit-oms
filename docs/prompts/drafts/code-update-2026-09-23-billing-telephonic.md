# code-update 2026-09-23 — Billing · Telephonic tab

**Status: SHIPPED to main, live.** Seven commits, 2026-09-22 → 2026-09-23, all verified on
`origin/main` (subjects quoted in §0).

🔴 **THE LIVE HAND TEST IS NOT DONE.** No real Hold order and no real bill-only CI order has been
through this end to end. What HAS happened live, read from the database 2026-09-23:

| Fact | Live |
|---|---|
| Tags ever added | **4**, all by hand on 2026-09-22 (Operations User ×3, Deepanshu Thakur ×1), all **removed again**, all still `waiting` |
| SO numbers used | `1234567890`, `9456402356`, `7778884088`, `9099974426` — invented 10-digit numbers, not real SAP SOs (every real one starts `104…` or `451…`) |
| `so_tag_matches` rows | **0** — no tag has ever met an OBD |
| `ci_returns` with `source = 'auto_bill_only'` | **0** — the bill-only CI has never run |
| Grants | **5 users hold canView + canEdit**: Bankim, Chandresh Kolgha, Deepanshu Thakur, Operations User, Prakash |

So the ENTRY half (add, the duplicate report, remove) has been exercised by hand and works. The
IMPORT half — match, hold, auto-CI — has never executed against a real bill, in production or
anywhere else. Everything in §3 and §4 below is code that compiles and reads correctly, not
behaviour anybody has watched happen.

This file is the SHIPPED record. The DECISION record is
`docs/prompts/drafts/web-update-2026-09-21-billing-telephonic-tab.md`; where the two disagree, §10
below says which is right (code wins).

---

## 0. The commits, verified on origin/main

| Commit | Subject |
|---|---|
| `6353d2a9` | schema v27.39: so_tags + so_tag_matches, auto_bill_only CI source |
| `78dcdd1e` | ci: extract computeFullBillLines, add raiseBillOnlyCi (not wired) |
| `d3656942` | import: apply Telephonic tags before the no-mail fallback (hold + bill-only CI) |
| `ace897a1` | billing: billing_telephonic page key + list/add/remove/marker routes |
| `3f3e26c5` | billing: Telephonic tab UI |
| `68c6f548` | billing: Telephonic entry rail, multi-paste, split lists |
| `486ce08e` | billing: Telephonic CI tag on data.blue, hint line, empty-state icon |

All seven are ancestors of `origin/main`. **One later commit by another session touched this
work**: `ca01e97b` ("floor: cancel reason + refusals, restore guard, POST /api/floor/ci raises full
CI (source floor); shared fullBillLines") added a FOURTH CI source, `floor`, and Schema **v27.40**.
It changed `lib/ci/types.ts` (the union, `CI_SOURCES`, a "Floor" tag) and one comment in
`lib/ci/queries.ts`; it **reused `lib/ci/full-bill.ts` unchanged** and did not touch
`lib/ci/bill-only.ts`, the telephonic modules, or `PUT /api/ci/[ciId]/lines`. `dada05aa` changed
one comment in `lib/floor/hold-log.ts`; `TELEPHONIC_HOLD_NOTE` is intact.

---

## 1. What the feature is

Most orders arrive by email, so the parser makes an `mo_orders` row and enrichment copies Hold /
Urgent / slot onto the bill when SAP's OBD lands. **A telephonic order has none of that** — the
sales officer phones, billing punches straight into SAP, no mail order ever exists — so the
no-mail-order fallback (`CLAUDE_IMPORT.md §2.1`) releases it to picking within milliseconds.

Billing now pastes those SO numbers on a fourth tab of `/mail-orders` and tags each **Hold** or
**CI**. When the OBD arrives the import holds the bill first, and for a CI tag also raises a
full-bill, material-not-moved Goods Return Note. Used by the billing desk; roughly 33 no-mail bills
a day pass through the import, of which the phone orders are a handful.

---

## 2. Schema — v27.39

`sql/2026-09-22-billing-telephonic.sql`, run in the Supabase SQL Editor 2026-09-22 and verified by
its own PART 5. Text below is the **live** `pg_constraint` / `pg_indexes` read (re-read
2026-09-23), not the code.

**`so_tags`** — 13 columns, one row per SO typed.
- `chk_so_tags_tag` — `CHECK ((tag = ANY (ARRAY['hold'::text, 'ci'::text])))`
- `chk_so_tags_status` — `CHECK ((status = ANY (ARRAY['waiting'::text, 'matched'::text])))`
- `so_tags_addedById_fkey` → `users(id)` **ON DELETE RESTRICT** (who asked for the hold is the
  record); `so_tags_removedById_fkey` **ON DELETE SET NULL** (an optional actor stamp)
- 🔴 `so_tags_soNumber_live_key` — `CREATE UNIQUE INDEX … ON public.so_tags USING btree
  ("soNumber") WHERE ("isRemoved" = false)`. A PARTIAL unique index: the duplicate backstop, and
  the index the import lookup rides.

**`so_tag_matches`** — 6 columns, one row per OBD a tag hit. `UNIQUE ("soTagId", "orderId")`, both
FKs **ON DELETE RESTRICT**, plus `so_tag_matches_orderId_idx` (Postgres does not index a foreign
key's referencing side, so without it a delete on `orders` scans this table).

**`chk_ci_returns_source` widened.** Before: `manual`, `auto_finding`. v27.39 added
`auto_bill_only`. ⚠ **It has since been widened again** by `ca01e97b` (v27.40) — the live text
today is:
```
CHECK ((source = ANY (ARRAY['manual'::text, 'auto_finding'::text, 'auto_bill_only'::text, 'floor'::text])))
```

**Data:** an all-false `user_page_access` row for `billing_telephonic` for every user (40 rows, 0
granted at the time). Grants came later, by hand — see the status block.

---

## 3. The import hook

`lib/billing/telephonic-apply.ts`. It runs **after `applyMailOrderEnrichment` and immediately
BEFORE `applyNoMailOrderFallback`**, at all four call sites in `app/api/import/obd/route.ts`, each
passing the SAME OBD list the fallback receives:

| Line | Handler | Source |
|---|---|---|
| `:1429` | `handleConfirm` (STEP D1c) | manual template |
| `:2029` | `handleManualSapConfirm` | manual SAP .xlsx |
| `:2575` | `handleSapPasteConfirm` | SAP paste |
| `:3884` | `processAutoImportRows` (CONFIRM D1c) | `?action=auto` and `?action=auto-json` |

**Planner / executor split.** `planSoTagApplications(orders, tags, matches, now)` is PURE — no
Prisma, no clock — and decides per order: skip (no SO number / no live tag / already matched),
`record_only` (removed, dispatched or cancelled bill), or `hold` / `hold_and_ci`.
`applySoTagHolds(obdNumbers, now)` does three batched reads (orders → live tags → existing
matches), then acts. It **never throws into the import**: each bill is wrapped, an error is logged
with its OBD, and a summary `{ held, ciRaised, ciSkipped, recordOnly, skipped, errors }` comes back.

**A live tag** is `isRemoved = false AND expiresAt > now`, status `waiting` **OR** `matched` — not
`waiting` only, because the first OBD flips the tag to `matched` and a second OBD on the same SO
must still find it.

**The order, per bill: CLAIM → HOLD → CI → TAG.**
1. **Claim** — insert the `so_tag_matches` row FIRST. Its `UNIQUE (soTagId, orderId)` is the lock:
   auto-import fires every minute and a manual paste can overlap it, so without the claim two runs
   could each pass the duplicate check and each raise a CI. A P2002 here means another run won;
   this one skips silently.
2. **Hold** — ONE `orders.update` (`dispatchStatus: 'hold'`, `heldAt = obdEmailDate ?? now`, the
   same rule enrichment and Floor's hold action use) and ONE `order_status_logs` row carrying
   `TELEPHONIC_HOLD_NOTE` = **"Held on import (Telephonic tag)"** (`lib/floor/hold-log.ts`, in
   `HOLD_LOG_NOTES` so Floor's Hold tab finds it). A mail order that already set a status is logged
   as a clash with `console.warn`; the tag wins.
3. **CI** — `hold_and_ci` only: `raiseBillOnlyCi`, which never throws. A refusal or failure is
   written to the match row's `ciSkipReason`.
4. **Tag** — `waiting` → `matched` with `matchedAt`, guarded on `status: 'waiting'` so a concurrent
   run cannot overwrite the FIRST match's timestamp.

`record_only` does step 1 with the reason in `ciSkipReason`, then step 4. No hold, no CI.

---

## 4. The bill-only CI

**`lib/ci/full-bill.ts`** (`78dcdd1e`) — lifted out of `PUT /api/ci/[ciId]/lines` so a server job
with no session can compute the same lines. `computeFullBillLines(obdNumber)` returns
`{ok: true, lines}` or a refusal (`zero_qty` with the offending line ids, or `no_lines`);
`readActiveBillLines` and `deriveCiLineRows` are exported beside it and the lines route's **part**
branch calls the latter too, so the manual and auto paths cannot write different rows. The route's
409 bodies are byte-identical to before the extraction.

**`lib/ci/bill-only.ts`** — `raiseBillOnlyCi({ orderId, raisedById })`, wrapped end to end:
`raised` / `skipped` / `failed`, never a throw.
- **Duplicate guard: ANY live CI on the bill** — `orderId`, `isVoided: false`, `status <> 'draft'`,
  **any source**. `lib/ci/auto.ts` narrows by source because it RECONCILES its own document and
  must not rewrite a hand-raised one; this path CREATES, and a second CI on a bill billing already
  raised by hand would double the credit in SAP.
- **Reason by CODE** — `WRONG_ORDER_BY_SO` (live id 1), looked up at write time and the label
  snapshotted, because `ci_reason_master` is depot-editable. Missing or inactive → skipped, no CI.
- **Write form copied from `auto.ts`** — allocate the number first, ONE nested create at
  `submitted` with its lines, re-allocate once on P2002. Fields: `returnType: 'full'`,
  `materialMoved: 'not_moved'`, `materialReceivedDate` = today in IST, `source: 'auto_bill_only'`,
  `supervisorId` = the operator who typed the tag. Not `auto.ts`'s line rule: that one is a PART
  return from confirmed findings.

**Parity, read-only, 2026-09-22:** `computeFullBillLines` was run against the two live bill-only
bills and compared line for line with what is stored — **29 of 29 lines matched on all nine
fields** (line number, raw line id, SKU, tins, litres per tin, returned litres, delivery quantity,
description, pack): `CI-2026-00001` / OBD 9109213547 (5 lines) and `CI-2026-00049` / OBD
9109558103 (24 lines). Neither bill had an import touch it after its CI was raised, so there was no
snapshot drift to explain.

---

## 5. Access, routes and the SO rule

**Page key `billing_telephonic`** (`lib/permissions.ts`, the **`PageKey`** union): in the union,
`ALL_PAGE_KEYS` (**now 40 keys**, was 39), `ACTION_PAGES.canEdit`, `PAGE_LABEL_OVERRIDES`
("Billing · Telephonic") and `ACCESS_SECTIONS` → Operations. **Not** in `PAGE_NAV_MAP` — it is a
tab inside `/mail-orders`, not a route.

| Route | Gate | Returns |
|---|---|---|
| `GET /api/billing/telephonic/list?month=YYYY-MM` | canView | `{ waiting, month }`; bad month → 400 |
| `GET /api/billing/telephonic/marker` | canView | `{ count, latest, matchCount, skipReasonCount, signature }` |
| `POST /api/billing/telephonic/add` | canEdit | `{ results, applied }` — 200 on any well-formed body |
| `POST /api/billing/telephonic/remove` | canEdit | `{ alreadyRemoved }`, 404 if no such tag |

All four use `checkAnyPermission` (never `checkPermission`, which reads only the primary role) and
take the user id from the session, never the body.

**The SO rule** (`lib/billing/telephonic-so.ts`, pure so the client and the server share it): strip
every whitespace character, then **exactly 10 digits**. Measured over all **15,222** live
`orders.soNumber` values: **15,137 (99.4%) are exactly 10 digits** (15,106 start `104`, 28 start
`451`); 14 are 1–4 digit challan/manual serials; 71 rows (44 distinct) are text — POTLI, SAMPLE,
CHALLAN variants, `J2/GST-00xx`, `86 - MANUAL`, a timestamp. Ten digits accepts every real SAP SO
seen and rejects all 85 others. `parseSoBlock` splits a paste on any run of non-digits, dedupes
keeping first order, and caps at **50** per add (`TELEPHONIC_MAX_PER_ADD`). TTL is **15 days**
(`TELEPHONIC_TAG_TTL_DAYS`, the only place that number lives).

**Marker.** `signature` = `matchCount:skipReasonCount` rides in the field `usePickingMarker`
compares beside `count` and `latest` — added as an OPTIONAL, coalesced field
(`lib/hooks/use-picking-marker.ts`), so Picking, Floor, MRN and the other billing tabs are
unchanged. Needed because `so_tag_matches` has no `updatedAt`, so a skip reason written after the
claim moves neither of the other two.

---

## 6. The UI

`components/billing/billing-telephonic-tab.tsx`, mounted from `review-view.tsx` behind the pill in
`billing-tab-bar.tsx` (`BillingTab` gained `"telephonic"`; the badge is the waiting count, hidden
at 0). Access is couriered server-side through `BillingTelephonicAccessProvider`
(`app/(mail-orders)/mail-orders/layout.tsx`), and `BillingTelephonicMarkerProvider` owns a 30s poll
that is a pure pass-through for a non-holder.

- **Geometry:** the `344px minmax(0, 1fr)` two-track grid MRN, CI and `/floor` use. 🔴
  `minmax(0, 1fr)`, never plain `1fr`. The rail renders only with canEdit (hide, never disable);
  without it the lists take the full width. The order inbox and Print's rail slot are CSS-hidden on
  this tab, not unmounted.
- **The rail is for ADDING, never a detail pane** — an entry has too few facts to fill one, so
  nothing is selectable.
- **Multi-paste:** a block of numbers, any non-digit separating, each becoming a chip — plain
  valid, warn "already on the list", danger "not 10 digits". Enter adds, Shift+Enter is a new line,
  hinted under the button. One tag for the batch. Added numbers leave the box; anything refused
  stays with its chip. The outcome is written IN THE RAIL, not a toast, because twenty numbers have
  more to say than a toast holds.
- 🔴 **The "still being typed" rule:** a token is judged only once FINISHED. `buildChips` marks the
  last token `pending` (dashed grey, no verdict, counted as neither added nor skipped) when the
  caret is at the end AND the text ends in a digit. So `10467` shows nothing; `10467 `, Enter or Add
  show "not 10 digits". Pressing Add finishes everything via `parseSoBlock`.
- **Two lists, different columns.** Waiting has no bill, so every bill column would be a dash: it
  gets its own capped table — `# 6 · SO Number 24 · Tag 16 · Added by 26 · Added 18 · × 10`. The
  month's table is `# 3 · SO 10 · Tag 6 · Customer/OBD 22 · Invoice No 11 · Status 12 · CI 16 ·
  Added by 9 · Added 8 · × 3`, with CI number, state and SAP number STACKED in one column. Fixed
  table standard on both (32px header, 36px rows, 10px uppercase, 11px data). One SO with several
  bills is one row per bill, `↳` in the Tag cell after the first. "Added by" shows the first name.
- **Status pill, per bill, from LIVE data, first match wins:** no bill → `Waiting` (warn) or
  `Expired` (grey); `ciSkipReason` "hold failed" → **Not held** (solid danger); a not-applied reason
  (bill cancelled / already dispatched / bill removed) → that reason, grey; `dispatchStatus = 'hold'`
  → **Held** (ok); otherwise → **Released** (a person released it on Floor).
- **Tag colours:** Hold on `danger`; CI on **`data.blue`** (#2563EB) with `blue-50` / `blue-200` as
  the pale pair the config does not expose. 🔴 `data.*` are IDENTITIES, never states (UI §2.1) —
  Hold and CI are two KINDS of telephonic order, not two statuses, so an identity colour is right.
  The status pills keep their warn / ok / grey / danger state colours. The ink family was tried
  first and read as disabled.

---

## 7. Landmines

- 🔴 **The hook must stay BEFORE `applyNoMailOrderFallback`.** The fallback only touches bills whose
  `dispatchStatus` is null; a bill held first is invisible to it. Reversed, the bill is released to
  picking before anything can hold it — and the log then carries a false "Auto-dispatched on
  import" line.
- 🔴 **Already matched means DO NOTHING.** A re-import must never re-hold a bill Floor deliberately
  released, and never raise a second CI.
- 🔴 **Claim before hold and CI.** Auto-import runs every minute and a manual paste can overlap it;
  without the match row as the lock, two runs could each raise a CI on one bill.
- 🔴 **A failed hold is SHOWN, not retried.** The match row gets `ciSkipReason = "hold failed"` and
  the tab shows the bill's live `dispatchStatus`, so a bill that is not actually held is visible and
  Floor can hold it by hand. A retry would almost never fire anyway: imports do not revisit an
  existing bill (auto-import is create-only), so the bill would have to come back through a manual
  paste to get a second chance.
- 🔴 **"Expired" is DERIVED, never stored** — `status = 'waiting' AND expiresAt <= now`. The CHECK
  refuses an `expired` value. A stored flag would need a job at the 15-day mark, and a job that did
  not run would leave the screen disagreeing with the clock.
- 🔴 **The partial unique index is not expressible in Prisma**, so it is a comment in the model and
  **`findUnique({ where: { soNumber } })` does not exist** — callers use `findFirst` / `findMany`
  with `isRemoved: false`. Do not "fix" this with `@@unique([soNumber])`: that claims a full unique
  the database does not have.
- 🔴 **`ciSkipReason` means "the tag was not fully applied", not only "the CI was refused."** It
  carries "hold failed", "already dispatched", "bill removed" and "bill cancelled" as well.
- 🔴 **The CI tag colour is deliberate.** `data.*` are identities; a future sweep that moves it to a
  state colour, or back to ink, is undoing a decision, not tidying one.

---

## 8. Open items

- 🔴 **The live hand test.** A real Hold order and a real bill-only CI order have not been through
  the import. Nothing in §3 or §4 has run against a real bill. The four hand-typed tags were
  invented numbers, never matched, and were removed.
- **Grants: DONE, not open.** Five users hold canView + canEdit (Bankim, Chandresh Kolgha,
  Deepanshu Thakur, Operations User, Prakash). The brief for this file listed them as outstanding;
  live says otherwise.
- **No click-to-open bill panel.** `GET /api/billing/picking/order/[orderId]` is gated on
  `billing_picking`, which a Telephonic holder may not have, so a row opens nothing in v1.
- **No reason picker.** Every bill-only CI is `WRONG_ORDER_BY_SO`. If a second reason is ever
  wanted, it is a new decision and a new control.
- **Three untracked scratch scripts** at the repo root, read-only, never committed and never
  imported by the app: `_parity-full-bill.ts` (the 29/29 parity run), `_dryrun-telephonic-plan.ts`
  (15/15 planner cases), `_test-telephonic-readonly.ts` (the SO rule, 76 inputs, 0 wrong).
- **The tab is unverified visually.** No session in this run could log in; every UI claim above is
  compile-and-read, not watched.

---

## 9. Where this merges — one owner per behaviour

| File | Owns | Cross-references only |
|---|---|---|
| **`CLAUDE_BILLING.md`** | 🔴 **THE OWNER.** The tab itself (§3 tab bar gains a fourth pill; the entry rail, multi-paste and the "still being typed" rule; the two lists and the status pill rules), the `billing_telephonic` key in its §4, the four routes and their gates in its §6 neighbourhood, the marker provider in §8, and the landmines in §11 | points at IMPORT for the hook, at CI for the CI |
| **`CLAUDE_IMPORT.md`** | The hook's PLACE in the pipeline — one row beside §2.1's fallback saying the tag apply runs before it at all four call sites, and why the order is load-bearing | the tab, the tag vocabulary and the CI all belong elsewhere — do not restate them here |
| **`CLAUDE_CI.md`** | `auto_bill_only` as a CI source (§3's CHECK row), the extracted `lib/ci/full-bill.ts` and the rule that manual and auto write identical rows, and the bill-only raiser beside §9's auto path | the tag, the tab and the import hook |
| **`CLAUDE_CORE.md`** | §5's key list and the key COUNT (39 → 40), and the §7 chain entry for v27.39 (already written) | nothing else |
| **`CLAUDE_UI.md`** | The entry-rail pattern (a 344px rail used for ADDING, not a detail pane — new, and worth a line beside the existing 344px geometry note) and the tag colours with the identity-not-state reasoning in §2.1 | the table widths live with the tab, in BILLING |

⚠ **The CI merge must cover BOTH sessions.** `ca01e97b` added a fourth source, `floor`, and CORE is
already at v27.40 — but **`CLAUDE_CI.md §3` still lists three values** (`manual` / `auto_finding` /
`auto_bill_only`) and its footer still cites v27.39. Whoever consolidates CI must write all four
values and both owners in one pass, or the file will be wrong about the constraint either way.
`lib/ci/types.ts` and `ciSourceTag` already carry `floor` / "Floor".

---

## 10. Where the code contradicts the design draft — code wins

1. **Duplicates are reported, not refused.** The design says a duplicate is "refused with an inline
   message" (a 409). Shipped: `add` takes a LIST and answers **200** with a per-number verdict —
   `added` / `duplicate` / `invalid` — so one bad number never costs the other nineteen. The 409
   path went with the single-number route. **Code wins.**
2. **Two tables, not one list with two bands.** The design's View row says "Two bands in one list";
   the Columns row lists ONE column set including separate "CI No." and "CI Status". Shipped: a
   narrow Waiting table and a full month table, CI merged into one stacked column. The design's
   later Look row (rewritten 2026-09-23) matches the code; **the older View and Columns rows are
   stale** — read the Look row.
3. **Three batched reads, not one.** The design says "one batched read"; the executor makes three
   (orders, tags, matches). Still never a query per bill, which was the point.
4. **Cancelled bills are record-only.** The design names only dispatched and removed. The code adds
   `cancelled`, because Floor refuses to hold a cancelled bill and a "material not moved" CI on a
   dead bill would be false.
5. **A waiting tag that carries a bill shows the BILL's status.** The design's pill order puts "tag
   waiting → Waiting" first, which would hide "Not held" on a failed hold (the tag stays `waiting`
   there). The code applies the tag-state rules only when there is no bill.
6. **Expired rows sit in the month of their ADDING.** The design says an expired tag "stays visible,
   greyed" without saying where; a tag added in August and expiring in September appears in
   AUGUST's month band, not September's. Worth knowing before somebody calls it a bug.

---

*Written 2026-09-23 against main at `486ce08e`, plus `ca01e97b`'s later CI-source change. Live
figures re-read read-only the same day. No canonical file was edited — consolidation is its own
job.*
