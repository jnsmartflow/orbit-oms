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
  const roles = [
    "Admin",
    "Dispatcher",
    "Support",
    "Tint Manager",
    "Tint Operator",
    "Floor Supervisor",
    "Picker",
  ];

  for (const name of roles) {
    await prisma.role_master.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`  ✓ role_master — ${roles.length} rows`);

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
    { name: "Morning",          slotTime: "10:30", isNextDay: false, sortOrder: 1 },
    { name: "Afternoon",        slotTime: "12:30", isNextDay: false, sortOrder: 2 },
    { name: "Evening",          slotTime: "15:30", isNextDay: false, sortOrder: 3 },
    { name: "Night",            slotTime: "18:00", isNextDay: false, sortOrder: 4 },
    { name: "Next Day Morning", slotTime: "10:30", isNextDay: true,  sortOrder: 5 },
  ];

  for (const row of slotRows) {
    await prisma.slot_master.upsert({
      where: { name: row.name },
      update: { slotTime: row.slotTime, isNextDay: row.isNextDay, sortOrder: row.sortOrder },
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
  const adminRole    = await prisma.role_master.findUniqueOrThrow({ where: { name: "Admin" } });
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
