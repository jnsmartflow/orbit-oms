# code-update-2026-10-07 — Challan Orders slice 6: import catch, late-paste safety net, linked-OBD admin cancel

**Status:** BUILT. `tsc --noEmit` clean · `npm run build` clean — **414** route-table entries (was 411; +3:
`/api/challan-orders/alerts`, `…/links/[id]/retry`, `…/linked-obds/[orderId]/cancel`), 84/84 static pages ·
`lib/floor/hold-log.test.ts` 4/4 (count 9 → 10). **Nothing was imported, pasted or cancelled on live.** Read-only smoke
on live (0 live links): `catchChallanObds` over 50 recent real OBDs returned empty sets and wrote nothing (orders
`MAX(updatedAt)` unchanged); `reconcileSo` on a real SO → `noLink`; alerts 0; board 0/0/0.
Spec: `code-plan-2026-10-07-challan-slice6.md` (f96f0ba0) + web-update §4e S6-1…S6-7.

## 1. What shipped

| Piece | Where |
|---|---|
| **The catch + safety net** — one rule (`reconcileSo`), three callers | `lib/challan-orders/reconcile.ts` |
| Catch in all four import paths, before every release | `app/api/import/obd/route.ts` — template `handleConfirm` (STEP D1a), Auto-Import `processAutoImportRows` (CONFIRM D1a), manual-SAP + clipboard paste (before their effect loop) |
| **B** — enrichment lock | `applyMailOrderEnrichment`: `challan_linked` added to every by-SO read / write (`priorStatus`, the main `updateMany`, ship-to carry, bill-only `toHold`, `ordersForEngine`, `ordersToHold`) |
| **D4** — no CHN for a linked OBD | template + auto D2b filter; SAP/paste effect loop skip; `createChallanForOrder` re-reads the stage |
| **S6-1** dealer mismatch → HOLD + red alert | `reconcileSo` (hold write + `CHALLAN_DEALER_HOLD_NOTE`, `lib/floor/hold-log.ts`, Floor shows "Held from: Billing · challan") |
| **S6-2 / D11** late paste — replaces slice 5's refusal | `lib/challan-orders/links.ts` `pasteSo` step 8 → `reconcileSo`: untouched → pulled back; touched → link stays `waiting` + red alert |
| **S6-5** Telephonic-tag warning at paste | `pasteSo` step 6b → "Link anyway" |
| **S6-6** catch failed → red alert + Retry; **S6-1** "Link anyway" | `lib/challan-orders/alerts.ts`, `GET /api/challan-orders/alerts`, `POST /api/challan-orders/links/[id]/retry`, `components/challan-orders/challan-alert-strip.tsx` — on the Challan screen (all 3 mounts) **and Floor** |
| **S6-3 / S6-7** admin-only cancel of a linked OBD; link back to `waiting` | `lib/challan-orders/linked-cancel.ts`, `POST /api/challan-orders/linked-obds/[orderId]/cancel`, "Cancel OBD" on the Billed / Waiting rows (admin only) |
| **S6-4** ORB cancelled after linking → bills to Floor undecided, links unlinked | `lib/challan-orders/cancel-guard.ts` `releaseChallanOnCancel` (renamed from `unlinkWaitingOnCancel`), every ORB cancel path |
| **E** one slot rule | `lib/dispatch/legacy-slot.ts` `resolveLegacySlot`; the import's `resolveSlot` calls it; `create.ts`'s copy deleted |
| Part-billing on the screen | board rows carry every linked OBD (`orders.challanOrderId`), not only the link's first |

**How each alert clears (always a person's action — nothing is stored, they are computed live):**
DOUBLE DISPATCH RISK → someone **cancels that OBD** (Floor / Picking / Tint) or **unlinks the SO** · Dealer mismatch →
billing presses **Link anyway** (pulls it back) or **unlinks the SO** (then Floor releases the hold as for any held bill) ·
Catch failed → someone presses **Retry** (or cancels the OBD / unlinks the SO).

## 2. PROOF — a bill whose SO has NO live link behaves exactly as before

The catch's first statement reads the link table for this batch's SOs; **no live link → it returns empty sets** and every
filter below is a no-op. Proven on live data (0 live links): 50 real OBDs → 0 excluded, 0 writes.

| Changed code path | Why an unlinked bill is unaffected |
|---|---|
| `catchChallanObds` (4 call sites) | reads only; `linkedSos` empty → `excludeSos` / `excludeObds` empty, `excludeAll` false |
| R1 SO list `.filter(so => !excludeSos.has(so))` (template, auto); effect-loop `if excludeSos.has(so) break` (SAP, paste) | empty set → same list, same calls |
| Telephonic + R2 OBD lists `.filter(releasable)` | `releasable` is true for every OBD not in the empty set |
| CHN filter / effect skip | same |
| `createChallanForOrder` stage re-read | an imported bill is never `challan_linked` unless caught → returns as before (one extra read) |
| Enrichment lock: `notIn: ["cancelled", CHALLAN_LINKED]` (was `not: "cancelled"`) | only a `challan_linked` row is newly excluded; no unlinked bill is ever at that stage. ⚠ Written as ONE `workflowStage` key — a spread `NOT_CHALLAN_LINKED` would have OVERWRITTEN the cancelled term (tsc caught it) |
| `resolveSlot` → `resolveLegacySlot` | moved verbatim; same cut-offs (`""→Night, 09:00→Morning, 10:30/12:29→Afternoon, 15:30/23:00→Night` checked) |
| hold-log: one more note | additive; existing notes unchanged |
| `releaseChallanOnCancel` | runs only when the cancelled bill `isChallanOrder` |
| Paste / alerts / retry / linked-cancel | challan screens only |
| **The one behaviour change:** if the link table itself cannot be read, `excludeAll` keeps the WHOLE batch out of every release (fail closed) — those bills wait on Floor's undecided list for a person. On today's code that DB failure would most likely have failed the import anyway. |

## 3. Every route touched

`app/api/import/obd/route.ts` (all four create paths, enrichment, CHN helper, `resolveSlot`) · new
`/api/challan-orders/alerts`, `/links/[id]/retry`, `/linked-obds/[orderId]/cancel` · `/api/challan-orders/links`
(paste) · the ORB cancel paths via `releaseChallanOnCancel`: `/api/floor/actions`, `/api/tint/manager/cancel`,
`/api/floor/ci`, `/api/tint/manager/ci`, `/api/picking/cancel`, `/api/tint/manager/orders/[id]/remove`.
Pages: `/floor` (alert strip; `page.tsx` passes `isAdminChallan`), `/mail-orders` + `/place-order` layouts (`isAdmin` on
the challan access provider).

## 4. Differs from the plan

1. **No catch on `patch-headers`** — as the plan said; it writes no stage, status or SO.
2. **Fail-closed batch** (`excludeAll`) when the link table can't be read — not in the plan; documented in §2.
3. **Import catch only reconciles the OBDs of THAT batch** (`onlyObds`) — an older touched OBD on the same SO is reported by
   the alert strip, not re-processed at every import.
4. A dealer-mismatched OBD is held **even if it is `pending_picking`** (a late paste on an untouched, released bill) — S6-1
   "never release".
5. The Floor strip is above the desk on every Floor tab; the plan's per-row ⚠ on the Floor table is not built — the strip
   names the OBD.

## 5. TEST SCRIPT (owner, admin, local) — T0 → T9 in order

**Files:** `docs/test-data/challan-slice6/*.xlsx` — Template 2 (Combined), sheets `LogisticsTrackerWareHouse` +
`LineItems`, one OBD each. Fake numbers only: OBDs `99999990NN`, SOs `99990000NN` (live: 0 orders start `9999`).
Dealer: **Mohan Colour Co `102425`** (T7: **Shree Colour House `737556`**). Line: `IN28140071` (DN SATIN STAY BRIGHT
WHITE 4L) × 1. **`OBD Email Date` is set to 08 Oct 2026 — open each file and change it to the day you test** (so the
bill is not "old" on Floor).
**Import = `/admin/import` → Import → "Template 2 — Combined File (Two Sheets)" → choose the file → Preview → Confirm.**
**Paste = Billing → Challan orders → Not billed → the ORB row → Paste SO → Link.**

Pre-check (read-only, expect 0): `SELECT count(*)::text FROM orders WHERE "obdNumber" LIKE '9999%' OR "soNumber" LIKE '9999%';`

| # | Clicks | Must show |
|---|---|---|
| **T0** ✕ unlink + re-paste (slice 5 left-over) | Create test ORB **A** (Place Order challan mode, Mohan Colour Co). Paste `9999000001` → Waiting → **✕** → paste `9999000001` again | After ✕: back in Not billed, History shows `9999000001` struck through. After re-paste: Waiting. |
| **T1** main catch | Import `T1-main-catch.xlsx` | Import: 1 created. OBD `9999999001` is on **no** board (Picking, Floor any tab, Hold, Tint). Challan orders → A in **Billed**, OBD `9999999001`. No red alert. |
| **T2** part-billing, same SO | Import `T2-part-billing-same-so.xlsx` | `9999999002` also hidden; A's Billed row lists **both** OBDs. |
| **T3** second SO, same ORB | ORB **B**: paste `9999000002` AND `9999000003`. Import `T3a-second-so-first.xlsx` → then `T3b-second-so-second.xlsx` | After T3a: B in **Waiting**, "part-billed — 1 of 2", `9999999003` listed. After T3b: B in **Billed** with 2 OBDs. |
| **T4** unlinked SO flows normally | Import `T4-unlinked-so-flows-normally.xlsx` (no paste anywhere) | `9999999005` appears on **Picking Assign** and **Floor** like any bill. No alert. |
| **T5** late paste, untouched → pull-back | Import `T5-late-paste-untouched.xlsx` → it reaches Picking Assign. ORB **C**: paste `9999000006` | Green note "Pulled back OBD 9999999006 into this challan". It **vanishes** from Picking/Floor. C → Billed. |
| **T6** late paste, touched → warn | Import `T6-late-paste-touched.xlsx` → on `/picking` **assign it to a picker**. ORB **D**: paste `9999000007` | Red note "DOUBLE DISPATCH RISK — OBD 9999999007: a picker has it". D stays in **Waiting**. The red banner shows at the top of the Challan screen **and on Floor**, and stays. Clear it: Floor → cancel `9999999007` → banner gone on the next refresh (≤ 30 s). |
| **T7** dealer mismatch | ORB **E** (Mohan Colour Co): paste `9999000008`. Import `T7-dealer-mismatch.xlsx` (bill-to Shree Colour House) | `9999999008` is **held** — Floor → On hold, "Held from: Billing · challan"; NOT linked, NOT on Picking. Red banner "Challan dealer mismatch — held" with **Link anyway**. Press it → `9999999008` disappears from Hold; E → Billed. |
| **T8** re-import | Import `T1-main-catch.xlsx` again | "duplicate / skipped"; nothing changes (no second log). |
| **T9** clean-up (S6-3/S6-7, then S6-4) | As admin: Challan orders → Billed → each `99999990NN` → **Cancel OBD** (reason Other, remark "TEST"). Then cancel ORB orders A–E (Floor ⋯ Cancel, admin). As a NON-admin: no "Cancel OBD" button is drawn | Each cancelled OBD drops out; its link goes back to **waiting** (S6-3) until the ORB is cancelled, then **unlinked** (S6-4). Cancel `9999999005` (T4) on Floor as any bill. |

**One verify SELECT after each test (read-only):**
```sql
SELECT 'obd'::text AS a, o."obdNumber"::text AS b, o."workflowStage"::text AS c,
       coalesce(o."dispatchStatus",'(null)')::text AS d, coalesce(o."challanOrderId"::text,'(null)') AS e,
       coalesce(o."soNumber",'(null)')::text AS f
  FROM orders o WHERE o."obdNumber" LIKE '9999999%'
UNION ALL
SELECT 'link', l.id::text, l."soNumber"::text, l.status::text, coalesce(l."linkedOrderId"::text,'(null)'),
       (SELECT r."obdNumber" FROM orders r WHERE r.id = l."orbOrderId")::text
  FROM challan_order_so_links l WHERE l."soNumber" LIKE '99990000%'
UNION ALL
SELECT 'chn', c."challanNumber"::text, o."obdNumber"::text, c."isVoided"::text, '', ''
  FROM delivery_challans c JOIN orders o ON o.id = c."orderId" WHERE o."obdNumber" LIKE '9999999%'
UNION ALL
SELECT 'log', o."obdNumber"::text, g."toStage"::text, coalesce(g."fromStage",'(null)')::text, g.note::text, g."createdAt"::text
  FROM order_status_logs g JOIN orders o ON o.id = g."orderId" WHERE o."obdNumber" LIKE '9999999%'
ORDER BY 1, 2;
```
**Expect:** `chn` rows = **0** always · T1/T2/T3/T5 OBDs `challan_linked`, `(null)` status, `challanOrderId` = their ORB ·
T4 `pending_picking` / `dispatch` · T7 held (`hold`) until Link anyway, then `challan_linked` · a "Linked to challan …" or
"Pulled back to challan …" log per caught OBD, exactly one (T8 adds none) · after T9 every `9999…` OBD `cancelled`, every
`99990000…` link `unlinked`.

**Clean-up check (read-only, expect 0 / 0):**
`SELECT (SELECT count(*) FROM orders WHERE "obdNumber" LIKE '9999999%' AND "workflowStage" <> 'cancelled')::text, (SELECT count(*) FROM challan_order_so_links WHERE "soNumber" LIKE '99990000%' AND status <> 'unlinked')::text;`
Rows are never deleted — the test OBDs, ORB orders and links stay as cancelled / unlinked history.

---

## Slice 6c — check-failed visibility (2026-10-07)

**Problem.** If an import could not read the challan link table, its whole batch was withheld from every release
(fail closed) and Floor showed those bills as ordinary undecided "no slot" bills — no alert, no reason.

**Where the failure is recorded:** `import_batches.status = 'challan_check_failed'` on that import's batch
(`lib/challan-orders/check-failed.ts`). One row per import, written by every import path anyway, **no CHECK on the column
(live, read-only 2026-10-07: only `completed` exists, 3,832 rows)** — so **no DDL**. It never depends on the link table.
All four import paths now end with `status: finalBatchStatus(<their catch>.excludeAll)` — `"completed"` exactly as before
unless the check failed. The withheld bills = the batch's orders (`orders.batchId`) still `pending_support` + null status +
not removed; a bill someone already handled drops out of the count.

**The alert.** `GET /api/challan-orders/alerts` now also returns `batches` (read from `import_batches` + `orders`, never the
link table) and reads the two sources separately. The strip (Floor AND the Challan screen) shows one red line per batch:
**"Import BATCH-… : N bills held — challan check failed — Retry"** + "Do not release them by hand". If the alert source itself
fails (or the link-based half fails), it shows **"Challan check status unknown — contact admin"** instead of nothing.
401/403 still stay silent.

**Retry** = `POST /api/import/obd?action=challan-check-retry {batchId}` (inside the import route, beside the release
functions it reuses):
1. the normal `catchChallanObds` over the batch's bills — still unreadable → 503, nothing written, the line stays;
2. for the bills NOT caught / held / left: the import's own release steps in its order — `applyMailOrderEnrichment` (R1) →
   `applySoTagHolds` (Telephonic) → `applyNoMailOrderFallback` (R2) → CHN (eligible SMU + an active line,
   `createChallanForOrder`);
3. batch → `completed`; the line clears.
Idempotent: a batch already `completed` answers `alreadyDone`; R2 moves only `pending_support` + null; tags claim once;
`createChallanForOrder` returns if a CHN exists. Safe to press twice.

**Who can press Retry:** **`floor` canEdit** — the permission that already releases bills on Floor
(`/api/floor/release`). The server returns `canRetryBatches`; without it the button is not drawn and the line says "ask
someone with Floor edit access to press Retry".

**Small guards:** the confirm handler treats a flagged batch as already confirmed (409) — a second confirm would only collide
on `obdNumber` and overwrite the flag with `failed`. The import log (`/api/import/log`) lists flagged batches too, so the
import doesn't vanish from history.

**How the failure path was tested without live:**
- `lib/challan-orders/check-failed.test.ts` (5/5): with the test-only flag on, `catchChallanObds` throws inside its `try`
  BEFORE its first query → `excludeAll = true`, no sets, no results, and `finalBatchStatus` gives the flag. No database
  connection is used. Also: the flag can never fire when `NODE_ENV=production`; the strip message wording; an empty batch is
  never flagged.
- The flag: `CHALLAN_CHECK_FORCE_FAIL=1`, honoured ONLY when `NODE_ENV !== "production"` — never set on Vercel, and Vercel's
  build runs with `NODE_ENV=production`, so it cannot fire live.
- Nothing was imported, and the failure was not triggered on live.

**No behaviour change for a normal import:** the only new write on the normal path is the status value, and
`finalBatchStatus(false)` is the same `"completed"` string. Retry is a new action no import calls. AN IMPORT IS NOT A CALL.

**Files:** NEW `lib/challan-orders/check-failed.ts`, `check-failed-message.ts` (client-safe half for the strip),
`check-failed.test.ts`, `docs/test-data/challan-slice6/T10-check-failed.xlsx` · EDITED `app/api/import/obd/route.ts`
(4 final statuses, the confirm guard, `handleChallanCheckRetry` + its dispatch), `lib/challan-orders/reconcile.ts` (the
test-only throw), `app/api/challan-orders/alerts/route.ts`, `components/challan-orders/challan-alert-strip.tsx`,
`app/api/import/log/route.ts`. tsc clean · build exit 0, 414 routes (Retry is an action, not a new route), 84/84 static.

**Limit.** A bill the failed import PATCHED (SAP / paste path, already in Orbit) keeps its own older `batchId` and is not
in the count — it was released by its own import long ago; only the enrichment re-run was skipped for it.

### T10 — check failed (owner, local only; run after T9)

Safe because the flag only works on your local dev server, only the import you make while it is on is affected, and the
file holds a fake OBD.
1. Change `OBD Email Date` in `T10-check-failed.xlsx` to today.
2. Stop the dev server. In PowerShell: `$env:CHALLAN_CHECK_FORCE_FAIL='1'; npm run dev`. Do NOT use Auto-Import or any
   real file while it runs.
3. `/admin/import` → import `T10-check-failed.xlsx` → you see it complete.
4. Floor → red line "Import BATCH-…: 1 bill held — challan check failed — Retry". `9999999009` is on Floor undecided, NOT on
   Picking. The same line shows on Challan orders.
5. Press **Retry** while the flag is still on → red error "The challan check still cannot run — nothing was released"; the
   line stays.
6. Stop the dev server. Start it normally: `Remove-Item Env:CHALLAN_CHECK_FORCE_FAIL; npm run dev`.
7. Press **Retry** → the line disappears; `9999999009` is on **Picking Assign** (no link on its SO → released as normal).
   **⚠ cancel after:** cancel `9999999009` on Floor.

Verify (read-only):
```sql
SELECT 'batch'::text AS a, b."batchRef"::text AS b, b.status::text AS c, ''::text AS d
  FROM import_batches b JOIN orders o ON o."batchId" = b.id WHERE o."obdNumber" = '9999999009'
UNION ALL
SELECT 'obd', o."obdNumber"::text, o."workflowStage"::text, coalesce(o."dispatchStatus",'(null)')::text
  FROM orders o WHERE o."obdNumber" = '9999999009';
```
Expect after step 4: `challan_check_failed` · `pending_support` · `(null)`. After step 7: `completed` ·
`pending_picking` · `dispatch`. After the cancel: `cancelled`.
