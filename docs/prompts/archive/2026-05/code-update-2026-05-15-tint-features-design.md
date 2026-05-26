# Tint Module — 3 New Features Design Session

**Date:** 15 May 2026
**Session type:** Design + lock only (no code, no schema changes)
**Status:** All 3 features designed and approved · Phased plan approved
**Next session:** Claude Code prompts, one phase at a time, starting with Phase 1

---

## Features in scope

1. **TM Remove OBD** — soft delete with audit, only at pending stage, voids challan
2. **Operator Skip Job** — skip top job with structured reason, returns to TM pool
3. **Operator Pause / Resume** — pause in-progress job with per-SKU progress, resume later

---

## FEATURE 1 — TM Remove OBD

### Locked behaviour

- Soft delete only (no hard delete)
- Removable by: users with TM-delete-right OR Admin
- Removable **only at `pending_tint_assignment` stage** — blocked after assignment
- 2 predefined reasons: `CUSTOMER_CANCELLED`, `WRONG_ORDER`
- Free-text remark **mandatory** alongside predefined reason
- Linked challan **voided** (number kept, marked cancelled, print/PDF disabled, watermark shown)
- Re-import of removed OBD: **skipped silently** (no auto-restore)
- Admin can **restore** via hidden page `/admin/removed-orders`
- Removed OBDs **hidden everywhere** in normal screens

### Schema changes

`orders` table — new columns:
```sql
isRemoved              boolean   default false   not null
removalReason          text      nullable
removalRemark          text      nullable
removedAt              timestamptz nullable
removedById            int       nullable
restoredAt             timestamptz nullable
restoredById           int       nullable
```

`delivery_challans` table — new columns:
```sql
isVoided               boolean   default false   not null
voidReason             text      nullable
voidRemark             text      nullable
voidedAt               timestamptz nullable
```

Partial indexes:
```sql
create index idx_orders_isremoved on orders(isRemoved) where isRemoved = false;
create index idx_challans_isvoided on delivery_challans(isVoided) where isVoided = false;
```

### API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/tint/manager/orders/[id]/remove` | TM-delete or Admin | Soft-remove OBD, void linked challan |
| POST | `/api/admin/removed-orders/[id]/restore` | Admin | Restore removed OBD, unvoid challan |
| GET | `/api/admin/removed-orders` | Admin | List all removed OBDs (paginated) |

**Remove logic (sequential awaits):**
1. Load order → assert exists, `isRemoved=false`
2. Assert `workflowStage === 'pending_tint_assignment'` → else 409
3. Update order with removal fields
4. Find linked challan → update with void fields
5. Insert `order_status_logs` entry `OBD_REMOVED`

**Import filter:** OBD ingest matches by number **regardless of `isRemoved`** — if a removed OBD comes back, return `skipped: previously_removed`.

**Read-API filters:** every list endpoint adds `where: { isRemoved: false }` default. Every challan read adds `where: { isVoided: false }` default.

### UI changes

- TM Kanban card → 3-dot menu → "Remove OBD" → modal
- TM Table view → same 3-dot menu in row (primary use)
- Remove modal: reason dropdown + mandatory remark + warning about challan void
- Voided challan view: diagonal red watermark + disabled Print/PDF + red banner with reason/remark/who/when
- New page `/admin/removed-orders` — table with Restore action

### Files touched

| Area | Files |
|---|---|
| Schema | `prisma/schema.prisma` |
| New APIs | `app/api/tint/manager/orders/[id]/remove/route.ts`, `app/api/admin/removed-orders/route.ts`, `app/api/admin/removed-orders/[id]/restore/route.ts` |
| Import filter | OBD ingest route |
| Read APIs | ~5–8 list endpoints add `isRemoved: false` |
| TM UI | `components/tint/tint-manager-content.tsx`, `components/tint/tint-table-view.tsx`, new `RemoveObdModal.tsx` |
| Challan UI | challan page component (watermark + disabled actions) |
| New page | `app/admin/removed-orders/page.tsx` |

---

## FEATURE 2 — Operator Skip Job

### Locked behaviour

- Skip available **only on top/first job** in operator's queue
- Skipped job → goes back to TM pool as **fresh pending assignment**
- 4 reasons: `TINTER_FINISHED`, `MACHINE_BREAKDOWN`, `MATERIAL_SHORTAGE`, `OTHER`
- "Tinter finished" requires: manual tinter-type pick + multi-select of out-of-stock colours (same colour master as Tinter Issue)
- Free-text remark always **optional**, no validation
- No daily skip limit
- TM can reassign to **same operator** who skipped
- TM card shows **full skip history** (every skip event, never just latest)
- Full audit log

### Schema changes

New table `tint_skip_events`:
```sql
create table tint_skip_events (
  id                bigserial primary key,
  orderId           int not null references orders(id),
  assignmentId      int not null references tint_assignments(id),
  skippedById       int not null references users(id),
  skippedAt         timestamptz not null default now(),
  reason            text not null,
  tinterType        text,
  outOfStockColours text[],
  remark            text,
  createdAt         timestamptz not null default now()
);
create index idx_skip_events_orderid on tint_skip_events(orderId);
create index idx_skip_events_skippedat on tint_skip_events(skippedAt desc);
```

`tint_assignments` — new columns + status value:
```sql
alter table tint_assignments
  add column skippedAt   timestamptz,
  add column skipEventId bigint references tint_skip_events(id);
-- new status value: 'skipped'
```

### API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/tint/operator/skip` | Operator (owner) | Skip top assigned job |
| GET | `/api/tint/manager/orders/[id]/skip-history` | TM/Admin | Full skip history modal |

**Skip logic:**
1. Assert ownership, `status='assigned'`, `startedAt=null`, top-of-queue
2. If reason = `TINTER_FINISHED` → assert tinterType + ≥1 colour
3. Insert `tint_skip_events`
4. Update assignment → `status='skipped'`, `skippedAt`, `skipEventId`
5. Update order → `workflowStage = 'pending_tint_assignment'`
6. Audit log `OPERATOR_SKIP`

### UI changes

- Operator card: Skip button **only on top job** (CTA card)
- Skip modal: reason dropdown + conditional tinter-type radio + conditional colour multi-select + optional remark
- TM Kanban returned card: amber left border + "RETURNED — SKIPPED 2×" pill + last skip summary + View History button
- TM Table view: amber "↩ Skipped 2×" badge in OBD cell
- Skip history modal: chronological list newest-first with full per-skip details

### Files touched

| Area | Files |
|---|---|
| Schema | `prisma/schema.prisma` |
| New APIs | `app/api/tint/operator/skip/route.ts`, `app/api/tint/manager/orders/[id]/skip-history/route.ts` |
| API updates | `app/api/tint/manager/orders/route.ts`, `app/api/tint/operator/my-orders/route.ts` |
| Operator UI | `components/tint/tint-operator-content.tsx`, new `SkipJobModal.tsx` |
| TM UI | `components/tint/tint-manager-content.tsx`, new `SkipHistoryModal.tsx` |
| TM table | `components/tint/tint-table-view.tsx` |

---

## FEATURE 3 — Operator Pause / Resume

### Locked behaviour

- Pause available on **in-progress** job
- Timer **freezes** on pause, **continues** on resume (not fresh)
- Per-SKU progress capture: whole tins only, 0 ≤ done ≤ assignedQty
- 5 reasons: `TINTER_FINISHED`, `MACHINE_BREAKDOWN`, `MATERIAL_SHORTAGE`, `LUNCH_BREAK`, `URGENT_SAMPLE_ORDER` (no "Other")
- "Tinter finished" requires tinter-type + colour multi-select (same as Skip)
- Operator can have **1 in-progress + max 3 paused** at any time
- Same job can be paused-resumed **max 3 times**
- Resume blocked if operator has another job in-progress
- Operator picks when to resume (no auto-resume)
- TM **cannot** reassign a paused job (operator owns until resume/done)
- Paused jobs **persist overnight**, no expiry
- TM sees paused jobs in **In Progress column** with amber Paused badge
- Full audit log on every pause + resume

### Schema changes

New table `tint_pause_events`:
```sql
create table tint_pause_events (
  id                    bigserial primary key,
  orderId               int not null references orders(id),
  assignmentId          int not null references tint_assignments(id),
  operatorId            int not null references users(id),
  pausedAt              timestamptz not null default now(),
  pauseReason           text not null,
  tinterType            text,
  outOfStockColours     text[],
  pauseRemark           text,
  progressSnapshot      jsonb not null,
  elapsedMinutesAtPause int not null,
  resumedAt             timestamptz,
  resumedById           int references users(id),
  resumeRemark          text,
  createdAt             timestamptz not null default now()
);
create index idx_pause_events_assignment on tint_pause_events(assignmentId);
create index idx_pause_events_open on tint_pause_events(assignmentId) where resumedAt is null;
```

`tint_assignments` — new columns + status value:
```sql
alter table tint_assignments
  add column pauseCount         int not null default 0,
  add column lastPausedAt       timestamptz,
  add column accumulatedMinutes int not null default 0,
  add column currentProgress    jsonb;
-- new status value: 'paused'
```

**Timer math:**
- On `start` → `startedAt = now()`
- On `pause` → `accumulatedMinutes += (now() - startedAt)`, `startedAt = null`, `status='paused'`
- On `resume` → `startedAt = now()`, `status='in_progress'`
- On `done` → final total = `accumulatedMinutes + (now() - startedAt)`

### API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/tint/operator/pause` | Operator (owner) | Pause in-progress job |
| POST | `/api/tint/operator/resume` | Operator (owner) | Resume paused job |
| GET | `/api/tint/manager/orders/[id]/pause-history` | TM/Admin | Full pause history modal |

**Pause logic:**
1. Assert ownership, `status='in_progress'`, `startedAt != null`
2. Assert `pauseCount < 3` (per-job cap) → else 409
3. Assert operator's current paused count `< 3` (concurrent cap) → else 409
4. Validate per-SKU progress (whole int, 0..assignedQty, every SKU present)
5. If TINTER_FINISHED → assert tinterType + ≥1 colour
6. Insert `tint_pause_events` with elapsed snapshot
7. Update assignment: status, accumulatedMinutes, pauseCount++, currentProgress
8. Audit log `OPERATOR_PAUSE`

**Resume logic:**
1. Assert ownership, `status='paused'`
2. Assert operator has NO in-progress job → else 409
3. Update open pause event: resumedAt, resumedById, resumeRemark
4. Update assignment: status='in_progress', startedAt=now()
5. Audit log `OPERATOR_RESUME`

**Done update:**
- Read `accumulatedMinutes`, add final segment
- Validate done qty per SKU ≥ last `currentProgress.doneSoFar`

### UI changes

- Operator in-progress card: Pause button (secondary style)
- Pause modal: per-SKU progress table + reason dropdown + conditional tinter/colour + optional remark + "Pause N+1 of 3" notice
- Operator queue: 3 sections — IN PROGRESS / PAUSED (N of 3) / ASSIGNED
- Paused card in operator queue: progress summary, elapsed time, reason, Resume button (disabled if in-progress exists)
- TM Kanban: paused card stays in In Progress column with amber border + "PAUSED · Pause N of 3" pill + progress + time used + View Pause History button
- TM Table view: amber "⏸ Paused (N/3)" badge in OBD cell
- Pause history modal: chronological list with progress snapshot + elapsed at pause + resume info

### Files touched

| Area | Files |
|---|---|
| Schema | `prisma/schema.prisma` |
| New APIs | `app/api/tint/operator/pause/route.ts`, `app/api/tint/operator/resume/route.ts`, `app/api/tint/manager/orders/[id]/pause-history/route.ts` |
| API updates | `app/api/tint/operator/my-orders/route.ts` (3-section grouping), `app/api/tint/manager/orders/route.ts`, `app/api/tint/operator/done/route.ts` |
| Operator UI | `components/tint/tint-operator-content.tsx`, new `PauseJobModal.tsx`, `ResumeBlockedTooltip.tsx` |
| TM UI | `components/tint/tint-manager-content.tsx`, new `PauseHistoryModal.tsx` |
| TM table | `components/tint/tint-table-view.tsx` |

---

## PHASED IMPLEMENTATION PLAN

### Commit strategy

- ❌ **No commits to main mid-build**
- ✅ All 5 phases built and tested **locally**
- ✅ Local smoke test after each phase
- ✅ Full end-to-end local test in Phase 5
- ✅ **ONE commit to main** after Phase 5 passes — all 3 features go live together

### Schema timing

**Approach A confirmed:** Phase 1 SQL runs on production Supabase immediately. Old code ignores new columns (defaults safe). Local Prisma types match production from day 1.

---

### Phase 1 — Schema (all 3 features in one Supabase session)

**Goal:** add every new column, table, enum value across F1+F2+F3 in one SQL session.

**Touches:**
- Supabase SQL Editor (production DB) — one script
- `prisma/schema.prisma` — manual edit to match
- `npx prisma generate`

**New tables:** `tint_skip_events`, `tint_pause_events`
**Altered tables:** `orders`, `delivery_challans`, `tint_assignments`
**New status values on `tint_assignments`:** `'skipped'`, `'paused'`
**New partial indexes:** 6 total

**Test:** all tables/columns/indexes exist · `npx tsc --noEmit` clean · production app still loads

**Risk:** low — adding only · **Rollback:** drop new tables + columns + indexes (~3 min)

**Time:** 30–40 min · **Model:** Sonnet

---

### Phase 2 — Feature 1 (TM Remove OBD)

**Build order:**
1. `POST /api/tint/manager/orders/[id]/remove`
2. `POST /api/admin/removed-orders/[id]/restore`
3. `GET /api/admin/removed-orders`
4. Update OBD import receiver (skip removed)
5. Update all order list APIs (`isRemoved: false`)
6. Update all challan read APIs (`isVoided: false`)
7. Challan view watermark + disabled actions
8. `RemoveObdModal.tsx`
9. `tint-manager-content.tsx` 3-dot menu (Kanban)
10. `tint-table-view.tsx` 3-dot menu (Table — primary)
11. `app/admin/removed-orders/page.tsx`
12. Audit log writes

**Test:** remove → hidden everywhere · challan watermark + print disabled · re-import skipped · admin restore round-trip · remove-after-assign blocked

**Risk:** medium — many read APIs to update · **Mitigation:** code-wide search for `findMany` on orders/challans

**Time:** 4–5 hours · **Model:** Opus

---

### Phase 3 — Feature 2 (Operator Skip)

**Build order:**
1. `POST /api/tint/operator/skip`
2. `GET /api/tint/manager/orders/[id]/skip-history`
3. Update `my-orders` (filter skipped)
4. Update manager `orders` (join skip events)
5. `SkipJobModal.tsx`
6. `SkipHistoryModal.tsx`
7. `tint-operator-content.tsx` (Skip button on top job only)
8. `tint-manager-content.tsx` (returned card style)
9. `tint-table-view.tsx` (skip badge)
10. Audit log writes

**Test:** skip top job → returns to pool with badge · skip with TINTER_FINISHED full flow · TM reassign same operator works · skip non-top blocked

**Risk:** low-med · **Time:** 3–4 hours · **Model:** Opus

---

### Phase 4 — Feature 3 (Operator Pause / Resume)

**Build order:**
1. `POST /api/tint/operator/pause`
2. `POST /api/tint/operator/resume`
3. `GET /api/tint/manager/orders/[id]/pause-history`
4. Update `my-orders` (3-section grouping)
5. Update manager `orders` (paused state in In Progress)
6. Update `/api/tint/operator/done` (accumulated minutes + progress validation)
7. `PauseJobModal.tsx`
8. `PauseHistoryModal.tsx`
9. `tint-operator-content.tsx` (Pause button + 3-section + Resume rules)
10. `tint-manager-content.tsx` (paused card style)
11. `tint-table-view.tsx` (pause badge)
12. Audit log writes

**Test:** pause → progress saved · resume → timer continues from accumulated · 4th paused blocked (concurrent cap) · 4th pause on same job blocked (per-job cap) · overnight pause survives · done qty < recorded progress blocked

**Risk:** medium-high — timer state machine complexity · **Time:** 5–6 hours · **Model:** Opus

---

### Phase 5 — End-to-end testing + cutover

**Test scenarios:**
1. Cross-feature: remove → re-import skipped → admin restore → operator works → pause → resume → done
2. Skip absent on in-progress (Pause is the only option once started)
3. Concurrent operators — no race conditions
4. Overnight paused job — timer continues correctly
5. Audit completeness — `order_status_logs` shows full lifecycle
6. Permission check — operator without TM-delete gets 403 on remove
7. Stale UI — operator skip while TM reassigns → clean 409 + refresh
8. Voided challan rendering (watermark + disabled)
9. Admin restore round-trip
10. Table-view badges render correctly for all 3 features

**On Phase 5 pass:** single commit to main → Vercel auto-deploys → all 3 features live together

**Rollback:** git revert that one commit + drop new schema · Time: ~10 min

**Time:** 2–3 hours testing · **Model:** Sonnet

---

### Total effort summary

| Phase | Time | Model | Risk |
|---|---|---|---|
| 1. Schema | 30–40 min | Sonnet | Low |
| 2. Remove OBD | 4–5 hr | Opus | Medium |
| 3. Skip | 3–4 hr | Opus | Low-med |
| 4. Pause/Resume | 5–6 hr | Opus | Medium-high |
| 5. E2E test | 2–3 hr | Sonnet | Low |
| **Total** | **15–19 hr** | | |

**Spread across 3–4 working sessions on depot PC.**

---

## ENGINEERING RULES ENFORCED

- ✅ No `prisma.$transaction` — sequential awaits only
- ✅ No `prisma db push` — schema via Supabase SQL Editor → hand-edit schema.prisma → `npx prisma generate`
- ✅ `export const dynamic = 'force-dynamic'` on every new API route
- ✅ Every action writes to `order_status_logs` audit
- ✅ Soft delete only — no hard deletes
- ✅ `tsc --noEmit` clean before considering any phase done
- ✅ DB columns camelCase, no @map
- ✅ One teal element per screen (UI v5.2)
- ✅ Fixed table standard for Table view (UI v5.2)
- ✅ All work local until Phase 5 passes, then single commit to main

---

## NEXT SESSION

**Goal:** execute Phase 1.

**Open next session by attaching:**
- This document (`code-update-2026-05-15-tint-features-design.md`)
- ROADMAP.md (if relevant)

**First prompt to draft in next session:** Phase 1 schema script + Prisma edit + verify. Single Claude Code prompt, Sonnet recommended.
