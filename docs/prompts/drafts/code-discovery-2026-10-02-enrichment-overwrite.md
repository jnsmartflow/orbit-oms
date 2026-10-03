# Code discovery — the enrichment status overwrite (W6) and a safe replacement for "fill-only" (F3)
# 2026-10-02 · DISCOVERY ONLY · no code, no SQL run, nothing staged · HEAD `b2a54866`

Files read: CLAUDE.md, docs/CLAUDE_CORE.md (v121 · Schema v27.50, §3), docs/CLAUDE_IMPORT.md (v1.11),
docs/CLAUDE_MAIL_ORDERS.md (v1.14), docs/CLAUDE_BILLING.md (v1.0),
docs/prompts/drafts/code-discovery-2026-10-01-hold-sources.md; at HEAD: `app/api/import/obd/route.ts`,
`lib/import-upsert/effects.ts`, `app/api/mail-orders/ingest/route.ts`, `app/api/mail-orders/[id]/split/route.ts`,
`app/api/mail-orders/[id]/so-number/route.ts`, `app/api/mail-orders/[id]/punch/route.ts`,
`app/api/billing/mail-order/actions/route.ts`, `lib/billing/telephonic-apply.ts`, `lib/billing/mo-ci-tag.ts`,
`lib/billing/sync.ts`, `vercel.json`. All files read.

Line numbers are at `b2a54866` (after 3b, `e1da66f0`, which moved the enrichment by ~+16/+34 lines).

---

## 1. TRIGGERS — every way `applyMailOrderEnrichment` runs

Definition `app/api/import/obd/route.ts:246`. **Four call sites, all inside an IMPORT confirm.** Nothing
else calls it (grep over `app/ lib/`: the four below and the definition).

| # | Caller | Event | Which SOs |
|---|---|---|---|
| T1 | `handleConfirm` (manual template) `:1528` | bills CREATED by this batch (`prisma.orders.createMany`, `:1512-1514`) | the new bills' SOs |
| T2 | `handleManualSapConfirm` effect loop `:2099` | `upsertObd` effect `mail-order-enrichment` | emitted when the bill was **created**, or its `soNumber` header **changed** to non-null (`lib/import-upsert/effects.ts:53-56`) |
| T3 | `handleSapPasteConfirm` effect loop `:2656` | same effect | same rule |
| T4 | `processAutoImportRows` (the **live** Auto-Import, `auto-json`) `:3987` | bills CREATED by this batch (`:3974`) | new bills' SOs. **Existing OBDs are skipped entirely** — "Skip duplicates entirely in auto-import" (`:3502-3503`) |

**Not triggers** (checked at the code, not inferred):
- **Mail-order ingest** (`app/api/mail-orders/ingest/route.ts`) writes `mo_orders` only (`:340`, `:452`); no `orders` write.
- **SO-number capture / re-punch** (`app/api/mail-orders/[id]/so-number/route.ts:61-68`) writes `mo_orders`
  (`soNumber`, `status: "punched"`, `punchedAt`, `punchedById`); for a CI-marked mail order it applies the CI
  **tag** to existing bills (`lib/billing/mo-ci-tag.ts:338` → `applyToExistingBills :162`) — never the
  Hold/Dispatch status. **Punch** (`[id]/punch/route.ts:40-44`) is `mo_orders` only.
- **Split** (`[id]/split/route.ts:89-125`) writes `mo_orders` only.
- **Billing actions** (`app/api/billing/mail-order/actions/route.ts`) apply the mail order's Hold/Release to
  the bills that ALREADY exist (W3: one update + one log per bill, `:402-411`) — directly, not via enrichment.
- **`lib/billing/sync.ts`** is a read (`:65`, `:77`). **Cron** (`vercel.json`): attendance ×2, load-plan
  snapshot, live-prune — none touch enrichment. **patch-headers** (`:4301` onward) reads `mo_orders`
  (`:4402-4403`) only to skip mail-owned times; it writes no `dispatchStatus`.

**A mail order that arrives (or gets its SO number) AFTER its OBD: NOTHING re-runs enrichment for the
existing bills.** Its Hold/Dispatch reaches them by exactly two routes today:
1. a billing user presses ⚑ Hold / Release on that mail order (W3, logged, explicit); or
2. **a LATER sibling OBD of the same SO imports** (T1–T4), and W6's `updateMany` rewrites every older
   bill of the SO (`:385-388`, where `soNumber` / not removed / not cancelled only).
Route 2 is the only "automatic" one, and it is incidental — it depends on SAP issuing a second OBD.

⚠ "Late" means the **SO number** reached the mail order after the OBD imported — enrichment matches
`mo_orders.soNumber` (`:259-262`), and `soNumber` is set at capture time (`so-number/route.ts:64`), not at
email arrival. The fallback's own header measured mail-order **arrival** ("mail order preceded the OBD in
2,498 of 2,498", `:647-651`); whether it measured SO **capture** time is not stated. SELECT row R2 measures both.

---

## 2. THE FALLBACK — `applyNoMailOrderFallback` (`:667-780`)

- **When:** at the same four import confirms, AFTER enrichment and AFTER the telephonic hook
  (`:1541-1542`, `:2141-2142`, `:2687-2688`, `:3996-3997`), keyed on the batch's **obdNumbers**.
- **Who it picks:** `workflowStage = 'pending_support' AND dispatchStatus IS NULL AND orderType <> 'tint' AND
  isRemoved = false` (`:679-686`). A mail-matched bill already has a status (enrichment always writes one —
  `mo_orders.dispatchStatus` defaults to `"Dispatch"`, ingest `:340`), so it never qualifies.
- **Writes, ONE `orders.update`:** `dispatchStatus = 'dispatch'`, `workflowStage = SUPPORT_DONE_OUTPUT`
  (`pending_picking`), plus an engine slot when one is given (`:756-763`).
- **ONE log:** `fromStage 'pending_support' → toStage SUPPORT_DONE_OUTPUT`, `changedById: 1` (system),
  note **`"Auto-dispatched on import (no mail order for this bill)"`** (`:768-776`).
- **Distinguishable afterwards: yes, by that log note** (the only marker; no column). Enrichment's own
  release writes a different note, `"Auto-dispatched by enrichment"` (`:593-600`).
- **Can a fallback-released bill later receive its mail order's Hold? Today, yes, but only by route 2 of §1**
  (a later sibling OBD → W6 overwrite, now with 3b's "Held on import (mail order)" log) or route 1 (billing
  presses ⚑ Hold — W3). If no sibling ever arrives and billing does not press, the Hold never lands — today
  as well as under any proposed rule (case c).
- Its header already names this exact risk and rules it out by data: "A LATE MAIL ORDER CANNOT HAPPEN …
  If that ever stops being true, the risk is that a `hold` intent arriving later finds the bill already
  released" (`:647-651`).

---

## 3. CASE TABLE

W6 today = the `updateMany` (`:385-388`) + the heldAt loop over ALL SO bills (`:526-537`, plus 3b's log for
non-hold → hold) + the auto-advance over ALL `pending_support` bills of the SO (`:561-602`).
"Fill-only" = write status only where `dispatchStatus IS NULL`.

| Case | Today | Strict fill-only | Owner intent | Fill-only |
|---|---|---|---|---|
| **a** OBD-1, mail order Hold, first import | OBD-1 null → hold, logged (3b) | same (null) | held | SAFE |
| **b** OBD-1 no mail order → fallback releases; SO later captured on a Hold mail order; OBD-2 imports | OBD-1 dispatch → **hold** (logged since 3b, even if a picker has it); OBD-2 hold | OBD-1 **stays released**; OBD-2 hold | hold OBD-1 — no human decided its release | **BREAKS** (only if late SO capture is real — R2) |
| **c** as b, no OBD-2 | Hold never applied | same | hold | same as today (not a regression) |
| **d** mail order Hold, OBD-1 held, Floor releases OBD-1, OBD-2 imports | OBD-1 **re-held** (3b logs it) | OBD-1 untouched | stay released | SAFE (fixes) |
| **e** mail order Dispatch, a person holds OBD-1, OBD-2 imports | OBD-1 hold → **dispatch, no log**; and if OBD-1 sits at `pending_support`, the auto-advance moves it to `pending_picking` (logged "Auto-dispatched by enrichment") | status untouched — **but see ⚠ below** | stay held | SAFE only if the auto-advance and heldAt loop are fenced too |
| **f** mail order Hold; billing presses Release (W3 clears existing bills, logged); OBD-2 imports | all → dispatch (OBD-1 already dispatch; if Floor re-held OBD-1 meanwhile, that hold is cleared silently) | OBD-1 untouched; OBD-2 dispatch | as fill-only | SAFE |
| **g** mail order Dispatch; billing ⚑ Hold after OBD-1 exists (W3 holds it, logged; mo stamped `heldById`); OBD-2 imports | OBD-1 already hold (no 2nd log); OBD-2 hold, "billing hold on mail order" log | same | same | SAFE |
| **h** mail order split A/B while held | A keeps its row (incl. `heldAt/heldById`); **B is a new row copying `dispatchStatus` only** (`split/route.ts:102`) — neither half carries an SO yet (`soNumber` not copied, `:89-108`); each half's later SO capture + import behaves as a/g | same | B logged as billing's if billing held it | SAFE (status); B mis-labelled "auto" → §5 |
| **i** re-import of the SAME OBD | Auto-Import: skipped (`:3502-3503`). Manual SAP / paste: enrichment only if the OBD's `soNumber` CHANGED (`effects.ts:53-56`) — then it rewrites every bill of the NEW SO as W6 | the re-imported bill keeps its status; siblings untouched | keep human decisions | SAFE |
| **j** (extra) tint bill: enrichment writes status at import; tint completion branches on `isHeld` (`app/api/tint/operator/done/route.ts:209-226`) | sibling import can flip a tinting bill's hold/dispatch silently | untouched | keep | SAFE |
| **k** (extra) Pick-delete Undo / Floor Restore / Billing release write `dispatch` or null + log | a later sibling can re-hold (Hold mo) or—Restore leaves `null`—refill | Restore's `null` gets refilled from the mail order (that is a fresh decision on a restored bill; same as first import) | refill acceptable | SAFE |
| **l** (extra) CI-marked SO (`billOnly`) | enrichment carries no status at all (`:283-287` `!billOnly`), safety-net hold null-only (`:401-406`) | n/a | n/a | unaffected |

⚠ **The status write is not the only overwrite.** Two follow-on blocks also act on EVERY bill of the SO and
must be fenced to the bills the status write actually wrote, under any rule:
- **heldAt loop** `:526-537` re-stamps `heldAt` on all SO bills whenever the mail order is Hold — under
  fill-only it would stamp `heldAt` on a released sibling (wrong, and a second `orders` write).
- **auto-advance** `:561-602` finds `workflowStage: "pending_support"` bills of the SO with **no
  `dispatchStatus` filter** and writes `pending_picking + dispatch` (+ log). A person's hold on a
  `pending_support` bill (enrichment-held at import, Floor hold, Restore) would still be cleared by a
  Dispatch sibling — fill-only on the `updateMany` alone does not protect case e.

---

## 4. RULE PROPOSAL

Options weighed:
1. **Strict fill-only** — safe everywhere except case b. Simple, one where-clause.
2. **Fill-only + overwrite when the status is system-owned** — needs a definition of "system-owned".
   Broad versions ("no human log after the latest system write") need a note taxonomy across ~20 writers
   (release prefixes, restore, CI, cancel, picking logs…) and break the day someone adds a note.
3. **Apply on transition only** (write when the mail order's status differs from what enrichment last applied
   to the bill) — needs to know "last applied": either a new column or reverse-engineering logs; and it can
   still clear a later human hold (f, when Floor re-held after the billing Release).

**Pick: (1) strict fill-only, plus ONE narrow, log-derived exception for case b — "untouched fallback".**

> A bill of the SO is written by enrichment when **either**
> (A) `dispatchStatus IS NULL`, **or**
> (B) the mail order is **Hold**, the bill's `dispatchStatus = 'dispatch'`, and the bill's **latest
> `order_status_logs` row (any note) is the fallback's own row** — note
> `"Auto-dispatched on import (no mail order for this bill)"`.

Why (B) is exact: the fallback writes that row as the bill's release; **every** later human or system
action on a bill writes a newer log row — Floor hold/release/slot/urgent/cancel (`lib/floor/bill-actions.ts:371`),
picking assign/unassign/done/approve/cancel (`app/api/picking/*/route.ts`, e.g. `assign/route.ts:148`),
billing actions (`actions/route.ts:403`), tint, CI. So "latest log is still the fallback row" means *nobody
and nothing has touched this bill since the system released it*, which is precisely the case-b bill and
nothing else. It never matches a held bill (status ≠ dispatch), a released-by-person bill (newer log), or
a bill a picker has (assign log). Dispatch → hold is the only overwrite it permits; hold → dispatch never
happens through enrichment again.

Consequences:
- **No new column.** Derived from the existing log (one batched read per SO, only when the mail order is Hold).
- **Every status change it makes is logged:** null → hold and the (B) dispatch → hold are both "non-hold →
  hold", already logged by 3b (`MAIL_ORDER_AUTO_HOLD_NOTE` / `MAIL_ORDER_BILLING_HOLD_NOTE`). null →
  dispatch on a `pending_support` bill is logged by the auto-advance ("Auto-dispatched by enrichment");
  **null → dispatch on a tint-room bill writes no log today** — propose a note
  `MAIL_ORDER_DISPATCH_NOTE = "Status set on import (mail order)"` in `lib/floor/hold-log.ts`, outside
  `HOLD_LOG_NOTES`. A **"Hold cleared on import (mail order)"** note is **not needed** under this rule
  (enrichment never moves hold → dispatch); if the owner prefers option 2 or 3, that is its text, and it
  lives in `hold-log.ts` OUTSIDE `HOLD_LOG_NOTES` beside the other clear notes.

Change shape (one file + constants):
- `app/api/import/obd/route.ts` `applyMailOrderEnrichment`:
  - split `dispatchStatus` OUT of `updateData`; the shared `updateMany` (`:385-388`) keeps carrying the other
    fields (remarks, priority, slot, orderDateTime, slots) unchanged — **⚠ priority/slot/remarks are the same
    overwrite-everything shape**; out of scope here, Q3;
  - one status write per eligible bill, chosen by (A)/(B) from the existing prior-status read (`:368-378`,
    widened to also fetch each bill's latest log note — one `order_status_logs` read for the SO's ids);
  - heldAt loop (`:526-537`) and 3b log → only the bills the status write moved INTO hold (and still ONE
    `orders.update` per bill: fold `heldAt` into the per-bill status write instead of a second update —
    this also fixes today's double write, the `updateMany` + the heldAt `update`);
  - auto-advance (`:561-602`) → only bills the status write just moved null → dispatch.
- `lib/floor/hold-log.ts`: `MAIL_ORDER_DISPATCH_NOTE` (+ `FALLBACK_RELEASE_NOTE` constant for the fallback's
  string, which is today an inline literal at `:774` — the rule must match it, not retype it).
- No schema change. No change to the fallback, W3, the telephonic hook or the CI path.
Blast radius: every import confirm (T1–T4). Behaviour changes only in cases d, e, f(re-hold), i(SO change),
j — each from "silently overwrite a decision" to "leave it"; case b keeps today's behaviour.

---

## 5. SPLIT FOLLOW-UP

Confirmed: `app/api/mail-orders/[id]/split/route.ts:89-108` creates the B half with
`dispatchStatus: order.dispatchStatus` (`:102`) and no `heldAt` / `heldById`; `order` is a full-row
`findUnique` (`:45-47`), so both values are available. Fix, inside that `create`'s `data`:

```ts
...(order.dispatchStatus?.toLowerCase() === "hold" ? { heldAt: order.heldAt, heldById: order.heldById } : {}),
```

A stays as is (its own row keeps its stamp). Blast radius: one route, `mo_orders` only.

---

## Live SELECT block (read-only, Supabase SQL Editor)

Window: orders created in the last 60 days, not removed. "Import day" = IST date of `orders.createdAt`.

```sql
-- READ-ONLY · enrichment-overwrite discovery · 2026-10-02 · SELECT only, no BEGIN/COMMIT, no writes.
WITH o60 AS (
  SELECT o.id, o."soNumber", o."createdAt", o."dispatchStatus",
         (o."createdAt" AT TIME ZONE 'Asia/Kolkata')::date AS "importDay"
    FROM orders o
   WHERE o."isRemoved" = false AND o."createdAt" >= now() - interval '60 days'
),
multi AS (
  SELECT "soNumber", count(*) AS obds, count(DISTINCT "importDay") AS days
    FROM o60 WHERE "soNumber" IS NOT NULL GROUP BY "soNumber" HAVING count(*) > 1
),
fb AS (   -- bills released by the no-mail-order fallback
  SELECT o.id, o."soNumber", o."createdAt"
    FROM o60 o
   WHERE EXISTS (SELECT 1 FROM order_status_logs l
                  WHERE l."orderId" = o.id AND l.note = 'Auto-dispatched on import (no mail order for this bill)')
),
holdnotes AS (
  SELECT unnest(ARRAY['Held from floor','Placed on hold by support','Placed on hold by support (bulk)',
                      'Held on import (Telephonic tag)','Held on import (CI marked in billing)',
                      'Held from billing','Held from Tint Manager',
                      'Held on import (mail order)','Held on import (billing hold on mail order)']) AS note
),
grid AS (
  -- R1: SOs with >1 OBD, and how many span more than one import day
  SELECT '10' AS sort, 'R1 SOs with >1 OBD (60d)' AS label,
         count(*)::text AS v1,
         ('spanning >1 import day: ' || count(*) FILTER (WHERE days > 1))::text AS v2,
         ('OBDs in those SOs: ' || COALESCE(sum(obds), 0))::text AS v3,
         ('OBDs in multi-day SOs: ' || COALESCE(sum(obds) FILTER (WHERE days > 1), 0))::text AS v4
    FROM multi
  UNION ALL
  -- R2: fallback bills, and a mail order for the same SO created / SO-captured AFTER the bill's import
  SELECT '20', 'R2 fallback-released bills (60d)', count(*)::text,
         ('with ANY mail order on the SO: ' || count(*) FILTER (WHERE EXISTS
            (SELECT 1 FROM mo_orders m WHERE m."soNumber" = fb."soNumber")))::text,
         NULL::text, NULL::text
    FROM fb
  UNION ALL
  SELECT '21', 'R2 · mail order CREATED after bill import · status=' || COALESCE(m."dispatchStatus", '(null)'),
         count(DISTINCT fb.id)::text, NULL::text, NULL::text, NULL::text
    FROM fb JOIN mo_orders m ON m."soNumber" = fb."soNumber" AND m."createdAt" > fb."createdAt"
   GROUP BY m."dispatchStatus"
  UNION ALL
  SELECT '22', 'R2 · SO CAPTURED (punchedAt) after bill import · status=' || COALESCE(m."dispatchStatus", '(null)'),
         count(DISTINCT fb.id)::text,
         ('of which mail order created BEFORE the bill: ' || count(DISTINCT fb.id) FILTER (WHERE m."createdAt" <= fb."createdAt"))::text,
         NULL::text, NULL::text
    FROM fb JOIN mo_orders m ON m."soNumber" = fb."soNumber" AND m."punchedAt" > fb."createdAt"
   GROUP BY m."dispatchStatus"
  UNION ALL
  -- R3 (case d): released by a person, now held again, and NO hold log after the release
  SELECT '30', 'R3 case d · release/clear log, now hold, no hold log after it', count(*)::text,
         NULL::text, NULL::text, NULL::text
    FROM o60 o
   WHERE o."dispatchStatus" = 'hold'
     AND EXISTS (
       SELECT 1 FROM order_status_logs r
        WHERE r."orderId" = o.id
          AND (r.note LIKE 'Released to floor%'
               OR r.note IN ('Hold cleared on floor','Hold cleared from billing','Hold cleared from Tint Manager'))
          AND NOT EXISTS (SELECT 1 FROM order_status_logs h
                           WHERE h."orderId" = o.id AND h."createdAt" > r."createdAt"
                             AND h.note IN (SELECT note FROM holdnotes)))
  UNION ALL
  -- R4 (case e): a PERSON held it, it is no longer held, and nothing logged a clear/release/cancel/restore since
  SELECT '40', 'R4 case e · human hold, now not hold, no clear log since · now=' || COALESCE(o."dispatchStatus", '(null)'),
         count(*)::text, NULL::text, NULL::text, NULL::text
    FROM o60 o
    JOIN LATERAL (SELECT max(l."createdAt") AS at FROM order_status_logs l
                   WHERE l."orderId" = o.id
                     AND l.note IN ('Held from floor','Held from billing','Held from Tint Manager')) hh ON hh.at IS NOT NULL
   WHERE COALESCE(o."dispatchStatus", '') <> 'hold'
     AND NOT EXISTS (
       SELECT 1 FROM order_status_logs c
        WHERE c."orderId" = o.id AND c."createdAt" > hh.at
          AND (c.note LIKE 'Released to floor%'
               OR c.note IN ('Hold cleared on floor','Hold cleared from billing','Hold cleared from Tint Manager')
               OR c.note LIKE 'Restored%' OR c.note LIKE 'CI raised%' OR c."toStage" = 'cancelled'))
   GROUP BY o."dispatchStatus"
  UNION ALL
  -- R5: currently held bills (all dates) by latest hold-log note, incl. the two 3b notes
  SELECT '50', 'R5 held now · ' || COALESCE(x.note, 'NO hold log'), count(*)::text, NULL::text, NULL::text, NULL::text
    FROM (SELECT o.id,
                 (SELECT l.note FROM order_status_logs l
                   WHERE l."orderId" = o.id AND l.note IN (SELECT note FROM holdnotes)
                   ORDER BY l."createdAt" DESC, l.id DESC LIMIT 1) AS note
            FROM orders o
           WHERE o."dispatchStatus" = 'hold' AND o."isRemoved" = false AND o."isHidden" = false) x
   GROUP BY x.note
)
SELECT label, v1, v2, v3, v4 FROM grid ORDER BY sort, label;
```

How to read it: **R2 rows 21/22** decide whether case b is real (non-zero `status=Hold` = the exception (B)
is earning its keep; zero = strict fill-only would do). **R4** counts holds that were cleared with no log —
W6's damage so far. **R3** counts re-holds after a person's release. R5 confirms the 3b notes are landing.
(R5 does not apply the hide rules; it is the raw held set.)

---

## Questions for Smart Flow (max 3)

1. **Case b exception.** Approve "fill-only + untouched-fallback" (a system-released bill nobody has touched
   since may still be held by a later sibling import), or take strict fill-only if R2 shows zero?
2. **Fence the follow-on blocks too.** The auto-advance and the heldAt loop must act only on bills the status
   write changed, or a Dispatch sibling still clears a person's hold on a `pending_support` bill — include
   them in the same change (recommended)?
3. **Priority, slot, remarks, orderDateTime** ride the same overwrite-every-sibling `updateMany`
   (`:385-388`) — e.g. a later sibling resets Floor's ⚡ urgent or a manual slot. Leave for a separate step,
   or fold into this one?

*Discovery only. Nothing edited except this file; nothing staged or committed; no SQL run.*
