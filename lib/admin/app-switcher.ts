import { PAGE_NAV_MAP, type NavItemConfig } from "@/lib/permissions";

// ── The admin app switcher ────────────────────────────────────────────────────
//
// Once the operational items left the admin menu (0fc145bb, 2026-09-06), an
// admin had no link out of the admin frame at all — browser Back was the only
// way into the rest of OrbitOMS. This is that link.
//
// 🔴 THE LIST IS CURATED BY KEY, AND IT MUST NOT BE PERMISSION-FILTERED.
// Every resolver in lib/permissions.ts short-circuits a superuser to ALL_TRUE
// on all 27 page keys, so filtering this on canView would pass 22 of the 24
// PAGE_NAV_MAP rows and drag Tinting, Tint Operator and Shade Master straight
// back into the admin shell — the exact thing the 2026-08-28 redesign removed.
// A filter here would also be silently fragile: the switcher would shrink
// without anybody noticing. Nine keys, fixed, in this order.
//
// 🔴 LABEL AND HREF ARE READ FROM PAGE_NAV_MAP, NEVER HARDCODED.
// The app must call a place one name everywhere. The map says "Floor", not
// "Floor Control", and "Billing", not "Mail Orders" — the 2026-08-28 mockup
// draws the other wording and the map wins. If a label or an address is ever
// wrong, PAGE_NAV_MAP is the single place to fix it.
//
// ⚠ THREE OF THE NINE ARE NOT SPELLED THE WAY THEY ARE USUALLY SAID:
//   "Billing"      is the pageKey `mail_orders`
//   "Import OBDs"  is the pageKey `import_obd`   (href /import)
//   "Reports"      is the pageKey `ti_report`    (the Reports hub reuses it)
// A page key and a label can share a word, and here three of them nearly do.
//
// ⚠ SERVER-ONLY. This imports PAGE_NAV_MAP, whose module pulls in prisma and
// auth. Call it from a layout and pass the result down as a prop; do not import
// it from a "use client" component. The icon is resolved on the client from
// ICON_MAP (components/shared/role-sidebar.tsx) — a React component cannot
// cross the server/client prop boundary.

/** The nine destinations, in display order. Curated — not derived from grants. */
export const APP_SWITCHER_KEYS = [
  "floor",
  "picking",
  "tint_manager",
  "mail_orders",
  "import_obd",
  "ti_report",
  "mrn",
  "ci",
  "trip_report",
] as const;

/**
 * The nine switcher rows, resolved against PAGE_NAV_MAP and returned in
 * APP_SWITCHER_KEYS order.
 *
 * A key with no row in the map is dropped rather than faked — the switcher
 * shows eight entries instead of one that 404s. That cannot happen today (all
 * nine were verified present on 2026-09-06) and would mean somebody removed a
 * row from PAGE_NAV_MAP, which is a much larger change than this file.
 */
export function appSwitcherItems(): NavItemConfig[] {
  return APP_SWITCHER_KEYS
    .map((key) => PAGE_NAV_MAP.find((item) => item.pageKey === key))
    .filter((item): item is NavItemConfig => item !== undefined);
}
