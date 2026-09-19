# web-update-2026-09-06 — Orbit rebrand: name, logo, colour system

**Type:** decision record (web session). Not yet implemented.
**Status:** decisions locked, code not touched.
**Next:** discovery prompt → swap prompt → consolidate into CLAUDE_UI.md.

---

## 1. Decisions locked

| Item | Decision |
|---|---|
| Product name | **Orbit** (sentence case). Not orbit, not ORBIT, not OrbitOMS. |
| Logo | **Wordmark only.** No symbol, no monogram, no letter. |
| Old orbit mark | **Deleted** — ring + centre dot + satellite SVG comes out of the codebase entirely. |
| Brand colour | Violet. `#7C3AED` primary. |
| Tagline | *Taking efficiency into new orbit* |
| Login tagline | Replaces the current "One system. Zero chaos." — **one tagline only across the product.** |
| App icon | Word "Orbit" white on the violet tile. |
| Domain / repo / DB | **Unchanged.** orbitoms.in, repo name, table names all stay. Display-name change only. |

### Why wordmark only
Ten rounds of symbol exploration produced nothing worth keeping. A weak symbol is worse than none. The name is short, sayable and already half-live (the mobile header says "Orbit" today). The wordmark can be upgraded later without being replaced.

---

## 2. Colour tokens

### Brand — violet

| Token | Hex | Used for, and only for |
|---|---|---|
| `brand.50` | `#F5F3FF` | Active nav item background |
| `brand.100` | `#EDE9FE` | — |
| `brand.200` | `#DDD6FE` | Borders on brand-tinted elements; tagline text on the dark panel |
| `brand.300` | `#C4B5FD` | Login panel arcs |
| `brand.400` | `#A78BFA` | Login accent bar; login corner light |
| `brand.500` | `#8B5CF6` | Input focus border |
| `brand.600` | `#7C3AED` | **Commit button. Active tab underline. Focus ring. Phone theme colour.** |
| `brand.700` | `#6D28D9` | Commit hover; **all tappable text** (Open, View, Change, History) |
| `brand.800` | `#5B21B6` | Wordmark on white; active nav label |
| `brand.900` | `#43168B` | Login panel background only |

### Neutral — violet-tinted grey (replaces plain grey)

| Token | Hex | Used for |
|---|---|---|
| `n.0` | `#FFFFFF` | Cards, panels, table rows, rail |
| `n.25` | `#FAFAFC` | Page background, selected row, group header, footer bar |
| `n.50` | `#F4F3F8` | Neutral chips, code pills, progress tracks, disabled fill |
| `n.100` | `#E9E7F0` | Every border and divider |
| `n.200` | `#D6D3E0` | Selected-row left bar |
| `n.400` | `#9C99AC` | Column headers, timestamps, placeholders |
| `n.500` | `#74718A` | Secondary lines — route, volume, customer code |
| `n.600` | `#514E63` | Secondary button text |
| `n.700` | `#3A3748` | Body text, table cells; utility button hover |
| `n.900` | `#1B1826` | Headings, customer names, OBD numbers, **utility button**, count pills, avatars |

### Status — fixed meanings, never brand

| Token | Hex | Background | Text | Means |
|---|---|---|---|---|
| `success` | `#059669` | `#ECFDF5` | `#047857` | Done, ready, matched, present, punched |
| `attention` | `#D97706` | `#FFFBEB` | `#B45309` | Changed ship-to, notes, split, on hold, unknown SKU |
| `urgent` | `#E11D48` | `#FFF1F2` | `#BE123C` | Urgent flag, errors, cancelled |
| `info` | `#0284C7` | `#F0F9FF` | `#0369A1` | In transit, informational banners |
| `favourite` | `#F59E0B` | — | — | The star only |
| `waiting` | — | `#F4F3F8` | `#74718A` | Not started — deliberately colourless |

### Data — areas and categories, never reassigned

| Token | Hex | Assigned to |
|---|---|---|
| `data.teal` | `#0D9488` | IGT — unchanged |
| `data.cyan` | `#0891B2` | Decorative Projects — **moved here from `#4F46E5`** (too close to violet) |
| `data.lime` | `#65A30D` | free |
| `data.orange` | `#EA580C` | free |
| `data.pink` | `#DB2777` | free |
| `data.slate` | `#475569` | free |

---

## 3. Logo usage

| Placement | What appears |
|---|---|
| Sidebar rail | The word **Orbit**, `brand.800`. Rail widens to ~158px with labelled nav (see §7). |
| Mobile header | The word **Orbit**, white. Already live — the mark beside it comes out. |
| Login page | **Orbit** in white on the violet panel, tagline beneath. |
| App icon (192/512) | **Orbit** white on the violet tile. |
| Favicon 32 / 64 | **Orbit** white on the violet tile. |
| Favicon 16 | Plain violet tile, no text. |
| Print / challan | **Orbit** in flat `#7C3AED` or black. No gradient, no tile. |
| Anywhere else | Nothing. There is no symbol. |

**App icon tile:** `radial-gradient(125% 125% at 26% 20%, #A78BFA 0%, #7C3AED 44%, #581C87 100%)`
Hot spot inset from the corner so it survives Android's circular crop. Flat `#7C3AED` version required for print.

---

## 4. Button system — seven kinds, no more

| Kind | Fill | Text | Border | Where |
|---|---|---|---|---|
| **Commit** | `brand.600` | white | — | The action that finishes the job. **One per screen**, in the footer bar. Release, Punch, Mark done, Close MRN, Send order, Sign in. Hover `brand.700`. |
| **Utility** | `n.900` | white | — | A tool, not a decision. Import, Download XLS, New MRN. Hover `n.700`. |
| **Secondary** | white | `n.600` | `n.100` | Everything in a toolbar. Urgent, Hold, Slot, Notes, Copy, Reports, Photos, Print, Filter. Hover fill `n.25`. |
| **Text** | — | `brand.700` | — | Opens or reveals. Open, History, Change, View lines. Most of the app's violet lives here. |
| **Card action** | white | `brand.700` | `n.100` | The action on a repeated card in a list (Floor decision cards). **Never filled** — a queue of 13 would become a wall of violet. |
| **Destructive** | white | `#BE123C` | `#FECDD3` | The trigger. Solid `urgent` **only** inside a confirm dialog. |
| **Disabled** | `n.50` | `n.400` | — | Commit button until its condition is met (e.g. Punch before an order number is typed). |

---

## 5. Component colour map

| Element | Colour |
|---|---|
| Rail background | white, right border `n.100` |
| Nav item | text `n.500`, icon `n.400` |
| Nav item, active | fill `brand.50`, text `brand.800`, 2px left bar `brand.600` |
| Page title | `n.900` |
| Tab, active | text `n.900`, 2px underline `brand.600` |
| Count pill, primary | `n.900` fill, white text |
| Count pill, secondary | `n.50` fill, `n.500` text |
| Table header | text `n.400`, bottom border `n.100` |
| Table row | white, divider `n.50`, hover `n.25` |
| Row, selected | fill `n.25`, 3px left bar `n.200` — **never brand** |
| OBD number | `n.900`, monospace, weight 700 |
| Group header row | fill `n.25`, text `n.700` |
| Footer bar | fill `n.25`, top border `n.100`, commit button right |
| Input | border `n.100` |
| Input, focused | border `brand.500`, ring `rgba(139,92,246,.13)` |
| Input, error | border `urgent`, ring `rgba(225,29,72,.11)` |
| Notes band | fill `attention.bg`, 3px left bar `attention`, text `attention.text` |
| Ship-to changed | `attention` chip beside the name |
| Line toggle, on | `success` |
| User avatar | `n.900` fill, white initials; done state `success` |
| Area dot | `data.*` family only |
| Live indicator | 6px `success` dot + `n.500` text |
| Mobile status bar | `brand.600` on home screen, white on every inner screen |
| Mobile bottom nav, active | `n.900` — not brand |
| Print / challan | wordmark `brand.600` or black; everything else black and neutral, no fills |

### The counting rule
Any screen should have **four or five violet things on it**. If there are more, one of them is wrong.

---

## 6. Login page

Split layout. Brand panel left (flex 1.15–1.3), form right.

| Item | Value |
|---|---|
| Panel background | `#43168B` + `radial-gradient(78% 96% at 100% 100%, rgba(216,205,255,.62) 0%, rgba(167,139,250,.34) 32%, rgba(124,58,237,.16) 58%, rgba(67,22,139,0) 82%)` |
| Corner light | **In CSS on the panel element, not inside the SVG.** An SVG gradient is trapped in its viewBox and gets sliced — this caused a visible hard edge. |
| SVG alignment | `preserveAspectRatio="xMaxYMax slice"`, viewBox `0 0 700 512` |
| Ring centre | `cx=700 cy=512` — the panel's own bottom-right corner |
| Ring radii | 150 / 262 / 388 / 524 / 668 / 820 — the largest must clear the far corner (~780 needed) |
| Ring guides | `#EDE9FE` at opacity .20 / .17 / .145 / .12 / .095 / .07, 1px |
| Travelling arcs | gradient strokes fading at both ends, dasharray ~30% of circumference |
| Ring speeds | 30s, 52s, 78s, 94s, 122s, 150s. Rings 1/3/5 clockwise, 2/4/6 against |
| Wordmark | 60px, weight 700, tracking −0.046em, white, rises in 0.85s |
| Accent bar | 48×3px `brand.400`, draws from zero width at 0.5s |
| Tagline | 24px, weight 600, `brand.200`, last word white. `white-space: nowrap`. Steps to 20px then 17px |
| Greeting | Time-aware — Good morning / afternoon / evening, with the date |
| Sign in | Commit button, full width; becomes a spinner on click |
| Wrong password | Short shake + `urgent` border on the field |
| Not on this page | No version number, no depot name, no supplier name, **no live figures** (the page is public) |

---

## 7. What changes in the code

1. **Teal is removed as a brand colour** — `#0D9488`, `#0F766E`, `#14B8A6`, `#F0FDFA` no longer appear as brand. `#0D9488` survives **only** as the IGT area dot.
2. **The orbit mark SVG is deleted** from sidebar, mobile header, icon generator, favicon, apple-touch.
3. **The sidebar rail widens** from ~60px icon-only to ~158px with text labels, so the wordmark fits. Costs ~90px of table width on Floor and Billing. If that hurts, the rail collapses on click and shows nothing when collapsed.
4. **`themeColor` in `app/layout.tsx`** changes from `#0d9488` to `#7C3AED`.
5. **Icon generator** (`generate-icons.mjs`) regenerates from the wordmark, not the symbol.
6. **Buttons are re-typed** into the seven kinds above. This is the largest change and the one that will make the app look different.
7. **Selected rows and count pills lose their colour** — both neutral now.
8. **Notes band and changed badge move to amber.** They were violet, which is now the brand.
9. **Greys shift to the violet-tinted scale.**
10. **Login page is rebuilt** to the spec in §6.

---

## 8. Landmines

- **`#0D9488` is both the old brand colour and the IGT area dot.** A find-and-replace on the hex will silently recolour data. Every occurrence must be classified before it is changed.
- **`#4F46E5` is the Decorative Projects dot**, not a brand colour, and it is close enough to violet to start reading as one. It moves to `#0891B2`.
- **Violet `#7C3AED` is already in use** as the notes / tint strip colour and the "changed" badge. Those move to amber — otherwise brand and exception look identical.
- **Three greens are load-bearing** and must not move: all-shades-ready strip, Billing line toggles, Tint all-clear tick.
- **The amber family is load-bearing**: favourite star, split warning, Split button.
- **No radial gradients on any surface that changes size.** They only behave at one aspect ratio. The app icon is exempt because a tile is always square.
- **Any glow belongs to the element, not to an SVG inside it.** If a shape can be clipped by a box, it will be.
- **The wordmark must be exported once as an SVG with letters converted to shapes.** Live text renders differently on the depot PC, Android and iPhone. Until that file exists, the logo is not really a logo.

---

## 9. Still open

- Whether to move `success` from `#16A34A` to emerald `#059669` and `urgent` from `#DC2626` to rose `#E11D48`. Both harmonise better with violet; both are optional. **Decision pending.**
- Place Order (`/po`) is being redesigned separately and is out of scope for this pass.
- Whether the rail collapses, and on what trigger.
- Which four routes (if any) appear anywhere in the product as examples.

---

## 10. Not yet done

- [ ] Discovery — inventory every colour in the codebase and classify brand vs data vs status
- [ ] Wordmark exported as SVG with outlined letters
- [ ] Swap implementation
- [ ] Icon regeneration
- [ ] Consolidate into `CLAUDE_UI.md` (design system, logo mark, brand rules sections) and bump the UI version
