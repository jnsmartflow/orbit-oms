# Claude Code prompt — Fix Vercel TypeScript error on feat/place-order-page

**Why this prompt:** Vercel preview build failed on `feat/place-order-page` at `app/(place-order)/layout.tsx:24` — `Argument of type '"place_order"' is not assignable to parameter of type 'PageKey'`. Root cause: the `place_order` page-key was added to `lib/permissions.ts` on `feat/attendance-feature-complete` but never propagated to `feat/place-order-page`. We surgically add only the `place_order` lines (NOT the attendance lines) so the place-order branch stays clean.

---

## CONSTRAINTS

1. **Only modify `lib/permissions.ts`.** No other file edits.
2. **Add `place_order` only.** Do NOT add `attendance`, `attendance_admin`, `RolloutStage`, `NavUserFlags`, `userFlags` parameter, attendance filter logic, or any other lines from the attendance branch's diff. Those belong with attendance.
3. **No `prisma db push`, no schema changes, no `npm install`.**
4. **Must be on `feat/place-order-page` branch.** If on a different branch, switch first via `git checkout feat/place-order-page` (no stashing needed — working tree should be clean on this branch).
5. **`npx tsc --noEmit` must pass before commit.** Zero errors.
6. **No code generation yet.** Read this prompt end to end, summarise the 4-step plan back, wait for **"go"**.

---

## CONTEXT — what's missing on this branch

Reference: the diff between `feat/attendance-feature-complete` and `feat/place-order-page` shows attendance branch is ahead in `lib/permissions.ts`. We need to backport ONLY the 3 `place_order` references:

1. **`PAGE_NAV_MAP` entry** — `{ pageKey: "place_order", label: "Place Order", href: "/place-order" }` should appear right after the `vehicles` entry and before `mail_orders`. (Per the diff context.)

2. **`PageKey` type union** — add `| "place_order"` between `warehouse` and `mail_orders`.

3. **Role allowance array** (around line 165 per audit) — confirm `"place_order"` is already in the relevant array. If not, leave it as-is (don't invent placement) and surface as a finding.

The audit report `docs/prompts/drafts/recovery-audit-2026-05-10.md` Section 8 documented the exact 3 hits we want. The third hit was on line 165 in an array containing `"dispatcher"`, `"warehouse"`, `"place_order"`, `"mail_orders"`. Verify presence; if missing, add per audit.

---

## THE 4-STEP PLAN

### Step 1 — Confirm baseline

```bash
git status
git branch --show-current
```

Expected: branch is `feat/place-order-page`, working tree clean.

If branch is different, switch:

```bash
git checkout feat/place-order-page
git status
```

Then read the current `lib/permissions.ts` end to end. Report:
- Current state of `PAGE_NAV_MAP` (paste the array)
- Current state of `PageKey` type (paste the union)
- Whether `"place_order"` appears anywhere
- The role-allowance array around line 165 — paste it

**Stop. Report. Wait for "go".**

---

### Step 2 — Edit `lib/permissions.ts`

Make exactly 2 (possibly 3) surgical edits. Use `Edit` tool, not `Write`:

**Edit A — Add to `PAGE_NAV_MAP`:**

Find the line:
```ts
  { pageKey: "vehicles",      label: "Vehicles",        href: "/admin/vehicles" },
```

Add immediately AFTER it:
```ts
  { pageKey: "place_order",        label: "Place Order",       href: "/place-order" },
```

(Match indentation to surrounding lines.)

**Edit B — Add to `PageKey` type union:**

Find the line containing `| "warehouse"` in the `PageKey` union.

Add immediately AFTER it:
```ts
  | "place_order"
```

(Match indentation.)

**Edit C — Role allowance array (conditional):**

If Step 1 reported that `"place_order"` is already present in the role-allowance array around line 165, SKIP this edit.

If MISSING, find the array containing `"dispatcher"`, `"warehouse"`, `"mail_orders"` and insert `"place_order"` between `"warehouse"` and `"mail_orders"` to match the order in the audit report.

After all edits, run:

```bash
git diff lib/permissions.ts
```

Report the diff. Confirm only `place_order`-related lines were added — no attendance/RolloutStage/userFlags/NavUserFlags content.

**Stop. Report. Wait for "go".**

---

### Step 3 — Verify TypeScript compiles

```bash
npx tsc --noEmit
```

Expected: zero errors.

If errors appear, report them all and STOP — do not commit. We may need additional edits.

If clean: proceed to commit.

**Stop. Report. Wait for "go".**

---

### Step 4 — Commit and push

```bash
git add lib/permissions.ts
git commit -m "fix(permissions): add 'place_order' page-key for /place-order layout gate

Vercel build on feat/place-order-page failed because lib/permissions.ts
on this branch was the older version without 'place_order' wired up. The
key was added on feat/attendance-feature-complete but never propagated
here.

Surgical backport: PAGE_NAV_MAP entry + PageKey type union entry only.
Attendance-related changes from the attendance branch are intentionally
NOT included — they belong with that workstream."

git push origin feat/place-order-page
```

Confirm push succeeded. Vercel will auto-rebuild on push.

---

## FINAL OUTPUT

After Step 4:

- Commit hash of the fix
- Confirmation `tsc --noEmit` is clean
- Note that Vercel auto-rebuild was triggered
- Anything unexpected encountered

Do NOT proceed to any other work. This prompt is fix-only.

---

## DO NOT START YET

Read end to end. Summarise the 4-step plan in 3-5 lines. Wait for **"go"** before Step 1.
