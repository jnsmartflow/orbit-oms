# Manual Tint Entry — Web Update 2026-04-30

Schema v26.5 → v26.6 · UI v5.1 · Tint module v1.0 → v1.1

---

## What shipped

A new feature on the Tint Manager screen letting Chandresh manually pull a non-tint OBD into the tint workflow when the auto-classification at import time missed it (or when a late tint addition is needed).

The feature is additive only — it does not modify or replace the existing auto-classification at import time. It gives Chandresh a manual override for cases the keyword-based classifier gets wrong.

---

## Why

Auto-Import classifies every OBD line as tinting or non-tinting based on a keyword match (`tinting-keywords.txt`) gated by SMU (`Decorative Projects` / `Retail Offtake` only). The whole-OBD `orderType` is then derived: any line with `isTinting=true` → OBD enters tint workflow; otherwise → support queue.

This works for ~95% of OBDs but misses two cases:
1. Sample requests / custom shades where the SKU description doesn't trigger any tint keyword.
2. Late additions — dealer calls after import and asks for a custom shade on what was originally a stock-colour order.

Before this feature, Chandresh had no way to recover those OBDs into his workflow. The feature lets him pull them in by typing the OBD number into a modal, picking which lines need tinting, and submitting with a reason.

---

## Mental model

Chandresh isn't "marking the order as tint" — he's manually setting the per-line `isTinting` flag that Auto-Import would have set if the keyword match had worked. The OBD-level `orderType` and `workflowStage` follow automatically from the same rule the import uses: `hasTinting = lines.some(l => l.isTinting)`. Same rule, same outcome — just triggered manually instead of automatically.

This means:
- Mixed OBDs (some lines tint, some not) work natively. No special logic.
- The Tint Operator screen reads the line `isTinting` flag exactly as it does today. No changes needed to the operator side.
- Reversal is naturally defined — un-flip the lines, and the OBD-level rule says "no tint lines → not a tint OBD" → falls back to non-tint support flow.

A separate `manualTintEntry` boolean on the order + an `manual_tint_entries` audit table track *which* OBDs were pulled manually (for badges, reporting, audit). These are passive labels, not behavioural drivers.

---

## Schema changes (v26.5 → v26.6)

Two additions, applied via Supabase SQL Editor (not `prisma db push`).

```sql
-- Boolean flag on orders
ALTER TABLE orders
  ADD COLUMN "manualTintEntry" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_orders_manual_tint_entry
  ON orders ("manualTintEntry")
  WHERE "manualTintEntry" = true;

-- Audit table (insert-only)
CREATE TABLE manual_tint_entries (
  id              SERIAL PRIMARY KEY,
  "orderId"       INTEGER NOT NULL REFERENCES orders(id),
  action          TEXT    NOT NULL,
  "reasonCode"    TEXT    NOT NULL,
  "reasonNotes"   TEXT,
  "lineIds"       INTEGER[] NOT NULL,
  "performedById" INTEGER NOT NULL REFERENCES users(id),
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_manual_tint_entries_order   ON manual_tint_entries ("orderId");
CREATE INDEX idx_manual_tint_entries_created ON manual_tint_entries ("createdAt" DESC);
CREATE INDEX idx_manual_tint_entries_action  ON manual_tint_entries (action);
```

`manualTintEntry` reflects current state. The audit table preserves full history including reversals — `action` is `'pulled_in'` or `'reverted'`. Both action types persist as separate rows; reversal does not delete the original pull-in row.

Partial index on `manualTintEntry` because `true` is a small minority of rows — much smaller and faster than a full boolean index.

`lineIds` as PostgreSQL `INTEGER[]` instead of a join table because this is read-only audit data, never queried by line. Simpler than a `manual_tint_entry_lines` join table.

---

## Backend — three new endpoints

All under `app/api/tint/manager/manual-entry/`. All use sequential awaits (no `prisma.$transaction`). All gated by `requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN])`. Operations role is excluded — this is a write action and Operations is read-only.

### `GET /lookup?obd=...`

Validates whether an OBD is eligible to be pulled in. Returns the line items for selection.

Validation chain (fail-fast, returns first error):
1. `obd` query param non-empty after trim → else `BAD_REQUEST`
2. Order exists → else `NOT_FOUND` (404)
3. `orderType === 'non_tint'` → else `ALREADY_TINT`
4. `workflowStage === 'pending_support'` → else `PAST_TINT`
5. `orderDateTime` within last 7 days (lower AND upper bound) → else `TOO_OLD`
6. `smu IN ('Retail Offtake', 'Decorative Projects')` → else `INVALID_SMU`

Success: returns `{ ok: true, order: { id, obdNumber, customerName, smu, orderDateTime, workflowStage, orderType, lines[] } }`.

### `POST /` (pull-in)

Body: `{ orderId, lineIds[], reasonCode, reasonNotes? }`.

Reason codes: `sample` · `custom_shade` · `late_addition` · `classification_miss` · `other`. `reasonNotes` required only when `reasonCode === 'other'`.

Validation chain runs in this order (each gate has its own typed `errorCode`):
JSON parse → `orderId` int → `lineIds` non-empty array → `reasonCode` enum → `REASON_NOTES_REQUIRED` for `other` → `reasonNotes` type guard → order exists → `isActive` → `ALREADY_TINT` → `PAST_TINT` → `TOO_OLD` → `INVALID_SMU` → `INVALID_LINES` (all `lineIds` belong to this order's OBD and are valid rows).

Action sequence (sequential awaits):
- A. Update `import_raw_line_items` → set `isTinting=true` on selected lines
- B. Update `import_obd_query_summary.hasTinting=true`
- C. Update `orders` → `orderType='tint'`, `workflowStage='pending_tint_assignment'`, `manualTintEntry=true`, `slotId=null`, `originalSlotId=null`, `dispatchSlot=null`
- D. Insert `order_status_logs` audit row (`fromStage='pending_support'`, `toStage='pending_tint_assignment'`, note includes reason)
- E. Insert `manual_tint_entries` row (`action='pulled_in'`)
- F. Defensive: ensure `delivery_challan` exists for this order. Wrapped in its own try/catch — failure here does NOT roll back the manual pull (steps A-E already succeeded; a missing challan can be created later by lazy-creation pathway).

No outer transaction — steps A-C are idempotent (re-running yields same result), D-E are insert-only audit, F is defensive and self-isolated.

### `POST /revert`

Body: `{ orderId, reasonCode, reasonNotes? }`.

Revert reasons: `classification_miss` · `other`. Revert is allowed only when:
- `manualTintEntry === true`
- `workflowStage === 'pending_tint_assignment'`
- Zero `tint_assignments` rows for this order (no operator assigned)
- Zero `tinter_issue_entries` rows (no TI recorded)
- Zero `order_splits` rows (not split)

Action sequence:
- A. Look up most recent `pulled_in` row to recover `lineIds`. If missing → `PULL_RECORD_MISSING` (defensive — should never happen if `manualTintEntry=true`).
- B. Update `import_raw_line_items` → `isTinting=false` on those lines
- C. Recompute `hasTinting` defensively (count remaining tinting lines on the OBD; should be false but recompute for safety)
- D. Update `orders` → `orderType='non_tint'`, `workflowStage='pending_support'`, `manualTintEntry=false`, slot fields restored via local `resolveSlot()` helper (mirrors `app/api/import/obd/route.ts`)
- E. Insert `order_status_logs` audit row
- F. Insert `manual_tint_entries` row (`action='reverted'`, with same `lineIds` as the pull-in)

Both `pulled_in` and `reverted` audit rows persist permanently. Full history preserved.

---

## Frontend

### TM header — "Pull OBD" button

In `tint-manager-content.tsx` `rightExtra` slot. Order: missing badge → SkuDisplayToggle → divider → **+ Pull OBD** → divider → Card/Table view toggle.

Style: outline pill (`bg-white border-gray-200 rounded-full px-2.5 py-0.5`) with Plus icon. Outline rather than teal-filled because the teal CTA slot is reserved (sidebar/logo/active-segment) and this is daily-use-but-not-primary.

Keyboard shortcut `M` opens the modal when no input is focused. Registered in `UniversalHeader` shortcuts popover.

### Pull-in modal — `components/tint/manual-tint-entry-modal.tsx`

520px wide (slightly wider than the §13 standard 400px to accommodate line list). Two phases inside a single component, driven by local state machine:

- **Empty phase:** OBD input + Fetch button. Auto-focused on open. Enter triggers fetch. Validation errors surface as red banner at top of body; modal stays open for retry.
- **Loaded phase:** Locked OBD pill + IST date + "Change OBD" link (returns to empty phase) → customer info card → optional submit-error banner → line list with checkboxes (all pre-checked by default) → reason `<select>` (defaults to Sample) → notes textarea (label flips to required asterisk when reason is Other).

Submit disabled while: loading OR no lines selected OR (Other selected AND notes empty). Submit shows spinner + "Pulling…" while in flight; backdrop click and Escape are blocked during submit.

Confirm button: `bg-gray-900` per CLAUDE_UI §13 modal pattern. Footer also shows muted text "Audit log will record this pull-in." for transparency.

On success: modal closes, parent calls `fetchOrders()` to refresh the kanban. The OBD appears in Pending Assignment column.

### "Manual" pill on cards and table

Purple pill: `text-[9px] font-medium px-1.5 py-0.5 rounded border bg-purple-50 text-purple-700 border-purple-200`. Same sizing as Mail Orders signal badges (CLAUDE_UI §32).

Renders only when `order.manualTintEntry === true`:
- Card view: in the icon row at top of the card, after the age badge.
- Table view: in the OBD cell below the OBD code, alongside date + age badge. Wrapper has `flexWrap: "wrap"` so the pill drops to a new line on narrow cells.

Tooltip on hover: "Manually pulled into tint."

Purple chosen because the existing badge palette has amber overloaded (missing customer, urgent, waiting), red reserved for blockers, green for done. Purple gives manual entries their own visual lane.

### Revert flow — kebab item + dialog

In the card kebab `pending_tint_assignment` branch, after Assign + Create Split, shows a divider + red **↺ Remove from Tint** item. Visible only when:
- `order.manualTintEntry === true`
- `(order.tintAssignments ?? []).length === 0`
- `!hasSplits`

Once an operator is assigned, the order moves to `tint_assigned` and the kebab branch above no longer matches — the option naturally disappears. Defensive checks belt-and-braces against legacy data.

Click opens revert dialog: `components/tint/manual-tint-revert-modal.tsx`. 400px (per §13). Reason defaults to "Auto-classification Miss". Notes optional unless reason is Other.

Confirm CTA: `bg-red-600` — diverges from §13's `bg-gray-900` because this is a destructive action. Divergence is annotated in code comment for future maintainers.

While submitting: backdrop, Escape, Cancel all blocked.

On success: parent calls `fetchOrders()` → OBD disappears from Pending Assignment (back to support queue, which the TM screen does not display).

---

## Reporting

The `manual_tint_entries` table enables out-of-the-box reporting via SQL:

```sql
-- Most common reasons last month
SELECT "reasonCode", COUNT(*)
FROM manual_tint_entries
WHERE action = 'pulled_in' AND "createdAt" > now() - interval '30 days'
GROUP BY "reasonCode" ORDER BY 2 DESC;

-- Reversal rate (mistakes Chandresh fixed)
SELECT
  COUNT(*) FILTER (WHERE action='pulled_in')   AS pulls,
  COUNT(*) FILTER (WHERE action='reverted')    AS reverts,
  ROUND(100.0 * COUNT(*) FILTER (WHERE action='reverted')
        / NULLIF(COUNT(*) FILTER (WHERE action='pulled_in'), 0), 1) AS revert_pct
FROM manual_tint_entries
WHERE "createdAt" > now() - interval '30 days';

-- Volume of manual pulls per week
SELECT
  date_trunc('week', "createdAt") AS week,
  COUNT(*) AS manual_pulls
FROM manual_tint_entries
WHERE action = 'pulled_in'
GROUP BY week ORDER BY week DESC;
```

A `GET /api/admin/manual-tint-entries` endpoint with date/action/user filters was scoped in design but deferred. Easy to add later when Chandresh or admin actually needs it.

---

## Files added / changed

**New files:**
- `app/api/tint/manager/manual-entry/lookup/route.ts`
- `app/api/tint/manager/manual-entry/route.ts`
- `app/api/tint/manager/manual-entry/revert/route.ts`
- `components/tint/manual-tint-entry-modal.tsx`
- `components/tint/manual-tint-revert-modal.tsx`

**Modified:**
- `prisma/schema.prisma` — `manualTintEntry` field on `orders`, new `manual_tint_entries` model, back-relation on `users`
- `components/tint/tint-manager-content.tsx` — Pull OBD button, M shortcut, modal state, Card kebab item, revert modal wiring, Manual pill on card, two synthetic-TintOrder shims updated
- `components/tint/tint-table-view.tsx` — Manual pill in OBD cell, synthetic-TintOrder shim updated

**No changes to:**
- `app/api/tint/manager/orders/route.ts` — Prisma scalar fields auto-pass through, `manualTintEntry` returned for free
- `app/api/import/obd/route.ts` — auto-classification untouched
- Auto-Import.ps1 — keyword classification untouched

---

## Validation matrix tested

Phase 2 (curl) — five tests passed:
1. Lookup happy path — returns customer, lines, all metadata ✓
2. Lookup NOT_FOUND — 404 with typed errorCode ✓
3. Pull-in happy path — orderType + workflowStage + manualTintEntry + audit row + line flips all correct ✓
4. REASON_NOTES_REQUIRED — validation fires before DB lookup ✓
5. Revert happy path — full state restored, audit row inserted ✓

Phase 3D (browser) — all visual + interaction tests passed:
- Pill renders on card + table for manual orders ✓
- Pill absent on auto-classified orders ✓
- Kebab "Remove from Tint" shows only for eligible orders ✓
- Revert dialog → loading → success → kanban refresh ✓
- Backdrop/Escape blocked while submitting ✓
- Round-trip pull → revert → re-pull confirmed ✓

---

## Known limitations / follow-ups

- **Table view has no kebab.** Revert action is card-only by design (table Action column is 8% width, only fits "Assign"). Acceptable because Chandresh's typical revert moment is "I just pulled this in by mistake" — and at that moment he's looking at the freshly-pulled card. If he asks for table-view revert later, easy to add.
- **No `bg-purple-50/20` row tint** in table view (was in mockup §7, marked optional). Left off to reduce visual noise. Easy to add.
- **No admin reporting screen.** SQL queries above are sufficient for now. Add `/admin/manual-tint-entries` page when needed.
- **No toast on success.** Modal closes + kanban refresh is the feedback. Quiet by design.
- **`lineId` is 0 on import_raw_line_items for some OBDs.** Pre-existing bug noticed during testing — the per-OBD line index isn't being populated correctly for some imports. Doesn't affect Manual Tint Entry (we use the row `id` field, not `lineId`). Separate cleanup task.

---

## Doc updates required

Apply in this order before next feature:
1. `docs/CLAUDE_CORE.md` v72 → v73, schema v26.5 → v26.6
   - §7.3: add `manualTintEntry` field to `orders` table, add `manual_tint_entries` model line
   - §14: bump schema version reference
   - Top header version bump
2. `docs/CLAUDE_TINT.md` v1.0 → v1.1
   - Add §1.11 Manual Tint Entry covering button placement, modal flow, pill, revert kebab
   - Add table-view revert as a follow-up in §8 pending list
   - Top header version bump

These edits are mechanical and live in the next Claude Code prompt.

---

*Manual Tint Entry · Schema v26.6 · April 2026 · Smart Flow / Orbit OMS*
