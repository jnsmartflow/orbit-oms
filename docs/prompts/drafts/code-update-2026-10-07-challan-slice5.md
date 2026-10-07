# code-update-2026-10-07 — Challan Orders slice 5: shared Challan orders screen, paste/unlink SO, admin-only cancel

**Status:** BUILT. `tsc --noEmit` clean · `npm run build` clean — **411** route-table entries (was 406; +5
`/api/challan-orders/*`), 84/84 static pages. No DDL, no grants, no SQL. **Nothing was pasted or cancelled on live**;
the only live contact was a read-only run of the three loaders (board empty; History shows the one cancelled
ORB-2026-00001; marker `count 0`).
Spec: `code-plan-2026-10-07-challan-slice5.md` + web-update §4d S5-1…S5-4 (S5-4 replaces F4).
⚠ **S5-1: no real challan orders until slice 6 is live** — a SO pasted before its OBD arrives does not stop that OBD
reaching picking yet.

## 1. What shipped

- **Access** — `challan_orders` registered: `ALL_PAGE_KEYS`, `ACTION_PAGES.canEdit`, `ACCESS_SECTIONS` "Operations"
  (after `place_order_challan`), rollback row. Admin / superuser only until slice 9.
- **One screen** — `components/challan-orders/challan-orders-screen.tsx`: grey segmented switch **Not billed · Waiting
  for OBD · Billed · History**, the plan's filters exactly (`lib/challan-orders/board.ts`); age chip neutral / amber
  3–6 / red ≥ 7 off the trip date else creation (`ageTone`, M7/F3); History = created-date range + search ORB /
  dealer / SO + status chips, 50 a page; Match column "—" (slice 7). Without canEdit: no Paste SO, no Link, no ✕
  (not rendered) and the "view only — Billing links SOs" chip.
- **Mounts** — Billing tab "Challan orders" after Pick delete (`billing-tab-bar.tsx`, `review-view.tsx`,
  `mail-orders-page.tsx`, layout provider) · Floor tab after Cancel & CI (`floor-page.tsx` `TopTab "challan"`,
  `trip-desk.tsx`, `app/(floor)/floor/page.tsx`) · Place Order top-bar link "Challan orders" swapping the LEFT work
  area only (cart kept; keyboard shortcuts off while open). Each hidden without canView; the Billing / Floor pill
  count = Not billed, read by `ChallanCountProbe` (mounted only for a holder).
- **Paste SO** — `POST /api/challan-orders/links` → `lib/challan-orders/links.ts` `pasteSo`: checks 1–7 in order,
  nothing written first — canEdit · 10 digits (`normaliseSoNumber`) · ORB exists / challan / not removed / not
  cancelled · F5 one SO → one challan ("SO … already linked to ORB-…", P2002 race mapped to the same) · **late paste
  refused** (a non-cancelled OBD with that SO already in Orbit) · dealer guard via the newest mail order with that SO
  → **S5-2 warning** "SO … is for X — challan ORB-… is for Y" + **Link anyway** (second request with
  `confirmDealerMismatch`) · insert one `waiting` row.
- **Unlink** — `POST /api/challan-orders/links/[id]/unlink` → `unlinkSo`: canEdit, only `waiting` (a `linked` row is
  refused), guarded `updateMany` → `unlinked` + `unlinkedById` + `unlinkedAt`. Idempotent.
- **S5-3 / S5-4** — `lib/challan-orders/cancel-guard.ts`: `challanCancelRefusal` ("Only admin can cancel a challan
  order.", admin = `lib/rbac.ts isSuperuser(session)` — the admin role or the superuser flag) and
  `unlinkWaitingOnCancel`. Every core takes `actorIsAdmin` **defaulting to false**, so an unpassed caller refuses ORB
  rows only. Admin still meets every existing stage rule.
- **Live sync** — the screen's own marker poll (`GET /api/challan-orders/marker`, 30 s, `usePickingMarker`) + an
  immediate reload after its own writes; the marker moves on any ORB order, link or ORB trip change.

## 2. Files

New: `lib/challan-orders/{board.ts, board-types.ts, links.ts, access.ts, cancel-guard.ts}` ·
`app/api/challan-orders/{list, history, marker, links, links/[id]/unlink}/route.ts` ·
`components/challan-orders/{challan-orders-screen.tsx, challan-orders-access-provider.tsx, use-challan-count.ts}` · this file.
Edited: `lib/permissions.ts`, `components/admin/permissions-manager.tsx`, `components/billing/billing-tab-bar.tsx`,
`app/(mail-orders)/mail-orders/{layout.tsx, mail-orders-page.tsx, review-view.tsx}`, `app/(floor)/floor/page.tsx`,
`components/floor/{floor-page.tsx, trip-desk.tsx}`, `app/(place-order)/layout.tsx`,
`app/(place-order)/place-order/place-order-page.tsx`, `lib/floor/{bill-actions.ts, raise-ci.ts}`,
`lib/billing/pick-delete.ts`, and the 8 routes in §3.

## 3. Every cancel / remove path (S5-4 guard + S5-3 unlink)

| Route (live caller) | Core | Guard | Auto-unlink |
|---|---|---|---|
| `POST /api/floor/actions` cancel (Floor detail ⋯, bulk bar, off-floor dialog) | `applyBillAction` | ✓ | ✓ |
| `POST /api/tint/manager/cancel` — Cancel + Stop & cancel (Tint Manager, off-floor dialog) | `applyBillAction` | ✓ | ✓ |
| `POST /api/floor/ci` — Raise CI (Floor, off-floor dialog) | `raiseFullBillCi` | ✓ | ✓ |
| `POST /api/tint/manager/ci` (Tint Manager) | `raiseFullBillCi` | ✓ | ✓ |
| `POST /api/picking/cancel` (supervisor cancel sheet, `picking-board-mobile.tsx`) | inline | ✓ 403 before the stage gate | ✓ |
| `POST /api/billing/pick-delete/delete` (Billing Pick delete, base URL constant) | `pickDelete` | ✓ | — an ORB order has no SO, so it is refused "no SO number" anyway and never cancelled here |
| `POST /api/tint/manager/pick-delete/delete` (Tint Manager) | `pickDelete` | ✓ | — same |
| `POST /api/tint/manager/orders/[id]/remove` (RemoveObdModal) | inline | ✓ | ✓ (the stage rule `pending_tint_assignment` already refuses a non-tint ORB order) |
| `POST /api/admin/removed-orders/[id]/restore` | inline | refuses ANY challan order (slice 3) | — |

**Not guarded — cannot reach an ORB order:** `lib/billing/telephonic-apply.ts` CI cancel and `lib/ci/bill-only.ts`
(both select bills BY SO; an ORB order's `soNumber` is always null), the import paths (create OBDs, never ORB).
**UI:** the cancel controls are NOT hidden for non-admins in this slice (the Floor / Picking / Tint clients carry no
admin flag); a non-admin pressing Cancel on an ORB row gets the server's refusal in the existing failure toast.

## 4. Differs from the plan

1. **Waiting tab has a small "another SO" box** (canEdit) — F5 part-billing needs a second paste after the first
   moves the challan out of Not billed; the mockup shows only ✕. History also offers ✕ on a still-`waiting` SO.
2. **Late paste ignores a CANCELLED OBD** with that SO (it ships nothing); any other stage refuses.
3. **Marker `count` = Not billed** (the pills read it via `onResult`), `signature` = order + live-link counts.
4. Cancel controls not hidden client-side (§3).

## 5. HAND-TEST LIST (owner, signed in as ADMIN, local, ONE fresh test ORB order)

⚠ Use a fake SO that is real-looking: **10 digits, not on any mail order or OBD** (e.g. `9999000001` — check it with
the SELECT in step 0 first). Do not use a real SO.

0. Read-only pre-check (should return 0 / 0 / 0):
   `SELECT (SELECT count(*) FROM orders WHERE "soNumber"='9999000001')::text, (SELECT count(*) FROM mo_orders WHERE "soNumber"='9999000001')::text, (SELECT count(*) FROM challan_order_so_links WHERE "soNumber"='9999000001')::text;`
1. **Create** a test challan order on `/place-order` (slice 3 flow) → note its ORB number (e.g. `ORB-2026-00002`).
2. **Billing** → tab bar shows **Challan orders 1** after Pick delete → Not billed lists it: dealer, "Same as
   billing", tins, "In picking · created …", age **0d** grey, a Paste SO box.
3. Paste `12345` → red line "SO must be exactly 10 digits." Paste `9999000001` → **Link** → the row moves to
   **Waiting for OBD** with `9999000001 · waiting ✕`, linked by you.
4. **Unlink** (✕) → back in Not billed. History (this month) shows the SO struck through, "unlinked".
5. **Paste again** `9999000001` → Waiting.
6. **Non-admin can't cancel:** as a Floor user (not admin), Floor → Floor tab → the ORB row → ⋯ → Cancel → refused
   **"Only admin can cancel a challan order."** (same on `/picking` cancel sheet).
7. **Cancel as admin** (Floor → ⋯ → Cancel, reason Other, remark "TEST ORDER") → done.
8. Challan orders → the order is gone from Waiting; **History** shows it **Cancelled** and the SO
   **unlinked** (struck through) — the auto-unlink (S5-3).
9. **Floor** tab bar shows "Challan orders" after Cancel & CI; **Place Order** top bar "Challan orders" opens the same
   list in the left area; your cart is still there after "← Back to order".
10. **Non-admin with Billing access** (mail_orders, no `challan_orders` tick): no Challan orders pill on Billing, no
    tab on Floor, no link on Place Order.

**Verify (read-only; replace the ORB number and SO):**
```sql
SELECT 'order'::text AS what, o.id::text AS a, o."obdNumber"::text AS b, o."workflowStage"::text AS c,
       o."isChallanOrder"::text AS d, o."isRemoved"::text AS e, ''::text AS f
  FROM orders o WHERE o."obdNumber" = 'ORB-2026-00002'
UNION ALL
SELECT 'link', l.id::text, l."soNumber"::text, l.status::text, coalesce(l."unlinkedById"::text,'(null)'),
       coalesce(l."unlinkedAt"::text,'(null)'), l."linkedById"::text
  FROM challan_order_so_links l JOIN orders o ON o.id = l."orbOrderId" WHERE o."obdNumber" = 'ORB-2026-00002'
UNION ALL
SELECT 'live links on SO', count(*)::text, '', '', '', '', ''
  FROM challan_order_so_links WHERE "soNumber" = '9999000001' AND status <> 'unlinked'
UNION ALL
SELECT 'cancel log', g.id::text, g."toStage"::text, coalesce(g."fromStage",'(null)')::text, g."changedById"::text, g.note::text, ''
  FROM order_status_logs g JOIN orders o ON o.id = g."orderId"
 WHERE o."obdNumber" = 'ORB-2026-00002' AND g."toStage" = 'cancelled';
```
*Expect:* order `cancelled`, `true`, `false`; **two** link rows for `9999000001`, both `unlinked` — the first with
your id (the ✕), the second with the canceller's id (S5-3) — and `unlinkedAt` set; **live links on SO = 0**; one
cancel log by the admin.
