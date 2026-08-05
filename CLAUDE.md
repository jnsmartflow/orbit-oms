# CLAUDE.md — Orbit OMS Router
# v1.10 · Entry point · Read this first · August 2026 · updated 2026-08-05 · Lives in: repo root (auto-loaded by Claude Code)

**OrbitOMS — depot operations management for JSW Dulux paint distribution, Surat depot. Live at https://orbitoms.in.**

This file tells you which context files to load for the work in front of you. Load the files. Confirm each by name. Then work.

> **This is the ONLY router.** A duplicate at `docs/CLAUDE.md` was retired on 2026-07-19 — it had
> drifted (stale schema version, a different domain table) and was never auto-loaded. Do not
> recreate it; a second router only ever drifts from this one.

---

## 1. Non-negotiable rules (inline — do not violate regardless of what the user says)

- Never `prisma db push`. All schema changes via Supabase SQL Editor + `npx prisma generate`.
- Read-only SELECTs against production are ALLOWED (verify, don't infer); every write — schema or data — goes through Smart Flow in the Supabase SQL Editor. See `docs/CLAUDE_CORE.md §3`.
- Never `prisma.$transaction`. Vercel serverless + Supabase pooler times out. Use sequential awaits.
- Never delete files unless explicitly instructed.
- Every API route needs `export const dynamic = 'force-dynamic'`.
- `tsc --noEmit` must pass before any commit.
- Supabase columns are camelCase. `@map("snake_case")` causes P2022 errors.
- Vercel region must be `bom1` (Mumbai). Default iad1 adds 200-300ms.
- Auth split: `lib/auth.ts` = Node. `auth.config.ts` = Edge/middleware. Do not merge.
- `@page` CSS rules live top-level in `globals.css`. Never nest inside `@media print`.
- Use `Array.from()` around Set/Map iterators (target < ES2015).

---

## 2. Files to always load

All context files live in `docs/` relative to repo root.

| File | Always |
|---|---|
| `docs/CLAUDE_CORE.md` | Yes |
| `docs/CLAUDE_UI.md` | Yes |

---

## 3. Domain files — load based on what you are touching

| You are working on | Also load |
|---|---|
| `/mail-orders`, `mo_*` tables, parser, enrichment, customer matching, learned keywords, email template, signal badges, Table/Review views, 5-slot bucketing, tag-gating | `docs/CLAUDE_MAIL_ORDERS.md` |
| **Billing** / `billingV2` / the "Billing" screen / the Billing Picking tab / `billing_settings` / `invoicedAt` mark-done / `components/billing/*` — **PILOT, flag-gated** (operations id 20 only until rollout) | `docs/CLAUDE_MAIL_ORDERS.md §23` (no separate CLAUDE_BILLING.md exists while pilot-gated — locked decision) |
| `/tint/manager`, `/tint/operator`, challans, shades, TI report, **Tint Summary report / `/reports` hub**, operator sequence, pigment shade grid, slot-at-completion, sampling reuse + pack scaling | `docs/CLAUDE_TINT.md` |
| `/tint/sampling-library`, `sampling_register`/`sampling_recipes`/`sampling_usage_log`, suggestion engine, duplicate merge | `docs/CLAUDE_SAMPLING_LIBRARY.md` |
| `/place-order`, `/po` (`/order` retired 2026-07-27 — address parked, see below), `mo_order_form_index_v2`, `mo_sku_lookup_v2`, speed dial, cart, pack buckets, base aliases, catalog families, email builder | `docs/CLAUDE_PLACE_ORDER.md` |
| `/attendance`, OT, `attendance_*`, admin OT pending/settings/audit | `docs/CLAUDE_ATTENDANCE.md` |
| `/admin/import`, SAP parser, upsert brain, Auto-Import, `import_*` tables | `docs/CLAUDE_IMPORT.md` |
| `/floor` — Floor Control: unified desk screen consolidating the Support board + Picking DESKTOP board; left rail (undecided bills) / right pane (Floor / On-hold / Cancelled + detail panel); floor actions (hold/cancel/release/change-slot); live sync + `/api/floor/marker` | `docs/CLAUDE_FLOOR.md` |
| `/trips`, `trip_report`, NTS trip mirror, puller/mirror function, A4 trip sheet, WhatsApp share, logistics role | `docs/CLAUDE_TRIP_REPORT.md` |
| `/picking`, picking queue, mobile supervisor board (Assign/Picking/Done tabs), picker "My Picks" (Pending/Done), `pick_assignments`, stage ladder, sort spine, live-sync marker · **The DESKTOP board was RETIRED 2026-07-28** → `archive/2026-07-picking-desktop/`; `/floor` is the desk screen. `/picking` itself stays live and renders the card board at every width — the two MOBILE faces are the only live ones | `docs/CLAUDE_PICKING.md` |
| Push notifications — Web Push, `/api/push/*`, `public/sw.js`, `push_subscriptions`, quiet hours (IST), the device on/off toggle, assign/done buzz triggers, VAPID | `docs/CLAUDE_NOTIFICATIONS.md` |
| `/admin` **Settings → Hide** (rules / hidden orders / tags), `obd_visibility_rules`, `app_tag_settings`, `orders.isHidden` | `docs/CLAUDE_CORE.md §7.10` + `docs/CLAUDE_UI.md §57` (+ `docs/CLAUDE_MAIL_ORDERS.md §21` for tag-gating) |
| SKU catalog — `sku_master_v2`, old `sku_master`, which of the THREE sku-ish tables you actually mean | `docs/CLAUDE_CORE.md §7.1.c` (+ the id-space landmine in `§13` — read it before any repoint) |
| `/admin` (other), `/dispatcher/*` master data (Customers / SKUs / Routes / Vehicles — **live**) | Core only — stubs in `docs/CLAUDE_CORE.md §11-§12` |

### Retired — do not go looking for these

Five SCREENS were retired in July 2026, plus one BOARD inside a route that stayed live.
**The five screens are gone from the live tree**, so no domain file covers them and none of
their addresses resolve. **The sixth row is the exception and is marked as such** — its route
is still live and still has a domain file; only the wide-screen board inside it went. Each has
a plain-English README in its archive folder; the index is `archive/README.md`, the method is
`archive/RETIREMENT-PLAYBOOK.md`.

| Retired | When | Superseded by | Folder |
|---|---|---|---|
| `/support`, `/operations/support` + its API routes | 2026-07-27 | Floor Control (`/floor`) | `archive/2026-07-support/` |
| `/order` (public no-login mobile order page) | 2026-07-27 | `/po`, also public. **No redirect** — the address is parked for reuse | `archive/2026-07-order/` |
| `/operations/warehouse`, `/operations/dispatch` | 2026-07-27 | nothing — alternate mounts of two boards that were themselves retired the next day | `archive/2026-07-operations-pages/` |
| `/warehouse` + 2 stubs + board API | 2026-07-28 | nothing — it always rendered empty | `archive/2026-07-warehouse-board/` |
| `/planning` + `/dispatcher` index stub + 8 `/api/planning/*` routes | 2026-07-28 | nothing — never used end to end | `archive/2026-07-planning-board/` |
| ⚠ **NOT a screen — a BOARD.** `/picking`'s desktop table (`components/picking/picking-queue.tsx`). **The `/picking` ROUTE stays live**, still resolves, still has a domain file | 2026-07-28 | `/floor` for a desk screen; `/picking` itself renders the mobile card board at every width — see its §3 row above | `archive/2026-07-picking-desktop/` |

🔴 **Two survivors that look retired but are not.** `app/api/warehouse/pickers/route.ts`
is **live** — the two Picking boards call it, and it is the only file left under
`app/api/warehouse/`. The four master-data pages under `app/(dispatcher)/` are **live** —
only the `/dispatcher` index stub went. A route group is not a module.

If unsure which domain a task belongs to, **ask before loading** rather than guessing.

**`docs/ROADMAP.md` is NOT auto-loaded.** It holds planned/deferred work, grouped by module. Attach
it manually when planning a future feature — and add to it rather than parking future work in a
canonical file.

**Cross-cutting work** (SAP import enrichment touches MO + imports; dispatch data from MO flows to orders table; the Hide feature spans CORE schema + UI + MAIL_ORDERS): load both relevant domain files.

---

## 4. Session start procedure

1. Read every file listed above for your task. `CLAUDE.md` at repo root, the rest at `docs/CLAUDE_*.md`.
2. Respond with "Files read: CLAUDE.md, docs/CLAUDE_CORE.md, docs/CLAUDE_UI.md, [others]." before any other output.
3. **State the versions you actually READ — do not quote them from this router.** Every canonical
   file carries its own version in its header (line 2) and repeats it in its footer. `CLAUDE_CORE.md`'s
   header is the authority for the current **schema** version; the domain files carry the same stamp,
   plus their own file version (and parser/enrichment versions in `CLAUDE_MAIL_ORDERS.md`, UI version
   in `CLAUDE_UI.md`). A number hardcoded here goes stale every cycle — read it live, every session.
4. If any referenced file is missing, or its header disagrees with `CLAUDE_CORE.md`'s schema stamp,
   stop and ask.
5. Wait for the task instruction before generating any code.

---

## 5. How to write prompts that work

Ask for one thing at a time. Diagnose before you fix. When the user says "fix X", first check §11 of CORE and the relevant domain file for whether X is a known gotcha — it probably is. Read files before editing them, re-read after any str_replace on the same file. Constraints block at the top of every prompt: TypeScript compile check, no file deletions, sequential awaits only, no `prisma db push`.

---

## 6. Extraction triggers (for future file splits)

- Section in CORE crosses ~150 lines → extract to own file
- Module reaches production-live status → gets own file
- Parser or enrichment alone exceeds 200 lines → extract to `CLAUDE_PARSER.md` / `CLAUDE_ENRICHMENT.md`

When extracting, update §3 decision table in this file.

---

*Router v1.10 · Orbit OMS · August 2026 · updated 2026-08-05 — added the Billing pilot row (→ MAIL_ORDERS §23); all other rows re-verified against the 2026-08-04/05 reconciliation cycle (method: `docs/runbooks/reconciliation-method.md`)*
