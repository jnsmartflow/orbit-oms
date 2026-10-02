import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getAccessSource } from "@/lib/access/source";
import { accessNotebook, notebookOn } from "@/lib/access/notebook-store";
import type { RolePermRow } from "@/lib/access/notebook";
import type { RolloutStage } from "@/auth.config";

// ── Nav config ─────────────────────────────────────────────────────────────────

export interface NavItemConfig {
  pageKey: string;
  label:   string;
  href:    string;
}

export interface NavUserFlags {
  attendanceTestUser?: boolean;
  rolloutStage?:       RolloutStage;
}

// Exported 2026-09-06 so the admin app switcher can read a label and an href
// off it instead of hardcoding either (lib/admin/app-switcher.ts). EXPORT ONLY —
// no row, no order and no comment below has changed. ⚠ This module imports
// prisma and auth, so it is SERVER-ONLY: resolve nav rows in a layout and pass
// them down as props, exactly as buildNavItems already is. Never import it from
// a "use client" file.
export const PAGE_NAV_MAP: NavItemConfig[] = [
  // 2026-07-27 — Support retired (steps 3-5/8), replaced by Floor Control (/floor).
  // Both of its page keys, "support_queue" (→ /support) and "operations_support"
  // (→ /operations/support), are gone from this file entirely: the nav entries
  // here, the PageKey union, and ALL_PAGE_KEYS. Their seed grants are gone from
  // prisma/seed.ts, and the dead ICON_MAP + admin-Permissions rows went with them
  // (components/shared/role-sidebar.tsx, components/admin/permissions-manager.tsx).
  // The screens and API routes live at archive/2026-07-support/ — see the README
  // there for what was retired, what replaced it, and what is still in the DB.
  { pageKey: "operations_tinting",       label: "Tinting",       href: "/operations/tinting" },
  { pageKey: "operations_tint_operator", label: "Tint Operator", href: "/operations/tint-operator" },
  // "operations_dispatch" (→ /operations/dispatch) and "operations_warehouse"
  // (→ /operations/warehouse) removed 2026-07-27: both were alternate mounts of
  // the Planning and Warehouse boards and are archived at
  // archive/2026-07-operations-pages/. The boards themselves stay live at
  // /planning and /warehouse (their own retirement is a separate, later step).
  { pageKey: "picking",       label: "Picking",       href: "/picking" },
  { pageKey: "floor",         label: "Floor",         href: "/floor" },
  { pageKey: "import_obd",    label: "Import OBDs",   href: "/import" },
  // "planning_board" (→ /planning) and "dispatcher" (→ /dispatcher) removed
  // 2026-07-28: both archived to archive/2026-07-planning-board/. The Planning
  // board filtered workflowStage 'dispatch_confirmation' (live count 0) and its
  // showDispatched branch was never set by any client, so it always rendered
  // empty. /dispatcher was a 4-line stub redirecting into it. ⚠ The dispatcher
  // ROLE and its four master-data pages (/dispatcher/customers, /skus, /routes,
  // /vehicles) are UNAFFECTED — they gate on their own page keys.
  { pageKey: "tint_manager",   label: "Tint Manager",    href: "/tint/manager" },
  { pageKey: "tint_operator", label: "Tint Operator",  href: "/tint/operator" },
  // "warehouse" (→ /warehouse) removed 2026-07-28: the board was archived to
  // archive/2026-07-warehouse-board/. It filtered on workflowStage
  // 'dispatch_confirmation', which nothing in this codebase ever writes, so it
  // always rendered empty. No successor — Picking and Floor were built on a
  // different track. ⚠ app/api/warehouse/pickers/route.ts was NOT archived: it
  // is called by the live Picking boards. Never archive app/api/warehouse/ whole.
  { pageKey: "customers",     label: "Customers",      href: "/admin/customers" },
  { pageKey: "skus",          label: "SKUs",           href: "/admin/skus" },
  { pageKey: "routes_areas",  label: "Routes",         href: "/admin/routes" },
  { pageKey: "vehicles",      label: "Vehicles",        href: "/admin/vehicles" },
  { pageKey: "trip_report",   label: "Trip Report",     href: "/trips" },
  { pageKey: "place_order",        label: "Purchase Order (PO)", href: "/place-order" },
  { pageKey: "mail_orders",        label: "Billing",       href: "/mail-orders" },
  // MRN — Material Receipt Note (2026-08-20). Inbound goods receipt; one route,
  // two faces branching by ROLE (billing desktop / floor_supervisor phone).
  //
  // ⚠ THIS POSITION IS BEHAVIOUR, NOT COSMETICS. MobileShell's phone Home
  // target is navItems[0]?.href (components/shared/mobile-shell.tsx), and
  // buildNavItems below preserves this array's order — so an entry becomes
  // Home for any role whose first GRANTED entry it displaces.
  //
  // Sitting here after mail_orders, it displaces nobody. Verified 2026-08-20
  // by computing navItems[0] against the LIVE grants: billing_operator
  // place_order, floor_supervisor picking, operations operations_tinting —
  // all three unchanged.
  //
  // The role actually at risk is ONE, not three: billing_operator, whose
  // first granted entry (place_order) sits at index 12, so any insertion
  // BEFORE that would take its Home button. floor_supervisor and operations
  // are insensitive — picking and operations_tinting already sit at indices 2
  // and 0. Re-derive it against the grants, never from this comment, before
  // moving this line.
  { pageKey: "mrn",                label: "MRN",           href: "/mrn" },
  // CI — Goods Return Note (2026-09-01). Stock coming BACK from a customer; the
  // return counterpart to MRN directly above. One route, two faces branching by
  // ROLE (floor_supervisor phone / billing desk), same as MRN.
  //
  // ⚠ THIS POSITION IS BEHAVIOUR, NOT COSMETICS — the same warning MRN's line
  // carries, for the same reason. MobileShell's phone Home target is
  // navItems[0]?.href (components/shared/mobile-shell.tsx) and buildNavItems
  // preserves this array's order, so an entry becomes Home for any role whose
  // first GRANTED entry it displaces.
  //
  // Sitting here after mrn, it displaces nobody. VERIFIED 2026-09-01 by deriving
  // navItems[0] against the LIVE grants, before and after this line:
  //   floor_supervisor  /picking            (idx 2,  picking)            unchanged
  //   billing_operator  /place-order        (idx 12, place_order)        unchanged
  //   operations        /operations/tinting (idx 0,  operations_tinting) unchanged
  // Re-derive that comparison before moving this line; do not trust this comment.
  { pageKey: "ci",                 label: "CI",            href: "/ci" },
  // Freight Trips (2026-10-02) — the report-only paper-trip layer over held
  // bills. Placed AFTER ci, so it displaces nobody's navItems[0] (MobileShell's
  // Home): at this commit NO user holds freight_trips, so the derived Home is
  // unchanged for every person. Re-derive against the grants before moving it.
  { pageKey: "freight_trips",      label: "Freight Trips", href: "/freight-trips" },
  { pageKey: "delivery_challans",  label: "Delivery Challans", href: "/tint/manager/challan" },
  { pageKey: "shade_master",       label: "Shade Master",      href: "/tint/manager/shades" },
  { pageKey: "sampling_library",   label: "Sampling Library",  href: "/tint/sampling-library" },
  // "Reports" hub (/reports) — holds Tint Summary + TI Report under one rail.
  // ⚠ Since 2026-09-17 the `ti_report` pageKey here is only this row's IDENTITY
  // (ICON_MAP, the admin app switcher and the layouts' dedupe all find the row by
  // it). It no longer decides visibility: buildNavItems shows this row when the
  // person holds canView on ANY of REPORT_PAGE_KEYS. The `ti_report` tick itself
  // gates nothing.
  { pageKey: "ti_report",          label: "Reports",           href: "/reports" },
  { pageKey: "attendance",         label: "Attendance",        href: "/attendance" },
  { pageKey: "attendance_admin",   label: "Attendance",        href: "/admin/attendance" },
  // NOTE: no "settings_hide" entry here — the Hide page is admin-only and lives
  // in the dedicated admin sidebar (components/admin/admin-sidebar.tsx). The
  // "settings_hide" PageKey stays in ALL_PAGE_KEYS so that sidebar's gating
  // (allPerms["settings_hide"]) resolves to ALL_TRUE for admin.
];

// Per-role href overrides: non-admin roles access shared pages via their own route group
const ROLE_HREF_OVERRIDES: Record<string, Record<string, string>> = {
  // The "support" overrides (→ /support/customers, /support/skus, /support/routes,
  // /support/vehicles) were removed 2026-07-27, Support retirement step 4/8: those
  // four pages were archived with the board (archive/2026-07-support/). The role
  // now falls through to the default admin hrefs, which render the same data —
  // /admin/customers uses the richer split view, the other three the same tables.
  tint_manager: {
    customers:    "/tint/manager/customers",
    skus:         "/tint/manager/skus",
    routes_areas: "/tint/manager/routes",
    vehicles:     "/tint/manager/vehicles",
  },
  dispatcher: {
    customers:    "/dispatcher/customers",
    skus:         "/dispatcher/skus",
    routes_areas: "/dispatcher/routes",
    vehicles:     "/dispatcher/vehicles",
  },
  operation_manager: {
    customers:    "/tint/manager/customers",
    skus:         "/tint/manager/skus",
    routes_areas: "/tint/manager/routes",
    vehicles:     "/tint/manager/vehicles",
  },
};

// ── Reports — one tick per report ─────────────────────────────────────────────
//
// 🔴 THE ONE LIST OF REPORT KEYS (2026-09-17). The hub (app/reports/page.tsx),
// the sidebar "Reports" row (buildNavItems below) and the Tint Manager header
// pill all read it, so a new report is registered HERE and nowhere else.
// canView OR canExport on a key = may see that report in the hub (2026-10-01;
// was canView only — Trip Detail is granted export-only to some people).
// Holding ANY of them opens the hub; holding none shuts it. There is no separate hub-door tick — the old
// `ti_report` key gates nothing any more (kept, relabelled, retirement later).
export const REPORT_PAGE_KEYS = [
  "reports_tint_summary",
  "reports_ti_report",
  "reports_trip_detail",
] as const satisfies readonly PageKey[];

/** The PAGE_NAV_MAP row that links to the Reports hub. Its identity only. */
const REPORTS_NAV_PAGE_KEY = "ti_report";

/** Is this report listed for this person — canView OR canExport on its key. */
export function holdsReportTick(
  allPerms: Record<string, PagePermissions>,
  key: (typeof REPORT_PAGE_KEYS)[number],
): boolean {
  return allPerms[key]?.canView === true || allPerms[key]?.canExport === true;
}

/** May this person open the Reports hub at all — any report tick, by the
 *  holdsReportTick rule. ⚠ Name kept for its three callers; since 2026-10-01
 *  it also counts an export-only tick, so the sidebar row and the Tint Manager
 *  pill appear for an export-only Trip Detail holder. */
export function canViewAnyReport(allPerms: Record<string, PagePermissions>): boolean {
  return REPORT_PAGE_KEYS.some((k) => holdsReportTick(allPerms, k));
}

export function buildNavItems(
  allPerms:   Record<string, PagePermissions>,
  roleSlug?:  string,
  userFlags?: NavUserFlags,
): NavItemConfig[] {
  const overrides = roleSlug ? (ROLE_HREF_OVERRIDES[roleSlug] ?? {}) : {};
  return PAGE_NAV_MAP
    .filter((item) => {
      // The attendance nav item is gated on user-level flags + rollout stage,
      // not on role_permissions (no row exists for "attendance" — visibility
      // is intentionally per-user). Admin always sees it for self-test.
      if (item.pageKey === "attendance") {
        if (roleSlug === "admin") return true;
        // ops_admin reaches the user-facing /attendance flow via the gate
        // redirect, not the sidebar — they get /admin/attendance via the
        // separate attendance_admin pageKey. Suppress this entry to avoid a
        // duplicate "Attendance" nav item.
        if (roleSlug === "ops_admin") return false;
        return (
          (userFlags?.attendanceTestUser ?? false) ||
          userFlags?.rolloutStage === "ALL_USERS"
        );
      }
      // Reports: one row for the hub, shown for ANY report tick (REPORT_PAGE_KEYS).
      if (item.pageKey === REPORTS_NAV_PAGE_KEY) return canViewAnyReport(allPerms);
      return allPerms[item.pageKey]?.canView === true;
    })
    .map((item) =>
      overrides[item.pageKey] !== undefined
        ? { ...item, href: overrides[item.pageKey] }
        : item,
    );
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type PageKey =
  | "operations_tinting"
  | "operations_tint_operator"
  | "picking"
  | "floor"
  | "dashboard"
  | "users"
  | "system_config"
  | "permissions"
  | "customers"
  | "skus"
  | "routes_areas"
  | "vehicles"
  | "import_obd"
  | "tint_manager"
  // The three TABS of the Tint Manager job panel (2026-09-17), one tick each so
  // an admin can grant any combination: Items · Details · Activity.
  //
  // 🔴 canView IS THE ONLY MEANING: "may see that tab". All three are read-only
  // tabs, so they are deliberately NOT in ACTION_PAGES — canView is available on
  // every key and Import / Export / Edit / Delete dash on /admin/access.
  //
  // Read once in app/(tint)/tint/manager/layout.tsx and couriered by
  // TintManagerAccessProvider. Server side: tint_panel_details gates
  // /api/orders/[id]/audit-history; tint_panel_activity gates the pause-history
  // and skip-history routes. tint_panel_items has no route of its own — the
  // Items tab reads the board payload, so hiding it is UI-only.
  //
  // ⚠ NOT a replacement for `tint_manager`, which still decides whether the
  // screen opens at all. ⚠ Deliberately NOT in PAGE_NAV_MAP or ICON_MAP (tabs,
  // not routes). Absent row ≡ false: sql/2026-09-17-tint-panel-tabs.sql grants
  // the people who saw the tabs before this change.
  | "tint_panel_items"
  | "tint_panel_details"
  | "tint_panel_activity"
  // The seven Tint Manager ACTION ticks (2026-10-01, tabs build step 2 —
  // docs/prompts/drafts/code-discovery-2026-10-01-tint-manager-build-plan.md §B).
  // One key per button, the billing_* pattern: a write needs `tint_manager`
  // canEdit AND the action key's canEdit (lib/tint/manager-bill.ts
  // checkTintAction). Set and clear share one key (hold + release = tint_hold;
  // cancel / stop & cancel / restore / Remove OBD = tint_cancel), so nobody can
  // create a state they cannot undo. canView on tint_hold / tint_ci /
  // tint_cancel / tint_pick_delete = see that TAB; on the other three it gates
  // nothing (isActionAvailable's known limit).
  //
  // ⚠ They scope the TINT MANAGER face only, and the routes behind them accept
  // tint bills only (tintBillRefusal). Floor sets the same facts on `floor`.
  // ⚠ Deliberately NOT in PAGE_NAV_MAP or ICON_MAP (controls, not routes).
  // Grants are user_page_access data (Smart Flow SQL), never seed.
  | "tint_hold"
  | "tint_hand"
  | "tint_slot"
  | "tint_ship_to"
  | "tint_cancel"
  | "tint_ci"
  | "tint_pick_delete"
  // tint_shop_delivery — "Shop delivery" in the Tint Manager bottom bar's More
  // menu (2026-10-01, owner): every selected bill's ship-to becomes its own
  // BILL-TO dealer (app/api/tint/manager/shop-delivery). canEdit is its only
  // meaning, on top of tint_manager canEdit. INDEPENDENT of tint_ship_to, which
  // keeps the single-bill Change ship-to in the detail panel. Tint Manager
  // only — Floor and Billing have no such action.
  | "tint_shop_delivery"
  // tint_urgent — bulk "⚡ Urgent" / "Clear urgent" in the Tint Manager bottom
  // bar (2026-10-02, owner): Floor's mark-urgent (priorityLevel 1 ↔ 3) on tint
  // and Base bills through app/api/tint/manager/actions. canEdit is its only
  // meaning, on top of tint_manager canEdit.
  | "tint_urgent"
  // tint_ti_bulk — the TI tab's bulk white-shot buttons (WHT 5 / 20 / 25) on the
  // Tint Manager (2026-10-02, owner): app/api/tint/manager/ti-bulk. canEdit is
  // its only meaning, on top of tint_manager canEdit; the route still applies
  // the manager-only TI arm (placeholder-owned, tinting_done, not removed).
  | "tint_ti_bulk"
  | "tint_operator"
  | "place_order"
  // place_order_ship_to — the Ship To block in the DESKTOP /place-order cart
  // panel (2026-09-17). canEdit is its only meaning: "may set a ship-to on the
  // order". Read once in app/(place-order)/layout.tsx. No grants by default, so
  // only admin / superuser (all-true over ALL_PAGE_KEYS) see the block.
  // ⚠ DESKTOP ONLY — /po is public and keeps its own Ship-to, untouched.
  // ⚠ Deliberately NOT in PAGE_NAV_MAP (a control, not a route). It IS in
  // ACTION_PAGES.canEdit, or /admin/access could not grant it.
  | "place_order_ship_to"
  | "trip_report"
  | "mail_orders"
  // billing_picking — the BILLING Picking tab (bills checked on the floor and
  // waiting to be invoiced), 2026-09-11. ⚠ NOT the floor board's `picking` key,
  // which is two lines up in ALL_PAGE_KEYS and belongs to /picking: 24 people
  // hold that one and nothing here may touch it. A page key and a route can
  // share a word.
  //
  // ⚠ REGISTERED ONLY — NOTHING READS IT YET. The tab still gates on
  // `mail_orders` at every one of its sites (the tab bar and body mounts in
  // review-view.tsx, and the five /api/billing/picking/* routes). This key
  // exists so /admin/access can show a row and Smart Flow can grant people
  // BEFORE the gates are repointed, which is the order that avoids anybody
  // losing the tab for a page load.
  //
  // ⚠ DELIBERATELY NOT IN PAGE_NAV_MAP and NOT IN ICON_MAP. It is a TAB inside
  // /mail-orders, not a route, so there is nothing for a sidebar entry to link
  // to. (If it ever becomes its own route, its position in PAGE_NAV_MAP is
  // behaviour, not cosmetics — see the `mrn` entry's warning.)
  | "billing_picking"
  // billing_print — the BILLING Print tab (slice 9, 2026-09-15): trips the
  // planner sent to billing, whose invoice numbers billing copies into SAP.
  // canView = see the tab; canEdit = the Copy that records itself. Read by the
  // three /api/billing/print/* routes and the mail-orders layout. Like
  // billing_picking it is a TAB inside /mail-orders, so it is deliberately not
  // in PAGE_NAV_MAP or ICON_MAP.
  | "billing_print"
  // billing_telephonic — the BILLING Telephonic tab (2026-09-22): SO numbers
  // billing tags Hold or CI for telephonic orders (so_tags), which the import
  // applies when the OBD lands (lib/billing/telephonic-apply.ts). canView = see
  // the tab (list + marker); canEdit = add / remove a tag. Read by the four
  // /api/billing/telephonic/* routes. A TAB inside /mail-orders like
  // billing_picking, so deliberately NOT in PAGE_NAV_MAP or ICON_MAP. The 40
  // all-false user_page_access rows were written by
  // sql/2026-09-22-billing-telephonic.sql.
  | "billing_telephonic"
  // billing_pick_delete — the BILLING Pick delete tab (2026-09-27): same-SO
  // groups billing decides on — All OK, or cancel one bill as a duplicate
  // (pick_delete_decisions, Schema v27.42). canView = see the pill + tab (list,
  // marker, bill lines); canEdit = All OK / Pick delete / Undo. A TAB inside
  // /mail-orders like billing_telephonic, so deliberately NOT in PAGE_NAV_MAP
  // or ICON_MAP. Grants are user_page_access data (build step 9), never seed.
  | "billing_pick_delete"
  // The four dispatch DECISIONS on the Billing face's Orders tab — Hold, Slot,
  // Urgent and the ✎ ship-to pencil (2026-09-11). One key per button, because
  // the owner wants to grant Slot without granting Hold.
  //
  // 🔴 canEdit IS THE ONLY MEANING: "may use that button". canView on these four
  // rows gates NOTHING and cannot be dashed — see ACTION_PAGES below.
  //
  // Read by POST /api/billing/mail-order/actions (one key per action name, on
  // top of `mail_orders` canEdit) and by the mail-orders layout, which hides a
  // button whose tick is off (BillingActionsAccessProvider).
  //
  // ⚠ These scope the BILLING face only. Floor reaches all four facts through
  // its own routes on the `floor` key and is untouched — see
  // docs/prompts/drafts/code-discovery-2026-09-11-billing-action-ticks.md §A.2.
  | "billing_hold"
  | "billing_slot"
  | "billing_urgent"
  | "billing_ship_to"
  // Hand and CI (2026-09-24, design web-update-2026-09-24-billing-mo-actions.md
  // §8) — the bottom bar's two new marks, one key each for the same reason.
  // Hand = the dealer collects; CI = bill-only (full-bill CI + cancel at import).
  // Same canEdit-only meaning as the four above. ⚠ user_page_access rows for
  // these two are a Smart Flow SQL job — until they exist /admin/access shows
  // its "page rows missing" banner for them.
  | "billing_hand"
  | "billing_ci"
  | "mrn"
  // CI — Goods Return Note (2026-09-01). Live `role_permissions` rows exist for
  // billing_operator / floor_supervisor / operations, and prisma/seed.ts carries
  // them, so the key is real — the API routes gate on it today.
  // ⚠ DELIBERATELY NOT IN PAGE_NAV_MAP YET. There is no /ci page until step 5;
  // a nav entry now would put a sidebar link in front of three roles that 404s.
  // It joins the nav in step 6, and its POSITION there is behaviour, not
  // cosmetics — see the PAGE_NAV_MAP comment above `mrn`.
  | "ci"
  // Freight Trips (2026-10-02) — the report-only "paper trip" layer over HELD
  // bills (lib/freight-trips, app/api/freight-trips). canView = read the pool,
  // trips and options; canEdit = create / edit / add-remove bills / cancel.
  // ⚠ NOT `floor`: freight routes gate on this key ONLY. Granted per user
  // (user_page_access rows, Smart Flow SQL), never seed.
  // In PAGE_NAV_MAP (→ /freight-trips, after ci), ACCESS_SECTIONS "Operations"
  // and ICON_MAP since the screen shipped (step 7, 2026-10-02).
  | "freight_trips"
  | "delivery_challans"
  | "shade_master"
  | "sampling_library"
  | "ti_report"
  // One tick per REPORT inside the /reports hub (2026-09-17). canView = may see
  // that report; holding ANY of them opens the hub and shows the sidebar row
  // (REPORT_PAGE_KEYS / canViewAnyReport, above buildNavItems).
  // reports_ti_report also answers canExport = the Download Excel button, which
  // is UI-only: the rows are already in the browser when the button is drawn.
  // ⚠ Deliberately NOT in PAGE_NAV_MAP or ICON_MAP — reports, not routes.
  // ⚠ `ti_report` just above gates NOTHING since this change; kept, relabelled.
  | "reports_tint_summary"
  | "reports_ti_report"
  // reports_trip_detail (2026-10-01) — the Trip Detail .xlsx (every bill on a
  // Floor trip). canExport gates GET /api/reports/trip-detail; canView is the
  // hub/rail visibility like its two siblings.
  | "reports_trip_detail"
  | "attendance"
  | "attendance_admin"
  | "settings_hide";

export type ActionKey =
  | "canView"
  | "canImport"
  | "canExport"
  | "canEdit"
  | "canDelete";

export interface PagePermissions {
  canView:   boolean;
  canImport: boolean;
  canExport: boolean;
  canEdit:   boolean;
  canDelete: boolean;
}

const ALL_TRUE: PagePermissions = {
  canView:   true,
  canImport: true,
  canExport: true,
  canEdit:   true,
  canDelete: true,
};

const ALL_FALSE: PagePermissions = {
  canView:   false,
  canImport: false,
  canExport: false,
  canEdit:   false,
  canDelete: false,
};

const ALL_PAGE_KEYS: PageKey[] = [
  "attendance", "attendance_admin",
  "operations_tinting", "operations_tint_operator",
  "picking", "floor",
  "dashboard", "users", "system_config", "permissions",
  "customers", "skus", "routes_areas", "vehicles",
  "import_obd", "tint_manager",
  // The three Tint Manager panel TABS sit beside their host screen.
  "tint_panel_items", "tint_panel_details", "tint_panel_activity",
  // The seven Tint Manager action ticks (2026-10-01), beside their host screen,
  // then Shop delivery (2026-10-01, owner — added after the seven).
  "tint_hold", "tint_hand", "tint_slot", "tint_ship_to", "tint_cancel", "tint_ci", "tint_pick_delete",
  "tint_shop_delivery",
  // Urgent (2026-10-02, owner).
  "tint_urgent",
  // Bulk TI (2026-10-02, owner).
  "tint_ti_bulk",
  "tint_operator",
  // ⚠ `billing_picking` (the Billing Picking TAB) sits beside `mail_orders`,
  // its host screen. It is NOT `picking` on the line above — that is the floor
  // board. Keep them visually apart in this list, never adjacent.
  "place_order", "place_order_ship_to", "trip_report", "mail_orders", "billing_picking", "billing_print",
  "billing_telephonic", "billing_pick_delete", "mrn", "ci", "freight_trips",
  // The six Billing action ticks, kept together and next to their host screen
  // for the same reason `billing_picking` is — they are controls INSIDE
  // /mail-orders, not routes of their own.
  "billing_hold", "billing_slot", "billing_urgent", "billing_ship_to",
  "billing_hand", "billing_ci",
  "delivery_challans", "shade_master", "sampling_library", "ti_report",
  // The per-report ticks, beside the legacy hub key they replace.
  "reports_tint_summary", "reports_ti_report", "reports_trip_detail",
  "settings_hide",
];

// ── Which actions the code actually ASKS about, per page ──────────────────────
//
// 🔴 WHAT THIS IS FOR, AND WHAT IT MUST NEVER DO.
// The /admin/access screen greys a cell to a DASH where the app has no such
// check for that page — so an admin cannot switch on a flag that gates nothing.
// That already happened without it: eight canExport grants are true in the
// database right now and not one of them does anything.
//
// ⚠ THIS MAP IS ADVISORY AND COSMETIC. Every user_page_access row still stores
// all five booleans, and every read and write handles all five. The map only
// decides whether a cell renders as a checkbox or a dash. A stale entry here
// must therefore degrade to "the screen showed a dash it should not have" —
// never to a value being dropped, skipped or overwritten. NEVER use it to
// filter what is read, saved, compared, or seeded.
//
// SOURCE: docs/prompts/drafts/code-discovery-2026-08-30-permission-actions.md
// §2 (per-flag call-site census) and §5 (Export and Delete, settled). Verified
// by call site, not by intent: canExport and canDelete are each read in exactly
// ONE module (MRN), and canImport in two helper call sites plus the CSV buttons
// on the four master-data screens.
//
// 🔴 UPDATE THIS WHENEVER A NEW ACTION CHECK IS ADDED ANYWHERE. If you write a
// new `checkPermission(..., "<key>", "<action>")` or `checkAnyPermission(...)`,
// or start reading a flag off a PagePermissions object to gate a control, and
// the (key, action) pair is not listed below, ADD IT — otherwise /admin/access
// shows a dash for a switch that now does something, and nobody can turn it on.
// The reverse is just as true: if a check is deleted, remove its entry.

/** Actions that are NOT asked on every page, and the pages that do ask them. */
const ACTION_PAGES: Record<Exclude<ActionKey, "canView">, readonly PageKey[]> = {
  // 38 live call sites — every write route on Floor / MRN / Picking /
  // Sampling / Tint / master data (§2.2).
  canEdit: [
    "mrn", "picking", "tint_manager", "tint_operator", "mail_orders", "floor",
    "sampling_library", "routes_areas", "customers", "skus", "vehicles",
    // billing_picking — listed AHEAD of its own call sites, on purpose, and it
    // is the one entry in this map that is not yet backed by a check. Mark done
    // (api/billing/picking/mark-done:58) and Undo (undo:49) gate on canEdit
    // today, against `mail_orders`; they move to this key once the gates are
    // repointed. Without the entry /admin/access draws a DASH, and a dash is a
    // switch nobody can turn on — which would make it impossible to grant the
    // Edit half before the repoint, i.e. impossible to do the repoint safely.
    "billing_picking",
    // billing_print (slice 9) — Copy on the Print tab records the copy; gated on
    // canEdit in api/billing/print/trip/[id]/copy. Backed by that check from day one.
    "billing_print",
    // billing_telephonic (2026-09-22) — Add and Remove a tag gate on canEdit
    // (api/billing/telephonic/add, /remove). Backed from day one.
    "billing_telephonic",
    // billing_pick_delete (2026-09-27) — All OK / Pick delete / Undo gate on
    // canEdit (api/billing/pick-delete/*, build step 5). Listed ahead of its
    // call sites, as billing_picking was, so /admin/access can grant it.
    "billing_pick_delete",
    // The six Billing action ticks (2026-09-11; Hand + CI 2026-09-24). `canEdit`
    // is the ONE question the app asks of these keys — POST
    // /api/billing/mail-order/actions checks it per action name, on top of
    // `mail_orders` canEdit. Without an entry here /admin/access draws a dash on
    // the Edit cell — a switch nobody can turn on.
    "billing_hold", "billing_slot", "billing_urgent", "billing_ship_to",
    "billing_hand", "billing_ci",
    // place_order_ship_to (2026-09-17) — backed from day one: the desktop
    // /place-order layout reads its canEdit to draw the Ship To block. Without
    // this entry the Edit cell on /admin/access is a dash, i.e. ungrantable.
    "place_order_ship_to",
    // The seven Tint Manager action ticks (2026-10-01, tabs build step 2).
    // canEdit is checked per action by lib/tint/manager-bill.ts checkTintAction,
    // on top of tint_manager canEdit — the billing_* pattern. Listed with their
    // first call sites (app/api/tint/manager/actions, ship-to, ship-to-search,
    // orders/[id]/remove); the rest land in steps 3-8 of the same build.
    "tint_hold", "tint_hand", "tint_slot", "tint_ship_to", "tint_cancel", "tint_ci", "tint_pick_delete",
    // Shop delivery (2026-10-01) — app/api/tint/manager/shop-delivery.
    "tint_shop_delivery",
    // Urgent (2026-10-02) — app/api/tint/manager/actions mark-urgent.
    "tint_urgent",
    // Bulk TI (2026-10-02) — app/api/tint/manager/ti-bulk.
    "tint_ti_bulk",
    // Freight Trips (2026-10-02) — every write under app/api/freight-trips gates
    // on freight_trips canEdit (create, PATCH, bills add/remove, cancel).
    "freight_trips",
  ],
  // Two helper call sites — import/obd:3796 and sampling-library:253 — plus the
  // CSV import buttons on the four master-data screens, which read canImport
  // off PagePermissions to show or hide themselves (§2.1 direct field reads).
  canImport: [
    "import_obd", "sampling_library",
    "customers", "skus", "routes_areas", "vehicles",
  ],
  // MRN: api/mrn/[mrnId]/export:58 and mrn/[mrnId]/sheet/page:41. Plus
  // reports_ti_report (see its entry).
  // ⚠ The attendance CSV export does NOT read canExport — it is a hardcoded
  // admin role check (§5), so attendance_admin gets a dash here even though
  // ops_admin holds canExport = true live. The dash is telling the truth.
  // reports_ti_report (2026-09-17): the TI Report Download Excel button, read in
  // app/reports/page.tsx and passed to TIReportContent. UI-only (the XLSX is
  // built in the browser from rows already fetched).
  // reports_trip_detail (2026-10-01): api/reports/trip-detail gates on canExport.
  canExport: ["mrn", "reports_ti_report", "reports_trip_detail"],
  // MRN ONLY: api/mrn/[mrnId]/delete:53. Every other delete path uses a role
  // check instead (§5).
  canDelete: ["mrn"],
};

const ACTION_PAGE_SETS = {
  canEdit:   new Set<string>(ACTION_PAGES.canEdit),
  canImport: new Set<string>(ACTION_PAGES.canImport),
  canExport: new Set<string>(ACTION_PAGES.canExport),
  canDelete: new Set<string>(ACTION_PAGES.canDelete),
} as const;

/**
 * Does the app ask this question for this page? `canView` is asked on every
 * page (75 call sites); the other four only where ACTION_PAGES lists them.
 * Advisory only — see the block above.
 *
 * ⚠ KNOWN LIMIT, hit by the four billing action ticks (2026-09-11) and left
 * alone deliberately. `canView` returns true unconditionally, so a key whose
 * ONLY meaningful flag is canEdit still draws a View checkbox on /admin/access,
 * and that checkbox gates nothing. Import / Export / Delete dash correctly,
 * because they come from ACTION_PAGES. Giving canView a per-key exclusion list
 * would mean teaching this map to filter a fifth flag — and its own header
 * forbids using it to filter anything, precisely because a stale entry would
 * then hide a real switch. Four inert View boxes is the cheaper mistake.
 */
export function isActionAvailable(pageKey: string, action: ActionKey): boolean {
  if (action === "canView") return true;
  return ACTION_PAGE_SETS[action].has(pageKey);
}

// ── Display metadata for the /admin/access screen ─────────────────────────────
//
// Friendly names come from PAGE_NAV_MAP wherever the key appears there. THIRTY-ONE
// of the 54 ALL_PAGE_KEYS are not in it and are labelled here instead: dashboard,
// users, system_config, permissions, settings_hide, billing_picking,
// billing_print, billing_telephonic, billing_pick_delete, the six billing action ticks, place_order_ship_to, the three
// Tint Manager panel tabs, the ten Tint Manager action ticks, and the two older report ticks.
// (⚠ reports_trip_detail, added 2026-10-01, has no label here yet and falls
// through to its raw key — recorded, not fixed in the tint ticks commit.)
// (`ti_report` IS in PAGE_NAV_MAP as "Reports", but is overridden here because
// since 2026-09-17 its tick gates nothing — see its label below.)
// (`attendance` IS in PAGE_NAV_MAP — but it and `attendance_admin` both carry
// the label "Attendance" there, which is fine in a sidebar where only one is
// ever shown and useless in a list where both appear, so both are overridden.)

const PAGE_LABEL_OVERRIDES: Record<string, string> = {
  dashboard:        "Dashboard",
  users:            "Users",
  system_config:    "System Config",
  permissions:      "Permissions (role grid)",
  settings_hide:    "Hide Rules",
  // 🔴 THE LABEL IS THE ONLY THING STOPPING A MIS-GRANT ON /admin/access.
  // The floor board's row on that screen reads "Picking" (from PAGE_NAV_MAP),
  // and both rows sit in the same Operations section. An override is REQUIRED
  // here — without one `pageLabel()` falls through to the raw key and the row
  // would read "billing_picking" — and the "Billing ·" prefix is what tells an
  // admin which of the two Pickings he is ticking. Do not shorten it to
  // "Picking".
  billing_picking:  "Billing · Picking",
  billing_print:    "Billing · Print",
  billing_telephonic: "Billing · Telephonic",
  billing_pick_delete: "Billing · Pick delete",
  // Same rule as the row above, and the same reason it is not optional: none of
  // these four is in PAGE_NAV_MAP, so without an override each row would read
  // its raw key. The "Billing ·" prefix also keeps them recognisable as one
  // family sitting under "Billing · Picking" in the Operations section.
  //
  // ⚠ Each label names the BUTTON, not the concept: an admin ticking
  // "Billing · Hold" is deciding who may press Hold on the Billing face, not who
  // may hold a bill anywhere — Floor has its own key for that.
  billing_hold:     "Billing · Hold",
  billing_slot:     "Billing · Slot",
  billing_urgent:   "Billing · Urgent",
  billing_ship_to:  "Billing · Ship-to",
  billing_hand:     "Billing · Hand",
  billing_ci:       "Billing · CI",
  // Not in PAGE_NAV_MAP, so without this the row would read its raw key. The
  // "Purchase Order ·" prefix keeps it apart from "Billing · Ship-to" above —
  // a different screen and a different key.
  place_order_ship_to: "Purchase Order · Ship-to",
  // Not in PAGE_NAV_MAP. The "Tint Manager · Panel:" prefix keeps the three
  // reading as tabs of that one screen, directly under its own row.
  tint_panel_items:    "Tint Manager · Panel: Items",
  tint_panel_details:  "Tint Manager · Panel: Details",
  tint_panel_activity: "Tint Manager · Panel: Activity",
  // The seven Tint Manager action ticks (2026-10-01). Not in PAGE_NAV_MAP. Each
  // label names the BUTTON on the Tint Manager, exactly as "Billing · Hold"
  // names Billing's — Floor holds the same facts on its own key.
  tint_hold:           "Tint Manager · Hold",
  tint_hand:           "Tint Manager · Hand",
  tint_slot:           "Tint Manager · Slot",
  tint_ship_to:        "Tint Manager · Ship-to",
  tint_cancel:         "Tint Manager · Cancel",
  tint_ci:             "Tint Manager · CI",
  tint_pick_delete:    "Tint Manager · Pick delete",
  tint_shop_delivery:  "Tint Manager · Shop delivery",
  tint_urgent:         "Tint Manager · Urgent",
  tint_ti_bulk:        "Tint Manager · Bulk TI",
  attendance:      "Attendance — their own",
  attendance_admin: "Attendance — everyone",
  // The per-report ticks (2026-09-17). Not in PAGE_NAV_MAP.
  reports_tint_summary: "Reports · Tint Summary",
  reports_ti_report:    "Reports · TI Report",
  // 🔴 Gates NOTHING since 2026-09-17 — the hub, sidebar row and routes read
  // REPORT_PAGE_KEYS instead. Labelled so no admin ticks it expecting an effect.
  // Retiring the key is a later job.
  ti_report:            "Reports (legacy — no effect)",
};

/** Friendly name for a page key: PAGE_NAV_MAP first, override, then the key. */
export function pageLabel(pageKey: string): string {
  const override = PAGE_LABEL_OVERRIDES[pageKey];
  if (override) return override;
  return PAGE_NAV_MAP.find((i) => i.pageKey === pageKey)?.label ?? pageKey;
}

/**
 * The 54 keys grouped for display. Every key in ALL_PAGE_KEYS appears exactly
 * once — ACCESS_SECTIONS is asserted against it by the access page, so adding a
 * key to ALL_PAGE_KEYS without adding it here is caught rather than silently
 * hiding a row.
 */
export const ACCESS_SECTIONS: { label: string; keys: PageKey[] }[] = [
  { label: "Operations", keys: [
    // `billing_picking` follows `mail_orders` because it is a tab INSIDE that
    // screen, and the two rows read as a pair on /admin/access. ⚠ It is not the
    // `picking` row at the head of this list — that is the floor board.
    // The six action ticks follow "Billing · Picking" so the whole Billing
    // family reads as one block on /admin/access: the screen, its Picking tab,
    // then the six decisions the Orders tab allows.
    "picking", "floor", "mrn", "ci", "freight_trips", "mail_orders", "billing_picking",
    "billing_print", "billing_telephonic", "billing_pick_delete",
    "billing_hold", "billing_slot", "billing_urgent", "billing_ship_to",
    "billing_hand", "billing_ci",
    "place_order", "place_order_ship_to", "trip_report", "import_obd",
  ] },
  { label: "Tinting", keys: [
    "tint_manager",
    "tint_panel_items", "tint_panel_details", "tint_panel_activity",
    // The seven action ticks follow the panel tabs: the screen, its tabs, then
    // the buttons — one block on /admin/access, like the Billing family.
    "tint_hold", "tint_hand", "tint_slot", "tint_ship_to",
    "tint_cancel", "tint_ci", "tint_pick_delete", "tint_shop_delivery", "tint_urgent", "tint_ti_bulk",
    "tint_operator", "operations_tinting",
    "operations_tint_operator", "delivery_challans", "shade_master",
    "sampling_library", "ti_report",
    "reports_tint_summary", "reports_ti_report", "reports_trip_detail",
  ] },
  { label: "Master data", keys: ["customers", "skus", "routes_areas", "vehicles"] },
  { label: "Admin panel", keys: [
    "dashboard", "users", "system_config", "permissions", "settings_hide",
  ] },
  { label: "Attendance", keys: ["attendance", "attendance_admin"] },
];

/** Every key in ALL_PAGE_KEYS, for callers that need the flat list. */
export function allPageKeys(): PageKey[] {
  return [...ALL_PAGE_KEYS];
}

// ── WHERE PERMISSIONS COME FROM — the ACCESS_SOURCE switch ────────────────────
//
// Step 4 of the role → user access conversion. The five resolvers below are the
// ONLY things that changed: each now asks getAccessSource() where to read from.
//
//   "role" (the default, and what ships)  → role_permissions, by role slug
//   "user"                                → user_page_access, by user id
//
// Everything else is untouched by design: signatures, return shapes, the admin
// short-circuits, ROLE_HREF_OVERRIDES, buildNavItems' attendance special case,
// every requireRole/hasRole gate, and role_permissions itself, which the old
// screen still writes and role mode still reads.
//
// 🔴 HOW THE userId REACHES A RESOLVER THAT TAKES ROLE SLUGS.
// It does not arrive as an argument — the signatures had to stay as they are,
// and threading a new parameter through 139 call sites would be a far larger
// change than the one being made. Instead user mode calls auth() and reads
// session.user.id, which is already on the JWT and is already what every one of
// those call sites derived its role slugs from. Same request, same session, so
// the id and the slugs always describe the same person.
//
// ⚠ THE ONE PLACE THAT ASSUMPTION DOES NOT HOLD is a caller asking about
// SOMEBODY ELSE — /admin/access computing what each of 39 people is granted.
// Such a caller must use getRolePermissionsForRoles() below, which is pinned to
// the role table and never consults the switch. If a future caller needs
// another person's EFFECTIVE permissions, it needs a by-id resolver; do not
// reach for these five, because they will answer about the logged-in admin.
//
// If auth() yields no usable id — no session, or a non-request context such as
// a script — user mode falls back to the ROLE path for that call. Same
// direction as every other failure here: back to what production already does.

/**
 * The two things every resolver needs off the session, read in ONE auth() call.
 * Kept together deliberately: the superuser short-circuit and the user-mode id
 * both come from the same session, and fetching them separately would double
 * the auth() cost of every permission check.
 *
 * Never throws — an unavailable session yields "no id, not a superuser", which
 * sends the caller down the role path. Same failure direction as everything
 * else in this file.
 */
interface SessionAccess { userId: number | null; isSuperuser: boolean }

async function sessionAccess(): Promise<SessionAccess> {
  try {
    const session = await auth();
    const raw = session?.user?.id;
    const id = raw ? parseInt(raw, 10) : NaN;
    return {
      userId: Number.isFinite(id) ? id : null,
      // ⚠ Only the flag arm here. The ROLE arm of the safety rule is the
      // pre-existing `roleSlug === "admin"` test each resolver already does
      // BEFORE calling this, which is why that test is still there and must
      // stay — see lib/rbac.ts for the rule in full.
      isSuperuser: session?.user?.isSuperuser === true,
    };
  } catch {
    return { userId: null, isSuperuser: false };
  }
}

/**
 * Should this call read user_page_access? The id if so, else null (take the
 * role path). Takes the already-fetched session so no second auth() happens.
 */
async function userModeId(access: SessionAccess): Promise<number | null> {
  if ((await getAccessSource()) !== "user") return null;
  if (access.userId === null) {
    console.error("[access] user mode is on but no session user id is available; using role mode for this call");
  }
  return access.userId;
}

// ── The access notebook (2026-09-30) ─────────────────────────────────────────
// Every read below that touches user_page_access or role_permissions has ONE
// notebook branch in front of it: `if (await notebookOn()) { … }`. With
// system_config ACCESS_CACHE anything but 'on' that branch is skipped and the
// ORIGINAL query lines below it run, unchanged — the OFF path is the old code,
// not a re-implementation. The admin role arm and the superuser flag arm sit
// ABOVE every one of these branches in each resolver and are untouched, so
// neither the notebook nor its failure can affect them. Absent row ≡ all false
// holds in both paths. lib/access/notebook.ts has the trust rules.

/** One user's stored ticks for one page. Absent row ≡ all false. */
async function userPagePerms(userId: number, pageKey: PageKey): Promise<PagePermissions> {
  if (await notebookOn()) {
    const stored = (await accessNotebook.getUserBundle(userId)).pages.get(pageKey);
    return stored ? { ...stored } : ALL_FALSE;
  }
  const row = await prisma.user_page_access.findUnique({
    where:  { userId_pageKey: { userId, pageKey } },
    select: { canView: true, canImport: true, canExport: true, canEdit: true, canDelete: true },
  });
  if (!row) return ALL_FALSE;
  return {
    canView:   row.canView,
    canImport: row.canImport,
    canExport: row.canExport,
    canEdit:   row.canEdit,
    canDelete: row.canDelete,
  };
}

/** All of one user's stored ticks, as the same map shape the role path returns. */
async function userAllPerms(userId: number): Promise<Record<string, PagePermissions>> {
  if (await notebookOn()) {
    // Stored keys only — the same undensified shape as the query path below.
    const result: Record<string, PagePermissions> = {};
    for (const [pageKey, perms] of Array.from((await accessNotebook.getUserBundle(userId)).pages)) {
      result[pageKey] = { ...perms };
    }
    return result;
  }
  const rows = await prisma.user_page_access.findMany({
    where:  { userId },
    select: {
      pageKey: true,
      canView: true, canImport: true, canExport: true, canEdit: true, canDelete: true,
    },
  });
  const result: Record<string, PagePermissions> = {};
  for (const row of rows) {
    result[row.pageKey] = {
      canView:   row.canView,
      canImport: row.canImport,
      canExport: row.canExport,
      canEdit:   row.canEdit,
      canDelete: row.canDelete,
    };
  }
  // Deliberately NOT densified to all 28 keys. The role path omits keys no role
  // grants, and every consumer reads an absent key as false
  // (`allPerms[key]?.canView === true`). Leaving the shapes as close as they are
  // keeps the two modes indistinguishable to callers.
  return result;
}

/**
 * The OR-merge across roles, straight from role_permissions — the role path,
 * factored out so both getAllPermissionsForRoles() and the switch-independent
 * getRolePermissionsForRoles() share one body rather than two copies that can
 * drift.
 */
async function mergeRolePerms(roleSlugs: string[]): Promise<Record<string, PagePermissions>> {
  const rows = await prisma.role_permissions.findMany({
    where: { roleSlug: { in: roleSlugs } },
  });
  return mergeRoleRows(rows);
}

/**
 * The OR-merge itself, over rows already read — shared by the query path above
 * and the notebook path in getAllPermissionsForRoles(), so there is one merge
 * rule, not two copies that can drift.
 */
function mergeRoleRows(
  rows: Pick<RolePermRow, "pageKey" | "canView" | "canImport" | "canExport" | "canEdit" | "canDelete">[],
): Record<string, PagePermissions> {
  const merged: Record<string, PagePermissions> = {};
  for (const row of rows) {
    const existing = merged[row.pageKey];
    if (!existing) {
      merged[row.pageKey] = {
        canView:   row.canView,
        canImport: row.canImport,
        canExport: row.canExport,
        canEdit:   row.canEdit,
        canDelete: row.canDelete,
      };
    } else {
      merged[row.pageKey] = {
        canView:   existing.canView   || row.canView,
        canImport: existing.canImport || row.canImport,
        canExport: existing.canExport || row.canExport,
        canEdit:   existing.canEdit   || row.canEdit,
        canDelete: existing.canDelete || row.canDelete,
      };
    }
  }
  return merged;
}

/**
 * What the ROLE system grants these slugs — ALWAYS, whatever ACCESS_SOURCE
 * says. This is not a permission check and must never be used as one.
 *
 * It exists for /admin/access, which shows each person's stored ticks against
 * what their job title would give them. That comparison is meaningless if it
 * follows the switch, and actively wrong in user mode: the five resolvers
 * answer about the LOGGED-IN user, so a screen asking about 39 other people
 * would get the admin's own permissions 39 times.
 */
export async function getRolePermissionsForRoles(
  roleSlugs: string[],
): Promise<Record<string, PagePermissions>> {
  if (roleSlugs.length === 0) return {};
  if (roleSlugs.includes("admin")) {
    return Object.fromEntries(ALL_PAGE_KEYS.map((key) => [key, ALL_TRUE]));
  }
  return mergeRolePerms(roleSlugs);
}

// ── Functions ─────────────────────────────────────────────────────────────────

export async function checkPermission(
  roleSlug: string,
  pageKey: PageKey,
  action: ActionKey,
): Promise<boolean> {
  // SAFETY RULE (lib/rbac.ts): flag OR role. The ROLE arm is first because it
  // is free — no session read — and short-circuits before auth() is touched.
  if (roleSlug === "admin") return true;

  const access = await sessionAccess();
  if (access.isSuperuser) return true;   // flag arm

  const userId = await userModeId(access);
  if (userId !== null) {
    return (await userPagePerms(userId, pageKey))[action];
  }

  if (await notebookOn()) {
    const row = (await accessNotebook.getRoleRows([roleSlug])).find((r) => r.pageKey === pageKey);
    if (!row) return false;
    return row[action];
  }

  const perm = await prisma.role_permissions.findUnique({
    where: { roleSlug_pageKey: { roleSlug, pageKey } },
  });

  if (!perm) return false;
  return perm[action];
}

export async function checkAnyPermission(
  roleSlugs: string[],
  pageKey: PageKey,
  action: ActionKey,
): Promise<boolean> {
  // SAFETY RULE (lib/rbac.ts): flag OR role. Role arm first — see above.
  if (roleSlugs.includes("admin")) return true;
  if (roleSlugs.length === 0) return false;

  const access = await sessionAccess();
  if (access.isSuperuser) return true;   // flag arm

  const userId = await userModeId(access);
  if (userId !== null) {
    // No merge in user mode — one person, one row. The OR across roles that
    // this function exists to do has already happened, once, when the ticks
    // were written.
    return (await userPagePerms(userId, pageKey))[action];
  }

  if (await notebookOn()) {
    return (await accessNotebook.getRoleRows(roleSlugs))
      .filter((r) => r.pageKey === pageKey)
      .some((r) => r[action] === true);
  }

  const rows = await prisma.role_permissions.findMany({
    where:  { roleSlug: { in: roleSlugs }, pageKey },
    select: { canView: true, canEdit: true, canImport: true, canExport: true, canDelete: true },
  });

  return rows.some(r => r[action] === true);
}

export async function getPagePermissions(
  roleSlug: string,
  pageKey: PageKey,
): Promise<PagePermissions> {
  // SAFETY RULE (lib/rbac.ts): flag OR role. Role arm first — see above.
  if (roleSlug === "admin") return ALL_TRUE;

  const access = await sessionAccess();
  if (access.isSuperuser) return ALL_TRUE;   // flag arm

  const userId = await userModeId(access);
  if (userId !== null) {
    return userPagePerms(userId, pageKey);
  }

  if (await notebookOn()) {
    const row = (await accessNotebook.getRoleRows([roleSlug])).find((r) => r.pageKey === pageKey);
    if (!row) return ALL_FALSE;
    return {
      canView:   row.canView,
      canImport: row.canImport,
      canExport: row.canExport,
      canEdit:   row.canEdit,
      canDelete: row.canDelete,
    };
  }

  const perm = await prisma.role_permissions.findUnique({
    where: { roleSlug_pageKey: { roleSlug, pageKey } },
  });

  if (!perm) return ALL_FALSE;

  return {
    canView:   perm.canView,
    canImport: perm.canImport,
    canExport: perm.canExport,
    canEdit:   perm.canEdit,
    canDelete: perm.canDelete,
  };
}

export async function getAllPermissionsForRole(
  roleSlug: string,
): Promise<Record<string, PagePermissions>> {
  // SAFETY RULE (lib/rbac.ts): flag OR role. Role arm first — see above.
  if (roleSlug === "admin") {
    return Object.fromEntries(ALL_PAGE_KEYS.map((key) => [key, ALL_TRUE]));
  }

  const access = await sessionAccess();
  if (access.isSuperuser) {   // flag arm
    return Object.fromEntries(ALL_PAGE_KEYS.map((key) => [key, ALL_TRUE]));
  }

  const userId = await userModeId(access);
  if (userId !== null) {
    return userAllPerms(userId);
  }

  if (await notebookOn()) {
    const cached: Record<string, PagePermissions> = {};
    for (const row of await accessNotebook.getRoleRows([roleSlug])) {
      cached[row.pageKey] = {
        canView:   row.canView,
        canImport: row.canImport,
        canExport: row.canExport,
        canEdit:   row.canEdit,
        canDelete: row.canDelete,
      };
    }
    return cached;
  }

  const rows = await prisma.role_permissions.findMany({
    where: { roleSlug },
  });

  const result: Record<string, PagePermissions> = {};
  for (const row of rows) {
    result[row.pageKey] = {
      canView:   row.canView,
      canImport: row.canImport,
      canExport: row.canExport,
      canEdit:   row.canEdit,
      canDelete: row.canDelete,
    };
  }
  return result;
}

/**
 * Multi-role variant of getAllPermissionsForRole.
 * Returns a permission map representing the UNION of permissions across
 * all roles passed in: a page action is `true` if ANY role grants it.
 *
 * Admin short-circuits to ALL_TRUE (same as single-role variant).
 */
export async function getAllPermissionsForRoles(
  roleSlugs: string[],
): Promise<Record<string, PagePermissions>> {
  if (roleSlugs.length === 0) return {};
  // SAFETY RULE (lib/rbac.ts): flag OR role. Role arm first — see above.
  if (roleSlugs.includes("admin")) {
    return getAllPermissionsForRole("admin");
  }

  const access = await sessionAccess();
  if (access.isSuperuser) {   // flag arm
    return getAllPermissionsForRole("admin");
  }

  const userId = await userModeId(access);
  if (userId !== null) {
    return userAllPerms(userId);
  }

  if (await notebookOn()) {
    return mergeRoleRows(await accessNotebook.getRoleRows(roleSlugs));
  }

  return mergeRolePerms(roleSlugs);
}
