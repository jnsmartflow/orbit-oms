// Phase 1 EMERGENCY ROLLBACK
//
// Restores mo_order_form_index to its pre-Phase B state by re-inserting
// every row from the backup JSON written by phase1-backup-current-index.ts.
//
// Why: the new taxonomy's `subProduct` values were abstracted away from
// the legacy `mo_sku_lookup.product` strings (e.g. LUXURIO/MATT vs
// LUXURIO PU MATT, 2K PU/MATT vs INT CLR 2K PU MATT). The /api/order/data
// route joins the two via `mo_order_form_index.subProduct ===
// mo_sku_lookup.product`, so the new rows render with empty pack lists
// for the ~70% of families whose names were abstracted. Phase 2 catalog
// migration (or a translation layer) is required before the new taxonomy
// can ship; rolling back to the legacy 481-row state unblocks operators
// in the meantime.
//
// Schema state is unchanged by this rollback. The widened unique
// constraint stays in place — it's a superset of the old one and the
// 481 backup rows have no cross-listing, so the wider constraint is
// harmless on the restored data.
//
// Per CLAUDE_CORE.md §3:
//   - sequential awaits, no prisma.$transaction([...])
//   - DIRECT_URL for one-off maintenance scripts
//
// Run with: npx tsx scripts/phase1-restore-from-backup.ts

import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const directUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!directUrl) {
  throw new Error("DIRECT_URL (or DATABASE_URL) must be set in environment.");
}
const prisma = new PrismaClient({
  datasources: { db: { url: directUrl } },
  log: ["error"],
});

const BACKUP_PATH = path.join(
  "docs", "prompts", "drafts",
  "mo_order_form_index-backup-2026-05-06.json",
);

// Mirror of mo_order_form_index column types as seen in the backup payload.
type BackupRow = {
  id:           number;        // stripped before insert (autoincrement)
  family:       string;
  subProduct:   string;
  baseColour:   string | null;
  displayName:  string;
  searchTokens: string;
  tinterType:   string | null;
  productType:  string | null;
  sortOrder:    number;
  isActive:     boolean;
  createdAt:    string;        // ISO string in JSON; converted to Date for prisma
};

type BackupFile = {
  capturedAt:  string;
  sourceTable: string;
  rowCount:    number;
  rows:        BackupRow[];
};

async function main(): Promise<void> {
  // ── Preconditions ────────────────────────────────────────────────────
  const raw  = await fs.readFile(BACKUP_PATH, "utf8");
  const data = JSON.parse(raw) as BackupFile;

  if (data.sourceTable !== "mo_order_form_index") {
    throw new Error(`Refusing: backup sourceTable is "${data.sourceTable}", expected "mo_order_form_index".`);
  }
  if (data.rowCount !== 481) {
    throw new Error(`Refusing: backup rowCount=${data.rowCount}, expected 481.`);
  }
  if (!Array.isArray(data.rows) || data.rows.length !== 481) {
    throw new Error(`Refusing: backup rows.length=${data.rows?.length ?? "missing"}, expected 481.`);
  }

  // Spot-check first row has the required keys before we touch the DB.
  const first = data.rows[0];
  const requiredKeys: Array<keyof BackupRow> = [
    "family", "subProduct", "displayName", "searchTokens",
    "productType", "sortOrder", "isActive", "createdAt",
  ];
  for (const k of requiredKeys) {
    if (first[k] === undefined) {
      throw new Error(`Refusing: backup row 0 missing required key "${k}".`);
    }
  }

  // ── Wipe (idempotent on re-run) ──────────────────────────────────────
  const wipeResult = await prisma.mo_order_form_index.deleteMany({});
  const rowsWiped  = wipeResult.count;

  // ── Sequential restore ───────────────────────────────────────────────
  // - Strip `id` (autoincrement; old values may collide or leave gaps)
  // - PRESERVE `createdAt` (historical timestamp — accurate audit trail)
  // - Convert createdAt string → Date for prisma
  let inserted = 0;
  for (const r of data.rows) {
    await prisma.mo_order_form_index.create({
      data: {
        family:       r.family,
        subProduct:   r.subProduct,
        baseColour:   r.baseColour,
        displayName:  r.displayName,
        searchTokens: r.searchTokens,
        tinterType:   r.tinterType,
        productType:  r.productType ?? "PLAIN",
        sortOrder:    r.sortOrder,
        isActive:     r.isActive,
        createdAt:    new Date(r.createdAt),
      },
    });
    inserted++;
  }

  // ── Verify ───────────────────────────────────────────────────────────
  const finalCount       = await prisma.mo_order_form_index.count();
  const matches          = finalCount === inserted && inserted === 481;
  const activeCount      = await prisma.mo_order_form_index.count({ where: { isActive: true } });
  const distinctFamilies = (await prisma.mo_order_form_index.findMany({
    select: { family: true },
    distinct: ["family"],
  })).length;

  /* eslint-disable no-console */
  console.log("─── Phase 1 ROLLBACK result ───");
  console.log(`Backup source      : ${BACKUP_PATH}`);
  console.log(`Backup capturedAt  : ${data.capturedAt}`);
  console.log(`Rows wiped         : ${rowsWiped}`);
  console.log(`Rows restored      : ${inserted}`);
  console.log(`Verification count : ${finalCount} (matches expected 481: ${matches ? "✓" : "✗"})`);
  console.log(`Active rows        : ${activeCount}`);
  console.log(`Distinct families  : ${distinctFamilies}`);
  /* eslint-enable no-console */

  if (!matches) {
    throw new Error(
      `Verification failed: count() returned ${finalCount} but ${inserted} inserts ran (expected 481).`,
    );
  }
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("✗ Restore failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
