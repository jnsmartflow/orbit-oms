# Code update — 2026-09-30 — the access notebook (shipped, switched OFF)

**Commit:** the single commit on `main` titled *"auth: access notebook behind ACCESS_CACHE (default off) — per-lambda bundle + ACCESS_VERSION lever; zero per-request auth/permission reads when on"* (a commit cannot carry its own hash — `git log --grep "access notebook behind ACCESS_CACHE"`).
**Spec:** `docs/prompts/drafts/code-plan-2026-09-29-auth-access-notebook.md` (all 11 decisions approved as recommended) · superseded: `code-plan-2026-09-29-auth-request-cost.md` · diagnosis: `code-discovery-2026-09-29-disk-io.md §C`.
**Schema:** v27.44 (CORE §7) — `bump_access_version()` + six triggers + two `system_config` rows. **APPLIED TO LIVE 2026-09-30 ~00:30 IST (Smart Flow), verified: 3 keys + 6 triggers enabled; `ACCESS_CACHE` flipped `'on'` 2026-09-30 ~00:35 IST; hand tests a-d passed.** The notebook is LIVE.

## What shipped

| File | Change |
|---|---|
| `lib/access/notebook.ts` (new) | Pure core: per-user bundle (flags incl. `isActive` + ALL `user_page_access` rows), global `attendance_settings`, role rows per slug set; validity = same `ACCESS_VERSION` tag AND < 12 h, or < 30 s when the version is unknown; tag = version known BEFORE the read; in-flight de-dupe; failed reads cached nowhere; 1,000-entry cap; `readRefreshClaims()` (claims / inactive / failed) |
| `lib/access/notebook-store.ts` (new) | The Prisma-wired instance (`accessNotebook`) + `notebookOn()` |
| `lib/access/access-state.ts` (new) | Pure `parseAccessState()` — `ACCESS_SOURCE` (only exact `user`), `ACCESS_VERSION` (trimmed or null), `ACCESS_CACHE` (only exact `on`; failed read → last known, else off) |
| `lib/access/source.ts` | `getAccessState()` = ONE 3-key `system_config` read per 30 s; `getAccessSource()` is a thin wrapper with the same answers; `clearAccessSourceCache()` clears it all |
| `lib/permissions.ts` | **Additions only (0 lines deleted).** A notebook branch in front of each `user_page_access` / `role_permissions` read; the original queries stay below and run when the switch is off; `mergeRolePerms` now delegates its loop to `mergeRoleRows()` (same query, same merge); `getRolePermissionsForRoles` (the `/admin/access` baseline) unchanged and live |
| `lib/auth.ts` | Refresh branch: notebook block (switch on) — no stale-window gate; `isActive=false` / no user row → `return null`; failed read → keep the token's claims (decision 3); `lastCheckInDate` not re-read (decision 8). `update()` and sign-in: `invalidateUser` (memory only). Two stale comments corrected. The pre-notebook refresh code is unchanged below the block |
| `app/api/admin/access/apply/route.ts` (new) | `POST` — superuser; bumps `ACCESS_VERSION` with the trigger's own statement; 409 if the row is missing; audit `access_version` / `bump`; drops this instance's caches |
| `components/admin/access-manager.tsx` | Secondary "Apply access changes now" button + helper line + toast in the page header |
| `app/api/admin/system-config/route.ts` | Refuses any `ACCESS_*` key with a 400 (decision 7) |
| `prisma/seed.ts` | `ACCESS_VERSION='1'`, `ACCESS_CACHE='off'` |
| `lib/access/notebook.test.ts` (new) + `npm run test:access-notebook` | 23 tests, all pass |
| `sql/2026-09-30-access-notebook.sql` (new) | Read-only pre-check (commented) → keys → function → six triggers (re-runnable) → one UNION ALL verification |
| `docs/CLAUDE_CORE.md` | v27.44 chain entry, change-log entry, header/footer → v114 · Schema v27.44 |

**Owner tweak recorded as a decision (2026-09-30):** `attendanceConsentVersion` is NOT in the `users` UPDATE-OF trigger list — no page reads the claim, and a consent must not reset every user's notebook. The `update()` branch invalidates that user's own entry on the serving instance.

## How the OFF path is identical to today
- `ACCESS_CACHE` missing or not exactly `on` → every notebook branch is skipped and the **original lines run**: `lib/permissions.ts` lost no line; `lib/auth.ts` lost only two comments and its refresh code sits unchanged below the new block.
- The two differences that exist regardless of the switch, both behaviour-neutral: (1) the `system_config` read now fetches three keys instead of one (same 30 s cache, same `ACCESS_SOURCE` answers — unit-tested); (2) the jwt refresh consults that cached state first, so an instance that previously never read `system_config` on a request with no permission check may now do so once per 30 s. `invalidateUser` on sign-in/`update()` is a memory operation on an empty map when off.

## One-liners (SQL Editor)
```sql
-- ON (after the deploy is verified)
UPDATE system_config SET value = 'on'  WHERE key = 'ACCESS_CACHE';
-- OFF (pre-notebook behaviour within ~30 s, no deploy)
UPDATE system_config SET value = 'off' WHERE key = 'ACCESS_CACHE';
-- Manual bump (same as the button)
UPDATE system_config SET value = (CASE WHEN value ~ '^[0-9]+$' THEN value::bigint + 1 ELSE 1 END)::text WHERE key = 'ACCESS_VERSION';
```
**Rollback order:** switch OFF → `git revert` the commit → (only if needed) drop the six triggers and the function (full block at the top of the SQL file).

## Timing (plan §G) — with the notebook ON
| Change | Today | After |
|---|---|---|
| Tick added/removed (`/admin/access` or SQL) | immediate | ≤ ~30 s |
| `isActive = false` | only at next sign-in | ≤ ~30 s mid-session + sign-in refused |
| Reactivate | next sign-in | next sign-in |
| `isSuperuser` grant/revoke | immediate (> 5 min sessions) / ≤ 5 min | ≤ ~30 s |
| `rolloutStage` / `attendanceTestUser` (sidebar link) | as superuser | ≤ ~30 s |
| `attendanceConsentVersion` claim | as superuser (claim unread) | next version bump or 12 h on other instances; immediately on the instance that served the consent (claim unread by any page) |
| Role (`roleId`, `user_roles`) | next sign-in | next sign-in |
| `role_permissions` (role mode only) | immediate | ≤ ~30 s |
| `ACCESS_SOURCE` / `ACCESS_CACHE` flip | ≤ 30 s | ≤ 30 s |
| Password reset | no session effect | unchanged |

## Canon still owed (plan §F.9) — NOT edited in this pass
- CORE §5: "A flag change lands within ~5 minutes" → ~30 s; "To cut access NOW, set `isActive = false` — checked at sign-in, not cached" → ends sessions within ~30 s when `ACCESS_CACHE = on`; add the `ACCESS_VERSION` / `ACCESS_CACHE` keys and their one-liners next to the `ACCESS_SOURCE` panic button.
- CORE §13: landmine — "an access table without a `trg_access_version_*` trigger is invisible to the notebook for up to 12 h"; "a failed bump fails the access write by design".
- CORE §7.14 / §7.15: the triggers and the notebook in one line each.
- CLAUDE_ATTENDANCE §3 stale-window paragraph; `auth.config.ts:37-39` comment ("same 5-minute stale window"); CLAUDE_UI §63 (the lever button).
- `components/admin/access-manager.tsx` "Not live" banner says to set `ACCESS_SOURCE` "in System Config" — that form never listed the key (whitelist) and the API now refuses it; the instruction should say the SQL Editor. (Pre-existing wording; the "Live" state is what shows today.)
- ~~After Smart Flow runs the SQL: change the v27.44 chain entry to "applied to live <date>, verified".~~ Done 2026-09-30 in the live-feed step 1 commit (CORE v115).

## Hand tests (Smart Flow) — plan §I.3
See the chat reply of 2026-09-30 for the numbered checklist (run with `ACCESS_CACHE='off'` first, then `on`).
