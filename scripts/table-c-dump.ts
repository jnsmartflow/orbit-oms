// READ-ONLY offline dump of Table C (emitted-name + pack -> SAP material).
// Builds the dictionary via lib/mail-orders/table-c.ts using the SAME v2
// catalog rows GET /api/order/data serves (menu = mo_order_form_index_v2
// isActive, stock = mo_sku_lookup_v2 isPrimary=true), writes a dated CSV under
// docs/SKU/, and prints a console summary. Writes NOTHING to the database and
// wires NOTHING into enrich.ts — pure review artifact.
//
// Run:  npx tsx scripts/table-c-dump.ts
/* eslint-disable no-console */

import { writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { buildTableC } from "../lib/mail-orders/table-c";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL ?? process.env.DIRECT_URL } },
  log: ["error"],
});

// Minimal CSV field escaper — quote when the value carries a comma, quote, or
// newline; double any embedded quotes (RFC-4180).
function csv(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

async function main(): Promise<void> {
  // Sequential awaits — no prisma.$transaction (CORE §3).
  const menuRows = await prisma.mo_order_form_index_v2.findMany({
    where:  { isActive: true },
    select: { product: true, subProduct: true, baseColour: true },
    orderBy: [{ family: "asc" }, { sortOrder: "asc" }],
  });

  const stockRows = await prisma.mo_sku_lookup_v2.findMany({
    where:  { isPrimary: true },
    select: {
      product:    true,
      baseColour: true,
      packCode:   true,
      unit:       true,
      material:   true,
      isPrimary:  true,
    },
  });

  const result = buildTableC(menuRows, stockRows);

  // ── Write the dated CSV ────────────────────────────────────────────────
  const date    = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const csvPath = join(process.cwd(), "docs", "SKU", `table-c-dump-${date}.csv`);

  const header = "key,name,baseColour,packCodeRaw,unit,packLabel,cleanPack,material,collision";
  const body = result.records.map((r) =>
    [
      csv(r.key),
      csv(r.name),
      csv(r.baseColour ?? ""),
      csv(r.packCodeRaw),
      csv(r.unit ?? ""),
      csv(r.packLabel),
      csv(r.cleanPack),
      csv(r.material),
      result.collisionKeys.has(r.key) ? "Y" : "N",
    ].join(","),
  );
  writeFileSync(csvPath, [header, ...body].join("\n") + "\n", "utf8");

  // ── Console summary ────────────────────────────────────────────────────
  console.log("─".repeat(60));
  console.log("Table C dump");
  console.log("─".repeat(60));
  console.log(`Menu rows scanned        : ${result.menuRowsScanned}`);
  console.log(`Distinct keys built      : ${result.table.size}`);
  console.log(`Total dictionary entries : ${result.records.length}`);
  console.log(`Menu rows w/ ZERO keys   : ${result.menuRowsZeroKeys}  (null-product / unjoined — risk rows)`);
  console.log(`Collision keys           : ${result.collisions.length}`);
  if (result.collisions.length > 0) {
    console.log("Clashing keys (key -> distinct materials):");
    for (const c of result.collisions) {
      console.log(`  ${c.key}  ->  ${c.materials.join(" | ")}`);
    }
  }
  console.log("─".repeat(60));
  console.log(`CSV written: ${csvPath}`);
}

main()
  .catch((err) => {
    console.error("[table-c-dump] error", err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
