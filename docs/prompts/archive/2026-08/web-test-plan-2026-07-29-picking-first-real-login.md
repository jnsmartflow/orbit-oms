# Picking floor test — first real login run

**Date:** 29 July 2026
**Why this matters:** every one of the 583 test bills so far was assigned by the admin account using the "view as picker" shortcut. No picker or supervisor has ever logged in for real. This is the first time.

---

## The accounts

| Who | Email | Password | Lands on |
|---|---|---|---|
| Test Supervisor 1 (id 34) | supervisor1@orbitoms.in | [redacted] | /picking — supervisor board |
| Test Picker 1 (id 35) | picker1@orbitoms.in | [redacted] | /picking — "My Picks" |
| Test Picker 2 (id 36) | picker2@orbitoms.in | [redacted] | /picking — "My Picks" |

Old accounts (Test Floor Supervisor, Ramesh K., Sunil P.) are switched off. Their 583 old bills are untouched and their names still show on those bills.

---

## Before you start

- Two Android phones minimum. Three is better — one supervisor, two pickers.
- At least 3 bills sitting at "waiting" on /floor. If there are none, release a few from the left rail first.
- You on a desktop with /floor open, as admin or operations.
- **Do not use the "view as picker" shortcut anywhere in this test.** That shortcut is the thing we are trying to stop relying on.

---

## Round 1 — can they get in

On each phone, one at a time.

1. Open orbitoms.in
2. Type the email and password
3. Press login

Write down for each:

- [ ] Did it log in at all
- [ ] Which screen did it land on
- [ ] Supervisor: does he see three tabs at the bottom (Assign / Picking / Done)
- [ ] Picker: does he see two tabs at the top (Pending / Done)
- [ ] Picker: is there **no** way to assign a bill to anyone

The last one matters. A picker is allowed to look but not assign. If a picker can see an assign button, stop and tell me.

---

## Round 2 — one bill, all the way through

Use one bill. Follow it end to end.

1. **You, on desktop /floor** — release a bill to the floor
2. **Supervisor phone** — the bill appears in Assign. Tap it, assign to Picker 1
3. **Picker 1 phone** — the bill appears in his Pending
4. **Picker 1** — open it, check the item list reads correctly, tap Mark Done
5. **Supervisor phone** — the bill moves to Done, top band "Needs check"
6. **Supervisor** — open it, tick every line, tap Approve
7. **You, on desktop /floor** — the bill now reads Done

Write down where it breaks, if it breaks.

---

## Round 3 — two phones at once

The boards refresh themselves every 15 seconds. Test that.

1. Supervisor and Picker 1 both on their boards, both watching
2. Supervisor assigns a bill to Picker 1
3. **Do not touch Picker 1's phone.** Wait.
4. Does the bill appear on Picker 1's phone by itself, within about 20 seconds?

Then the other direction:

5. Picker 1 taps Mark Done
6. **Do not touch the supervisor's phone.** Wait.
7. Does it move into the supervisor's Done tab by itself?

If either side needs a manual refresh, note it.

---

## Round 4 — the phone notification

This has never been tested with a real picker login. It could not be, until now.

1. Picker 1 — when the phone asks to allow notifications, say yes
2. Close the app completely. Lock the phone.
3. Supervisor assigns him a bill
4. Does the phone buzz with a notification?

If no permission prompt ever appeared, note that too — that is its own finding.

---

## What is normal — do not report these as bugs

- **Some items show no pack size.** About a quarter of SAP codes are missing from the catalog. Blank is correct behaviour — better a blank than a wrong number that causes a mis-pick.
- **Some bills show no article tag.** About 1 in 6. Known, old, not a picking fault.
- **Assignment notes say "(test)".** The assign action tags itself as test mode. Expected.
- **The colour of the timer pill.** Grey under 30 minutes, amber over 30, red over 60. Those numbers were guessed, never measured.

That last one is worth real attention: **write down how long picks actually take.** Start time and finish time for three or four bills. Nobody has ever measured it. If real picks take 10 minutes, the thresholds are wrong and should move.

---

## Things to watch that have bitten before

- **Android back button.** Inside a bill, back should close the bill and return to the list — not throw you out of Picking. Test it.
- **Swiping between bills.** Swipe left and right inside a bill to move to the next one. Then press back once — it should return to the list, not walk back through every bill you looked at.
- **The filter sheets.** Four of these open without a back affordance. Pressing back may close more than expected. Known, unfixed.

---

## If something breaks

Note three things: which phone, which step number, and what you saw on screen. Do not try to fix it on the floor.

If a picker cannot log in at all, the likely cause is a permissions row, not the account. Say so and I will write the check.

---

## After the test

Two things come out of this session and should be written into the project files:

1. **`operation_manager` is confirmed real** — role_master id 15, with a live user (Prakash, id 32). CLAUDE_CORE.md §5 currently says the role has no confirmed row. It does.
2. **Two undocumented behaviours found in the code:**
   - Switching a user off blocks new logins, but an existing signed-in session keeps working until the token expires. A deactivated picker could still open his board — Mark Done would then fail with an error.
   - The board has two picker dropdowns fed from different places. A switched-off picker vanishes from the assign sheet but stays in the filter dropdown.

Neither is in CLAUDE_PICKING.md today.
