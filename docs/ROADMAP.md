# ROADMAP.md — OrbitOMS Planned Work
# Updated 2026-09-19 (canon sweep batch C — every item re-checked against code at `b574cecc` and the live results of 2026-09-18; see "Change log — canon sweep pass 2026-09-19" at the foot for what closed, re-scoped and opened. New section `## Opened by the 2026-09-18 canon sweep`, led by a 🔴 P0 credential file) · Prior: 2026-09-06 (tint + master-data access conversion — `## User-based access` gains six new items and closes one that was stale within hours: the "every tint GET still gates on a job title" bullet was overtaken by `fbbe30bd` the same day. New: 🔴 P0 `prisma/seed.ts` has never heard of `user_page_access`, so a wipe-and-reseed leaves live access EMPTY and looks like it succeeded; 🔴 P1 the SILENT-403 pattern as ONE systemic issue — `fetchAll` returns `[]` on any failure and `requireRole` fails with a 307 into an HTML page that arrives 200, which produced three separate silent failures in one week; 🔴 P1 `requireRole` has no admin arm, and the fix is NOT to add one; P1 the two unswept bypasses, which are not the same kind — `mrn/photo:167-168` is harmless, `reports/tint-summary:33` is a multi-clause GRANT that still admits Operations User to a report every other tint endpoint refuses him; P2 retire the four `/dispatcher/*` screens, reachable by nobody including all three holders of the `dispatcher` role, which also collapses `ROLE_HREF_OVERRIDES` for master data; P2 `sub-areas` CREATE now looser than its own EDIT, a parked decision whose fix is to bring PATCH and import forward; P3 the router has no `/admin/access` row; and `operator/skip`, ownership-scoped by design, recorded so nobody "fixes" it into a tick. The board-rebuild P0 QA block gains manual tint entry, whose button is **"Add to Tint"** — the rebuild renamed it, which is why the flow went untested. Record: `code-update-2026-09-06-tint-and-master-data.md`) · Prior: 2026-09-06 (Tint Manager board rebuild — new `## Tint Manager board rebuild` section: a P0 QA block for the five flows that shipped without ever being click-tested, the 8 old-Kanban capabilities with no home in the new design (the per-row StatusPopover is the significant one, and Create Split's removal means new splits cannot be created anywhere), the two cancel routes still on `prisma.$transaction`, and the Floor-vs-UI§27 row-height disagreement between two canon files) · Prior: 2026-09-04 (user-based access — new `## User-based access` section: step 6/7/8, the 13 unwired audit routes, the stale NA_IMPORT duplicate, and backfill-customers' missing maxDuration; all counts derived from the tree, not the plan) · Prior: 2026-09-03 (CI module inventory — new `## CI — Goods Return Note` section, 13 items incl. the 32-string SAP reason list; the module shipped 2026-08-31→09-03 and had no ROADMAP entry) · Prior: 2026-08-09 (articleTag rule shipped — 2 new Import items, ZINR item superseded; Picking Stage 3 closed — findings shipped) · 2026-08-05 (full item-by-item status pass, reconciliation cycle) · Lives in: orbit-oms/docs/ (manual attach — NOT auto-loaded)

Attach this file when planning the next phase of any module. Live "what's next" list, separated from canonical docs.

Items grouped by module. Within each module: SHIPPED → P0 (blocking) → P1 (next up) → P2+ (later).

---

## Opened by the 2026-09-18 canon sweep

Found while reconciling every canon file to code at `ec6343ba`/`b574cecc` and the live SELECTs of
2026-09-18 (`docs/prompts/drafts/sql-2026-09-18-canon-sweep-live-results.csv`, cited as "live Qnn").
Each line names the canon file that describes it; read the detail there, not here. **Nothing below
is fixed.** Source report: `docs/prompts/drafts/code-discovery-2026-09-18-canon-sweep.md` §4 and §8.

### 🔴 P0 — Security: a production DB password in a synced, un-ignored file

- [ ] A 2026-09-08 draft (`docs/prompts/archive/2026-09/code-discovery-2026-09-08-trip-mirror.md:181-182`, `:521-522`)
      records that `-Dhruv.env` holds a **plaintext production DB password**. On 2026-09-19
      `docs/dhruv-review/` is no longer on disk, but its twin is:
      `docs/_backup_2026-08-04/dhruv-review/-Dhruv.env` (and `.env-Dhruv.local` beside it) —
      **untracked and NOT git-ignored** (`git check-ignore` returns nothing; `.gitignore` covers only
      `.env*` names at their usual spelling), inside a OneDrive-synced folder. One `git add .` commits
      it; OneDrive already syncs it. **Action: rotate the DB password first** (it has left the machine
      whatever happens to the file), then move both files out of the repo, then add an ignore rule.
      The file was deliberately not opened by this pass.

### Floor / trips — `CLAUDE_FLOOR.md`, `CLAUDE_FLOOR_TRIPS.md`

- [ ] **Undo-add reads the wrong response shape.** `GET /api/floor/trips/[id]` returns `{ trip }`
      (`[id]/route.ts:48`); `floor-page.tsx` `undoAdd` (`:573`) and the add receipt (`:708`) cast the
      body itself as `TripDetail`, so Undo always fails into its catch. `CLAUDE_FLOOR_TRIPS.md §17`
      open item 13.
- [ ] **The tint lock never fires.** `tintLocked` requires `source === "rail"`
      (`components/floor/detail-panel.tsx:414`), a source nothing opens since the rail retired; a
      tint-room bill opened from the board shows Hold and Cancel enabled, and `POST /api/floor/actions`
      has no tint guard. `CLAUDE_FLOOR.md §4.7`, §10b.
- [ ] **Release is unreachable from the board.** It renders for `source === "rail" || "hold"` only
      (`detail-panel.tsx:583`), so a `pending_support` row (e.g. a restored bill) has no Release on the
      desk unless it is held first. `CLAUDE_FLOOR.md §4.2`, §10b.
- [ ] **False tooltip.** The `no slot` chip says "putting this bill on a trip gives it one"
      (`components/floor/floor-table.tsx:693`); no trip route writes a bill's slot
      (`CLAUDE_FLOOR_TRIPS.md §13`). `CLAUDE_FLOOR.md §10b`.
- [ ] **Who is writing `workflowStage = 'dispatched'`?** No reachable in-repo writer since
      2026-09-15; live count 7,330 (Q09). Investigation, not a fix. `CLAUDE_FLOOR_TRIPS.md §14`, §17
      open item 1 (and the "NO AUTOMATIC DRAIN" item under Consolidation 2026-07-16 → Picking).

### Access — `CLAUDE_CORE.md §5`, `§7.14`, and each module's permissions section

- [ ] `GET /api/warehouse/pickers` still checks job titles —
      `requireRole([FLOOR_SUPERVISOR, ADMIN, OPERATIONS])` (`app/api/warehouse/pickers/route.ts:49`).
      `CLAUDE_PICKING.md §4`.
- [ ] **Remove OBD** is drawn by job title (`canRemoveObd`, `components/tint/tint-manager-content.tsx:93-98`:
      primary `admin` or `tint_manager` in roles) but the route gates on the `tint_manager` canEdit
      tick — so Prakash (`operation_manager`, tick holder) is allowed by the server and shown no
      button. `CLAUDE_TINT.md §8`.
- [ ] **MRN close is role-only** — `hasRole(session, CLOSE_ROLES)` with
      `[BILLING_OPERATOR, ADMIN]` (`app/api/mrn/[mrnId]/close/route.ts:75`), no tick. Deliberate
      (`CLAUDE_MRN.md §3`), but it sits outside per-user access; decide whether it becomes a tick of
      its own.
- [ ] The **Import OBDs** sidebar link shows on `import_obd` canView (`lib/permissions.ts:43`) but
      the page and route need the import tick, so a view-only holder sees a link that redirects to
      `/unauthorized`. `CLAUDE_IMPORT.md §9.1`.
- [ ] `backfill-enrich`: the POST's HMAC path is unreachable — middleware lets only
      `/api/mail-orders/ingest` through on a signature (`middleware.ts:60`), so a sessionless
      machine call never reaches `verifyHmac`; and the GET's `requireRole([ADMIN])` (`route.ts:169`)
      refuses a superuser-flag-only user (no admin arm, User-based access → P1). Fold into the
      retire-or-keep item in "Mail Orders cleanup". `CLAUDE_MAIL_ORDERS.md §7`, §22.

### Tint — `CLAUDE_TINT.md`

- [ ] **Base bypass Undo refuses most bypasses since the completion-slot change.** Guard 4 refuses
      any non-null `dispatchSlotSource` (`base-bypass/undo/route.ts:140-149`), and the bypass writes
      `"auto"` on every bill the engine slots (`resolveCompletionSlot`, `lib/dispatch/completion-slot.ts`);
      a successful Undo also leaves `dispatchTargetDate` / `dispatchWindowId` in place.
      `CLAUDE_TINT.md §1.12`.
- [ ] **Live oddity — `reports_tint_summary` is held by Operations User (#20) alone** (live Q03b,
      canView 1 of 3 rows), while `reports_ti_report` is held by Chandresh, Deepanshu and Prakash.
      Check whether the tint team was meant to hold both. `CLAUDE_TINT.md §12`, §13.1.

### Import — `CLAUDE_IMPORT.md`

- [ ] Manual SAP (.xlsx) and paste still create **tint bills with no arrival slot** — `createPath`
      keeps the tint guard (`lib/import-upsert.ts:160`). `CLAUDE_IMPORT.md §12`.
- [ ] Auto-imported bills get **no batch code** (`Build-LineRow` always sends `batch_code` null),
      **no line weights** and **no `itemCategory`** (`app/api/import/obd/route.ts:3585-3606`).
      Weights are the existing P1 "Line weights are not populated" item under Import Pipeline.
      `CLAUDE_IMPORT.md §10.1`.
- [ ] **Defect B** — header totals are never recomputed on the patch path; the rebuild trigger in
      `lib/import-upsert/effects.ts` (`query-summary-rebuild`, `:74`) is wired but never fires because
      `patchHeader` emits none of its fields. Gated on the nineteen short/zero-line bills (Import
      Pipeline → 🔴 P1). `CLAUDE_IMPORT.md §15`.

### Billing / Mail Orders — `CLAUDE_BILLING.md`, `CLAUDE_MAIL_ORDERS.md`

- [ ] A person **without the `billing_hold` tick sees no hold signal at all** on the Billing face:
      the Hold button is hidden, and the ship card drops status chips at the call site
      (`review-view.tsx:1505-1507`). `CLAUDE_MAIL_ORDERS.md §23.2`, `CLAUDE_BILLING.md §5`.
- [ ] The dead **"E · Slot email"** shortcut label — `MO_SHORTCUTS` in `mail-orders-page.tsx:99`
      advertises a key removed in `c103d5f4`. `CLAUDE_BILLING.md §11`, `CLAUDE_MAIL_ORDERS.md §10`.

### Attendance — `CLAUDE_ATTENDANCE.md`

- [ ] `/api/attendance/check-in` and `check-out` **never verify consent** — session only; the consent
      redirect is page-level. `CLAUDE_ATTENDANCE.md §4`.
- [ ] The purge cron selects by `createdAt` (`app/api/cron/attendance-purge/route.ts:54`), not the
      date in the photo path. `CLAUDE_ATTENDANCE.md §11`, §15.
- [ ] The rollover cron writes `ABSENT` on Sundays and while `rolloutStage` is OFF — its only filter
      is `isActive` + `attendanceExempt`. `CLAUDE_ATTENDANCE.md §17` (pairs with the Holidays item
      under Attendance + OT).

### Sampling Library — `CLAUDE_SAMPLING_LIBRARY.md`

- [ ] Edit / Deactivate / Mark-for-review are `console.log` stubs; no client calls any of the four
      write routes. `CLAUDE_SAMPLING_LIBRARY.md §4` item 8, §5.
- [ ] `PATCH /api/sampling-library/[samplingNo]` accepts a `siteId` (`route.ts:92-95`) that the
      route table does not list. `CLAUDE_SAMPLING_LIBRARY.md §5`.

### Place Order — `CLAUDE_PLACE_ORDER.md`

- [ ] `/api/order/data` is public and returns customer names and codes — **already tracked** as the
      `/po2` P0 below; `CLAUDE_PLACE_ORDER.md §16` records it too.
- [ ] `GET /api/place-order/last-order/[customerCode]` has **no auth of its own** — middleware's
      session check is its only gate. `CLAUDE_PLACE_ORDER.md §20`.

### MRN — `CLAUDE_MRN.md`

- [ ] The deferred `DROP DEFAULT` on `mrn_lines."deliveryNo"` was never run — the live default is
      still `''` (live Q06a). Run that one ALTER alone, never the whole file. `CLAUDE_MRN.md §12`.

### UI — `CLAUDE_UI.md`

- [ ] `@page mo-landscape` is **nested inside `@media print`** (`app/globals.css:630`), against router
      rule §1 (`@page` top-level only). Whether Billing still prints A4 landscape needs a real print
      (verification question below). `CLAUDE_UI.md` "Review View — layout" → Print;
      `CLAUDE_BILLING.md §11`.

### Clean-up — stale code comments (one pass, code only)

Comments that state something false about the code. None changes behaviour; each has been believed by
a later session before. One code-comment pass, not a doc batch. Anchors re-checked 2026-09-19.

- `lib/permissions.ts` — `:39` ("/planning and /warehouse … stay live"); `:127` ("richer split
  view" — the retired Support copies); `:258`, `:284`, `:429` ("nothing reads it yet" / "checks …
  do not exist yet" — all read now, `CLAUDE_BILLING.md §11`); `:300-303` (`ci` "not in PAGE_NAV_MAP
  yet").
- `app/ci/page.tsx:57-62` ("NOT IN THE SIDEBAR YET") — `CLAUDE_CI.md §15`.
- `prisma/schema.prisma:1211` (`app_settings` "NOTHING CONSUMES THIS YET") — `CLAUDE_FLOOR_TRIPS.md §15`.
- `middleware.ts:20` ("the check at line 26" — it is `:36`).
- `lib/floor/queries.ts` — `:6-14`, `:151-153`, `:622`, `:704`, `:844`, `:1172` (rail / `getFloorRail`
  / assign-bar); `lib/floor/release.ts:5`; `lib/floor/hold-log.ts:27-28` (a "clear-hold" action that
  does not exist); `lib/floor/use-floor-rail-poll.ts:3-5`; `app/api/floor/actions/route.ts:10`,
  `:159-161` — `CLAUDE_FLOOR.md §10b`.
- `components/floor/floor-page.tsx:9-14`, `:878-886`; `floor-table.tsx:3-10`, `:34-35`, `:687-688`;
  `detail-panel.tsx:391-409` (points at the deleted `rail-card.tsx`) — `CLAUDE_FLOOR.md §10b`.
- Trips — `app/api/floor/trips/[id]/confirm/route.ts:38-39`; `lib/trips/queries.ts:151`;
  `lib/floor/dispatch.ts:6`, `:18` and `lib/workflow-stages.ts:98` (conflicting `dispatched` counts,
  4,137 vs 7,067 — live is 7,330); `app/api/floor/pick-gate/route.ts:40-41` —
  `CLAUDE_FLOOR_TRIPS.md §15`.
- `lib/billing/flag.ts:18-20` (describes `TEST_USERS_ONLY` as live; live is `ALL_USERS`, Q01) —
  `CLAUDE_BILLING.md §11`.
- `app/api/mrn/[mrnId]/export/route.ts:21-22`; `components/mrn/photos-button.tsx:132-140` —
  `CLAUDE_MRN.md §12`.
- `app/api/tint/operator/split/done/route.ts:175-176` (un-preset bill "lands in pending_support",
  stale since `b3dfe5b8`); `app/api/tint/manager/base-bypass/undo/route.ts:19` (bypass "writes
  pending_support") — `CLAUDE_TINT.md §2`, §1.12.
- `components/picking/picking-mobile-shell.tsx:228`, `:232` ("Admin-only", "one-teal rule");
  `public/sw.js:10` ("three picking surfaces"); `lib/picking/queue.ts:462`, `:571`, `:904` (cite the
  retired `CLAUDE_SUPPORT.md`) — `CLAUDE_NOTIFICATIONS.md §9`, `CLAUDE_PICKING.md`.
- `lib/place-order/saved-drafts.ts:1-2` and `sent-orders.ts:1-2` ("feature-flagged behind
  ?draft=on") — `CLAUDE_PLACE_ORDER.md §25`.
- `app/po2/*` — eleven rows, `CLAUDE_PO2.md §13` (includes the three under `/po2` → P2 below).
- `components/admin/admin-sidebar.tsx:65-66` ("switcher … not built"); `tailwind.config.ts:54` ("NOTHING reads these yet");
  `app/(admin)/admin/roles/page.tsx:14` ("7 system roles" — live `role_master` has 13, Q07a).

### Decision — orphan files with no importer (keep or cut is the owner's call)

Zero importers at HEAD (grep of `app`, `components`, `lib`, 2026-09-19; comment mentions only). Kept per
the no-delete rule. **Do not delete anything on this item's say-so** — each needs an explicit owner
instruction and `archive/RETIREMENT-PLAYBOOK.md`.

- `components/floor/assign-bar.tsx`, `assign-context-banner.tsx`, `trip-selection-bar.tsx`;
  `lib/floor/suggest.ts` (used only by the scratch `scripts/_floor-suggest-check.ts`) —
  `CLAUDE_FLOOR.md §8`, §10b.
- `app/(mail-orders)/mail-orders/slot-completion-modal.tsx`, `components/mail-orders/so-email-panel.tsx`
  — `CLAUDE_MAIL_ORDERS.md §13`, §14.
- `lib/mail-orders/enrich-v2.ts` (also in "Five pre-existing unused files" below);
  `lib/mail-orders/taxonomy-mapping.ts` (script-only: four `scripts/` importers, no app importer).
- `components/tint/tint-table-view.tsx`, `components/tint/split-builder-modal.tsx` (listed "RETIRED,
  NOT DELETED" at `tint-manager-content.tsx:24-30`) — `CLAUDE_TINT.md §1.11`.
- `fetchSlotCutoffs` (`lib/mail-orders/api.ts:132`) and its only target
  `app/api/system-config/slot-cutoffs/route.ts` — no caller since `c103d5f4`.

### Owner decisions pending (sweep §8 Q13)

- [ ] May pickers reach `/api/picking/tint-workload` (gated `picking` canView today)?
      `CLAUDE_PICKING.md §5.6`.
- [ ] Keep, cut or document the Floor board's `waitingSkus` / `oilSkus` payload — computed by
      `getFloorBoard`, read by no Floor component. `CLAUDE_FLOOR.md §10b`.
- [ ] Add the 6 missing role slugs to `RoleSidebarRole`? `CLAUDE_CORE.md §5`.
- [ ] The SMU gate for Offtake / Projects / Distributor under import auto-release.
      `CLAUDE_IMPORT.md §2.1`.
- [ ] Defect B — the narrowed recompute, and when (Import above). `CLAUDE_IMPORT.md §15`.

### Verification questions — need logs or a machine, not code

- [ ] Which PowerShell script does the import PC actually run, `Auto-Import-v2.ps1` or `-v3.ps1`?
      (Import Pipeline → "Canon is stale on the auto-import cadence"; `CLAUDE_IMPORT.md §10`.)
- [ ] Does anything external call `/api/tint/operator/shades` (POST, PUT)? Vercel logs. Decides the
      retire-or-convert item under User-based access.
- [ ] Does Billing still print A4 landscape with `@page mo-landscape` nested? A real print from the
      Billing screen. `CLAUDE_BILLING.md §11`.
- [ ] Which machine runs the live NTS puller? Blocks trip-mirror Phase B and every `.ps1` change.
      `CLAUDE_TRIP_REPORT.md §2.3`, §7.

---

## User-based access

Shipped 2026-09-04 in eight commits (`c3cf726b` → `b915c88e`). Access now comes from
`user_page_access`; a job title is a label and a starting template. Record:
`docs/prompts/archive/2026-09/code-update-2026-09-04-user-based-access.md`. Model: `CLAUDE_CORE.md §5`.

**Step 6 continued 2026-09-06 in seven commits** (`cd0ed055` → `fbbe30bd`, all pushed): Tint
converted (37 of its 41 handlers now gate on a tick), the master-data routes converted, and the 57
redundant admin bypasses removed. Record:
`docs/prompts/archive/2026-09/code-update-2026-09-06-tint-and-master-data.md`. Gates:
`code-discovery-2026-09-06-tint-conversion-gate.md` ·
`code-discovery-2026-09-06-master-data-gate.md`. Canon: `CLAUDE_TINT.md §13`, `CLAUDE_CORE.md §5`/`§13`.

**All counts below were derived from the tree, not carried over from a plan or a brief** — on
2026-09-04 for the items that predate it, and re-derived 2026-09-06 for everything the seven commits
touched. Where a bullet was already stale by the time it was read, it says so rather than being
quietly rewritten.

### P0 — 🔴 `prisma/seed.ts` has never heard of `user_page_access`

- [ ] **A wipe-and-reseed would rebuild the fallback and leave LIVE ACCESS EMPTY.** Verified by grep
      2026-09-06: **zero hits** for `user_page_access` or `isSuperuser` in `prisma/seed.ts`. It
      still seeds `role_permissions` — the table nothing reads — and nothing else. Under
      `ACCESS_SOURCE = 'user'` that means every non-superuser resolves all-false: the app comes back
      up with nobody able to do anything, **and the seed will look like it succeeded.** Same
      seed-is-not-live trap as the `dispatcher`/`support` drift (`CLAUDE_CORE.md §5`), one layer
      more dangerous because the *authoritative* table is the one seed has never heard of. Either
      teach seed the new table or make it fail loudly.

### P1 — Step 6: the rest of the role checks

- [ ] **19 `requireRole` calls whose array names roles beyond ADMIN.** Re-counted 2026-09-19:
      `grep -rn "requireRole(" app lib components` (excluding the definition in `lib/rbac.ts`) finds
      23 hits, of which 3 are comments (`app/api/floor/trips/options/route.ts:19`,
      `app/api/orders/[id]/audit-history/route.ts:19`, `app/api/tint/manager/manual-entry/lookup/route.ts:33`),
      so **20 real call sites**. One is `[ADMIN]` alone (`app/api/mail-orders/backfill-enrich/route.ts:169`);
      the other **19** name a role beyond ADMIN. The largest shape is now 4×
      `[ADMIN, DISPATCHER, SUPPORT, TINT_MANAGER, TINT_OPERATOR, FLOOR_SUPERVISOR]` (contact-roles,
      delivery-types, sales-officers, so-groups); the old 4-role tint shape survives once
      (`app/(tint)/tint/manager/ti-report/page.tsx:9`). All 20 include ADMIN. Each is a PERMISSION
      question — "may this person" — which is what a tick already answers.
- [x] ~~**22 inline `session.user.role !== "admin"` BYPASS sites**~~ **DONE 2026-09-06 — and there
      were 57, not 22.** All one-clause wrappers removed; the check they wrapped now runs
      unconditionally. Provably behaviour-neutral: the resolvers test the same value on their own
      first line. ⚠ The old note here ("a superuser who is not ALSO role-admin falls through") was
      false when written — the `isSuperuser` arm admits them two lines later. `CLAUDE_CORE.md §13`.
      One sibling remains in expression form: `api/mrn/photo/[photoId]:169`.
- [x] ~~**12 inline role checks under `app/api/tint/`**, deliberately out of scope on 2026-09-04
      because tint was not re-tested that night.~~ **DONE 2026-09-06.** The tint block converted in
      three commits, gated by `code-discovery-2026-09-06-tint-conversion-gate.md`: 19 write handlers
      + 2 reads moved to `tint_manager`/`tint_operator` ticks, and the three `canView`-on-a-write
      routes moved to `canEdit`. Operations User lost tint write access (intended — he holds no tint
      tick and both tint layouts already redirected him); Prakash gained manual-entry; the superuser
      gained the four operator writes `requireRole` had been redirecting him out of.
- [ ] 🔴 **STILL OPEN in tint — `operator/shades` POST and `operator/shades/[id]` PUT.** Held out of
      the 2026-09-06 conversion by owner decision: both write **`shade_master`, deprecated since
      2026-05-25** with a standing "do not write to it" (`CORE §13`, `CLAUDE_TINT.md §14`), so they
      are retirement candidates, not conversion ones. **Decide retire-or-convert before converting.**
      If converted, the key choice is not cosmetic: `shade_master`/`canEdit` is held by Harsh and
      Chandresh only, so it would revoke shade writes from **Deepak Vasava and Chandrasing Valvi**,
      the two active operators whose screen it is; `tint_operator`/`canEdit` would keep them.
      **Nothing in the app calls either route** (2026-09-19 grep of `app`, `components`, `lib` outside
      `app/api/tint/operator/shades`: the only hit is a comment, `tint-operator-content.tsx:886`),
      which leans the decision toward retire. An external caller is still possible — check Vercel
      logs first (verification question under `## Opened by the 2026-09-18 canon sweep`).
- [x] ~~**Every tint GET still gates on a job title.** Reads were out of scope on 2026-09-06, so
      nine manager GETs plus the GET halves of `challans/[orderId]`, `tinter-issue/[id]` and
      `tinter-issue-b/[id]` keep `requireRole`/`hasRole`.~~ **DONE the same day — this bullet was
      stale within hours of being written.** `fbbe30bd` moved 13 handlers: the 10 remaining tint
      GETs to `tint_manager`/`tint_operator` `canView`, plus 3 redundant bypasses in the variable
      form `65fd0e10`'s sweep could not match (`pause-history`, `skip-history`, `remove`). **Loses
      Operations User on 10 of 10, gains nobody** — until then he could still read eight manager
      endpoints and two tinter-issue endpoints by direct HTTP call while holding no tick and being
      redirected by both tint layouts. The read/write split it closed was never a decision: it was
      the residue of two conversion dates, and it landed inconsistently — `pause-history` and
      `skip-history` were already tick-gated, so he could read a challan but not a pause history on
      the same board. **Derived state today: `app/api/tint/**` has 37 route files and 41 handlers;
      37 gate on a tick** (`tint_manager` 11 canView + 12 canEdit; `tint_operator` 4 + 10). The
      four that do not are the three `operator/shades` handlers below and `operator/skip`.
      `CLAUDE_TINT.md §13.2`.
- [ ] **1 `requireRole([ADMIN])` left in `app/api/mail-orders/backfill-enrich`** — skipped only
      because mail-orders was an excluded path.
- [ ] **`operator/skip` has no permission check at all** — session, then
      `asg.assignedToId !== userId → 403 "Not your job"`. **Ownership-scoped by design, not a gap**,
      and listed here only so a session that finds no `requireRole` in it does not "fix" it into a
      tick. It is already the shape the other operator routes would need if their FACE branch were
      ever rewritten. `CLAUDE_TINT.md §13.2`.
- [ ] 🔴 **`requireRole` has no admin arm** (`lib/rbac.ts`) — it is a plain set-intersection with no
      superuser short-circuit, unlike both resolvers. **An admin-only account is excluded from every
      gate whose array does not spell `admin`** — none of today's 20 call sites omits it (grep
      2026-09-19), but a superuser-flag-only account is still refused by every one of them. It was
      redirecting the owner off the four tint operator writes until `64f897a9` converted them.
      ⚠ **Do not "fix" this by adding an arm to `requireRole`** — that silently widens 20 gates in
      one commit. Convert the call sites instead; the hole closes as they go. `CLAUDE_CORE.md §13`.

### P1 — Two bypasses `65fd0e10` did not sweep, and they are not the same kind

- [ ] `app/api/mrn/photo/[photoId]/route.ts:**167-168**` — `const isAdmin = …; const canDelete =
      isAdmin || (await checkAnyPermission(…))`. The same redundancy in **expression** form, so the
      wrapper sweep did not match it. **Harmless**, for the same reason as the 57. *(CORE §13 said
      `:169-170` until 2026-09-06 — read the lines, do not trust the anchor.)*
- [x] ~~`app/api/reports/tint-summary/route.ts:33` — a MULTI-clause role grant that still admitted
      Operations User to the Tint Summary report.~~ **DONE 2026-09-17 (`6f628b05`).** The route now
      gates on `checkAnyPermission(roles, "reports_tint_summary", "canView")` (`route.ts:37`), one
      tick per report (`CLAUDE_TINT.md §12`). The live holder list that followed is its own item under
      `## Opened by the 2026-09-18 canon sweep` → Tint.

### P1 — 🔴 THE SILENT-403 PATTERN: one systemic issue, not three bugs

- [ ] **Fix it at the helper, not at the call sites.** `fetchAll`
      (`components/shared/customer-missing-sheet.tsx:118-130`) returns **`[]`** on `!res.ok` and
      `[]` again from a bare `catch`, so **"you are forbidden" and "there is genuinely nothing
      here" are the same value.** `requireRole` makes it worse: it fails by calling `redirect()`, a
      **307 that `fetch` follows into `/unauthorized`**, so the response arrives **200 with HTML**,
      `res.ok` is true, and the failure only surfaces when `res.json()` throws inside somebody's
      catch. **This produced THREE silent failures in one week**, each diagnosed separately before
      the shape was recognised: the **manual-entry modal** (`2b25a48f`), the **missing-customer
      sheet's dropdowns** (`d3211766` — which is why that key choice had to be checked against the
      caller rather than the name), and the **old `/admin/permissions` grid** recreating 12 retired
      page keys on save, caught only because `admin_audit_log` had just been wired. Patching three
      call sites leaves the fourth to be found the same way. `CLAUDE_CORE.md §13`.

### P1 — Audit trail: the 13 write routes still recording no actor

Verified still unwired 2026-09-04; 44 `logAdminAction` call sites exist today. Deferred BY DECISION
into each module's own conversion so the same files are not edited twice — an unwired route here
looks identical whether it was missed or parked, and these were parked (`CLAUDE_CORE.md §13`).

- [ ] Sampling Library 3 · ~~Tint 5~~ **Tint 1** · MRN 2 · Billing 1 · backfill 2.
      ⚠ 49 `logAdminAction(` call sites exist at HEAD (grep 2026-09-19); the per-route breakdown
      above was not re-derived against them.

**Tint: 4 of its 5 wired on 2026-09-06**, inside the conversion commit so those files were not
opened twice — `manager/reorder`, `manager/challans/[orderId]` PATCH, `operator/tinter-issue/[id]`
PATCH and `operator/tinter-issue-b/[id]` PATCH. The two TI routes are the ones that mattered most:
`submittedById` is stamped at CREATE and never moves, so every later correction to a formula was
attributable to whoever first raised the entry rather than to whoever changed it.

- [ ] 🔴 **The 5th is `operator/shades/[id]` PUT, and it is deliberately still unwired.** It rides
      with the shades retire-or-convert decision above, not with the audit sweep — wiring an audit
      call into a route that writes a deprecated table is work thrown away if the answer is
      "retire". Do not close it on its own; close it when shades is decided.

### P2 — The four `/dispatcher/*` master-data screens: retire them

- [ ] **Reachable through the UI by NOBODY** — settled by the 2026-09-06 master-data gate, and by
      SELECT. `app/(dispatcher)/layout.tsx` is five lines with no session read; no sidebar generates
      those hrefs because **no holder of the `dispatcher` role holds any of the four ticks** (three
      users carry the role — Ajay Vansiya and Dhanraj Shah active, `Test Dispatcher` inactive — and
      all three hold zero). The three people who *do* hold a tick are sent to `/admin/*` or
      `/tint/manager/*` by their own primary role. By URL, `/dispatcher/customers` admits Harsh,
      Chandresh and Prakash; the other three admit **Harsh alone**. **The route group is named for a
      role that cannot open it.** ⚠ Not a contradiction of `CLAUDE_CORE.md §12`'s "these four are
      LIVE" — live and reachable are different claims.
- [ ] **Retiring them collapses `ROLE_HREF_OVERRIDES` to nothing for master data.** 11 of the 12
      master-data pages render the **same component** (`/tint/manager/customers` uses
      `CustomersSplitView` exactly as `/admin/customers` does); `/dispatcher/customers`'s
      `CustomersTable` is the override list's only real variation. Method:
      `archive/RETIREMENT-PLAYBOOK.md`. ⚠ Fix the stale comment at `lib/permissions.ts:127` in the
      same pass — *"/admin/customers uses the richer split view, the other three the same tables"*
      describes the **retired Support** copies and reads forward as a claim about the live tree.

### P2 — `sub-areas` CREATE is looser than `sub-areas` EDIT

- [ ] **A parked owner decision, not drift.** `admin/sub-areas` POST moved from `requireSuperuser`
      to `routes_areas`/`canEdit` on 2026-09-06 to match its `areas` and `routes` siblings; its own
      `[id]` PATCH and `import` are still `requireSuperuser`. Same person either way today (Harsh is
      the sole superuser and holds every `routes_areas` flag), a different rule tomorrow. **The
      owner's decision is to bring PATCH and import FORWARD, not to revert POST.** The block is
      commented so reverting that one handler is a two-line change if that flips.

### P2 — Step 7: landing page per user

- [ ] Give each person a landing route of their own. **`ROLE_REDIRECTS` retires with it** — it is
      currently the last thing keyed on the primary job title that decides where somebody goes.
- [ ] ⚠ `MobileShell`'s Home button is `navItems[0].href`, now derived per PERSON rather than per
      role. Re-derive it for all 39 people, not 13 roles, before moving any `PAGE_NAV_MAP` entry
      (`CLAUDE_CORE.md §11`).

### P2 — Step 8: retire the old model

🔴 **Order matters. `role_permissions` is the rollback path** while `ACCESS_SOURCE` can still be
flipped back — dropping it first turns a 30-second `UPDATE` into an outage (`CLAUDE_CORE.md §13`).
Remove the switch first, then the tables.

- [ ] Retire `role_permissions` (118 rows, 13 slugs), `user_roles` (29 rows, 20 users) and the
      `floor_access` role (**4 grants** — a role invented to hand Floor Control to four named
      people; under ticks it becomes four ticks and stops existing).
- [ ] Remove the `ACCESS_SOURCE` switch and the dual-source branches in the five resolvers.
- [ ] Decide on **dropping the role arm of the superuser check** — deliberately, with a tested
      recovery path. One account administers OrbitOMS; this is the one change that cannot be undone
      from inside the app (`CLAUDE_CORE.md §13`).
- [ ] Starter sets (apply a job title's template to a person), copy-access-from-person, and a
      page-first view ("who can reach Floor Control?" — the `user_page_access_page_idx` index
      already backs it).

### P2 — The old permissions screen

- [ ] Retire `/admin/permissions` and `components/admin/permissions-manager.tsx`. It writes
      `role_permissions`, which no longer grants anything, and it re-posts all ~78 rows on every
      save — the habit that resurrects retired page keys.
- [ ] ⚠ It carries `NA_IMPORT` / `NA_DELETE` / `isNA()` at `:100-110` — an **older, wrong duplicate**
      of `ACTION_PAGES` in `lib/permissions.ts`. It covers only import and delete, marks
      `tint_manager` import-NA against the verified census, and still lists the **retired**
      `dispatcher` and `warehouse` page keys. Delete it with the screen; do not sync it.

### P2 — Loose end found during the audit work

- [ ] **`app/api/mail-orders/backfill-customers` has no `maxDuration`.** It loops over every
      unmatched order with an `await` per row, so it inherits the default and will **time out
      mid-loop on a large backlog — silently, with rows already written**. Its sibling
      `re-enrich` sets `maxDuration = 300`; this one sets nothing.

### P3 — `CLAUDE.md` (the router) has no row for `/admin/access`

- [ ] The screen that decides what everybody can do is not in the router's §3 decision table. A
      session sent to work on it falls through to the *"/admin (other) → Core only"* row and loads
      neither `CLAUDE_CORE.md §7.14/§7.15` nor `CLAUDE_UI.md §63` deliberately. One row.

---

## Place Order / Mail Orders — v2 single source of truth (3-stage plan)

The big architectural arc. **Currently in Stage 1.** Full plan in `CLAUDE_PLACE_ORDER.md §19`.

**Shipped 2026-06-19 — App-format parser + Table C fast-path (app orders → V2):**
- Mail parser v7.2: App reader (`Parse-AppBody`) + sorter (`Test-IsAppFormat`, routes on first content line `Bill To:`) + name-lock (pins the exact emitted name so the Table C key matches by construction). Human/typed path untouched. Manual-deploy to depot PC. (The repo's `docs/Parser/Parse-MailOrders-V7.ps1` working copy is **tracked** and now at v7.3.0 — status-pass correction 2026-08-05; the canonical LIVE parser is still outside git per `CLAUDE_MAIL_ORDERS.md §3`, which owns the version ruling.)
- Table C exact-match fast-path in enrichment (commit `da219238`, on `main`): app line → exact dict (built from `mo_sku_lookup_v2` via `buildTableCContext`) → V2 material via a V2 resolver; 15 collisions excluded from the dict → keyword fallback. Stacked design (exact-first, keyword-fallback). Tested 11/11 this session; one real SKU rescue proven (`2K PU GLOSS 90 BASE` → V2 primary). **INGEST-only** — verified the other callers (debug / backfill / re-enrich) pass no context.
- **Net:** a clean app line that HITS Table C resolves via `mo_sku_lookup_v2` (fast lane). A MISS (collision / not-in-dict) and ALL typed/human orders still resolve via legacy `mo_sku_lookup` (keyword path — verified ingest still reads it; legacy `mo_sku_lookup` model still in schema). The split is intentional — a partial early bridge ahead of full Stage 3. Legacy tables stay (do NOT delete).

**Pending (this bridge):**
- [x] ~~Parser go-live (v7.2)~~ — **CONFIRMED LIVE 2026-07-15** (the app-only `Dispatch:` tag came back on a real order — `CLAUDE_MAIL_ORDERS.md §3.1`). NEW residue: the repo copy moved on to **v7.3** (piece-pack peel); whether v7.3 is deployed is unverifiable from here — redeploy when convenient.
- [ ] Live verification: first real app order → billed SKU matches app-catalogue intent (rescue sanity-check), with live keywords.
- [ ] Reclaim the 13 double-primary collisions into the fast lane: pick keeper per pair → `SET_FALSE` loser in `scripts/v2-sku-seed-from-legacy.ts` + flip `isPrimary` in Supabase (SELECT-verify + backup). The 2 pack-rounding collisions stay excluded.
- [ ] Thread `tableC` into RE-ENRICH so historical / re-run orders also get the fast-path (ingest-only today).

### Stage 1 — urgent fix (production-safe) · IN PROGRESS

**Shipped:**
- `/order` cut from legacy to v2 catalog (2026-05-29)
- Order dedup (`isPrimary` + `mobileFamily` columns, Promise umbrella collapse)
- `/place-order` grouping recovered + baked into seed
- Phase 1 `product` join-key fill (92 broken rows)
- Distemper/SmartChoice search-token fix

**Stage 1 remaining touch-ups (next session before Stage 2 starts):**
- ~13 oddball rows still showing no packs (`product = null`):
  - AQUATECH: PU Coat, Interior WBC, Roof Coat (BW/Grey/Teracotta), Crackfiller (5/10/20mm), Flexible Coat (Advance/Neo), IBC Advance
  - DISTEMPER: Acrylic Distemper / Interior Distemper
  - PRIMER: 2in1 Interior-Exterior Primer
  - STAINER: HP Colorant
- 8 mapped-but-base-unstocked rows — `product` set correctly but base has no SKU:
  - WS Protect Brilliant White (flagged — plain WS Protect has no BW though Dustproof/Max cousins do)
  - WS Max Yellow Base; WS Protect 90/93/96/97 Base; WS Protect Dustproof Yellow Base / ROX
- Stock-side: Acrylic Distemper / Interior Distemper SKU missing its `packCode`
- Optional cosmetic: WS rows carry `mobileFamily = MAX/POWERFLEXX/PROTECT/RAINPROOF`. Harmless today (labels by `family = "WS"`); normalise to "WS" only if desired
- ~~Add `isPrimary` filter to `/api/place-order/data`~~ — **✅ SHIPPED 2026-07-15** (`46b500fb`; confirmed live against the route 2026-07-16 — `CLAUDE_PLACE_ORDER.md §16/§22`)

### Stage 2 — make v2 parser-ready

1. Fill canonical key (`product`) on all remaining rows (full hygiene)
2. Build the one universal keyword layer in v2 (word→product + word→colour), seeded from legacy `mo_product_keywords` + `mo_base_keywords`
3. Point `/po` + `/place-order` search at the shared layer
4. Readiness check — confirm v2 carries everything the parser needs (packs, colour strategies DIRECT/FIXED/NUMBERED/COLOUR, carton multiply, no-match handling)
5. Verify search + readiness

### Stage 3 — migrate parser to v2 (only on explicit go-ahead)

1. Switch parser resolution to read v2 + shared keyword layer instead of legacy tables
2. Carry over no-match / zero-skip rule + operator "fix-it" resolve loop + `mo_line_status` audit
3. Test on real sample emails
4. Run old + new side by side, confirm they agree, then cut over — retire legacy tables LAST

---

## Place Order — per-product CSV rollout ✅ COMPLETE (2026-06-14)

The catalog-restructure workstream is **done — all families folded** into the final 9-tile speed dial (`CLAUDE_PLACE_ORDER.md §6/§23`). 6-step loop documented in `CLAUDE_PLACE_ORDER.md §14`. Covered GLOSS/PU Enamel/Satin/Promise/Velvet Touch/Sadolin/SuperCover/SuperClean/Primer/Distemper/Texture/Putty/Tools/Stainer/Spray Paint/M900 + the remaining-5 (Tile/Metallic/Lustre/Smoothover/Floor Plus) + email branding + dormant-alias light-up (PU Enamel etc.).

### Optional search refinements (NOT built — pick up if Smart Flow asks)
- `rainproof` → Rainproof only (drop the weak Dustproof link)
- `ws` → WS-family-first (rank WS family above unrelated products that merely contain "WS")

---

## Place Order — email + catalog (deferred)

### P2 — Deferred / open

- **Order email line-item reformat — ✅ SHIPPED 2026-06-19.** Plain text, NO HTML/bold (bold needs an HTML send-path — declined). Per-line format `{n}. {Product Name} - {pack}*{qty}`: numbered lines (`1.` `2.` `3.`); `" - "` (space-hyphen-space) after the product name; keep `*` and the comma multi-pack list (`1L*6, 4L*4, 10L*1, 20L*1`); customer header unchanged. e.g. `1. GLOSS Brilliant White - 1L*6` / `5. WS MAX Brilliant White - 1L*6, 4L*4, 10L*1, 20L*1`. Done via the **shared** `renderOrderBody` helper in `lib/place-order/email.ts` (the preferred no-divergence approach, like the `emailLineLabel` consolidation) — all 3 builders then live (`lib/place-order/email.ts`, `app/po/po-page.tsx`, and `app/order/page.tsx` — the last retired 2026-07-27, leaving two) call it. Plus refinements: header resequenced (Bill To → Ship To → Dispatch → Remark → Note), proper-case names (`emailCase`, codes/short/digit words stay caps), per-bill right-aligned line numbers with figure-space padding, and CC `surat.order@outlook.com` on desktop `/place-order` only. The app emitting this format is exactly what mail parser v7.2 (`Parse-AppBody`) reads. No email-builder shared-helper work pending. Code-only, no DB/reseed.

- **5IN1 Phiroza — create SAP codes.** `IN56000473` (500ML) + `IN56000471` (4L) were injected into v2 (owner-approved, SAP-unverified). They will NOT bill until created in SAP. Once real in SAP they import naturally — then verify the injected rows still match (no duplicate).

---

## Sampling Library

### Shipped 2026-05-22 to 2026-06-01
- Phase 1 (foundation + 3,566 parents + repair)
- Phase 2 (detail pane)
- Phase 3 (normalisation + deliveryNumber)
- Phase 4 (live operator integration — 2026-05-25)
- Phase 4 siteId bug fix + backfill (2026-06-01, commit `df7e61e9`)
- Phase 4.6 REVIEW pile import (601 sampling numbers, `packCode` nullable)
- Phase 4.7 Cohort A + B full restore (4,353 shades total)
- Phase 4.8 new tinting rows 16-25 May import

### P0/P1 — None active right now

Sampling Library is operationally stable. Reactive items only.

### P2 — Deferred / planned

- **Phase 4.5 + 5 orphan fix.** Designed (14 points locked), parked indefinitely. Live data shows ~15 orphans/month — manual cleanup is cheaper. Monthly check query in `CLAUDE_SAMPLING_LIBRARY.md §3`. Trigger Phase 4.5 + 5 if orphan count crosses 20/month sustained.

- **Sampling Issue-5 duplicate cleanup (IN PROGRESS).** Runbook + reference graph shipped (`CLAUDE_SAMPLING_LIBRARY.md §12`); dedupe by EXACT formula fingerprint, never shade name; inactivate (never delete) sources. **3 white-only groups merged** (`26-0196`/`26-0106`/`26-0094`); **~380 duplicate groups remained AS OF 2026-07-27 — re-COUNT before resuming the runbook** (status-pass note 2026-08-05: figure not re-run; merges may have happened since). Pending: build the **exact-dupe-finder tool** (seed number → all matching active samplings → dated review CSV); remove junk test sampling **`#26-0285`**. Owner chose manual SQL over a batch script for now.

- **Phase 5 fuzzy site match.** ~2,411 parents siteless after backfill. Recover most via fuzzy match against `delivery_point_master.customerName`. NEVER auto-fuzzy without operator review — site suffixes like "FACE" / phase numbers distinguish genuine different sites. CORE §3 rule.

- **Split-done usage-log gap.** `app/api/tint/operator/split/done/route.ts` never writes a `sampling_usage_log` row. Split-completed tints never appear in usage history or same-site suggestions. Decide whether splits should log usage.

- **`usageCount` cron rebuild** as belt-and-braces. Phase 4 keeps the counter in sync on every write; cron would catch drift.

- **Cross-customer "same site" grouping.** Multi-SAP-code sites (e.g. "Sun Shantam" with 5 customer codes) treated as separate sites. Schema change likely needed — `site_group_id` on `delivery_point_master` or a new `site_groups` table.

- **Suggestion card prominence (Option 1 from 2026-05-26 session).** Make exact-match cards visually louder to nudge operators away from typing duplicate shade names. Cheap UX fix, 2-4 hours, lower risk than Phase 4.5+5.

- **Delete `shade_master` table.** Phase 4 retired it from live use. Table still exists with historical data. Plan: confirm no live consumer (grep + audit page traffic for 4 weeks) → final CSV dump → drop page from nav → delete route → `DROP TABLE shade_master` → schema bump. No urgency.

---

## Customer Master + Multi-SO

### Shipped 2026-05-26
- Phases 1-7 of multi-SO + contacts auto-sync (commit `d1e298da`)
- 8 customers migrated, 2 contacts stamped, 6 auto-contacts created
- Eager sync in missing-customer resolver
- ContactCard auto/manual visual treatment
- Primary/Backup/Junior roles with P2002 reconcile pattern

### P1 — Phase 8 cleanup (6 items, ordered by priority)

1. **Drop `delivery_point_master.salesOfficerId` column.** Write-ignored from admin UI but still read by CSV importer. Drop only after #3.
2. **Update CSV importer** (`app/api/admin/customers/import/route.ts`) to write to `customer_sales_officers` instead of legacy `salesOfficerId`. Required before #1.
3. **CSV template header label** says `salesOfficerGroup` but importer expects `salesofficername` — pre-existing misleading label, rename when #2 ships.
4. **Refresh `CLAUDE_TINT.md §9.6` cascade docs** to remove SO-Group fallback once Phase 8 backfill is complete (today the cascade still falls back through it).
5. **Simplify `_lib/detail.ts` cascade** (sampling library detail panel). Legacy fallback is dead code for all post-Phase-6 entries; consider after one-time backfill of legacy null sampling rows.
6. **One-time backfill of pre-Phase-6 `sampling_register.salesOfficerId`** so detail.ts cascade can be fully retired. Optional.

Also: **add `@deprecated` JSDoc** to `delivery_point_master.salesOfficerId` in Prisma schema, flagging the field as legacy-only.

---

## Tint Module

### Shipped (in May 2026 cycle, before this consolidation)
- Operator Skip Job
- Operator Pause / Resume
- Remove OBD soft-delete
- Mark Done refactor (partial qty support)
- Challan formula auto-fill from TI (2026-05-26)

### P1 — Surface partial-qty Done to TM

`tint_assignments.currentProgress` is stored on every Done event with per-SKU actual qty, but no TM screen reads it. **Re-scoped 2026-09-19 against the rebuilt board:** the Completed Today Kanban section this item targeted is gone (`components/tint/tint-table-view.tsx` has no importer; board is `CLAUDE_TINT.md §1`), and nothing under `components/tint/manager/` reads `currentProgress` (grep). Where a short done should show — the board row, or the detail panel (`board-detail-panel.tsx`) — is an owner call. Then:
- Read `currentProgress` in TM consumers
- Optionally extend `PauseHistoryModal` into a "Job Lifecycle Modal" showing pauses + done event side-by-side

**Open question:** does the delivery challan auto-fill from assigned qty? If yes, partial-done jobs could print challans with wrong qty. Needs verification before partial-done is considered production-safe.

### ~~P1 — Pause kebab on non-pending Table sections~~ — CLOSED 2026-09-19 (premise gone)

The Table view this item extended is retired with the Kanban: `components/tint/tint-table-view.tsx` is unimported (`tint-manager-content.tsx:24-30` lists it "RETIRED, NOT DELETED"), and the rebuilt board has no kebab (`CLAUDE_TINT.md §1.11`). If Chandresh wants a pause entry on the new board, open it fresh against `CLAUDE_TINT.md §1`.

### P2 — Material picking workflow

Designed (schema spec exists in earlier drafts), not built. Operator-side flow for tracking which tinter materials (pigments) are consumed per job. Sketch:
- New table `tint_material_consumption` (assignmentId, materialCode, qtyMl, recordedAt)
- Operator screen line in TI panel: "Add material consumption"
- TM report: per-material per-day depletion

Useful for inventory planning, not blocking.

### P2 — Challan PATCH `$transaction` refactor

`app/api/tint/manager/challans/[orderId]/route.ts:551` — formula upsert wrapped in `$transaction`. Pre-existing, violates CORE §3, low-concurrency so safe today. Refactor in a dedicated session.

### P2 — Challan cell-clear UX fix

`components/tint/challan-content.tsx:211-213` filters empty strings out of PATCH body. Server has no delete branch. Clearing a cell does NOT clear the DB row, so a TM can't "unlock" a manually-overridden formula by clearing it. Build a proper "Reset to auto" button when this becomes needed.

### ~~P2 — TM reorder `$transaction` refactor~~ — DONE (`a0f9378b`, 2026-09-05)

`app/api/tint/manager/reorder/route.ts` holds no `$transaction` call; `:102` reads "Sequential awaits — never prisma.$transaction". The refactor landed in the board rebuild. It has still never been click-tested — that is the Reorder line of the board-rebuild P0 QA block below.

### P2 — Pre-existing `$transaction` in admin customer routes

`app/api/admin/customers/route.ts` lines 137 + 194. Left untouched in multi-SO commit. Refactor when convenient.

### P2 — Seven more `$transaction` sites this file never listed (opened 2026-09-19)

Grep of `app` + `lib` 2026-09-19, beyond the challan, admin-customers and two cancel-route items: `app/api/admin/areas/[id]/route.ts:43` · `app/api/admin/permissions/route.ts:83` · `app/api/admin/shades/route.ts:40` · `app/api/admin/skus/route.ts:64` · `app/api/tint/manager/splits/create/route.ts:150` (no caller — Create Split was dropped, `CLAUDE_TINT.md §1.11`) · `app/api/tint/manager/splits/reassign/route.ts:50` (live caller `tint-manager-content.tsx`) · `app/api/tint/operator/split/done/route.ts:56`. Each violates CORE §3; same "its own task" rule as the others (`CLAUDE_TINT.md §14`).

### P2 — Cosmetic cleanups

- CustomerMissingSheet styling to match admin customer split-view form
- Shade Master `isActive` filter — production verification (deferring; table is retiring)
- ~~Challan lazy creation removal~~ — **✅ VERIFIED CLOSED 2026-08-04**: the `[orderId]` detail API has no create call; creation is import-time only (`CLAUDE_TINT.md §14`)
- Challan print CSS audit — old class names `ch-header`, `tint-yes` may persist

---

## Tint Manager board rebuild — open items (opened 2026-09-06)

The board shipped 2026-09-05/06 in seven commits (`a0f9378b` → `082eb92e`, pushed). Screen is
documented in `CLAUDE_TINT.md §1`. **Everything below is OPEN — none of it is done.**

### P0 — QA: nothing in the rebuild has been exercised through the UI

Verified by `tsc`, `next build`, read-only production SELECTs and pure-logic harnesses. **No part
was click-tested**, because the session had no login and the dev server points at the production
database. These are QA passes, not code changes — each needs a human on the live screen.

- [ ] **Reorder ▲▼** — the highest risk. It WRITES `sequenceOrder`, and the `$transaction` →
      sequential-awaits refactor has never run. Check: a card moves one place, stays inside its own
      operator's queue, and a boundary press (already first/last) changes nothing and says nothing.
- [ ] **Bulk re-assign, including a genuinely `customerMissing` row.** The partial-failure path —
      `failed[]`, the 422 "nothing was re-assigned" case, named failures on a partial — is entirely
      untested. The customer-missing branch cannot be faked without writing to production.
- [ ] **Send back to Pending, for BOTH a whole order and a split.** Two different endpoints; only
      the request shapes have been checked, against the routes' validators.
- [ ] **The Assign menu on the FIRST rail card** — the case the pre-portal version broke on. The
      direction decision is unit-checked (`pickMenuDirection`), the rendering is not.
- [ ] **Live-sync actually firing.** Confirm the 15s `/api/tint/manager/marker` poll appears in the
      network tab, that the board refreshes on a real change, and that it PAUSES while the detail
      panel is open or rows are selected.
- [ ] 🔴 **Manual tint entry, end to end — the one flow the 2026-09-06 access testing could not
      reach.** The owner went looking for a "Manual Entry" button and there is not one: the rebuild
      renamed it. It is the **"Add to Tint"** pill (`tint-manager-content.tsx:715`, `+` icon,
      `title="Add OBD to Tint (M)"`) and the **`M`** shortcut (`:322-324`), both setting
      `pullModalOpen`. ⚠ The API routes kept the old name (`manager/manual-entry`, `/lookup`,
      `/revert`), so a grep for either name finds only half the flow. **Test it as Chandresh AND
      separately as Prakash** — Prakash's access to it is new as of `64f897a9`, and the companion
      lookup behind it shipped broken for him that morning (`2b25a48f`). Knowing where the button is
      is not the same as knowing the flow works. `CLAUDE_TINT.md §7`.

### P1 — The eight Kanban capabilities with no home in the new design

Each was reachable on the old board and is not reachable now. **These are open questions for the
owner, not settled removals.** Full list in `CLAUDE_TINT.md §1.11`.

- [ ] 🔴 **The per-row StatusPopover — the significant gap.** Set priority (Urgent/Normal) and
      dispatch status (Dispatch/Hold/Waiting) from any card or row via the ⊕ button. Its removal
      leaves `PATCH /api/tint/manager/orders/[id]/status` and `/splits/[id]/status` **with no caller
      at all**. Urgent and Key now render read-only (⚡/★). **Needs an owner decision: does Chandresh
      still set priority here, and if so where — the detail panel's action row is the natural home.**
- [ ] **Create Split.** Dropped by scope decision, so this one is a recorded consequence rather than
      an oversight — but the consequence is real: `POST /api/tint/manager/splits/create` now has no
      caller, so **new splits cannot be created anywhere in the app.** Existing splits still display,
      re-assign and reorder.
- [ ] **Cancel assignment / cancel split** — ✅ partly closed: both are back as "Send back to
      Pending" (`CLAUDE_TINT.md §1.8`). Listed here only so the original eight stay accounted for.
- [ ] **Part-assigned orders** (`remainingQty > 0` at a later stage). The Kanban showed these in
      Pending AND Assigned at once; a flat table has no dual-presence affordance, and the remainder
      flow ran through Create Split. An order with unassigned remainder now has **no assign entry
      point**.
- [ ] **The Sales Officer cascade** (`getDisplaySalesOfficerName`, the multi-SO Primary → group →
      fallback read) — gone from this screen entirely.
- [ ] **The dispatch-status trail** — the "✓ Tinting Done › Dispatch / Hold / Waiting / Pending
      Support" two-badge row on completed cards.
- [ ] **Fini/Generic SKU naming.** The new panel shows a split's line items with raw `skuCodeRaw`,
      so `useSkuDisplayMode` is **no longer honoured** on this screen.
- [ ] **The card/table view toggle and its `sessionStorage` key** (`tm_view_mode`). Intentionally
      gone — noted only because the key will linger in browsers that used the old board.

### P1 — `$transaction` in the two cancel routes

- [ ] `app/api/tint/manager/cancel-assignment/route.ts` and
      `app/api/tint/manager/splits/cancel/route.ts` both wrap their whole sequence in an interactive
      `prisma.$transaction`, violating CORE §3. **Deliberately deferred** during the 2026-09-06
      Send-back work, per `CLAUDE_TINT.md §14`'s standing rule that a pre-existing `$transaction` is
      its own task. ⚠ **There is a real trade-off, which is why this is not a mechanical refactor:**
      sequential awaits would swap a pooler-timeout risk for a partial-state one — a bill reverted
      to Pending with its assignment still live, or reverted with no audit line. Needs a deliberate
      decision on the failure mode, then one session.

### P2 — Canon disagreement: table row height, Floor vs UI §27

- [ ] `CLAUDE_UI.md §27` states a **32px header row and a 36px data row**. Floor's live table
      (`components/floor/floor-table.tsx`) uses **`h-[31px]` and `py-2`** (≈33px at 11px text), and
      the Tint Manager board was deliberately matched to FLOOR rather than to §27 during the
      2026-09-06 typography pass. **This is a documentation inconsistency between two canon files,
      not a bug** — nothing renders wrongly, and both boards now agree with each other. Decide which
      is authoritative: either §27's numbers are updated to what the boards actually do, or Floor and
      Tint are moved onto §27 and §27 is enforced. Until then a third board has two defensible
      answers to copy.

---

## Attendance + OT

### Shipped
- Phase 1 + Phase 1b (all OT admin UIs)
- OT prompt UI in check-out flow
- Grace policy (auto-credit + manual approval)

### P1 — Phase 2 admin writes

- **Manual entry record.** Admin adds a missed check-in/out after the fact with `isManualEntry = true` and `manualReason`. Backend missing.
- **Edit existing record.** Correct wrong timestamp, photo, or location. Audit field bump on every edit. Backend missing.
- **Mark exception.** Set summary `status` to `ON_LEAVE` or `EXEMPT` for a specific day with reason. Backend missing.

### P1 — Phase 2 master-data writes

**Holidays management.** CRUD on a `holidays` table — date + name + applies-to-all-roles. Rollover cron should treat holidays as non-attendance (skip ABSENT insertion). Backend + frontend both missing.

### P1 — Real geofence coordinates

Currently placeholder: Surat city centre `21.1702, 72.8311` with ±150m radius. Walk the depot perimeter with the "Use my current location" button on the new settings UI.

### P2 — Polish

- In-app notification when admin acts on OT
- Service worker for offline check-in/out
- Push notifications for OT decisions
- Submitting state polish on OT screen
- Auto-ticking clock on OT prompt screens
- Settings 403 toast label (currently mis-labelled "Session expired")

---

## Import Pipeline

### ~~Auto-Import resume~~ — MOOT (status-passed 2026-08-05)

The whole "paused since 2026-05-14, to un-pause:" block described a world that ended 2026-06-20 —
**Auto-Import has been LIVE on the v2 JSON path ever since** (944+ batches; `CLAUDE_CORE.md §4` /
`CLAUDE_IMPORT.md §10`, both corrected 2026-08-03/04). One survivor from the old checklist:

- **Cross-source orphan policy — OPEN, now LIVE-RELEVANT daily** (it was "deferred until un-paused";
  it un-paused six weeks before anyone re-read the line). Three options still on the table —
  `CLAUDE_IMPORT.md §15`.

### New import items (opened 2026-08-04, from the IMPORT v1.7 pass)

- **Retire-or-keep the v1 `?action=auto` handler + `IMPORT_HMAC_SECRET`** — the v1 multipart path has
  ZERO batch evidence in the entire table; whether its depot task still fires is import-PC-only
  knowledge. Owner decision (retiring changes a live API surface), not a cleanup.
- **Parser `$ScriptVersion = "6.5.0"` stale variable** (`docs/Parser/Parse-MailOrders-V7.ps1:136`) —
  one-line script fix; the file header (v7.3.0) is the real version. Owner-approved edit + redeploy.
- **A version field in the ingest payload** — the parser stamps no version anywhere, so the deployed
  version is permanently unverifiable from the depot PC (bit the 2026-08-04 pass). One header/body
  field + one column or log line fixes the class forever.

### 🔴 P1 — AUTO-IMPORT SILENTLY LOSES LINES (opened 2026-09-08)

Nineteen bills are missing stock that their own header still records. **Ten hold ZERO line rows
despite carrying an invoice, and nine of those ten are `dispatched`** — the goods left the depot and
were billed, and the header is the only surviving record of what was on them. **Nine more are short
against their own header** by 175, 37, 469, 50, 50, 50, 211, 50 and 36 units; **four shortfalls of
exactly 50 point at dropped 50-unit lines, not a unit-of-measure error.**

Root cause: nothing at ingest compares the Breakwalls payload's header `UnitQty` against the sum of
its own line array, so a short fetch is accepted silently. GUARD 1 (`app/api/import/obd/route.ts:2820`)
only catches a `createMany` that writes fewer rows than it was handed — it cannot see lines that
never arrived. The loss is upstream of this repo.

All nineteen OBD numbers, recorded here so they survive the report:

- **Zero line rows (10)** — `9108714570` (header 24) · `9108718897` (200) · `9108740751` (1250) ·
  `9108750985` (50) · `9108753988` (25) · `9108758489` (109) · `9108758491` (200) · `9108829338` (46) ·
  `9108839310` (208) · `9109296263` (75)
- **Short against header (9)** — `9107878744` (184 vs 9, short 175) · `9107900119` (47 vs 10, 37) ·
  `9107931925` (471 vs 2, 469) · `9107946773` (284 vs 234, 50) · `9108203125` (102 vs 52, 50) ·
  `9108547003` (92 vs 42, 50) · `9108630612` (293 vs 82, 211) · `9108798579` (71 vs 21, 50) ·
  `9108886262` (47 vs 11, 36)

⚠ These nineteen are also the reason the Defect B header recompute must not be allowed to run on
them: a recompute would overwrite the header with the short line sum and erase the only evidence the
stock is missing. Full working — `docs/prompts/archive/2026-09/code-discovery-2026-09-08-import-qty-integrity.md`
(§DEFECT B — GATE, Gates 2 and 3).

> **ONE-LINE CORRECTION to the P1 above:** the ten zero-line bills are **header-only-by-design,
> awaiting manual SAP** — not lost lines. The real gap is that **nothing surfaces them** as awaiting
> completion. Carved out and now traced in `import_shadow_log` as `header_only_allowed` (commit
> `d8fcf1ed`, §VOLUME-ZERO CARVE-OUT in the discovery report); **building the visibility is the
> open work.** The nine short-against-header bills are unaffected and remain genuinely short.

#### 🔴 CORRECTION 2026-09-08 — the TEN are not a bug, they are a deliberate depot-side rule

Established while fixing the depot scripts, and it overturns the earlier reading. **All ten
zero-line bills carry `volume = 0`**, and **`Auto-Import-v3.ps1` deliberately imports a volume-zero
OBD header-only**: `:1156-1163` (recovery) and `:1372-1375` (main import), both commented
*"Volume-zero rule: detail form will never fill; import header-only"* / *"manual SAP completes it
later"*, and counted as `$res.HeaderOnly`. **`Auto-Import-v2.ps1` has no such path at all.** The ten
were created 2026-08-08 → 2026-09-07, all after v3 appeared on disk (2026-08-05). So the ten are v3
doing exactly what it was written to do — and **manual SAP never completed them**. The nine
short-against-header bills are a separate matter and remain unexplained by this.

🔴 **This puts commit `a11bf7ee` (server-side empty-payload skip) in direct conflict with a
deliberate depot rule.** That commit makes `?action=auto-json` drop any OBD arriving with no lines,
which is precisely v3's header-only case. Consequence: a volume-zero OBD no longer enters OrbitOMS
from auto-import at all. If manual SAP later covers it the bill appears complete — better than
today. **If manual SAP never covers it, the bill never appears at all — and for an invoiced,
dispatched bill, invisible is worse than visible-but-empty, which is what the ten are.** **DECIDED
and shipped: the volume-zero carve-out** (`d8fcf1ed`, 2026-09-08) — header-only still imports and is
traced as `header_only_allowed` in `import_shadow_log`, while a genuinely empty volume>0 payload is
skipped (`CLAUDE_IMPORT.md §8.3`). The open work is the visibility item in the one-line correction
above.

#### The depot-side birthplace of an EMPTY (volume > 0) payload — fixed in the repo copies only

Separate from the volume-zero rule above: `if ($null -ne $lines)` is a **null check, not a count
check**. `@()` is not `$null`, so a FormGetData response carrying zero lines for an OBD that
*should* have lines was posted as a healthy header. Verified in real PowerShell 5.1:
`$null -ne @()` is `True`, `@($null).Count` is `1`, and a single non-collection object has **no
`.Count` of its own** — so the naive `$lines.Count -gt 0` would have dropped legitimate one-line
responses. The predicate used is `($null -ne $lines) -and (@($lines).Count -gt 0)`.

Fixed at **five** sites, not the three first identified — v2 `:1019` (recovery), `:1471` (Phase 7),
`:1522` (Phase 8 retry), v3 `:1167` (recovery), `:1385` (main). **v2 `:1522` was the important
miss:** without it the Phase 8 retry lane would have re-imported the very empty response Phase 7 had
just rejected, in the same cycle.

🔴 **THE IMPORT PC STILL RUNS THE OLD COPY UNTIL SOMEONE DEPLOYS IT.** This repo holds copies only;
nothing here reaches that machine. To deploy, on the **import PC**:

| Copy from (this repo) | To (import PC) |
|---|---|
| `docs/Powershell/Auto-Import-v2.ps1` | `F:\VS Code\OBD-Import Tool v2\Auto-Import-v2.ps1` |
| `docs/Powershell/Auto-Import-v3.ps1` | `F:\VS Code\OBD-Import Tool v3\Auto-Import-v3.ps1` |

`$ToolRoot` is `F:\VS Code\OBD-Import Tool v2` in **both** scripts (v2 `:38`, v3 `:56`), so the
script filenames are known but their **containing folder is inferred, not proven** — confirm the
actual scheduled-task path on the machine before overwriting, and back up the existing file first.
Deploy **both**: whichever is scheduled, the other must not be left with the old semantics.

#### Two smaller depot findings from the same read

- **`v3-waiting-obds.txt` is never pruned** (`Auto-Import-v3.ps1:1248`, written by `Set-WaitingStamp`
  `:1263`). It gains a line per OBD ever waited on and nothing ever clears it — unlike
  `failed-obds-json.txt`, which the daily reset deletes. Unbounded growth; the 5-minute throttle
  itself still works.
- **`$FailedJsonObdsFile` is dead in v3** — declared (`:68`) and deleted on the daily reset (`:1511`),
  but never written or read. v3 replaced the Phase 8 failure lane with the Waiting throttle. Harmless,
  but it means "the failure lane" means different things in the two scripts.

#### ⚠ Canon is stale on the auto-import cadence

`CLAUDE_IMPORT.md §10`/`§10.1` document **v2 at ~10 minutes** as the live pipeline. On disk there is
also **`Auto-Import-v3.ps1` (2026-08-05), a mode-based "fast lane" that Task Scheduler fires every
1 minute**. Live batch gaps support v3 being the deployed one: the most recent 25 auto batches show
gaps of 1, 4, 5, 5, 5, 5, 5, 9, 10, 11 … minutes, which a fixed 10-minute schedule cannot produce.
Combined with the volume-zero evidence above, **v3 is almost certainly what runs**. Not edited in the
canonical file here — that is a reconciliation pass with its own version bump.

### P1 — Line weights are not populated on two of three import paths (opened 2026-09-08)

Auto-import (`app/api/import/obd/route.ts:2795-2810`) and manual-template (`route.ts:900-916`) never
write `netWeight` / `totalWeight` onto their line rows — both `createMany` field lists stop at
`volumeLine`. `patchLines` cannot backfill them either, because `ExistingLine`'s select
(`lib/import-upsert/state.ts:44-47`) does not fetch the two columns.

Consequence across the estate: **7,610 bills have no weighed line at all, 5,988 are fully weighed,
and 13 are mixed and silently undercount** (SQL `SUM` skips NULLs) — e.g. `9107789846`, header 372 kg
against a line sum of 145.3 with only 15 of its 21 lines weighed. This is why the Defect B header
recompute had to drop `grossWeight`: the lines cannot support it. Fixing weight is its own change
(three write sites plus the patch-path select) **plus its own backfill**, and it must land before any
line-derived weight is trusted. Detail — `docs/prompts/archive/2026-09/code-discovery-2026-09-08-import-qty-integrity.md`
(§DEFECT B — GATE, Gate 2 condition 1).

### P3 — Three loose ends from the 2026-09-08 import work

- **`91074040627`** — an 11-digit delivery from a hand-made `[manual-sap] MANUAL.XLSX` (2026-06-08)
  carrying header volume 25 against a line sum of 500, with quantity matching at 25. The only real
  volume mismatch in the whole table (the other 308 are sub-litre float noise). Single outlier, own item.
- **`components/shared/order-detail-panel.tsx` and its route `app/api/orders/[id]/detail`** — dead
  code. The panel has no importer (superseded by `components/tint/manager/board-detail-panel.tsx`) and
  is the route's only caller. Retirement candidate, not in scope now; follow
  `archive/RETIREMENT-PLAYBOOK.md` when it is.
- **A rule-P skip inflates `totalObds` / `skippedObds`** — both count `parseResult.skipped.length`
  (`route.ts:1806-1807`), which mixes row-level and delivery-level skips, and the preview pushes a
  second `outcome: "skipped"` card for a delivery that also appears as `patch`/`new`. Pre-existing
  shape, identical to how `"non-LF row"` has always behaved. Worth a decision on counting row-level
  skips separately, not a bug to rush.

### P2 — Auto-Import patch path

Today Auto-Import is create-only. If late-update detection is needed (e.g. SAP marks an OBD as cancelled), go through `upsertObd` like manual SAP does, with `LINE_AUTHORITY['auto-import'] = 'authoritative'`. Full re-audit needed. Deferred until business case emerges.

### P2 — Weight diff in audit log

`ExistingLine` doesn't carry weights so re-import weight changes go un-audited. Add weight diff to the patch path if depot ops needs the tracking.

### P2 — Old SAP layout fallback shim

If SAP ever ships the old 25-column layout again, implement a layout detector. Not built today.

### ~~P2 — `articleTag` rule for ZINR rows~~ — SUPERSEDED 2026-08-09 (`9de0c55b`)

ZINR was never the reason tags were missing. The manual-SAP parser emitted `null` for **every** item
category, ZINR included. The rule now lives in `lib/article-tag.ts` and applies to all categories —
`CLAUDE_IMPORT.md §8.2`. One crumb left: the `zinr-article-tag-pending` warning text still says
"needs articleTag rule (deferred)". It gates nothing (preview-only, never reaches confirm), so it was
left rather than removed inside a change about the tag rule. **Retiring that one string is a P2
one-liner** — `lib/sap-parser/apply-rules.ts:241`.

### P1 — Backfill historically wrong / null `articleTag`

The 2026-08-09 fix corrects **new imports only**. `patchLines` (`lib/import-upsert/lines.ts`) never
touches `articleTag` on an existing line, so even re-uploading an old OBD will not repair it. Two
populations, and the second matters more:

- **~19,200 lines with a NULL tag** — cosmetic gap; the picker sees no pack count, same as before.
- **138 lines with a WRONG tag** across four 1 L SKUs (`5948208`, `5948212`, `5948220`,
  `IN32400023`), computed at 6/carton when the catalog says 9 — e.g. qty 45 reads `7 Carton 3 Tin`
  where the truth is `5 Carton`. **Worse than null**, because it reads as authoritative and a picker
  will count against it.
- Order-level roll-ups also do not recompute until an order's lines next change, so some orders show
  a null tag even though their lines are tagged (`CLAUDE_IMPORT.md §8.2`, multi-group bug).

Needs an owner decision before anything runs: this rewrites live picking data on orders that may
already be picked. A one-off script (not a schema change) — read lines, recompute via
`computeArticleInfo()`, write back, then rebuild the affected `import_obd_query_summary` rows.
**Ranked P1 not P2 only because of the 138 wrong ones**; the null backfill alone would be P2.

### P2 — A real `containerType` column on `sku_master_v2`

The permanent Drum-vs-Bag blind spot. Verified 2026-08-09 across the whole catalog: **nothing**
in `sku_master_v2` — `category`, `materialType`, `paintType`, `unit`, or any combination — separates
a drum from a bag. `unit` is `KG` for both (20 KG distemper → Drum, 25 KG texture → Bag) and `L` for
both. The only thing making that call today is the literal number in `lib/article-tag.ts`'s
`DRUM_SIZES` / `BAG_SIZES` lists, which means **every new pack size needs a human decision and a code
edit** — that is the recurring maintenance cost, not a one-off.

`piecesPerCarton` already proves the shape works: it identifies Carton with **perfect precision**
(zero false positives across 252 drum/bag SKUs). A `containerType` enum (`drum` / `bag` / `carton` /
`piece`) would do the same for the other three and let the fallback lists shrink to a legacy path.
Cost is not the column — it is populating ~872 catalog rows and keeping it populated. Worth doing
**if** list maintenance keeps recurring; not worth pre-empting. Would also resolve the open
`2.5 / 3 / 5 / 0.4` decisions (`CLAUDE_IMPORT.md §8.2`) at the source instead of one list edit at a time.

---

## Cross-cutting

### P2 — Tests

Zero automated tests today. `npx tsc --noEmit` is the only smoke. Worth adding:
- Parser unit tests (deterministic on fixture XLSX)
- Enrichment unit tests (test corpus of 100+ real lines)
- Slot resolution unit tests
- OT logic unit tests
- SoSync reconcile-loop tests (P2002 patterns)

### P2 — ESLint + pre-commit

`npm run lint` is unconfigured. Wire `eslint-config-next` strict + simple pre-commit hook.

### P2 — Vercel Pro upgrade (premise REWRITTEN 2026-08-05)

~~Hobby tier cap at 2 cron jobs~~ — that premise died in January 2026: the COUNT cap is 100 on all
plans; the binding Hobby constraint is **CADENCE (once per day, fires within the hour)** —
`CLAUDE_CORE.md §4`. A third or tenth DAILY cron needs nothing. Pro is needed only for a
**sub-daily** schedule (e.g. the picking-supervisor reminder), and the chosen alternative there is
the depot-PC doorbell (`CLAUDE_NOTIFICATIONS.md §7`). Keep Pro as the fallback if the doorbell
disappoints.

### P1 — OneDrive dev-machine sync risk

`orbit-oms` is OneDrive-synced and shared between the depot/server PC and the (returning) laptop. Two machines two-way-syncing one git folder risks `.git` corruption mid-sync and propagates deletions both ways. `git status --porcelain` shows no deletions on 2026-09-19, so the evidence once cited here is gone; the risk is not. Decide a single-primary-dev-machine policy before it causes real data loss.

### P2 — `trip_report` field meanings (reworded 2026-08-05)

`CLAUDE_TRIP_REPORT.md §3` now lists all **39** columns (38 until `rowHash` was added in v27.24 on
2026-09-08; live-verified at both counts) with **10 explicitly marked
as having no confirmed display-rule meaning** (`fixedType`, `tRate`, `vehType`, `vModal`, `modiInv`,
`remark`, `isManual`, `tranTransporterName`, `custsoName`, `createdOn` — `volLt`/`totQty`/`totWeight`
gained meanings in the display-rules session). Remaining work: confirm those 10 with Smart Flow and
annotate §3.

---

## Consolidation follow-ups (opened 2026-06-18)

New OPEN items surfaced while consolidating the 29 drafts. Grouped by module.

### Place Order / Catalog
- **Primer Int/Ext billing audit** — orders placed via `/place-order` between the 2026-06-08 Primer rebuild and the 2026-06-09 fix (`f217a1f7`) may have billed the OPPOSITE SAP (Int↔Ext). Audit that window.
- **Multi-Purpose Thinner billing audit** — thinner orders between the Sadolin `-final` rebuild and the 2026-06-09 fix (`70bd6369`) may have shown/emailed "PU Prime Thinner". Audit if any went to customers.
- **Spray Paint + M900 legacy `mo_sku_lookup` re-key** — both were un-hidden in v2 only; the v1 parser still emits `SR SPRAY PAINT` / `M900` for inbound emails. Re-key rides the parser→v2 migration (§19).
- **VT Specialty dedicated-tab fold** — currently search-only (Concrete Finish / Marble / Clear Coat). Deferred fold into a Velvet Touch tab (would reuse the per-row-family bucket + dormant-alias recipe).
- **Smoothover EXTERIORS→UTILITY + 96/97 YOX-vs-Yellow alias standardisation** — the deferred "final CORE section pass" (do the UTILITY/INTERIORS/EXTERIORS relabel together, not piecemeal).
- **Order email line-item reformat** — see the existing deferred bullet under "Place Order — email + catalog".

### /po (v1 public mobile page — its successor is `/po2`, `CLAUDE_PO2.md`)
- **`/po` → `/order` cutover rename — NOW UNBLOCKED (2026-07-27).** `/order` was retired
  (`de48357d`, `archive/2026-07-order/`) with **no redirect**, and the address was deliberately
  **parked for exactly this rename** — nothing occupies it. The middleware `"/order"` public-path
  entry was kept on purpose, so the address is already public and returns a clean 404 today; read
  `archive/2026-07-order/README.md` before touching it. Remaining work is the rename itself, once
  `/po` is fully signed off.
- **Server-side per-user recents** — recents are device-local localStorage today; needs login-scoped storage.
- **Orbit-bar collapse-on-scroll** — mockup approved, not built.
- **Dispatch slot feature** (date + time window on `/po` review) — design agreed, build deferred by owner; mockup in `docs/mockups/dispatch-slot/`.

### Tint / Reports
- **Edit-path modal gate** — the "Update TI Entry" path skips the formula-match gate and can save a null `samplingNo`. Wire the gate onto the edit/update path.
- **Cross-type reuse rows** — a TINTER line still lists ACOTONE shades (plain). Optionally filter the reuse list to the line's tinter type. Low priority.
- **Remove temp dev preview** `app/reports/tint-summary/preview/page.tsx`.
- **Intake/aging axis: OBD-date → import-time** — switch once import-time reliability is fixed (currently unreliable, so OBD date is used).
- **Operator card: tinting time + utilisation** — needs attendance present-hours + handling that stored tinting time includes paused minutes.

### Mail Orders
- ~~**Late-Evening / Night slot-summary auto-email gap**~~ — **CLOSED (`c103d5f4`, 2026-08-10):** the slot-summary modal and its auto-trigger were retired, and the commit records that nothing was ever sent by any of it. `slotDefs` no longer exists in `app`, `components` or `lib` (grep 2026-09-19). (`CLAUDE_MAIL_ORDERS.md §13`)
- **Dispatch cutoffs "Change-2"** — Local vs Upcountry dispatch cutoffs. Latent infra exists (`delivery_type_master`, `delivery_type_slot_config` UNUSED, `orders.dispatchSlotDeadline`, `delivery_point_master.dispatchDeliveryTypeId`/`reportingDeliveryTypeId` — corrected 2026-07-16, no `deliveryTypeOverride` column exists). Recommend a dedicated discovery session before building.

### Hide feature (Settings → Hide) — v1 deferreds
- **Hide Mail Order ROWS** (separate `mo_orders`, no hide column) — the bigger "hard part".
- **Tint badge gating** in the Tags tab — needs a shared badge registry first (Tint badges aren't centralized).
- **"N orders hidden by filter" banner** on the boards — parked.
- **Combined rule conditions** (e.g. HOLD AND older than 7 days); URGENT / MISSING_CUSTOMER rule tags; per-rule hidden counts; per-order override/pin to reveal one rule-hidden order.

### Cross-cutting
- ~~**`scripts/_*` tsc noise**~~ — **✅ DONE**: `tsconfig.json` `exclude` carries `"scripts/_*.ts"` + `"scripts/_tmp/**"` (and, since 2026-08-04, `"docs/_backup_*/**"`); the gate runs clean.
- ~~**Two CLAUDE.md routers**~~ — **✅ RESOLVED 2026-07-19**: `docs/CLAUDE.md` retired; the repo-root router is the ONLY router and says so in its own header.

---

## Consolidation follow-ups (opened 2026-07-16)

New OPEN items surfaced while consolidating the 17 drafts (Jul 8–16) into canonical docs (Place Order, Support, UI, new `CLAUDE_PICKING.md`, Mail Orders, Import, CORE).

### Security (P1)
- ~~**`GET /api/mail-orders/backfill-enrich` fully unauthenticated**~~ — **DONE (`0f56eede`, 2026-08-30).** The GET runs `requireRole(session, [ROLES.ADMIN])` (`backfill-enrich/route.ts:169`). Its two remaining gaps (the HMAC POST unreachable through middleware; a superuser-flag-only user refused) are under `## Opened by the 2026-09-18 canon sweep` → Access. Retiring the route stays in "Mail Orders cleanup" below. (`CLAUDE_MAIL_ORDERS.md §18`)
- ~~**Mail Orders routes are session-only, no role check**~~ — **DONE (`0f56eede`, 2026-08-30):** the 11 write routes gate on `mail_orders` canEdit via `checkAnyPermission`. Leftovers are in "Mail Orders cleanup" below. (`CLAUDE_MAIL_ORDERS.md §22`)

### Bugs (P1)
- **App-format orders lose product lines before enrichment — STATUS UNCLEAR, re-test (reworded 2026-08-05).** Surfaced 2026-07-15 — the same day v7.2 was confirmed live and parsing (`CLAUDE_MAIL_ORDERS.md §3.1`), so the original "zero lines" observation may have been the pre-deploy copy. One specific line-loss class (TOOLS `"1 pc*12"` piece packs) was definitively fixed in parser **v7.3** (repo copy; deploy unverified). Before treating this as open OR closed: place one real app order and check its lines reached enrichment.

### Picking
- **Picking role grants — ✅ CLOSED 2026-07-28. Live-prod SELECT run; seed and live AGREE.** Both this
  item and the seed-fragility item below are done. **`CLAUDE_CORE.md §5`'s `picking` page-key row now
  OWNS the live-verified statement and carries the numbers** — do not restate them here or re-open
  this. One consequence worth carrying forward: the same SELECT showed `floor_supervisor` and `picker`
  hold `picking` but **NOT** `floor`, which is why the desktop retirement kept `/picking` live rather
  than redirecting (`CLAUDE_FLOOR.md §9b`).
- **SEED FRAGILITY — ✅ RESOLVED 2026-07-20, verification closed 2026-07-28.** The operations
  `/picking` grant (+ floor_supervisor + picker) have matching `prisma/seed.ts:110-112` rows, so a
  reseed no longer revokes them, and live now matches seed. Standing lesson kept: **seed is not live,
  in BOTH directions** — it has now bitten each way once.
- **Floor workflow (Picked/Approved states) — ✅ LIVE (Stage 2, shipped through commit `bae3d182`).**
- **Stage 3 — floor findings (qty-short / old MFG) — ✅ LIVE (shipped 2026-08-07/09, `cd27c976` →
  `0df656ef`).** Nothing remaining. Delivered as a **two-step** flow — picker reports (optional),
  supervisor confirms (authoritative, `recordedById IS NULL` = pending) — on the same screen both
  roles already use; exactly two reasons behind a live CHECK constraint; Old MFG additionally
  capturing a month + year (Schema v27.15). The "billing-visible message" landed not as free text but
  as a ⚠ flag on the Billing Picking list plus a read-only detail panel, both reading CONFIRMED
  findings only. Full write-up: `CLAUDE_PICKING.md §11`; the Billing half: `CLAUDE_MAIL_ORDERS.md
  §23.4.1`. ⚠ Carried forward, NOT a blocker: **3 of 4 live `old_mfg` rows predate the month/year
  columns and are dateless** (count 2026-08-09) — fixed by re-opening the line on the floor, never a
  backfill; a date read off a tin cannot be reconstructed.
- **Supervisor 10-min "N picks waiting" reminder — DEFERRED.** Not event-driven; Vercel Hobby crons are
  once-per-day (CADENCE, not count — CORE §4). Planned trigger: a small depot-PC PowerShell "doorbell"
  (committed to `scripts/`) hitting a cron-auth'd route. (`CLAUDE_NOTIFICATIONS.md §7`)
- **LOOK UP A DISPATCHED BILL — PARTLY DONE (P2, owner-stated 2026-07-28).** **7,330** orders sit at
  `workflowStage 'dispatched'` (live 2026-09-18, Q09). `551069aa` (2026-09-11, "history surfaces
  recognise 'dispatched'") made Floor History, Billing's invoiced-info arm and the trip buckets read
  the stage; the Floor detail panel reports it (`app/api/floor/order/[orderId]/route.ts:234`,
  `isDispatched`). Per that commit's message some bills are still reachable from no screen. What
  remains is the owner's proper **REPORT** feature, built once the workflow is complete end to end.
  Deliberately deferred, not urgent.
  ⚠ `/planning`'s `showDispatched` branch was **never** a substitute: no client ever set the
  parameter, so that board always rendered empty (`archive/2026-07-planning-board/README.md`).
- **NO AUTOMATIC DRAIN `pick_checked` → `dispatched` (P1 — workflow hole).** Orders DO reach
  `dispatched` (the old "nothing writes to it" claim was WRONG — corrected 2026-07-24), but there is
  no automatic transition. Verified 2026-07-24: **1,051** at `dispatched` (662 auto-slotted), stopping
  at **21 Jul** while `pick_checked` kept growing (**195**, newest 24 Jul).
  ⚠ **Recount 2026-07-27: 1,546 at `dispatched`** — roughly **500 rows moved in three days**, and the
  "stops at 21 Jul" observation above no longer holds. **How they moved is not understood**: either the
  one-time manual sweep was repeated, or a drain path exists that canon does not know about. Establishing
  which is the first task when this item is picked up — not investigated 2026-07-27. The 238-row move
  was a ONE-TIME manual sweep (Floor build, 23 Jul), NOT a code path. It also forced the desktop
  board's carry-over exclusion — **that workaround is gone (the board was retired 2026-07-28), the
  HOLE it worked around is not.** Needs a real design session.
  **State at 2026-09-19.** A write path exists and has **no caller**: `markBillsDispatched`
  (`lib/floor/dispatch.ts`) is imported only by `POST /api/floor/trips/[id]/dispatch`, which no
  client and no cron calls since its button left in `3b9d1ab4` (2026-09-15); the route waits on a
  future supervisor loading screen. Live count **7,330** (2026-09-18, Q09). Most rows came from
  hand-run SQL, per the code's own records (a 2026-09-11 cutover of 2,624 bills,
  `scripts/backfill-nts-trips-2026-09-11.ts:9`; a 2026-09-13 UPDATE of 136, `lib/floor/dispatch.ts:5-11`)
  — no SQL for either is in the repo. Whether anything outside the repo is still writing the stage is
  the open investigation: **`CLAUDE_FLOOR_TRIPS.md §14`**, tracked at its §17 open item 1. Priority
  unchanged. (`CLAUDE_PICKING.md §7`)
- **Verify "New pick assigned" push on a real device.** Code is live; **the blocker changed shape
  2026-08-04**: real picker test accounts now EXIST (ids 35/36) and the 2026-07-29 first-login test
  plan's Round 4 covers exactly this — but no result was recorded. Run it (or report it ran).
  (`CLAUDE_NOTIFICATIONS.md §6`, `CLAUDE_PICKING.md §7`)
- **Remove push-test scaffolding** — the `/picking/push-test` page + the gray admin/ops pill on
  `/picking`, after floor rollout. ⚠ **Updated 2026-07-28: only ONE door is left, and it is
  phone-only.** The desktop pill lived in the archived board; the surviving link
  (`picking-mobile-shell.tsx`) is `block md:hidden`, so **at desktop width there is now no link to
  `/picking/push-test` at all** — the page still answers if you type the URL. Not worth building a
  replacement link for scaffolding that is due to be deleted; noted so nobody hunts for a missing
  pill. (`CLAUDE_NOTIFICATIONS.md §9`)
- **Deferred row-click detail panel** — picker name, assign/pick/check times, who-checked, line items,
  permanent Undo. ⚠ **Updated 2026-07-28: the "temporary inline Undo" this was to replace is GONE** —
  it lived on the archived desktop board. Floor already has the detail panel this item describes
  (`CLAUDE_FLOOR.md §4.6`), so what remains is whether the PHONE supervisor board wants one. Plus the
  picker-login flow (own phone vs shared terminal). (`CLAUDE_PICKING.md §7`)
- **Desktop supervisor → `/floor` redirect — PARKED, explicitly NOT built (P2).** Raised by the owner
  as a future idea during the desktop retirement. **Blocked on a permission decision, not on code:**
  `floor_supervisor` and `picker` hold `picking` but **NOT** `floor` (live SELECT 2026-07-28), so a
  redirect today lands both roles — including both `/picking` login destinations — on
  `/unauthorized`. That is the same dead end that ruled the redirect out at the time. Granting `floor`
  hands the floor team Hold / Cancel and the trip desk (`CLAUDE_FLOOR_TRIPS.md`) — an authority
  decision, not a layout one, and since 2026-09-04 a per-person tick rather than a role grant
  (`CLAUDE_CORE.md §7.14`). It would also break testing the card board by narrowing a
  desktop window. (`CLAUDE_FLOOR.md §9b`, `CLAUDE_CORE.md §5`)
- **Unmatched bills have no desktop home (P2) — RE-SCOPED 2026-09-19.** The archived desktop board had
  an "Unmatched" header segment listing bills whose customer never resolved. The trip desk changed the
  premise: undecided bills now sit on the board itself (arm 2, `floorUnslottedWhere`,
  `CLAUDE_FLOOR.md §3`), and since `b3dfe5b8` import releases every non-tint bill on its own
  (`CLAUDE_IMPORT.md §2.1`). What is left is narrower: `/floor` still offers no filter for
  "(Unmatched)" rows. Owner question — is a filter wanted on the trip desk? Pairs with the
  "missing-customer resolver has no Floor entry point" item below.
- **Approve is phone-only — a STANDING gap, not a new loss (P2).** There is no way to approve a picked
  bill from a PC. This was already true before the desktop retirement (that board never had Approve
  either, and `/floor` has none — verified by a whole-folder search of `components/floor`,
  `lib/floor`, `app/api/floor`). Recorded now because the phone is the only option, so if a supervisor
  is ever at a desk without a phone the workflow stalls. (`CLAUDE_PICKING.md §6`)
- **`PickingQueueResult.date` has no reader (P2 — trivial).** Surfaced while removing the four dead
  counters 2026-07-28. `getPickingQueue()` returns `{ date, rows }`; no surface reads `date`. Left in
  place deliberately — it was not on that step's approved removal list. Remove it in its own pass, or
  leave it as a cheap debugging aid.
- **`single` scope KEPT DELIBERATELY — do not re-derive it as dead code (owner decision 2026-07-28).**
  `lib/picking/queue.ts`'s `single` scope has **no caller in app code**, and a future sweep will find
  that and propose deleting it. It is kept because it is what a request with **no `?scope=`** resolves
  to, and both public routes still accept it by name (`app/api/picking/queue/route.ts`,
  `app/api/picking/marker/route.ts`) — removing it changes a live API contract for no benefit. The
  only thing that ever exercised it was the untracked scratch script deleted at `b51cd14f`. The
  reasoning is also recorded as a comment at the scope itself; read that before acting.
- ~~**Manifest name experiment — finish or revert.**~~ **DONE (`4a2f763f`, 2026-08-12):**
  `public/manifest.json:2-3` is `"name": "Orbit"`, `"short_name": "Orbit"`.
  (`CLAUDE_NOTIFICATIONS.md §8`, `CLAUDE_ATTENDANCE.md §14`)

### Floor Control
- **RETIREMENT DEPENDENCY LIST — ✅ FULLY CLOSED. Both halves done.** `/support` retired 2026-07-27
  (`archive/2026-07-support/`); what Floor borrowed from it was extracted into `components/floor/` ·
  `lib/floor/format.ts` · `app/api/floor/` first. The **Picking DESKTOP board retired 2026-07-28**
  (`archive/2026-07-picking-desktop/`) — and the Picking half of this list turned out to need **no
  extraction at all**: the assign/unassign endpoints, the sort rule objects + `sortPickingQueue`, and
  the `use-picking-marker` hook **all survived untouched and Floor still imports all three**. What
  was removed (the `rolling` scope and four payload counters) was never Floor's. Full accounting:
  **`CLAUDE_FLOOR.md §9b`**. ⚠ Picking's card boards were never in scope and are still live at every
  width.
- **Ship-to CLEAR (✕) on the Floor detail panel (P2 — UI only).** `POST /api/floor/ship-to` already
  accepts `customerId: null` and clears the redirect; the panel offers no ✕ to send it, so an
  operator can change a ship-to but never remove one. No backend work. Deferred to the post-testing
  polish round. (`CLAUDE_FLOOR.md §4.4`)
- **Missing-customer resolver has no Floor entry point (P2).** `components/shared/customer-missing-sheet.tsx`
  opened from the Support board and the Tint Manager board (its assign interceptor,
  `CLAUDE_TINT.md §1.5`); with Support retired, only Tint Manager can resolve an unmatched customer. Decide whether Floor's detail panel should surface it.
  (`CLAUDE_MAIL_ORDERS.md §19`)
- **Floor Control v2 — slot suggestion — ✅ SHIPPED 2026-08-03** (commits `30226144` → `dee603dc` +
  `ab70c826`). Both preconditions this item set were built exactly as specified: the staleness check
  is now one closed-batch MOMENT test, and the suggestion carries date AND time. Layer spec:
  `CLAUDE_FLOOR.md §8`. **Dormant since the rail retired** (`79bcc412`, 2026-09-13): `lib/floor/suggest.ts`
  has no importer (`CLAUDE_FLOOR.md §8`). Follow-ups it opened are below under **"Floor Control —
  slot-suggestion follow-ups (opened 2026-08-03)"**.
- **v1 gaps (P2 — from the build draft §7; carried across individually):**
  - `Waiting` pills show no elapsed time — needs a `releasedAt` on the floor payload.
  - ~~Ship-to original→redirect name pair missing on the floor table~~ — **✅ BUILT (`07bc5104`):** the ORIGINAL → REDIRECT pair renders at `floor-table.tsx:1070` (`CLAUDE_FLOOR.md §4.9`).
  - Assigned rows sink to the bottom of the board — **✅ RESOLVED + SHIPPED (`661e4e61`, 2026-07-25):** `byAssigned` excluded from Floor's sort (Floor now uses `FLOOR_SPINE` = spine minus `byAssigned`, `lib/floor/sort.ts`), so Assigned/Done rows hold their place. The residual new/urgent-bill slide above a picker's row is parked separately → **"Floor Control — carry-over + stable positions (opened 2026-07-25)"** below.
  - **Re-scoped 2026-09-19 (the rail is gone):** the slot picker's empty-state button still reads lowercase "pick slot" (`components/floor/dispatch-slot-picker.tsx:390`) wherever it is still drawn (`hold-bar.tsx`, `detail-panel.tsx`, and Billing's `billing-action-ribbon.tsx`); mockup says "Set slot". Copy fix; the picker is Floor's own, nothing to fork around.
  - ~~Assign bar reads "Change slot" beside a "pick slot" button~~ — **✅ RESOLVED by the 2026-07-26 action-surfaces redesign**: the duplication collapsed to ONE proper "Change slot" button (`CLAUDE_FLOOR.md §4.6`).
  - No picker search — search matches customer / route / OBD only.
  - Detail-panel header pill shows no elapsed time — the panel is not a live surface.
  (`CLAUDE_FLOOR.md §8`)
- **Parked data issues (diagnose — open observations, not module state):** 103 Deco Retail bills reached
  `pending_support` with `dispatchStatus` NULL (the engine fires only on `='dispatch'` — an upstream
  diagnosis); the `Deco` 9-row un-mapped SMU leak (should be `Deco Retail`, so those bills never
  auto-slot). (`CLAUDE_FLOOR.md §10`, `CLAUDE_CORE.md §7.4`)

### Import
- **Arrival-slot same-day/different-day rule.** Designed, not built — the live fork still uses the old `receivedAt` vs `punchedAt` comparison. (`CLAUDE_IMPORT.md §12.2`)

### Dispatch / Planning
- **Dispatch Planning Brain V2 — PARKED, fork unresolved.** The 6-slot sliding-capacity design conflicts with the live `vehicle_master` (flat-capacity, 6 rows, no sliding). No code written; the design-locked and fleet-mismatch-discovery drafts are kept as reference only — do NOT treat the locked design as settled. A `CLAUDE_PLANNING.md` gets created only when this ships.
  ⚠ **Updated 2026-07-28: there is no longer a Planning screen to build onto.** `/planning`, the
  `/dispatcher` stub and all 8 `/api/planning/*` routes were archived (`639f8139`,
  `archive/2026-07-planning-board/`) — the half-built board this item implicitly assumed is gone.
  That does not kill the item: it means V2 starts from a blank screen rather than an existing one,
  which is arguably cleaner. The archived code is reference for what was tried, never a base to
  restore. Still PARKED.

### Place Order
- **Missing draft: `web-update-2026-07-14-po-save-draft-sent-feature.md`.** Referenced by the Favourites session as a companion but absent from `docs/prompts/drafts/`. The `/po` Drafts/Sent feature (draft list, receipt, resend) is live in code but undocumented in `CLAUDE_PLACE_ORDER.md`/`CLAUDE_UI.md` pending this draft's recovery or re-authoring.

---

## Consolidation follow-ups (opened 2026-07-19)

From the flat-SKU-catalog migration + the Direction-A mobile shell batch. Canonical detail:
`CLAUDE_CORE.md §7.1.c` + `§13`, `CLAUDE_IMPORT.md §8.1`, `CLAUDE_PICKING.md §5`, `CLAUDE_UI.md §59`.

### Catalog cleanup (P1 — blocks the friendly-name build)

- [ ] **~309 unknown SAP codes.** Active on real bills but present in NEITHER catalog table (old
  `sku_master` ~57% coverage, `sku_master_v2` ~73%, ~27% in neither). They fall back to raw SAP text
  with a blank pack. Export by frequency:
  `docs/prompts/drafts/unknown-sku-codes-2026-07-19.csv` (309 rows + header — leave it where it is).
  Owner review needed: genuinely obsolete vs. never-mastered — **needs Chandresh/depot input.**
  Overlaps the blank-pack landmine in `CLAUDE_PICKING.md §7` (reduced 2026-07-19, NOT closed).
- [ ] **7 odd Promise/duplicate rows**, surfaced by the friendly-name generation: 3 pre-existing
  Promise SmartChoice duplicate identities whose names collide (Int Primer, Ext Primer, Acrylic
  Distemper), a bare "Promise" row with no product identity (family `PROMISE INTERIOR`, product
  `PROMISE`, base `PROMISE`), and 2 stutter rows ("Promise Primer Promise Primer", "Acrylic
  Distemper Duwel Acrylic Distemper"). Harmless clumsy names today. Its own careful data pass with
  its own rollback — not bundled with anything else.

### Friendly product name on the picking card (P2 — DEFERRED, designed + proven)

- [ ] Deferred by Smart Flow 2026-07-19: unwilling to risk any misleading name on a picking card
  until the catalog odd-rows above are cleaned. **Status update 2026-08-05: the COLUMNS now exist —
  `sku_master_v2.displayCategory` + `displayName` (live-verified 2026-08-04, both EMPTY, read by
  zero code; CORE §7.1.c).** The feature itself is still not built — no fill, no picking code; the
  "nothing was built" claim below is otherwise intact. Recipe is fully proven and preserved (the
  stored column landed as `displayName`, built from `category` / `product` / `baseColour` with NO
  menu-table join, `emailCase()` not `smartTitleCase`, gentle de-double only, SKU code stays the
  hero and the name is a muted reference line):
  `docs/prompts/archive/2026-07/web-update-2026-07-19-sku-master-v2-project-v2.md §5` + the per-family samples
  in `code-discovery-2026-07-19d-picking-name-samples.md`. **Resume order:** clean the catalog → re-run
  the 19d sampling to confirm zero misleading names → build in two steps (fill via reviewable SQL,
  then show on the card).

### Retire old `sku_master` — the final swap (P2 — one dedicated session)

- [ ] Drop old `sku_master` + its 3 FK helper tables (`product_category`, `product_name`,
  `base_colour`); drop `import_enriched_line_items.skuId` + its relation; retire the admin SKU-CRUD
  surface (`/api/admin/skus/*` + the 4 `skus/page.tsx` browse pages — the only live readers left);
  rename `sku_master_v2` → `sku_master`. **Read `CLAUDE_CORE.md §13`'s id-space landmine first.**
- [ ] **Blocker to handle IN that session:** `scripts/normalise-sampling-data.ts:313` reads old
  `sku_master` and has no underscore prefix, so it is INSIDE the `tsc --noEmit` gate — it will fail
  to compile at the DROP and block every commit until fixed (`CLAUDE_SAMPLING_LIBRARY.md §3`).
- [ ] Remove the 2 scratch diagnostics that read the bookmark (`scripts/_diagnose-sku-5961032.ts`,
  `scripts/_diagnose-skuid-collision.ts`) — outside the gate, so they block nothing, but they are the
  only remaining readers.

### Picking (P2)

- [ ] **Slide-to-done control** — designed + approved 2026-07-19, **not built** (the batch stopped
  before it by choice). Replace the detail screen's **Approve** button with a drag-to-confirm control
  firing the *same* `handleApprove(detailRow)` → `POST /api/picking/approve` `{orderId}`. The
  `allLinesChecked` gate and the API are unchanged — only the input mechanism changes. **Green**, not
  the brand colour (separates "finish" from the brand-coloured "assign"; the brand is violet since
  `c96157ea` — `CLAUDE_UI.md` "Orbit colour tokens — the brand system").
- [ ] **FIVE in-app depths on the supervisor board ship with no Back affordance** *(was four — the
  fifth was added 2026-08-22, see below)*. They push no history entry, so Android hardware back /
  iOS edge-swipe navigates the *browser* instead of closing them. Same gap class the detail screen
  had pre-Build-A; copy the `/po` single-authority popstate model (`CLAUDE_PLACE_ORDER.md §25`).
  1. route filter sheet
  2. check-picker filter sheet
  3. checked-picker filter sheet
  4. the bulk-bar assign sheet
  5. **the Picking tab's LEVEL 2 — one picker's bill list** *(added 2026-08-22 with the three-level
     Picking tab)*. ⚠ **This one is NOT a sheet, and that is why it matters most of the five.** It
     is a navigation DEPTH: `openPickerId` in `picking-board-mobile.tsx` moves the tab from the
     picker cards to one man's bills, with an on-screen back chevron and no history entry. So a
     hardware back from *two* levels in throws the supervisor clean out of the module — strictly
     worse than the same press from one level in, which is all the four sheets above cost.
     It was built this way ON PURPOSE rather than growing a fifth hand-rolled popstate handler
     beside the detail screen's: that is the exact proliferation this item exists to end. The code
     carries the same note at the `openPickerId` declaration. **When the shared model lands, this
     depth is part of it — do not treat the list above as sheets-only.**

  The nested assign sheet opened *from* the detail screen is already handled — not on this list.
- [ ] **Feel-tuning pending real-device use:** the 0.65× drag-follow and ~260ms slide are subjective
  one-number tweaks if the floor wants faster/stiffer.

### UI (P2)

- **Extract the Direction-A header to a shared component — ✅ SHIPPED 2026-07-29 (`a2fb6889`).** Now
  `components/shared/module-mobile-header.tsx`, extracted **verbatim** from the supervisor board:
  every className, aria-label, tap target, icon size and the safe-area padding byte-identical to the
  inline JSX it replaced. **Contract, props, design rule and adopters now live in `CLAUDE_UI.md
  §59.7`** — the section this closure created; read it there, it is not restated here. The condition
  this item set — *"extract when a second module adopts Direction A, not before"* — was met the same
  day: the picker "My Picks" face adopted Direction A in `ee023b4a` and consumes the shared header
  with `showSearch={false}`. Consumers today are those two picking faces and nothing else; **Tint
  Operator mobile** and **Trip Report mobile** are the named next candidates, and adopting is a
  markup swap rather than a design (§59.7). *(The "big search" half of `CLAUDE_UI.md §59.6`'s
  original deferred bullet was never built and is NOT covered by §59.7 — it stays deferred there.)*

- [ ] **Three components still paint red for URGENT (P3, opened 2026-09-09).** `CLAUDE_UI.md §1`
  was corrected at `3c713282`: **red is error and destructive only — a failed send, a bounced
  order, a Delete or Clear button — and amber is urgent.** `components/shared/status-badge.tsx`,
  `components/floor/floor-table.tsx` and `components/shared/duplicate-so-tag.tsx` still paint an
  Urgent chip red. ⚠ `CLAUDE_UI.md §3`'s Semantic table deliberately still records
  `Urgent | bg-red-50` **because those three files do** — canon must never claim a colour a
  screen does not paint, so the table row flips when the last of the three is migrated and not
  before.

### Code cleanup (P2 — one line)

- [x] ~~**Stale comment in `prisma/schema.prisma`** above `model sku_master_v2`~~ — **DONE
  (`6f1e35a8`, 2026-08-05).** `schema.prisma:2129` now records that the line said "No readers
  repointed yet" until 2026-08-05.

---

## Post-Support-retirement cleanup (opened 2026-07-27)

Forward items left behind by the retirement (commits `bc42a948` → `62a2928c`). The retirement itself
is done and recorded in `archive/2026-07-support/README.md` — these are the loose ends.

- [ ] **`/orders` — delete it, or gate it (P2).** `app/orders/page.tsx` has **no permission gate**
  (any authenticated role can load it) and its entire body is `redirect("/floor")`. Two commits in
  its whole history: created March 2026, repointed at Floor in `62a2928c`. Because `/floor` is granted
  to admin + operations only, every other role now lands on `/unauthorized` via a route nothing links
  to. Decide: delete the route, or add a `floor` `canView` gate so the failure is honest.
- [ ] **`dispatch_change_queue` — decide whether to drop the table (P2).** Support's edit route was
  its ONLY writer in the entire codebase, and **nothing has ever read it**. Now frozen: no new rows,
  existing rows are history. Dropping a table is a bigger decision than retiring a screen and was
  deliberately not bundled into the retirement. (`CLAUDE_CORE.md §7.4`)
- [ ] **Move the four master-data pages out of their old route group (P3 — cleanup only).**
  Customers / SKUs / Routes / Vehicles sat under the Support route group and were archived with it.
  Their `/admin/*` equivalents are live and a **superset** (`/admin/customers` uses the richer split
  view), so nothing is lost — the `support` role now falls through to those. Low priority; the only
  gain is that no future reader wonders where the Support-group copies went.
  ⚠ **Do not confuse these with the `/dispatcher` four (2026-07-28).** `app/(dispatcher)/` also holds
  Customers / SKUs / Routes / Vehicles pages — **those are LIVE and were deliberately kept** when the
  `/dispatcher` index stub was archived. Same four names, different route group, opposite status.
- [ ] **Dead exports in `lib/workflow-stages.ts` (P3).** `supportMayEdit()`, `isSupportDone()` and
  `stageRank()` now have **zero callers** (`stageRank` is called only by the dead `isSupportDone`).
  The `supportMayEdit` flag on all fourteen `STAGE_LADDER` rows exists only to feed the dead function.
  ⚠ **Do NOT bulk-delete by name:** `SUPPORT_DONE_OUTPUT`, `SUPPORT_DONE_STAGE_NAMES` and
  `SUPPORT_PICKING_QUEUE_STAGE_NAMES` share the prefix and are **load-bearing** across Floor, Picking,
  Import, Tint and two admin backfill tools. (`CLAUDE_PICKING.md §2`)
- [ ] **The `SUPPORT_*` naming in `lib/workflow-stages.ts` (P3).** Four live constants and the
  `pending_support` stage name still say "support" but belong to Floor/Picking/Import/Tint. Renaming
  removes a real trap; it is a wide mechanical change (and `pending_support` would mean rewriting live
  rows), so it needs its own session — or a deliberate decision to leave the names as historical.
- [ ] **Two TI Report page files are unreachable — verify, then delete or restore (P2).**
  `app/(tint)/ti-report/page.tsx` and `app/(tint)/tint/manager/ti-report/page.tsx` both render
  `<TIReportContent />`, but `next.config.mjs` redirects **both** of their addresses to
  `/reports?r=ti-report` before either page can run — so neither has been reachable since the
  Reports hub landed. Confirm in the browser, then either delete the two files (the hub is the
  intended surface) or drop the redirects if direct access was meant to survive. **Do not leave
  both** — a page that cannot render is invisible dead code no link-search will find.
  Found during the step-8 playbook write, 2026-07-27. (`CLAUDE_CORE.md §12`, `next.config.mjs:33-34`)
- [ ] **Five pre-existing unused files (P3 — NOT caused by the retirement).** Verified dead before it
  began (`d08681e9`) and never referenced by Support: `components/shared/role-nav.tsx`,
  `components/shared/sign-out-button.tsx`, `lib/mail-orders/enrich-v2.ts`,
  `lib/picking/validate-assign.ts`, `lib/slot-history.ts`. Confirm and remove in one sweep.
  ⚠ **CONFLICT flagged 2026-08-05:** the reconciliation cycle's survivor list named `lib/slot-history.ts`
  a KEEP-as-live survivor, while this item lists it for removal — and `lib/picking/validate-assign.ts`
  is a documented DELIBERATE dormant keep (`CLAUDE_PICKING.md §7`). Resolve per-file with the owner
  before any sweep; do not delete either on this item's say-so alone.

---

## Floor Control — carry-over + stable positions (opened 2026-07-25)

Two designed-but-unbuilt items from the Floor sort work (commit `661e4e61` — the session that
excluded `byAssigned` from Floor's sort, `CLAUDE_FLOOR.md §3`). Parked with enough spec that a future
session builds without re-deciding anything.

**Shared landmine — respect on BOTH.** Any `orders` write MUST ride the existing single
`orders.update` on that path — never a second update. The live-sync marker keys on
`MAX(orders.updatedAt)`; a second write fires a false "changed" on every open board
(`CLAUDE_FLOOR.md §4` / `CLAUDE_CORE.md §3` / `CLAUDE_PICKING.md §10`).

### P1 — Floor carry-over (LOCAL only) — DESIGNED, NOT BUILT

⚠ **Check the premise before any Session B (2026-09-19).** This design assumes a person releases a
bill to a dispatch slot and the slot then goes stale. Since `b3dfe5b8` (2026-09-11) import releases
every non-tint bill itself (`CLAUDE_IMPORT.md §2.1`), loads are planned on the trip desk
(`bbb9628c`, `CLAUDE_FLOOR_TRIPS.md`), and `36a39ba7` added a carried-forward pool arm to the board
(`floorCarriedPoolWhere`, `CLAUDE_FLOOR.md §3`). No carry-over cron exists (`vercel.json` holds the
two attendance crons only) and `schema.prisma` has no `originalDispatch*` column.

**The problem.** A local bill left unpicked/unchecked at day's end stays filed under yesterday's dead
dispatch slot (e.g. 16:00 Thursday). Come the new day that slot's vehicle is gone, so the bill should
go on the FIRST van out that morning — not wait for the same slot again. Today nothing moves it; it
sits in the stale slot with only a 1d age badge.

**The decision (LOCKED this session).**
- **LOCAL bills only.** A local bill still unchecked at the nightly roll moves to the FIRST dispatch
  slot of the new day.
- **UP-COUNTRY is explicitly OUT — do not build a roll for it.** Up-country always dispatches at a
  fixed 18:00 (engine rule `R1_UPC_NEXT_1800`), so rolling yesterday's 18:00 to today's 18:00 changes
  nothing on screen. Reason recorded so a future session does not re-add it: there is ALSO no
  per-destination departure timetable in OrbitOMS to roll to — only geography, never a schedule.
- **Preserve the ORIGINAL dispatch slot before overwriting it**, so history shows the truth ("was
  16:00, Thu"). Today only `originalSlotId` exists and that is the ARRIVAL slot, not the dispatch
  slot — confirmed absent.
- **One `order_status_logs` row per roll** (the same log that already records hold/cancel).
- **The 1d / 2d age badge already works** (`floor-table.tsx` `ageDays`) — no change needed there.

**What must be added (from discovery, this session).**
- Two new columns on `orders`:
  - `originalDispatchTargetDate  DateTime? @db.Date`
  - `originalDispatchWindowId    Int?`
  — to preserve the first-assigned dispatch slot.
- A nightly cron: new route `/api/cron/floor-carryover`, one line in `vercel.json`. Runs once per day
  (Vercel Hobby = once daily, UTC only, fires anywhere within the specified hour — `CLAUDE_CORE.md §4`).
  Midnight IST ≈ 18:30 UTC; exact fire time drifts within that hour — acceptable, nobody picks at
  12:30am.
- The roll writes `dispatchTargetDate` + `dispatchWindowId` to the new day's first slot, copies the
  old values into `originalDispatch*` the FIRST time only (never overwrite an already-set original),
  and writes the log row — all folded into the ONE `orders.update` (shared landmine above).

**Build order (separate sessions).**
- **Session B** — add the two columns via Supabase SQL Editor, `npx prisma generate`, backfill
  `originalDispatch*` for bills already on the floor. No UI change.
- **Session C** — build the cron route + `vercel.json` line; test by MANUAL trigger BEFORE letting it
  run on a schedule.
- **Session D** — watch the real board for a few mornings: confirm leftover local bills land in the
  first slot, the original slot survived, history reads right.

### P2 — Floor frozen row number — DEFERRED (answer the open question from real use first)

**The issue.** After this session's sort fix, rows no longer jump on assign/done. But a row already in
a picker's hands can still be pushed DOWN a number when a NEW or MARK-URGENT bill sorts in above it
(seen live: MAHALAXMI marked urgent pushed Swami Colour Co from #6 to #7 while Sunil was picking it).
The desk operator walks the list top to bottom, so work re-appearing above where he has already
scanned is the concern.

**Why deferred (not broken).** The constant shuffle — on every assign and every done — is fixed and
shipped (`661e4e61`). What remains is a rare, deliberate, operator-initiated slide. Not worth building
blind; real floor use will show whether it matters, and will answer the open question below.

**The fix if built.** Freeze a row's position the moment a picker is assigned: stamp its current
number into a new nullable column (e.g. `orders.floorSequence Int?`), held across assign/done/check,
cleared on unassign/hold/cancel. New and urgent bills then shuffle only among WAITING rows, filling
leftover positions — never above a picker's row. Confirmed this needs a NEW column: `sequenceOrder`
(tint queue) and `pick_assignments.sequence` (only exists after assign) cannot be reused. Same single-
`orders.update` landmine applies.

**Open question to answer FIRST (from real use).** When a bill is DONE and CHECKED, does it KEEP its
frozen number, or RELEASE it back so waiting bills can use that position? Cannot be answered from a
screenshot — needs a few days watching a real end-of-day board. Answer this before building.

---

## Billing v2 (opened 2026-08-04, from `CLAUDE_MAIL_ORDERS.md §23.5`)

**The pilot is over.** `billing_settings.rolloutStage = ALL_USERS` since 2026-08-06 (live 2026-09-18,
Q01), so every holder of `mail_orders` gets the billing face. Canon: **`docs/CLAUDE_BILLING.md`**
(v1.0) — its §12 lists the desk's own open items; the Orders-tab internals stay in
`CLAUDE_MAIL_ORDERS.md §23`. Ordered:

- ~~**P1 — Data-audit + plumbing session, THEN widen rollout.**~~ **The rollout half is DONE**
  (ALL_USERS, above). Whether the dual-write audit (orders → Floor; Floor → Picking) ran first is
  not recorded anywhere; if it matters, run it now as its own session.
- **P1 — Clear the test-marked "done" bills** created during the pilot (22 rows carried
  `invoicedAt` as of 2026-08-04 — re-SELECT). The rollout went ahead without this; the rows may
  still sit in real history.
- **P1 — Ship-to option-(a) ungating** — billing face reads master data, Table view reads the
  keyword cache; ungate the FK fix for everyone AFTER a legacy id/text agreement SELECT.
- **P2 — Global rename Mail Orders → Billing — RE-SCOPED.** The sidebar label reads "Billing" for
  everyone since `bf218da8` (2026-08-06; `lib/permissions.ts:65`). Only the route (`/mail-orders`)
  and the page key (`mail_orders`) still say mail-orders, and renaming a page key rewrites live
  `user_page_access` rows — owner decision.
- **P2 — Table-view retirement** — per `archive/RETIREMENT-PLAYBOOK.md`, its own careful session.
  Under ALL_USERS the Table view is unreachable (`CLAUDE_MAIL_ORDERS.md §9.1`); the code is intact.
- **P2 — Retire the dormant flag-OFF face** — collapse the `billingV2 ?` forks, delete the OFF
  paths, retire the orphaned `components/billing/billing-order-info.tsx` (no importer,
  `CLAUDE_BILLING.md §11`). Owner decision (`CLAUDE_BILLING.md §2`, §12).
- **P2 — Violet "Already invoiced" info-row UI polish** (deferred by Smart Flow 2026-08-02).
- **OPEN QUESTION — notes plumbing:** `mo_orders.notes` has no enrichment carry line and Floor reads
  no `orders.remarks`; whether billing notes should reach Floor is a product decision
  (`CLAUDE_MAIL_ORDERS.md §23.5`).

---

## Floor Control — slot-suggestion follow-ups (opened 2026-08-03, tracked 2026-08-05)

From the shipped suggestion layer (`CLAUDE_FLOOR.md §8`); counts are AS OF 2026-08-03 — **re-SELECT
before acting on any of them**:

- **P1 — Backfill decision.** 73 auto-slotted rows sit in a window the corrected clock rule would
  change (63 window-only, **8 date-moves — think hard before moving bills across days**, 2 now
  declining); separately **85 unmatched bills have no slot at all**. Step B is forward-only — neither
  set drains on its own. Any backfill must skip `dispatchSlotSource='manual'`.
- **P1 — `arrivalSlotId` Morning defect** — same fake-clock root cause, different field, still
  unfixed: `resolveArrivalSlotId` has no time guard, so every manual-SAP bill buckets to Morning
  (`CLAUDE_IMPORT.md §12` / landmines).
- **P2 — `dispatchSlotRuleId` clear-on-manual** — one-line fix: Floor's change-slot writes
  date+window+`source:'manual'` but leaves the engine's rule id (6 contradicting rows as of 08-03).
- ~~**P2 — Auto-confirm for HIGH-confidence suggestions**~~ · ~~**P2 — Tint split-OBD suggestions**~~ ·
  ~~**P2 — `card.tint.completedAt` IST render**~~ · ~~**P2 — Mixed-slot amber warning** on the assign
  bar~~ — **CLOSED 2026-09-19, premise gone.** All four lived on the rail or the assign bar. The rail
  retired (`79bcc412`, `CLAUDE_FLOOR.md §9c`), the suggestion layer has no importer
  (`CLAUDE_FLOOR.md §8`), and `components/floor/assign-bar.tsx` is an orphan (orphan item under
  `## Opened by the 2026-09-18 canon sweep`). Reopen against the trip desk only if suggestions come
  back.

---

## Floor Control — inherited Support-board gaps (verified still real 2026-08-05)

From the 2026-07-27 parity discovery (G-list), each re-checked against today's Floor before listing —
the resolved ones (tint pre-set G2, carry-over G5-old, priority G17, resolver G7 = tracked above) are
NOT repeated:

- **P2 — No undo of a release (G1) — RE-SCOPED 2026-09-19.** The rail it assumed is gone
  (`CLAUDE_FLOOR.md §9c`), and since `b3dfe5b8` most bills are released by import, not by a person
  (`CLAUDE_IMPORT.md §2.1`). Still true: Floor's action set is mark-urgent / change-slot / hold /
  cancel / restore (`CLAUDE_FLOOR.md §4.1`), and nothing returns a released bill to `pending_support`
  except Cancel→Restore, which lies in the audit trail. Owner question: does the trip desk need an
  "un-release" at all?
- ~~**P1 — No bulk release/hold from the rail (G3).**~~ **CLOSED 2026-09-19, premise gone.** The rail
  retired; held bills have a bulk release on the Hold tab's bar (`floor-page.tsx:1010`,
  `CLAUDE_FLOOR.md §4.2`). The live gap is different — a `pending_support` row has no Release on the
  desk at all — and is its own item under `## Opened by the 2026-09-18 canon sweep` → Floor.
- **P2 — Cancel records no reason (G4).** `/api/floor/actions` accepts a `reason`; the UI never
  sends one — every cancellation logs "Cancelled from floor". Support had a six-reason dialog.
- **P2 — Cancelled tab is today-only (G5)** — yesterday's cancellation can never be un-cancelled
  from Floor (`CLAUDE_FLOOR.md §3`).
- **P2 — No CSV export of the day's board (G6)** — only the Hold-report PDF exists.
- **DECIDE — arrival-slot view + day-progress tiles (G8).** Does the depot still think in
  Morning/Afternoon arrival slots and "% done today"? If no, close as a deliberate drop; if yes,
  Floor needs an arrival view.
- **DIAGNOSE — contradictory-state bills (G9).** `pending_support` WITH `dispatchStatus='dispatch'`
  — the mirror image of the 103-NULL parked issue. Re-check it against `floorBoardWhere`'s arms
  (`CLAUDE_FLOOR.md §3`): the old rail feed is now board arm 2 (`floorUnslottedWhere`, which wants
  `dispatchStatus: null`, `lib/floor/queries.ts:160-161`). Run the count; fold into that diagnosis
  session.

---

## Picking — measurement + follow-up queries (opened 2026-08-04)

- **P2 — articleTag / manual-SAP correlation query** — 17% of the live queue had null `articleTag`
  (2026-07-17 sample); every null-tag sample also had `sapStatus: null`. The dedicated follow-up
  query was never run; Auto-Import being LIVE (not paused) strengthens the manual-SAP hypothesis
  (`CLAUDE_PICKING.md §7`).
- **P2 — Real pick durations** — the 30m/60m elapsed thresholds are still a guess; the 2026-07-29
  test plan asked the floor to time 3-4 real picks and no numbers came back.
- **P1 — Bring the two picking PHONE boards onto the SOFT duplicate-SO treatment** (opened
  2026-08-25). Floor moved its surfaces (`floor-table.tsx`, `detail-panel.tsx`; the third,
  `rail-card.tsx`, was deleted with the rail in `79bcc412`, and the same commit turned Floor's
  row wash off — `floor-table.tsx` keeps the soft tag and a thin bar, `CLAUDE_FLOOR.md §4.9`)
  from the solid red fill to the soft treatment — a `#fef2f2` ground with a
  3px `#ef4444` inset left bar, all text and badges at their ordinary tokens, and the tag reading
  **"SAME"**. **`components/picking/picking-board-mobile.tsx`, `picker-my-picks-board.tsx`,
  `card-atoms.tsx` and `bill-symbols.tsx` were deliberately left on the SOLID fill**, so today a
  Same-SO bill looks like one thing on the phone and another on the desk. That is a known,
  accepted split, not a miss: restyling those files is a PICKING change and needs this module's
  sign-off (`CLAUDE_FLOOR.md §1` — Floor reuses Picking as a CALLER and does not modify it).
  ⚠ **THE MECHANISM ALREADY EXISTS — do not rebuild it.** `components/shared/duplicate-so-tag.tsx`
  now owns BOTH treatments: the original `DUP_SO_*` tokens (untouched, still what Picking reads)
  and a parallel `DUP_SO_SOFT_*` set, with a `variant?: "solid" | "soft"` prop on `DuplicateSoTag`
  that DEFAULTS to `"solid"`. Bringing a picking board across is: pass `variant="soft"`, swap its
  fill/border tokens for the soft pair, and delete the white-on-red flips (`DUP_SO_BADGE_CLASS`
  and friends) that only existed so badges would not vanish into the fill — the soft variant needs
  none of them. Note the label change too: "Same SO" → "SAME", one word, because the second word
  was clipping the floor table's 14% OBD track; the phone cards have more room, so decide there
  whether they keep the longer wording or match.

---

## Ops scripts — owner decisions (opened 2026-08-05)

- **The undocumented Frt/Breakwalls pipeline:** `docs/Powershell/0-FrtIngestion.ps1` (watches Outlook
  for the daily Frt Report email) + `3-PendingFetch.ps1` + `4-LogisticsEntry.ps1` (Breakwalls batch
  import) — untracked, in NO canonical file, surfaced by the 2026-08-04 reconciliation. Decide:
  document (whose module?), track in git, or remove.
- **`web-update-2026-07-14-po-save-draft-sent-feature.md` locate-or-reauthor** — already tracked
  under "Consolidation follow-ups (2026-07-16) → Place Order"; repeated here only as the standing
  blocker for documenting `/po` Drafts/Sent.

---

## Mail Orders cleanup (opened 2026-09-01, from the write-route permission fix)

Left over from `mail-orders: gate 11 write routes on mail_orders/canEdit` — the guards shipped; these
three did not. Evidence for all three: `docs/prompts/archive/2026-09/code-discovery-2026-09-01-mail-orders-gate.md`.

- **[P3] `[id]/punch` is a route with no button — wire it or remove it.** Its `onPunch` prop is
  threaded four component levels (`mail-orders-page.tsx:1465` → `mail-orders-table.tsx:49 → :118 →
  :219 → :258 → :286 → :331 → :629`) and **never invoked** — `grep "onPunch("` returns nothing.
  Punching actually happens through `[id]/so-number` PATCH, which sets `status: "punched"`,
  `punchedAt` and `punchedById` itself (`so-number/route.ts:43-51`). The route is gated and live but
  unreachable from the UI. Decide: wire the button back, or retire the route per
  `archive/RETIREMENT-PLAYBOOK.md`. ⚠ Do not assume it is dead data — it is a live *address*.
- **[P2] A 403 is silent on four of the eleven — no toast, console only.** `note`
  (`review-view.tsx:936`), `split` (`mail-orders-table.tsx:1527`, `review-view.tsx:956`),
  `lines/[lineId]/status`, and `learn-customer` (`lib/mail-orders/api.ts:145-147`, which swallows
  every error by design) all fail into `console.error` with nothing on screen; the four handlers in
  `mail-orders-page.tsx` refetch and visibly revert the optimistic row, also with no message.
  **This became a real gap on 2026-09-01** — before the fix these routes could not return 403, so a
  denial was not a reachable state. Nobody is affected today (all six canView holders also hold
  canEdit), but the symptom of any future narrowed grant is "the button does nothing". Add error
  surfacing.
- **[P3] `backfill-enrich` and `backfill-customers` — confirm not needed, then retire both.** Zero
  callers each; neither is reachable from any button. `backfill-customers` (POST, session+canEdit) is
  a finished one-time job kept "for emergency" per `CORE §13`. `backfill-enrich` is worse: its GET is
  now admin-gated (2026-09-01) but it still runs the **v1** enrichment, six args, no
  `productProfiles` — `CONTEXT_v56.md:113-116` says by name *"Do NOT use it for re-enrichment"*, and
  live enrichment is v3. Both still carry `TEMPORARY`/one-time labels. `re-enrich` is the maintained
  tool and **stays** — it has no UI by design. Retire the two per the playbook.

---

## CI — Goods Return Note (opened 2026-09-03, from the module inventory)

Canon: **`docs/CLAUDE_CI.md` v1.0**. The module went from first table to register
export in four days and nineteen commits (`e8695f40` 2026-08-31 → `3b0d04b7`
2026-09-03). Everything below is what it deliberately does NOT do yet.

### Shipped 2026-08-31 → 2026-09-03
- Three tables + five CHECK constraints + the 8-row depot-editable reason master.
- Supervisor's phone face (New + Submitted), billing's desk rail + pane, twelve API routes.
- Auto-CI from a confirmed picking finding on an invoiced bill (`618f67fc`).
- The division number on both detail screens, every bill (`bf3e59bf`).
- The 17-column register export as .xlsx (`3b0d04b7`).

### ~~P1 — `/ci` into `PAGE_NAV_MAP`~~ — DONE (`55c3cdc6`, 2026-08-31)
`lib/permissions.ts:102` carries `{ pageKey: "ci", label: "CI", href: "/ci" }`, added by
`55c3cdc6` ("ci: billing desk face + nav entry") — before this item was written. Two code
comments still say otherwise (`app/ci/page.tsx:57-62`, `lib/permissions.ts:300-303`); they are
in the stale-comment clean-up under `## Opened by the 2026-09-18 canon sweep`. Detail:
`CLAUDE_CI.md §13 CI-16`.

### P1 — Abandoned-draft sweep
**17 drafts against 14 real CIs** (live, 2026-09-03) — more abandoned drafts than
returns. Harmless today: every feed filters `status <> 'draft'`, and a draft with
zero lines can never be submitted. But it grows, and nothing prunes it. Needs an
owner ruling on the age cut before anything is written, and it must never touch a
draft that has lines and a live editor on it.

### P1 — The old-MFG arm of the auto rule is PROVISIONAL
Owner ruling 2026-09-03: a confirmed `old_mfg` finding raises a CI for the whole
line even at a full count (nothing is short, but the stock is held, so it comes
back). **Raise now, review after testing.** ⚠ There is deliberately NO feature
flag — a switch built for a decision nobody has made is a second code path
forever. This item is the review, not a toggle. `CLAUDE_CI.md §9`.

### P1 — SAP reason codes (register column J)
Billing's Excel carries a 32-item SAP reason dropdown OrbitOMS does not hold. It
is a **separate field** from `ci_reason_master`, whose 8 plain-English labels
populate column K (REMARK); column J exports blank. If implemented it is a second
master table (`ci_sap_reason_master`) plus one column on `ci_returns` — **never** a
widening of `ci_reason_master`, which the depot edits and which feeds the other
column.

🔴 **The strings below are SAP's, copied verbatim. "cusomer", "Trasfer",
"Spornsorship" and "Eevent" are how the dropdown reads, and the inconsistent
spacing and casing around the hyphens is theirs too. A corrected spelling will not
match SAP.**

```
101-FI Master Data
102-FI Pricing
103-FI Incorrect Fees
201-QA Product
202-QA Pack
203-QA Label
204-QA Re call
205-QA Mixing/Tinting
301-LO Product/Qty error
302-LO Delivery fail
303-LO Damaged goods
304-LO Docs/Labels error
305-LO Shelf life error
401-EX Wrong order entry
402-EX Wrong advice
403-Ex Mkt & oth Service
404 - Ex PreDel No skt Now
501 - Co Right of Return
502 - Co Dry Docking
503 - Co Pos Material
504 - Co sample
505 - Co Promotions
506 - Co Customer SLOBS
507 - Co cusomer Error
508 - Co Exp Product
509 - Co Asmt Chg - Restyle
510 - Co Customer Terminate
511 - Co Trasfer Stock
512 - Co Donations
513 -  Co Spornsorship
514 - Co Eevent Trainning
515 - Co Service Provided
```

Count: **32**.

### P2 — The four register columns with no source
`L Mtrl in Depo Y/N`, `M MATERIAL STATUS`, `Q remark2` have no source in this
schema at all and would need new columns and new form fields. `J REASON` is the
SAP list above.

⚠ **`I NON TINTED` is NOT on that list. It is blank by RULING, not by absence** —
it is a one-line rollup over `import_raw_line_items.isTinting`, and the owner ruled
it stays blank in v1 (2026-09-03). Whoever "discovers" `isTinting` has not found a
gap.

### P2 — A4 print sheet for a CI
MRN has one (`app/mrn/[mrnId]/sheet/page.tsx`); CI does not. The route comments
already anticipate it ("the eventual print sheet"), and `lib/ci/derive.ts` exists
partly so a sheet and the screens cannot disagree about totals.

### P2 — `returned_to_floor` has no UI
In `chk_ci_returns_status` and in the `CiStatus` union since day one, **written by
nothing**. The question it stands in for was answered the other way (billing tells
the floor; he fixes it himself). Keeping the value costs nothing; ALTERing a live
CHECK later does not.

### P2 — The void path has never run in production
Zero voided rows. The columns, the allocator's deliberate `isVoided` exception
(`CLAUDE_CI.md §13 CI-3`) and the read filters all exist; no UI writes them. First
real void will exercise code nothing has exercised.

### P2 — A frozen auto-CI is reconciled by hand only
When billing has already closed an auto CI and a later confirm changes the due
lines, `lib/ci/auto.ts` refuses to touch it and logs `console.error`. That log **is
the entire alerting mechanism** — someone must read a Vercel log to know. No
surface shows it.

### P2 — A second register for CIs above ₹10,000?
The sheet is named `CI DATA BELOW 10000RS` and the export applies **no value
filter** (owner ruling: every closed CI in the range, whatever it is worth).
Whether a second register exists upstream is unanswered. If it does, the answer is
one clause in `getCiRegisterRows` — do not guess a threshold and do not build a
split.

### P2 — Register cell types G / H / P
`CI Qty` (litres), `CI Order value ` and `DIV` are written as **numbers**; the
original spec named only dealer code and CI Order no as numeric. Revisit if
billing's macro turns out to want text. One line in `buildCiRegisterWorkbook`.

### P2 — `ci_return_lines` has zero CHECK constraints
Nothing at the database level enforces `returnedQty >= 1`; the rule lives in
application code in two places (`PUT /lines` 400s, `lib/ci/auto.ts` skips). Fine
today — worth a CHECK if a third writer ever appears.

### P2 — Only 4 of the 8 reasons have ever been used
Live: Physically Cross 7 · Wrong Order by S.O. 3 · Return by Dealer 3 · Order
Cancel by Dealer 1. Double Order, Wrong Punching, Re Bill and Complaint Material
have never been chosen. Worth asking the depot whether they earn their place
before the SAP list lands beside them.

---

## `/po2` — the v2 order page (LIVE 2026-09-10)

**v2 is live at `/po2`.** It moved from the hidden address `/po-v2-8f4kd2` on 2026-09-10; the old
address is a permanent redirect to `/po2` (P3 below removes it). It is **PUBLIC, exactly as `/po`
is** — no session, no `PageKey`, no `PAGE_NAV_MAP` row, and no middleware change was needed,
because `PUBLIC_PATHS` carries `"/po"` and the gate is a `startsWith` prefix match.

`/po` is **still live and unchanged.** The two run side by side until the cutover below.

**`/po9` exists (2026-09-15)** — the SAME `PoV2Page` component mounted with `shipToEnabled={false}` (`app/po9/page.tsx`, a mount not a fork; its own manifest, id `/po9`). ⚠ It shares phone storage with `/po2` — every `po2_*` key — so a `/po2` draft carrying a ship-to opens on `/po9` and shows it read-only.

Canon: **`docs/CLAUDE_PO2.md`** (v1.0, 2026-09-18) owns `/po2` and `/po9`; its §16 points back at
the items below. Build record (history): `docs/prompts/archive/2026-09/code-update-2026-09-08-po-v2-board.md`. Its
wire is guarded by **`scripts/po-v2-email-fixtures.ts`** — run it before any commit that touches
the send path.

### P0 — 🔴 `/api/order/data` is an unauthenticated full-catalogue dump
The ONE route `/po2` calls, and it is **wide open**: no session, no token, no rate limit, no
origin check. Any request returns **every customer name, code and area the depot holds**
(`mo_customer_keywords`) plus the entire active product catalogue and pack list. Putting a login
on the page would change nothing while this stands.

⚠ **GATE IT ON ITS OWN, IN ITS OWN COMMIT, AND SHIP NOTHING ELSE WITH IT.** The route is shared
by `/po`, `/po2` and (through its sibling) `/place-order`, and it **swallows its own errors and
answers 200 with empty arrays** (`route.ts:140`). So a wrong gate does not throw — it hands a
salesman standing in a shop a board with no products and no explanation. Prove who calls it
first, then verify `/po` still loads a full board **while logged out** before and after.

### P2 — Retire `/po`, per the playbook — NOT SCHEDULED
🔴 **Read `archive/RETIREMENT-PLAYBOOK.md` before any of it**, and run the **successor-parity
gate first** — `/po2` must prove it does at least as much as `/po`, feature for feature, before
`/po` is touched. That gate is not a formality: it caught a real gap last time, when `/order`
turned out to offer a **Hold** dispatch option `/po` does not.

### P3 — Remove the `/po-v2-8f4kd2` redirect
`app/po-v2-8f4kd2/page.tsx` is a server redirect to `/po2`, kept so anyone with the old address
typed, bookmarked or installed keeps working through the switchover. ⚠ It does NOT rescue an
installed PWA — `/po2`'s manifest `id` is `"/po2"`, so the old shortcut stays a separate app,
which is why the rollout instruction is "delete the old Orbit app first". Remove this once the
team has moved. (Unlike `/order`, which was parked with a 404 because it had no successor.)

### ~~P2 — Fav block on the board~~ — SHIPPED (`a988ab41` + `f4c0444c`, 2026-09-09)
The Favourites block and its gear control are live (`po-v2-page.tsx`, "THE FAVOURITES BLOCK";
key `po2_fav_products`, `v2-storage.ts:36`). It was built on `localStorage`, so favourites are
per phone. `CLAUDE_PO2.md §9`.

### P2 — Three board tiles still have no tin photograph
**GVA, Hydro PU and Thinner & More** (`TILE_IMAGES`, `app/po2/v2-data.ts:393-420`, re-checked
2026-09-19). Thinner's file is on disk but deliberately undeclared — the picture is not of the
product (`v2-data.ts:397-403`). A tile with no art shows the family wash, which is
the board's own treatment for a photo that has not arrived, so this is a gap and not a defect.
`CLAUDE_PO2.md §6`.
⚠ A tile borrows art by **alias, never by copy** (`TILE_ART_ALIAS`), and the alias redirects the
FILE and never the SLUG — a slug is also the stem `variantImage()` builds variant tins from.

### P3 — Product and membership tweaks — ongoing, no fixed scope
Individual products will move between tiles as real use shows what is wrong. Re-rank
**deliberately, never on every deploy**: the board must not reshuffle under a salesman who has
learned where things are.

### ~~P1 — DECISION OPEN: the storage model, local or database~~ — DECIDED IN PRACTICE: per phone
The favourites block shipped on `localStorage` (`a988ab41`, `f4c0444c`), so the question this item
held open was answered by the build: every `po2_*` key — live draft, saved drafts, sent orders,
favourite customers, my dealers, starred dealers, favourite products — lives in one phone's
`localStorage` and is shared by `/po2` and `/po9` (`CLAUDE_PO2.md §8`). Nothing is shared between
devices and nothing survives a cleared browser or a new handset. Moving to server storage would now
be a new item, not this decision.

### P3 — Fourteen `font-extrabold` (800) sites left in `app/po2`
Re-derived 2026-09-19: `grep font-extrabold app/po2` finds 14 — `product-drawer.tsx` 8,
`review-screen.tsx` 5, `product-search.tsx` 1 — and zero inline `fontWeight: 800`. They include
**Send order** (`review-screen.tsx:666`) and the drawer's **Cancel** / **Add** (`product-drawer.tsx:1024`,
`:1034`). T11 in the type scale.

### P3 — Four manifests exist; consolidate once `/po` retires
`public/manifest.json` (the app, `background_color` `#f9fafb`), `public/po.webmanifest` (`/po`),
`app/po2/manifest.webmanifest/route.ts` (`/po2`) and `app/po9/manifest.webmanifest/route.ts`
(`/po9`, added `23804504`); the two v2 handlers build from `app/po2/v2-manifest.ts`. ⚠ Do NOT
merge them while more than one of `/po`, `/po2` and `/po9` is installable: the separate
`id`/`scope`/`start_url` is what keeps the home-screen apps from folding into one
(`CLAUDE_PO2.md §13` landmine 5).

### P3 — `public/brand/` is an unreferenced icon set with superseded letterforms
Three PNGs (`apple-touch-icon`, `icon-192`, `icon-512`) plus `orbit-wordmark.svg` and
`orbit-wordmark-white.svg`, all dated 2026-09-07 and carrying the OLD hand-built wordmark
(viewBox `0 -22 2216 771`, aspect 2.874) rather than the generated Plus Jakarta Sans outlines
(`0 0 2316 769`, aspect 3.012). v2 stopped pointing at them 2026-09-10; **nothing in `app/`,
`components/` or `lib/` references any of the five now.** Clear in a cleanup pass — not urgent,
and they are the only copy of that drawing.

### P3 — `CROSS_DEPOTS` exists three times and the copies must be edited together
`app/po/po-page.tsx:89`, `app/po2/v2-data.ts:1818` (exported) and
`app/(place-order)/place-order/components/cart-panel.tsx:76` each hold their own
`["Dahisar", "Ahmedabad", "Rajkot", "Pune"]`. v2 got a copy rather than an import because it
modifies nothing outside its own folder and `/po` is live; unify them into one shared const when
the containment fence comes down at cutover. ⚠ Neither copy validates a stored `crossDepot` —
drafts predating the picker hold hand-typed depots and must keep emailing exactly as typed.

### P3 — Rename the `URGENT` token to `DANGER` in `v2-data.ts`
Cosmetic — the **value is already correct**. After the red/amber correction that token is never
urgency; it is the destructive red, surviving at exactly four places, all destructive. Only the
name lies. Do it the next time `v2-data.ts` is open.

### P3 — A three-line note clips in the order sheet
Known and accepted, recorded in the v2 record. Parked here so it is not rediscovered as a bug.

### P2 — Catalog defect: `FASTYELLOWGREEN` is missing its spaces
Universal Stainer option, **`mo_order_form_index_v2` row 21700**. Its nine siblings on the same
product are all spaced — FAST YELLOW, FAST GREEN, FAST BLUE, FAST VIOLET, FAST RED, FAST ORANGE —
and only this one runs together. As a single unbreakable 15-character run it is **the widest string
in the whole v2 tile set** (~111px against an 88px rail cell), and on 2026-09-09 it forced a
grid-wide font shrink to 9px before the ruling was corrected. It is now contained by
`overflowWrap: "anywhere"` on `TileName`, which breaks it mid-word — deliberately ugly, and the
reason this item exists.

**The fix is a string correction, NOT a UI change.** Do not special-case the value in code.

⚠ **It is a SEED-OWNED value.** A live SQL edit alone is reverted by the next reseed
(`CLAUDE_PLACE_ORDER.md §18`). The correction has to land in the **seed / review CSV and live
together**, so this needs its own step — it is not a one-line UPDATE.

### P2 — v2 tools step by 1 where v1 steps by 25 / 12 / 500
**31 live products** — 9 brushes at `12PC`, 21 rollers at `25PC`, 1 stickers row at `500PC`
(counted from `mo_sku_lookup_v2`, 2026-09-09). **Cause:** `formatPack` collapses every PC pack to
the single string `"1 pc"`, so a label-keyed lookup can never reach `PIECE_BOX_STEP` — only
`packStepForPack(packCode, unit, productKey)` sees them, and v2 has no `packCode` at a step call
site. Fixing it means threading the `ApiPack` object through `PackList` / `PackRow` instead of the
label string, which is a **drawer data-shape change, not a shim**. Search-only today — none of the
31 is on the board. **Owner deferred 2026-09-09.**
⚠ **The successor-parity gate WILL flag this. It is known, not new** — do not re-diagnose it, and
do not "fix" it by keying anything off the `"1 pc"` string.

⚠ Beside it, not in scope today: **v2 keeps its own `formatPack` copy** at `v2-data.ts:584`,
behaviourally identical to `lib/place-order/pack.ts:23` — a second duplicate-owner candidate of the
same shape as the step table that `e16f7a59`/this commit just retired.

### P2 — Three stale comments left over from `23a4a502`
That commit corrected five lying comments in `v2-data.ts` and reported three more it did not own.
Each states something false about the code; none breaks anything, and comments of exactly this
kind have already been believed by a later session twice in this folder.
- 🔴 **First, and the loudest.** `v2-data.ts:1961-1964`, the `BOARD` section header: it says BOARD
  is *"ADDITIVE, AND NOT YET CONSUMED BY ANYTHING"* and that *"FAMILIES still holds the live"*
  board. Both are false — BOARD **is** the live board.
- `po-v2-page.tsx:964`, `:990`, `:1011` — three *"Step 4"* notes describing tile-wide
  replace as future work. It is done: both `addLines` call sites already pass `memberSap: null`.
- `po-v2-page.tsx:2319-2321` says *"all 36"* twice and `:309` says *"the 9x4 board"*. It is
  **37 tiles across nine families**, and Wood holds five.
- The full table of `/po2` stale comments (eleven rows) is `CLAUDE_PO2.md §13`; this item and the
  consolidated stale-comment clean-up under `## Opened by the 2026-09-18 canon sweep` are one pass.

---

## Documentation hygiene

### Schema docs consolidation cadence
Every 2-3 weeks: consolidate `docs/prompts/drafts/` into canonical files using the consolidation prompt. Archive consumed drafts to `docs/prompts/archive/YYYY-MM/`.

Last cycle: **2026-09-18/19 — the canon sweep** (report `docs/prompts/drafts/code-discovery-2026-09-18-canon-sweep.md`; batches N → A/B1/B2 → C; three new canon files, `CLAUDE_FLOOR_TRIPS.md`, `CLAUDE_PO2.md`, `CLAUDE_BILLING.md`). `FLOOR-TO-FLOOR-DISCOVERY.md` still sits at the repo root, outside the drafts convention; `CLAUDE_FLOOR_TRIPS.md` now holds its facts and names it history. Cycle before: **2026-08-04/05 — the full reconciliation cycle** (method v1.1, 12 canonical files verified claim-by-claim against code + live DB + git; 11 drafts archived to `docs/prompts/archive/2026-08/`; this status pass is its final step before 12b's router/CORE finish). Prior cycles: 2026-06-18 (29 drafts), 2026-06-02.

### `taxonomy-preview.json` path

Lives at `docs/prompts/archive/drafts/2026-04-to-05/taxonomy-preview.json`. The seed reads from this path — DO NOT move it without updating the seed.

---

## Change log — canon sweep pass 2026-09-19 (batch C)

Every item re-checked against code at `b574cecc` (grep / `git show`), the live results of 2026-09-18,
and the canon files as reconciled by batches N, A, B1 and B2. Closed items keep a struck-through
record in place. **19 closed · 13 re-scoped · 38 added.**

- **Stamps.** Header and footer both read 2026-09-19. They had disagreed (header 2026-09-06, footer
  2026-08-09), and twelve commits after `fd2c7249` touched this file without bumping either:
  `54714f72`, `eb34532c`, `d8fcf1ed`, `7cb2074e`, `aa525bd4`, `ebc54c38`, `fdf31da8`, `c4a4eb90`,
  `120cc5a3`, `d17354ce`, `145b5f32`, `23804504`.
- **CLOSED (19):** `/ci` nav entry (`55c3cdc6`) · tint-summary role grant (`6f628b05`) · TM reorder
  `$transaction` (`a0f9378b`) · `/po2` Fav block (`a988ab41`, `f4c0444c`) · `/po2` storage decision
  (per phone, by the build) · manifest name experiment (`4a2f763f`) · `schema.prisma` stale comment
  (`6f1e35a8`) · the two Mail Orders security bullets (`0f56eede`) · the `slotDefs` email gap
  (`c103d5f4` — nothing was ever sent) · pause kebab (Table view retired) · ship-to name pair on the
  floor table (`07bc5104`) · G3 bulk release from the rail · four slot-suggestion follow-ups
  (auto-confirm, tint split-OBD, `completedAt` render, mixed-slot warning — rail and assign bar gone) ·
  Billing rollout (ALL_USERS, Q01) · the import a/b/c decision (`d8fcf1ed`).
- **RE-SCOPED (13):** partial-qty Done (Kanban gone → new board) · G1 undo release · "pick slot"
  string · unmatched bills' desktop home · G9 contradictory-state bills · desktop supervisor → `/floor`
  redirect · Mail Orders → Billing rename (label done, route + key left) · `billingV2` cleanup → retire
  the dormant flag-OFF face · dispatched-bill lookup (partly done, `551069aa`) · the `dispatched` drain
  (writer with no caller; → `CLAUDE_FLOOR_TRIPS.md §14`) · Floor carry-over (premise check) · soft
  duplicate-SO (`rail-card.tsx` deleted) · `operator/shades` (no in-app caller).
- **CORRECTED counts and anchors:** `requireRole` (20 call sites / 19 beyond ADMIN; all include
  ADMIN) · tiles without art (3) · `CROSS_DEPOTS` (3 copies) · manifests (4) · `font-extrabold` (14) ·
  `logAdminAction` sites (49) · anchors for challan `$transaction`, admin customers, `permissions.ts:127`,
  `NA_IMPORT`, `apply-rules.ts:241`, `next.config.mjs:33-34`, the `/po2` stale comments · the OneDrive
  item's `git status` evidence (gone) · Billing v2 intro (pilot over) · `/po2` canon pointer · the
  `/po` heading (no longer "going-forward") · slide-to-done's colour note (brand is violet) · the
  missing-customer resolver's "Kanban" wording · the slot suggestion marked dormant.
- **ADDED (38):** new section `## Opened by the 2026-09-18 canon sweep` — 🔴 P0 credential file (1),
  Floor/trips (5), Access (5), Tint (2), Import (3), Billing/Mail Orders (2), Attendance (3), Sampling
  (2), Place Order (1, plus a pointer to the existing `/api/order/data` P0), MRN (1), UI (1), one
  consolidated stale-comment clean-up, one orphan-files decision, owner decisions (5), verification
  questions (4); plus "Seven more `$transaction` sites" under Tint Module.
- **New canon now exists:** `CLAUDE_FLOOR_TRIPS.md`, `CLAUDE_PO2.md`, `CLAUDE_BILLING.md` (all v1.0,
  2026-09-18). Items that said trips, `/po2` or Billing had no canonical file now point at them.
- ⚠ `CLAUDE_PO2.md §15`/`§16` cite ROADMAP by line number (`:1531`, `:1540-1667`); this pass moved
  those lines. Its owner should re-point them by heading.

## Change log — status pass 2026-08-05 (reconciliation cycle, method v1.1)

Every existing item verified against the reconciled canon (CORE v91 · UI v5.17 · IMPORT v1.7 · MAIL_ORDERS v1.11 · FLOOR v1.4 · PICKING v1.12 · TINT v1.9 · PLACE_ORDER v1.8 · NOTIFICATIONS v1.2 · ATTENDANCE v1.3 · TRIP v1.1 · SAMPLING v1.6), code, and git. Nothing deleted silently — moot/shipped items keep a struck-through record in place.

- **SHIPPED/DONE marked:** rail slot suggestion (2026-08-03) · desktop isPrimary filter (`46b500fb`) · parser v7.2 go-live (2026-07-15) · assign-bar label duplication (2026-07-26) · challan lazy-creation verification (2026-08-04) · `scripts/_*` tsconfig exclusion · the two-routers question (2026-07-19).
- **MOOT:** the entire Auto-Import un-pause block (LIVE since 2026-06-20; the orphan-policy survivor stays OPEN and live-relevant).
- **STALE WORDING rewritten:** Vercel-Pro premise (cadence, not count) · trip_report field-meanings (10 remain, TRIP §3 lists all 38) · friendly-name recipe (the columns now EXIST, inert) · app-format line-loss bug (status-unclear, re-test) · push-verify blocker (test accounts exist) · parser-copy tracked/version note · sampling merge count (as-of stamp).
- **NEW sections:** Billing v2 (8 items) · Floor slot-suggestion follow-ups (7, counts as-of 08-03) · Floor inherited Support-board gaps (G1/G3/G4/G5/G6 verified still real + G8 decide + G9 diagnose) · Picking measurement queries (2) · Ops scripts owner decisions (Frt/Breakwalls).
- **CONFLICT flagged:** `lib/slot-history.ts` — survivor-list KEEP vs the five-unused-files removal item; per-file owner decision required.
- Footer's stale "Schema v27.6" stamp removed — ROADMAP tracks work, not schema; the counter lives in `CLAUDE_CORE.md §7` (v27.12 + unnumbered 2026-07-3x additions; **v27.13 minting pending — 12b**).

---

*Updated 2026-09-19 — **canon sweep pass (batch C):** 19 closed, 13 re-scoped, 38 added; new section `## Opened by the 2026-09-18 canon sweep` led by a 🔴 P0 credential file; header and footer stamps reconciled (see "Change log — canon sweep pass 2026-09-19"). Prior: 2026-08-09 — **articleTag rule shipped** (`9de0c55b`): the pack rule moved off the depot PC into `lib/article-tag.ts`, catalog-first; ZINR roadmap item superseded, two new Import items opened (backfill of 138 wrongly-tagged + ~19,200 null lines · a `containerType` column for the Drum-vs-Bag blind spot) — detail in `CLAUDE_IMPORT.md §8.2`. Picking **Stage 3 closed**: floor findings shipped (`cd27c976`→`0df656ef`), Billing flag + detail panel with them; the picker's third "Combined" tab (`1ad903ef`/`733fcd6b`) documented at the same time. Prior: 2026-08-05 (full status pass — see change log above); 2026-07-30 — picker "My Picks" face rebuilt on the shared shell (`a2fb6889`→`28986d0a`) + canon pass; 2026-07-28 — Picking DESKTOP board retired; 2026-06-19 — full catalog restructure, `/po` build, Hide feature, Tint Summary, parser v7.2 + Table C. Schema counter: `CLAUDE_CORE.md §7` (not tracked here).*
