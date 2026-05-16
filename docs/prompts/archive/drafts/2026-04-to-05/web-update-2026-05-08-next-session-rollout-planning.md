# Next Session — Planning: Role Architecture + Attendance Phase 1 Rollout
**This is a PLANNING session in claude.ai (browser).** No code will be written.
The deliverables are documented decisions that future Claude Code sessions
will execute against.

═══════════════════════════════════════════════════════════════════════
SESSION CONTEXT (to load Claude with at the start)
═══════════════════════════════════════════════════════════════════════

The OrbitOMS attendance feature was built and shipped to production
on 2026-05-08 across 11 prompts (P1-P11). Schema, auth gate, consent,
home, check-in/out (camera + GPS + selfie), history calendar, admin
dashboard, cron jobs (midnight rollover + photo retention purge),
and PWA manifest are all live.

Production state at session start:
- Branch main includes commit ed3a482a (full feature)
- attendance_settings.rolloutStage = 'OFF' (feature dormant)
- All env vars set in Vercel: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  CRON_SECRET
- 21 active users in DB; admin@orbitoms.com is the only admin
- Test data exists: admin's HALF_DAY session from 2026-05-08

Reference draft: docs/prompts/drafts/code-update-2026-05-08-attendance-feature-shipped.md
contains the full file map, business rules, and rollout context from
the build session.

═══════════════════════════════════════════════════════════════════════
WHAT WE'RE PLANNING TODAY
═══════════════════════════════════════════════════════════════════════

Three deliverables, in order:

1. **Bankim's daily routine map** — walk through a typical billing
   operator's day in OrbitOMS, before and after attendance lands.
   Surface UX issues before real users hit them.

2. **Role architecture design (decide and document, do NOT build)** —
   define the full role tree, permissions per role, and master-data
   approval workflow. Save as a reference doc. Implementation deferred
   to a future session.

3. **Phase 1 rollout plan for Dhruv & Kuldeep** — two new sub-admin
   accounts. They will pilot the attendance feature using the existing
   admin role temporarily (defers role-creation code), with access
   limited in practice to attendance + dashboard. After 3-5 days of
   their feedback, Phase 2 expands to billing operators.

═══════════════════════════════════════════════════════════════════════
DELIVERABLE 1 — BANKIM'S DAILY ROUTINE MAP
═══════════════════════════════════════════════════════════════════════

Goal: write down Bankim's typical day, step by step, mapping every
OrbitOMS interaction. Identify where attendance fits and any UX
friction the build session didn't anticipate.

Discussion points:

- What time does Bankim arrive at depot? (Inferred from attendance
  setting workStartTime = 09:30 IST.)
- Phone or PC for check-in? Both? Which is the depot's expectation?
- After check-in, where does he go in OrbitOMS? (Inferred: Mail
  Orders module — that's his daily work.)
- How many check-ins per day? Most operators are 1 check-in + 1
  check-out, but errand-return pattern (open second session) needs
  to be accounted for.
- Lunch break — does he check out at lunch, or stay checked in?
  Recommend: stays checked in, depot policy. Half-days are a different
  pattern (status = HALF_DAY).
- Phone battery / connectivity edge cases — what if battery dies at
  9:25 AM and he has to charge? What if depot wifi is down?
- End of day — when does he check out? Does he review his own
  /attendance/history at all, or is that purely admin-facing?
- "Forgot to check out" flow — Bankim leaves at 7 PM but forgets to
  check out. Cron at 00:05 IST flags hasMissingCheckout=true on his
  summary. Admin sees flag in P9 dashboard. What does Bankim see
  next morning when he opens OrbitOMS? (His /attendance home shows
  yesterday's missing checkout? Or nothing?)

Output format:
- Numbered list of Bankim's day, hour by hour
- Each step: action + which OrbitOMS screen + any friction risk
- Final list of UX questions surfaced

═══════════════════════════════════════════════════════════════════════
DELIVERABLE 2 — ROLE ARCHITECTURE DESIGN
═══════════════════════════════════════════════════════════════════════

Goal: design the full role tree and permissions matrix. Document only.
DO NOT write any code or schema migration in this session. The doc
becomes the source of truth for any future role-touching prompt.

Current state (from CLAUDE_CORE.md):
- Roles in DB: admin, billing_operator, tint_manager, tint_operator,
  picker (warehouse), planning, support, operations, sales_officer
- Admin = single role with full access
- Other roles = function-specific (mail orders, tint, dispatch, etc.)
- Master data (SKUs, base colours, customer keywords, shade master)
  currently editable only by admin

Design questions:

**Q1 — Two-tier admin or three-tier?**

Option A (two-tier, recommended starting point):
- super_admin: Smart Flow team, full access, escape hatch
- ops_admin: Depot supervisor (e.g. Prakashbhai), approves master
  additions + views attendance/finance/operations

Option B (three-tier):
- super_admin: Smart Flow only
- ops_admin: Depot supervisor for master approvals
- attendance_admin: Lighter role, only attendance dashboard + own
  check-in (could be Dhruv/Kuldeep's permanent role)

Recommend Option A — fewer roles to maintain, attendance dashboard
is just one of the things ops_admin can see. Sub-admins (Dhruv/Kuldeep)
get ops_admin role permanently after Phase 1.

**Q2 — Master data approval workflow**

Today: Bankim notices a missing SKU during order entry. Tells admin.
Admin manually adds via SQL or admin UI.

Proposed: Bankim submits a "request to add" via the order entry screen.
Request goes to ops_admin queue. Ops_admin reviews + approves.
Approved → SKU appears for use.

This is a significant new feature. Decide today: is it scoped for
Phase 2/Phase 3, or a parallel future workstream? Recommend defer
to "after attendance Phase 3 stabilises" — too many concurrent changes
risks instability.

**Q3 — Permissions matrix**

For each role, define:
- Pages: which sidebar entries are visible
- Actions: which write operations are allowed
- Master data: read-only / can-request / can-approve / can-direct-edit

Build a table during the session. Save as docs/role-architecture.md.

Rough starting point:

| Role | Mail Orders | Tint | Warehouse | Planning | Attendance | Master Data | Finance |
|---|---|---|---|---|---|---|---|
| super_admin | edit | edit | edit | edit | dashboard | direct-edit | edit |
| ops_admin | view | view | view | view | dashboard | approve | view |
| billing_operator | edit | view | — | — | own only | request | — |
| tint_manager | view | edit | — | — | own only | request | — |
| tint_operator | — | edit (own) | — | — | own only | — | — |
| picker | — | — | edit (own) | — | own only | — | — |

Refine collaboratively during the session.

**Q4 — Multi-role users**

The schema already supports multi-role (memory: "Multi-role users").
Real depot probably has someone who's both billing_operator AND
tint_manager. Confirm the design allows OR-of-roles permissions.

**Q5 — What does NOT change today**

This session designs but does NOT build:
- No SQL migrations
- No new auth.config changes
- No new lib/permissions.ts changes
- The doc is the deliverable

Implementation prompts come later, AFTER attendance Phase 3 is stable
and we have real depot usage data.

Output format:
- A markdown file: docs/role-architecture.md
- Sections: Role definitions, permissions matrix, master data workflow,
  multi-role handling, implementation deferral note
- Save it to the docs folder during the session, commit later

═══════════════════════════════════════════════════════════════════════
DELIVERABLE 3 — PHASE 1 ROLLOUT FOR DHRUV & KULDEEP
═══════════════════════════════════════════════════════════════════════

Goal: detailed plan to onboard Dhruv & Kuldeep as the first non-Smart-Flow
users of the attendance feature. They use existing admin role
temporarily (no new code needed). 3-5 days of usage, then Phase 2.

Constraints:
- Both work AT THE DEPOT (same wifi, same physical location).
  This means geofence will work normally for them. No exemption needed.
- Their existing OrbitOMS accounts: confirm if they exist in DB or need
  creation. If not, plan the SQL to create accounts via Supabase SQL
  Editor (admin role + active=true).
- Initial limited access in PRACTICE: they only use attendance + dashboard.
  Admin role gives them more, but we ask them not to use other modules.
  Phase 2 future work: actually restrict access via ops_admin role.

Plan elements to cover:

**Step 1 — Account creation**

If Dhruv and Kuldeep don't have accounts, write the SQL to create them
via Supabase SQL Editor. Use the same hash pattern as existing users
(NextAuth bcrypt). Provide them their initial credentials securely
(Slack DM, not email).

**Step 2 — Activate gate for them**

```sql
-- Activate rollout for test users only
UPDATE attendance_settings SET "rolloutStage" = 'TEST_USERS_ONLY'
WHERE scope = 'GLOBAL';

-- Flag Dhruv and Kuldeep as test users
UPDATE users SET "attendanceTestUser" = TRUE
WHERE email IN ('dhruv@...', 'kuldeep@...');

-- Admin stays NON test user (admin@orbitoms.com is dormant for now)
-- This means ONLY Dhruv and Kuldeep are gated; admin can navigate freely
```

**Step 3 — Real depot geofence coords**

Currently placeholder Surat city center. Before Phase 1 starts:
- Measure actual depot coords (Google Maps "What's here?" or phone GPS
  while standing at depot)
- Update via SQL:
  ```sql
  UPDATE attendance_settings
  SET "geofenceCenterLatitude" = <depot lat>,
      "geofenceCenterLongitude" = <depot lng>,
      "geofenceRadiusMeters" = 150
  WHERE scope = 'GLOBAL';
  ```
- 150m radius is a sensible default (covers typical depot building +
  parking). Adjust if depot is unusually large.

**Step 4 — Onboarding comms**

Draft a short message for Dhruv & Kuldeep:
- Login URL
- Their credentials
- Brief explanation: "When you open OrbitOMS, you'll be asked to consent
  to photo + location capture, then check in. Required before you can
  see anything else. Use your phone."
- Where to give feedback: dedicated WhatsApp / Slack thread

**Step 5 — Success criteria for Phase 1**

What does "Phase 1 succeeded" look like before moving to Phase 2 (billing)?

Recommend:
- Both Dhruv and Kuldeep have checked in 3+ days successfully
- No more than 1 reported issue per user (UX confusion is OK to fix
  during Phase 1; show-stoppers means stop)
- Admin dashboard shows their data correctly
- Cron has run at least 2 nights without errors
- Photo storage is filling correctly (visible in Supabase dashboard)
- They've successfully done at least 1 errand return (multi-session day)
- They've used the History calendar at least once

If ANY of these fail, fix before Phase 2. If all pass, schedule Phase 2.

**Step 6 — Phase 2 trigger and rollback procedure**

When Phase 1 succeeds: roll out to Bankim and Deepanshu (billing).

```sql
-- Add billing operators as test users
UPDATE users SET "attendanceTestUser" = TRUE
WHERE email IN ('bankim@...', 'deepanshu@...');
```

This keeps Phase 1 users (Dhruv, Kuldeep) testing, AND adds 2 billing
operators. If billing has issues that didn't surface with sub-admins
(different workflow), we catch it before going to ALL_USERS.

Rollback procedure if anything breaks badly:
```sql
UPDATE attendance_settings SET "rolloutStage" = 'OFF';
```
This instantly disables the gate for everyone. Users can resume normal
work without check-in. No data loss.

**Step 7 — Phase 3 (full rollout) trigger**

After 1 week of stable Phase 2:
```sql
UPDATE attendance_settings SET "rolloutStage" = 'ALL_USERS';
-- attendanceTestUser flags become irrelevant; everyone gated
-- except attendanceExempt=TRUE users (none today)
```

═══════════════════════════════════════════════════════════════════════
SESSION OUTPUT FORMAT
═══════════════════════════════════════════════════════════════════════

End of session, produce a single markdown document with three sections:

1. **Bankim's daily routine** + UX questions surfaced
2. **Role architecture** (saved separately as docs/role-architecture.md)
3. **Phase 1 rollout playbook** with SQL snippets, comms draft, success
   criteria

Save to: docs/prompts/drafts/web-update-{YYYY-MM-DD}-attendance-rollout-mdf.md

This is the Master Deployment File (MDF) we'll execute against.

═══════════════════════════════════════════════════════════════════════
DISCUSSION STYLE FOR THE SESSION
═══════════════════════════════════════════════════════════════════════

- Decisions only, not exploration. If a question isn't answered today,
  flag as "DEFERRED" rather than circling.
- One thing at a time. Walk through Bankim's day fully, THEN role
  design, THEN rollout plan. Don't bounce between deliverables.
- Push back if a decision feels premature. Better to defer than
  prematurely lock the wrong choice.
- No code. If the urge to "just write the SQL" appears, capture it as
  a follow-up prompt for a future Claude Code session.
- Keep the user moving. Smart Flow communicates in shorthand;
  interpret intent, don't ask for clarifications when the pattern is
  obvious from prior sessions.

═══════════════════════════════════════════════════════════════════════
PRE-SESSION CHECKLIST FOR USER
═══════════════════════════════════════════════════════════════════════

Before starting this session, confirm:
- [ ] docs/prompts/drafts/code-update-2026-05-08-attendance-feature-shipped.md
      is committed to git (so Claude can read it for context)
- [ ] Real depot GPS coordinates have been measured and noted down
      (lat, lng — for the SQL update during the session)
- [ ] Dhruv and Kuldeep's contact info / preferred onboarding channel
      (Slack handles, WhatsApp numbers, or whatever)
- [ ] Quick check that production is still healthy:
      visit orbitoms.in/admin/attendance, sidebar still works,
      stats show 0 In + 21 Absent (or whatever per current IST time)

═══════════════════════════════════════════════════════════════════════
SESSION KICKOFF MESSAGE
═══════════════════════════════════════════════════════════════════════

Open a new chat in claude.ai (this same project).

Paste this kickoff message:

──────────────────────────────────────────────────────────────────────
Plan attendance feature rollout. Three deliverables today, no code:

1. Walk through Bankim's daily routine — surface UX issues
2. Design role architecture (super_admin / ops_admin / others) — document only
3. Phase 1 rollout playbook for Dhruv & Kuldeep — SQL, comms, success criteria

Reference: docs/prompts/drafts/code-update-2026-05-08-attendance-feature-shipped.md
contains the full feature build summary.

Constraints:
- Roles design is documentation only, no code
- Dhruv & Kuldeep use existing admin role temporarily for Phase 1
- Real depot geofence coords ready: lat=<X>, lng=<Y>
- Output: docs/prompts/drafts/web-update-{today}-attendance-rollout-mdf.md
──────────────────────────────────────────────────────────────────────
