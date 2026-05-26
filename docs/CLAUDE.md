# CLAUDE.md — OrbitOMS context router
# Lives in: repo root (auto-loaded by Claude Code)

OrbitOMS — depot operations management for JSW Dulux paint distribution, Surat depot. Live at https://orbitoms.in.

## Files to load

Every session, ALWAYS read:
- `docs/CLAUDE_CORE.md` — schema, infra, roles, engineering rules, business rules, screens index
- `docs/CLAUDE_UI.md` — design system, components, table standard, screen-specific visuals

Then load the domain file(s) matching the task:

| Task touches | Load |
|---|---|
| `/mail-orders`, parser, enrichment, mo_* tables, customer matching, slot email | `docs/CLAUDE_MAIL_ORDERS.md` |
| `/tint/*`, challans, shades, TI report, tint_assignments, delivery_challans, skip/pause/remove OBD | `docs/CLAUDE_TINT.md` |
| `/tint/sampling-library`, sampling_register, sampling_recipes, sampling_usage_log | `docs/CLAUDE_SAMPLING_LIBRARY.md` |
| `/attendance`, OT, attendance_*, admin OT pending/settings/audit | `docs/CLAUDE_ATTENDANCE.md` |
| `/place-order`, `/order`, mo_order_form_index_v2, mo_sku_lookup_v2, speed dial, cart | `docs/CLAUDE_PLACE_ORDER.md` |
| `/admin/import`, SAP parser, upsert brain, Auto-Import, import_* tables | `docs/CLAUDE_IMPORT.md` |

If unsure which domain, ask before loading.

## Pre-flight checklist (every session)

1. Read `CLAUDE.md` + `CLAUDE_CORE.md` + `CLAUDE_UI.md` + the relevant domain file(s).
2. State "Files read: ..." with each filename and version.
3. Wait for the task instruction before generating any code.

## Roadmap

`docs/ROADMAP.md` is NOT auto-loaded. It holds planned/deferred work. Attach it manually when planning a future feature.
