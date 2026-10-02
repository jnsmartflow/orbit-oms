# Code discovery — Bulk Tinter Issue on the TI tab ("quick shades")

**Date:** 2026-10-02 · **Status:** DIAGNOSIS ONLY, no code written · **Owner idea:** on the Tint
Manager's TI tab, select one or more "Base — No Tint" bills → the bottom bar offers Chandresh's
most-used shades → one click writes that TI on every owed line of every selected bill, same
sampling number → the bills leave the TI tab. "+ New shade" falls back to today's per-line panel.

**Files read:** CLAUDE.md, docs/CLAUDE_CORE.md (§3), docs/CLAUDE_UI.md (header), docs/CLAUDE_TINT.md
(v2.2 — §1.12, §3.12, §9.10, §14), docs/CLAUDE_SAMPLING_LIBRARY.md (v1.7 — §2, §5, §6, §8, §9, §11).
Code: `components/tint/manager/base-ti-panel.tsx`, `board-ti-tab.tsx`, `board-bottom-bar.tsx`,
`components/tint/tint-manager-content.tsx`, `app/api/tint/manager/base-pending/route.ts`,
`app/api/tint/operator/tinter-issue/route.ts`, `tinter-issue-b/route.ts`,
`app/api/tint/operator/_lib/sampling-resolution.ts`, `_lib/usage-log-writer.ts`,
`lib/tint/sync-challan-formulas.ts`, `lib/tint/base-operator.ts`, `lib/sampling/pack-litres.ts`,
`app/api/tint/manager/marker/route.ts`, `app/api/tint/manager/shop-delivery/route.ts`.

**Live numbers:** read-only SELECTs against production, 2026-10-02 (scratch script in the session
scratchpad, deleted). Placeholder worker = `users.id 54` "Base / No Tint" (`isActive=false`).

> ⚠ **Name clash.** The *Base tab* of commits `aaa229cf`…`d788a2d1` (`lib/tint/base-feed.ts`,
> `BASE_BILL_WHERE` = non-tint SMU 74/77 bills on Floor's board) is a DIFFERENT thing from the
> *"Base — No Tint" bypass* this document is about (tint bills closed without an operator, owing
> TI on the **TI tab**). Nothing below touches `base-feed.ts`.

---

## A. History — what has been written on "Base — No Tint" bills

**Bypasses:** 44 placeholder-owned assignments, 2026-09-07 → 2026-10-01 (all inside the last 30 days).

**TI written on placeholder assignments — one person, one table:**

| Table | Submitted by | Rows | Bills | First | Last |
|---|---|---|---|---|---|
| `tinter_issue_entries` (TINTER) | Chandresh Kolgha (id 21) | **49** | 32 | 2026-09-07 | 2026-09-29 |
| `tinter_issue_entries_b` (ACOTONE) | — | **0** | — | — | — |

Prakash (id 32) has **never** written a TI row anywhere.

**Shades used on placeholder TI (all TINTER):**

| samplingNo | shadeName | rows | bills | pack(s) | pigment | distinct formulas |
|---|---|---|---|---|---|---|
| 26-0318 | SP SHADE | 10 | 10 | 20L | WHT 20 | 1 |
| 26-0306 | sp shade | 10 | 8 | 20L, 18.5L | WHT 20 | 1 |
| 26-0316 | SP SHADE | 8 | 6 | 10L | WHT 20 | 1 |
| 26-0307 | sp shade | 6 | 5 | 4L | WHT 20 | 1 |
| 26-0319 | SP SHADE | 4 | 4 | 20L | WHT 25 | 1 |
| 26-0106 | SP SHADE | 4 | 4 | 3.7L, 4L | WHT 25 | 1 |
| 26-0346 | SP SHADE | 3 | 1 | 1L | WHT 25 | 1 |
| 26-0315 | SP SHADE | 3 | 3 | 20L | WHT 5 | 1 |
| 26-0478 | 03bb 17/015 | 1 | 1 | 3.7L | LFY 54 · WHT 261 · MAG 14 · BLK 497 | 1 |

**Are the values identical across rows? YES — within every sampling number, every row carries the
exact same 13 values, across every SKU and every pack.** 48 of 49 rows are a *white shot only*
(WHT, all 12 other pigments 0). The one outlier (26-0478) is a real colour by Chandrasing reused once.

🔴 **The single most important finding — the white shot is a FIXED dose, NOT pack-scaled.**
26-0106's 33 recipe variants hold **WHT 25 on every pack from 0.925 L to 20 L**; 26-0307 (4 L),
26-0316 (10 L) and 26-0318 (20 L) all hold **WHT 20**. Under the library's linear dose-litres model
(`lib/sampling/pack-litres.ts:55-69`) a 4 L WHT 25 used on a 20 L line would become WHT 125. The
depot does not do that for white shots. A bulk save that "scales like today" would write wrong numbers.

**How the shades are chosen.** The dose (5 / 20 / 25) tracks the **site**, not the base or product:
Nilkanth Eminance → WHT 20 (26-0318 / 0316 / 0307 by pack), 25 on 1 L / 3.7 L; Pratisha Society →
26-0319 (25); Capital Green / Vastu Discovery / Sun Shantam → 26-0315 (5). The same number is put on
90, 92 and 93 bases and on unrelated products (Protect, Max, Velvet Touch, Satin, Gloss) alike.
Chandresh mostly keeps **one sampling number per pack bucket** (0307 = 4 L, 0316 = 10 L, 0318 = 20 L);
26-0306 and 26-0318 are literally the same recipe (WHT 20, 20 L) under two numbers.

**Context — Chandresh's TI on normal (non-placeholder) assignments:** 174 own-job TINTER rows
2026-05-16 → 2026-09-05, + 2 ACOTONE, + 2 on another operator's job. He was assigning white-shot
bills to himself as an "operator" until the bypass shipped; from the week of 2026-09-07 every one of
his TIs is on the placeholder (weekly: Aug 7/7/18/15/6 own-job → Sep 21/5/16/7 placeholder).
Since June, **191 of his 209 TINTER rows are SP SHADE numbers**. Operators Chandrasing (569) and
Deepak (527) used SP numbers 3 and 1 times — this is Chandresh's shade, not the depot's.

## B. Lines — what a bill owes today

**Open base-pending right now: 12 bills, 17 owed lines** (reproduces `base-pending/route.ts:108-203`
in SQL: placeholder + `tinting_done` + not removed; `isTinting`, `lineStatus='active'`; coverage keyed
on `tintAssignmentId`). Every open bill owes ALL its lines (none partially done).

| Lines per bill | Bills |
|---|---|
| 1 | 7 |
| 2 | 4 |
| 3 | 1 |

Owed lines by per-tin pack: **20 L × 15, 18.5 L × 1, 1 L × 1.** 13 distinct SKUs — Protect DP 90/92/93,
Max 92/93, Projekt 1092/1094, SuperCover 90, UltraClean White, VT PG 4090 (1 L and 20 L), VT Diamond
7090, Gloss 93. One bill (9109827157) mixes **1 L and 20 L**.

**All 44 bypasses ever:** 66 tinting lines, avg 1.5 / bill, max 10; 31 single-line bills; **8 of 44
bills (18 %) carry more than one pack size.** Per-tin litres over those 66 lines: 20 L × 41, 4 L × 8,
10 L × 8, 1 L × 4, 3.7 L × 3, 18.5 L × 2 — every one maps to a `PackCode` (no null pack).

**Is "same shade on every line" realistic?** Yes for the pigment *values* — base type and product
never changed his choice. Partly for the *sampling number* — on a mixed-pack bill he has used a
different number per pack bucket even though the values were identical. A one-click bulk must
therefore decide per line *which pack variant* it writes (§C, §H-1).

## C. Pack scaling — what today's save does, and what a bulk save must do

**Scaling is entirely CLIENT-side.** The server stores whatever pigments the body carries.

- `base-ti-panel.tsx:211-227` `applyRow` — if the picked card is TINTER and
  `canScale(card.packCode, linePack)`, pigments = `scalePigments(card.pigments, card.packCode, linePack)`
  (3 dp, ratio of dose litres, `pack-litres.ts:55-69`); otherwise the card's raw values. ACOTONE is
  never scaled (the gate is the card's own `tinterType`, `:213`). A same-bucket card scales by 1.0.
- `canScale` (`pack-litres.ts:46-51`) only needs both packs to have a dose-litre — it does **not**
  require a different bucket, and an unknown/null pack silently falls back to the RAW values.
- The pigment grid stays editable in `confirm` mode (`:459-499`), so the manager can overwrite a
  scaled value before saving. (Live data says the white-shot rows were saved unscaled — either
  same-bucket picks or hand-corrected; the code cannot tell which.)

**Server side** (`sampling-resolution.ts:57-126`), keyed on `(samplingNo, skuCode, packCode)`:
- variant exists → **Scenario 3**: recipe immutable, TI row stores the BODY's pigments (no check that
  they equal the recipe), and — ⚠ — **renames the parent** if the body's `shadeName` differs
  (`:94-100`). "sp shade" vs "SP SHADE" would rename it.
- variant missing → **Scenario 2**: `sampling_recipes.create` with the body's pigments under the same
  number (`:110-119`). Note it keys on **SKU** too: a new SKU at the same pack is a "new variant" —
  that is how 26-0106 reached 33 variants.

**What a bulk save must do per line to stay identical to a hand save:** server-side, never trusting a
client-sent formula —
1. derive the line's `PackCode` from `volumeLine / unitQty` (the logic is today duplicated in
   `base-ti-panel.tsx:70-86` and `tint-operator-content.tsx:306-350` — must be MOVED to one lib, not
   copied a third time);
2. find the source recipe under the chosen samplingNo: exact `(sku, pack)` → else any same-dose-bucket
   variant → else (different bucket) **owner decision §H-1**: refuse, copy unscaled, or scale;
3. send `samplingNo` + the **parent's own `shadeName`** (so Scenario 3 never renames) + those pigments
   + `tinQty = line.unitQty` (the panel's default, `:120`) + `rawLineItemId`;
4. pick the table by the **sampling's** `tinterType` (`sampling_register.tinterType`), not a toggle.

## D. Exact writes of ONE TI save today, and its gates

**Gates — `tinter-issue/route.ts` (TINTER) and `tinter-issue-b/route.ts` (ACOTONE), identical:**
1. session (`:30-33`);
2. `tint_operator` canEdit → operator arm; else `tint_manager` canEdit → **manager-only arm**
   (`:41-46`);
3. manager-only: no splits, placeholder must exist, assignment must be `assignedToId = placeholder`
   AND `status = tinting_done` (`:103-112`);
   operator arm: `assignedToId in [userId, placeholderId]`, or anything if the FACE branch
   (`canSeeAllOperatorRows`, role `operations`/`admin`) (`:147-155`);
4. body: every entry needs `baseSku`, a valid `packCode`, and a samplingNo or shadeName (`:76-92`).

**Writes, sequential, no `$transaction`:**

| # | Write | Where |
|---|---|---|
| 1 | Scenario 1 only: `sampling_register.create` + `sampling_recipes.create` (new number via `next_sampling_no`, P2002 retry ×3) | `sampling-resolution.ts:140-198` |
| 1′ | Scenario 2 only: `sampling_recipes.create` (new pack/SKU variant) | `:110-119` |
| 1″ | Scenario 3 only, name differs: `sampling_register.update { shadeName }` | `:94-100` |
| 2 | `tinter_issue_entries.create` / `tinter_issue_entries_b.create` — one row per entry | `route.ts:219-233` / `-b :206` |
| 3 | `tint_assignments.update { tiSubmitted: true }` (moves `updatedAt`) | `:250-253` |
| 4 | **TINTER route only:** `syncChallanFormulasFromTi(orderId)` → `delivery_challan_formulas.upsert` per line (try/catch, never fails the save) | `:259-266`, `sync-challan-formulas.ts:147` |

**Not written:** `sampling_usage_log`, `sampling_recipes.usageCount/lastUsedAt` (only Mark Done's
`writeUsageLogsForAssignment`, `done/route.ts:265`), `orders`, `tint_logs`, `order_status_logs`.

⚠ **Two gaps found on the way (not in canon):**
- **The ACOTONE route never syncs the challan** — `syncChallanFormulasFromTi` has exactly one caller,
  `tinter-issue/route.ts:260`. TINT §9.10 says sync runs "on every TI submit" and reads both tables;
  it reads both, but an ACOTONE-only bill's formula never auto-fills until some TINTER save on the same
  order happens. Zero ACOTONE placeholder rows so far, so it has not bitten here.
- **No duplicate-line guard.** Neither route checks whether `(tintAssignmentId, rawLineItemId)` already
  has a TI row; there is no unique index either. A re-save appends a second row (challan takes the
  latest). Live: 0 duplicated lines on placeholder assignments today.

**Does the LAST owed line drop the bill from base-pending? Yes.** `base-pending/route.ts:197-203` keeps
an assignment only while some active tinting line lacks a TI row on THAT assignment; the save writes
the row, the next GET omits the bill. The page re-reads from the server and closes the drill
(`tint-manager-content.tsx:709-724`, "Tinter Issue complete — bill closed"). No stage, slot or status
changes — the bill already left the tint rail at bypass time.

## E. The usage-log gap and "most used"

Confirmed live: for the eight SP numbers, `sampling_usage_log` has **4 rows since 2026-09-07** in total
(all from operators' Mark Done) against **48 placeholder TI rows** by Chandresh. 26-0306's
`lastUsedAt` is stuck at 2026-09-05 although he used it 10 times after. So:

- **A usage-log ranking would be wrong today** — it reflects his pre-bypass self-assigned jobs (Aug)
  and goes stale from 2026-09-07. 26-0106 (44 log rows, last 2026-08-25) would top it; it has been
  used 4 times in the last 30 days.
- **TI rows are the truth** — every save writes one, both tables, with `submittedById`, `samplingNo`,
  `packCode` and `createdAt`.

**Recommendation:** build the quick-shade list from `tinter_issue_entries` ∪ `tinter_issue_entries_b`,
not the usage log. Whether the bulk route should ALSO close the usage-log gap is a separate owner
question (§H-5): `writeUsageLogsForAssignment` writes for *every* TI row on an assignment and is not
idempotent, so it could only be called once — at the moment a bill becomes fully covered.

## F. Where the quick-shade list comes from

**Option 1 — automatic top-N over the last 30 days.**
- *Per user* (`submittedById = me`) — recommended: the SP numbers are Chandresh's habit (191/209),
  operators barely touch them, and a depot-wide list is polluted by real colours.
- *Depot-wide* — what it would show today: 26-0306 (12), 26-0318 (11), **SPL8004 with no sampling
  number (10)**, 26-0316 (9), SPL BLACK 26-0175 (7), 26-0307 (6), 30YY 22/059 (5), 26-0315 (5).
  Real tints mixed in → not usable as a white-shot menu.

**What Option 1, per user, returns for Chandresh TODAY** (TI rows, last 30 days):

| # | Chip would read | samplingNo | pack | dose | uses | last |
|---|---|---|---|---|---|---|
| 1 | sp shade | 26-0306 | 20 L (+18.5 L) | WHT 20 | 12 | 09-24 |
| 2 | SP SHADE | 26-0318 | 20 L | WHT 20 | 10 | 09-28 |
| 3 | SP SHADE | 26-0316 | 10 L | WHT 20 | 9 | 09-24 |
| 4 | sp shade | 26-0307 | 4 L | WHT 20 | 6 | 09-24 |
| 5 | SP SHADE | 26-0106 | 3.7 / 4 L | WHT 25 | 4 | 09-28 |
| 6 | SP SHADE | 26-0319 | 20 L | WHT 25 | 4 | 09-28 |
| 7 | SP SHADE | 26-0346 | 1 L | WHT 25 | 3 | 09-12 |
| 8 | SP SHADE | 26-0315 | 20 L | WHT 5 | 3 | 09-29 |

Note: **seven of eight chips say "SP SHADE"** — a chip must show **number + pack + dose** or it is
unreadable. And for the 20 L lines owed today there are FOUR different answers (0306/0318 = 20,
0319 = 25, 0315 = 5); the right one depends on the site (§A), which the chip list cannot know.

**Option 2 — pinned list** (manager pins 3–5 numbers; stored per user). Stable, no surprises, but
needs a store: new table or an `app_settings`-style row → a schema change (Smart Flow) + a small
pin/unpin UI.

**Recommendation:** Option 1, per user, 30 days, top 6, grouped by samplingNo, with the pack bucket(s)
and active pigments on the chip — no schema change. Revisit pinning only if the order jumps around.
A tempting refinement — rank by "used at THIS bill's site" first — only works for single-site
selections; keep it out of v1.

## G. Build plan (not started)

**Step 0 — extract, don't copy (pure refactor, behaviour byte-identical).**
New `lib/tint/ti-save.ts` holding what is now inline in BOTH routes: the per-entry loop
(`resolveSamplingForEntry` → `tinter_issue_entries[_b].create`), `tiSubmitted`, and the challan sync —
called with an already-gated `{ orderId, tintAssignmentId | splitId, tinterType, userId, entries }`.
Gates stay in the routes. `tinter-issue/route.ts` and `tinter-issue-b/route.ts` become thin callers.
Decide in this step whether the ACOTONE path starts calling the challan sync (§H-6) — that is the
only intended behaviour change, and only if the owner says yes.
Also move `PACK_CODES` + `derivePackCode` into `lib/sampling/pack-code.ts` and import it from
`base-ti-panel.tsx` and `tint-operator-content.tsx` (today two copies).

**Step 1 — quick-shade read.** `GET /api/tint/manager/ti-quick-shades` — `tint_manager` canView;
TI rows ∪ both tables, `submittedById = me`, 30 days, group by samplingNo, join `sampling_register`
(`isActive = true` only) + its variants' packs; returns `{ samplingNo, shadeName, tinterType, packs[],
activePigments[], uses, lastAt }[]` top 6. Read-only, `force-dynamic`.

**Step 2 — bulk write.** `POST /api/tint/manager/ti-bulk` `{ tintAssignmentIds: number[], samplingNo }`.
Gate exactly the manager-only arm: `tint_manager` canEdit (+ optional key, §H-4); every assignment
must be placeholder-owned + `tinting_done` + order not removed. Per bill, sequential; per owed line,
sequential; each line calls the Step 0 function with ONE entry (one function, never a copy):

| Case | Outcome |
|---|---|
| samplingNo unknown / inactive | whole request 400 |
| assignment not a bypass / removed / not `tinting_done` | `failed` (bill) |
| line already has a TI row on this assignment | `skipped` "already recorded" |
| line pack cannot be derived | `failed` (line) |
| exact (sku, pack) variant exists | write with its stored pigments (Scenario 3) |
| same dose bucket, new SKU | write with that bucket's pigments unscaled (Scenario 2, new variant) |
| different dose bucket | **§H-1** — default: `skipped` "no {N} L variant of {samplingNo} — use + New shade" |
| sampling is ACOTONE, line needs a different bucket | `skipped` — ACOTONE is never scaled |

There is no "ACOTONE on a TINTER line" refusal to build: a line carries no tinter type; the
*sampling's* type picks the table. Body `shadeName` = the register's own, so Scenario 3 never renames.
Response: Floor's / Shop-delivery's contract (`shop-delivery/route.ts:18-125`):
`{ done: [{ orderId, lines }], failed: [{ orderId, rawLineItemId?, error }], skipped: [{ orderId,
rawLineItemId?, reason }], closed: orderId[] }`, **422 when nothing landed and something failed**.
A bill leaves the TI tab only when ALL its lines are covered — a skipped line keeps it there with
"TI 1/2". Double-click guard: client busy flag + the per-line "already recorded" check (no DB unique;
adding one is a schema change — not proposed).

**Step 3 — TI tab selection + bar mode.** `board-ti-tab.tsx`: a checkbox column on the list (the
drill view stays single-bill). `tint-manager-content.tsx`: a 4th `tiSel: Set<number>` (assignment ids),
disjoint from `railSel` / `selection` / `holdSel` like the other three (`:380-428`), `barMode = "ti"`.
`board-bottom-bar.tsx`: `BarMode` gains `"ti"` → the bar shows the chips (Step 1) as the primary
area + "+ New shade" (opens the drill on the first selected bill — today's per-line panel, unchanged)
and NO slot / hold / cancel items. Click a chip → confirm line ("Write SP SHADE · 26-0318 · WHT 20 on
5 lines of 3 bills?") → POST → toast done/skipped/failed → `fetchBasePending()`.

**Step 4 — marker: nothing to build.** `marker/route.ts:203-212` already folds in
`MAX(createdAt)` of placeholder TI rows from both tables, and the `tiSubmitted` write moves
`tint_assignments.updatedAt` (same `GREATEST`, `:214-223`). A bulk save moves the marker exactly as a single save does.

**Step 5 — canon.** TINT §1.12 (bulk path, chips), §14 (ACOTONE challan-sync gap, no duplicate
guard), SAMPLING_LIBRARY §1/§9 (third TI consumer), CORE §5 only if a new tick key is added.

**Files per step:** 0 → `lib/tint/ti-save.ts` (new), `lib/sampling/pack-code.ts` (new), both
`tinter-issue*` routes, `base-ti-panel.tsx`, `tint-operator-content.tsx` · 1 → new route ·
2 → new route · 3 → `board-ti-tab.tsx`, `board-bottom-bar.tsx`, `tint-manager-content.tsx`,
`components/tint/manager/types.ts` · 4 → none · 5 → docs. New tick (if chosen): `lib/permissions.ts`
(the `PageKey` union `:234-283` + the key lists `:429-436`, `:522-524`, `:679-685`),
`tint-manager-access-provider.tsx`, and `user_page_access` rows via Smart Flow.

## H. Owner decisions needed

1. **White shot on a different pack size — what should happen?** Your SP shades put the same WHT 20
   (or 25) on a 4 L and a 20 L tin. The system's normal rule would multiply it (4 L → 20 L = ×5). For
   these quick shades: (a) refuse that line and let you pick it by hand (safest — recommended for v1),
   (b) copy the numbers unchanged (matches what you actually do), or (c) scale like a real colour?
2. **Which shades appear in the bar** — automatic "my top 6 in the last 30 days" (recommended, nothing
   to maintain), or a list you pin yourself?
3. **Duplicate numbers.** 26-0306 and 26-0318 are the identical recipe (WHT 20, 20 L). Keep both as
   chips, or settle on one and stop using the other?
4. **Who may use it** — anyone who can already save TI on these bills (Tint Manager edit — recommended,
   it writes nothing a single save can't), or a separate tick so it can be given to one person only?
5. **Usage history.** Bills closed this way never show in the Sampling Library's usage history or
   "this site" suggestions (same as today's one-line save). Fix that as part of this job (write the
   usage when a bill's last line is saved), or leave it for later?
6. **ACOTONE challans.** Saving an ACOTONE TI never fills the challan's Formula column today. Fix it
   while we are in these routes?
7. **Mixed bills.** If one selected bill has a 1 L line and a 20 L line and the chip only has a 20 L
   variant, is "do the 20 L line, leave the 1 L line on the TI tab" the right behaviour?

---

## I. Owner decisions (2026-10-02)

These close §H 1–7 and replace §F/§G step 1 (there is no quick-shade read).

1. **Three buttons ONLY: WHT 5 · WHT 20 · WHT 25.** A white shot is TINTER: WHT = the dose and every
   other pigment 0. Each dose has a **fixed sampling number for every tin size**: WHT 5 → `26-0315`,
   WHT 20 → `26-0318`, WHT 25 → `26-0319`. These are defined once, in `lib/tint/white-shots.ts`
   `WHITE_SHOTS`, the only place the numbers live. No "last used", no history ranking, no quick-shade
   read route.
2. **FIXED DOSE, NEVER SCALED.** Every line gets the same WHT value whatever its pack.
   - If the sampling has no variant for the line's (sku, pack), the save creates that variant under the
     SAME number (Scenario 2), with the same unscaled values.
   - Safety: before writing, the server verifies that the sampling exists, is active, is TINTER, and
     that its recipe is WHT-only with WHT = the dose. Otherwise the whole request gets a 400; a
     different formula is never written.
3. **Own tick `tint_ti_bulk`** (canEdit-only, label "Tint Manager · Bulk TI", section Tinting),
   registered at every §B site.
   - Gate = `tint_manager` canEdit AND `tint_ti_bulk` canEdit.
   - Plus the existing manager-only TI arm rules: placeholder-owned assignment, `tinting_done`, order
     not removed, no splits.
4. **Never a second TI on a line.** A line that already has a TI row on that assignment is skipped as
   "already recorded".
5. **Usage history.** When a bill's LAST owed line is covered, by the bulk save OR the existing single
   save, its `sampling_usage_log` is written once. It is idempotent, guarded so it can never write
   twice. `siteId = orders.customerId` (TINT §14).
6. **ACOTONE challan gap closed.** The ACOTONE save path also runs `syncChallanFormulasFromTi`; both
   paths go through the shared save function.
7. **Mixed bills:** write what fits. A refused or skipped line keeps the bill on the TI tab ("TI 1/2").

**Added by the owner while answering the mockup question (2026-10-02):**
- **TI tab table = the Tint / Base table columns:**
  - OBD with Floor's date line (`components/floor/bill-ref-cells.tsx`);
  - Invoice (the same shared cell, blank when none);
  - SMU · Bill to · Ship to (ORIGINAL → REDIRECT) · Route · Vol · Art.;
  - then Lines (packs owed) · TI (x/y) · ⋯ (Enter TI / Undo).
  - `/api/tint/manager/base-pending` gains the select those cells need (read-only).
  - Row click selects.
- **Undo Base unchanged** (same route, same refusals, the bill returns to the Needs-assignment rail).
  It is offered in the row ⋯ menu AND in the bottom bar when TI rows are selected ("↶ Undo Base"). It
  runs per bill, sequentially, and the toast lists any refused bill with the server's reason.
