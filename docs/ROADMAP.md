# ROADMAP.md — OrbitOMS Planned Work
# Lives in: orbit-oms/docs/
# NOT auto-loaded by Claude Code. Attach manually for planning sessions.

This file is the inbox of "what's next". It does NOT describe current state — that's in the canonical context files. Items listed here are designed, scoped, or being kicked around. None are committed deadlines.

When an item ships, delete it from this file and update the relevant canonical file (CORE / UI / MAIL_ORDERS / TINT / ATTENDANCE / PLACE_ORDER) with current-state content.

---

## Attendance + OT

- **Frontend OT prompt UI.** Sessions A–F (14 Claude Code prompts, est. 12–16 hrs). Adds the missing client-side prompt during check-out so check-outs past `otCutoffHourIST` stop returning HTTP 400. Until shipped, kill switch `PATCH /api/admin/attendance/settings { otPromptEnabled: false }` is the soft-cutover.
- **Admin pending-approvals UI.** Page that lists `otApprovalStatus = pending` records with one-click approve / reject / adjusted-minutes input.
- **Admin settings UI.** Replace SQL-edits with a real form on `/admin/attendance/settings`. Rollout stage, OT toggles, OT cutoff hour, geofence coords + radius, grace window, half-day threshold, photo retention.
- **Audit report UI.** Monthly read-only audit from `GET /api/admin/attendance/ot-audit`.
- **In-app notification system.** Admin approves/rejects OT → user sees a toast / badge / email next time they open the app.
- **Real depot geofence.** Current coords are Surat city centre placeholder (`21.1702, 72.8311 ±150m`). Physically measure actual depot lat/long, update `attendance_settings`.
- **Phase 2 admin writes.** Manual entry, edit record, mark exception (e.g. "approved leave but not in system").
- **Service worker for offline support.** PWA currently requires network. Queue check-in/out events offline → flush on reconnect.
- **Push notifications.** Web push for OT decisions + manager alerts.

---

## Place Order

- **Stage E proper taxonomy migration.** Replace Path A (which repurposes `product` + `baseColour` v2 columns) with a proper `subVariant TEXT NULL` column on `mo_sku_lookup` and `mo_product_keywords`. Designs in `docs/archive/drafts/`:
  - Stage A (audit) — done, 8 files in mail-orders module
  - Stage B (schema design, 11 decisions locked) — done
  - Stage C (splitter function design, LUXURIO / 2K PU / PU PRIME, 3-token only) — done
  - Stage D (13 Claude Code prompts across 5 phases, est. 5–8 hrs) — drafted but NOT executed
  - Stage E (execution) — pending
- **Responsive merge of `/order` + `/place-order`.** Single URL responds to both mobile (current `/order`) and desktop (current `/place-order`) viewports. Drop the viewport-guard redirect.
- **Popularity-ranked base ordering.** Track per-customer or per-family base pick frequency, surface most-used bases at top of variant grid. Schema sketch: `baseOrderRank` migration column on `mo_order_form_index_v2`.
- **Full URL rename to `/purchase-order`.** Match the sidebar label. Add redirect from `/place-order` → `/purchase-order`.
- **Per-customer speed dial.** Override the global 9-tile config when a specific customer is selected (e.g. construction dealer sees PRIMER first instead of GLOSS).
- **Per-user speed dial.** Each billing operator gets their own preferred 9-tile config.

---

## Mail Orders

- **Deploy Parser v6.5 to depot PC task scheduler.** Currently lives in `C:\Users\HP\OneDrive\VS Code\mail-orders\` and runs interactively. Move to scheduled task with logging rotation.
- **Carry-base reset fix.** `$script:CarryBase` should reset on customer header detection.
- **Fuzzy matching Level B.** Edit-distance 1–2 fallback when no keyword match (covers misspellings).
- **Learning from corrections Level C.** Operator manually resolves an unmatched line → keyword auto-added with rarity guards.
- **Audit / confidence / batch stats admin view.** Per-batch and per-day enrichment quality dashboard (`% matched`, `% partial`, `% unmatched`, top-failed-keywords).
- **Keyword management UI.** Replace SQL edits with a real CRUD on `mo_product_keywords` / `mo_base_keywords`.
- **`paintType` column on `mo_sku_lookup`.** Drive warehouse zone splitting (putty / oil / wood / water / stainer).
- **Historical carton backfill.** `mo_order_lines.isCarton` + `cartonCount` were added later; historical rows have these null.
- **Day Summary email (Ctrl+D).** End-of-day rollup grouped by SO with totals.

### Missing SKUs to add

- VT Velvetino
- WS Metallic Silver / WS Metallic Gold
- SR Spray Paint (pack=400ML, current SKUs have wrong pack)
- PU Interior Glossy (product doesn't exist yet)
- DIY Spray products
- M900 — 13 SKUs needed (BW + 90/92/93 BASE × 4 packs). SAP material codes not yet supplied.
- DP M900 Gloss Enamel Brilliant White 20L (`5888558` shipped but not in master)

### GLOSS Brilliant White Fini gap

3 IN28301xxx Fini rows still have null `refMaterial` (10L `IN28301082`, 100ML `IN28301098`, 200ML `IN28301074`). Generic codes not yet supplied by depot.

---

## Tint

- **Full Tint Operator end-to-end test.** Walk through queue → start → save TI → mark done on a real OBD with multiple bases.
- **Queue dropdown keyboard navigation.** ↑↓ + Esc inside the job-pill popover.
- **Mobile layout test.** Confirm 320px left panel collapses correctly on phone widths.
- **Suggestion strip verification.** Multi-line Save TI flow auto-advance correctness.
- **Refactor TM reorder away from `prisma.$transaction`.** Currently `/api/tint/manager/reorder/route.ts` line ~429 violates CORE §3. Replace with two sequential awaits.
- **CustomerMissingSheet styling alignment.** Match admin customer split-view form.
- **Manual Tint Entry UI.** Schema exists, modal not yet built. Chandresh's manual override for sample requests + late additions.
- **Tint material picking workflow.** Schema designed: `tint_pick_tasks` + `tint_pick_issue_lines`. HTML mockup approved. Implementation not started.

---

## Delivery Challan

- **Lazy creation removal verification.** Audit `/api/tint/manager/challans/[orderId]` to confirm it never auto-creates challans. All creation should be import-time.
- **Print CSS class name updates.** Old class names (`ch-header`, `tint-yes`) may persist in `globals.css` `@media print` rules.
- **Customer master completeness view.** Admin screen showing which `delivery_point_master` rows are missing primary contacts / addresses / sales officer assignments. Drives challan S5 gaps.

---

## Infrastructure

- **Sentry.** Error tracking. Blocked by OneDrive/Windows npm install conflict — install on a non-OneDrive working copy or use `--ignore-scripts`.
- **UptimeRobot.** Free monitor on `/api/health`. Alerts on Vercel/Supabase outages.
- **Dev branch convention.** Currently all commits go to `main` (per CORE §3). If team grows, introduce `dev` branch + feature branches + PR workflow.
- **Multi-language support.** Gujarati first. Affects login, attendance, mobile `/order`, public-facing screens. i18n library choice deferred.
- **Public order detail page.** `orbitoms.in/orders/{soNumber}` — dealer-facing read-only status (Punched / Tinted / Dispatched / Delivered). No login. Time-limited signed URL.
- **MIS override layer.** `mis_dispatch_overrides` table — manual entries that adjust SAP MIS feed for reporting.
- **Dispatch planning Phase 4.** Reordering inside a plan, transporter dispatch confirmation, photo proof of delivery.
- **Warehouse barcode/QR labels.** Post-Tinter Issue label generation. Designs done. TSC TE200 thermal printer. Libraries: `JsBarcode`, `qrcode`. Print template HTML.
- **WhatsApp delivery notifications — Option C.** `wa.me` click-to-message links from depot phone, no API integration. Cheap, no DLT registration.
- **SAP VL06O background job automation.** Currently Auto-Import.ps1 runs interactively in a depot PC. Need SAP Basis / IT to schedule a backend export job. Request language drafted in `docs/archive/drafts/`.
- **E-way bill JSON export.**
  - Phase 1: per-trip JSON download from `/admin/eway` for upload to the e-way bill portal
  - Phase 2: GSP API integration (requires GSP vendor + cost)
- **MIS adjustment layer.** Conceptual. Allows ops to layer on top of SAP MIS feed.

---

## Auth + roles

- **Operations user password rotation.** Per-user rotation on a schedule. Currently no enforcement.
- **Mobile OTP login.** Research done. WhatsApp via MSG91 ~₹510/mo. SMS blocked by DLT registration requirement. Deferred until volume justifies the per-message cost.

---

## Sales / dispatcher screens

- **Real support screen.** Currently restricted to `/place-order`. Future: `/support` with full order review + hold/release + bulk actions.
- **Real dispatcher screen.** Currently restricted to `/place-order`. Future: `/planning` Phase 4 capabilities.

---

*ROADMAP · Inbox of planned work · Not auto-loaded*
