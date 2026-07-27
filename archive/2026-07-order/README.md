# /order — retired 27 July 2026

Superseded by **`/po`** (`app/po/po-page.tsx`).

*This file is the STORY of one retirement. The METHOD it followed — reusable for the
next page — is in [`../RETIREMENT-PLAYBOOK.md`](../RETIREMENT-PLAYBOOK.md).*

---

## What /order was

The **first public order-entry page**. Anyone with the link could open it on a phone,
with **no login at all** — no password, no account. A Sales Officer standing in a
dealer's shop, or the dealer themselves, could pick products, set quantities, and hit
Send. The page wrote nothing to the database; it opened the phone's email app with a
pre-filled order, and that email came back into OrbitOMS to be read by the mail-order
parser.

It lived at one address, `/order`, and was one single file — `app/order/page.tsx`,
about 89 KB of it, with 44 commits of history behind it.

## What replaced it

**`/po`**, live since the Phase 1 build. It is also **public — no login** — so nothing
was taken away from the people who relied on `/order` being open to anyone. It does
everything `/order` did and more: multiple bills in one send, saved drafts, a sent
history, a Favourites list of the eight dealers a Sales Officer orders for most, and
proper Android/iPhone back-button behaviour.

`/order` had been the **frozen backup** since `/po` was started — no new features had
landed in it for months. Two pages doing one job, only one of them being improved, is
exactly the standing tax the playbook describes.

## The "Hold" decision — read this before wondering where Hold went

**`/order` offered a dispatch option that `/po` does not.** The owner accepted losing
it, knowingly, on 2026-07-27. Recording it here so nobody rediscovers it as a surprise.

| Page | Dispatch options | Source (paths as they were before this move) |
|---|---|---|
| `/order` | Normal · **Hold** · Urgent | `app/order/page.tsx:170` |
| `/po` | Normal · Urgent · **Call** | `app/po/po-page.tsx:78` |

"Hold" meant *punch the order but do not dispatch it yet* (`CLAUDE_CORE.md §8`). `/po`
replaced it with **Call**, which routes the order to a Sales Officer or the dealer for
a phone conversation, with a named target.

**This retirement did not cause the loss.** Hold was deliberately left out when `/po`
was built — see `CLAUDE_PLACE_ORDER.md §25` ("'Hold' dispatch is removed") and the
comment at `app/po/po-page.tsx:75-76` ("replaces /order's 'Hold'"). It has therefore
been unavailable to everyone using `/po` since the day `/po` shipped. The depot uses
Call. **Do not rebuild Hold into `/po`** — that was decided.

⚠ **Hold is still understood by the rest of the app, and must stay that way.** Orders
placed with Hold in the past still exist, and the Mail Orders screens still read that
value — `lib/mail-orders/utils.ts:711, 784, 787` (the Hold badge and its tag key) and
`lib/mail-orders/email-template.ts:198`. **Nothing about Hold was removed from those
files.** Historical Hold orders still display correctly. Only the *ability to create a
new one from a public page* is gone.

## The address is PARKED — there is no redirect

**Deliberate: `/order` does not forward anywhere.** Visiting it now gets the app's own
"page not found" screen (`app/not-found.tsx`).

The owner is **keeping the `/order` address free for possible future reuse** — most
likely for `/po` itself, which `CLAUDE_PLACE_ORDER.md §25` has long recorded as an
eventual rename. A redirect would have made that reuse messier later, so none was
added. Nothing was put into `next.config.mjs`.

### ⚠ Why the middleware entry is still there — do NOT delete it

`middleware.ts` still lists `"/order"` as a public path, even though the page is gone.
**This is intentional, for two separate reasons:**

1. **It keeps the parked address returning a clean 404.** Middleware runs before the
   page. Remove the entry and `/order` stops being public, so an anonymous visitor gets
   bounced to a **login prompt** instead of a "page not found" — a confusing dead end
   that looks like a broken login rather than a retired page.
2. **It also keeps `/orders` (with an s) public.** The check at `middleware.ts:26` is
   `pathname.startsWith(p)` — a **prefix** match, not an exact one. So the single entry
   `"/order"` covers `/orders` too. Deleting it would silently put `/orders` behind
   authentication as a side effect nobody intended.

A future reader will see an entry for a page that no longer exists and reasonably think
it is junk. **It is not.** Read this section first.

## What moved OUT before archiving — nothing

Unusually for a retirement, **there was nothing to extract first.** `/order` owned
exactly one file and borrowed everything else. The playbook's step 1 ("cut the
dependencies") had no work in it.

---

## 🔴 KEEP LIST — these are shared with /po and must NOT be archived or deleted

`/order` imported six library modules. **Every one is also used by `/po`.** Archiving
or deleting any of them takes down the live public order page.

| Module | `/order` used it at | `/po` uses it at | Verdict |
|---|---|---|---|
| `lib/place-order/mobile-search` (`rankProductsForQuery`) | `app/order/page.tsx:10` | `app/po/po-page.tsx:7` | **KEEP** — the mobile search matcher; `/place-order` does **not** use it (desktop uses `lib/place-order/queries.ts`), so `/po` is now its only user |
| `lib/place-order/pack-buckets` | `:5` | `:5` | **KEEP** |
| `lib/place-order/pack` | `:6` | `:8` | **KEEP** |
| `lib/place-order/email` | `:7` | `:10` | **KEEP** |
| `lib/place-order/base-aliases` | `:8` | `:9` | **KEEP** |
| `lib/place-order/sub-product-descriptors` | `:9` | `:11` | **KEEP** |

Plus the shared server route:

| Route | `/order` used it at | `/po` uses it at | Verdict |
|---|---|---|---|
| `GET /api/order/data` | `app/order/page.tsx:230` | `app/po/po-page.tsx:752` | **KEEP** — the catalog payload both pages read |

Also **KEEP** the middleware entries `"/api/order"` and `"/po"`, and the page key
`place_order`. `/order` never had a page key of its own — it was public — so no
permission was removed and no database row was touched by this retirement.

Note `/po` additionally imports its types from `app/(place-order)/place-order/types`,
so it depends on the `/place-order` folder as well. That folder is staying.

---

## When, and which commits

| Step | Commit | What it did |
|---|---|---|
| 1 | *(discovery)* | Read-only sweep — `docs/prompts/drafts/code-discovery-2026-07-27-page-retirement-sweep.md §4` |
| 2 | `9dce858b` | Repointed the `/place-order` narrow-viewport redirect from `/order` to `/po` — **before** anything moved, so nobody could be sent to a dead address |
| 3 | *(this commit)* | Moved the page here; added the middleware explanation; corrected two stale `--vvh` comments |

**Step 2 mattered.** `/place-order` throws any browser window under 1024px wide to the
mobile page, on load and on every resize. Until `9dce858b` that target was `/order`.
Archiving first would have meant a desktop user narrowing their window landed on a dead
page with no way back.

## Nothing in this folder runs

**Nothing under `archive/` is compiled, deployed, or reachable.** The folder is listed
in `tsconfig.json`'s exclude list, so the type-checker skips it and Next.js never builds
it. It is never uploaded to the live site. No web address leads to it.

It is text on disk, kept so a person can read it.

## Honest note on reinstating this

Moving the file back is mechanically easy — one `git mv`, and the page would compile,
because every module it imports is still present and unchanged (that is what the KEEP
list above guarantees).

**But do not do it.** `/po` is the live public order page and does strictly more. Two
public order pages is the exact problem this retirement solved, and the second one would
start drifting out of date the day it came back — which is how `/order` ended up frozen
in the first place.

**If something is missing from `/po`, build it into `/po`.** The one known gap is Hold,
and that was decided against above.

The one real reason to open this folder: `/po` was **modelled on** this file
(`app/po/po-page.tsx:48, :103`). If a `/po` behaviour looks odd and you want to know
what it was copied from, the original is here.
