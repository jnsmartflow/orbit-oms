import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting seed...");

  // ── system_config ──────────────────────────────────────────
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

  // ── role_master ────────────────────────────────────────────
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

  // ── delivery_type_master ───────────────────────────────────
  const deliveryTypes = ["Local", "Upcountry"];

  for (const name of deliveryTypes) {
    await prisma.delivery_type_master.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`  ✓ delivery_type_master — ${deliveryTypes.length} rows`);

  // ── dispatch_cutoff_master ─────────────────────────────────
  const localType = await prisma.delivery_type_master.findUniqueOrThrow({ where: { name: "Local" } });
  const upcountryType = await prisma.delivery_type_master.findUniqueOrThrow({ where: { name: "Upcountry" } });

  const cutoffSlots = [
    { deliveryTypeId: localType.id, slotNumber: 1, label: "Morning",   cutoffTime: "", isDefaultForType: false },
    { deliveryTypeId: localType.id, slotNumber: 2, label: "Afternoon", cutoffTime: "", isDefaultForType: false },
    { deliveryTypeId: localType.id, slotNumber: 3, label: "Evening",   cutoffTime: "", isDefaultForType: false },
    { deliveryTypeId: localType.id, slotNumber: 4, label: "Night",     cutoffTime: "", isDefaultForType: false },
    { deliveryTypeId: upcountryType.id, slotNumber: 1, label: "Morning",   cutoffTime: "", isDefaultForType: false },
    { deliveryTypeId: upcountryType.id, slotNumber: 2, label: "Afternoon", cutoffTime: "", isDefaultForType: false },
    { deliveryTypeId: upcountryType.id, slotNumber: 3, label: "Evening",   cutoffTime: "", isDefaultForType: false },
    { deliveryTypeId: upcountryType.id, slotNumber: 4, label: "Night",     cutoffTime: "", isDefaultForType: true  },
  ];

  for (const slot of cutoffSlots) {
    await prisma.dispatch_cutoff_master.upsert({
      where: { deliveryTypeId_slotNumber: { deliveryTypeId: slot.deliveryTypeId, slotNumber: slot.slotNumber } },
      update: { label: slot.label, isDefaultForType: slot.isDefaultForType },
      create: slot,
    });
  }
  console.log(`  ✓ dispatch_cutoff_master — ${cutoffSlots.length} rows`);

  // ── delivery_priority_master ───────────────────────────────
  const priorities = [
    { name: "Urgent", sortOrder: 1 },
    { name: "Normal", sortOrder: 2 },
  ];

  for (const row of priorities) {
    await prisma.delivery_priority_master.upsert({
      where: { name: row.name },
      update: { sortOrder: row.sortOrder },
      create: { name: row.name, sortOrder: row.sortOrder },
    });
  }
  console.log(`  ✓ delivery_priority_master — ${priorities.length} rows`);

  // ── dispatch_status_master ─────────────────────────────────
  const dispatchStatuses = ["Hold", "Dispatch", "Waiting for Confirmation"];

  for (const name of dispatchStatuses) {
    await prisma.dispatch_status_master.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`  ✓ dispatch_status_master — ${dispatchStatuses.length} rows`);

  // ── tinting_status_master ──────────────────────────────────
  const tintingStatuses = [
    "pending_tint_assignment",
    "tinting_in_progress",
    "tinting_done",
  ];

  for (const name of tintingStatuses) {
    await prisma.tinting_status_master.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`  ✓ tinting_status_master — ${tintingStatuses.length} rows`);

  // ── admin user ─────────────────────────────────────────────
  const adminRole = await prisma.role_master.findUniqueOrThrow({
    where: { name: "Admin" },
  });

  const passwordHash = await bcrypt.hash("Admin@123", 10);

  await prisma.users.upsert({
    where: { email: "admin@orbitoms.com" },
    update: {},
    create: {
      email: "admin@orbitoms.com",
      password: passwordHash,
      name: "System Admin",
      roleId: adminRole.id,
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
