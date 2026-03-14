# PHASE_1_COMPLETION_PROMPTS.md — Orbit OMS
# Structured prompt guide to complete Stage 1 (Foundation) from current state.
# Source of truth: Schema v10 · Config Master v2 · CLAUDE_CONTEXT.md
#
# HOW TO USE:
# 1. Start every Claude Code session: claude "Read CLAUDE_CONTEXT.md fully before doing anything else."
# 2. Run one STEP at a time. Complete the TEST before moving to the next step.
# 3. Steps are ordered by dependency — earlier steps must pass before later ones.
# 4. Each step is self-contained and safe to re-run if something breaks.

---

## GAP ANALYSIS — What exists vs what Schema v10 requires

### Already built (do not rebuild):
- Project scaffold (Next.js 14, TypeScript, Tailwind, shadcn/ui, Prisma, NextAuth)
- Auth layer (login page, RBAC, middleware, role-based redirect)
- Admin layout + sidebar
- System config editor (/admin/system-config) — needs key list update
- User management (/admin/users)
- Roles view (/admin/roles)
- Delivery types screen (/admin/delivery-types)
- Routes (/admin/routes)
- Areas (/admin/areas) — needs primaryRouteId field
- Sub-areas (/admin/sub-areas)
- Sales officers (/admin/sales-officers)
- Customers (/admin/customers) — needs major update (new fields)
- SKUs (/admin/skus) — needs full rebuild (schema changed)

### Missing / needs rebuild (Schema v10 additions):
- Prisma schema not updated to v10 (38 tables)
- status_master (replaces 3 tables — seed + no UI needed for Phase 1)
- slot_master screen (NEW)
- delivery_type_slot_config screen (NEW)
- product_category screen (NEW)
- product_name screen (NEW)
- base_colour screen (NEW)
- sku_master screen (REBUILD — schema changed)
- transporter_master screen (NEW)
- sales_officer_group screen (NEW)
- contact_role_master screen (NEW)
- Customer screen updates (salesOfficerGroupId, contactRoleId, customerRating, primaryRouteId override, deliveryTypeOverride)
- Area screen update (primaryRouteId)
- Sidebar navigation update (new screens)
- Seed script update (status_master, slot data, new lookup tables)
- Dashboard stat cards update

---

## STEP 1 — Update Prisma schema to v10

**What this builds:** Complete schema.prisma aligned with Schema v10. 38 tables.
**Dependency:** None — do this first before any other step.
**Test:** `npx prisma validate` exits clean. `npx tsc --noEmit` exits clean.

```
Read CLAUDE_CONTEXT.md fully. Then read the current /prisma/schema.prisma.

Update /prisma/schema.prisma to Schema v10. Apply ALL changes below exactly:

── REMOVE these models entirely ──────────────────────────────────────────────
Remove: sku_sub_master
Remove: dispatch_status_master
Remove: tinting_status_master
Remove: delivery_priority_master
Remove all their back-relations from other models.

── ADD these new models ───────────────────────────────────────────────────────

model status_master {
  id          Int      @id @default(autoincrement())
  domain      StatusDomain
  code        String
  label       String
  sortOrder   Int
  isActive    Boolean  @default(true)
  description String?
  createdAt   DateTime @default(now())
  @@unique([domain, code])
}

enum StatusDomain {
  dispatch
  tinting
  pick_list
  import
  workflow
  priority
}

model product_category {
  id           Int            @id @default(autoincrement())
  name         String         @unique
  isActive     Boolean        @default(true)
  createdAt    DateTime       @default(now())
  productNames product_name[]
  skus         sku_master[]
}

model product_name {
  id         Int              @id @default(autoincrement())
  name       String           @unique
  categoryId Int
  category   product_category @relation(fields: [categoryId], references: [id])
  isActive   Boolean          @default(true)
  createdAt  DateTime         @default(now())
  skus       sku_master[]
}

model base_colour {
  id        Int          @id @default(autoincrement())
  name      String       @unique
  isActive  Boolean      @default(true)
  createdAt DateTime     @default(now())
  skus      sku_master[]
}

model transporter_master {
  id            Int              @id @default(autoincrement())
  name          String           @unique
  contactPerson String?
  phone         String?
  email         String?
  isActive      Boolean          @default(true)
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt
  vehicles      vehicle_master[]
}

model sales_officer_group {
  id              Int                      @id @default(autoincrement())
  name            String                   @unique
  salesOfficerId  Int
  salesOfficer    sales_officer_master     @relation(fields: [salesOfficerId], references: [id])
  isActive        Boolean                  @default(true)
  createdAt       DateTime                 @default(now())
  updatedAt       DateTime                 @updatedAt
  customers       delivery_point_master[]
}

model contact_role_master {
  id        Int                        @id @default(autoincrement())
  name      String                     @unique
  isActive  Boolean                    @default(true)
  createdAt DateTime                   @default(now())
  contacts  delivery_point_contacts[]
}

model slot_master {
  id          Int                          @id @default(autoincrement())
  name        String                       @unique
  slotTime    String
  isNextDay   Boolean                      @default(false)
  isActive    Boolean                      @default(true)
  sortOrder   Int
  createdAt   DateTime                     @default(now())
  updatedAt   DateTime                     @updatedAt
  slotConfigs delivery_type_slot_config[]
}

model delivery_type_slot_config {
  id             Int                  @id @default(autoincrement())
  deliveryTypeId Int
  deliveryType   delivery_type_master @relation(fields: [deliveryTypeId], references: [id])
  slotId         Int
  slot           slot_master          @relation(fields: [slotId], references: [id])
  slotRuleType   SlotRuleType
  windowStart    String?
  windowEnd      String?
  isDefault      Boolean              @default(false)
  isActive       Boolean              @default(true)
  sortOrder      Int
  createdAt      DateTime             @default(now())
  updatedAt      DateTime             @updatedAt
  @@unique([deliveryTypeId, slotId])
}

enum SlotRuleType {
  time_based
  default
}

── MODIFY these existing models ──────────────────────────────────────────────

sku_master — replace entire model:
model sku_master {
  id                Int              @id @default(autoincrement())
  skuCode           String           @unique
  skuName           String
  productCategoryId Int
  productCategory   product_category @relation(fields: [productCategoryId], references: [id])
  productNameId     Int
  productName       product_name     @relation(fields: [productNameId], references: [id])
  baseColourId      Int
  baseColour        base_colour      @relation(fields: [baseColourId], references: [id])
  packSize          String
  containerType     String
  unitsPerCarton    Int?
  isActive          Boolean          @default(true)
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt
}

area_master — add primaryRouteId field:
  primaryRouteId  Int?
  primaryRoute    route_master? @relation("AreaPrimaryRoute", fields: [primaryRouteId], references: [id])

route_master — add back-relation:
  primaryAreas    area_master[] @relation("AreaPrimaryRoute")

delivery_type_master — add slotConfigs back-relation:
  slotConfigs     delivery_type_slot_config[]

delivery_point_master — add new fields:
  primaryRouteId        Int?
  primaryRoute          route_master?        @relation("CustomerPrimaryRoute", fields: [primaryRouteId], references: [id])
  deliveryTypeOverrideId Int?
  deliveryTypeOverride  delivery_type_master? @relation("CustomerDeliveryTypeOverride", fields: [deliveryTypeOverrideId], references: [id])
  salesOfficerGroupId   Int?
  salesOfficerGroup     sales_officer_group? @relation(fields: [salesOfficerGroupId], references: [id])
  customerRating        String?

route_master — add customer back-relation:
  customerPrimaryRoutes delivery_point_master[] @relation("CustomerPrimaryRoute")

delivery_type_master — add customer override back-relation:
  customerOverrides delivery_point_master[] @relation("CustomerDeliveryTypeOverride")

delivery_point_contacts — add contactRoleId field:
  contactRoleId   Int?
  contactRole     contact_role_master? @relation(fields: [contactRoleId], references: [id])

sales_officer_master — add groups back-relation:
  groups          sales_officer_group[]

vehicle_master — replace stub with full Phase 1 definition:
model vehicle_master {
  id                  Int                 @id @default(autoincrement())
  vehicleNo           String              @unique
  category            String
  capacityKg          Float
  maxCustomers        Int?
  deliveryTypeAllowed String
  transporterId       Int
  transporter         transporter_master  @relation(fields: [transporterId], references: [id])
  driverName          String?
  driverPhone         String?
  isActive            Boolean             @default(true)
  createdAt           DateTime            @default(now())
}

import_batches — replace stub with expanded definition:
model import_batches {
  id             Int      @id @default(autoincrement())
  importedBy     Int?
  headerFileName String?
  lineFileName   String?
  importedAt     DateTime @default(now())
  statusId       Int
  errorLog       String?
  createdAt      DateTime @default(now())
}

── After updating schema ──────────────────────────────────────────────────────
Run: npx prisma validate
Fix any errors before stopping. Report all changes made.
Then run: npx tsc --noEmit
Fix every TypeScript error before stopping.
```

**Test:** `npx prisma validate` exits clean. `npx tsc --noEmit` exits clean.

---

## STEP 2 — Update seed.ts to v10

**What this builds:** Complete seed script seeding all Phase 1 lookup tables including new ones.
**Dependency:** Step 1 must be complete (schema v10 in place).
**Test:** `npm run seed` runs with no errors. Verify in Supabase Studio.

```
Read CLAUDE_CONTEXT.md. Read the current /prisma/seed.ts.

Rewrite /prisma/seed.ts to seed all Phase 1 tables for Schema v10.
Use upsert throughout so seed is safe to re-run.

REMOVE from seed:
- dispatch_status_master rows
- tinting_status_master rows
- delivery_priority_master rows
- dispatch_cutoff_time from system_config

ADD / UPDATE:

1. system_config — 8 keys (remove dispatch_cutoff_time, keep the rest):
   soft_lock_minutes_before_cutoff: "30"
   hard_lock_minutes_before_cutoff: "15"
   ready_escalation_minutes: "10"
   upgrade_small_overflow_pct: "12"
   upgrade_max_dealer_combo: "3"
   aging_priority_days: "2"
   aging_alert_days: "3"
   change_queue_urgent_alert: "true"

2. status_master — seed all 28 rows across 6 domains:
   domain=dispatch: dispatch(1), waiting_for_confirmation(2), hold(3)
   domain=priority: normal(1), urgent(2)
   domain=tinting: pending_tint_assignment(1), tinting_in_progress(2), tinting_done(3)
   domain=workflow: order_created(1), pending_tint_assignment(2), pending_support(3), dispatch_confirmation(4), dispatched(5)
   domain=pick_list: pending_pick(1), pick_assigned(2), picking(3), pending_verification(4), ready_for_dispatch(5), verification_failed(6), vehicle_confirmed(7), loading(8), loading_complete(9), dispatched(10)
   domain=import: pending(1), processing(2), completed(3), partial(4), failed(5)
   Use @@unique([domain, code]) for upsert key.

3. delivery_type_master — 4 rows: Local, Upcountry, IGT, Cross

4. slot_master — 5 rows:
   { name:"Morning", slotTime:"10:30", isNextDay:false, sortOrder:1 }
   { name:"Afternoon", slotTime:"12:30", isNextDay:false, sortOrder:2 }
   { name:"Evening", slotTime:"15:30", isNextDay:false, sortOrder:3 }
   { name:"Night", slotTime:"18:00", isNextDay:false, sortOrder:4 }
   { name:"Next Day Morning", slotTime:"10:30", isNextDay:true, sortOrder:5 }

5. delivery_type_slot_config — 6 rows for Local + Upcountry:
   Local + Morning: time_based, windowStart:"00:00", windowEnd:"10:29", isDefault:false, sortOrder:1
   Local + Afternoon: time_based, windowStart:"10:30", windowEnd:"12:29", isDefault:false, sortOrder:2
   Local + Evening: time_based, windowStart:"12:30", windowEnd:"15:29", isDefault:false, sortOrder:3
   Local + Night: time_based, windowStart:"15:30", windowEnd:"17:59", isDefault:true, sortOrder:4
   Local + Next Day Morning: time_based, windowStart:"18:00", windowEnd:"23:59", isDefault:false, sortOrder:5
   Upcountry + Night: default, windowStart:null, windowEnd:null, isDefault:true, sortOrder:1

6. product_category — 6 rows: Emulsion, Enamel, Primer, Tinter, Texture, Putty

7. product_name — 8 rows with categoryId FKs:
   Aquatech(Emulsion), WS(Emulsion), Weathercoat(Emulsion),
   Supercover(Enamel), Primer Plus(Primer), Tinter Base(Tinter),
   Texturo(Texture), Wall Putty Pro(Putty)

8. base_colour — 8 rows:
   White Base, Deep Base, Pastel Base, Clear Base,
   Birch White, Sky Blue, Cream, N/A

9. contact_role_master — 4 rows: Owner, Contractor, Manager, Site Engineer

10. transporter_master — 3 rows:
    Sharma Logistics, Patel Transport, Singh & Sons Carriers

11. sales_officer_master — 4 rows:
    Amit Shah(amit.shah@company.com), Kavita Mehta(kavita.mehta@company.com),
    Rohan Patel(rohan.patel@company.com), Swati Jain(swati.jain@company.com)

12. sales_officer_group — 4 rows (after sales_officer_master):
    "Varacha North Portfolio" → Amit Shah
    "Bharuch & Ankleshwar" → Kavita Mehta
    "Adajan & Olpad Zone" → Rohan Patel
    "Surat City Central" → Amit Shah

13. Keep existing: role_master(7 rows), admin user

Run: npm run seed
Report: X tables seeded, any errors.
```

**Test:** Open Supabase Studio. Verify:
- status_master has 28 rows
- slot_master has 5 rows
- delivery_type_slot_config has 6 rows
- product_category has 6 rows, product_name has 8 rows, base_colour has 8 rows
- contact_role_master has 4 rows
- transporter_master has 3 rows, sales_officer_group has 4 rows

---

## STEP 3 — Prisma DB push

**What this builds:** Applies Schema v10 to the database.
**Dependency:** Steps 1 and 2 complete.
**Test:** All 38 tables visible in Supabase Studio.

```
Read CLAUDE_CONTEXT.md.

Run in order:
1. npx prisma db push
   If it fails, read the error carefully.
   - If it's a "table already exists" or "column conflict" error, run: npx prisma db push --force-reset
   - WARNING: --force-reset drops all data. Only use if confirmed OK.
   - Fix any remaining errors before proceeding.

2. npm run seed
   Run seed after push to restore lookup data.

3. Verify in Supabase Studio:
   - All 38 tables exist
   - status_master, slot_master, product_category, product_name, base_colour,
     contact_role_master, transporter_master, sales_officer_group all exist with data
   - Old tables (sku_sub_master, dispatch_status_master, tinting_status_master,
     delivery_priority_master) do NOT exist

Report what changed and confirm seed completed.
```

**Test:** Log in as admin@orbitoms.com / Admin@123 → redirects to /admin. Admin panel loads.

---

## STEP 4 — Update admin sidebar navigation

**What this builds:** Sidebar updated with all new Phase 1 screens.
**Dependency:** Step 3 complete (app must still load after schema changes).
**Test:** All sidebar links present and navigation works.

```
Read CLAUDE_CONTEXT.md. Read /app/(admin)/admin/layout.tsx.

Update the sidebar navigation to include ALL Phase 1 admin screens.
Group them with section dividers in the sidebar.

Final sidebar navigation (in order):

SECTION: System
- Dashboard (href: /admin)
- System Config (href: /admin/system-config)
- Users (href: /admin/users)
- Roles (href: /admin/roles)

SECTION: Slots & Delivery
- Delivery Types (href: /admin/delivery-types)
- Slot Master (href: /admin/slots)           ← NEW
- Slot Rules (href: /admin/slot-rules)        ← NEW
- Routes (href: /admin/routes)
- Areas (href: /admin/areas)
- Sub-areas (href: /admin/sub-areas)

SECTION: Products
- Product Categories (href: /admin/product-categories)  ← NEW
- Product Names (href: /admin/product-names)            ← NEW
- Base Colours (href: /admin/base-colours)              ← NEW
- SKUs (href: /admin/skus)                              ← REBUILD

SECTION: Fleet
- Transporters (href: /admin/transporters)   ← NEW
- Vehicles (href: /admin/vehicles)           ← stub

SECTION: People & Customers
- Sales Officers (href: /admin/sales-officers)
- SO Groups (href: /admin/so-groups)         ← NEW
- Contact Roles (href: /admin/contact-roles) ← NEW
- Customers (href: /admin/customers)         ← UPDATE

Update dashboard stat cards at /app/(admin)/admin/page.tsx:
- Total Users (isActive=true)
- Active Routes
- Active SKUs
- Active Customers
- Active Transporters  ← NEW
- Active SO Groups     ← NEW

Keep all existing layout logic (mobile collapse, active highlight, sign-out) unchanged.
```

**Test:** Sidebar shows all sections and items. Click each — 404 is fine for new screens. Existing screens (users, routes, areas, etc.) still work.

---

## STEP 5 — System Config editor update

**What this builds:** Removes the old `dispatch_cutoff_time` key, updates descriptions.
**Dependency:** Step 3 (schema + seed updated).
**Test:** /admin/system-config shows 8 keys (not 9), no dispatch_cutoff_time.

```
Read CLAUDE_CONTEXT.md. Read /app/(admin)/admin/system-config/page.tsx and its API route.

Update the system-config screen:

1. Remove any reference to dispatch_cutoff_time key.

2. Update the two section groups:
   Section "Timing & Locks":
   - soft_lock_minutes_before_cutoff → "Soft Lock (minutes before cutoff)" — "Plan enters soft-lock, approval queue opens"
   - hard_lock_minutes_before_cutoff → "Hard Lock (minutes before cutoff)" — "New orders auto-routed to next slot"
   - ready_escalation_minutes → "Escalation Timer (minutes)" — "Fires if dispatcher hasn't acted after material ready"

   Section "Planning Rules":
   - upgrade_small_overflow_pct → "Overflow Upgrade Threshold (%)" — "Max overflow before upgrade suggested over bump"
   - upgrade_max_dealer_combo → "Max Dealer Combo (split check)" — "Dealers checked for concentration before split"
   - aging_priority_days → "Aging Priority Days" — "Days before order elevates to tier-3 priority"
   - aging_alert_days → "Aging Alert Days" — "Days before escalation alert fires"
   - change_queue_urgent_alert → "Urgent Hold Alert" — "Show prominent notification for Urgent orders on Hold" (Switch)

3. API route /api/admin/system-config: ensure it only allows updating existing keys, never inserting new ones. No changes to that logic needed if already correct.
```

**Test:** /admin/system-config loads, shows 8 keys in 2 sections. Save each section — toast confirms. Hard refresh — values persist.

---

## STEP 6 — Slot Master screen

**What this builds:** Admin screen to manage dispatch slot definitions.
**Dependency:** Steps 3, 4 complete.
**Test:** /admin/slots loads, shows 5 seeded slots, can add/edit/toggle.

```
Read CLAUDE_CONTEXT.md. This screen manages slot_master.

Build /app/(admin)/admin/slots/page.tsx — Slot Master.

Table columns: Sort Order, Name, Slot Time (HH:MM), Is Next Day, Active, Actions
Default sort: sortOrder ASC.

Add/Edit form (shadcn/ui Sheet):
- name (required, unique)
- slotTime (required, pattern HH:MM — display reference only, not used for logic)
- isNextDay (Switch — "Belongs to following calendar day")
- sortOrder (number, required)
- isActive (Switch)

Rules:
- Cannot delete slots (only deactivate)
- Warn if deactivating a slot that has active delivery_type_slot_config rows referencing it

API /app/api/admin/slots:
- GET — all slots ordered by sortOrder
- POST — create slot
- PATCH /[id] — update slot. Check for active config references before deactivating.
Guard: Admin only.

Note on the slot time field: add a helper text "This is a display reference only.
Actual cutoff windows are configured in Slot Rules."
```

**Test:** 5 seeded slots visible. Add a new "Late Night" slot at 20:00. Edit its sortOrder. Toggle it inactive. Verify in Supabase Studio.

---

## STEP 7 — Slot Rules screen (delivery_type_slot_config)

**What this builds:** Admin screen to manage per-delivery-type slot window rules.
**Dependency:** Step 6 (slot_master screen) complete.
**Test:** /admin/slot-rules loads, shows 6 seeded rules, can add/edit.

```
Read CLAUDE_CONTEXT.md. This screen manages delivery_type_slot_config.

Build /app/(admin)/admin/slot-rules/page.tsx — Delivery Type Slot Rules.

Table columns: Delivery Type, Slot Name, Rule Type, Window Start, Window End, Is Default, Sort Order, Active, Actions
Group rows by Delivery Type in the table (visual grouping, not separate tables).

Add/Edit form (Sheet):
- deliveryTypeId (Select from delivery_type_master, required)
- slotId (Select from slot_master where isActive=true, required)
- slotRuleType (Radio: "Time Based" | "Default")
- windowStart (time input HH:MM — shown only if slotRuleType=time_based)
- windowEnd (time input HH:MM — shown only if slotRuleType=time_based)
- isDefault (Switch — "Fallback slot when no time window matches")
- sortOrder (number — evaluation order for time_based)
- isActive (Switch)

Validation:
- If slotRuleType=time_based: windowStart and windowEnd are required
- If slotRuleType=default: windowStart/End not shown, set to null
- Only one isDefault=true allowed per delivery type — warn if attempting to set a second
- @@unique([deliveryTypeId, slotId]) — prevent duplicate combos

API /app/api/admin/slot-rules:
- GET — all configs with deliveryType + slot joins, ordered by deliveryType name then sortOrder
- POST — create rule
- PATCH /[id] — update rule
Guard: Admin only.
```

**Test:** 6 seeded rules visible grouped by delivery type. Add a rule for IGT delivery type → Night slot → default. Verify isDefault validation works (try adding a second default for Local → expect warning).

---

## STEP 8 — Product Category, Product Name, Base Colour screens

**What this builds:** Three linked lookup screens for the SKU hierarchy.
**Dependency:** Steps 3, 4 complete.
**Test:** All three screens load with seeded data, CRUD works.

```
Read CLAUDE_CONTEXT.md. Build three simple lookup screens. They are similar in structure — build them together.

Screen 1: /app/(admin)/admin/product-categories/page.tsx
Table: Name, SKU Count, Active, Actions
Form (Sheet): name (required, unique), isActive (Switch)
Cannot delete — deactivate only. SKU Count from sku_master count.

Screen 2: /app/(admin)/admin/product-names/page.tsx
Table: Name, Category, SKU Count, Active, Actions
Form (Sheet): name (required, unique), categoryId (Select from product_category, required), isActive (Switch)
Filter above table: by category (Select)
Cannot delete — deactivate only.

Screen 3: /app/(admin)/admin/base-colours/page.tsx
Table: Name, SKU Count, Active, Actions
Form (Sheet): name (required, unique), isActive (Switch)
Special rule: the 'N/A' row cannot be deactivated (it is the fallback for non-tint SKUs).
Cannot delete any row — deactivate only.

API routes:
- /api/admin/product-categories — GET, POST, PATCH/[id]
- /api/admin/product-names — GET (with category join + sku count), POST, PATCH/[id]
- /api/admin/base-colours — GET (with sku count), POST, PATCH/[id]
Guard: Admin only on all routes.
```

**Test:**
- Product Categories: 6 seeded rows visible. Add "Waterproofing". Edit its name. Verify SKU Count = 0.
- Product Names: 8 seeded rows. Filter by Emulsion — shows Aquatech, WS, Weathercoat. Add a name.
- Base Colours: 8 seeded rows. Try deactivating 'N/A' — confirm it's blocked.

---

## STEP 9 — SKU Master rebuild

**What this builds:** SKU screen rebuilt for Schema v10 (new FKs, no grossWeightPerUnit, no sub-SKUs).
**Dependency:** Step 8 (product_category, product_name, base_colour screens) complete.
**Test:** /admin/skus loads, seed data visible, CRUD works with new structure.

```
Read CLAUDE_CONTEXT.md. Read the current /app/(admin)/admin/skus/page.tsx — this screen needs a full rebuild due to schema changes.

Rebuild /app/(admin)/admin/skus/page.tsx — SKU Master (Schema v10).

IMPORTANT CHANGES from old version:
- grossWeightPerUnit REMOVED — do not show it anywhere
- sku_sub_master REMOVED — no sub-SKU tab or section
- NEW FKs: productCategoryId, productNameId, baseColourId

Table columns: SKU Code, Product Name, Category, Base Colour, Pack Size, Container Type, Units/Carton, Active, Actions
Filters: search by skuCode or skuName, filter by productCategoryId (Select), filter by containerType, filter by isActive

Add/Edit form (Sheet):
Section 1 — Identity:
- skuCode (required, uppercase, unique)
- skuName (required — auto-suggest based on productName + packSize + baseColour selections)

Section 2 — Classification:
- productCategoryId (Select from product_category where isActive=true, required, label "Category")
- productNameId (Select from product_name filtered by selected categoryId, required, label "Product Name")
  → Dynamic: when category changes, product name dropdown repopulates
- baseColourId (Select from base_colour where isActive=true, required, label "Base / Colour")

Section 3 — Pack Details:
- packSize (text, required, e.g. "1L", "4L", "20L", "20kg")
- containerType (Select: tin | drum | carton | bag, required)
- unitsPerCarton (number, optional — show helper "Not applicable for drums/bags")
- isActive (Switch)

NOTE: No weight field. Add helper text: "Weight is captured from the OBD import file at order time."

CSV import button:
Columns: skuCode, skuName, categoryName, productNameStr, baseColourName, packSize, containerType, unitsPerCarton
Resolve FKs by name (case-insensitive). Upsert on skuCode.
Return: X created, Y updated, Z failed with reasons.

API /app/api/admin/skus:
- GET — paginated, with productCategory + productName + baseColour joins, filter support
- POST — validate FK IDs exist before insert
- PATCH /[id] — update
- POST /import — CSV import endpoint
Guard: Admin only.
```

**Test:** Screen loads. Add 1 SKU manually — select Category → Product Name filters correctly → select Base Colour → save. Import CSV with 5 rows. Verify old sku_sub_master tab/section is completely gone.

---

## STEP 10 — Transporter Master screen

**What this builds:** Simple admin screen for transporter companies.
**Dependency:** Steps 3, 4 complete.
**Test:** /admin/transporters loads with 3 seeded rows, CRUD works.

```
Read CLAUDE_CONTEXT.md. Build /app/(admin)/admin/transporters/page.tsx — Transporter Master.

Table columns: Name, Contact Person, Phone, Email, Vehicle Count, Active, Actions
Vehicle Count = count of vehicle_master rows with this transporterId.

Add/Edit form (Sheet):
- name (required, unique)
- contactPerson (optional)
- phone (optional)
- email (optional, validate email format if provided)
- isActive (Switch)

Rules:
- Cannot deactivate a transporter that has active vehicles assigned. Show error: "X active vehicles assigned. Reassign or deactivate vehicles first."
- Cannot delete — deactivate only.

API /app/api/admin/transporters:
- GET — with vehicle count
- POST
- PATCH /[id] — check active vehicle constraint before deactivation
Guard: Admin only.
```

**Test:** 3 seeded rows visible with correct vehicle counts. Add a new transporter. Try deactivating one that has vehicles — confirm error. Deactivate one with no vehicles — succeeds.

---

## STEP 11 — Sales Officer Group screen

**What this builds:** Customer portfolio management — bulk SO reassignment.
**Dependency:** Sales officers must be seeded (Step 2).
**Test:** /admin/so-groups loads with 4 seeded groups, reassignment works.

```
Read CLAUDE_CONTEXT.md. Build /app/(admin)/admin/so-groups/page.tsx — Sales Officer Groups.

This screen is critical for bulk reassignment. Build it carefully.

Table columns: Group Name, Assigned Sales Officer, Customer Count, Active, Actions
Customer Count = count of delivery_point_master rows with this salesOfficerGroupId.

Add/Edit form (Sheet):
- name (required, unique, e.g. "Varacha North Portfolio")
- salesOfficerId (Select from sales_officer_master where isActive=true, required, label "Assigned Sales Officer")
- isActive (Switch)

BULK REASSIGN feature — separate action button per row in table:
"Reassign SO" button opens a small modal:
- Current SO shown (read-only)
- New SO (Select from sales_officer_master — exclude current)
- Confirm button: "Reassign all X customers to [new SO]"
- On confirm: UPDATE sales_officer_group SET salesOfficerId = <new> WHERE id = <group>
- Success toast: "All X customers in [group] reassigned to [new SO]"

Rules:
- Cannot deactivate a group that has active customers. Show count.
- Cannot delete — deactivate only.

API /app/api/admin/so-groups:
- GET — with salesOfficer join + customer count
- POST
- PATCH /[id] — update (including salesOfficerId for reassignment)
Guard: Admin only.
```

**Test:** 4 seeded groups visible with correct customer counts (likely 0 until customers are linked). Add a group. Test bulk reassign modal on an existing group — change the SO, confirm the DB row updated.

---

## STEP 12 — Contact Role Master screen

**What this builds:** Simple lookup screen for contact roles.
**Dependency:** Steps 3, 4 complete.
**Test:** /admin/contact-roles loads with 4 seeded rows.

```
Read CLAUDE_CONTEXT.md. Build /app/(admin)/admin/contact-roles/page.tsx — Contact Role Master.

Table columns: Name, Active, Actions (simple — same pattern as delivery-types screen)
Add/Edit form (Sheet): name (required, unique), isActive (Switch)
Cannot delete — deactivate only.

API /app/api/admin/contact-roles — GET, POST, PATCH/[id]. Admin only.

Keep it minimal. Same pattern as the sales-officers screen.
```

**Test:** 4 rows visible. Add "Accounts Manager". Toggle one inactive. Verify in Supabase.

---

## STEP 13 — Area Master update (primaryRouteId)

**What this builds:** Adds primary route selection to the area form.
**Dependency:** Step 3 (schema), routes screen must be working.
**Test:** /admin/areas shows Primary Route column, can set it per area.

```
Read CLAUDE_CONTEXT.md. Read /app/(admin)/admin/areas/page.tsx and its API.

Update the Areas screen to add primaryRouteId support.

Table: add "Primary Route" column showing the primaryRoute.name (or "—" if null).

Add/Edit form: add a "Primary Route" Select field
- Options: all active routes from route_master
- Required for new areas (recommend making nullable in UI only — DB is nullable for migration safety)
- Placed after Delivery Type in the form
- Helper text: "The default route for this area. Used for dispatch planning and customer inheritance."

API update /api/admin/areas:
- GET: include primaryRoute relation in select (id, name)
- POST: accept primaryRouteId, validate it exists
- PATCH /[id]: accept primaryRouteId updates

Do not remove any existing functionality (delivery type, route map assignments).
```

**Test:** Edit existing area "Varacha Road" — set Primary Route to "Varacha". Verify in table and Supabase Studio. Create new area with primary route set.

---

## STEP 14 — Customer Master update

**What this builds:** Customer screen updated with all Schema v10 new fields.
**Dependency:** Steps 11 (SO Groups), 12 (Contact Roles), 13 (Areas with primaryRoute) complete.
**Test:** /admin/customers shows new fields, all save correctly.

```
Read CLAUDE_CONTEXT.md. Read the current /app/(admin)/admin/customers/page.tsx carefully.

Update the Customer Master screen with all Schema v10 additions. Do NOT rebuild from scratch — update the existing screen.

TABLE — add these columns:
- SO Group (salesOfficerGroup.name or "—")
- Rating (customerRating badge: A=green, B=amber, C=red)
Remove no columns.

ADD/EDIT FORM — add these new fields to the existing sections:

Section 2 — Location (existing) — add after subAreaId:
- primaryRouteId (Select from route_master, optional, label "Route Override")
  Helper: "Overrides the area's default route for this customer only"
- deliveryTypeOverrideId (Select from delivery_type_master, optional, label "Delivery Type Override")
  Helper: "Overrides the area's delivery type for this customer only"
- latitude and longitude already exist — keep them

Section 3 — Classification (new section, insert after Location):
- salesOfficerGroupId (Select from sales_officer_group where isActive=true, optional)
  Label: "Sales Officer Group"
  Helper: "Customer's portfolio group. SO is derived from the group."
  Show read-only derived value: "Sales Officer: [group.salesOfficer.name]" — update dynamically when group is selected
- customerRating (Radio or Select: A | B | C, optional, label "Customer Rating (A/B/C)")
  Helper: "A = High-value · B = Regular · C = Low-frequency. Set by Admin only."

Section 5 — Contacts (existing) — update each contact row to add:
- contactRoleId (Select from contact_role_master where isActive=true, optional, label "Role")
  Placed before the name field

API updates /api/admin/customers:
- GET: include salesOfficerGroup (with salesOfficer), primaryRoute, deliveryTypeOverride in select
- GET /[id]: include all new relations
- POST: accept new fields, validate FK IDs
- PATCH /[id]: accept new fields
- For contacts: sync contactRoleId in the upsert transaction

Keep CSV import and all existing filters unchanged.
```

**Test:** Edit CUST-001 — assign to "Varacha North Portfolio" group → verify SO name appears automatically. Set rating to "A". Add a contact with Role "Owner". Save. Verify all fields in Supabase Studio.

---

## STEP 15 — Final wiring + pre-deploy validation

**What this builds:** Dashboard updated, all links wired, TypeScript clean, ready for deploy.
**Dependency:** All previous steps complete.
**Test:** Zero TS errors. All screens load. Auth guards work.

```
Read CLAUDE_CONTEXT.md. Final Phase 1 completion checklist. Execute in order:

1. Update /app/(admin)/admin/page.tsx dashboard:
   Stat cards (Prisma server-side counts):
   - Active Users (users where isActive=true)
   - Active Routes (route_master where isActive=true)
   - Active SKUs (sku_master where isActive=true)
   - Active Customers (delivery_point_master where isActive=true)
   - Active Transporters (transporter_master where isActive=true)
   - Active SO Groups (sales_officer_group where isActive=true)
   Recent activity: last 5 customers created (name, area, createdAt)

2. Verify /app/unauthorized/page.tsx exists. If not, create it:
   - "Access Denied" heading
   - Show user's current role
   - Link back to their correct home route

3. Run: npx tsc --noEmit
   Fix EVERY TypeScript error before continuing.

4. Run: npx prisma validate
   Must exit clean.

5. Manual test checklist — verify each:
   □ /login loads and works
   □ admin@orbitoms.com → /admin
   □ /admin/system-config — 8 keys, saves correctly
   □ /admin/slots — 5 slots, add/edit works
   □ /admin/slot-rules — 6 rules, grouped by delivery type
   □ /admin/product-categories — 6 rows
   □ /admin/product-names — 8 rows, category filter works
   □ /admin/base-colours — 8 rows, N/A cannot be deactivated
   □ /admin/skus — loads with new columns, no weight/sub-sku fields
   □ /admin/transporters — 3 rows
   □ /admin/so-groups — 4 rows, bulk reassign modal works
   □ /admin/contact-roles — 4 rows
   □ /admin/areas — Primary Route column and field present
   □ /admin/customers — SO Group, Rating, Route Override fields present

6. Check every API route file has requireRole() guard.
   List any missing guards and fix them.

7. Confirm no hardcoded slot times or status strings anywhere in the codebase.
   All status lookups must query status_master WHERE domain='<domain>'.
   All slot lookups must query slot_master / delivery_type_slot_config.

Report: list of all files created or modified, any remaining issues.
```

**Test:** `npx tsc --noEmit` exits clean. All 15 checklist items pass. App ready for Vercel deploy.

---

## APPENDIX A — Prisma query patterns for v10

Use these patterns consistently across all API routes.

```typescript
// ── Status lookup (always filter by domain) ────────────────────────────────
const dispatchStatuses = await prisma.status_master.findMany({
  where: { domain: 'dispatch', isActive: true },
  orderBy: { sortOrder: 'asc' }
})

// ── SKU with full hierarchy ────────────────────────────────────────────────
const skus = await prisma.sku_master.findMany({
  include: {
    productCategory: true,
    productName: true,
    baseColour: true,
  }
})

// ── Customer with SO derived from group ────────────────────────────────────
const customer = await prisma.delivery_point_master.findUnique({
  where: { id },
  include: {
    area: { include: { deliveryType: true, primaryRoute: true } },
    salesOfficerGroup: { include: { salesOfficer: true } },
    primaryRoute: true,
    deliveryTypeOverride: true,
    contacts: { include: { contactRole: true } },
  }
})

// ── Bulk SO reassignment (one query) ──────────────────────────────────────
await prisma.sales_officer_group.update({
  where: { id: groupId },
  data: { salesOfficerId: newSalesOfficerId }
})

// ── Slot rule evaluation (import time) ────────────────────────────────────
const slotRules = await prisma.delivery_type_slot_config.findMany({
  where: { deliveryTypeId, isActive: true },
  include: { slot: true },
  orderBy: { sortOrder: 'asc' }
})
```

---

## APPENDIX B — Seed upsert key reference

| Table | Upsert key |
|---|---|
| status_master | @@unique([domain, code]) |
| slot_master | name |
| delivery_type_slot_config | @@unique([deliveryTypeId, slotId]) |
| product_category | name |
| product_name | name |
| base_colour | name |
| contact_role_master | name |
| transporter_master | name |
| sales_officer_master | email |
| sales_officer_group | name |
| delivery_type_master | name |
| route_master | name |
| system_config | key |
| role_master | name |

---
*Phase 1 Completion Guide · Schema v10 · March 2026*
