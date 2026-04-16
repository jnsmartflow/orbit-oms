# Sidebar Hover-to-Expand — Claude Code Prompt

Read CLAUDE_CONTEXT_v61.md and CLAUDE_UI_v5.md fully before starting.

## WHAT WE'RE DOING

Changing sidebar from click-to-toggle to hover-to-expand. The sidebar should always be collapsed (72px, icons only). When user hovers over it, it expands to 220px as an OVERLAY (page content does NOT shift). When mouse leaves, it collapses back. No click needed.

## ARCHITECTURE DECISION

All sidebar code lives in 3 shared files inside `components/shared/`:
- `role-sidebar-provider.tsx` — state management (context)
- `role-sidebar.tsx` — the sidebar UI component
- `role-layout-client.tsx` — wrapper that places sidebar + page content

These are shared across ALL route layouts (mail-orders, planning, tint, etc). Change once here = works everywhere.

## FILES TO MODIFY (3 files only)

### Step 1 — `components/shared/role-sidebar-provider.tsx`

Replace the entire file with this logic:

```tsx
"use client";

import { createContext, useContext, useState, useRef, useCallback } from "react";

interface RoleSidebarContextValue {
  isExpanded: boolean;
  expand: () => void;
  collapse: () => void;
}

const RoleSidebarContext = createContext<RoleSidebarContextValue>({
  isExpanded: false,
  expand: () => {},
  collapse: () => {},
});

export function RoleSidebarProvider({ children }: { children: React.ReactNode }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const expand = useCallback(() => {
    // Cancel any pending collapse
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
    setIsExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    // Small delay (150ms) to prevent flicker when mouse briefly leaves and re-enters
    collapseTimer.current = setTimeout(() => {
      setIsExpanded(false);
      collapseTimer.current = null;
    }, 150);
  }, []);

  return (
    <RoleSidebarContext.Provider value={{ isExpanded, expand, collapse }}>
      {children}
    </RoleSidebarContext.Provider>
  );
}

export function useRoleSidebar() {
  return useContext(RoleSidebarContext);
}
```

Key changes:
- Removed `isCollapsed` and `toggle()` — replaced with `isExpanded`, `expand()`, `collapse()`
- Removed localStorage persistence — sidebar always starts collapsed
- Removed `useEffect` — no hydration needed
- Added 150ms collapse delay via `useRef` timer — prevents flicker
- `expand()` cancels any pending collapse timer

**After this step:** Run `npx tsc --noEmit`. You will get errors in `role-sidebar.tsx` and `role-layout-client.tsx` because they still reference `isCollapsed` and `toggle`. That's expected — we fix those next.

---

### Step 2 — `components/shared/role-sidebar.tsx`

Make these changes to the existing file:

**2a.** Change the context hook destructure. Find:
```tsx
const { isCollapsed, toggle } = useRoleSidebar();
```
Replace with:
```tsx
const { isExpanded, expand, collapse } = useRoleSidebar();
```

**2b.** Add `onMouseEnter` and `onMouseLeave` to the `<aside>` element. Find the `<aside` opening tag:
```tsx
<aside
  className="hidden md:flex md:fixed md:inset-y-0 md:left-0 md:z-50 flex-col bg-white shadow-sm transition-all duration-200"
  style={{
    width:       isCollapsed ? "72px" : "220px",
    borderLeft:  "3px solid #0d9488",
    borderRight: "1px solid #e5e7eb",
  }}
>
```
Replace with:
```tsx
<aside
  onMouseEnter={expand}
  onMouseLeave={collapse}
  className="hidden md:flex md:fixed md:inset-y-0 md:left-0 md:z-50 flex-col bg-white transition-all duration-200"
  style={{
    width:       isExpanded ? "220px" : "72px",
    borderLeft:  "3px solid #0d9488",
    borderRight: "1px solid #e5e7eb",
    boxShadow:   isExpanded ? "4px 0 16px rgba(0,0,0,0.06)" : "none",
  }}
>
```

Note: removed `shadow-sm` from className (shadow now controlled by `isExpanded` in style). Added subtle overlay shadow when expanded.

**2c.** Replace the brand block's Orbit logo button. Find:
```tsx
<button
  onClick={toggle}
  className="w-9 h-9 bg-teal-600 rounded-xl flex items-center justify-center text-white font-extrabold text-[14px] cursor-pointer hover:bg-teal-700 transition-colors flex-shrink-0"
  title={isCollapsed ? "Expand menu" : "Collapse menu"}
>
```
Replace with:
```tsx
<div
  className="w-9 h-9 bg-teal-600 rounded-xl flex items-center justify-center text-white font-extrabold text-[14px] hover:bg-teal-700 transition-colors flex-shrink-0"
>
```
And change the closing `</button>` to `</div>`.

The logo is no longer a button — it's just a visual element. No click handler needed.

**2d.** Replace all `isCollapsed` references with `!isExpanded`. There should be several spots:

Find each `isCollapsed` and replace:
- `isCollapsed ? "justify-center px-0 h-[52px]" : "gap-2.5 px-4 h-[52px]"` → `!isExpanded ? "justify-center px-0 h-[52px]" : "gap-2.5 px-4 h-[52px]"`
- `{!isCollapsed && (` → `{isExpanded && (` (for brand text block)
- `{isCollapsed ? collapsedNav : expandedNav}` → `{!isExpanded ? collapsedNav : expandedNav}`
- In the user block: `isCollapsed ? "flex justify-center py-3" : "flex items-center gap-2.5 px-4 py-3"` → `!isExpanded ? "flex justify-center py-3" : "flex items-center gap-2.5 px-4 py-3"`
- `{!isCollapsed && (` → `{isExpanded && (` (for user info block)

**After this step:** Run `npx tsc --noEmit`. Only `role-layout-client.tsx` should have errors now.

---

### Step 3 — `components/shared/role-layout-client.tsx`

Replace the entire file with:

```tsx
"use client";

import { RoleSidebar } from "./role-sidebar";
import type { RoleSidebarRole } from "./role-sidebar";
import type { NavItemConfig } from "@/lib/permissions";

interface RoleLayoutClientProps {
  role:         RoleSidebarRole;
  userName:     string;
  userInitials: string;
  navItems:     NavItemConfig[];
  children:     React.ReactNode;
}

export function RoleLayoutClient({
  role,
  userName,
  userInitials,
  navItems,
  children,
}: RoleLayoutClientProps) {
  return (
    <div className="min-h-screen bg-white overflow-hidden">
      <RoleSidebar
        role={role}
        userName={userName}
        userInitials={userInitials}
        navItems={navItems}
      />
      <div
        className="min-h-screen overflow-hidden"
        style={{
          marginLeft: "72px",
          maxWidth:   "calc(100vw - 72px)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
```

Key changes:
- Removed `useRoleSidebar` import — no longer reads sidebar state
- Main content area is ALWAYS at `marginLeft: 72px` — sidebar expands as overlay on top
- Removed `transition-all duration-200` from main content div — it never moves now

**After this step:** Run `npx tsc --noEmit`. Should be zero errors.

---

### Step 4 — Verify and test

1. Run `npx tsc --noEmit` — must be zero errors
2. `git add . && git commit -m "sidebar: hover-to-expand, always collapsed by default" && git push`
3. Test on deployed URL:
   - Sidebar starts collapsed (icons only)
   - Hover → expands smoothly with labels
   - Mouse away → collapses back after ~150ms
   - Active nav item highlighted in both states
   - Clicking a nav link navigates normally
   - Page content never shifts
   - Works on all pages (mail orders, tint manager, etc.)

---

## WHAT NOT TO CHANGE

- No visual changes — same colors, widths, nav items, icons, fonts
- No changes to any layout.tsx files — they just wrap RoleSidebarProvider + RoleLayoutClient
- No changes to role-nav.tsx — it's a separate top bar component
- No changes to globals.css
- No new files or libraries

## EDGE CASES ALREADY HANDLED

- **Flicker prevention:** 150ms collapse delay + cancel-on-reenter in provider
- **Dropdown/submenu hover:** onMouseEnter/onMouseLeave is on the `<aside>` container — any child element (dropdown, submenu) inside it keeps the sidebar expanded because the mouse is still inside
- **Mobile:** Sidebar is `hidden md:flex` — not visible on mobile at all, so no touch conflict
