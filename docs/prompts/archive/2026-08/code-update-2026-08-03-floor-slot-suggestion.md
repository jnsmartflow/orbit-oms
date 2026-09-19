# code-update-2026-08-03-floor-slot-suggestion.md

**Session:** 2026-08-03 · Floor Control slot suggestion + dispatch-clock root-cause fix
**Status:** SHIPPED — 10 commits pushed to main. Manual verification pending (§8).
**Modules touched:** Floor Control (`/floor`), Dispatch engine inputs, OBD import
**Canonical files needing update at next consolidation:** CLAUDE_FLOOR.md (§8/§10 deferred-suggestion entry is now stale), CLAUDE_CORE.md (§7.4 dispatch engine, §4 Auto-Import status), CLAUDE_IMPORT.md (already corrected in-session, commit `4aad3622`)

---

## 1. What shipped

| Commit | What |
|---|---|
| *(phase 2)* | `lib/floor/suggest.ts` + `queries.ts` — SMU gate neutralised, stale guard fixed, `RAIL_SUGGESTIONS_ENABLED = true` |
| `dd871c41` | Rail card UI — teal split-confirm button, `▾` → existing picker pre-highlighted, "Why no slot?" link |
| `3305567f` | 60-minute grace rule replacing the two stale arms |
| `09c3abe5` | Tint full-OBD suggestion anchored to `tint_assignments.completedAt` |
| `7e466776` | `TintState.completedAt` re-typed `Date` → `string` (JSON payload truth) |
| `03b6dd19` | **Step A** — `hasClockTime()`; time-less punch clock no longer fed to the engine |
| `145f0bd5` | **Step A2** — cross-day protection: later-day time-less punch → decline, never past-date |
| `dee603dc` | **Step A3** — symmetric: the EMAIL clock gets the same check |
| `4aad3622` | `docs/CLAUDE_IMPORT.md` — five stale "Auto-Import PAUSED" claims corrected to LIVE |
| `ab70c826` | **Step B** — the auto-import correction pass now recomputes the dispatch window |

---

## 2. The locked slot rule — CODE-VERIFIED, do not restate from memory

Every line below was read out of `lib/dispatch/dispatch-engine.ts` during this session, not inferred.

**Cutoffs (inclusive boundaries):**
- **Local** — ≤10:30 → today 10:30 (`R1_LOCAL_1030`) · ≤12:30 → today 12:30 (`R1_LOCAL_1230`) · ≤16:00 → today 16:00 (`R1_LOCAL_1600`) · after 16:00 → next working day 10:30 (`R1_LOCAL_NEXT_1030`)
- **Upcountry** — ≤17:00 → today 18:00 (`R1_UPC_1800`) · after 17:00 → next working day 18:00 (`R1_UPC_NEXT_1800`)
- **IGT / Cross / null delivery type** → declines (`delivery-type-unhandled`, `:150-152`)
- "Next working day" skips **Sunday only**. Saturday is a working day. **Holidays are deliberately not modelled.**

**The anchor clock** (`pickEffectiveClock`, `:104-136`): same IST calendar date → earlier of the two · different date → later of the two · one null → the other outright · both null → `no-order-datetime`.

**Suggestion-specific rules (this session's decisions):**
- Non-tint: dual-clock as above, **any SMU** (the engine's `Deco Retail` gate is neutralised by passing a literal — the engine itself is never edited).
- Tint, **full OBD only**: anchored to `tint_assignments.completedAt`, passed as the single clock (`punchDateTime = null`). Split orders → no suggestion.
- **60-minute grace:** a batch stays OPEN for one hour after its window time. Past that → no suggestion, operator picks manually. **No roll-forward** to a later window — decided deliberately.
- Safety proof for 60: the smallest inter-window gap is 10:30→12:30 = 120 min, so a 60-min grace can never overlap the next window. **Do not raise past 120.**

---

## 3. THE ROOT-CAUSE BUG — dispatch slots decided from a fake clock

**Symptom:** bills whose order email arrived 10:48–15:22 were sitting in the **10:30** batch on the floor, auto-assigned, nobody asked.

**Cause:** the manual SAP file has **no OBD time column** (`lib/sap-parser/types.ts:13`). The parser sets `obdEmailTime = null`; `mergeEmailDateTime` passes the bare date through; `orders.obdEmailDate` lands at exactly **00:00:00.000 UTC**, which renders as **05:30 IST**. `pickEffectiveClock` then takes it as the earlier same-day clock — a fake 05:30 beats every real time — and pins the bill to `R1_LOCAL_1030`.

**Evidence (live, 9,521 rows):**

```
source        midnight(no time)   real time   total
auto-import   0                   3876        3876
manual-sap    5517                128         5645
```

Auto-import has produced midnight **zero** times. The tell has **no false positives**. (The 128 manual-sap rows with a real time were repaired later by the correction pass — a false negative for "which path wrote this", harmless.)

**The engine was never wrong.** 818/818 auto-slotted orders matched a re-run of the real engine exactly. The input was wrong, not the rule.

### 3.1 The fix — `lib/dispatch/punch-clock.ts` (NEW, single owner)

- `hasClockTime(d)` — false when the value is **exactly 00:00:00.000 UTC**.
  ⚠ **Tests UTC midnight, NOT IST midnight.** Two live rows sit at 18:30 UTC (= 00:00 IST) and are *genuine* times produced by `mergeEmailDateTime("00:00")`. An IST-midnight test discards them.
- `resolveArrivalClocks(email, punch)` — symmetric ladder, the single decision point used by BOTH the import call site and `lib/floor/suggest.ts`:

| email | punch | result |
|---|---|---|
| real | real | pass both (dual-clock unchanged) |
| neither real | | decline |
| real | date-only | punch day **later** → decline; else email only |
| date-only | real | email day **later** → decline; else punch only |

**Why the decline branches exist:** dropping a time-less punch also drops the dual-clock's cross-day protection. A bill emailed 22 Jul, punched 25 Jul would have been anchored to 22 Jul — **scheduled into a date already past**. When we know the day but not the time, we decline rather than guess. Asserted in the audit: **zero rows move to an earlier target date.**

### 3.2 Step B — the self-heal completed

`handleAutoImportPatchHeaders` (the ~10-min auto-import correction pass) already repaired `orderDateTime`, `obdEmailDate`, `arrivalSlotId`, `slotId`/`originalSlotId`/`dispatchSlot`. It did **not** recompute `dispatchTargetDate`/`dispatchWindowId`/`dispatchSlotRuleId`. That single omission is why a manual-SAP bill kept its wrong slot forever.

Now folded into the **existing** `orders.update` (never a second write — the live-sync marker keys on `MAX(orders.updatedAt)`), inside the `!mailOwned` branch, resolved by `obdNumber` with **no `mo_orders` join**, so it reaches unmatched bills.

⚠ **It did NOT route through `applyMailOrderEnrichment`** — that keys on `soNumber` and skips unmatched bills, which is exactly the population Step B exists for. Coverage split: unmatched → this pass; mail-matched → enrichment at import confirm.

Guards: skips `dispatchSlotSource === 'manual'`; a decline leaves existing slot fields untouched (decline means "no opinion", not "erase"); batch-scoped, no full-table scan.

---

## 4. UI — the rail card [SHIPPED]

Three controls on ONE line, matching the existing rail rhythm.

- **With a suggestion:** teal split button `[ ✓ Today 18:00 ▾ ]` + `Hold` + `✕`. Body tap = release with that slot via the existing `POST /api/floor/release` (writes `dispatchSlotSource='manual'`). `▾` opens the **existing** `dispatch-slot-picker`, pre-highlighted on the suggested day + window.
- **Without:** unchanged `[ pick slot ] [ Hold ] [ ✕ ]` + a quiet grey **"Why no slot?"** link that reveals a neutral one-liner on tap. **No red/amber text** — deliberate.
- Teal is the only filled element on the row. Green stays "Done" status; never reused here.
- Picker gained two **additive** props: `suggested` (highlight only — must NOT flip the trigger to the committed/filled look; `value` still owns that) and `hideTrigger`. Every other call site omits both and is byte-identical.

**Design principle:** the suggestion is a **nudge, never a lock**. Nothing is written until the operator clicks. A completed tint bill is deliberately NOT given a window at completion — `hasPresetSlot` in both tint "done" routes would flip it to `dispatchStatus='dispatch'` and it would **leave the rail entirely**, robbing the operator of the confirm step.

---

## 5. Landmines found this session

- **`orders.obdEmailDate` is documented as "punch date+time" and is NOT one for 5,517 of 9,521 rows.** Anything reading it as a time must go through `hasClockTime()` first.
- **1,854 of 9,521 orders carry a date-only `orderDateTime`.** The rail suggestion reads it with no source guard, so every one of those was eligible to render a confident teal one-click button off a fake clock. This was the *live* half of the bug; the import half was smaller.
- **`import_raw_summary.obdEmailTime` is NOT the source of truth.** It records what the FILE contained, not what the order knows — already stale for 128 rows the correction pass repaired. Reading it would regress working rows.
- **`arrivalSlotId` has the IDENTICAL defect, still open.** `resolveArrivalSlotId` has no time guard, so every manual-SAP bill buckets to **Morning** regardless of true arrival. Same root cause, different field, different consumers. Documented at `CLAUDE_IMPORT.md:578`. **Not fixed — separate decision.**
- **`/api/floor/actions` change-slot never clears `dispatchSlotRuleId`.** 6 live rows carry an engine rule id next to a human-picked window — the id contradicts the row. Harmless today, misleading in any future audit.
- **Floor slot tabs group by `windowTime` ALONE, ignoring `dispatchTargetDate`** (`floor-board.tsx:97`). Bills due on different DATES stack under one tab, separated only by the age chip. Not the cause of this bug, but a real "wrong slot?" illusion generator.
- **The floor row displays `orderDateTime` while the slot was decided by `obdEmailDate`** — the operator sees two numbers that cannot be reconciled from anything on screen.
- **`auto-import` may overwrite a non-null `obdEmailDate` unguarded** (`header.ts:90-109`). Safe today because auto-import always carries a time; an auto-import batch that ever lost its time column would silently clobber 3,876 good timestamps.
- **PowerShell `Get-Content -Raw | Set-Content -Encoding utf8` corrupts non-ASCII** in the depot shell — mangled box-drawing chars in a scratch file mid-session.

---

## 6. Corrected canon

- **Auto-Import is LIVE, not paused.** `CLAUDE_IMPORT.md` carried five "PAUSED as of 2026-05-14" claims. Live evidence: **944 auto-import batches / 3,876 OBDs between 2026-06-20 and 2026-08-03.** Corrected in commit `4aad3622` with a warning not to restore the old wording without re-checking `import_batches`. **`CLAUDE_CORE.md §4` still carries the same stale claim — fix at consolidation.**
- `CLAUDE_FLOOR.md §8/§10` describe the rail suggestion as DEFERRED behind `RAIL_SUGGESTIONS_ENABLED = false`. **Both are now stale** — the flag is on, the staleness bug is fixed at source, and the UI is built.

---

## 7. Open decisions — NOT actioned

1. **Backfill.** 73 auto rows sit in a window the corrected rule would change (63 window-only, 8 date-moved, 2 now declining); separately 85 unmatched bills have **no slot at all**. Step B is forward-only — it fires only when auto-import actually changes a clock, so neither set drains on its own. Any backfill must skip `dispatchSlotSource='manual'` and think hard about the 8 date moves (moving bills across days, not just windows).
2. **`arrivalSlotId` Morning defect** — same root cause, unfixed.
3. **Stale `dispatchSlotRuleId`** on manual change-slot — one-line fix.
4. **Auto-confirm** for HIGH-confidence suggestions — deliberately deferred until v1 has been used.
5. **Tint split-OBD** suggestions — out of v1 scope.
6. **`card.tint.completedAt` is an ISO UTC string** — convert to IST at render time when something finally reads it.

---

## 8. Manual verification still pending

Claude Code has no login and the import path is HMAC-gated, so **none of the following is verified**:

- **a.** Upload a manual SAP file for a bill with **no matching mail order** → it lands on the rail with no slot → after one auto-import cycle it appears on the FLOOR with the correct window, **no click**.
- **b.** Release such a bill by hand during that gap → the human slot **survives** the repair.
- **c.** Import log shows `[patch-headers][dispatch-engine] Re-slotted obdNumber=… old → new`.
- **d.** Watch a board through a cycle → **no spurious "changed" flash** (the single-`orders.update` rule is what protects this).
- **e.** Morning rail (10–11am) → teal buttons on fresh bills; a Local bill imported near a cutoff still shows its suggestion under the 60-min grace.

---

## 9. Scratch files left in place (untracked, `tsc`-excluded)

`scripts/_slot-audit.ts` (the full audit, re-runnable), `_punch-clock-proof.ts`, `_time-tell.ts`, `_dt-divergence.ts`, `_patch-headers-dryrun.ts`, `_floor-suggest-check.ts`.
