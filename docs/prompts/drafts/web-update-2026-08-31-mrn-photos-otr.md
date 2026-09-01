# MRN — Photos + OTR Closing Step

**Draft type:** `web-update` (owner decision record)
**Version:** v3 · 2026-08-31 — design locked, ready to build

> ⚠ **Two decisions were made and reversed on the same day.** The LR photo is **optional**
> (§5.2) and there is **no purge cron** (§4.4). Any earlier copy of this draft saying
> "mandatory" or "90 days" is stale. The reversals are recorded rather than erased so a future
> session does not rediscover them as new ideas.
**Author:** Claude.ai planning session with Smart Flow

**Save to:** `docs/prompts/drafts/web-update-2026-08-31-mrn-photos-otr.md`

**Evidence base:** the Step-1 discovery report (read-only SELECTs against production +
source trace, 2026-08-31). Every file:line and every live count below comes from it.
Nothing here is inferred from an older draft.

> ⚠ **MRN has no canonical context file.** The router has no MRN row, `CLAUDE_CORE.md:200`
> says a `§7` block for MRN is "still owed", and the only written spec is
> `docs/prompts/drafts/web-update-2026-08-20-mrn-module-design.md`. This draft assumes the
> file headers are the source of truth. Re-derive any `CORE §n` pointer before relying on it.

---

## 1. What this is

Two features that landed in the same conversation. They share a module and nothing else —
build them in the order below, but they are separable.

| | OTR closing step | Photos |
|---|---|---|
| Problem | The OTR number can never be entered | No visual record of what arrived |
| Who acts | billing_operator, at a desk | floor_supervisor, on a phone |
| When | After the truck is unloaded and checked | During unloading and at the end |
| Cost | One new status value + a gate sweep | One table, one bucket, two screens |

---

## 2. Why the OTR field has never been used

**Zero of ten live MRNs carry an OTR number.** STI ref is filled on 7 of 10, Delivery no on
8 of 10. The field is offered twice in the UI (`new-mrn-modal.tsx:43`,
`edit-header-modal.tsx:68`) and has never once been filled.

The reason is mechanical, not behavioural: **the header locks the moment unloading STARTS.**
`header/route.ts:146-156` returns 409 with *"This MRN is done — the header can no longer be
edited"*, and `start/route.ts:22-29` documents the coupling. The OTR number arrives *after*
the truck is unloaded. There has never been a moment when the field was both known and
editable.

This is not a feature request. It is a dead end being opened.

---

## 3. The status ladder — today and after

### Today

```
open ──START──► checking ──END──► done
 │  (supervisor)          (supervisor)
 └─ billing owns the row: header PATCH, lines PUT, delete
    all 409 the moment status ≠ 'open'
```

Live constraint: `chk_mrn_status CHECK (status = ANY (ARRAY['open','checking','done']))`.
No route writes status backwards. There is no reopen.

### After

```
open ──START──► checking ──END──► done ──OTR PUNCH──► closed
 │  (supervisor)          (supervisor)      (billing)
```

**`done` keeps its exact current meaning: the supervisor has finished checking.** Nothing
that works today changes. `closed` is new and means: billing has recorded the OTR number and
the document is finished.

**The 10 existing MRNs stay `done` and are never migrated.** They genuinely never had an OTR
number — marking them closed would be a lie written into the database.

### 3.1 🔴 The gate sweep — the thing most likely to break this

`done` is currently the terminal state, so **every "is this MRN finished" check in the codebase
is written as `status === 'done'`**. The moment `closed` exists, each of those silently starts
excluding closed MRNs.

Known sites from the discovery report — treat this list as a starting point, not as complete:

| Site | Today | Must become |
|---|---|---|
| `app/api/mrn/[mrnId]/export/route.ts:84-95` | 409 unless `done` | `done` **or** `closed` |
| `app/mrn/[mrnId]/sheet/page.tsx:17-28` | same gate | `done` **or** `closed` |
| `components/mrn/lines-table.tsx` DONE_COLUMNS | column set chosen by `status === 'done'` | must include `closed` |
| `components/mrn/detail-pane.tsx:189` | Print / Export shown when done | `done` **or** `closed` |
| `lib/mrn/types.ts` `asMrnStatus()` | throws on unknown value | widen the union first |
| StatusPill | two-state | needs a `closed` pill |

**If the lines-table gate is missed, closing an MRN silently strips Physical, Mfg Date and
Batch No off its own table** — the operator closes the document and watches half of it vanish.
That is the failure this section exists to prevent.

**Method:** grep the whole repo for `"done"` as plain text — not just `status ===`. A default
argument, a prop, a filter object and a SQL string all count. Per the repo's own rule: when a
sweep comes back suspiciously clean, re-run it a second way and reconcile.

### 3.2 Order of operations

1. **SQL first.** `ALTER` the CHECK to allow `closed`. A row can never hold a value the
   constraint forbids, so this must land before any code writes one.
2. **`lib/mrn/types.ts` second.** `asMrnStatus()` throws on an unknown value by design —
   widening the DB without widening the union breaks the board loudly on the first closed row.
3. Then the gates, then the UI.

### 3.3 The punch itself

- **New route**, not the existing header PATCH. `POST /api/mrn/[mrnId]/close`.
- Guards, server-side, in this order: 409 unless `status === 'done'`; 400 unless a non-blank
  OTR number is supplied; permission check.
- Writes: `otrNo`, `status = 'closed'`, `closedAt`, `closedById`.
- **New columns:** `closedAt timestamptz NULL`, `closedById int NULL FK -> users.id`.
- 🔴 **Record the actor.** `header` PATCH and `lines` PUT are MRN's two *unattributed* write
  paths (`code-discovery-2026-08-31-role-census.md:533-535`). A closing step nobody signed is
  worth less than no closing step. This is the reason `close` is its own route rather than a
  relaxation of the header lock.
- 🔴 **Permission: `billing_operator` + `admin` ONLY** (owner, 2026-08-31). `canEdit` alone is
  **not sufficient** — live grants give `canEdit` to `floor_supervisor` and `operations` too,
  which would put a Close button on the supervisor's phone where it has no meaning (he does not
  have the OTR number). The route needs an **explicit role check**, and the UI must hide the
  control on the same rule. Do not gate this on `canEdit`.
- The header stays locked. `close` writes `otrNo` and nothing else; it is not a general unlock.

---

## 4. Photos — the model

### 4.1 One table, not two

The owner chose **both** anchors: the LR photo belongs to the truck, issue photos belong to
lines. That is one table with a nullable line pointer — **not two tables.**

```
mrn_photos
  id             Int        PK autoincrement
  mrnId          Int        NOT NULL  FK -> mrn.id        ON DELETE CASCADE
  lineId         Int        NULL      FK -> mrn_lines.id  ON DELETE CASCADE
                            -- NULL = truck-level. Set = this SKU line.
  kind           text       NOT NULL  CHECK IN ('lr','leaky','damage','other')
  storagePath    text       NOT NULL  UNIQUE -- path inside the bucket, never a URL
  bytes          Int        NOT NULL
  widthPx        Int        NULL
  heightPx       Int        NULL
  capturedById   Int        NOT NULL  FK -> users.id
  createdAt      DateTime   @default(now()) @db.Timestamptz(6)
```

Indexes: `(mrnId)`, `(mrnId, kind)`, `(lineId)`.

**CHECK — `chk_mrn_photo_lr_truck_level`:** `kind <> 'lr' OR "lineId" IS NULL`. An LR is a
document for the whole truck; it can never belong to one SKU line.

- **Never store a URL.** Store the storage path and mint a signed URL on read. A stored URL
  expires and becomes a broken image with no way to recover the object.
- **No `updatedAt`.** A photo is immutable — retake means delete-and-capture, never edit.
- **No caption column in v1.** There is no free-text column anywhere in the three MRN tables
  (`mrn` holds only identifiers and status; `mrn_lines` holds only `skuCode`; `mrn_line_batches`
  holds none). Adding the first one is a separate decision — see §9.

### 4.2 Storage

**New bucket: `mrn-photos`.** Path scheme `mrn/{mrnId}/{kind}/{uuid}.jpg`.

🔴 **A separate bucket is the point, not a detail.** The live retention cron
(`app/api/cron/attendance-purge/route.ts:67-69`) scans `attendance_records` and calls
`.remove()`. Putting MRN photos in `attendance-photos` under a prefix would leave them
un-purged today and delete-able by tomorrow's well-meaning edit to that cron. An MRN is a
supplier-facing document; a selfie is not. Different lifetimes, different buckets.

**Everything else is copied from attendance, which is proven in production:**

| Need | Copy from |
|---|---|
| Server-side Supabase client | `lib/supabase.ts` `getSupabaseAdmin()` — lazy singleton, **server-only**, throws a named error if env is missing |
| Upload | `app/api/attendance/check-in/route.ts:136-142` |
| Signed read | `app/api/admin/attendance/photo/route.ts:44` — `createSignedUrl`, 300s |
| Rendering | `components/admin/attendance/photo-viewer.tsx:70-75` |

⚠ **Use a plain `<img>`, never `next/image`.** `next.config.mjs` has **no `images` key at all**,
and that is deliberate — `next/image` would require whitelisting a host per signed URL. Do not
add `remotePatterns`.

Env is already configured: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present and
listed in CORE §4 as set on Vercel. There is deliberately **no** `NEXT_PUBLIC_SUPABASE_*` anon
key — `lib/supabase.ts:3-6` says it must never be imported client-side. Honour that.

### 4.3 Size and compression

- **Client-side downscale before upload, always.** `lib/attendance/photo.ts`
  `captureFromVideo(videoEl, maxWidth, jpegQuality)` is generic — no attendance coupling —
  and returns `{ blob, dataUrl, widthPx, heightPx }`. Import it as-is.
- **MRN's own constants, in `lib/mrn/photo.ts`:** `MAX_WIDTH = 1600`, `JPEG_QUALITY = 0.8`,
  `MAX_PHOTO_BYTES = 800_000`.
- 🔴 **Do NOT read `attendance_settings`.** Attendance's sizes are server-configured for
  attendance. One owner per behaviour — a damage photo needs more detail than a selfie and must
  not change when someone tunes the attendance settings.
- 800KB is ~5.6× under Vercel's ~4.5MB serverless body limit. Attendance's live max is 120KB at
  500KB cap, so 800KB carries real headroom for detail.

### 4.4 Retention — none. Photos are kept until someone deletes them

**No automatic deletion** (owner, reversed 2026-08-31, having first chosen 90 days).

- 🔴 **Build NO cron.** There is no `mrn-photo-purge` route, no `vercel.json` entry, no
  retention constant. A future session finding "90 days" in an older copy of this draft is
  reading a reversed decision.
- 🔴 **Do NOT widen `app/api/cron/attendance-purge/route.ts`** to see this bucket. It scans
  `attendance_records`; it must keep scanning only that. This is the reason `mrn-photos` is its
  own bucket even with no purge of its own — the separation is what makes a future retention
  policy safe to add.
- **Deletion is manual**, through the delete path in §5.4: a `canDelete` holder
  (`billing_operator`, `admin`) removes a photo when it is genuinely no longer wanted. That path
  is being built anyway, so "manually delete if required" needs no extra work.
- **Consequence, accepted:** storage grows without bound. At ~200KB a photo and 10 MRNs a week
  this is negligible for a long time, but nothing reclaims it. Revisit when the bucket gets
  large enough to notice — a ROADMAP item, not a v1 gap.

### 4.5 Write order — no transaction spans storage and Postgres

`prisma.$transaction` is banned (CORE §3), and it could not help here anyway — Supabase Storage
is not in the database.

1. Upload the object to the bucket.
2. Insert the `mrn_photos` row.
3. **If step 2 throws, delete the object** (compensating delete) before returning the error.

Skipping step 3 leaks orphaned objects that nothing will ever find or bill you correctly for.

---

## 5. Capture — the supervisor's phone

The supervisor face is `components/mrn/supervisor-board.tsx`, inside `MobileShell`, chosen by
`app/mrn/page.tsx:69` on `primaryRole === "floor_supervisor"` — **a role branch, never a
viewport branch.** It runs inside the installed PWA (`public/manifest.json`, scope `/`).

⚠ **No offline capture.** `public/sw.js` handles push and notificationclick only and has **no
fetch handler**, by hard rule. A photo cannot be queued for later upload. If the phone has no
signal, capture fails and must say so plainly rather than appearing to succeed.

### 5.1 The camera component

`components/attendance/camera-view.tsx` already does all of it: `getUserMedia` (:49-55),
`isSecureContext` guard (:44), track cleanup (:86-93), capture button, permission-denied
fallback (:112-127).

**It is hard-wired to `facingMode: "user"` at :51.** A damaged-tin photo needs the rear camera.

- Add a `facingMode` prop, **defaulting to `"user"`** so attendance's behaviour is
  byte-identical. MRN passes `"environment"`.
- 🔴 This edits a live attendance component. The default is what protects it — verify the
  attendance flow after the change, since a broken selfie camera means nobody can clock in.
- `next.config.mjs` already ships `Permissions-Policy: camera=(self)`. No header change needed.

### 5.2 LR photo — at END UNLOADING

`END UNLOADING` is already the single explicit moment everything lands in billing
(`end/route.ts:26-30`), and it is already guarded server-side by `uncheckedCount === 0`
(:96, :110) because the phone's copy can be stale.

- Tapping END opens a sheet: *"LR photo"*, camera, review, confirm.
- **OPTIONAL** (owner, reversed 2026-08-31, having first chosen mandatory). A **Skip** button
  sits beside the camera. END proceeds either way.
- 🔴 **`/end` gets NO new guard.** Its two existing server-side checks (`status === 'checking'`,
  `uncheckedCount === 0`) are unchanged. Do not add a third. A future session finding
  "mandatory" in an older copy of this draft is reading a reversed decision.
- **If a photo IS taken, it uploads before `/end` is called.** A failed upload stops that END
  attempt and says why — an MRN must never reach `done` believing it holds an LR it does not.
  Skipping and failing are different outcomes and must read differently on screen.
- **Show the absence on the billing side.** The photo band makes it obvious when an MRN has no
  LR — that is the whole enforcement mechanism now, and it is the reason the band is worth
  building before anyone asks for a hard rule.

### 5.3 Issue photos — on the line

`components/mrn/line-sheet.tsx` (977 lines) is where the supervisor types physical quantity and
the condition counts. A small camera button goes on each line, beside those inputs.

- Tapping it asks for the kind: **Leaky · Damage · Other**, then opens the camera.
- **Always enabled** — never gated on a condition quantity being non-zero. Making him fill a
  number before he can photograph what he is looking at inverts the actual sequence.
- Multiple photos per line allowed. No cap in v1.

> **A finding the owner should weigh.** Across all 10 completed MRNs and 344 lines, the
> condition columns have been filled on **4 lines total** (SND 4, Leaky 3, Damage 3, Empty 1,
> REJ 1, QTD **0**). `Short` and `Excess` are zero on every line ever recorded — physical has
> always exactly equalled STI. Either the depot receives genuinely clean trucks, or those boxes
> are not being used. If it is the second, the camera button will get used far more than the
> number boxes ever have, and that is fine — but it is worth knowing which is true before
> reading anything into a quiet photo panel.

### 5.4 Delete / retake

- The supervisor may delete a photo he captured **while `status = 'checking'`**.
- Once the MRN is `done`, photos are immutable to everyone except a `canDelete` holder
  (`billing_operator`, `admin`).
- Delete removes the storage object **and** the row. Row first, then object: an orphaned object
  is a cost; an orphaned row is a broken image on a supplier-facing screen.

---

## 6. Billing — where the photos appear

`components/mrn/detail-pane.tsx` is deliberately flat: a header block, then the scroll box
holding `<LinesTable />`. Two written-in reversals constrain any new block:

- `header-card.tsx` was **deleted** (:25-28) — *"Do not reintroduce a second header."*
- The Facts row rule (:298-300): *"a fact disappears only when it cannot exist yet"* — it
  explicitly supersedes a mockup that hid OTR in some states.

### 6.1 The photo band

- Insert as a **sibling band between the header block's closing `</div>` and the scroll box at
  :415** — full width, `border-b`, pinned above the scrolling table.
- **The band hides entirely when the MRN has no photos.** It is not a Fact, so the facts-row
  rule does not apply to it and it does not need to render an empty state. Adding a photo count
  to the Facts row *would* inherit that rule and force a permanent "0 photos" — don't.
- Grouped: **LR** first, then **By line**, each line's thumbnails under its line number and SKU.
- Thumbnails are `<img>` on signed URLs, fetched one list call at a time — not one request per
  photo.

### 6.2 Lightbox

Click a thumbnail → full-size overlay. **Copy `LineDrawer`'s `fixed inset-0` pattern** — it
already escapes the pane's `overflow-auto` subtree and is the precedent in this exact file.

There is **no gallery or lightbox anywhere in this app today**; `photo-viewer.tsx` is a single
`<img>`. This is new UI, so keep it to what the job needs: image, kind, line, who captured it,
when, and two actions.

### 6.3 Getting a photo into an email

The owner's requirement is: *open, check, copy, attach to mail.* Two controls, no extra
machinery:

- **Open in new tab** — a signed URL in a plain tab gives the operator right-click → *Copy
  image*, which pastes straight into Outlook.
- **Download** — a plain `<a download>`, the same shape as the XLS export link at
  `detail-pane.tsx:251`.

**No zip in v1.** A "download all" needs a new dependency or a server-side archive route to
save perhaps three clicks. If billing asks for it after living with this, build it then.

---

## 7. Permissions

**No new page key.** Reuse `mrn`. Live grants (verified by SELECT, not seed):

| role | canView | canEdit | canExport | canDelete |
|---|---|---|---|---|
| `billing_operator` | ✓ | ✓ | ✓ | ✓ |
| `floor_supervisor` | ✓ | ✓ | ✗ | ✗ |
| `operations` | ✓ | ✓ | ✓ | ✗ |

Mapping:

| Action | Requires |
|---|---|
| Capture a photo | `canEdit` |
| View / open / download | `canView` |
| Delete after `done` | `canDelete` |
| **Punch the OTR and close** | 🔴 **`billing_operator` or `admin` — an explicit role check, NOT `canEdit`** (§3.3) |

🔴 **SEED IS NOT LIVE.** No grant change is needed here, but if one is ever added it goes into
`prisma/seed.ts` **and** live `role_permissions`, with the surviving rows SELECTed and labelled
in the same block.

---

## 8. Landmines

- 🔴 **Every `status === 'done'` in the repo is now wrong-by-omission.** §3.1. This is the one
  that breaks working screens.
- 🔴 **`asMrnStatus()` throws on unknown values.** Widen the TS union in the same change as the
  SQL CHECK, or the first closed row takes the board down.
- 🔴 **Never store a signed URL.** Store the path; mint on read.
- 🔴 **`attendance-photos` is not our bucket.** Its purge cron would not protect our files and a
  future edit to it could delete them.
- 🔴 **`lib/supabase.ts` is server-only** and there is no anon key by design. Any accidental
  client import is a security bug, not a build error.
- **`camera-view.tsx` is shared with attendance.** Default the new prop to `"user"`; re-test
  clock-in after touching it.
- **No offline.** `sw.js` has no fetch handler. Capture requires signal.
- 🔴 **Closing is NOT `canEdit`.** Three roles hold `canEdit` on `mrn`. The close route and its
  button both need an explicit `billing_operator`/`admin` check.
- 🔴 **No purge cron, and the LR is optional.** Both were decided the other way earlier the same
  day and reversed (§4.4, §5.2). An older copy of this draft says "90 days" and "mandatory" —
  it is stale. Do not build either.
- **`/end` keeps exactly two guards.** Adding a third for the LR photo is the reversed decision.
- **`next/image` is deliberately unused.** Do not add `images.remotePatterns`.
- **The XLS import accepts 10MB** (`route.ts:1456`) — over the serverless limit. It is a desktop
  path nobody has hit, not a workaround to copy. Photos cap at 800KB, client-compressed.
- **Do not reintroduce a second header** in `detail-pane.tsx`.

---

## 9. Decisions — all settled 2026-08-31

Nothing in this draft is waiting on an answer. Recorded so a future session does not reopen
them as if they were open.

| # | Question | Ruling |
|---|---|---|
| 9.1 | Who may close? | **`billing_operator` + `admin` only.** Explicit role check, not `canEdit` (§3.3, §7) |
| 9.2 | Is the LR photo mandatory at END? | **Optional.** Skip button; `/end` gets no new guard. *(First ruled mandatory, reversed the same day.)* (§5.2) |
| 9.3 | Retention | **None.** No cron. Manual delete via the `canDelete` path when required. *(First ruled 90 days, reversed the same day.)* (§4.4) |
| 9.4 | Caption / damage note | **No.** Photos alone. Kind + line + who + when is the whole record (§4.1) |
| 9.5 | A tab for closed MRNs? | **No.** Closed sits in the same list as done; no new tab or filter |

**Also settled:** `done` keeps its meaning and `closed` is added after it (§3) · existing 10
MRNs are not migrated (§3) · one photo table with a nullable `lineId` (§4.1) · new `mrn-photos`
bucket (§4.2) · MRN's own size constants, not `attendance_settings` (§4.3) · a second purge
cron, never a widened attendance one (§4.4) · compensating delete on failed insert (§4.5) ·
`facingMode` prop defaulting to `"user"` (§5.1) · LR uploads before `/end` is called (§5.2) ·
camera button never gated on a condition qty (§5.3) · band hides when empty and is not a Fact
(§6.1) · no zip (§6.3) · no new page key (§7).

### 9.1 Parked — not in v1, not decided against

- **Admin override when the LR photo cannot be taken** (dead camera, no signal). The
  consequence is accepted for now; if it bites on the floor the answer is an admin override,
  never a skip button. ROADMAP.
- **Zip download of all photos** (§6.3). Build it only if billing asks after living without it.
- **Whether the condition columns are actually used** (§5.3). A business question, not a build
  one — 4 lines in 344 carry any value. Worth asking the floor before reading anything into a
  quiet photo panel.

---

## 10. Build plan

```
[x] 0. Discovery                              — done, see the Step-1 report
[ ] 1. SQL — status CHECK, mrn_photos, closedAt/closedById, indexes
[ ] 2. schema.prisma hand-edit + npx prisma generate
[ ] 3. The 'closed' gate sweep — types, every status === 'done', StatusPill
[ ] 4. Bucket + upload/list/signed-url/delete routes + lib/mrn/photo.ts
[ ] 5. Supervisor: facingMode prop, LR at END (skippable), per-line camera
[ ] 6. Billing: photo band + lightbox + open/download/delete
[ ] 7. Close route (billing+admin only) + the OTR punch UI
[ ] 8. Router row + MRN canonical file + smoke test + commit
```

**Steps 1–3 ship together or not at all.** A widened CHECK with an un-swept codebase is worse
than neither.

**Step 3 is a gate, not a feature.** It runs, reports every site it found, and **stops** before
anything is written. Per the repo's own rule: a wrong claim usually sits in more than one file.

**Step 4** — the bucket is created by hand in the Supabase dashboard, not by code. Say so in
the prompt so Claude Code does not invent a migration for it.

**Verification.** Claude Code has no login. It cannot test a supervisor's camera, a billing
operator's close, or a role's landing page. Those are hand-tests by Smart Flow. Never accept a
claimed login test.

---

## 11. What this draft does NOT cover

- Any change to the XLS export or the A4 print sheet. Photos do not appear on either.
- Any change to the desktop lines table beyond the `closed` gate fix.
- Stock adjustment, SAP write-back, or anything touching `orders`.
- An offline capture queue. `sw.js` has no fetch handler, by hard rule.
- Any change to the attendance module beyond one defaulted `facingMode` prop.
- **A purge cron.** None is built. Deletion is manual (§4.4).
- **Any new guard on `/end`.** The LR photo is optional (§5.2).
