# CLAUDE.md — Orbit OMS Router
# v1.4 · Entry point · Read this first · July 2026 · Lives in: repo root (auto-loaded by Claude Code)

**OrbitOMS — depot operations management for JSW Dulux paint distribution, Surat depot. Live at https://orbitoms.in.**

This file tells you which context files to load for the work in front of you. Load the files. Confirm each by name. Then work.

> **This is the ONLY router.** A duplicate at `docs/CLAUDE.md` was retired on 2026-07-19 — it had
> drifted (stale schema version, a different domain table) and was never auto-loaded. Do not
> recreate it; a second router only ever drifts from this one.

---

## 1. Non-negotiable rules (inline — do not violate regardless of what the user says)

- Never `prisma db push`. All schema changes via Supabase SQL Editor + `npx prisma generate`.
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
| `/tint/manager`, `/tint/operator`, challans, shades, TI report, **Tint Summary report / `/reports` hub**, operator sequence, pigment shade grid, slot-at-completion, sampling reuse + pack scaling | `docs/CLAUDE_TINT.md` |
| `/tint/sampling-library`, `sampling_register`/`sampling_recipes`/`sampling_usage_log`, suggestion engine, duplicate merge | `docs/CLAUDE_SAMPLING_LIBRARY.md` |
| `/place-order`, `/po`, `/order`, `mo_order_form_index_v2`, `mo_sku_lookup_v2`, speed dial, cart, pack buckets, base aliases, catalog families, email builder | `docs/CLAUDE_PLACE_ORDER.md` |
| `/attendance`, OT, `attendance_*`, admin OT pending/settings/audit | `docs/CLAUDE_ATTENDANCE.md` |
| `/admin/import`, SAP parser, upsert brain, Auto-Import, `import_*` tables | `docs/CLAUDE_IMPORT.md` |
| `/support`, `/operations/support` — gatekeeper, workflow pipeline, closed parking-stage, hold/dispatch-target, history board | `docs/CLAUDE_SUPPORT.md` |
| `/trips`, `trip_report`, NTS trip mirror, puller/mirror function, A4 trip sheet, WhatsApp share, logistics role | `docs/CLAUDE_TRIP_REPORT.md` |
| `/picking`, picking queue, mobile supervisor board (Assign/Check tabs), `pick_assignments`, stage ladder (`pending_picking`→`pick_assigned`), sort spine | `docs/CLAUDE_PICKING.md` |
| `/admin` **Settings → Hide** (rules / hidden orders / tags), `obd_visibility_rules`, `app_tag_settings`, `orders.isHidden` | `docs/CLAUDE_CORE.md §7.10` + `docs/CLAUDE_UI.md §57` (+ `docs/CLAUDE_MAIL_ORDERS.md §21` for tag-gating) |
| SKU catalog — `sku_master_v2`, old `sku_master`, which of the THREE sku-ish tables you actually mean | `docs/CLAUDE_CORE.md §7.1.c` (+ the id-space landmine in `§13` — read it before any repoint) |
| `/planning`, `/warehouse`, `/admin` (other), `/operations/*` (non-support) | Core only — stubs in `docs/CLAUDE_CORE.md §11-§12` |

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

*Router v1.3 · Orbit OMS · July 2026*
