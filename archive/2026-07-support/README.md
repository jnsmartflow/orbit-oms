# Support — retired 27 July 2026

Superseded by **Floor Control** (`/floor`).

---

## What Support was

Support was the **gatekeeper desk**. Every bill (OBD) that arrived from SAP landed
in Support first, and one person decided what happened to it: send it out
(Dispatch), park it (Hold), or scrap it (Cancel) — and for anything being sent
out, *which day and which time window* it would go on. It also had a Hold tab for
parked bills, a history view for past days, and four master-data pages bolted onto
the same folder (Customers, SKUs, Routes, Vehicles).

It lived at three addresses, all rendering the same screen: `/support`,
`/operations/support`, and `/admin/support`.

## What replaced it

**Floor Control** at `/floor`, live since 24 July 2026. It merged the Support
board and the Picking desktop board into one screen: the left rail holds bills
still needing a decision, the right side shows what is already out on the floor
being picked, plus On-hold and Cancelled tabs and a slide-out detail panel.

One person now sees the whole journey on one screen instead of two.

## Why it was retired

Two reasons, in this order:

1. **Floor Control does the same job on one screen.** Keeping both meant two
   places to look and two places to fix.
2. **Nobody was using Support.** Confirmed by the owner before any file moved.
   The `support` role has no active depot staff on it.

A gap analysis was run first rather than assuming parity — see
`docs/prompts/drafts/code-discovery-2026-07-27-support-vs-floor-gap.md`. It found
things Support could do that Floor could not (undo a release, bulk release from
the rail, cancel with a stored reason, CSV export, resolve an unmatched customer).
Those were accepted as losses because nobody was using the screen. **If any of
them turn out to be needed, build them into Floor** — do not revive this folder.

## When, and which commits

Retired across eight steps on **27 July 2026**. The steps that touched code:

| Step | Commit | What it did |
|---|---|---|
| 1 | `bc42a948` | Moved the shared slot picker and `formatArticleTag` out of Support into Floor |
| — | `d08681e9` | Docs: the discovery reports behind the plan |
| 2 | `316eec6b` | Gave Floor its own ship-to search + save routes |
| 3 | `3ff717e5` | Repointed the operations login and both sidebars at Floor |
| 4 | `f1166f94` | Moved the five screens here |
| 5 | *(this commit)* | Moved the API routes here; removed the two page keys |

Steps 6–8 (docs, and a deliberate database clean-up) follow after this one.

## What moved OUT of Support before the archive

Three things were shared with Floor and had to be extracted first, or archiving
would have broken the live app:

| What | Where it went now |
|---|---|
| `dispatch-slot-picker.tsx` — the date + time-window popup | `components/floor/dispatch-slot-picker.tsx` |
| `formatArticleTag` — turns `"16 Drum, 14 Carton"` into `"16 D · 14 C"` | `lib/floor/format.ts` |
| Ship-to search (`GET`) and ship-to save | `app/api/floor/ship-to-search/` and `app/api/floor/ship-to/` |

The ship-to **save** was not copied — it was rewritten. Support's version handled
four unrelated fields at once and used a database transaction that this app's
hosting cannot safely run (`CLAUDE_CORE.md §3`). Floor's does one job, checks the
target customer exists, and skips the write entirely when nothing actually
changed.

---

# Step 5 — the machinery behind the screens

Step 4 archived the **screens** — what a person looked at. Step 5 archives the
**machinery underneath** — the part of the program the screens talked to when
someone clicked Hold or Cancel. With the screens gone, nothing was calling it.

## The API routes are now in this folder too

All fifteen of them, under `api/support/` here. These were the instructions the
server followed when Support asked it to do something: place a bill on hold,
cancel one, send one out, undo any of those, look up a delivery address.

**Nothing under `/api/support/` responds any more.** Those web addresses simply
do not exist. Nothing was calling them — this was checked across the whole
codebase before anything moved. Floor Control was given its own copies of the two
it genuinely shared (the delivery-address search and save) back in step 2, so
Floor never depended on Support's.

## The two "page keys" are gone

A page key is the short internal name the app uses to decide who is allowed to
see which screen — a label like `support_queue` that ties a screen to a
permission. Support had two of them: `support_queue` (for `/support`) and
`operations_support` (for `/operations/support`).

Both have been removed from the app's list of known screens, from the list used
when setting up a brand-new database, and from the two places that still drew a
menu icon and a permission-toggle row for them. That last one mattered: an
administrator could otherwise still tick a box granting access to a screen that
no longer exists, quietly re-creating the very leftovers described below.

## What is still live in the DATABASE — and why

Code and database are separate here. This commit changed only **code**. No SQL
was run, and nothing in the database was touched. Two things are therefore still
sitting there:

**1. The old permission rows.** The database still holds rows saying "the support
role may view the support queue" and, most likely, "the operations role may view
the operations support screen." These now point at screens that no longer exist,
so they do nothing at all — a key with no lock left to fit. They are harmless,
but they are clutter, and they are being cleared **deliberately and separately**,
in one reviewed SQL statement, rather than quietly as a side effect of a code
change. Deleting rows from a live database is not something to bundle into a
file move.

**2. The `dispatch_change_queue` table.** Support's edit screen was the only thing
in the entire codebase that ever wrote to this table, and **nothing anywhere has
ever read from it**. It is now frozen: no new rows will arrive, and the existing
ones are simply history. It has deliberately not been dropped. Removing a whole
table is a bigger, riskier decision than retiring a screen, and it deserves its
own moment rather than riding along inside this one.

## Nothing in this folder runs

Worth stating plainly, because it is the whole point of the `archive/` folder:

**Nothing under `archive/` is compiled, deployed, or reachable.** The folder is
listed in `tsconfig.json`'s exclude list, so the tooling that checks and packages
the app skips it entirely. It is never uploaded to the live site. No web address
leads to it. A visitor to orbitoms.in cannot reach any of it, and neither can a
logged-in member of staff.

It is text on disk, kept so a person can read it. That is all it is.

## What is still NOT in this folder

- **`docs/CLAUDE_SUPPORT.md`** — the module's written documentation. It goes in
  step 7.

## Honest note on reinstating this

Moving this folder back into place is mechanically easy — `git mv` it back and
remove `archive` from `tsconfig.json`'s exclude list.

**It will not work, and you should not do it.** Support depended on the slot
picker and the ship-to routes. Both have since moved *and changed*: the picker was
restyled and its behaviour altered (tapping only a time now keeps the bill's own
day instead of jumping to today), and the ship-to save is a different route with a
different address and a different request shape. The imports in these files point
at paths that no longer hold what they expect.

Step 5 added a second obstacle. The archived API routes still ask the app "may
this person use the support queue?" — and after step 5 the app no longer knows
what the support queue is. That question now fails to compile outright. Restoring
this folder means restoring the page keys, the permission rows, and the seed
entries as well; it is not a matter of moving files back.

**Treat this folder as reference, not a rollback plan.** It is here so someone can
read how a decision used to be made — the guard conditions, the wording, the
footprint rules — not so it can be switched back on. If Floor falls short, build
the missing behaviour **into Floor**.
