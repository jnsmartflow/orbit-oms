# web-update-2026-09-06 — Orbit colour specification (v2, FINAL)

**Supersedes** the colour section of `web-update-2026-09-06-orbit-rebrand.md`.
That draft assumed violet was free and only the notes band collided. The discovery
(`code-discovery-2026-09-06-colour-inventory.md`) showed violet means **tint** across 38 files.
The v1 model was tried and removed — do not reintroduce it.

Name, wordmark, logo usage and login page from v1 are **unchanged and still current**.
This file replaces only the colour system.

---

## 0. The three decisions this rests on

1. **Violet stays the brand; tint moves.** A purple brand is the fixed requirement.
   Violet, indigo and purple are one perceptual family — so if tint keeps that family,
   the brand cannot be purple at all. Two owners, one hue, is not resolvable.
2. **Tint moves to sky blue, not cyan.** Cyan sits ~15° from the teal that IGT keeps,
   and tint and IGT appear in the same tables. Sky is visibly bluer.
3. **Teal stops being the brand and keeps only IGT.** Those seven sites need **no edit** —
   the colour was already right, it was only sharing.

**Rule that governs everything below: change only what collides with the brand or with tint.**
Colours that already sit outside both families stay exactly as they are, even if a tidier
system could be imagined. Every avoided edit is an avoided bug.

---

## 1. The families

### Brand — violet. Five appearances per screen, maximum.

| Token | Hex | Used for, and only for |
|---|---|---|
| `brand.50` | `#F5F3FF` | Active nav item background |
| `brand.200` | `#DDD6FE` | Tagline on the login panel |
| `brand.300` | `#C4B5FD` | Login panel arcs |
| `brand.400` | `#A78BFA` | Login accent bar, login corner light |
| `brand.500` | `#8B5CF6` | Input focus border |
| `brand.600` | `#7C3AED` | Commit button · active tab underline · focus ring · `themeColor` |
| `brand.700` | `#6D28D9` | Commit hover · **all tappable text** (Open, View, Change, History) |
| `brand.800` | `#5B21B6` | Wordmark on white · active nav label |
| `brand.900` | `#43168B` | Login panel background only |

### Neutral — violet-tinted grey. Nine tenths of every screen.

| Token | Hex | Used for |
|---|---|---|
| `n.0` | `#FFFFFF` | Cards, panels, table rows, rail |
| `n.25` | `#FAFAFC` | Page background · selected row · group header · footer bar |
| `n.50` | `#F4F3F8` | Neutral chips · code pills · progress track · disabled fill |
| `n.100` | `#E9E7F0` | Every border and divider |
| `n.200` | `#D6D3E0` | Selected-row left bar |
| `n.400` | `#9C99AC` | Column headers · timestamps · placeholders |
| `n.500` | `#74718A` | Second lines — route, volume, customer code |
| `n.600` | `#514E63` | Secondary button text |
| `n.700` | `#3A3748` | Body text · utility button hover |
| `n.900` | `#1B1826` | Headings · customer names · OBD numbers · **utility button** · count pills · avatars |

### Tint — sky. New family. Replaces every violet that means tint.

| Token | Hex | Used for |
|---|---|---|
| `tint.bg` | `#F0F9FF` | Tint strip wash · tint chip background · tint card tint |
| `tint.bd` | `#BAE6FD` | Tint chip border · tint strip left bar |
| `tint.600` | `#0284C7` | Tint droplet · tint stage dots · tint progress mid-range |
| `tint.700` | `#0369A1` | Tint chip text · tint label text |

### Status — fixed meanings, never brand, never tint.

| Token | Hex | Background | Text | Means |
|---|---|---|---|---|
| `success` | `#059669` | `#ECFDF5` | `#047857` | Done, ready, matched, punched, present, live, available |
| `attention` | `#D97706` | `#FFFBEB` | `#B45309` | Changed, notes, split, hold, override captured, needs check, unknown SKU |
| `urgent` | `#E11D48` | `#FFF1F2` | `#BE123C` | Urgent flag, errors, cancelled, zero search hits, duplicate SO |
| `favourite` | `#F59E0B` | — | — | The star only |
| `waiting` | — | `#F4F3F8` | `#74718A` | Not started — deliberately colourless |

There is **no `info` colour**. Sky now belongs to tint; nothing else may claim it.

### Data — identities, not states. Never reassigned once shipped.

| Token | Hex | Assigned to | Change? |
|---|---|---|---|
| `data.teal` | `#0D9488` | **IGT delivery type** | **No edit.** Seven sites keep their exact colour. |
| `data.blue` | `#2563EB` | Local delivery type | No edit |
| `data.orange` | `#EA580C` | Upcountry delivery type | No edit |
| `data.rose` | `#E11D48` | Cross delivery type | No edit — see §6 open item |
| `data.pink` | `#DB2777` | **Decorative Projects SMU** | **Moves** from `#4F46E5` (too close to brand) |
| `data.lime` | `#65A30D` | free | — |
| `data.slate` | `#475569` | free | — |

### Pigment — physical paint colours. Absolutely exempt.

`ACOTONE MA1`, `Cobalt Blue`, `BU1` and every other swatch in
`components/tint/tint-operator-content.tsx` and `lib/tint/shade-colors.ts`
represent **real pigment**. They are not design tokens. **Do not touch, do not audit,
do not include in any sweep.** If a swatch happens to be `#8B5CF6`, that is a coincidence
and it stays `#8B5CF6`.

---

## 2. Buttons — seven kinds, no more

| Kind | Fill | Text | Border | Where |
|---|---|---|---|---|
| **Commit** | `brand.600` | white | — | The action that finishes the job. **One per screen**, in the footer bar. Release · Punch · Mark done · Close MRN · Send order · Sign in. Hover `brand.700`. |
| **Utility** | `n.900` | white | — | A tool, not a decision. Import · Download XLS · New MRN. Hover `n.700`. |
| **Secondary** | white | `n.600` | `n.100` | Everything in a toolbar. Urgent · Hold · Slot · Notes · Copy · Reports · Photos · Print · Filter. Hover fill `n.25`. |
| **Text** | — | `brand.700` | — | Opens or reveals. Open · History · Change · View lines. Most of the app's violet lives here. |
| **Card action** | white | `brand.700` | `n.100` | The action on a repeated card in a list (Floor decision cards). **Never filled** — thirteen cards would become a wall of violet. |
| **Destructive** | white | `#BE123C` | `#FECDD3` | The trigger. Solid `urgent` **only** inside a confirm dialog. |
| **Disabled** | `n.50` | `n.400` | — | Commit button until its condition is met. |

**`.oa-btn-primary`, `.oa-btn-danger` and `.oa-btn-*` are deleted.** Seventeen admin buttons
currently carry both `bg-teal-600` and `oa-btn-primary` and render **navy `#1a237e`** because of
`!important`. Navy is drift, not a second brand. Those buttons become Commit or Utility per the
table above. The `!important` must go before any swap is verifiable.

**`.oa-sheet-form` focus `#6366f1 !important` is deleted.** All focus is `brand.500` + brand ring.

---

## 3. Where every current colour goes

### Teal → its meaning's home

| Current use | Sites | Goes to |
|---|---|---|
| Brand (buttons, nav, logo tile, focus, theme, accents) | ~463 lines | `brand.*` per §1 |
| **IGT delivery type** | 7 | **`data.teal` — unchanged, no edit** |
| `ACCESS_SOURCE` live banner | 2 | `success` |
| Billing live-sync dot | 3 | `success` |
| Punched row wash | 1 | `success` at 40% |
| Done pill (review view) | 1 | `success` |
| `tone === "ok"` photo lightbox | 1 | `success` |
| Toast "Rollout activated" | 2 | `success` |
| Picker **available** vs busy | 1 | `success` / `n.400` |
| Bundle "Same material · one picker" | 4 | `success` (amber stays for "Mostly same") |
| Search token **with hits** | 1 | `success` (pairs with `urgent` for zero hits) |
| Search-hit highlight ring / border | 4 | `success` ring |
| Dispatch priority **Normal** | 2 | `n.400` — the low rung of a ladder should be quiet |
| `OperatorAvatar` not-done | 1 | `n.400` |
| `e.synthetic` dispatch-engine event | 2 | `n.400` |
| Remark type **customer** | 1 | `n.500` chip |
| Audit event `line_restored` | 1 | `n.500` chip |
| CI **"Full bill"** tag (incl. `#E7F4F2`) | 4 | `n.50` / `n.600` chip |
| CI **Ready** close-pill | 1 | `success` |
| Tint progress 25–75% | 2 | **`tint.600`** |
| Tint section dot "Pending Assignment" | 2 | ~~`tint.600`~~ → **`ink-400`. OVERRIDDEN 2026-09-09 — see below** |
| Selected roster row | 2 | `n.25` fill + `n.200` left bar |
| Role colour `picker` `#0f766e` | 1 | `data.lime` `#65A30D` |
| `tailwind.config.ts` `cart-flash` keyframe `#f0fdfa` | 1 | `brand.50` `#F5F3FF` |
| `lib/mail-orders/email-template.ts` — 6 hexes | 6 | `brand.600` / `brand.100`. See §6. |
| `public/order-demo.html` `--teal*` block | 4 | Out of scope. `/demo` is not the app. |

🔴 **OVERRIDE, ruled 2026-09-09 — the tint section dot goes to `ink-400`, not `tint.600`.**
Applied in `b585240f`; it also reverses the `tint-600` that step 2a had put on the same two lines
(`tint-table-view.tsx:204` and `:644`). Three reasons, and the first is the one this whole spec's
method is supposed to catch:

1. **Adjacency.** That dot is one of a FOUR-COLOUR section key — Pending / Assigned / In Progress /
   Completed — and "In Progress" is already `bg-blue-400` `#60a5fa`. Sky `#0284C7` beside it is two
   blues in a legend of four.
2. **It carried no information.** Every row in that table is a tint row, so painting the section
   "tint" says nothing about the section.
3. **The section means NOT STARTED**, which §1 already has a token for: `waiting`, defined there as
   *deliberately colourless*.

The SCHEME_MAP key was renamed `"teal"` → **`"neutral"`**, not to `"tint"`, for the same reason a
key must not lie about what it paints. **The general rule this proves: a destination is only correct
in the company it will keep.** Check what a colour sits NEXT TO before assigning it — five of the
six overrides in steps 2 and 3 came from that test and none from reading the meaning alone.

### Violet → tint, or its real meaning

| Current use | Sites | Goes to |
|---|---|---|
| **Tint strip** (`components/floor/tint-strip.tsx` — the single owner) | 2 | **`tint.*`** |
| Tint droplet / 🎨 marker / `isTint` / `isTinting`, app-wide | 14 | **`tint.*`** |
| Tint · Pending / Assigned / Mixing status pills | 11 | **`tint.*`** |
| "Manually pulled into tint" | 6 | **`tint.*`** |
| "With picker" | (in the above) | **`tint.*`** |
| **Split** signal + split labels | 10 | `attention` — unifies with the amber split-recommended box that already exists |
| **Ship-to override captured** card + `⚑ captured` pill | 6 | `attention` |
| Billing v2 **notes band** `tone="violet"` | ~14 | `attention` |
| **Truck-order** pill | 2 | `n.50` / `n.600` chip |
| `NEEDS_CHECK_TAG` | 1 | `attention` |
| CI return-reason callout | 1 | `attention` |
| Premises-type chip | 1 | `n.50` / `n.600` chip |
| Row-state left border `#a78bfa` | 1 | `n.200` |
| Role colour `support` `#7c3aed` | 1 | `data.pink` `#DB2777` |
| **Evening slot dot** `bg-purple-500` | 1 | see slot ramp below |
| `.oa-badge-purple` (no callers) | 1 | **delete** |
| `--violet` / `--violet-bg` / `--violet-bd` tokens (no readers) | 3 | **delete** — replaced by real tokens, see §4 |
| ACOTONE MA1 pigment swatch | 1 | **exempt — do not touch** |

### Indigo → out of the brand's way

| Current use | Sites | Goes to |
|---|---|---|
| **Decorative Projects SMU** `#4F46E5` | 3 | **`data.pink` `#DB2777`** |
| `SMU_COLOR = "#c7d2fe"` | 1 | `#FBCFE8` (pink-200) |
| **Late Evening slot dot** `bg-indigo-500` | 1 | see slot ramp below |
| Role colour `admin` `#4338ca` | 1 | `data.slate` `#475569` |
| Cobalt Blue / BU1 pigment swatches | 4 | **exempt — do not touch** |

### Slot dots — become an ordered ramp

Slots are times of day. Time is ordinal, so a single-hue ramp is more correct than five
unrelated colours, and it removes two collisions at once.

| Slot | Colour |
|---|---|
| Morning | `#CBD5E1` slate-300 |
| Midday | `#94A3B8` slate-400 |
| Afternoon | `#64748B` slate-500 |
| Evening | `#475569` slate-600 |
| Late Evening | `#334155` slate-700 |

### Role colours — a legend, admin-only

| Role | Colour |
|---|---|
| admin | `#475569` slate |
| support | `#DB2777` pink |
| picker | `#65A30D` lime |
| floor_supervisor | `#EA580C` orange |
| dispatcher | `#0D9488` teal |

### Untouched — do not open these files for colour reasons

- **Duplicate SO** (`components/shared/duplicate-so-tag.tsx`, 16 constants, 6 importers) — the
  only properly centralised colour set in the codebase. Red here is data, not error. **Leave it.**
- **Delivery-type key** Local / Upcountry / Cross — outside brand and tint. **Leave it.**
- **All pigment swatches.** **Leave them.**
- **Green, amber and red status usage** except where §3 explicitly reassigns a teal or violet.

---

## 4. The token layer — do this first

The discovery found `--violet`, `--red`, `--green`, `--amber`, `--blue` already exist in
`app/globals.css` and **nothing reads them** — `rg 'var\(--(violet|red|green|amber|blue)'`
returns zero. A new `--brand` would inherit the same fate.

So the token layer is not a shortcut around the 579-line edit. It is a **second job**, done at
the same time, so that the next change costs fifteen files instead of a hundred and sixty-three.

**Order of work:**
1. Define the full palette as a Tailwind theme extension — `brand.*`, `n.*`, `tint.*`,
   `success`, `attention`, `urgent`, `data.*` — so they are available as class names
   (`bg-brand-600`, `text-n-500`).
2. Delete the dead `:root` semantic tokens (`--violet`, `--red`, `--green`, `--amber`, `--blue`)
   and the `--navy` family. Repoint the two admin page titles that read `var(--navy)` to `n.900`.
3. Rewrite use sites to the new class names. This is the 579 lines, and it is unavoidable.
4. After it, a future colour change is a config edit.

**Do not** introduce the tokens and leave the use sites hand-typed. That is exactly the state
the app is in now, and it is why this swap costs what it costs.

---

## 5. Rules

1. **One filled brand button per screen** — the commit, in the footer bar.
2. **Brand never means status.** Not done, not waiting, not urgent, not changed.
3. **Selected rows are neutral.** `n.25` fill, `n.200` left bar.
4. **Count pills are `n.900`.** A number is information, not a call to action.
5. **Tint is sky and only sky.** Nothing else in the app may use the sky family.
6. **IGT is teal and only teal.** Nothing else in the app may use the teal family.
7. **Utility buttons are `n.900`** — Import, Download XLS. Tools, not decisions.
8. **Never add a colour without adding a row to this file first.**
9. **On paper, brand appears once** — in the wordmark. Everything else prints black and grey.
10. **Count the brand colour on any screen. Four or five. More than that and one is wrong.**

---

## 6. Open items — need a decision before the swap prompt

| # | Item | Recommendation |
|---|---|---|
| 1 | **Outgoing email** (`lib/mail-orders/email-template.ts`, 6 teal hexes) — rebrand with the app, or leave? | **Rebrand it.** A customer receiving a teal email from a violet company is worse than either alone. But it ships in the same commit and cannot be verified by looking at the app — check it by sending one to yourself. |
| 2 | **Cross delivery type is `#E11D48`**, the same hex as `urgent` | Pre-existing, not caused by this rebrand. **Leave it**, note it for a later pass. |
| 3 | **"Today" in the two attendance views** was teal | Recommend `n.900` ring — a "you are here" marker, not a state. |
| 4 | **`/demo` (`public/order-demo.html`)** carries a third colour system | Out of scope. Retire or rebrand separately. |
| 5 | **Blue/green schemes in `SCHEME_MAP`** (`tint-table-view.tsx:204`) with no call sites found | Leave in place, do not extend. Dead code is not a colour problem. |
| 6 | **Key badge** `bg-blue-500 hover:bg-teal-500` (`customers-table.tsx:335`) | Drift. Make it a neutral chip. |
| 7 | **MRN batch-count and photo-count chips**, teal | Count chips are grey everywhere else. Make them `n.50` / `n.600`. |
| 8 | **Formula-match `×{ratio}`**, teal | Emphasis, not status. `n.900` weight 600. |
| 9 | **Teal ticks** (`photo-capture.tsx`, `ci/spine.tsx`) | `success` — a tick is an affirmative. |
| 10 | **Admin dashboard stat tiles** (teal / violet / emerald, no legend) | Decoration, not data. Make all three `n.900` on `n.50`. |
| 11 | **Photo-count badge borrowing the tint shade** (`photos-button.tsx`) | Accidental collision. Make it `n.50` / `n.600` and delete the comment pointing at `tint-strip.tsx`. |

---

## 7. Size, restated

| | files | lines |
|---|---|---|
| Teal → brand and elsewhere | 163 | 579 |
| Violet → tint and elsewhere | 38 | 103 |
| Indigo → data and slots | 10 | 21 |
| Token layer + `oa-btn-*` removal | ~6 | ~90 |
| **Total** | **~200** | **~790** |

Three multipliers, all structural:

1. **No token exists** — every line is a use site. §4 addresses this.
2. **Fifty-seven teals are not brand** and needed a destination each. §3 now supplies every one.
3. **Three button systems fight over the same elements.** The `!important` must be removed
   before any swap can be verified, or the admin tree silently will not change.

---

## 8. What has not changed from v1

Name, wordmark, logo placement rules, app icon, favicon behaviour, and the login page
specification in `web-update-2026-09-06-orbit-rebrand.md` §1, §3 and §6 all stand.
Only the colour system in that file is superseded.
