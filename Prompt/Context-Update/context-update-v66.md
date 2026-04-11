# Context Update v66

## MODIFIED FILES

- `components/shared/role-sidebar-provider.tsx` — Context provider: `isExpanded`/`expand()`/`collapse()` replace `isCollapsed`/`toggle()`. 150ms collapse delay via useRef timer. No localStorage persistence.
- `components/shared/role-sidebar.tsx` — Sidebar uses `onMouseEnter={expand}` / `onMouseLeave={collapse}` on `<aside>`. Orbit logo is a `<div>` (not clickable button). Overlay shadow (`4px 0 16px rgba(0,0,0,0.06)`) when expanded.
- `components/shared/role-layout-client.tsx` — Main content locked at `marginLeft: 72px` / `maxWidth: calc(100vw - 72px)`. No longer reads sidebar state. Sidebar expands as overlay, page never shifts.

## BUSINESS RULES ADDED

**Sidebar behavior:** Always collapsed (72px, icons only) by default. Hover expands to 220px as overlay. Mouse leave collapses after 150ms delay (flicker prevention). No click toggle. No localStorage persistence. Works across all route layouts via shared components.

**Sidebar state API:** `useRoleSidebar()` returns `{ isExpanded, expand, collapse }`. Old API (`isCollapsed`, `toggle`) is removed.

**Layout rule:** Main content area always has fixed `marginLeft: 72px`. Sidebar expands on top of content (overlay pattern), never pushes content sideways.

## CHECKLIST UPDATES

- **Sidebar state:** `useRoleSidebar()` returns `{ isExpanded, expand, collapse }`. No `isCollapsed` or `toggle()`.
- **Sidebar is overlay:** Main content always at `marginLeft: 72px`. Sidebar floats over content when expanded.
- **No localStorage for sidebar:** State resets every page load (always starts collapsed).
