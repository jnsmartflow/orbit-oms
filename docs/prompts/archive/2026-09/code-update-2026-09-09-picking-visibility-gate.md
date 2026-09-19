# code-update-2026-09-09-picking-visibility-gate

**Classification:** `code-update-*` — **SHIPPED.** Merge as current reality.
**Supersedes:** `docs/prompts/drafts/web-update-2026-09-09-picking-visibility-gate.md` (the design record — archive it, do not merge it separately; everything it decided is restated here as built).

**Commits, all on `main` and pushed, confirmed by `git log` at each step:**

| # | Commit | What |
|---|---|---|
| 1 | `5fce9f31` | Split the `openPending` waiting branch from the in-progress branches. No behaviour change. |
| 2 | `16eff3d5` | Mirror the new columns + `app_settings` into `schema.prisma`. |
| 3 | `7e89e8fb` | Read path — gate term in the predicate, held-back count on the marker, hook updated. |
| 4 | `fdc03beb` | Write path — `/api/floor/pick-visible` + `/api/floor/pick-gate`. |
| 5 | `9a3671ec` | Floor UI — toggle, held-back pill, Show strip. |
| 6 | `963665af` | Supervisor band + send-back-to-desk; one shared count predicate. |
| 7 | *(copy)* | Band wording shortened to "N more with the planner". |

**Target canonical files:** `CLAUDE_PICKING.md` (predicate, band, badge), `CLAUDE_FLOOR.md` (toggle, strip, routes), `CLAUDE_CORE.md` (schema + version bump + §13 note), `CLAUDE_UI.md` (pill state, band, strip), `ROADMAP.md` (three deferred items, §9).

**Hand-verified on the live screens 2026-09-09** by Smart Flow — everything below except the one case named in §8.

---

## 1. What it is

The desk operator on `/floor` can hold waiting bills back from the supervisor's Assign tab and release them in batches. 100 bills at the desk, 20 on his board, refill as they clear.

**The switch is OFF by default and OFF is a true no-op.** Absent `app_settings` row = off. Verified on the live screen: with the gate off, `/floor` and `/picking` render exactly as before — no strip, no new pill state, no band, no table column added.

Owner framing, in Smart Flow's words: *"instead of 100 bill pending on supervisor for assign he see only 20, the one which is needed; once those assigned and checked he assign other pending."*

---

## 2. 🔒 THE LOCKED RULE — only WAITING bills can ever be held back

**Owner ruling, 2026-09-09:** *"floor user can't even hide the bill with picker or picked bills."* Not a default, not a v1 limit. A hard rule, and the reason the feature is safe.

Enforced in **three independent places**. Any one alone is a rule a later change can undo by accident:

| # | Layer | Where |
|---|---|---|
| 1 | UI | The Show control renders only for `pending_picking` rows; the tick is disabled otherwise. |
| 2 | Predicate | The `[PICK_ASSIGNED, PICK_DONE]` branch and the `pick_checked` branch are fetched **unconditionally**, in every state of the switch (§3). |
| 3 | **Server** | `app/api/floor/pick-visible/route.ts:133` — `if (order.workflowStage !== SUPPORT_DONE_OUTPUT)` → `failed[]`. Runs **before** the skip test and before the update, in **both** directions. |

🔴 **Layer 3 is the copy that outlives the other two.** Layers 1 and 2 are a button and a query — both are things a later session edits. If a future prompt calls the server check redundant, it is not.

It is also what makes **send-back safe**: if the supervisor assigned the bill a second earlier it is `pick_assigned`, and the pull-back is refused ("a picker already has it") rather than yanking work out of a picker's hands.

---

## 3. 🔴 The predicate split — the architectural change

**`PICKING_OPEN_STAGES` was one `in` clause holding `[pending_picking, pick_assigned, pick_done]`.** A gate term added there would have suppressed all three — a bill in a picker's hands vanishing from the board mid-pick. That was one line away and is the reason commit 1 exists.

`buildPickingWhere()`'s `openPending` scope now carries the waiting stage in its **own** branch:

```
{ workflowStage: SUPPORT_DONE_OUTPUT, <gate term when ON> }
{ workflowStage: { in: [PICK_ASSIGNED, PICK_DONE] } }     // never gated
{ workflowStage: PICK_CHECKED, pickAssignment: {...} }    // never gated
```

Verified identical before and after the split: 155 rows in, 155 out, every stage matching.

**The `single` scope was NOT touched** — caller-less but a public API contract (`PICKING §4`).

### 3.1 `gateOn` is a PARAMETER, not a read

`buildPickingWhere()` is **synchronous**; the settings read is async. So the switch state is read by the caller and passed in:

```
buildPickingWhere({ scope, date, pickerId, gateOn })   // gateOn defaults to FALSE
```

🔴 **There are exactly TWO live callers and BOTH must pass it:**

| Caller | Line |
|---|---|
| `lib/picking/queue.ts` (in `getPickingQueue`) | 501, 505 |
| `app/api/picking/marker/route.ts` | 113, 115 |

If only one passes it, the marker and the queue watch different sets — `PICKING §10`: *"Marker ⊇ queue, never ⊂."* A gated queue with an ungated marker means the supervisor's board never refreshes when a bill is released: he sits on an empty screen while the desk wonders why nothing moves.

The six bench/profile scripts pass nothing and correctly get `false`. **`getPickingQueue` overrides any caller-supplied `gateOn`**, so the switch cannot be forced per request.

⚠ **`buildPickingWhere` is NOT pure** (found during diagnosis, pre-existing): with no `date` it reads the clock twice — `resolveTargetDate → getISTTodayDate()` (`queue.ts:59`) and `getISTDayRange()` (`lib/dates.ts:30`). Same inputs, different day, different answer. Do not memoise it.

---

## 4. Schema

⚠ Applied by hand in the Supabase SQL Editor, then hand-mirrored into `schema.prisma` (`prisma db pull` fails here — CORE §3). **Bump the schema version on merge; read the current number from the CORE header, do not recite one.**

```
orders     pickVisibleAt    TIMESTAMPTZ NULL   -- NULL = not yet handed over
           pickVisibleById  INTEGER NULL       -- FK orders_pickVisibleById_fkey → users(id)
                                               -- Prisma relation: OrderPickVisibleBy

app_settings   id           SERIAL PK
               settingKey   TEXT NOT NULL, UNIQUE app_settings_settingKey_key
               isEnabled    BOOLEAN NOT NULL DEFAULT false
               updatedById  INTEGER NULL  -- FK → users(id), relation AppSettingsUpdatedBy
               updatedAt    TIMESTAMPTZ NOT NULL DEFAULT now()
```

- **No ON DELETE clause on either FK** — users are deactivated in this app, never deleted.
- **`app_settings` ships EMPTY on purpose.** Absent row = switch OFF. Key: `picking.visibilityGate`, exported as a constant from `lib/picking/visibility-gate.ts` — never inline the string.
- **`updatedAt` carries `@default(now()) @updatedAt`**, deliberately more than a bare mirror: without `@updatedAt` the stamp fires on insert only and goes stale — the `push_subscriptions` / `sku_master_v2` trap (CORE §13). Neither directive changes the database.
- **No index.** 71-81 live waiting bills and the query narrows by stage first. Deliberate; revisit only on a measurement.
- **Column shape deliberately mirrors `pickEarlyReleasedAt` / `pickEarlyReleasedById`** — same table, same board, nearly the same meaning.

---

## 5. New surfaces

### `lib/picking/visibility-gate.ts`

| Export | Contract |
|---|---|
| the settings key constant | the only place the string exists |
| `isPickGateOn(): Promise<boolean>` | 🔴 **absent row, null, or ANY read failure resolves to FALSE.** The safe direction is always "show the supervisor his work". |
| `countHeldBackWaiting(boardWhere, gateOn)` | returns **0 without a query** when the gate is off |

⚠ **`countHeldBackWaiting` takes the UNGATED `boardWhere`.** Passing a gated predicate returns 0 — the safe wrong answer (the band vanishes rather than overstating), which is exactly why it is easy to break unnoticed. Both callers rebuild it ungated: `queue.ts:1007` and `marker/route.ts:164`.

⚠ **`app/api/picking/queue/route.ts` is UNCHANGED and does not call it.** The payload is assembled by `getPickingQueue`, so that is where the field is filled and the route gets it transitively. A call in the route would mean a second predicate build outside the function that owns the payload. **Do not "fix" this by adding one.**

### `POST /api/floor/pick-visible`

Gate: `floor` canEdit. `export const dynamic = 'force-dynamic'`.

```
Body:     { orderIds: number[], visible?: boolean }   // visible defaults TRUE
Response: { changed: number[], skipped: number[], failed: {orderId,error}[] }
Status:   400 empty/invalid input, BEFORE the loop
          422 changed AND skipped both empty, failed not
          200 otherwise
```

- `visible: true` → stamp `pickVisibleAt = now()` + `pickVisibleById` from the **session**, never the body.
- `visible: false` → clear **both** to null. A leftover `pickVisibleById` would claim someone released a bill sitting at the desk.
- A non-boolean `visible`, when present, is a **400** — coercing `"false"` or `0` would turn the gate the wrong way for a caller asking for the opposite.
- **Skip mirrors direction:** `visible ? pickVisibleAt !== null : pickVisibleAt === null` → `skipped[]`, **no write**. ⚠ Re-stamping would bump `updatedAt` and fire a false "changed" on every board (FLOOR §4 / PICKING §10). Re-showing an already-shown bill is a normal bulk-selection accident, not an error.
- ⚠ **The bucket is named `changed`, not `shown`** — it carries both directions. Renamed at build time precisely to avoid the stale-name trap.

🔴 **NO `order_status_logs` ROW, deliberately.** `pickVisibleAt`/`pickVisibleById` already carry who and when on the order itself; unlike hide or early-release this is a routine high-frequency action, so a log row per bill would be duplicate data at 100+ rows a day. A second write is also the exact extra-write the marker landmine warns about. A comment at `pick-visible/route.ts:36` records this.

### `GET` + `POST /api/floor/pick-gate`

Both on `floor` canEdit, which is admin + operations — **`floor_supervisor` cannot flip the switch applied to him**. `GET` reads through `isPickGateOn()`, not a second query, so the toggle and the board cannot disagree. `POST` upserts on the unique constraint.

🔴 **THE SWITCH AND THE STAMPS ARE INDEPENDENT.** Turning the gate ON sets no `pickVisibleAt`; turning it OFF clears none. Hand-verified: bills released before an off/on cycle were still released after it. Anything that cleared stamps on toggle would silently undo the operator's whole afternoon.

---

## 6. The two screens

### `/floor` — the operator

- **`components/floor/pick-gate-toggle.tsx`** — reads `GET /api/floor/pick-gate` **once on mount**. Renders nothing while state is unknown (`enabled === null`), a quiet ghost when off, and a loud state when on. Copy: **"Desk control ON · floor sees only what you show"** — names the consequence, not the mechanism.
- **Held-back count** beside it, counted off the rows already in hand. Floor never calls the picking marker.
- **`status-pill.tsx`** gains `HELD_BACK_META`: `const m = heldBack && status === "waiting" ? HELD_BACK_META : META[status]`. A gate-on waiting row with `pickVisibleAt === null` reads **"At desk"** instead of "Waiting". `heldBack` defaults to `false` in the props destructure, so gate-off renders the pill it always has.
- **`components/floor/show-strip.tsx`** — its own strip above the assign bar, following `assign-context-banner.tsx`. Two independent groups in one selection: not-yet-shown → **"Show them"** (filled); already-shown → **"Send back to desk"** (plain bordered, so teal stays on the forward action). A mixed selection offers both, **each sending only its own ids**. No confirm on either — reversible in one tap.
- Wording reports the real buckets: *"12 shown, 3 already visible"*. `failed` is surfaced separately and never swallowed.
- After either action: `clearSelection()` then an **explicit** `load()`. The floor poll is paused while a selection is up, so the refetch cannot be left to it.

🔴 **`floor-table.tsx`'s colgroup, header cells and four width arrays were NOT touched.** No column was added — the pill carries the new fact instead. The widths map positionally and a mismatch shunts every column sideways (the trap recorded in the invoice-column draft). **A future per-row Show button must solve that before it is worth building** (§9).

⚠ **`rowStatus()` and `countByStatus()` are unchanged, deliberately.** A held-back bill still counts as *waiting* in the slot bands, route rows, By-picker cards and progress bar — because it is waiting. The distinction lives only on the pill.

### `/picking` — the supervisor

- **The band** on the Assign tab, guarded `{(data?.heldBack ?? 0) > 0 && (`. Amber, one line, **inert** — releasing is the operator's job on `/floor`, so the band offers no action. Copy: **"{n} more with the planner"**.
- 🔴 **It renders whenever the count is positive, not only on an empty list.** A supervisor holding 3 released bills while 60 sit at the desk needs to know that as much as one holding none.
- **First paint carries the count** — this is why `countHeldBackWaiting` feeds the queue payload as well as the marker. Without it the Assign tab shows an unexplained empty list for up to 15 seconds, which is the exact failure the band exists to prevent.
- **The Assign badge was already correct and was NOT changed.** `picking-mobile-shell.tsx:506` counts `rows.filter(r => !r.isAssigned && !r.isDone && !r.isChecked && r.zone === "due")`, and those rows come from `getPickingQueue`, whose predicate already applied the gate — a held-back bill is not in `rows` at all. The badge can never exceed the list beneath it. `heldBack` was deliberately **not** added to it: the badge is work he can do.
- **`use-picking-marker.ts` carries `heldBack` at five sites** — `MarkerResponse` (:14-25), `lastSeenRef` (:164-168), the baseline store in `check()` (:255-259), the change comparison (:264-267), and `resync()`'s re-baseline (:351-355). Miss one and a change in it never triggers a refetch. It is **optional and coalesced to 0**, so Floor, Billing and MRN — which point the same hook at markers that do not send it — store a constant and can never be made to refetch by it.
- ⚠ The marker **also skips** the held-back query on a `pickerId` request: a held-back bill is unassigned and can never belong to a picker, so the answer is 0 without a round trip.

### The picker's face is untouched — verified, not assumed

A grep for `heldBack` and `pickVisible` across `app/picking/`, `picker-my-picks-board.tsx` and `picker-split.ts` returns nothing. `app/picking/page.tsx:152` and `app/api/picking/combined/route.ts:101` both call `getPickingQueue` with a `pickerId`, so `heldBack` is 0 with no query and neither forwards it. A held-back bill is unassigned, so it could never reach `splitPickerRows` anyway.

---

## 7. Behaviours that look like bugs and are not

- **Show works with the gate OFF.** It just writes the stamp, letting the operator pre-stage before switching on. Deliberate.
- **A bill unassigned back to `pending_picking` keeps its `pickVisibleAt`** and stays visible. Correct — it was already handed over and nothing has un-handed it. The unassign route was not touched. Re-selecting such a bill returns it under `skipped`, not `changed`.
- **`orders.pickVisibleAt` is not audited in `order_status_logs`** — see §5.
- **Picking still applies NO `getHideExclusion()`.** `lib/picking/queue.ts` makes zero calls, exactly as before. The admin Hide feature was evaluated and **rejected** for this: `getHideExclusion()` is AND-merged into all five Floor feeds, so hiding a bill from the supervisor would also remove it from `/floor` — the very screen the operator is standing on. ⚠ **This work does NOT close the `CORE §13` / `PICKING §7` asymmetry note. Do not let a consolidation pass read "Picking got a visibility filter" and retire it.**

---

## 8. What is NOT verified

- **The `pick_assigned` refusal on send-back has not been exercised on a real bill** (the race in §2). The same guard is proven working on every other path; this specific case is untested. Try it when a natural chance arises.
- **The gate state is read once on mount** on `/floor`. A flip made in another tab, or by a second operator, does not appear until reload. Accepted with one or two people on that screen — revisit only if it bites.
- **No automated test covers any of this.** Claude Code has no login (`CORE`), so every screen claim in this document is Smart Flow's hand-verification on the live site, 2026-09-09.

---

## 9. To ROADMAP, not to canon

- **Per-row Show on the floor table** — cut from v1 because it needs a new column and the four width arrays recalculated. The batch workflow is what the owner actually described. Revisit only with the width trap solved first.
- **The zone rule is duplicated** — `lib/picking/queue.ts:671` and `lib/floor/queries.ts:692-693` hold character-identical copies of the due/upcoming expression. Pre-existing, untouched by this work, and **unrelated to the gate** (zone is about dates, the gate is about handover). Anything that changes what makes a bill "due" must land in both files or Picking and Floor will disagree about the same bill on the same day.
- **Gate-state staleness on `/floor`** (§8).

---

*OrbitOMS · shipped and hand-verified 2026-09-09 · commits `5fce9f31` → `963665af`*
