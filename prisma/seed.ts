import { PrismaClient, StatusDomain, SlotRuleType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting seed...");

  // ── system_config ──────────────────────────────────────────────────────────
  const configRows = [
    { key: "soft_lock_minutes_before_cutoff", value: "30" },
    { key: "hard_lock_minutes_before_cutoff", value: "15" },
    { key: "ready_escalation_minutes", value: "10" },
    { key: "upgrade_small_overflow_pct", value: "12" },
    { key: "upgrade_max_dealer_combo", value: "3" },
    { key: "aging_priority_days", value: "2" },
    { key: "aging_alert_days", value: "3" },
    { key: "change_queue_urgent_alert", value: "true" },
  ];

  for (const row of configRows) {
    await prisma.system_config.upsert({
      where: { key: row.key },
      update: { value: row.value },
      create: { key: row.key, value: row.value },
    });
  }
  console.log(`  ✓ system_config — ${configRows.length} rows`);

  // ── role_master ────────────────────────────────────────────────────────────
  // Order matches ROLES const in lib/rbac.ts. Idempotent: re-running the seed
  // refreshes descriptions on existing rows so this file stays authoritative.
  const roles: { name: string; description: string }[] = [
    { name: "admin",            description: "System administrator" },
    { name: "dispatcher",       description: "Dispatch planning" },
    { name: "support",          description: "Support queue" },
    { name: "tint_manager",     description: "Tint manager" },
    { name: "tint_operator",    description: "Tint operator" },
    { name: "operations",       description: "Operations (read-only across boards)" },
    { name: "ops_admin",        description: "Operations Admin (attendance supervision)" },
    { name: "floor_supervisor", description: "Warehouse floor supervisor" },
    { name: "picker",           description: "Warehouse picker" },
    { name: "billing_operator", description: "Billing operator (mail orders + SAP punching)" },
  ];

  for (const role of roles) {
    await prisma.role_master.upsert({
      where:  { name: role.name },
      update: { description: role.description },
      create: role,
    });
  }
  console.log(`  ✓ role_master — ${roles.length} rows`);

  // ── role_permissions ────────────────────────────────────────────────────────
  // Default permissions per role. Admin always bypasses this check in code.
  // canView/canEdit are the most commonly checked actions.
  const permRows: {
    roleSlug: string;
    pageKey:  string;
    canView:  boolean;
    canEdit:  boolean;
    canImport:boolean;
    canExport:boolean;
    canDelete:boolean;
  }[] = [
    // tint_operator — full access to their own page
    { roleSlug: "tint_operator", pageKey: "tint_operator", canView: true,  canEdit: true,  canImport: false, canExport: false, canDelete: false },

    // tint_manager — full access to tint manager page + read-only shared pages
    { roleSlug: "tint_manager",  pageKey: "tint_manager",  canView: true,  canEdit: true,  canImport: false, canExport: false, canDelete: false },
    { roleSlug: "tint_manager",  pageKey: "customers",     canView: true,  canEdit: false, canImport: false, canExport: false, canDelete: false },
    { roleSlug: "tint_manager",  pageKey: "skus",          canView: true,  canEdit: false, canImport: false, canExport: false, canDelete: false },
    { roleSlug: "tint_manager",  pageKey: "routes_areas",  canView: true,  canEdit: false, canImport: false, canExport: false, canDelete: false },
    { roleSlug: "tint_manager",  pageKey: "vehicles",      canView: true,  canEdit: false, canImport: false, canExport: false, canDelete: false },

    // support — read-only shared pages (its own board was retired 2026-07-27)
    { roleSlug: "support",       pageKey: "customers",     canView: true,  canEdit: false, canImport: false, canExport: false, canDelete: false },
    { roleSlug: "support",       pageKey: "skus",          canView: true,  canEdit: false, canImport: false, canExport: false, canDelete: false },
    { roleSlug: "support",       pageKey: "routes_areas",  canView: true,  canEdit: false, canImport: false, canExport: false, canDelete: false },
    { roleSlug: "support",       pageKey: "vehicles",      canView: true,  canEdit: false, canImport: false, canExport: false, canDelete: false },
    { roleSlug: "support",       pageKey: "import_obd",    canView: true,  canEdit: false, canImport: true,  canExport: false, canDelete: false },

    // dispatcher — full access to dispatcher page + read-only shared pages
    { roleSlug: "dispatcher",    pageKey: "customers",     canView: true,  canEdit: false, canImport: false, canExport: false, canDelete: false },
    { roleSlug: "dispatcher",    pageKey: "skus",          canView: true,  canEdit: false, canImport: false, canExport: false, canDelete: false },
    { roleSlug: "dispatcher",    pageKey: "routes_areas",  canView: true,  canEdit: false, canImport: false, canExport: false, canDelete: false },
    { roleSlug: "dispatcher",    pageKey: "vehicles",      canView: true,  canEdit: false, canImport: false, canExport: false, canDelete: false },
    { roleSlug: "dispatcher",    pageKey: "import_obd",    canView: true,  canEdit: false, canImport: true,  canExport: false, canDelete: false },

    // The "warehouse" pageKey rows for floor_supervisor + picker were removed
    // 2026-07-28: /warehouse was archived (archive/2026-07-warehouse-board/).
    // Both roles now land on and work from /picking — see the rows below.

    // ── /picking (added 2026-07-20) ───────────────────────────────────────
    // canView  = may open /picking (BOTH faces: the supervisor board and the
    //            picker's own "My Picks").
    // canEdit  = supervisor write actions — assign / unassign / approve /
    //            release-early. `picker` is canEdit:FALSE on purpose: it must
    //            be able to open its board and Mark Done (that route gates on
    //            canView plus its own pickerId ownership check) but must never
    //            assign, approve, or unlock a future-dated bill.
    //
    // These three rows also close a live seed-fragility landmine
    // (CLAUDE_PICKING.md §7): `operations` had a picking grant in the live DB
    // with NO matching seed row, so the next wipe-and-reseed would have
    // silently revoked its /picking access. It is now seeded like the rest.
    { roleSlug: "floor_supervisor", pageKey: "picking",    canView: true,  canEdit: true,  canImport: false, canExport: false, canDelete: false },
    { roleSlug: "picker",           pageKey: "picking",    canView: true,  canEdit: false, canImport: false, canExport: false, canDelete: false },
    { roleSlug: "operations",       pageKey: "picking",    canView: true,  canEdit: true,  canImport: false, canExport: false, canDelete: false },

    // ── /floor — Floor Control (added 2026-07-23) ─────────────────────────
    // New unified desk board (merges Support's "decide" + Picking's "watch").
    // v1 access is intentionally admin + operations ONLY — dispatch planner
    // and telecaller are deferred. `admin` also bypasses this table in code;
    // the row is kept so the seed remains a complete source of truth (CORE §3).
    { roleSlug: "admin",            pageKey: "floor",      canView: true,  canEdit: true,  canImport: false, canExport: false, canDelete: false },
    { roleSlug: "operations",       pageKey: "floor",      canView: true,  canEdit: true,  canImport: false, canExport: false, canDelete: false },

    // ── /mrn — Material Receipt Note (added 2026-08-20) ───────────────────
    // Inbound goods receipt. One route, two faces branching by ROLE.
    //
    // canExport / canDelete are the whole shape of this grant:
    //   billing_operator — raises the MRN, pastes the lines, owns the report,
    //                      and is the only role that may delete one.
    //   floor_supervisor — opens it on his phone, records what physically came
    //                      off the truck. Deliberately export:false /
    //                      delete:false — the report is billing's deliverable
    //                      and deletion is billing's call.
    //   operations       — same shape as floor_supervisor. It holds both
    //                      `picking` and `floor` and is the account actually
    //                      used to exercise mobile boards, so without a row
    //                      here MRN could not be tested the way every other
    //                      board is.
    // `admin` needs no row — it bypasses this table in lib/permissions.ts.
    //
    // ⚠ All three rows were applied to LIVE by hand on 2026-08-20 and are
    // seeded here so a wipe-and-reseed reproduces them. A live grant with no
    // seed row is the exact landmine that hit operations/picking twice
    // (CORE §13) — seed is not live, in both directions.
    { roleSlug: "billing_operator", pageKey: "mrn",        canView: true,  canEdit: true,  canImport: false, canExport: true,  canDelete: true  },
    { roleSlug: "floor_supervisor", pageKey: "mrn",        canView: true,  canEdit: true,  canImport: false, canExport: false, canDelete: false },
    // ⚠ canExport CORRECTED false → true, 2026-09-01. This row said false while
    // LIVE said true (SELECT, all five flags, all three mrn rows — the other two
    // matched). A reseed would have silently revoked MRN export from operations.
    // LIVE IS THE AUTHORITY (CORE §3 — seed is not live, in both directions).
    { roleSlug: "operations",       pageKey: "mrn",        canView: true,  canEdit: true,  canImport: false, canExport: true,  canDelete: false },
    // ── CI (Goods Return Note), 2026-09-01 ────────────────────────────────
    // Same three roles as `mrn`, because it is the same two people plus the
    // operations test account: floor_supervisor raises the CI on his phone
    // (stage 1), billing_operator closes it at the desk (stage 2).
    //
    // ⚠ FLAGS ARE THE LIVE ROWS, NOT A COPY OF THE mrn LINES ABOVE — verified
    // by SELECT 2026-09-01. `operations` holds canExport on ci, and on mrn too
    // (the mrn line above said false and was corrected in the same pass). Do not
    // "align" these blocks by copying either way; check the database.
    //
    // ⚠ These rows were applied to LIVE by sql/2026-08-31-ci-module.sql and are
    // seeded here so a wipe-and-reseed reproduces them. A live grant with no
    // seed row is the landmine CORE §13 records — seed is not live, in both
    // directions.
    { roleSlug: "billing_operator", pageKey: "ci",         canView: true,  canEdit: true,  canImport: false, canExport: true,  canDelete: true  },
    { roleSlug: "floor_supervisor", pageKey: "ci",         canView: true,  canEdit: true,  canImport: false, canExport: false, canDelete: false },
    { roleSlug: "operations",       pageKey: "ci",         canView: true,  canEdit: true,  canImport: false, canExport: true,  canDelete: false },
  ];

  for (const row of permRows) {
    await prisma.role_permissions.upsert({
      where: { roleSlug_pageKey: { roleSlug: row.roleSlug, pageKey: row.pageKey } },
      update: {
        canView:   row.canView,
        canEdit:   row.canEdit,
        canImport: row.canImport,
        canExport: row.canExport,
        canDelete: row.canDelete,
      },
      create: row,
    });
  }
  console.log(`  ✓ role_permissions — ${permRows.length} rows`);

  // ── ci_reason_master ───────────────────────────────────────────────────────
  // The CI reason picker's vocabulary (spec §3.1). A MASTER TABLE, not a CHECK
  // constraint, because the list will change and a CHECK makes every change a
  // schema migration.
  //
  // 🔴 WITHOUT THESE ROWS A RESEED LEAVES THE TABLE EMPTY AND THE REASON PICKER
  // BREAKS WITH NO ERROR MESSAGE — the screen renders an empty list and the
  // supervisor simply cannot submit. That failure mode is why they are seeded
  // rather than left as one-off SQL: the 8 rows went LIVE via
  // sql/2026-08-31-ci-module.sql, and seed is not live, in both directions.
  //
  // ⚠ RETIRE A REASON WITH isActive = false — NEVER DELETE. Old CIs point at
  // the reason they were raised under (ci_returns.reasonId, ON DELETE RESTRICT),
  // and ci_returns also snapshots reasonLabel so a rename never rewrites
  // history. Upsert-on-`code` below is what makes a relabel safe: the row keeps
  // its id, so every CI already pointing at it still resolves.
  //
  // sortOrder 1-8; the first three are isPinned and sit above a divider in the
  // picker, the rest under "More". One struck-through entry on the owner's sheet
  // is deliberately excluded.
  const ciReasonRows: {
    code: string;
    label: string;
    sortOrder: number;
    isPinned: boolean;
  }[] = [
    { code: "WRONG_ORDER_BY_SO",      label: "Wrong Order by S.O.",    sortOrder: 1, isPinned: true  },
    { code: "PHYSICALLY_CROSS",       label: "Physically Cross",       sortOrder: 2, isPinned: true  },
    { code: "RETURN_BY_DEALER",       label: "Return by Dealer",       sortOrder: 3, isPinned: true  },
    { code: "ORDER_CANCEL_BY_DEALER", label: "Order Cancel by Dealer", sortOrder: 4, isPinned: false },
    { code: "DOUBLE_ORDER",           label: "Double Order",           sortOrder: 5, isPinned: false },
    { code: "WRONG_PUNCHING",         label: "Wrong Punching",         sortOrder: 6, isPinned: false },
    { code: "RE_BILL",                label: "Re Bill",                sortOrder: 7, isPinned: false },
    { code: "COMPLAINT_MATERIAL",     label: "Complaint Material",     sortOrder: 8, isPinned: false },
  ];

  for (const row of ciReasonRows) {
    await prisma.ci_reason_master.upsert({
      where: { code: row.code },
      update: {
        label:     row.label,
        sortOrder: row.sortOrder,
        isPinned:  row.isPinned,
        isActive:  true,
      },
      create: { ...row, isActive: true },
    });
  }
  console.log(`  ✓ ci_reason_master — ${ciReasonRows.length} rows`);

  // ── status_master ──────────────────────────────────────────────────────────
  const statusRows: {
    domain: StatusDomain;
    code: string;
    label: string;
    sortOrder: number;
  }[] = [
    // dispatch
    { domain: "dispatch", code: "dispatch",                  label: "Dispatch",                   sortOrder: 1 },
    { domain: "dispatch", code: "waiting_for_confirmation",  label: "Waiting for Confirmation",   sortOrder: 2 },
    { domain: "dispatch", code: "hold",                      label: "Hold",                       sortOrder: 3 },
    // priority
    { domain: "priority", code: "normal",  label: "Normal", sortOrder: 1 },
    { domain: "priority", code: "urgent",  label: "Urgent", sortOrder: 2 },
    // tinting
    { domain: "tinting",  code: "pending_tint_assignment",  label: "Pending Tint Assignment", sortOrder: 1 },
    { domain: "tinting",  code: "tinting_in_progress",      label: "Tinting In Progress",     sortOrder: 2 },
    { domain: "tinting",  code: "tinting_done",             label: "Tinting Done",            sortOrder: 3 },
    // workflow
    { domain: "workflow", code: "order_created",             label: "Order Created",            sortOrder: 1 },
    { domain: "workflow", code: "pending_tint_assignment",   label: "Pending Tint Assignment",  sortOrder: 2 },
    { domain: "workflow", code: "pending_support",           label: "Pending Support",          sortOrder: 3 },
    { domain: "workflow", code: "dispatch_confirmation",     label: "Dispatch Confirmation",    sortOrder: 4 },
    { domain: "workflow", code: "dispatched",                label: "Dispatched",               sortOrder: 5 },
    // pick_list
    { domain: "pick_list", code: "pending_pick",          label: "Pending Pick",          sortOrder: 1 },
    { domain: "pick_list", code: "pick_assigned",         label: "Pick Assigned",         sortOrder: 2 },
    { domain: "pick_list", code: "picking",               label: "Picking",               sortOrder: 3 },
    { domain: "pick_list", code: "pending_verification",  label: "Pending Verification",  sortOrder: 4 },
    { domain: "pick_list", code: "ready_for_dispatch",    label: "Ready for Dispatch",    sortOrder: 5 },
    { domain: "pick_list", code: "verification_failed",   label: "Verification Failed",   sortOrder: 6 },
    { domain: "pick_list", code: "vehicle_confirmed",     label: "Vehicle Confirmed",     sortOrder: 7 },
    { domain: "pick_list", code: "loading",               label: "Loading",               sortOrder: 8 },
    { domain: "pick_list", code: "loading_complete",      label: "Loading Complete",      sortOrder: 9 },
    { domain: "pick_list", code: "dispatched",            label: "Dispatched",            sortOrder: 10 },
    // import
    { domain: "import", code: "pending",    label: "Pending",    sortOrder: 1 },
    { domain: "import", code: "processing", label: "Processing", sortOrder: 2 },
    { domain: "import", code: "completed",  label: "Completed",  sortOrder: 3 },
    { domain: "import", code: "partial",    label: "Partial",    sortOrder: 4 },
    { domain: "import", code: "failed",     label: "Failed",     sortOrder: 5 },
  ];

  for (const row of statusRows) {
    await prisma.status_master.upsert({
      where: { domain_code: { domain: row.domain, code: row.code } },
      update: { label: row.label, sortOrder: row.sortOrder },
      create: row,
    });
  }
  console.log(`  ✓ status_master — ${statusRows.length} rows`);

  // ── delivery_type_master ───────────────────────────────────────────────────
  const deliveryTypes = ["Local", "Upcountry", "IGT", "Cross"];

  for (const name of deliveryTypes) {
    await prisma.delivery_type_master.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`  ✓ delivery_type_master — ${deliveryTypes.length} rows`);

  // ── slot_master ────────────────────────────────────────────────────────────
  const slotRows = [
    { name: "Morning",          slotTime: "10:30", isNextDay: false, sortOrder: 1, isActive: true  },
    { name: "Afternoon",        slotTime: "12:30", isNextDay: false, sortOrder: 2, isActive: true  },
    { name: "Evening",          slotTime: "17:00", isNextDay: false, sortOrder: 3, isActive: true  },
    { name: "Late Evening",     slotTime: "20:00", isNextDay: false, sortOrder: 4, isActive: true  },
    { name: "Night",            slotTime: "23:59", isNextDay: false, sortOrder: 5, isActive: true  },
    { name: "Next Day Morning", slotTime: "10:30", isNextDay: true,  sortOrder: 6, isActive: false },
  ];

  for (const row of slotRows) {
    await prisma.slot_master.upsert({
      where: { name: row.name },
      update: { slotTime: row.slotTime, isNextDay: row.isNextDay, sortOrder: row.sortOrder, isActive: row.isActive },
      create: row,
    });
  }
  console.log(`  ✓ slot_master — ${slotRows.length} rows`);

  // ── delivery_type_slot_config ──────────────────────────────────────────────
  const local      = await prisma.delivery_type_master.findUniqueOrThrow({ where: { name: "Local" } });
  const upcountry  = await prisma.delivery_type_master.findUniqueOrThrow({ where: { name: "Upcountry" } });
  const slotMorning   = await prisma.slot_master.findUniqueOrThrow({ where: { name: "Morning" } });
  const slotAfternoon = await prisma.slot_master.findUniqueOrThrow({ where: { name: "Afternoon" } });
  const slotEvening   = await prisma.slot_master.findUniqueOrThrow({ where: { name: "Evening" } });
  const slotNight     = await prisma.slot_master.findUniqueOrThrow({ where: { name: "Night" } });
  const slotNextDay   = await prisma.slot_master.findUniqueOrThrow({ where: { name: "Next Day Morning" } });

  const slotConfigs: {
    deliveryTypeId: number;
    slotId: number;
    slotRuleType: SlotRuleType;
    windowStart: string | null;
    windowEnd: string | null;
    isDefault: boolean;
    sortOrder: number;
  }[] = [
    { deliveryTypeId: local.id,     slotId: slotMorning.id,   slotRuleType: "time_based", windowStart: "00:00", windowEnd: "10:29", isDefault: false, sortOrder: 1 },
    { deliveryTypeId: local.id,     slotId: slotAfternoon.id, slotRuleType: "time_based", windowStart: "10:30", windowEnd: "12:29", isDefault: false, sortOrder: 2 },
    { deliveryTypeId: local.id,     slotId: slotEvening.id,   slotRuleType: "time_based", windowStart: "12:30", windowEnd: "15:29", isDefault: false, sortOrder: 3 },
    { deliveryTypeId: local.id,     slotId: slotNight.id,     slotRuleType: "time_based", windowStart: "15:30", windowEnd: "17:59", isDefault: true,  sortOrder: 4 },
    { deliveryTypeId: local.id,     slotId: slotNextDay.id,   slotRuleType: "time_based", windowStart: "18:00", windowEnd: "23:59", isDefault: false, sortOrder: 5 },
    { deliveryTypeId: upcountry.id, slotId: slotNight.id,     slotRuleType: "default",    windowStart: null,    windowEnd: null,    isDefault: true,  sortOrder: 1 },
  ];

  for (const row of slotConfigs) {
    await prisma.delivery_type_slot_config.upsert({
      where: { deliveryTypeId_slotId: { deliveryTypeId: row.deliveryTypeId, slotId: row.slotId } },
      update: {
        slotRuleType: row.slotRuleType,
        windowStart:  row.windowStart,
        windowEnd:    row.windowEnd,
        isDefault:    row.isDefault,
        sortOrder:    row.sortOrder,
      },
      create: row,
    });
  }
  console.log(`  ✓ delivery_type_slot_config — ${slotConfigs.length} rows`);

  // ── product_category ───────────────────────────────────────────────────────
  const categoryNames = ["Emulsion", "Enamel", "Primer", "Tinter", "Texture", "Putty"];

  for (const name of categoryNames) {
    await prisma.product_category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`  ✓ product_category — ${categoryNames.length} rows`);

  // ── product_name ───────────────────────────────────────────────────────────
  const catEmulsion = await prisma.product_category.findUniqueOrThrow({ where: { name: "Emulsion" } });
  const catEnamel   = await prisma.product_category.findUniqueOrThrow({ where: { name: "Enamel" } });
  const catPrimer   = await prisma.product_category.findUniqueOrThrow({ where: { name: "Primer" } });
  const catTinter   = await prisma.product_category.findUniqueOrThrow({ where: { name: "Tinter" } });
  const catTexture  = await prisma.product_category.findUniqueOrThrow({ where: { name: "Texture" } });
  const catPutty    = await prisma.product_category.findUniqueOrThrow({ where: { name: "Putty" } });

  const productNames = [
    { name: "Aquatech",      categoryId: catEmulsion.id },
    { name: "WS",            categoryId: catEmulsion.id },
    { name: "Weathercoat",   categoryId: catEmulsion.id },
    { name: "Supercover",    categoryId: catEnamel.id   },
    { name: "Primer Plus",   categoryId: catPrimer.id   },
    { name: "Tinter Base",   categoryId: catTinter.id   },
    { name: "Texturo",       categoryId: catTexture.id  },
    { name: "Wall Putty Pro",categoryId: catPutty.id    },
  ];

  for (const row of productNames) {
    await prisma.product_name.upsert({
      where: { name: row.name },
      update: { categoryId: row.categoryId },
      create: row,
    });
  }
  console.log(`  ✓ product_name — ${productNames.length} rows`);

  // ── base_colour ────────────────────────────────────────────────────────────
  const baseColours = [
    "White Base", "Deep Base", "Pastel Base", "Clear Base",
    "Birch White", "Sky Blue", "Cream", "N/A",
  ];

  for (const name of baseColours) {
    await prisma.base_colour.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`  ✓ base_colour — ${baseColours.length} rows`);

  // ── contact_role_master ────────────────────────────────────────────────────
  const contactRoles = ["Owner", "Contractor", "Manager", "Site Engineer"];

  for (const name of contactRoles) {
    await prisma.contact_role_master.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`  ✓ contact_role_master — ${contactRoles.length} rows`);

  // ── transporter_master ─────────────────────────────────────────────────────
  const transporters = [
    "Sharma Logistics",
    "Patel Transport",
    "Singh & Sons Carriers",
  ];

  for (const name of transporters) {
    await prisma.transporter_master.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`  ✓ transporter_master — ${transporters.length} rows`);

  // ── sales_officer_master ───────────────────────────────────────────────────
  const salesOfficers = [
    { name: "Amit Shah",   employeeCode: "SO001", email: "amit.shah@company.com"   },
    { name: "Kavita Mehta",employeeCode: "SO002", email: "kavita.mehta@company.com"},
    { name: "Rohan Patel", employeeCode: "SO003", email: "rohan.patel@company.com" },
    { name: "Swati Jain",  employeeCode: "SO004", email: "swati.jain@company.com"  },
  ];

  for (const row of salesOfficers) {
    await prisma.sales_officer_master.upsert({
      where: { email: row.email },
      update: { name: row.name, employeeCode: row.employeeCode },
      create: row,
    });
  }
  console.log(`  ✓ sales_officer_master — ${salesOfficers.length} rows`);

  // ── sales_officer_group ────────────────────────────────────────────────────
  const soAmit   = await prisma.sales_officer_master.findUniqueOrThrow({ where: { email: "amit.shah@company.com" } });
  const soKavita = await prisma.sales_officer_master.findUniqueOrThrow({ where: { email: "kavita.mehta@company.com" } });
  const soRohan  = await prisma.sales_officer_master.findUniqueOrThrow({ where: { email: "rohan.patel@company.com" } });

  const soGroups = [
    { name: "Varacha North Portfolio", salesOfficerId: soAmit.id   },
    { name: "Bharuch & Ankleshwar",    salesOfficerId: soKavita.id },
    { name: "Adajan & Olpad Zone",     salesOfficerId: soRohan.id  },
    { name: "Surat City Central",      salesOfficerId: soAmit.id   },
  ];

  for (const row of soGroups) {
    await prisma.sales_officer_group.upsert({
      where: { name: row.name },
      update: { salesOfficerId: row.salesOfficerId },
      create: row,
    });
  }
  console.log(`  ✓ sales_officer_group — ${soGroups.length} rows`);

  // ── admin user ─────────────────────────────────────────────────────────────
  const adminRole    = await prisma.role_master.findUniqueOrThrow({ where: { name: "admin" } });
  const passwordHash = await bcrypt.hash("Admin@123", 10);

  await prisma.users.upsert({
    where: { email: "admin@orbitoms.com" },
    update: {},
    create: {
      email:    "admin@orbitoms.com",
      password: passwordHash,
      name:     "System Admin",
      roleId:   adminRole.id,
    },
  });
  console.log("  ✓ users — admin@orbitoms.com");

  console.log("\n✅ Seed complete.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
