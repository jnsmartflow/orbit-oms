# PARKED — hold / import items found during the Freight Trips build
# 2026-10-02 · web-update · NOT built · revisit after Freight Trips ships, then plan + fix together

Context: while building Freight Trips (held-bill pool + "held from / held by" columns), discovery found
these. They do NOT block Freight Trips. Owner decision 2026-10-02: park all, fix later as one job.

Evidence files (repo):
- docs/prompts/drafts/code-discovery-2026-10-01-hold-sources.md
- docs/prompts/drafts/code-discovery-2026-10-02-enrichment-overwrite.md

Already shipped from this thread: e1da66f0 (Schema v27.50) — mo_orders.heldAt/heldById; billing ⚑ Hold
stamps who; enrichment writes a hold log ("Held on import (mail order)" / "Held on import (billing hold on
mail order)") for non-hold → hold.

## P1 — Import silently overwrites hold/dispatch on older bills of the same SO (W6)
When a later OBD of the same SO imports, applyMailOrderEnrichment rewrites the mail order's Hold/Dispatch
onto EVERY older bill of that SO — can clear a person's hold with no log, or re-hold a bill Floor released.
Also two follow-on blocks act on all SO bills: the heldAt re-stamp loop, and the pending_support →
picking auto-advance (no status check).
Proposed fix (from the 2026-10-02 discovery, owner leaned yes, NOT approved to build yet):
- fill-only status write (only where dispatchStatus IS NULL), PLUS one exception: a 'dispatch' bill may
  take a Hold mail order if its latest order_status_logs row is still the no-mail-order fallback's own
  ("Auto-dispatched on import (no mail order for this bill)") = nobody touched it since.
- fence the heldAt loop and the auto-advance to only the bills the status write changed.
- fold heldAt into the per-bill write (removes today's double orders write).
- new note MAIL_ORDER_DISPATCH_NOTE for null → dispatch on tint bills (no log today).
Before building: run the discovery's read-only SQL (rows R2·21/22 = is the late-mail-order case real;
R4 = holds already silently undone; R3 = re-holds after release).

## P2 — Priority / slot / remarks / orderDateTime ride the same overwrite
Same updateMany: a later sibling OBD can reset Floor's ⚡ urgent or a manual slot. Separate decision.

## P3 — Mail-order split loses "who held"
app/api/mail-orders/[id]/split/route.ts copies dispatchStatus to the B half without heldAt/heldById.
One-line fix in the enrichment-overwrite discovery §5.

## P4 — Not every Hold button stamps "who held"
Owner hand-test 2026-10-02: a test Hold showed no heldAt/heldById stamp. Either it was pressed on a
screen other than the Billing mail-order ⚑ Hold (e.g. /mail-orders), or before e1da66f0 deployed. Find
every writer of mo_orders.dispatchStatus = 'Hold' and make all of them stamp heldAt/heldById.
Also: re-run the 3b hand-test (Billing ⚑ Hold on a mail order with no OBD → mo_orders.heldById = user).

## P5 — changedById = 1 means both "system" and the owner's admin account
Agreed display rule (for the hold table): show user 1 as "System" on import-path notes, the real person
elsewhere. Longer-term option: a dedicated system user.

## P6 — Docs vs code drift found (for the next consolidation)
- FLOOR §4.5 says 3 hold notes; code has 9 in HOLD_LOG_NOTES (after 3b).
- BILLING §5 hold write description stale (per-bill update + log, heldAt is written).
- FLOOR_TRIPS: /api/floor/trips has 10 route files, trips model gained vehicleSize/isHand.
- CORE §5 PageKey count stale (51 in ALL_PAGE_KEYS); CORE §3 table-standard ref points at UI §40, real §27.
- reports_trip_detail missing from ACCESS_SECTIONS (admin/access shows "out of step" banner).
- applyNoMailOrderFallback header claims a late mail order "cannot happen" — measured arrival, not SO capture.
