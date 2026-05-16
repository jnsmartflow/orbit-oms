# MDF — Attendance Feature Pilot Rollout
**Save to:** `docs/prompts/drafts/mdf-attendance-rollout-2026-05-09.md`

Session date: 2026-05-09
Status: Planning complete, pre-pilot work pending
Predecessor: `code-update-2026-05-08-attendance-feature-shipped.md` (P4-P11 ship draft)

---

## 1. Purpose & scope

This MDF (Master Deployment File) captures all decisions, sequencing, comms, and rollback rules for moving the attendance feature from its current dormant state (`rolloutStage='OFF'`) to a pilot stage (`TEST_USERS_ONLY`) and eventually to full rollout (`ALL_USERS`).

**What this doc IS:**
- Locked decisions and the rationale behind them
- Sequenced prompt list to execute via Claude Code before pilot
- Comms templates (standup script + WhatsApp message)
- Rollback playbook with concrete thresholds
- Stage 2 readiness checklist
- Phase 2 build trigger rules

**What this doc is NOT:**
- Not a Claude Code prompt itself — see §11 for the prompt sequence
- Not the Phase 2 admin-writes spec — that comes after pilot completes
- Not part of canonical context (`docs/CLAUDE_*.md`) — operational planning only

---

## 2. Current state (as of 2026-05-09)

- Feature shipped to production via commit `ed3a482a` on 2026-05-08
- `attendance_settings.rolloutStage = 'OFF'` (dormant, no users gated)
- All env vars set in Vercel (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET)
- Cron jobs configured: rollover 18:35 UTC, purge 20:30 UTC
- Geofence center: placeholder Surat city center (21.1702, 72.8311), radius 150m
- Schema: v27.1
- UI: v5.1
- No pilot users have `attendanceTestUser=true` yet

---

## 3. Locked decisions

### 3.1 Pilot roster

| User | Role | attendanceTestUser | New account? |
|---|---|---|---|
| Dhruv | `ops_admin` | TRUE | YES |
| Kuldeep | `ops_admin` | TRUE | YES |
| admin@orbitoms.com | `admin` | TRUE | NO (existing) |

**Not in pilot:** Chandresh, Deepanshu, Bankim, all other current users.

**Pilot duration:** 1 week from rollout day. Then evaluate against rollback triggers; if clean, flip to `ALL_USERS`.

### 3.2 New role: `ops_admin`

Purpose: dedicated attendance supervision role with no other system access.

**Permissions:**
- PC: whitelist access to `/admin/attendance/*` and `/attendance/*` only. All other routes redirect to `/admin/attendance`.
- Sidebar: filtered — only "Attendance" entry visible.
- Phone: same as every user — only `/attendance` accessible.
- Attendance gate: APPLIES (ops_admin users check in like normal users).
- Dashboard powers: full Phase 1 (roster, detail panel, photo viewing, CSV export). Phase 2 writes (manual entry, edit, mark exception) when built.

### 3.3 Geofence

- **Coords for pilot:** placeholder kept as-is (21.1702, 72.8311 — Surat city center)
- **Radius for pilot:** changed to **50m strict**
- Geofence violations are warn-only; check-in proceeds regardless. Pilot will produce `isOutsideGeofence=true` flags on every record (expected — placeholder is wrong location).
- **Action item before Stage 2:** measure real depot coords + decide if 50m is right radius after seeing real data.

### 3.4 Mobile restriction (applies to ALL users, all roles)

- Phone (viewport < 768px): only `/attendance` and `/order` accessible
- Any other authenticated route on phone → block message: **"Use PC for this page"** + button back to `/attendance`
- Implementation: component-level guard using viewport check, SSR-safe
- Public paths (`/login`, `/unauthorized`, `/not-ready`, `/demo`) remain unrestricted

### 3.5 PC no-camera fallback

- `/attendance` page detects missing camera (`navigator.mediaDevices.getUserMedia` failure or no camera enumeration)
- Shows help card: "Use phone for check-in" instead of broken Check In button
- Prevents PC users from getting stuck at the gate when no webcam available

### 3.6 Comms

- **Approach:** in-person standup walkthrough + WhatsApp follow-up
- **Day to flip:** TBD by Smart Flow based on next week's schedule
- **Language:** Hinglish/Gujlish, depot operator style
- **Pilot feedback channel:** direct WhatsApp to Smart Flow (no group, no template required)

### 3.7 Forgot-phone fallback

- User checks in using someone else's phone
- Photo (selfie) is the source of truth — device fingerprint mismatch is acceptable
- No admin override or manual exception needed for pilot

### 3.8 Admin mobile dashboard

- Deferred. Admin uses PC for the attendance dashboard.
- Admin on phone hits the same mobile route guard as everyone else (only `/attendance` and `/order`).

---

## 4. Pre-flight checklist (before flipping rolloutStage)

All must be TRUE before SQL pilot activation:

- [ ] **Pre-pilot prompts 1-5 deployed and verified on production**
- [ ] Schema includes `ops_admin` role
- [ ] Dhruv + Kuldeep accounts created with passwords
- [ ] Both can log in to orbitoms.in successfully
- [ ] On PC, both ops_admin users see only `/admin/attendance` (other admin pages redirect)
- [ ] On phone, all users see only `/attendance` + `/order` (others show block message)
- [ ] PC `/attendance` shows no-camera help card on a webcam-less PC
- [ ] Camera + GPS work on Smart Flow's phone for end-to-end test (with `attendanceTestUser=true` set on admin)
- [ ] Vercel logs show clean deploy of all 5 commits
- [ ] CRON_SECRET still set in Vercel env (sanity check)
- [ ] Smart Flow has briefed Dhruv + Kuldeep at standup with phone walkthrough
- [ ] WhatsApp message sent with screenshot
- [ ] Smart Flow's phone is reachable for pilot WhatsApp throughout pilot week

---

## 5. Pre-pilot prompt sequence

**6 Claude Code prompts** to be executed in order. Each must be drafted from a fresh planning session using the code-prefix template — this MDF is the input, not the prompt itself.

| # | Prompt | Type | Order |
|---|---|---|---|
| 1 | **Role schema diagnosis** | Read-only | First |
| 2 | **Add ops_admin role + create Dhruv + Kuldeep accounts** | Schema + data | After 1 |
| 3 | **Middleware whitelist + filtered sidebar for ops_admin** | Code | After 2 |
| 4 | **PC no-camera help card on /attendance** | Code | Independent (after 3) |
| 5 | **Mobile route guard (component-level)** | Code | Independent (after 3) |
| 6 | **Pilot activation SQL** | Data | Last |

**Sequencing rules:**
- 1 must complete before 2 (need to know role storage shape)
- 2 must complete before 3 (need accounts to exist before testing role logic)
- 3, 4, 5 can ship in any order after 2 — but all three must be live before 6
- 6 only runs after Smart Flow confirms 1-5 are live and standup walkthrough is done

**One prompt per session.** Diagnosis (1) is a separate session from implementation (2). Smart Flow approves each prompt before it's pasted into Claude Code.

---

## 6. Standup walkthrough script

5-minute script for the morning standup the day rollout flips. Smart Flow runs through with Dhruv + Kuldeep on a borrowed phone.

1. **Frame it:** "Aaj se OrbitOMS me check-in/check-out chalu kar rahe hain. Aap dono pilot user ho. Ek hafte try karenge, phir baki sab pe lagayenge."
2. **Show consent screen:** "Pehli baar login karte hi ye screen aayega. Photo aur location store hota hai — DPDP rule. Accept karna hai."
3. **Show check-in flow:** demo on the phone — selfie, "ye dikhega yahan", confirm, submit, success.
4. **Show home screen post check-in:** "Day bhar yahin se check out kar sakte ho."
5. **Drill the rule:** "Phone se check-in karo. Phir PC pe kaam shuru karo. **Phone se pehle PC mat kholo** — warna stuck ho jaoge."
6. **Camera permission:** "Pehli baar 'Allow camera' aayega — Allow karo. Location bhi Allow."
7. **Forgot phone?** "Kisi aur ka phone use kar lo, login karke check-in. Mera selfie hai source of truth."
8. **Problem hua to?** "Mujhe seedha WhatsApp karo. Group nahi banaya."
9. **End of day:** "Jaane se pehle check-out — Day Summary screen aayega total hours ke saath."
10. **Confirm understanding:** ask each pilot user to do one practice check-in on their own phone before standup ends.

---

## 7. WhatsApp message draft (Hinglish)

To be sent right after standup, with a screenshot of the consent screen attached.

---

> *Aaj se OrbitOMS me attendance feature start. Tum dono + main pilot user.*
>
> *Subah:* Phone se orbitoms.in pe login → Accept consent → selfie + location allow → Check In.
>
> *Phir PC pe normal kaam.* (Phone se check-in pehle, PC se kaam baad me — ulta nahi.)
>
> *Shaam ko:* Phone se Check Out before leaving. Day Summary dikhega.
>
> *Phone bhool gaye?* Kisi aur ka phone le ke login karke check-in kar lo.
>
> *Camera nahi hai PC pe* — phone se hi check-in. PC pe attendance screen khologe to "Use phone" message aayega.
>
> *Kuch bhi gadbad?* Mujhe seedha WhatsApp karo.
>
> *Pilot 1 hafte ka. Feedback do, agle hafte sab pe lagayenge.*

---

**Tone check before sending:** verify with one pilot user that the language feels natural for the depot context.

---

## 8. Rollback playbook

### 8.1 Hard rollback triggers (immediate revert to OFF)

Any one of these fires → revert without debate:

1. **Photo upload failing for >50% of submissions** (broken Storage / network)
2. **Any user completely blocked from work for >30 minutes** (gate trap with no resolution path)
3. **Camera/GPS API errors on >1 user** (browser permission catastrophic failure)
4. **Database errors (HTTP 500s) in `/api/attendance/check-in` or `/check-out` endpoints** in Vercel logs

### 8.2 Soft rollback triggers (review at end of day)

Any one of these → discussion at EOD, Smart Flow decides:

- 2+ users hit the same UX friction point (workflow doesn't fit)
- Pilot user formally asks to be removed
- Geofence flag firing inconsistently (GPS reliability questions)
- Check-out forgotten by 2+ users on the same day
- Any anomaly in admin dashboard data (counts mismatch, photos not loading, etc.)

### 8.3 Rollback procedure

1. SQL: `UPDATE attendance_settings SET rolloutStage = 'OFF';`
2. Tell pilot users via WhatsApp: "Pause kar diya, wapas chalu karenge."
3. Force pilot users to log out + log back in if urgent (JWT 5-min stale window otherwise).
4. **Do NOT** unset `attendanceTestUser` flags — keep them set for re-enablement.
5. **Do NOT** delete attendance_records — preserve for analysis.
6. Diagnose root cause via Vercel logs + DB inspection + WhatsApp pilot feedback.
7. Fix → deploy → re-flip stage to TEST_USERS_ONLY when verified.

### 8.4 Authority

Smart Flow has **unilateral rollback authority**. No approval needed.

---

## 9. Stage 2 readiness checklist (before flipping to ALL_USERS)

After 1-week pilot completes cleanly, all must be TRUE before flipping to full rollout:

- [ ] No hard rollback fired during pilot
- [ ] No more than 2 soft rollback flags during pilot, all resolved
- [ ] Real depot GPS coords measured and updated in `attendance_settings`
- [ ] Geofence radius re-evaluated based on pilot data (50m may be wrong)
- [ ] Both pilot ops_admin users report the dashboard works as expected
- [ ] Cron jobs verified working (rollover created ABSENT rows correctly, purge logic understood)
- [ ] WhatsApp comms drafted for the wider depot user base (~all current users)
- [ ] Decision made on admin@orbitoms.com — keep `attendanceTestUser=true` (gate stays on) or unset (gate off for admin)
- [ ] Plan for new users joining mid-rollout (default `attendanceExempt=false`, gated immediately)

---

## 10. Phase 2 build trigger

Phase 2 = admin/ops_admin manual entry, edit record, mark exception (manual writes to attendance data).

**Trigger rule: 2 of 3 conditions fire → build Phase 2.**

1. **5+ records that need manual fix** (ABSENT/INCOMPLETE that should have been PRESENT, or wrong times) accumulated since rollout
2. **Explicit user request** — any operator says "main aaya tha 9 baje, system ne 11 baje show kiya, fix karo"
3. **Payroll/export blocker** — clean data is required for downstream use, dirty records can't be fixed without admin write

When 2 of 3 fire: open a fresh planning session, read this MDF, draft Phase 2 spec.

---

## 11. Open risks accepted for pilot (no pre-pilot fix)

These were flagged but explicitly deferred. Will be evaluated against real pilot data.

| # | Risk | Why deferred |
|---|---|---|
| a | Cron rollover behavior at `rolloutStage='OFF'` — does it create ABSENT rows for users tonight even though feature is dormant? | Skip diagnosis, observe in pilot |
| b | First check-in mid-task workflow — if user is on `/mail-orders` and gets redirected to `/attendance`, does anything break? | Low risk; verify in pilot |
| c | JWT freshness after check-in — does next page load redirect back to `/attendance` due to stale claim? | Will surface immediately if broken |
| d | Photo upload network failure mid-submit — depot wifi flaky | Will surface during pilot, fix in Phase 2 if it's a pattern |
| e | Multi-tab open with stale JWT after check-in | Same as c |
| f | Browser back button after check-in success | UX papercut, not blocker |

---

## 12. Decision log

| Decision | Locked at | Final value |
|---|---|---|
| Pilot users | Step 1 | Dhruv + Kuldeep (ops_admin) + admin |
| Pilot duration | Step 1 | 1 week |
| Admin gating during pilot | Step 1 | `attendanceTestUser=true`, decide at Stage 2 |
| Geofence coords | Step 2 | Placeholder until Stage 2 |
| Geofence radius | Step 2 | 50m strict |
| Comms approach | Step 3 | Standup + WhatsApp |
| Rollout day | Step 3 | TBD by Smart Flow |
| Comms language | Step 3 | Hinglish |
| Feedback channel | Step 4 | Direct WhatsApp to Smart Flow |
| Hard rollback triggers | Step 5 | 4 thresholds (photo>50%, block>30min, camera/GPS>1 user, 500s) |
| Soft rollback triggers | Step 5 | EOD review, Smart Flow decides |
| Phase 2 build trigger | Step 5 | 2 of 3 conditions |
| Forgot-phone fallback | Step 4 | Use someone else's phone |
| Admin mobile dashboard | Step 4 | Deferred |
| PC no-camera help card | Step 4 | Build before pilot |
| Mobile route guard scope | Step 6 | All users, only `/attendance` + `/order` accessible |
| Mobile guard: blocked route behavior | Step 6 | "Use PC for this page" message + back button |
| Mobile guard: implementation | Step 6 | Component-level, viewport-based |
| Pilot composition | Step 7 | Reframed: Dhruv + Kuldeep (new ops_admin) replace Deepanshu/Bankim |
| New role name | Step 7 | `ops_admin` |
| ops_admin permissions on PC | Step 7 | Whitelist `/admin/attendance` only |
| ops_admin sidebar | Step 7 | Filtered, only Attendance entry |
| ops_admin attendance gate | Step 7 | Applies (they check in too) |
| ops_admin dashboard powers | Step 7 | Full Phase 1 + Phase 2 writes when built |
| Day-in-the-life sections | Step 8 | Dropped — keep MDF lean |

---

## 13. Next session

After this MDF is saved, Smart Flow opens a fresh planning session to draft **Prompt 1 (role schema diagnosis)** using the code-prefix template. Inputs: this MDF + `schema.prisma` + `middleware.ts` + relevant auth files.

Diagnosis prompt only — no code changes. Output: a single confirmation of how role is stored (Postgres enum, text column, or JSON field) and what mechanism is needed to add `ops_admin`.

After diagnosis output is reviewed, draft Prompt 2 in the next planning session.

---

*MDF · 2026-05-09 · Attendance pilot rollout*
