// Backup all current mo_order_form_index rows to JSON before Phase 1
// reseed wipes them. Output: docs/prompts/drafts/mo_order_form_index-
// backup-2026-05-06.json. Read-only; no DB writes. Run with:
//   npx tsx scripts/backup-mo-order-form-index.ts

import { PrismaClient } from "@prisma/client";
import { promises as fs } from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

const OUT_PATH = path.join(
  "docs",
  "prompts",
  "drafts",
  "mo_order_form_index-backup-2026-05-06.json",
);

async function main(): Promise<void> {
  const rows = await prisma.mo_order_form_index.findMany({
    orderBy: [{ family: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
  });

  const out = {
    capturedAt:  new Date().toISOString(),
    sourceTable: "mo_order_form_index",
    rowCount:    rows.length,
    schemaNote:
      "Captured before Phase 1 taxonomy redesign reseed. Use as rollback " +
      "source if needed: TRUNCATE the table then INSERT each row preserving " +
      "id values (sequence may need ALTER ... RESTART afterwards).",
    rows,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2), "utf8");

  // eslint-disable-next-line no-console
  console.log(`✓ Backed up ${rows.length} rows → ${OUT_PATH}`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
