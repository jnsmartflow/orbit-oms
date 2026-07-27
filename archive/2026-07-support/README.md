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
| 4 | *(this archive)* | Moved the five screens here |

Steps 5–8 (API routes, page keys, docs) follow after this one.

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

## What is NOT in this folder

- **The API routes** under `app/api/support/**` — still live at the time of this
  archive; they go in step 5.
- **`docs/CLAUDE_SUPPORT.md`** — the module's documentation; it goes in step 7.

## What was deliberately LEFT in the live app

Three things were **not** removed, on purpose:

- **The `support_queue` permission row** (`prisma/seed.ts:78`). Removing it is a
  database change, not a code change, and it was load-bearing until this archive:
  the same permission gated the four master-data pages that shared this folder.
- **The `support_queue` and `operations_support` page keys** in
  `lib/permissions.ts`. Type-level only; they are removed in step 5.
- **The `dispatch_change_queue` table.** Support's edit route was its only writer
  in the entire codebase, and **nothing reads it anywhere**. It is now a frozen
  table. Dropping it is a separate decision, deliberately not bundled into a code
  retirement.

## Honest note on reinstating this

Moving this folder back into place is mechanically easy — `git mv` it back and
remove `archive` from `tsconfig.json`'s exclude list.

**It will not work, and you should not do it.** Support depended on the slot
picker and the ship-to routes. Both have since moved *and changed*: the picker was
restyled and its behaviour altered (tapping only a time now keeps the bill's own
day instead of jumping to today), and the ship-to save is a different route with a
different address and a different request shape. The imports in these files point
at paths that no longer hold what they expect.

**Treat this folder as reference, not a rollback plan.** It is here so someone can
read how a decision used to be made — the guard conditions, the wording, the
footprint rules — not so it can be switched back on. If Floor falls short, build
the missing behaviour **into Floor**.
