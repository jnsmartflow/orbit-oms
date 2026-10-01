# Code discovery — phase C.2: the /po2 order board behind SO login at /so-lab
# 2026-09-30 · PLAN ONLY — no code written, no file edited, nothing committed

Files read: CLAUDE.md (router v1.13), docs/CLAUDE_CORE.md (**v117 · Schema v27.47**; v27.48 is live but
not yet in the chain — the owner ran `sql/2026-09-30-so-drafts-favourites.sql` 2026-09-30), docs/CLAUDE_UI.md
(v5.35), docs/CLAUDE_PO2.md (v1.0), docs/CLAUDE_PLACE_ORDER.md (v1.9 — §11, §16),
docs/prompts/drafts/web-update-2026-09-30-so-order-pipeline.md, code-update-2026-09-29-so-otp-login.md,
code-discovery-2026-09-29-po2-so-login.md (§G, §H), sql/2026-09-30-so-drafts-favourites.sql, every file in
app/po2/, app/so-lab/, lib/so-auth/, lib/otp/, app/api/so-lab/, and app/api/order/data + app/api/place-order/data.
Code at HEAD `e5bc94e4`.

Read-only measurement (SELECT count / `pg_total_relation_size`, 2026-09-30): `mo_customer_keywords` 742 rows /
216 KB · `mo_order_form_index_v2` 471 active / 376 KB · `mo_sku_lookup_v2` 1,391 `isPrimary` / 840 KB.

---

## 0. Two things found in the code that the build must handle

1. 🔴 **`getSoSession()` WRITES on every call** — it bumps `so_sessions.lastSeenAt` (`lib/so-auth/session.ts`,
   `update … lastSeenAt: now`). Today only `/me` calls it. Once every board API (catalogue, bootstrap, draft
   saves, toggles) goes through it, **every API call becomes a write**, which alone would exceed the whole
   phase-B write budget. Fix in C.2: bump `lastSeenAt` only when it is older than 10 minutes (≤ 6 writes per SO
   per hour). The Order-access screen's "last login" stays accurate to 10 min. This is a small change to
   phase-A code; see question 4.
2. 🔴 **Two po2 loaders WRITE on read**, so the one-time import must not call them:
   `loadStarred("dealer")` writes the migration seed back to `po2_starred_dealers` when absent
   (`app/po2/v2-storage.ts`, `loadStarred`), and `loadFavProducts()` writes back after a v1 migration or a prune.
   The import must read `po2_*` keys with a raw `localStorage.getItem` + the same cleaning logic, and never
   write. "po2_* keys are read-only" is otherwise broken on the first import.

---

## 1. Fork method

**Where:** `app/so-lab/_board/` — an underscore folder is private in the App Router (never a route), so the
copied files sit next to the page without creating URLs. All copies are NEW files; nothing under `app/po2/`,
`app/po9/`, `app/po/` changes.

| app/po2 file | Lines | In the fork | Change |
|---|---|---|---|
| `v2-data.ts` | 2,988 | copy as-is | none (tokens, BOARD, `buildCatalog`, `CROSS_DEPOTS`, types) |
| `product-drawer.tsx` | 2,095 | copy as-is | none |
| `product-search.tsx` | 159 | copy as-is | none |
| `customer-list.tsx` | 219 | copy as-is | none (imports the `V2Star` type → from the adapter) |
| `review-screen.tsx` | 772 | copy as-is | none |
| `order-sheet.tsx` | 721 | copy as-is | none (the `V2Snapshot` type import is repointed) |
| `v2-sheet.tsx` | 455 | copy as-is | none |
| `v2-search-input.tsx` | 93 | copy as-is | none |
| `drafts-sent.tsx` | 353 | copy + small change | `SentScreen` shows the phase-E placeholder (§3) |
| `v2-email.ts` | 110 | copy + change | recipient = test address, "Sent by {SO name}" line (below) |
| `v2-storage.ts` | 858 | **replaced** by `so-storage.ts` (§3) | pure helpers copied in: `snapshotOf`, `labelFor`, `draftDisplayName`, `formatSavedAt`, `formatTime`, `newDraftId`, `migrateLine`/`migrateSnapshot`, `validSnapshot` |
| `po-v2-page.tsx` | 2,908 | copy + change | data URL, every storage call, Send, header (SO name + Log out), import prompt, `so` prop |
| `v2-manifest.ts` | 84 | copy + change | mount `"/so-lab"` only |
| `page.tsx`, `manifest.webmanifest/route.ts` | 184 | **not copied** | `/so-lab` already has `page.tsx`; a new `app/so-lab/manifest.webmanifest/route.ts` (§5) |

**Imports the fork still takes from outside, read-only, exactly as /po2 does:**
`lib/place-order/pack` (`packKey`, `packStep`, `sortPacks` — via v2-data), `lib/place-order/mobile-search`
(`rankProductsForQuery` — product-drawer, product-search), `lib/place-order/email` (`buildSubject`,
`emailLineLabel`, `renderOrderBody` — **not** `ORDER_TO` any more), `components/shared/orbit-wordmark`,
`lucide-react`. Plus the new `lib/so-auth/*` and the new `lib/so-order/*` (§2–§4).

**Send until phase D** (`v2-email.ts` fork): `SO_TEST_ORDER_TO = "harsh.jnenterprise@outlook.com"` as a named
constant with a "phase D replaces this" note; the body is the unchanged `renderOrderBody` output plus a final
`Sent by {SO name}` line. The subject stays `buildSubject(...)` so it looks like a real order. No CC. The
parser never sees it (owner's own inbox), matching the owner decision.

**Size:** ~11,300 lines copied (13 files), most of it unchanged. The cost is drift: a tile, art or ranking fix on
/po2 must be repeated in the fork until /po2 retires. Acceptable for a test build; it is exactly the trade
discovery §H accepted.

## 2. Route layout and session checks

**One URL, `/so-lab`.** `app/so-lab/page.tsx` (server) decides:

```
staff lock ON  → requireSuperuser (as today, via the layout)
getSoSession() → null     → <SoLabLogin />                (today's login screen)
               → { so }   → <SoBoard so={{ id, name, email }} />  (the fork)
```

- Login success and Log out both end in `window.location.reload()`, so the server re-decides — no client-side
  guessing about who is logged in. The board's header shows `so.name` and a Log out control (POST
  `/api/so-lab/auth/logout`, then reload).
- **Every board API** (`/api/so-lab/catalogue`, `/api/so-lab/state`, the draft/favourite/star routes) starts with
  one helper, `requireSoApi()` in `lib/so-auth/`: staff-lock gate → `getSoSession()` → `401 { reason:
  "no_so_session" }`. The SO id comes from the session only, never from the request body.
- **The staff lock as a switch, not code.** Replace the hard-coded superuser check (layout + `soLabStaffGate`)
  with a check of an `app_settings` row, e.g. `settingKey = 'so.page.open'`: **absent, false or a read error =
  LOCKED** (fail closed — the opposite default to `live.feed`, because this one guards data), cached 30 s per
  instance like `lib/live/feed.ts` `isSwitchOn`. Go-live flips the row; this build is not touched again.
  ⚠ Flipping it is not enough on its own: without a NextAuth session `middleware.ts:78-80` sends `/so-lab` to
  `/login`. The go-live middleware branch (checklist H) is a separate, deliberate commit.

## 3. The storage adapter — `app/so-lab/_board/so-storage.ts`

**Local keys use a NEW prefix and are SCOPED PER SO**: `sopage_{soId}_draft`, `sopage_{soId}_saved`,
`sopage_{soId}_favs`, `sopage_{soId}_stars_dealer`, `sopage_{soId}_stars_shipto`, plus
`sopage_{soId}_imported` and `sopage_device` (random id). Two salesmen sharing a phone never see each other's
cache. `po2_*` is only ever read, once, by the import.

**One read on page load:** `GET /api/so-lab/state` returns `{ liveDraft, savedDrafts, favProducts, stars:
{ dealer, shipto } }` in one call (four small indexed reads). Every snapshot from the server goes through
`migrateSnapshot` on the CLIENT (migrateLine needs `BOARD`), exactly where /po2 migrates on read.

| po2 function (v2-storage) | New behaviour |
|---|---|
| `saveLiveDraft` | Local write on the existing 400 ms debounce (unchanged, free). **Server `PUT /api/so-lab/live-draft`** only: on screen change, on `pagehide` / `visibilitychange→hidden` (`fetch(…, { keepalive: true })`), and at most once per 60 s while editing (trailing) — **skipped when the JSON is identical to the last one sent**. Carries `revision`; a 409 means another phone wrote newer → keep local, reload server copy on next open. |
| `loadLiveDraft` | From `/state` and local; the NEWER `updatedAt` wins; 24 h expiry on both, as today. |
| `clearLiveDraft` | Local remove + `DELETE /api/so-lab/live-draft` (only if a server row is known to exist). |
| `loadSavedDrafts` | From `/state`; local copy kept as an offline read cache. |
| `upsertSavedDraft` | `PUT /api/so-lab/drafts/{clientId}` (upsert on `so_saved_drafts_so_client_key`); server trims to 20 newest. Optimistic UI, revert + toast on failure. |
| `removeSavedDraft` / `renameSavedDraft` | `DELETE` / `PATCH /api/so-lab/drafts/{clientId}`. |
| `loadStarred(list)` | From `/state`. **Never seeds** (no po2-style chain; the import covers history). |
| `toggleStarred(c, list)` | `POST /api/so-lab/stars` `{ list, customerCode, name, area, starred }` → one INSERT (…ON CONFLICT DO NOTHING) or one DELETE. Server refuses the 201st. Optimistic, revert on failure. |
| `loadFavProducts` | From `/state`; dead tile keys pruned in the client view (server rows left — no write on read). |
| `addFavProduct` / `removeFavProduct` | `POST` / `DELETE /api/so-lab/favourites` `{ tileKey }`; server counts first and answers `409 full` for the 9th (refused, never evicted). |
| `loadSentOrders` / `addSentOrder` / `newSentId` | **Not used.** No sent log anywhere until phase E. |
| pure helpers | copied unchanged (list in §1). |

**Sent / Drafts screens meanwhile.** Drafts: live from the database as above. Sent tab: a placeholder
("Sent orders will show here with their status — coming soon") and no list; the post-Send confirmation screen
("sent") still shows as today. The Sent → detail → "Send again" path is unreachable until phase E.

**First login on a phone with po2_* data** (per the SQL design notes): after the board loads, if
`sopage_{soId}_imported` is absent AND any of `po2_saved_drafts`, `po2_draft`, `po2_fav_products`,
`po2_starred_dealers`, `po2_starred_shipto` holds data → one sheet: "Bring drafts and favourites from this phone
into your account?" [Bring them] [Not now → never ask again on this phone]. Import = one `POST
/api/so-lab/import` with everything; the server merges (union by clientId / tileKey / list+code, server wins on a
clash, caps applied, live draft only if the server has none). The answer is stored in `sopage_{soId}_imported`.
Raw reads only (§0.2).

**Writes per active SO per hour (check against the SQL file's ≈15–20 budget):** live draft ~10–15 (ceiling
≈ 60 + hides) · saved drafts 1–3 · favourites/stars 0–2 · `lastSeenAt` ≤ 6 after the §0.1 throttle →
**~17–26 typical**. Slightly above the SQL file's 15–20 because of `lastSeenAt`; without the throttle it would be
one write per API call. No polling anywhere; reads are one `/state` + one catalogue per page load.

## 4. The catalogue route — `GET /api/so-lab/catalogue`

- Same payload `{ customers, products }` as `/api/order/data`. Builder in a NEW `lib/so-order/catalogue.ts`
  (a third copy of the payload builder — `/api/order/data` and `/api/place-order/data` are already duplicates,
  PLACE_ORDER §16; consolidate when /po retires, ROADMAP item).
- **Cost per uncached call:** 3 reads, ~2,600 rows, ~1.4 MB of tables that sit in shared buffers — cheap, and
  mostly memory, not disk. But it is identical for every SO, so **cache it**: `unstable_cache` (Next 14.2, the
  Vercel Data Cache — shared across instances) with a 10-minute revalidate and a tag, gate checked BEFORE the
  cache. Result: at most ~6 catalogue reads per hour for the whole depot regardless of SO count.
- **Differences from `/api/order/data`, on purpose:** gated by `requireSoApi()`; on error it answers **503**,
  never 200-with-empty-arrays, and the empty payload is never cached (the /po2 landmine, CLAUDE_PO2 §13.6).
- Dealer list = all customers, as /po2 today (SO-filtered list is "later" per the decisions doc).

## 5. Manifest / installability

- New `app/so-lab/manifest.webmanifest/route.ts` using the fork's `v2-manifest.ts` with mount `"/so-lab"`:
  `id` / `start_url` / `scope` = `/so-lab`, so it never folds into /po, /po2 or /po9. Linked from
  `app/so-lab/layout.tsx` metadata. The path has a dot, so middleware never sees it.
- **Installable now: yes, technically.** Two caveats: (a) while the staff lock is on, an installed iOS
  home-screen app has its OWN cookie jar, so the owner must log in as staff inside it and `/login` is outside the
  app's scope — test installs are awkward until the lock is off; (b) 🔴 **the manifest `id` is frozen at
  install**, so if the final SO address is not `/so-lab`, every install must be deleted and redone (the exact
  /po2 lesson, CLAUDE_PO2 §3). Decide the final address before anyone but the owner installs (question 1).
- Push (phase F) can use the existing root `public/sw.js`; scope is not a blocker.

## 6. Conflicts and questions for the owner

No hard conflict between the decisions doc and the code. Two soft ones: the decisions doc's write budget did not
count `lastSeenAt` (§0.1), and step H's "middleware branch for the SO page" is still required even after the
staff lock becomes a switch (§2).

1. **Final SO address?** The PWA id is frozen at install. *Rec: pick it now (e.g. `/sales`, clear of every
   public prefix) and build C.2 there with the staff lock on, rather than at `/so-lab`.*
2. **Staff lock as an `app_settings` switch (`so.page.open`, absent = locked)?** *Rec: yes — go-live flips a
   row instead of editing this build.*
3. **Sent tab until phase E: placeholder, no list?** *Rec: yes, per "no sent-orders log to localStorage".*
4. **Throttle `lastSeenAt` to once per 10 min (touches phase-A `getSoSession`)?** *Rec: yes, or every board call
   becomes a write.*
5. **Import sheet wording "Bring drafts and favourites from this phone?" with Not now = never ask again on this
   phone?** *Rec: yes.*

## 7. Size and split

- **C.2a — fork + catalogue + gating (~18 files):** 13 fork files under `app/so-lab/_board/`, `app/so-lab/page.tsx`
  (branch login/board), `app/so-lab/layout.tsx` (manifest link, switch-aware lock), manifest route,
  `lib/so-order/catalogue.ts` + `app/api/so-lab/catalogue/route.ts`, `requireSoApi()` + the lock switch in
  `lib/so-auth/`. Storage in C.2a is LOCAL ONLY under the new `sopage_{soId}_*` keys — a working board end to end
  (build → review → Send to the test inbox) with no new DB writes.
- **C.2b — database storage (~10–12 files):** `so-storage.ts` adapter, `/api/so-lab/state`, `live-draft`,
  `drafts/[clientId]`, `favourites`, `stars`, `import`, `lib/so-order/store.ts` (server helpers, caps), the
  `lastSeenAt` throttle, the 4 Prisma models + back-relations, CORE v27.48 chain entry.
- **Recommend the split.** C.2a is mostly copying and can be verified by eye on a phone; C.2b is where every
  write lives and deserves its own review against the write budget. Each is one commit.
