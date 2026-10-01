# web-update-2026-09-30 — Sales Officer order pipeline (decisions)
# Status: DECISIONS ONLY. Phase A shipped (5d8db7cb, 9277d0ae, e5bc94e4). Phase B tables live (v27.48, owner ran 2026-09-30). C–H not built.
# Updated 2026-10-01: final address = /po2 (same link), no draft import, C.2 decisions.

## Goal
Replace the public /po2 mailto flow with a logged-in Sales Officer (SO) order page whose orders go straight into Orbit with an Orbit PO number, and whose SO can follow each order's status. First milestone stops at **order punched + notification to the SO**.

## Pipeline (end state, first milestone)
1. SO logs in with email OTP.
2. SO builds an order (fork of /po2). Drafts and favourites stored in the DATABASE per SO, not phone localStorage.
3. One **Send** button:
   a. Order written straight into Orbit (mo_orders + lines + remarks) with SO id, exact customer code, exact SAP material per pack, bill-to, ship-to, notes, dispatch, cross-depot. Orbit allocates a PO number (format TBD, e.g. PO-{YYYY}-{5}).
   b. Then the phone's mail app opens addressed to the depot inbox (as today) with the PO number in the subject. SO sends it, same habit as before.
   c. Safety net: if (a) fails, the mail opens WITHOUT a PO number so the parser ingests it the old way. No order lost.
4. Billing operator punches the SO number as today → status "punched".
5. SO gets a **push notification** (existing web-push system, extended to SOs) and sees the status in his **Sent** list.

## Decisions (owner, 2026-09-30 / 2026-10-01)
- **Final address = the SAME link salesmen use today (/po2).** Salesmen do NOT install anything new. At go-live, opening their existing /po2 link / home-screen icon shows the login screen first, then the new board. The /po2 manifest id stays "/po2", so installed icons keep working. (2026-10-01: a new address like /sales was considered and REJECTED — do not reintroduce.)
- Build and test happen on the test address **/so-lab** (superuser-locked). At go-live, /po2 is switched to render the new page.
- **No import of old /po2 phone drafts/favourites** (2026-10-01). Salesmen start fresh in their account. po2_* keys are simply ignored.
- Test lock: an app_settings switch (e.g. so.page.open), absent/false/error = LOCKED. Go-live flips it.
- Sent tab: "coming soon" placeholder until phase E.
- so_sessions.lastSeenAt: written at most once per 10 minutes per session (otherwise every API call is a DB write).
- Catalogue for the new page: own route, gated by SO session, cached ~10 min (same for every SO), 503 on error, empty result never cached.
- Notification: **app push first** (like supervisor/picker). Email notification only as a later backup, from an orbitoms.in address via ZeptoMail.
- Sent history: **current month by default; previous month selectable**. Loaded on open / pull-to-refresh only — **no polling** (lesson from the 2026-09-29 Disk IO outage).
- Testing: TEST SO (id 19) orders go into live Billing on **real dealers**, with "TEST ORDER" in notes; owner briefs billing not to punch; owner punches with a fake SO number to test notifications.
- During testing the mail step opens addressed to the **owner's own email**, not the depot, so the parser never sees test orders.
- **Email copy + parser skip rule are go-live items.** Parser rule: skip any mail whose subject carries an Orbit PO number; non-PO mails parsed as today.
- **At go-live the public order pages are retired: no one orders without a real SO login.**
- Dealer list filtering, prices, WhatsApp OTP, "not registered" login message (lean: hint text): later.

## Phases
- [x] A. OTP login + superuser-only access grant screen
- [x] B. Storage tables (so_saved_drafts, so_live_drafts, so_fav_products, so_starred_dealers) — live, v27.48
- [ ] C. Order page behind SO login on /so-lab — C.2a fork + catalogue + gating (local storage), C.2b database storage
- [ ] D. PO number + direct submit to Billing
- [ ] E. Sent history (current + previous month) with status
- [ ] F. Push notification on punch
- [ ] G. End-to-end test with TEST SO
- [ ] H. Go-live (see checklist below)

## H — Go-live checklist (think through carefully; run via RETIREMENT-PLAYBOOK with gates)
1. **Parity gate first.** The new page must do at least everything /po2, /po9 AND /po do: multi-bill (/po only), Hold/Call dispatch options, ship-to on/off per SO (the /po9 behaviour → per-SO setting?), tools step sizes (25/12/500 on /po), cross-depot, notes, markers, favourites.
2. **Onboard every SO before the switch:** real emails in Sales Officer master, access granted on /admin/so-access, each one logs in once successfully.
3. **Move the people out before demolishing:** desktop /place-order sends narrow screens (phones) to /po (place-order-page.tsx:160). Repoint that first, in its own commit.
4. **Same link, login first:** /po2 renders the new SO page (login → board). /po9 and /po redirect to /po2 (or also show the login). Manifest ids unchanged so existing home-screen icons keep working.
5. **Middleware:** /po2 is under the public "/po" prefix, which is fine for the PAGE (it does its own SO-session check). But the new APIs (today /api/so-lab/*) are NOT public, and an SO has no NextAuth session → needs an exact-segment middleware branch for the SO API routes. Never put a private staff route under a public prefix (/po, /order, /api/order, /demo).
6. **Close the open data route:** /api/order/data (public full customer + catalogue dump, ROADMAP P0) retires with the public pages.
7. Parser skip rule for PO-numbered mails live on the depot PC; mail step switched from owner's email to the depot address.
8. Deactivate TEST SO (id 19). Buy ZeptoMail credits (free credit expires 31 Oct 2026).
9. Fallback plan for the first days if login/email fails (e.g. plain email to depot, parsed the old way).

## Later (after punch milestone)
- Billing marks not found / partial qty → visible to SO
- Vehicle carrying the order
- Prices / order value (owner supplies price list, keyed on SAP material)
- WhatsApp OTP

## Known facts carried from discovery
- code-discovery-2026-09-29-po2-so-login.md, code-discovery-2026-09-30-so-lab-order-page.md (C.2 plan; its §3 import sheet and §5/Q1 "/sales" recommendation are superseded by the 2026-10-01 decisions above).
- No direct-submit entry point exists; ingest is HMAC-gated and inline. A new server function writes mo_orders directly.
- Parser currently DROPS every "Cross Billing Order" mail (Parse-MailOrders-V7.ps1:1225). Direct submit fixes this for app orders.
- mo_orders.emailEntryId is required + unique → use "so:{poNumber}" as the idempotency key.
- Ship-to on direct submit comes from the SO's explicit pick (not auto-detection) — allowed.
