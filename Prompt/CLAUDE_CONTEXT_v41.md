# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v41.md fully before doing anything else."
# Version: Phase 1 Go-Live · Schema v21 · Context v41 · April 2026

---

## 1-41. [Unchanged from v38]

(All sections 1 through 41 remain unchanged — refer to v38 for full content)

---

## 42. Known Issues / Pending Fixes (UPDATED v41)

1. **Warehouse header stats mismatch** — header shows different count than unassigned panel in history view
2. **Cleanup Prisma field mapping** — pick_assignments.clearedAt had @map("cleared_at") mismatch, fixed by removing @map. Verify cleanup runs correctly on next day boundary.
3. ~~**Slot cascade (NOT YET BUILT)**~~ — **DONE v33.**
4. **Duplicate pick columns** — orders and order_splits both have camelCase (isPicked, pickedAt, pickedById) AND snake_case (is_picked, picked_at, picked_by_id) columns. Use camelCase ones via Prisma.
5. ~~**Tint manager filter crash**~~ — **FIXED v36.** All array assignments in tint-manager-content.tsx and tint-operator-content.tsx have ?? [] fallbacks.
6. **Slot cascade changedById** — uses hardcoded userId=1 (admin) for system-generated audit logs.
7. ~~**Import not working**~~ — **FIXED v34.**
8. **Slot cascade cascades pending_support orders** — cascade moves ALL orders including those not yet submitted by Support. Consider adding workflowStage filter to cascade eligibility.
9. **Support board default slot on refresh** — intermittent issue, deprioritised.
10. ~~**TM slot filter broken**~~ — **FIXED v39.** Was using hardcoded times on legacy dispatchSlot text field. Replaced with real slotId from slot_master.
11. ~~**TM dispatch filter misleading**~~ — **FIXED v39.** Removed entirely — most pre-completion orders have null dispatchStatus.
12. **Shade Master isActive filter** — UI sends `isActive=true/false` param but `/api/admin/shades` may not handle it yet. Verify and add if missing.
13. ~~**Login autofill blue tint**~~ — **FIXED v41.** WebkitBoxShadow override on email and password inputs forces white background.

---

## 43. Queued Features (UPDATED v41)

- ~~**Slot cascade**~~ — **DONE v33**
- ~~**Import debugging**~~ — **DONE v34**
- ~~**OBD date parsing fix**~~ — **DONE v34**
- ~~**Support history view**~~ — **DONE v35**
- ~~**Order detail panel**~~ — **DONE v35** (Support only → now also TM v39)
- ~~**Role-based navigation + redirects**~~ — **DONE v36**
- ~~**Operations role + unified ops view**~~ — **DONE v36**
- ~~**TM filter fix + slot awareness**~~ — **DONE v39**
- ~~**TM neutral palette redesign**~~ — **DONE v39**
- ~~**TM order detail panel integration**~~ — **DONE v39**
- ~~**Shade Master neutral redesign**~~ — **DONE v40**
- ~~**TI Report neutral redesign**~~ — **DONE v40**
- ~~**Login page neutral redesign**~~ — **DONE v41**
- ~~**Sidebar teal accent bar**~~ — **DONE v41**
- ~~**Full palette sweep (45 files)**~~ — **DONE v41**
- ~~**Logo mark — orbit symbol**~~ — **DONE v41**
- **Cascade badge** — When `originalSlotId !== slotId`, show `⏩ from {originalSlot.name}` badge on order rows. Data already in API response (v39). Purely UI work — detail panel only for TM.
- **soNumber import mapping** — column exists in DB + Prisma, need to map from SAP XLS column
- **Order detail panel** — wire into Planning board (customer pill click) and Warehouse board (pick card click)
- **Audit history in detail panel** — order_status_logs exists, not yet fetched/rendered
- **CustomerMissingSheet styling** — not matching admin customer form
- **Smart slot assignment** — orders arriving at/after slot cutoff auto-escalate
- **Visual "carried over" indicator for overdue orders in slot tabs**
- **MIS Override Layer** — Admin-only field-level overrides per OBD
- **Barcode/QR label generation** — post-TI submission
- **Customer data enrichment** — remaining area batches
- **Operations password change** — operations@orbitoms.com temp password 'operations123' must be changed in prod

---

## 52. Tint Manager Redesign (NEW v39 — April 2, 2026)

(unchanged — refer to v39)

---

## 53. Shade Master Redesign (NEW v40 — April 2, 2026)

(unchanged — refer to v40)

---

## 54. TI Report Redesign (NEW v40 — April 2, 2026)

(unchanged — refer to v40)

---

## 55. Session Start Checklist (UPDATED v41)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v21**
3. **TM redesign (v39):** Neutral palette, 2-row header, slot strip, filter dropdown, 10-column table, order detail panel
4. **CLAUDE_UI.md v4:** Load alongside this file for ALL UI work — defines teal brand system, IosToggle, DateRangePicker
5. **Planning is ORDER level** (v28 correction still applies)
6. **Tint Manager uses OrderDetailPanel** not SkuDetailsSheet (v39)
7. **Delivery type dot colors:** blue-600 (Local), orange-600 (UPC), teal-600 (IGT), rose-600 (Cross)
8. **Filter state:** slotFilter is `"all" | number`, delTypeFilter is `Set<string>`, dispatchFilter removed
9. **Shade Master:** 2-row header, IosToggle, column sequence `# · Name · CustID · Type · SKU · Pack · Status · Active · By · At`
10. **TI Report:** DateRangePicker, no Summary tab, inline shade expand, Base and Pack separate columns
11. **page.tsx pattern:** All board pages are bare `<ComponentName />` — no wrapper div, no title
12. All existing checklist items from v38 #36 still apply
13. **Brand colour is teal-600.** Load CLAUDE_UI_v4.md. Logo mark is orbit symbol. Login + sidebar updated v41. Full palette sweep complete — zero indigo/slate remains.

---

## 56. Brand & Design System (NEW v41 — April 3, 2026)

### Brand colour
Teal-600 (#0d9488) is the single brand accent across all screens.
Teal-700 (#0f766e) is hover state.
Indigo (#1a237e family) is fully deprecated — zero instances remain.

### Logo mark
Orbit symbol — three circles: ring (r=7 stroke), centre dot
(r=2.2 fill), orbiting dot (r=2 fill at cx=18 cy=11).
White version on teal bg. Teal version on white bg.
Used in: sidebar logo button (both admin + role), login page branding.

### Tagline
Current (internal phase): "One system. Zero chaos."
Future (external pitch): "Every order in orbit."
Switch by changing one line in app/login/page.tsx.

### Login page
- Page bg: #f9fafb
- Logo mark inline with wordmark, centered above card
- Card: white, border-gray-200, rounded-xl, p-6, shadow-sm
- No heading inside card — form starts directly with inputs
- Button: bg-teal-600
- Footer: "OrbitOMS · Internal Use Only"
- Autofill override: WebkitBoxShadow on inputs

### Sidebar
- bg-white + borderLeft: 3px solid #0d9488
- Logo button: bg-teal-600, orbit SVG white
- Active nav: bg-teal-50 text-teal-700 border-l-2 border-teal-600
- Tooltips: bg-gray-900
- User avatar: bg-teal-600

### Palette sweep
~45 files swept in v41 session. Zero deprecated colour patterns
remain. Verified via grep on all indigo/slate/old hex values.
Key corrections after sweep:
- OBD code colour: text-gray-800 font-mono (not teal-700)
- Pending Support badge: bg-amber-50 text-amber-700 (waiting state)
- Pending status badge: bg-gray-100 text-gray-600 (neutral)

### CLAUDE_UI.md
Current version: v4.1. Always load alongside CLAUDE_CONTEXT.md.
Located at Prompt/CLAUDE_UI_v4.md. Single source of truth for all styling.

---

*Version: Phase 1 Go-Live · Schema v21 · Context v41 · April 2026*
