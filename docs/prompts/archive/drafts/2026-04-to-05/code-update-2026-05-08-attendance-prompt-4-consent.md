# Prompt 4 — Attendance: Consent Screen + API
**Use Opus.** This is the first user-visible page. Multi-file: page route,
client component, server action / API, and a small middleware refinement.

═══════════════════════════════════════════════════════════════════════
GOAL
═══════════════════════════════════════════════════════════════════════

Build the first-time consent flow for the attendance feature.

When a gated user lands on /attendance and has never consented (or
their consent version is stale relative to attendance_settings.dpdpConsentVersion),
they see a full-screen consent page. They check a box, tap "Accept &
Continue", and:
  1. POST /api/attendance/consent records the consent in DB
  2. JWT is refreshed via session.update() so the new consent version
     is in the token
  3. They are redirected to /attendance (the home screen — Prompt 5,
     not yet built; for v1 just redirect, the 404 is OK temporarily)

Non-gated users who land on /attendance directly should see a generic
attendance landing (placeholder for now — Prompt 5 builds the real one).

═══════════════════════════════════════════════════════════════════════
DIAGNOSIS PHASE — DO NOT WRITE CODE
═══════════════════════════════════════════════════════════════════════

Read fully and silently:
- CLAUDE.md
- docs/CLAUDE_CORE.md (especially §3 rules, §4 infra, §13 sidebar)
- docs/CLAUDE_UI.md (mobile-first patterns; teal brand; touch targets)
- middleware.ts (current state with attendance gate)
- auth.config.ts (session/JWT shapes including attendanceConsentVersion)
- lib/auth.ts (jwt callback — needs to handle session.update() trigger)
- prisma/schema.prisma (confirm attendance_settings.dpdpConsentVersion
  and users.attendanceConsentAt + attendanceConsentVersion fields)
- A reference page that uses NextAuth session client-side to understand
  the existing pattern (e.g. one of the role layouts that calls
  `await auth()`)
- A reference API route that demonstrates the standard pattern, including
  `export const dynamic = 'force-dynamic'`

Look at the prototype mockup in chat history (consent screen — screen 1
of the 8-screen prototype). The visual reference for layout + copy is
the prototype.

After reading, do NOT write code. Reply with:

──────────────────────────────────────────────────────────────────────
"Files read. Diagnosis follows."

Then provide:

1. ROUTE STRUCTURE PROPOSAL
   - Where does /attendance live in app dir?
     Suggested: app/attendance/ (no route group — keep separate from
     role groups since attendance is cross-role)
   - File tree to create:
     app/attendance/
       layout.tsx        — minimal wrapper, no sidebar (full-screen feel)
       page.tsx          — server component, decides: consent or home?
       consent/
         page.tsx        — server component, redirects if already consented
         consent-form.tsx — client component (form, checkbox, submit)
   - API route:
     app/api/attendance/consent/route.ts (POST handler)

   Confirm or propose alternative structure.

2. PAGE-LEVEL DECISION LOGIC (server component)
   - app/attendance/page.tsx logic:
     - auth() to get session
     - If no session → redirect to /login
     - If user.attendanceConsentVersion < attendance_settings.dpdpConsentVersion
       → redirect to /attendance/consent
     - Else → render placeholder home (or redirect to home once Prompt 5 is built)
   - Where do we read attendance_settings.dpdpConsentVersion?
     - Option A: read from session/JWT (requires adding it to JWT claims —
       another roundtrip change)
     - Option B: server-side prisma query in this server component
       (simpler, just one row read)
   - Recommend Option B for now: dpdpConsentVersion changes rarely,
     and reading it server-side avoids polluting the JWT further.
   - Confirm.

3. CONSENT FLOW DETAILS
   - Form structure:
     - Header: logo, title "Privacy & Consent"
     - 3 info cards: Photo, Location, Your rights (text from prototype)
     - Checkbox: "I have read and consent..."
     - Buttons: "Accept & Continue" (primary, disabled until checkbox)
                "Decline" (text, opens a confirm dialog → logout)
   - On Accept:
     - POST /api/attendance/consent (no body needed — current user from session)
     - On 200: call session.update() with new consent claims, then router.push('/attendance')
     - On error: show toast/alert, keep button enabled, don't redirect
   - On Decline:
     - Show confirm dialog: "Check-in is required to use OrbitOMS. Are you sure?"
     - If confirmed: signOut() → /login
     - If cancelled: dismiss dialog

4. API ROUTE DETAILS
   - POST /api/attendance/consent
   - Server action OR API route — pick one (API route preferred for
     consistency with rest of OrbitOMS pattern)
   - Logic:
     - auth() — must be authenticated
     - Read attendance_settings.dpdpConsentVersion (current global version)
     - UPDATE users SET attendanceConsentAt = NOW(),
       attendanceConsentVersion = <currentVersion>
       WHERE id = session.user.id
     - Return { ok: true, consentVersion } in JSON
   - Constraints:
     - export const dynamic = 'force-dynamic'
     - Sequential awaits, no $transaction
     - Idempotent — calling twice is fine (just updates timestamp)
   - Status codes: 200 ok, 401 unauthorized, 500 server error

5. JWT REFRESH AFTER CONSENT
   - session.update() is the NextAuth client-side function that triggers
     the jwt callback with `trigger === 'update'`
   - Need to update lib/auth.ts jwt callback to handle this trigger:
     when trigger === 'update', re-read user.attendanceConsentVersion
     from DB and refresh that claim.
   - Should we also refresh the rolloutStage flags here? Recommend NO —
     keep update() narrow (just consent claims) so we don't accidentally
     refresh other things and mask the 5-min stale window.

6. MIDDLEWARE CONSIDERATION
   - Current middleware redirects gated users with no check-in today
     to /attendance.
   - But what about gated users who haven't consented? They'll land on
     /attendance, which (post-Prompt 4) will redirect them to
     /attendance/consent. Fine — let the page handle it, not middleware.
   - DO NOT add consent logic to middleware. Keep middleware simple.
   - Confirm.

7. UI / COPY DETAILS
   - Mobile-first per UI v5.1: 56px touch targets, 16px min font size,
     high contrast (no thin grays for primary text)
   - Layout uses no sidebar, full-screen mobile feel even on desktop
     (max-width container in layout.tsx)
   - Match prototype copy exactly:
     "To check in, OrbitOMS captures a selfie and your location. Your
      data stays in India and is never shared."
     Three cards (Photo, Location, Your rights) with the prototype's
     bullet copy.
   - Use existing Button + Checkbox primitives if available; otherwise
     plain Tailwind. Don't pull new dependencies.

8. QUESTIONS FOR ME (if any)
   - Anything ambiguous in the spec
   - Anything in the codebase that conflicts

STOP. Wait for my approval before any code.

══════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════
IMPLEMENTATION PHASE — ONLY AFTER I APPROVE
═══════════════════════════════════════════════════════════════════════

Implement in this order. STOP after each group for tsc check.

GROUP A — JWT update trigger handling
  File: lib/auth.ts
  - Add handling for `trigger === 'update'` in jwt callback
  - When trigger is update, re-read attendanceConsentVersion from DB
  - Don't reset rolloutStageStaleAt (independent concern)

GROUP B — API route
  File: app/api/attendance/consent/route.ts (NEW)
  - POST handler implementing the contract above
  - export const dynamic = 'force-dynamic'

GROUP C — Layout + page shells
  Files:
    app/attendance/layout.tsx (NEW)
    app/attendance/page.tsx (NEW)
    app/attendance/consent/page.tsx (NEW)
  - Server-component decision logic in page.tsx (consent vs home)
  - Layout = minimal wrapper (no sidebar; full-screen mobile feel)
  - Consent server page — redirect if already consented

GROUP D — Consent form (client component)
  File: app/attendance/consent/consent-form.tsx (NEW)
  - Client component with the form UI from the prototype
  - Checkbox state, Accept disabled until checked
  - On submit: fetch /api/attendance/consent, then session.update(),
    then router.push('/attendance')
  - On Decline: confirm dialog → signOut

GROUP E — Visual polish + CLAUDE_UI.md compliance check
  - Verify mobile-first responsiveness
  - Verify touch targets ≥ 48px (consent button 60px per prototype)
  - One-teal rule: only the Accept button is teal; everything else neutral

═══════════════════════════════════════════════════════════════════════
VALIDATION
═══════════════════════════════════════════════════════════════════════

After each Group: `npx tsc --noEmit` must pass clean.

After Group E final tsc:
- STOP. Do not commit.
- I will smoke-test manually:
  - Flip rolloutStage=TEST_USERS_ONLY + admin attendanceTestUser=TRUE
  - Log in fresh → should redirect to /attendance → /attendance/consent
  - Click Accept without checkbox → button stays disabled
  - Check the box → button becomes teal
  - Click Accept → consent recorded → redirected to /attendance home
    (which 404s for now, that's Prompt 5)
  - Verify in DB: SELECT attendanceConsentAt, attendanceConsentVersion
    FROM users WHERE email = 'admin@orbitoms.com'

═══════════════════════════════════════════════════════════════════════
CONSTRAINTS
═══════════════════════════════════════════════════════════════════════

- All API routes: export const dynamic = 'force-dynamic'
- Sequential awaits, no $transaction
- No new external dependencies
- Edge runtime untouched (no Prisma in middleware or auth.config.ts)
- Mobile-first per CLAUDE_UI.md v5.1
- One-teal rule: only the primary CTA gets teal
- Match prototype copy exactly

═══════════════════════════════════════════════════════════════════════
WHAT NOT TO DO
═══════════════════════════════════════════════════════════════════════

- Do NOT build the /attendance home screen yet (Prompt 5)
- Do NOT build any check-in flow (Prompt 6)
- Do NOT add any sidebar (consent is full-screen)
- Do NOT add consent logic to middleware
- Do NOT commit at the end — wait for my smoke test approval

═══════════════════════════════════════════════════════════════════════
WHAT TO DO FIRST
═══════════════════════════════════════════════════════════════════════

1. Read all listed files
2. Reply "Files read. Diagnosis follows." with the 8-point diagnosis
3. Wait for approval
4. Implement Groups A → E with tsc gate after each
5. STOP after Group E. Do not commit.
