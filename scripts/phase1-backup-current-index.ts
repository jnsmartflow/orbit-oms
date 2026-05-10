// Phase 1 backup — snapshot every row of mo_order_form_index to disk
// before the Phase B reseed wipes the table.
//
// Read-only on the DB. Writes to:
//   docs/prompts/drafts/mo_order_form_index-backup-{ISO date}.json
//
// Format: array of plain objects, one per row, all columns preserved
// (id, family, subProduct, baseColour, displayName, searchTokens,
// tinterType, productType, sortOrder, isActive, createdAt). Includes
// inactive rows so a manual restore can recreate exact pre-Phase B
// state if needed.
//
// Run with: npx tsx scripts/phase1-backup-current-index.ts

import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// Phase 1 one-off scripts use DIRECT_URL (port 5432) per CLAUDE_CORE §4 —
// the application singleton at lib/prisma.ts uses DATABASE_URL (the pooler)
// which can have pgbouncer quirks unsuited to schema-touching maintenance
// jobs.
const directUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!directUrl) {
  throw new Error("DIRECT_URL (or DATABASE_URL) must be set in environment.");
}
const prisma = new PrismaClient({
  datasources: { db: { url: directUrl } },
  log: ["error"],
});

async function main(): Promise<void> {
  const rows = await prisma.mo_order_form_index.findMany({
    orderBy: [{ family: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
  });

  if (rows.length === 0) {
    throw new Error(
      "Refusing to write a 0-row backup. mo_order_form_index returned no rows — " +
      "either the table is already empty or the connection is broken. Aborting.",
    );
  }

  const stamp   = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
  const outPath = path.join(
    "docs", "prompts", "drafts",
    `mo_order_form_index-backup-${stamp}.json`,
  );

  const payload = {
    capturedAt:  new Date().toISOString(),
    sourceTable: "mo_order_form_index",
    rowCount:    rows.length,
    schemaNote:
      "Pre-Phase B snapshot. Includes ALL rows (active + inactive). To " +
      "restore manually: TRUNCATE the table, then INSERT each row. " +
      "Sequence on `id` may need ALTER ... RESTART afterwards.",
    rows,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");

  // eslint-disable-next-line no-console
  console.log(`✓ Backed up ${rows.length} rows → ${outPath}`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("✗ Backup failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
