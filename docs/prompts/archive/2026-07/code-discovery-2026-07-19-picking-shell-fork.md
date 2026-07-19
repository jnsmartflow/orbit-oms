# Code discovery — Picking mobile shell: shared bar vs. module-native bar
# 2026-07-19 · Read-only discovery, no app code touched · Neutral map, no recommendation

Source of truth is the live code. No disagreement found between the docs
(`CLAUDE_UI.md §59`, `CLAUDE_PICKING.md §5`, the 2026-07-19 `/po` mechanics
discovery file) and the code read for this task — the docs are current.

Files read: `components/shared/mobile-shell.tsx`,
`components/shared/role-layout-client.tsx`,
`components/picking/picking-board-mobile.tsx` (full, 1789 lines),
`app/picking/page.tsx`, `components/shared/role-sidebar.tsx` (for
`ICON_MAP`/`DEFAULT_ICON`).

---

## Step 2 — How it's wired today

### 2.1 Mounting

`components/shared/role-layout-client.tsx` (42 lines, full file read) mounts
`<RoleSidebar>` and `<MobileShell>` as unconditional siblings on every render,
lines 24-40:

```tsx
<div className="min-h-screen bg-white overflow-hidden">
  <RoleSidebar role={role} userName={userName} userInitials={userInitials} navItems={navItems} />
  <MobileShell role={role} navItems={navItems} userName={userName} userInitials={userInitials} />
  <div className="min-h-screen overflow-hidden pb-[76px] md:pb-0 md:ml-[72px] md:max-w-[calc(100vw-72px)]">
    {children}
  </div>
</div>
```

**There is no per-route / per-page conditional today** — no pathname check, no
prop, no feature flag anywhere in this file that could hide or vary
`<MobileShell>`. It receives the same four props (`role`, `navItems`,
`userName`, `userInitials`) regardless of which page rendered it. Stated
plainly per the task brief: none exists.

`app/picking/page.tsx` (lines 118-146) calls `<RoleLayoutClient>` the same way
every other role page does — no picking-specific prop is passed through this
call site either.

### 2.2 What the shell renders

All three pieces live in ONE component, `MobileShell` (`mobile-shell.tsx`,
231 lines, full file read):

**(a) Fixed bottom bar** — lines 80-111. `<nav className="fixed bottom-0
left-0 right-0 z-40 flex bg-white border-t border-gray-200" style={{
paddingBottom: "env(safe-area-inset-bottom)" }}>` (bare `env()`, no `max(...)`
floor — the one place in this file that departs from the `max(env(...),
Npx)` convention `/po` uses everywhere, per the earlier discovery file §5).
Three flex-1 children: **Home** (`<Link href={homeHref}>`, `homeHref =
navItems[0]?.href ?? "/"`, active when `pathname === homeHref`), **Menu**
(`<button onClick={openMenu}>`), **You** (`<button onClick={openYou}>`).
Trigger: tap. z-index: **40**.

**(b) Menu sheet** — lines 122-169. `fixed inset-x-0 bottom-0 z-[60] ...
rounded-t-[22px] ... transition-transform`, slides via
`sheet === "menu" ? "translate-y-0" : "translate-y-full"`. Contents: drag
handle, "All pages" label, a filter `<input>` (`text-[16px]`, iOS zoom
guard), then `filteredNavItems.map(...)` rendering each `NavItemConfig` as a
`<Link>` row using `ICON_MAP[item.pageKey] ?? DEFAULT_ICON` for its icon and
`pathname === item.href || pathname.startsWith(item.href + "/")` for the
active highlight (`bg-teal-50 text-teal-700 ... border-l-teal-600`). Trigger:
tap the grid/Menu button in (a). z-index: **60**.

**(c) You sheet** — lines 171-199. Same `fixed inset-x-0 bottom-0 z-[60]`
shape, driven by `sheet === "you"`. Contents: teal avatar with
`userInitials`, `userName`, `formatRoleLabel(role)`, a divider, then a red
"Sign out" row (`onClick={openSignoutConfirm}`) which does NOT sign out
directly — it closes this sheet and opens a separate confirm dialog. Trigger:
tap the avatar/You button in (a). z-index: **60**.

**Sign-out confirm dialog** — lines 201-228, a fourth piece, opened only from
inside (c): `fixed left-6 right-6 top-1/2 z-[70] -translate-y-1/2 ...`, driven
by `confirmOpen`. Cancel returns to `closeAll()`; Sign out calls
`signOut({ callbackUrl: "/login" })` directly (`next-auth/react`).

**Scrim** — lines 113-120, `fixed inset-0 z-50 bg-black/40`, visible whenever
`sheetOpen = sheet !== null || confirmOpen`, `onClick={closeAll}` (clears
both `sheet` and `confirmOpen` in one call).

**Full z-index stack, mobile-shell.tsx only:**
```
nav (bottom bar)          z-40
scrim                     z-50
Menu sheet / You sheet    z-[60]
sign-out confirm dialog   z-[70]
```

### 2.3 Separability — the key question

**Not cleanly separable as built today.** All four pieces above ((a) bottom
bar, (b) Menu sheet, (c) You sheet, the confirm dialog, plus the scrim) are
defined inside the single `MobileShell` function component and share its
local closure state: `sheet` (`SheetKind = "menu" | "you" | null`, line 46),
`confirmOpen` (line 47), `filter` (line 48). The functions that open (b) and
(c) — `openMenu()` (lines 59-62) and `openYou()` (lines 64-66) — are plain
closures over `setSheet`; they are not exported, not exposed via context, not
attached to a ref, and not reachable through any prop `MobileShell` accepts.
The `<button>` elements that call them (lines 95-102, 103-110) are textually
inside the SAME JSX block as the bottom bar (a).

Concretely: nothing outside `mobile-shell.tsx` can open the Menu or You sheet
today. A component rendered elsewhere in the tree — including inside
Picking's own header, wherever it lives in the DOM — has no handle to call
`openMenu()`/`openYou()` on the `MobileShell` instance that's already
mounted by `RoleLayoutClient`.

What IS separable, in principle, without touching `mobile-shell.tsx`: nothing
— the coupling is total. To let some other trigger (e.g., a grid icon in
Picking's own header) open the SAME sheet instances, `mobile-shell.tsx`
itself would need one of:
- its `sheet`/`confirmOpen` state lifted out of the component and exposed via
  a new context/provider that any descendant could read/write, or
- an imperative-open API surfaced via a ref or exported hook, or
- the bottom-bar JSX and the sheet JSX split into two separately-exported
  pieces that still share the lifted state above.

None of these exist today. This is true regardless of which path (A or B,
below) is taken — it is a property of the current file, not of either
redesign approach.

### 2.4 Picking's dependence on the shell

Every place `picking-board-mobile.tsx` (1789 lines, full file read) assumes
the shared bar exists, with line refs:

| What | Lines | Value / detail |
|---|---|---|
| Import of `MOBILE_NAV_CLEARANCE` | 7 | `import { MOBILE_NAV_CLEARANCE } from "@/components/shared/mobile-shell";` |
| `SHEET_GEOMETRY` constant, composed from it | 325-330 | `bottomOffset: MOBILE_NAV_CLEARANCE`; `scrimZ: "z-[65]"`, `panelZ: "z-[75]"` — chosen (comment 320-324) specifically to clear mobile-shell's *entire* stack (40→50→60→70), not just the nav bar alone |
| `FilterBottomSheet` (route filter, picker filter, checked-picker filter) | 1356-1367, 1369-1380, 1382-1395 | all three read `SHEET_GEOMETRY` |
| Assign-to-picker sheet | 1735-1785 | reads `SHEET_GEOMETRY.scrimZ` (1738), `.panelZ`/`.maxHeight` (1745), `.bottomOffset` (1746) |
| Detail-screen "Assign to picker" CTA | 1624-1637 | `paddingBottom: MOBILE_NAV_CLEARANCE` (1627) — comment explicitly says this used to be pinned at just `max(safe-area, 14px)` and rendered *behind* the fixed nav before the fix |
| Detail-screen "Undo" CTA | 1647-1661 | same, line 1650 |
| Detail-screen "Approve" CTA | 1668-1687 | same, line 1671 |
| Detail screen's own z-index | 1401-1406 | `fixed inset-0 z-[35]` — deliberately BELOW mobile-shell's nav (z-40), so the shared nav bar stays visibly painted on top of the open detail screen; the detail screen's own bottom CTAs then have to clear that same nav via `MOBILE_NAV_CLEARANCE` above |
| Scroll body bottom clearance | 1038 | `pb-[76px]` — hardcoded **literal**, NOT an import of `MOBILE_NAV_CLEARANCE`. Comment (1034-1037) calls it "the same 76px convention," but unlike every other consumer in this file, it does **not** add `env(safe-area-inset-bottom)` on top — a small inconsistency with the constant's own stated purpose (worth flagging, not fixed here) |
| Floating "N selected → Assign" bar | 1693-1697 | `bottom: "calc(76px + env(safe-area-inset-bottom, 0px) + 12px)"` — a hand-written **fourth** copy of the "76px + safe-area" figure. Comment (1690-1692) references `components/shared/mobile-shell.tsx` in prose ("just above the fixed mobile shell (76px, per ...)") but does not import the constant — the exact hand-copy pattern `MOBILE_NAV_CLEARANCE`'s own top-of-file comment (mobile-shell.tsx lines 12-24) was written to prevent, recurring a fourth time in this same file |

Net: Picking currently has **4 distinct places** encoding "how much room the
shared nav needs" — one correct import (`SHEET_GEOMETRY`/detail CTAs, 4 call
sites), and two ad-hoc hand-copies (`pb-[76px]` at line 1038, the floating
bar's `calc(76px + ...)` at line 1696) that reference the same real-world
fact without reading the single source.

### 2.5 Picking's current header + tabs

Both live inline inside `PickingBoardMobile`'s own top-level return, **not**
extracted to a separate file/component:

- **Teal header block** — lines 997-1032. `flex-shrink-0 bg-teal-600 ...`,
  containing the "Picking" title (1002), a search-toggle icon button
  (1003-1010), and the three workflow tabs (1012-1031) rendered via
  `TopBarTab` — title bar + tab strip are ONE combined block, at the TOP of
  the page, not the bottom.
- **`TopBarTab`** — lines 221-252, a small standalone function component
  (`label`, `count`, `active`, `onClick` props; label+count are plain text,
  no pill container; a bottom underline bar signals active). It is
  self-contained and position-agnostic (no hardcoded top/bottom assumption in
  its own markup), but it is defined and only ever imported from within
  `picking-board-mobile.tsx` — no other file can use it without a new shared
  module or a copy-paste.
- `activeTab` state (`"assign" | "check" | "checked"`, line 423) and the tab
  count values (`waitingRows.length` / `assignedRows.length +
  doneRows.length` / `checkedRows.length`, lines 1015, 1021, 1027) are all
  local to `PickingBoardMobile` — the tab STRIP is self-contained
  (`TopBarTab`), but the tab BAR (which tabs exist, in what order, with what
  counts) is not extracted at all; it's inline JSX, three calls in a row.

---

## Step 3 — The two paths (neutral — no recommendation)

### PATH A — Picking renders its own bottom bar; shared shell hidden on `/picking`

**Mechanism (one paragraph):** `role-layout-client.tsx` would need a new way
to suppress rendering `<MobileShell>` for this one route. Two real hooks the
code already supports the *shape* of, though neither exists today: (1) a new
optional boolean prop (e.g. `hideMobileShell`) threaded from
`app/picking/page.tsx`'s existing `<RoleLayoutClient role=... navItems=...>`
call (page.tsx lines 119-124 already pass four props; a fifth is the same
shape of change), or (2) a `usePathname()` check directly inside
`RoleLayoutClient` itself (already a client component; `mobile-shell.tsx`
already imports `usePathname` for its own active-link logic) — no prop
threading needed, but it makes a shared, role-agnostic/route-agnostic layout
component aware of one specific route's identity, which nothing in the
current codebase does. Picking would then render its own bottom bar (its
existing `TopBarTab` strip, relocated from the top header to the bottom) and
its own header triggers for whatever replaces Menu/You.

**Exact files touched:**
- `components/shared/role-layout-client.tsx` — add the hide condition (either shape above).
- `app/picking/page.tsx` — thread the new prop, if going the prop route (no change needed if going the pathname-check route).
- `components/picking/picking-board-mobile.tsx` — move the `TopBarTab` strip from the top header to a new bottom bar block; every one of the §2.4 clearance consumers (`SHEET_GEOMETRY.bottomOffset`, the 3 detail-CTA paddings, the `pb-[76px]` scroll body, the floating assign bar's `calc(...)`) needs re-deriving against Picking's OWN new bar height instead of the shared nav's 76px, since that shared nav no longer exists on this route.
- Per the §2.3 separability finding: reaching the Menu/You sheets from Picking's own header additionally requires touching `components/shared/mobile-shell.tsx` anyway (to lift/export its sheet-open triggers) — UNLESS Picking instead re-mounts its own duplicate copy of the Menu/You sheet markup + `ICON_MAP` wiring (new code in `picking-board-mobile.tsx`, diverging from single-source), or ships without a working Menu/You equivalent as a known gap to close later.

**What must Picking then render itself, and can it reuse (b)/(c)?** It must
render the workflow bottom bar itself (already has the building block:
`TopBarTab`) plus header avatar/grid triggers. Per §2.3, it CANNOT reuse the
shell's actual Menu/You sheet instances without a `mobile-shell.tsx` refactor
— those sheets are welded to `MobileShell`'s own closure state, not
independently invocable. "Hide the shared bar" does not, by itself, solve
"how does a Picking user still reach Menu/You" — that is a second, separate
piece of work under this path, not automatic.

**What breaks:** `MOBILE_NAV_CLEARANCE` becomes semantically wrong for this
route (there is no shared 76px nav to clear here anymore) — all ~7 current
call sites in `picking-board-mobile.tsx` (§2.4 table) need a NEW
Picking-specific clearance constant sized to whatever bar Picking builds,
and every one of those sites edited to read it instead. `SHEET_GEOMETRY`'s
`z-[65]`/`z-[75]` rationale ("clear mobile-shell's full stack") becomes moot
on this specific route (no mobile-shell layers ever open here if the shell
is fully hidden) — not actively wrong, just solving a problem that no longer
applies here, so it's simplifiable rather than broken.

**Risk note:** touches `role-layout-client.tsx`, a component every
role-shelled page depends on (`CLAUDE_UI.md §59` confirms it's live on
`/trips` and `/place-order` today, with unspecified "future adopters" — no
full grep of every `RoleLayoutClient` call site was done for this task, so
the total blast radius of even a Picking-scoped conditional is not fully
enumerated here). A loosely-written hide condition (e.g. an over-broad
pathname prefix match) risks hiding the shell on an unintended route. There
is also a real risk of shipping a state where Picking's own header shows
grid/avatar icons that don't do anything yet, if the Menu/You reachability
gap isn't closed in the same pass.

### PATH B — Shared shell becomes per-module (bottom bar varies by page) for all

**Mechanism (one paragraph):** `mobile-shell.tsx`'s fixed `<nav>` (currently
a hardcoded 3-button Home/Menu/You render, lines 80-111) would need to accept
per-module tab content — e.g. an optional `tabs?: WorkflowTab[]` prop that,
when present, overrides the default 3-button render with the caller's own
tab set, falling back to today's Home/Menu/You when absent. This mirrors how
`navItems` is already computed server-side per-role (`buildNavItems()` in
`app/picking/page.tsx` lines 38-41) and threaded down as a prop through
`RoleLayoutClient` — the same shape of "each page supplies its own data,
shell just renders it" already exists for the Menu sheet's page list; Path B
extends that pattern to the bottom bar itself.

**Every page/file affected:** `MobileShell` (`mobile-shell.tsx`, the `<nav>`
render branch, lines 80-111) needs a real code change to branch on the new
prop. `RoleLayoutClient` (lines 31-36, the `<MobileShell>` call site) needs
to accept and forward the new prop. Every page that currently renders
through `RoleLayoutClient` and wants to KEEP today's default Home/Menu/You
bar must be unaffected — per `CLAUDE_UI.md §59` that's confirmed live on at
least `/trips` and `/place-order`; the full list of current
`RoleLayoutClient` consumers was not enumerated in the files read for this
task (flagged as unverified, not solved here — a grep across `app/**` for
`<RoleLayoutClient` would be needed to scope this precisely before
committing to this path).

**Blast radius on pages NOT being redesigned:** must be zero by construction
— the new prop needs a default (no prop = current 3-button behaviour)
so every existing consumer is pixel-identical unless it explicitly opts in.
This is categorically wider than Path A: Path A's changed files are ones
only Picking's own session would touch (plus one shared file for the hide
switch); Path B's core change is to the shared component itself, so its
correctness bar is "every existing consumer, verified unchanged" rather than
"one route, verified correct."

**What breaks or needs re-verify:** `MOBILE_NAV_CLEARANCE`'s current
assumption — a single fixed ~76px height, true for every page — stops being
uniformly true the moment ANY module supplies a custom (differently-sized)
tab bar. The constant would either need to become page-aware (computed per
module) or every future module's custom bar would need to be constrained to
match Picking's height so the one constant stays valid app-wide. Either way,
every existing `MOBILE_NAV_CLEARANCE` consumer today (Picking's own §2.4
list, and potentially other pages not surveyed here) needs re-verification
once shell height can vary by route — a standing, ongoing constraint on
every future module adopting a custom bar, not a one-time migration cost.

---

## Step 4 — Reusability note

`TopBarTab` (`picking-board-mobile.tsx` lines 221-252) is already a small,
generic, prop-driven building block — `label`/`count`/`active`/`onClick`,
nothing Picking-specific baked into its own markup. What blocks turning it
into a fully reusable "workflow bottom bar" piece today is NOT the component
itself:

1. **Not in its own module.** It's defined and only imported inside
   `picking-board-mobile.tsx` — no other file can use it without either
   extracting it to a shared location or copy-pasting it.
2. **Currently used as a TOP-bar strip, not a bottom bar.** Its usage sites
   (lines 1012-1031) sit inside the teal header at the top of the page. The
   component itself doesn't assume top/bottom placement, but relocating "the
   reusable workflow bar" to the bottom (to sit where `mobile-shell.tsx`'s
   own nav sits today) is a change to where it's CALLED, not to the
   component.
3. **No wrapper for an arbitrary tab SET.** `activeTab` state and the three
   hardcoded tab definitions (Assign/Check/Checked with their count
   expressions) live directly in `PickingBoardMobile`. `TopBarTab` is the
   right shape for a SINGLE tab; what's missing for genuine reuse is a
   wrapping component taking `tabs: {key, label, count}[]` + `activeKey` +
   `onChange`, so a future module could supply its own 3 (or N) tabs without
   touching `TopBarTab` itself.
4. **Styled for a teal background.** Today's white-label-on-teal /
   opacity-based active-inactive treatment assumes it's sitting on the
   current teal top bar. A bottom bar sitting on `mobile-shell.tsx`'s current
   white `<nav>` background (or any other module's background) would need a
   restyled variant — not a structural blocker, just a visual one.

**Net:** `TopBarTab` itself needs no logic changes to become shared — moving
it to a common file is a pure extraction. A wrapping multi-tab bar component
and a background-appropriate style variant are both new, small, and
additive — nothing structural in the current code blocks either. Whether
that generic piece plugs into Path A (Picking's own standalone bar) or
Path B (the shared shell's per-module tab slot) is unaffected by this —
the extraction is useful either way.
