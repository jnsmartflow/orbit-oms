# Prompt — Diagnose & Fix Attendance Photo Forbidden Display

**Save to:** `docs/prompts/drafts/code-update-2026-05-10-prompt-attendance-photo-forbidden.md`
**Type:** Diagnosis first, then code fix · No schema changes expected
**Predecessor:** Prompt 3 hotfix shipped (`code-update-2026-05-09-prompt3-ops-admin-layout-fix.md`)
**Related:** MDF rollout doc (`mdf-attendance-rollout-2026-05-09.md`)

---

## What this prompt does

Diagnoses why selfie photos uploaded during attendance check-in render as "Forbidden" (HTTP 403) in the supervisor dashboard, then implements the fix.

**Confirmed state from 2026-05-09 phone test (Dhruv, 1:09 AM check-in):**
- Photo upload to Supabase Storage SUCCEEDED (verified — file is in bucket)
- Bucket is set to PRIVATE (correct for DPDP compliance — selfies should not be publicly readable)
- Dashboard display fails with "Forbidden" placeholder
- Cause hypothesis: dashboard constructs public URL or uses an unsigned/expired URL; private bucket rejects with 403

This is NOT a regression from Prompt 3. Photo display has been broken since the attendance feature shipped (`code-update-2026-05-08-attendance-feature-shipped.md`). The bug only surfaced tonight because Dhruv was the first non-admin user to check in and admin had probably never been viewed in the dashboard side panel before.

---

## Goal

Photos render correctly in:
1. The admin/ops_admin attendance dashboard side panel (the panel showing "Dhruv | Ops Admin | Incomplete" with the photo)
2. Anywhere else photo URLs are rendered (e.g. user's own check-in confirmation, history view)

**Without** making the bucket public. DPDP compliance and the user privacy promise on the consent screen ("Visible to you and admin only") require selfies to stay private.

---

## Constraints

- Engineering rules from `CLAUDE_CORE.md §3` (no `prisma.$transaction`, sequential awaits, no `prisma db push`).
- Bucket MUST stay private. Don't "fix" by making it public.
- All API routes: `export const dynamic = 'force-dynamic'`.
- `tsc --noEmit` must pass.
- Don't modify Supabase Storage buckets or RLS policies without flagging it explicitly first — those changes have wider implications than this prompt's scope.
- No new npm dependencies.
- PowerShell on Windows: use `;` not `&&` for chained commands.

---

## Step 1 — Diagnosis (READ-ONLY)

Before any code change, produce a report answering ALL of these:

### A. Storage bucket setup
1. Which Supabase Storage bucket holds attendance selfies? (Search code for `.from(` + `storage` patterns.)
2. Is the bucket actually private? (Confirm by reading the upload code — does it use `getPublicUrl` or `createSignedUrl` after upload?)
3. What URL form is currently stored in `attendance_records.checkInPhotoUrl` (or whatever the column is)? Public-style URL? Signed URL with token? Path only? Quote 1-2 sample values from the DB.
4. If signed URLs are stored, what's the expiry duration?

### B. Display code path
5. Where in the codebase is the dashboard photo rendered? File path + component name + line.
6. How does it get the URL — read straight from DB, build a public URL on the fly, or call a server function to generate a signed URL?
7. Is there an `<img>` tag, Next.js `<Image>`, or a custom component? Quote the relevant JSX.
8. Is there any existing helper for generating signed URLs (e.g. `getSignedPhotoUrl`, `createPhotoSignedUrl`)? List file + function name.

### C. Upload code path (for context)
9. Where is the upload performed? Server action, API route, client direct?
10. What URL form is the upload code returning/storing? (`getPublicUrl` vs `createSignedUrl` vs raw path)
11. If the bucket is private and upload uses `getPublicUrl`, the URL was always going to 403 — confirm whether this is the bug.

### D. RLS policies
12. Run a SELECT against `storage.objects` in Supabase to inspect what policies exist on the attendance bucket. (Just read the policies, don't modify.)
13. Are there any RLS policies that allow authenticated reads? Or is everything blocked except service role?

### E. Repro confirmation
14. From the diagnosis, write the exact step-by-step request flow that produces the 403, e.g.:
    - User visits `/admin/attendance`
    - Side panel renders for Dhruv
    - `<img src="https://xyz.supabase.co/storage/v1/object/public/attendance-photos/dhruv/2026-05-10-0109.jpg">`
    - Supabase responds 403 because bucket is private and URL is "public" form
    - Browser renders broken image placeholder

### F. Recommended fix approach
After A–E, propose 1-2 fix options. Examples (illustrative, not prescriptive):

- **Option X — signed URLs at render time.** Server component generates a signed URL (e.g. 1-hour expiry) on each page load, passes to client. Stays private. Requires server-side helper.
- **Option Y — proxy through API route.** `/api/attendance/photo/[recordId]` checks auth, generates signed URL or streams the file. Stays private. Cleaner abstraction.
- **Option Z — store signed URL with longer expiry at upload time.** DB stores a 90-day signed URL. Simpler but URLs leak in DB dumps.

For each option, note: complexity, security profile, performance implications.

---

## STOP HERE — Smart Flow review

After Step 1 diagnosis, STOP. Output the report. Do NOT write any fix code yet. Smart Flow reviews the report, picks an approach, and a follow-up prompt drafts the implementation.

This split is intentional — diagnosis-then-implementation matches the standing rule from earlier work.

---

## Files to read for the diagnosis (confirm at top: "Files read: ...")

1. `prisma/schema.prisma` — `attendance_records` model (or whatever the table is called), specifically the photo URL column
2. Search `app/api/attendance/check-in/` for the upload endpoint
3. Search `app/api/attendance/check-out/` for the upload endpoint (if separate)
4. `app/(ops)/admin/attendance/page.tsx` — the dashboard rendering the failing side panel
5. Any client component imported by the dashboard that contains photo `<img>` (search for `checkInPhoto` or `photoUrl` literals)
6. `lib/supabase/*` — server/client setup, any storage helpers
7. `app/attendance/check-in/*` — user-facing flow for context on how upload happens
8. CLAUDE_CORE.md §5, §6 — for current attendance schema reference

---

## Stop conditions

Stop and ask Smart Flow if:
- Bucket is configured in a way that doesn't match the upload code (e.g. code expects public, bucket is private — that's THE bug, just confirm it)
- The fix would require modifying RLS policies on Supabase (this needs a separate decision — security-relevant)
- Photo URLs in DB look corrupted or inconsistent (some signed, some public, some empty)
- Multiple buckets exist and code isn't consistent about which one to use
- The fix would touch the upload pipeline (out of scope here — this prompt is display-side)

---

## Out of scope

- Modifying Supabase Storage RLS policies (separate prompt)
- Refactoring the upload flow (separate prompt)
- Adding photo deletion / 90-day purge logic (already a cron job per MDF §2)
- Photo display anywhere besides the dashboard side panel (handle if discovered, but main scope is the dashboard)
- Phase 2 admin powers (manual entry, edit) — separate spec

---

## Acceptance criteria (after fix prompt completes — NOT this diagnosis prompt)

- Dashboard photo renders successfully for Dhruv's 2026-05-10 01:09 AM check-in
- Bucket remains private
- Auth check enforced — only admin / ops_admin can view photos (not other users)
- No regression in upload flow
- `tsc --noEmit` clean
- No console 403 errors when viewing dashboard

---

## What this prompt does NOT do

- Does NOT write the fix code. Diagnosis only.
- Does NOT modify Supabase config.
- Does NOT change DB schema.
- Does NOT touch the upload path.

A second prompt in the same session (after Smart Flow picks the fix approach) handles the implementation.

---

*Diagnosis prompt · Attendance photo Forbidden · 2026-05-10*
