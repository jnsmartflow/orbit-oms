# code-discovery-2026-09-08 — Urgent-in-red migration

# Status: DEFERRED BY DECISION. Out of scope for the rebrand. Owner ruling 2026-09-09.
# Written on branch `rebrand` at 3eed60e8. NO CODE CHANGED BY THIS DOCUMENT.
# Evidence: read-only sweeps over app/ components/ lib/ on 2026-09-09, every site opened and read.
#
# §6 ADDED LATER THE SAME DAY (owner ruling, branch `rebrand` at ae38088d): four NON-URGENT reds
# found during the rebrand's Sign-out step. They are not §1 sites and do not share §1's predicate
# problem, but they fail the same v5.21 §1 test and were ruled to belong with this work.

---

## 0. The ruling this records

**`CLAUDE_UI.md` v5.21 wins. Red is error and destructive only. Urgency is amber.**

`web-update-2026-09-06-orbit-colour-spec-v2.md` was written on 2026-09-06, two days before the
v5.21 change, and bundles a priority ("Urgent flag") with faults ("errors, cancelled") under one
red token. The spec is wrong on this point and is being corrected by the owner. Token consequences
for the rebrand, recorded here so they are not re-litigated:

| Was | Becomes | Means |
|---|---|---|
| `bad` (step-1 config) / `urgent` (spec §1) | **`danger`** | Errors, failed sends, blocked dealers, Delete, Clear, Replace, Voided/Removed, Hold. **Never a priority.** |
| "Urgent flag" listed under `urgent` | **moves to `warn`** | Amber. It is a priority, not a fault. |
| `data.rose` `#E11D48` | **unchanged** | Cross delivery type. Coincides with `danger`'s hex; pre-existing, spec §6 item 2. |

**🔴 AND THE MIGRATION ITSELF IS NOT PART OF THE REBRAND.** Every red currently painting Urgent
**stays red through the whole rebrand** and is migrated in its own session afterwards. Three
reasons, all of them load-bearing:

1. **It is twelve sites in ten files, not the three `CLAUDE_UI.md §3` lists.** A migration sized
   from the doc would have missed three quarters of it.
2. **"Urgent" is not one predicate — it is three.** Floor tests `priorityLevel === 1`, Tint tests
   `priorityLevel <= 2`, Mail Orders tests the string `dispatchPriority === "Urgent"`. **The same
   bill is urgent on one board and not on another today**, before anything is recoloured. That is
   a logic defect. Recolouring on top of it would bake it in and make it far harder to see.
3. **`components/shared/duplicate-so-tag.tsx` is a DEPENDENT, not a target.** See §4.

---

## 1. The twelve sites

Every one paints red for **urgency**. Grouped by module; line numbers verified 2026-09-09 against
`3eed60e8`.

### Shared

| # | File · line | Predicate | What it paints |
|---|---|---|---|
| 1 | `components/shared/status-badge.tsx:31` | `variant="urgent"` | `bg-red-50 text-red-700 border border-red-200` — the badge |
| 2 | `components/shared/status-badge.tsx:70` | `variant="urgent"` | `bg-red-500` — the dot. ⚠ `urgent` is in `dotDefaults` (`:61`), so **the dot renders by default**; this is a second red the doc's entry does not mention |

### Floor

| # | File · line | Predicate | What it paints |
|---|---|---|---|
| 3 | `components/floor/floor-table.tsx:372` | `row.priorityLevel === 1` (`:359`) | `border-red-200 bg-red-50 text-red-500` — the hover ⚡ mark-urgent **toggle**, in its ON state |
| 4 | `components/floor/floor-table.tsx:500` | `row.priorityLevel === 1` (`:499`) | `style={{ color: "#ef4444" }}` — the ⚡ glyph in the **row body**. A second red in the same file, not in the doc's list |
| 5 | `components/floor/rail-card.tsx:301` | `card.priorityLevel === 1` (`:300`) | `style={{ color: "#ef4444" }}` — ⚡ glyph |
| 6 | `components/floor/hold-tab.tsx:108` | `row.priorityLevel === 1` | `text-[#ef4444]` — ⚡ glyph |
| 7 | `components/floor/cancelled-tab.tsx:137` | `row.priorityLevel === 1` | `text-[#ef4444]` — ⚡ glyph |
| 8 | `components/floor/detail-panel.tsx:530` | `d.priorityLevel === 1` | `bg-[#fef2f2] … text-[#b91c1c]` — a full **"⚡ Urgent"** pill |

### Tint

| # | File · line | Predicate | What it paints |
|---|---|---|---|
| 9 | `components/tint/manager/board-table.tsx:303` | `row.isUrgent` | `style={{ color: "#ef4444" }} title="Urgent"` — ⚡ glyph |
| 10 | `components/tint/manager/board-rail.tsx:188` | `o.priorityLevel <= 2` (`:187`) | `bg-red-50 text-red-700 border-red-200` — a **"⚡ Urgent"** pill |
| 11 | `components/tint/tint-table-view.tsx:173` | `(level ?? 5) <= 2` (`:171`, `PriorityBadge`) | `bg-red-50 text-red-700 border border-red-200` — a **"🚨 Urgent"** badge |

### Picking

| # | File · line | Predicate | What it paints |
|---|---|---|---|
| 12 | `components/picking/bill-symbols.tsx:52` + `:98` | `row.priorityLevel === 1` | `URGENT_COLOR = "#fca5a5"` (red-300) — ⚡ glyph on the bill header. Constant and use site are separate lines; one rendered element |

**Count correction, stated so the next reader does not inherit a wrong number.** The 2026-09-08
verbal report said "11 sites across 10 files". The correct figure is **12 rendered elements across
10 files** — that report folded `status-badge.tsx`'s two reds (`:31` badge and `:70` dot) into one
row of a summary table. The file count is unchanged.

### Already amber — NOT migration targets, and they are the precedent

Two surfaces already ship Urgent in amber. They are why v5.21 says the app "already ships Urgent in
amber elsewhere", and they should be the reference when the other twelve move:

| File · line | Predicate | What it paints |
|---|---|---|
| `app/(mail-orders)/mail-orders/mail-orders-table.tsx:993-1002` | `order.dispatchPriority === "Urgent"` | `bg-amber-50 text-amber-700 border-amber-200`. ⚠ Note `isHold` **beats** `isUrgent` in the same ternary and takes `bg-red-50 text-red-700` — correct under v5.21, since Hold is a thing being stopped |
| `components/picking/picking-board-mobile.tsx:510` | `row.priorityLevel === 1` | `text-amber-500 fill-amber-500` on a lucide `<Zap>` |
| `app/po-v2-8f4kd2/order-sheet.tsx:240-241` | (v2 order sheet) | `ATTENTION = "#B45309"` / `ATTENTION_BG = "#FFFBEB"` — amber-700 on amber-50 |

🔴 **Picking is internally inconsistent today, and this is the sharpest illustration of the
problem.** The same module paints the same ⚡ two different colours: `picking-board-mobile.tsx:510`
is **amber-500**, `bill-symbols.tsx:52` is **red-300**. Both read `priorityLevel === 1`. Nobody
decided this; it is what happens when the rule lives only in prose.

---

## 2. The three predicates

"Urgent" is not one thing. Fixing the colour without fixing this would freeze the divergence.

### A — `priorityLevel === 1` (Floor and Picking)

`components/floor/floor-table.tsx:359, 499` · `components/floor/rail-card.tsx:300` ·
`components/floor/hold-tab.tsx:108` · `components/floor/cancelled-tab.tsx:137` ·
`components/floor/detail-panel.tsx:530` · `components/floor/detail-details.tsx:77` (renders the
label `"Urgent (P1)"`) · `lib/floor/filter.ts:54` (**the filter predicate**) ·
`components/picking/bill-symbols.tsx:43, 98` · `components/picking/picking-board-mobile.tsx:510`

Write path: `app/api/floor/actions/route.ts:111` — the ⚡ toggle writes `priorityLevel`.

### B — `priorityLevel <= 2` (Tint)

`components/tint/manager/rows.ts:93` (`isUrgent: o.priorityLevel <= 2`) and `:135`
(`isUrgent: (s.priorityLevel ?? 5) <= 2`; `:170` hardcodes `false`) ·
`components/tint/manager/board-rail.tsx:187` · `components/tint/manager/board-detail-panel.tsx:290`
· `components/tint/tint-table-view.tsx:171` · `components/tint/tint-manager-content.tsx:241, 265-266`
(**the filter predicate**, via both the raw level and the derived `isUrgent`)

`isUrgent` is declared on the row type at `components/tint/manager/types.ts:290`.

### C — `dispatchPriority === "Urgent"` (Mail Orders)

`app/(mail-orders)/mail-orders/mail-orders-table.tsx:993`. A **string** column on `mo_orders`, not
`priorityLevel` at all — a different field in a different table on a different pipeline.

### The consequence, in one sentence

**A bill at `priorityLevel = 2` is Urgent on every Tint surface and ordinary on every Floor
surface, right now.** `board-detail-panel.tsx:290` even applies A and B to the two halves of one
ternary — `isPending ? target.order.priorityLevel <= 2 : row!.isUrgent` — so the split runs through
a single expression.

**Decide the predicate before the colour.** If `<= 2` is right, Floor under-reports urgency; if
`=== 1` is right, Tint over-reports it. Either way one set of boards is wrong today, and a
recolouring session that does not settle this will paint the disagreement amber and move on.

---

## 3. Four defects in `CLAUDE_UI.md` v5.21 itself

v5.21 landed in commit `3c713282` (2026-09-08 23:14). Its complete diff is three hunks: the header
version bump, the §1 red/amber rule, and the §3 note. Nothing else in the file changed — delivery-type
dots, tinter dots, attendance chips, OT banners, §2's teal system and §10's button list are all
byte-identical to v5.20. Within that small diff, four defects:

### D1 — 🔴 The migration list is incomplete: three named, twelve real

§3's table names `components/shared/status-badge.tsx`, `components/floor/floor-table.tsx` and
`components/shared/duplicate-so-tag.tsx`. It misses seven files entirely (`rail-card`, `hold-tab`,
`cancelled-tab`, `detail-panel`, `board-table`, `board-rail`, `tint-table-view`, `bill-symbols`),
undercounts both files it does name by one site each, and lists as a target a file that paints no
Urgent at all (§4). **The most consequential of the four** — the list reads as complete and is not.

**The evidence it is incomplete is inside the note itself.** Its `duplicate-so-tag.tsx` row points
at a file whose own comment (`:93-95`) names **four** urgent-⚡ surfaces —
*"`#ef4444` is ALSO the urgent ⚡ glyph on this board (floor-table, rail-card, hold-tab,
cancelled-tab)"* — while the table beside it lists only `floor-table`.

### D2 — The footer still says v5.20

Header: `# v5.21 · September 2026 · updated 2026-09-08`. Footer: `*UI v5.20 · OrbitOMS · updated
2026-09-06 …*`, describing the Tint Manager wiring change, not this one.

⚠ **This is a repeat.** The v5.20 footer itself flagged the identical failure — *"This footer had
drifted two versions behind its own header — footer v5.18 against header v5.19 … That is exactly
the drift the 'check the header AND the footer' rule exists to catch."* It recurred on the very
next edit.

### D3 — The §1 cross-reference points at the wrong section

§1 cites *"§12's attention chip, which had shipped `bg-amber-50 / text-amber-700` for 'Bill
Tomorrow, Cross XYZ, **Urgent**' for over a year"*.

**§12 is the Login page** (`CLAUDE_UI.md:306`). The attention chip is in **§20 — Mail Orders,
signal badges** (`:374`), and the row is at **`:391`**. Anyone following the pointer to justify the
rule lands on a page with no chips on it.

*(The claim itself is true — the row does read `bg-amber-50 text-amber-700 border-amber-200` for
`Bill Tomorrow, Cross XYZ, Urgent`, and `components/mail-orders/signal-pill.tsx` ships it. Only the
pointer is wrong.)*

### D4 — §3's Urgent row matches neither component it claims to record

The table row reads:

| Purpose | Bg | Border | Text |
|---|---|---|---|
| Urgent | `bg-red-50` | `border-red-200` | **`text-red-600`** |

The note directly beneath says the row is *"a RECORD OF SHIPPED CODE"*. It is not:

- `status-badge.tsx:31` paints **`text-red-700`**
- `floor-table.tsx:372` paints **`text-red-500`**

**No live component paints `text-red-600` for Urgent.** The value is off by one shade from one
component and one shade from the other in the opposite direction. A row asserting it records the
pixels should record the pixels.

---

## 4. 🔴 `components/shared/duplicate-so-tag.tsx` — a DEPENDENT. DO NOT CHANGE IT.

`CLAUDE_UI.md §3` lists this file in the migration table. **That is a mis-framing and acting on it
would be a regression.**

**This file paints no Urgent.** Its sixteen exported constants (`:53-128`) are the **Duplicate-SO**
treatment — red as *data*, meaning "this SO appears on more than one bill" — consumed by six
importers (`floor/rail-card.tsx`, `floor/floor-table.tsx`, `floor/detail-panel.tsx`,
`picking/picking-board-mobile.tsx`, and others). It is the only properly centralised colour set in
the codebase, and `code-discovery-2026-09-06-colour-inventory.md` lists it under *"Untouched — do
not open these files for colour reasons"*.

**It appears in §3's table only because it CITES the Urgent row** — its comment at `:93-98` reads:

> 🔴 THE COLOUR IS A DECISION, NOT AN OVERSIGHT. `#ef4444` is ALSO the urgent ⚡ glyph on this
> board (floor-table, rail-card, hold-tab, cancelled-tab) and CLAUDE_UI §3 hands `bg-red-50` to
> Urgent, Hold AND Voided/Removed. Smart Flow ruled on 2026-08-25, knowing that: on a FLOOR ROW,
> red-50 + a red-500 left bar means Same-SO; Urgent keeps the ⚡ glyph and nothing else.
> **Do not "fix" this to amber or violet in a later pass — it was weighed and chosen.**

**Its red survives v5.21 untouched on the rule's own terms** — a duplicate SO *is* something wrong,
which is what red now means. There is nothing to migrate here.

**What it actually is: the reason the migration gets EASIER, not harder.** Smart Flow's 2026-08-25
ruling accepted that Urgent's red and Duplicate-SO's red collide on a Floor row, and separated them
by glyph rather than hue. **Moving Urgent to amber removes that collision** — after the migration,
red on a Floor row means Same-SO and nothing else, and the ⚡ no longer has to carry the distinction
alone. Record this as a *benefit* of the migration when it is scheduled, and leave this file alone.

⚠ `DUP_SO_BADGE_CLASS` (`:79`) exists because a solid-red duplicate card eats every other red and
amber badge on it — including the ⚡. **When Urgent goes amber, re-check that class**: an amber ⚡
on a `#dc2626` fill has a different contrast problem from a red one, and `picking/bill-symbols.tsx`
already documents the same issue at `:59-62` for its own `#fca5a5`.

---

## 5. Scope when this is scheduled

**Not** part of the rebrand. When it runs, in its own session:

1. **Settle the predicate first** (§2). One definition of Urgent, or an explicit ruling that Floor
   and Tint mean different things and why. This is a behaviour change and needs the owner.
2. **Then recolour the twelve sites** (§1) to the amber pair already shipped by
   `mail-orders-table.tsx:993-1002` and `picking-board-mobile.tsx:510`.
3. **Fix Picking's internal split** — `bill-symbols.tsx` and `picking-board-mobile.tsx` disagree
   with each other today.
4. **Re-check `DUP_SO_BADGE_CLASS`** for amber-on-red contrast (§4).
5. **Then, and only then, flip `CLAUDE_UI.md §3`'s Urgent row to amber** and fix D2/D3/D4. Not
   before — *"a stamp nobody earned is the failure `CLAUDE.md §4` exists to prevent"* is §3's own
   wording and it applies to whoever closes this out.
6. **Leave `duplicate-so-tag.tsx` alone** (§4), and leave `Hold` and `Voided / Removed` red — both
   are a thing being stopped or undone, which is what red means under v5.21.

**Files to open when it runs: 10.** `components/shared/status-badge.tsx` ·
`components/floor/floor-table.tsx` · `components/floor/rail-card.tsx` ·
`components/floor/hold-tab.tsx` · `components/floor/cancelled-tab.tsx` ·
`components/floor/detail-panel.tsx` · `components/tint/manager/board-table.tsx` ·
`components/tint/manager/board-rail.tsx` · `components/tint/tint-table-view.tsx` ·
`components/picking/bill-symbols.tsx`.

Plus, for the predicate: `lib/floor/filter.ts`, `components/tint/manager/rows.ts`,
`components/tint/manager/types.ts`, `components/tint/tint-manager-content.tsx`,
`components/tint/manager/board-detail-panel.tsx`, `components/floor/detail-details.tsx`,
`app/api/floor/actions/route.ts`.

---

## 6. Non-destructive reds, pending

Added 2026-09-09 by owner ruling. These are **not** urgent-state reds, so they are not §1 sites,
but they fail the same v5.21 §1 test — *red is error and destructive only* — and they belong with
this work rather than with the rebrand. **All four are ruled to change. None has been changed.**

They were found by a second-pass sweep during the rebrand's Sign-out step, run by TAG rather than
by class (walk back from each red `className` to the element that owns it, keep only `<button>` /
`<a>` / `<Link>`). That sweep returned **40 clickable elements carrying red** across `app/` and
`components/`; the great majority are genuinely destructive — Remove OBD, Cancel, Reject OT,
Revert, Force default, and every `action.danger` menu item — or are §1 urgent sites already listed
above. These four are what is left, and each one was OPENED and READ, not grepped and assumed.

Four reds ruled non-destructive in the same session were fixed under the rebrand and are NOT
pending: the Sign-out confirm, the two (in fact three) "+N sites"/"+N packs" disclosures, "Jump to
first ↓", and the "○ Inactive" pill. See commits `96e209b7` and `6aa4e41e`.

### N1 — `components/tint/operator/formula-match-modal.tsx:121` — the "Same shade found" badge

`<span className="w-[26px] h-[26px] rounded-full bg-red-50 text-red-600 …">!</span>`, sitting
beside the heading **"Same shade found"** over the body *"This exact formula already exists in the
library. Use one of these numbers instead of creating a new one?"*

**Ruling: `ok`.** A duplicate is a MATCH, not a fault — the library did its job and saved the
operator from minting a second number for a shade it already knows. It is arguably a *find* rather
than a warning, which is why it goes to ok and not to warn: nothing here needs attention, something
here went right. Target `bg-ok-bg text-ok-text`.

⚠ **The glyph is part of the signal.** The badge renders a literal `!`, which is an alarm mark, and
recolouring the disc while leaving `!` inside it would leave the two halves saying different
things. Whoever runs this should change the glyph too — a check, or the "found" mark this modal's
own result rows use.

### N2 — `app/(mail-orders)/mail-orders/mail-orders-table.tsx:1121` — the flagged-lock toggle

`<button … className="bg-red-50 rounded p-1 text-red-500">` wrapping a `<Lock size={14} />`, shown
when `effectiveFlagged` is true; the unflagged branch three lines below is a `<LockOpen>` in plain
`text-gray-300`. `effectiveFlagged = isFlagged || autoFlagged`, and `autoFlagged =
isOdCiFlagged(order)` — so this is a mix of a human's flag and an automatic OD/CI one.
Consequence: `isDisabled` on line 675 includes `effectiveFlagged`, so a locked order cannot be
copied or punched.

**Ruling: change — but SETTLE IT AGAINST §5.6 FIRST, because the two rulings pull opposite ways.**
§5.6 of this document says `Hold` and `Voided / Removed` STAY red, on the grounds that red is
right for *a thing being stopped or undone*. A lock is a thing being stopped. If §5.6 holds, this
lock is red for the same reason Hold is, and it should stay; if this lock moves, §5.6's reasoning
needs restating, because "stopped" would no longer be a red-earning category. **Do not decide these
two separately.** My own reading is that the lock is closer to Hold than to an error and I would
leave it, but the owner has ruled it changes, so what is actually owed here is the reconciliation,
not the edit.

### N3 — `app/(mail-orders)/mail-orders/mail-orders-table.tsx:1729` — the "not found" line dot

Read before assuming, as instructed. It is a 16px dot, `bg-red-100 text-red-600 hover:bg-red-200`
when `lineStatuses[line.id]?.found === false`, `bg-gray-100 text-gray-400` otherwise, with
`title="Not found: {reason}"`.

**What `found` actually means, from `LINE_STATUS_REASONS` in `lib/mail-orders/types.ts:12-18`:**
`out_of_stock` · `wrong_pack` · `discontinued` · `other_depot` · `other`. It is set by hand in
`line-status-panel.tsx`, whose toggle reads **"Found in SAP" / "Not found in SAP"**, and it
defaults to `found: true` (`initialFound = ls?.found ?? true`).

**Ruling: `warn`, and the owner's caution was half right.** A line that could not be matched IS a
fault of the order — that much is true, and it is why this is not `ink`. But it is not a SYSTEM
error and nothing has gone wrong with the software: three of the five reasons — out of stock,
discontinued, other depot — are ordinary facts about supply that a biller records, and the
remaining two are a pack mismatch and a free-text note. It is a thing needing attention on an order
that is otherwise fine, which is the definition of warn under v5.21. Target `bg-warn-bg
text-warn-text`.

⚠ **THREE MORE SITES MOVE WITH IT — the paired-signal rule.** The dot is one half of a signal whose
other half lives in the panel it opens:
- `line-status-panel.tsx:192` — the status toggle's own wash, `bg-red-50 border-red-200`, paired
  against `bg-green-50 border-green-200` at `:191` for found;
- `line-status-panel.tsx:196` and `:203` — the `bg-red-100` disc and the `#dc2626` ✕ inside it;
- `line-status-panel.tsx:234` — the selected reason chip, `border-red-400 bg-red-50 text-red-700`.

Moving the dot alone would leave the table amber and the panel red for the same fact. And note the
GREEN half: "Found in SAP" is `green-50/green-200/green-800`. If not-found becomes warn, decide
explicitly whether found stays green or becomes plain — a green/amber pair reads differently from
the green/red pair it replaces.

### N4 — `components/tint/tint-operator-content.tsx:2723` — "Skip this job"

`className="h-[38px] px-4 bg-white border border-gray-200 text-red-700 …"`, hover `bg-red-50
border-red-200`, `title="Skip this job — sends it back to Tint Manager"`. It opens a confirm modal
(`setSkipModalJob`) rather than acting immediately, and it sits beside the green "Save TI & Start"
commit.

**Ruling: `warn`, per the owner — it is reversible.** The job is not destroyed, cancelled or lost;
it goes back to Tint Manager to be reassigned, and the title says so in as many words. Red claims a
permanence this action does not have. Target the warn equivalent of the same outline shape:
`text-warn-text`, hover `bg-warn-bg border-warn/30`, keeping the white ground and the grey resting
border it has now.

⚠ **Check the skip MODAL in the same pass.** This button only opens `skipModalJob`; whatever the
modal's own confirm wears was not audited here and must not be left red under a warn trigger.

### Not in this list, and why

- `components/admin/attendance/ot-pending-table.tsx:139` — "Retry". Owner-ruled to stay: the red
  belongs to the error banner it sits inside, not to the button.
- `components/tint/tint-table-view.tsx:282` — driven by `action.danger`, a declared flag. Working
  as designed.
- The `bg-red-600` confirms in `ot-reject-modal`, `settings-confirm-modal`, `cancel-sheet`,
  `photo-lightbox`, `manual-tint-revert-modal`, `slots-table`, `slot-rules-table`,
  `import-modal` and `cart-panel` — all destructive, all correct.

---

*Read-only discovery. No code changed. Written 2026-09-09 on branch `rebrand` at `3eed60e8`, after
the owner's ruling that `CLAUDE_UI.md` v5.21 supersedes `web-update-2026-09-06-orbit-colour-spec-v2.md`
on red vs amber. Every site in §1 and every predicate in §2 was opened and read, not grepped and
assumed; the two "already amber" surfaces in §1 were found by checking sites the earlier verbal
report had listed as red, and are corrections to it.*
