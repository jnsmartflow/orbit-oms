# Attendance admin redesign — session 2026-05-14 wrap-up

## What shipped this session

Visual redesign of `/admin/attendance` pages. Single commit on main, deployed to orbitoms.in.

- **2-strip header** replaces the old 3-strip stack
  - Strip 1: title + workflow pill switcher (Dashboard ⇆ OT Pending) + Reports dropdown + clock
  - Strip 2: page-specific filters (segment pills + date / month picker)
- **Old `admin-sub-nav.tsx` deleted.** 4-tab strip (Dashboard / OT Pending / Settings / OT Audit) gone.
- **Reports dropdown** holds OT Audit + planned reports + Today's roster CSV export. Hand-rolled (no shadcn DropdownMenu added).
- **New component:** `components/admin/attendance/attendance-page-header.tsx` — owns both strips, used by all 4 admin attendance pages instead of UniversalHeader.
- **OT Pending pills:** Today / This week / Older — client-side filters over existing data, no API change.
- **Mockup of record:** `docs/mockups/attendance/admin-redesign.html`
- **One-teal rule honoured:** only the active segment pill is teal on Dashboard + OT Pending. OT Audit + Settings carry no teal.

## What's pending — for next session

### 1. Settings page — promotion to global config

Right now Settings is reachable **by direct URL only** (`/admin/attendance/settings`). It's been removed from header navigation entirely. The page still exists and functions, but no link points at it.

This is a deliberate hold. The plan is to promote Settings out of the attendance module into a global `/admin/settings` page that hosts config for all modules (attendance, mail orders, tint, place order). Next session needs to decide:

- New route: `/admin/settings` with module sidebar (Attendance / Mail Orders / Tint / etc.)
- How users reach it from anywhere in the app (top-level nav item? gear icon in main app header?)
- Migration: redirect old `/admin/attendance/settings` → new `/admin/settings?module=attendance`
- Whether other modules' settings get created at the same time or just attendance moves over and the sidebar shows "soon" for the rest

### 2. Small polish items deferred from 2026-05-14

These were noticed during production verification and consciously deferred — pick up in the same session as Settings work, or earlier if a quick polish pass happens.

- **Reports dropdown position:** on smaller desktop widths the dropdown panel can clip past the right edge of the viewport. Anchor it left of the trigger so it stays inside. (`components/admin/attendance/attendance-page-header.tsx` — dropdown menu positioning.)
- **OT Pending empty state icon is teal:** the green checkmark in the "Nothing pending today" empty state is a second teal element on the OT Pending page. One-teal rule says only the active pill should be teal — change empty-state icon to gray. (`components/admin/attendance/ot-pending-table.tsx` empty state.)

### 3. Future Reports menu entries (when those reports get built)

Currently disabled placeholders in the Reports dropdown:
- Late report
- Monthly summary
- Date range export

Each becomes a real entry when its page is built. No header changes needed — just remove the `disabled` flag and wire the link.

## Files touched this session (for reference)

NEW:
- `components/admin/attendance/attendance-page-header.tsx`
- `components/admin/attendance/reports-dropdown.tsx`
- `docs/mockups/attendance/admin-redesign.html`

MODIFIED:
- `app/(ops)/admin/attendance/page.tsx`
- `app/(ops)/admin/attendance/ot-pending/page.tsx`
- `app/(ops)/admin/attendance/ot-audit/page.tsx`
- `app/(ops)/admin/attendance/settings/page.tsx`
- `components/admin/attendance/attendance-dashboard.tsx`
- `components/admin/attendance/ot-pending-table.tsx`
- `components/admin/attendance/ot-audit-view.tsx`
- `components/admin/attendance/settings-form.tsx`
- `components/admin/attendance/month-picker.tsx`

DELETED:
- `components/admin/attendance/admin-sub-nav.tsx`

## Mental model recap (for the next session)

- **Workflow tabs** (Dashboard, OT Pending) = daily, always visible.
- **Reports dropdown** = attendance-specific reports + exports. Grows over time without bloating the header.
- **Settings** = currently orphaned in attendance namespace. Next session: lift into app-wide `/admin/settings`.

---

*Draft — created 2026-05-14. To be consolidated into CLAUDE_ATTENDANCE.md and CLAUDE_UI.md in the next biweekly consolidation pass.*
