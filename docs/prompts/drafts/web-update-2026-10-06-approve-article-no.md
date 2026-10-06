# web-update — Article no. on Approve (2026-10-06)

Decision record. Not built yet. Builds on
`docs/prompts/drafts/code-discovery-2026-10-06-approve-article-count.md` (read that for file:line detail).
Mockup: `docs/mockups/picking/approve-article-count.html` (approved 2026-10-06).

## What it is

When a floor supervisor approves a picked bill, he enters the **article no.**: the number he has
physically written on the drum. Floor shows it.

This is NOT the import's article data:
- `import_raw_line_items.article` / `articleTag` and the order roll-up `totalArticle` are computed at
  import from qty and pack size. They are what SAP says should go out.
- Article no. is what the supervisor counted and wrote. It is a separate fact in a separate column.
  Never overwrite or derive from the import fields.

## Decisions (owner, 2026-10-06)

1. **Popup on Approve.** Supervisor board → Done tab → Needs check → tick screen → Approve opens a popup.
   - Title "Article no.", one numeric box, keypad opens by itself (`inputMode="numeric"` + autofocus).
   - No SAP plan / article tag shown in the popup.
   - No prefill on first entry. Save disabled until valid.
   - One button: **Save**. Save = approve + store the number. Cancel closes the popup, bill stays unapproved.
2. **Rule:** required, whole number 1–999. Checked in the route (400 otherwise) and by a DB CHECK.
3. **Edit:** on a Checked bill's detail screen, the ⋯ menu gets **"Edit article no."**. It opens the
   same popup, pre-filled with the current number. Reachable while the bill is in the Done tab's Checked
   band (checked today). The number also shows read-only in the detail summary line ("Art. no. 5").
4. **Floor table:** TWO columns, **Article tag** (existing, unchanged) and **Article no.** (new).
   Article no. shows on checked and dispatched rows, blank while picking, "—" when NULL. Never 0.
   The 2026-09-10 column-width matrix must be re-balanced for the new column.
5. **Storage:** `"articleCount" integer NULL` on `pick_assignments` (camelCase, no `@map`, like
   `clearedAt`), with `CHECK ("articleCount" IS NULL OR "articleCount" BETWEEN 1 AND 999)`.
   Written inside Approve's existing first `pick_assignments.update`; nulled in its existing rollback.
   Every cancel/delete path removes it with the row, so no clean-up code is needed.
   - **Assumed:** Direct-Loaded bills do NOT get an article no. (they never go through Approve and
     have no `pick_assignments` row). If that changes, storage must move to `orders`. Confirm before build.

## Build notes to carry into the prompts

- Approve: no new write, no second `orders.update` (PICKING §10 landmine).
- **Edit is a NEW write that touches only `pick_assignments`.** It must also bump `orders.updatedAt`
  (one `orders.update`), or the live-sync marker never sees the change and Floor stays stale
  (PICKING §10: "pick_assignments has NO updatedAt"). New route, `picking` canEdit, sequential awaits,
  one `order_status_logs` row, only when stage is `pick_checked`.
- Popup is its own always-mounted component (not `FindingPopup`), carries `NO_BILL_SWIPE_ATTR`.
- Popstate: add `countOpen` branch to `navStateRef`; clear it synchronously before Approve's
  `history.back()`.
- Floor: add `articleCount` to `getFloorBoard`'s existing `pickAssignment` select + mapping; declare on
  `FloorBoardRow`. Gate display on status, not `isChecked`. Supervisor board also needs it (detail
  summary + edit prefill) → declare on `PickingQueueRow` instead, both builders.
- Phones on an old bundle will get the 400 on Approve until they reload.

## Out of scope for v1

Billing Picking tab, Billing print, picker's Done tab, Floor detail panel, trip sheet. Listed in the
discovery §6; add later if wanted.
