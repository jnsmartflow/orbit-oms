# PHASE_1_BUILD_PROMPTS.md — Orbit OMS
# Sequential prompt guide for Claude Code execution.
# Run one step at a time. Test before proceeding to the next.
# Each prompt is designed to be pasted directly into Claude Code.

---

## Before every session

Start every Claude Code session with this primer:

```
Read CLAUDE_CONTEXT.md fully. Confirm you understand:
1. The tech stack (Next.js 14, TypeScript, Tailwind, shadcn/ui, Prisma, Supabase, NextAuth)
2. We are building Phase 1 only — Foundation and Admin Panel
3. Do not install libraries not already in the project
4. Do not build anything related to orders, dispatch, or warehouse execution

State what you understand before proceeding.
```

---

## STEP 1 — Project scaffold

**What this builds:** Next.js 14 project with all Phase 1 dependencies installed and configured.

**Expected output:** A running `npm run dev` at localhost:3000 showing a blank Next.js page. All config files present.

```
Scaffold a new Next.js 14 App Router project in the current directory with these exact specifications:

Framework: Next.js 14 with App Router and TypeScript in strict mode
Styling: Tailwind CSS. Install and init shadcn/ui using the CLI (use default settings, style: default, base color: slate)
ORM: Prisma with PostgreSQL provider
Auth: next-auth v5 (beta)
Additional packages: bcryptjs @types/bcryptjs, zod for validation

After installing:
1. Create /lib/prisma.ts — Prisma client singleton using the standard globalThis pattern for dev hot-reload safety
2. Create /lib/auth.ts — NextAuth v5 config skeleton with credentials provider (email + password), jwt strategy, session callback that includes user.id and user.role
3. Create .env.local with these placeholder keys: DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL=http://localhost:3000
4. Create .gitignore that excludes .env.local, node_modules, .next
5. Run npm run dev and confirm it starts without errors

Do not create any pages or components yet. Scaffold only.
```

**Test:** `npm run dev` runs. localhost:3000 loads. No TypeScript errors in terminal.

---

## STEP 2 — Prisma schema: all 33 tables

**What this builds:** Complete database schema in schema.prisma. All 33 tables across all 4 groups. Phase 1 tables fully specified. Phase 2/3 tables as stubs (minimal fields — id + timestamps only) so foreign keys resolve.

**Expected output:** `npx prisma validate` passes with no errors.

```
Write the complete Prisma schema for Orbit OMS in /prisma/schema.prisma.

Generator and datasource blocks:
- provider: postgresql
- previewFeatures: ["postgresqlExtensions"]

Define ALL 33 tables. Phase 1 tables need full field definitions. Phase 2/3 tables need only id + createdAt + updatedAt as stubs.

PHASE 1 — full field definitions required:

system_config: id, key String @unique, value String, updatedAt

role_master: id, name String @unique (Admin|Dispatcher|Support|Tint Manager|Tint Operator|Floor Supervisor|Picker), description String?

users: id, email String @unique, password String (hashed), name String, roleId → role_master, isActive Boolean @default(true), createdAt, updatedAt

delivery_type_master: id, name String @unique (Local|Upcountry), createdAt

route_master: id, name String @unique, isActive Boolean @default(true), createdAt

area_master: id, name String, deliveryTypeId → delivery_type_master, isActive Boolean @default(true), createdAt
NOTE: delivery_type lives on area_master, NOT route_master

area_route_map: id, areaId → area_master, routeId → route_master, @@unique([areaId, routeId])

sub_area_master: id, name String, areaId → area_master, isActive Boolean @default(true), createdAt

sales_officer_master: id, name String, email String @unique, isActive Boolean @default(true), createdAt

delivery_point_master: id, customerCode String @unique, customerName String, areaId → area_master, subAreaId → sub_area_master nullable, isKeyCustomer Boolean @default(false), isKeySite Boolean @default(false), workingHoursStart String nullable, workingHoursEnd String nullable, noDeliveryDays String[] (days of week), latitude Float nullable, longitude Float nullable, isActive Boolean @default(true), createdAt, updatedAt

delivery_point_contacts: id, deliveryPointId → delivery_point_master, name String, phone String nullable, email String nullable, isPrimary Boolean @default(false), createdAt

sku_master: id, skuCode String @unique, skuName String, packSize String, containerType String (tin|drum|carton|bag), unitsPerCarton Int nullable, grossWeightPerUnit Float, isActive Boolean @default(true), createdAt, updatedAt

sku_sub_master: id, skuId → sku_master, subCode String @unique, description String nullable, createdAt

delivery_priority_master: id, name String @unique (Urgent|Normal), sortOrder Int, createdAt

dispatch_status_master: id, name String @unique (Hold|Dispatch|Waiting for Confirmation), createdAt

tinting_status_master: id, name String @unique (pending_tint_assignment|tinting_in_progress|tinting_done), createdAt

PHASE 2 STUBS (id + createdAt only):
import_batches, import_raw_summary, import_raw_line_items, import_enriched_line_items, import_obd_query_summary, orders, order_splits, tint_assignments, tint_logs, order_status_logs

PHASE 3 STUBS (id + createdAt only):
vehicle_master, dispatch_plans, dispatch_plan_vehicles, dispatch_plan_orders, dispatch_change_queue, pick_lists, pick_list_items

After writing the schema, run: npx prisma validate
Report any errors and fix them before stopping.
```

**Test:** `npx prisma validate` exits with no errors. Review schema.prisma visually — confirm all Phase 1 tables have full fields.

---

## STEP 3 — Database push + seed

**What this builds:** All 33 tables created in Supabase. Lookup tables seeded with correct values.

**Prerequisite:** DATABASE_URL in .env.local must be set to your Supabase connection string before running this step.

**Expected output:** All tables visible in Supabase Studio. Seed data present in all lookup tables.

```
The DATABASE_URL is now set in .env.local. Execute the following sequence:

1. Run: npx prisma db push
   If it fails, read the error, fix schema.prisma, and retry. Do not proceed if push fails.

2. Create /prisma/seed.ts with this exact seed data:

system_config rows (key, value):
- dispatch_cutoff_time: "10:30"
- soft_lock_minutes_before_cutoff: "30"
- hard_lock_minutes_before_cutoff: "15"
- ready_escalation_minutes: "10"
- upgrade_small_overflow_pct: "12"
- upgrade_max_dealer_combo: "3"
- aging_priority_days: "2"
- aging_alert_days: "3"
- change_queue_urgent_alert: "true"

role_master rows: Admin, Dispatcher, Support, Tint Manager, Tint Operator, Floor Supervisor, Picker

delivery_type_master rows: Local, Upcountry

delivery_priority_master rows: Urgent (sortOrder:1), Normal (sortOrder:2)

dispatch_status_master rows: Hold, Dispatch, Waiting for Confirmation

tinting_status_master rows: pending_tint_assignment, tinting_in_progress, tinting_done

Admin user:
- email: admin@orbitoms.com
- password: Admin@123 (hash with bcryptjs, saltRounds:10)
- name: System Admin
- role: Admin

Use upsert with skipDuplicates where possible so seed is re-runnable.

3. Add to package.json scripts: "seed": "ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts"
4. Add prisma.seed config to package.json
5. Run: npm run seed
6. Confirm in Supabase Studio that all tables have data.
```

**Test:** Open Supabase Studio → Table Editor. Verify system_config has 9 rows, role_master has 7 rows, seed user exists.

---

## STEP 4 — RBAC + auth layer

**What this builds:** NextAuth session with role, a `requireRole()` server guard, and middleware that protects all non-public routes.

**Expected output:** A utility function and middleware file. No UI yet.

```
Build the complete auth and RBAC layer for Orbit OMS. No UI — server-side only.

1. Update /lib/auth.ts — complete NextAuth v5 config:
   - Credentials provider: find user by email in DB via Prisma, compare password with bcryptjs
   - On success, return { id, email, name, role: user.rolemaster.name }
   - JWT callback: persist id and role into token
   - Session callback: expose token.id and token.role on session.user
   - TypeScript: extend Session and User types to include role: string

2. Create /lib/rbac.ts:
   - Export const ROLES object with all 7 role name strings as constants
   - Export function requireRole(session: Session | null, allowed: string[]): void
     → throws redirect('/unauthorized') if session is null
     → throws redirect('/unauthorized') if session.user.role not in allowed[]
   - Export function hasRole(session: Session | null, allowed: string[]): boolean
     → returns boolean, no throw

3. Create /middleware.ts at project root:
   - Protect all routes under /admin, /dispatcher, /support, /tint, /warehouse
   - Public routes: /, /login, /api/auth
   - Use NextAuth v5 auth() in middleware
   - Redirect unauthenticated users to /login

4. Create /app/api/auth/[...nextauth]/route.ts — NextAuth v5 route handler

5. TypeScript: ensure zero type errors across all four files. Run npx tsc --noEmit and fix any errors before stopping.
```

**Test:** `npx tsc --noEmit` exits clean. Review the four files manually.

---

## STEP 5 — Login page

**What this builds:** Login screen with email/password form. On success, redirects to role-appropriate dashboard.

**Expected output:** localhost:3000/login renders a login form. admin@orbitoms.com / Admin@123 logs in and redirects to /admin.

```
Build the login page at /app/login/page.tsx.

Specifications:
- Server component outer shell, client component for the form ("use client")
- Form fields: email (type email), password (type password)
- On submit: call signIn('credentials', { email, password, redirect: false })
- Error handling: display "Invalid email or password" for CredentialsSignin error
- On success: redirect based on session.user.role:
  Admin → /admin
  Dispatcher → /dispatcher
  Support → /support
  Tint Manager → /tint/manager
  Tint Operator → /tint/operator
  Floor Supervisor → /warehouse/supervisor
  Picker → /warehouse/picker
- UI: centered card layout, Orbit OMS logo text, shadcn/ui Card + Input + Button components
- Tailwind: clean, professional, works on mobile and desktop
- No register link, no forgot password link — this is an internal tool, admin creates accounts

Also create placeholder pages (just a heading + role name + sign out button) at:
/app/(admin)/admin/page.tsx
/app/(dispatcher)/dispatcher/page.tsx
/app/(support)/support/page.tsx
/app/(tint)/tint/manager/page.tsx
/app/(tint)/tint/operator/page.tsx
/app/(warehouse)/warehouse/supervisor/page.tsx
/app/(warehouse)/warehouse/picker/page.tsx

Each placeholder should use requireRole() from /lib/rbac.ts to enforce access.
```

**Test:** Visit /login. Log in with admin@orbitoms.com / Admin@123. Confirm redirect to /admin. Try accessing /dispatcher directly — confirm redirect to /login (or /unauthorized).

---

## STEP 6 — Admin layout + sidebar

**What this builds:** Admin panel shell — persistent sidebar with navigation, top header with user info and sign-out, main content area.

**Expected output:** /admin loads with a sidebar showing all admin menu items.

```
Build the admin panel layout at /app/(admin)/admin/layout.tsx.

Sidebar navigation items (in order):
- Dashboard (href: /admin)
- System Config (href: /admin/system-config)
- Users (href: /admin/users)
- Roles (href: /admin/roles) — read-only view
- Delivery Types (href: /admin/delivery-types)
- Routes (href: /admin/routes)
- Areas (href: /admin/areas)
- Sub-areas (href: /admin/sub-areas)
- Sales Officers (href: /admin/sales-officers)
- Customers (href: /admin/customers)
- SKUs (href: /admin/skus)
- Vehicles (href: /admin/vehicles) — stub only, Phase 3 table

Layout requirements:
- Fixed left sidebar, 240px wide, dark background (#111)
- Top header: "Orbit OMS" title left, user name + role + sign-out button right
- Main content area: scrollable, light background
- Active route highlighted in sidebar
- usePathname() for active state
- Mobile: sidebar collapses behind a hamburger button
- Auth guard: this layout must call requireRole(session, ['Admin'])
- shadcn/ui components where applicable

Create /app/(admin)/admin/page.tsx as a real dashboard:
- 4 stat cards: Total Users, Active Routes, Active SKUs, Active Customers
- Each card fetches its count from Prisma server-side
- shadcn/ui Card components
```

**Test:** /admin loads with sidebar. Click each menu item — 404 pages are fine at this stage, navigation should work. Sign-out button works.

---

## STEP 7 — System Config editor

**What this builds:** Admin screen to view and edit all 9 system_config key-value pairs.

**Expected output:** /admin/system-config shows a form with all 9 keys, editable values, save button.

```
Build /app/(admin)/admin/system-config/page.tsx — System Configuration editor.

Data: Read all rows from system_config table. Display as an editable form.

For each config key, show:
- Key name as a readable label (e.g. "dispatch_cutoff_time" → "Dispatch Cutoff Time")
- Current value in an Input field
- Description of what the key controls (hardcode the descriptions from CLAUDE_CONTEXT.md)

UI requirements:
- Group into two sections: "Timing & Slots" (first 3 keys) and "Planning Rules" (remaining 6)
- shadcn/ui Card per section, Label + Input per row
- Save button per section (not one global save — section-scoped)
- On save: PATCH /api/admin/system-config with { key, value } pairs
- Success toast using shadcn/ui Sonner: "Configuration saved"
- Validation: dispatch_cutoff_time must match HH:MM format. Numeric fields must be positive integers. Boolean fields render as a Switch component not a text input.

API route: /app/api/admin/system-config/route.ts
- GET: return all system_config rows
- PATCH: accept { updates: [{key, value}] }, update each row, return updated rows
- Guard: requireRole for Admin only
- Never allow inserting new keys — only update existing ones
```

**Test:** Change a value, save, hard refresh page — confirm value persisted. Try saving an invalid time format — confirm validation error shows.

---

## STEP 8 — User management

**What this builds:** Admin screen to create, view, deactivate, and reset passwords for depot staff.

**Expected output:** /admin/users shows all users. Admin can add new users and assign roles.

```
Build /app/(admin)/admin/users/page.tsx — User Management.

Table columns: Name, Email, Role, Status (Active/Inactive), Created, Actions

Actions per row:
- Toggle active/inactive (no delete — soft deactivate only)
- Reset password → opens a modal with a new password input (admin sets it, not email-based)

Add User button → opens a shadcn/ui Sheet (slide-in panel) with:
- Name (required)
- Email (required, unique — validate against DB)
- Role (Select dropdown populated from role_master)
- Password (required, min 8 chars)
- Confirm Password

API routes in /app/api/admin/users/:
- GET /api/admin/users — list all users with role name, exclude password field
- POST /api/admin/users — create user, hash password with bcryptjs saltRounds:10, validate email uniqueness
- PATCH /api/admin/users/[id] — update isActive or password (hash if password update)

Constraints:
- Cannot deactivate yourself (the logged-in admin)
- Cannot change your own role
- Password never returned in any API response
- Role dropdown must not include a blank option — default to first non-Admin role
- Guard all routes: Admin only
```

**Test:** Create a new user with Dispatcher role. Log out. Log in as that user. Confirm redirect to /dispatcher. Log back in as admin. Deactivate that user. Confirm login fails.

---

## STEP 9 — Delivery hierarchy (Routes, Areas, Sub-areas)

**What this builds:** Three linked admin screens managing the delivery geography hierarchy.

**Expected output:** /admin/routes, /admin/areas, /admin/sub-areas — each with full CRUD.

```
Build three linked admin screens for the delivery hierarchy. These must be built together because of foreign key dependencies.

Screen 1: /admin/delivery-types
- Simple table: Local, Upcountry (seeded, no add/delete — display only)
- No editing needed

Screen 2: /admin/routes — route_master CRUD
- Table: Route Name, Status, Area Count, Actions (Edit name, Toggle active)
- Add Route: name only
- Inline edit name with shadcn/ui editable cell pattern
- Cannot delete — only deactivate

Screen 3: /admin/areas — area_master CRUD
- Table: Area Name, Delivery Type (Local/Upcountry), Assigned Routes, Status, Actions
- Add Area: name + delivery_type (Select) + route assignment (multi-select from route_master)
  → Creates area_master row + area_route_map rows
- Edit: can change delivery type and route assignments
- IMPORTANT: delivery_type is on area_master, never on route_master

Screen 4: /admin/sub-areas — sub_area_master CRUD
- Table: Sub-area Name, Parent Area, Status, Actions
- Add Sub-area: name + area (Select from area_master)
- Filter: dropdown to filter sub-areas by area

API routes:
- /api/admin/routes — GET (with area count), POST, PATCH/[id]
- /api/admin/areas — GET (with delivery_type join + route count), POST (creates area + maps), PATCH/[id]
- /api/admin/sub-areas — GET (with area join), POST, PATCH/[id]

All routes: Admin only guard.
```

**Test:** Create a route "Varacha". Create an area "Vesu" with type "Local", assigned to "Varacha". Create sub-area "Vesu North" under "Vesu". Verify relationships in Supabase Studio.

---

## STEP 10 — Sales Officers

**What this builds:** Simple admin screen for sales officer master data. Used in Phase 2 for slot override approval.

**Expected output:** /admin/sales-officers with full CRUD.

```
Build /app/(admin)/admin/sales-officers/page.tsx — Sales Officer master.

Table columns: Name, Email, Status, Actions
Add/Edit form (shadcn/ui Sheet): Name (required), Email (required, unique)
Toggle active/inactive. No hard delete.

API: /app/api/admin/sales-officers — GET, POST, PATCH/[id]. Admin only.

This screen is simple. Keep it minimal — one server component for data fetch, one client component for the form sheet. No over-engineering.
```

**Test:** Add a sales officer. Edit their name. Deactivate them. Verify in Supabase Studio.

---

## STEP 11 — Customer master (Delivery Points)

**What this builds:** The most data-rich admin screen. Customer list with all flags, area assignment, and contact management.

**Expected output:** /admin/customers with paginated table, full add/edit form, contact sub-section.

```
Build /app/(admin)/admin/customers/page.tsx — Customer Master (delivery_point_master).

This is the most complex admin screen. Build it carefully.

Table (paginated, 25 per page):
Columns: Customer Code, Customer Name, Area, Sub-area, Key Customer, Key Site, Active, Actions

Filters above table:
- Search by name or code (debounced, 300ms)
- Filter by area (Select)
- Filter by is_key_customer (checkbox)
- Filter by isActive (toggle: Active / Inactive / All)

Add/Edit form (full-page Sheet, wide):
Section 1 — Identity: customerCode (required, uppercase), customerName (required)
Section 2 — Location: areaId (Select, required), subAreaId (Select, filtered by selected area — dynamic), latitude (number, optional), longitude (number, optional)
Section 3 — Flags: isKeyCustomer (Switch), isKeySite (Switch), isActive (Switch)
Section 4 — Delivery constraints: workingHoursStart (time input, optional), workingHoursEnd (time input, optional), noDeliveryDays (multi-select: Mon Tue Wed Thu Fri Sat Sun)
Section 5 — Contacts: inline list of delivery_point_contacts. Add/remove contacts inline. Each contact: name, phone, email, isPrimary (only one can be primary).

API routes in /app/api/admin/customers/:
- GET — list with filters, pagination (page, limit, search, areaId, isKeyCustomer, isActive)
- POST — create customer + contacts in a Prisma transaction
- GET /[id] — fetch single customer with contacts
- PATCH /[id] — update customer + sync contacts (delete removed, upsert changed)

CSV import (add a button on the table page):
- Accept CSV with columns: customerCode, customerName, areaName, subAreaName, isKeyCustomer, isKeySite
- Resolve area/subArea by name (case-insensitive lookup)
- Upsert on customerCode
- Return a summary: X created, Y updated, Z failed with reasons

Admin only guard on all routes.
```

**Test:** Add 3 customers manually. Mark one as key customer. Use CSV import with a 5-row file. Filter by area — verify results. Edit a customer, change their area, verify sub-area dropdown updates.

---

## STEP 12 — SKU Master

**What this builds:** Product catalog admin screen with CSV import.

**Expected output:** /admin/skus with full CRUD and CSV upload.

```
Build /app/(admin)/admin/skus/page.tsx — SKU Master.

Table columns: SKU Code, SKU Name, Pack Size, Container Type, Units/Carton, Weight (kg), Status, Actions
Filters: search by code or name, filter by containerType, filter by isActive

Add/Edit form (Sheet):
- skuCode (required, uppercase)
- skuName (required)
- packSize (text, e.g. "4L", "20L", "1L")
- containerType (Select: tin | drum | carton | bag)
- unitsPerCarton (number, optional — not applicable to drums)
- grossWeightPerUnit (number in kg, required)
- isActive (Switch)

CSV import:
- Columns: skuCode, skuName, packSize, containerType, unitsPerCarton, grossWeightPerUnit
- Upsert on skuCode
- Validate containerType against enum
- Return: X created, Y updated, Z failed

API /app/api/admin/skus — GET (with filters + pagination), POST, PATCH/[id]. Admin only.

Also build /app/(admin)/admin/skus/[id]/sub-skus/page.tsx — sub-SKU management:
- List of sku_sub_master rows for this SKU
- Add sub-SKU: subCode, description
- Breadcrumb back to /admin/skus
```

**Test:** Add 5 SKUs manually. Import 10 via CSV including 2 that already exist (test upsert). Verify weight and container type saved correctly.

---

## STEP 13 — Final wiring + pre-deploy checks

**What this builds:** Admin dashboard with real counts, navigation polish, and pre-deploy validation.

**Expected output:** Zero TypeScript errors. Zero console errors. App ready for Vercel deployment.

```
Final Phase 1 wiring and pre-deploy checklist. Execute in order:

1. Update /app/(admin)/admin/page.tsx dashboard with real Prisma counts:
   - Active Users (users where isActive=true)
   - Active Routes (route_master where isActive=true)
   - Active SKUs (sku_master where isActive=true)
   - Active Customers (delivery_point_master where isActive=true)
   - Recent activity: last 5 users created (name, role, createdAt)

2. Add a /app/unauthorized/page.tsx:
   - Clean page: "Access denied" message, user's current role, link back to their home route

3. Add a /app/not-found.tsx:
   - Clean 404 page with link to home

4. Run full validation:
   npx tsc --noEmit
   Fix every TypeScript error before continuing.

5. Run: npx prisma validate
   Confirm schema is valid.

6. Test auth flow end to end:
   - Log in as admin → lands on /admin
   - Try to access /dispatcher → redirected to /unauthorized
   - Sign out → redirected to /login
   - Try to access /admin while signed out → redirected to /login

7. Check all API routes have requireRole() guard — list any that are missing it.

8. Confirm no hardcoded values that should come from system_config.

Report a summary: files created, any remaining issues, what is NOT built (Phase 2 scope).
```

**Test:** `npx tsc --noEmit` exits clean. All 8 admin screens load. Auth guards work.

---

## STEP 14 — Deploy to Vercel

**What this builds:** Live production URL for the Phase 1 app.

**Prerequisite:** GitHub account exists. Vercel account exists (linked to GitHub).

```
Deploy Orbit OMS Phase 1 to Vercel. Execute in order:

1. Create /README.md with:
   - Project name: Orbit OMS
   - Stack: Next.js 14, TypeScript, Tailwind, Prisma, Supabase, NextAuth
   - Phase: 1 — Foundation complete
   - Local setup: npm install → set .env.local → npx prisma db push → npm run seed → npm run dev

2. Initialize git and push to GitHub:
   git init
   git add .
   git commit -m "feat: Phase 1 Foundation — admin panel, auth, 16 master tables"

   Then give me the commands to add a GitHub remote and push. I will create the repo manually on github.com first.

3. After I confirm the push is done, provide exact instructions for:
   - Connecting the GitHub repo to Vercel
   - Which environment variables to add in Vercel dashboard (DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL — with production URL)
   - Any build settings to change (there should be none — Vercel auto-detects Next.js)

4. After deploy succeeds, confirm:
   - Visit the production URL /login — does it load?
   - Log in with admin@orbitoms.com — does it redirect to /admin?
   - Are all environment variables correctly set?

Note: The Supabase DATABASE_URL for production should use the connection pooler URL from Supabase (port 6543, not 5432) to avoid connection limit issues on serverless.
```

**Test:** Production URL loads. Login works. All admin screens accessible. Supabase Studio shows production data.

---

## Reference: step dependency map

```
STEP 1 (scaffold)
  └── STEP 2 (schema)
        └── STEP 3 (db push + seed)
              └── STEP 4 (auth layer)
                    └── STEP 5 (login page)
                          └── STEP 6 (admin layout)
                                ├── STEP 7 (system config)
                                ├── STEP 8 (users)
                                ├── STEP 9 (delivery hierarchy)
                                ├── STEP 10 (sales officers)
                                ├── STEP 11 (customers) ← depends on STEP 9
                                ├── STEP 12 (SKUs)
                                └── STEP 13 (final checks)
                                      └── STEP 14 (deploy)
```

Steps 7–12 can be done in any order after Step 6. Step 11 depends on Step 9 (needs areas/sub-areas to exist).

---

## Troubleshooting prompts (use when something breaks)

**Prisma error after schema change:**
```
I got a Prisma error: [paste error]. Read the current schema.prisma and fix the issue. Run npx prisma validate after fixing. Do not change any table or field names — only fix the structural issue.
```

**TypeScript error:**
```
I have a TypeScript error: [paste error and file path]. Read the file, understand the type mismatch, and fix it without changing the intended behaviour. Run npx tsc --noEmit after fixing.
```

**API returning 401/403:**
```
The API route [paste route] is returning [401/403]. Read the route file and /lib/rbac.ts. Check whether the requireRole() call is correct and whether the session is being passed correctly from the client. Fix and test.
```

**Auth session not persisting:**
```
The session is being lost between page navigations. Read /lib/auth.ts and /middleware.ts. Check NEXTAUTH_SECRET is set in .env.local and that the session strategy is jwt. Check middleware matcher is not blocking the auth callback route.
```

**Supabase connection error:**
```
Prisma cannot connect to Supabase. The error is: [paste error]. Check whether DATABASE_URL is correctly set and whether the connection string uses port 5432 (direct) or 6543 (pooler). For local dev use port 5432. Check the Supabase project is not paused.
```

---
*Phase 1 prompts · Orbit OMS · March 2026*
*Estimated build time: 2–3 weeks running 1–2 steps per day*
