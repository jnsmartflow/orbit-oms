// scripts/repair-sampling-import-deliveryno.ts
//
// Backfills sampling_usage_log.deliveryNumber from the source Excel using
// the same (samplingNo, sourceRowIndex) alignment pattern as REPAIR-1a in
// scripts/repair-sampling-import.ts.
//
// Source: docs/plans/sampling-register/Tinting_data_Tracker_N_REVIEWED.xlsx
//   - REVIEWED preserves all original headers and adds the Action column.
//   - Importer only ingested Action=IMPORT rows; this script joins on those.
//   - sourceRowIndex on each DB row equals (Excel row index in raw array) + 1
//     — i.e. the Excel UI row number.
//
// Modes (--mode flag):
//   audit   — read-only; counts + alignment check + sample preview.
//   commit  — re-runs audit, prompts for "yes", then sequential UPDATEs.
//
// Engineering rules (CORE §3):
//   - NO prisma.$transaction. Sequential awaits only.
//   - Idempotent: UPDATE only fires when DB.deliveryNumber IS NULL and
//     Excel value is non-blank; the WHERE clause double-guards against
//     races.
//   - Read-only in audit mode.
//   - No new dependencies; xlsx + readline are already standard.
//
// Run:
//   npx tsx scripts/repair-sampling-import-deliveryno.ts --mode=audit
//   npx tsx scripts/repair-sampling-import-deliveryno.ts --mode=commit

import * as fs       from "fs";
import * as readline from "readline";
import * as XLSX     from "xlsx";
import { PrismaClient } from "@prisma/client";
import {
  buildColumnMap,
  toIntOrNull,
  toStrTrimmed,
} from "./lib/sampling-classifier";

const prisma = new PrismaClient();
const REVIEWED_PATH = "docs/plans/sampling-register/Tinting_data_Tracker_N_REVIEWED.xlsx";

// ── Types ───────────────────────────────────────────────────────────────────

interface PlanRow {
  samplingNo:     number;
  sourceRowIndex: number;
  dbId:           number;
  intended:       string;
}

interface AuditCounts {
  excelTotal:                int;
  excelImportRows:           int;
  excelWithDeliveryNonBlank: int;
  excelWithBlankDelivery:    int;
  dbTotal:                   int;
  dbAlreadyPopulated:        int;
  dbNull:                    int;
  willUpdate:                int;
  skipBlank:                 int;
  skipPopulated:             int;
  skipAlignmentFailure:      int;
}

// (TypeScript has no `int`; this is a local readability alias.)
type int = number;

interface PlanResult {
  deliveryColIdx: number;
  plan:           PlanRow[];
  counts:         AuditCounts;
  alignment: {
    excelOnly:     number[];
    dbOnly:        number[];
    countMismatch: Array<{ samplingNo: number; excelRows: number; dbRows: number }>;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function findHeader(headers: string[], re: RegExp): number {
  const norm = headers.map((h) => h.trim().toLowerCase().replace(/[\s_.\-/()]+/g, ""));
  for (let i = 0; i < norm.length; i++) {
    if (re.test(norm[i])) return i;
  }
  return -1;
}

function askYesNo(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    let resolved = false;
    const done = (v: string): void => {
      if (resolved) return;
      resolved = true;
      rl.close();
      resolve(v);
    };
    rl.question(prompt, (a) => done(a));
    rl.on("close", () => done(""));
  });
}

// ── Plan builder (shared by audit + commit) ────────────────────────────────

async function loadAndPlan(): Promise<PlanResult> {
  if (!fs.existsSync(REVIEWED_PATH)) {
    throw new Error(`Source Excel not found: ${REVIEWED_PATH}`);
  }
  const wb = XLSX.readFile(REVIEWED_PATH, { cellDates: false });
  const sheet = wb.Sheets["Data"];
  if (!sheet) throw new Error("Data sheet not found in REVIEWED.xlsx");
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  if (raw.length === 0) throw new Error("Data sheet is empty");

  const headers: string[] = ((raw[0] ?? []) as unknown[]).map((c) => (c == null ? "" : String(c)));
  const cm = buildColumnMap(headers);
  if (cm.samplingNo == null) throw new Error("samplingNo column not found in REVIEWED.xlsx");

  const actionColIdx   = headers.findIndex((h) => h.trim().toLowerCase() === "action");
  if (actionColIdx < 0) throw new Error("Action column not found in REVIEWED.xlsx");

  const deliveryColIdx = findHeader(headers, /^(delivery(no|number)?|deliveryno)$/);
  if (deliveryColIdx < 0) {
    throw new Error("Delivery no header not found in REVIEWED.xlsx (looked for delivery / deliveryno / deliverynumber)");
  }

  // ── Walk Excel ──────────────────────────────────────────────────────────
  let excelTotal           = 0;
  let excelImportRows      = 0;
  let excelBlankDelivery   = 0;
  let excelNonBlankDelivery = 0;

  type ExcelImport = { samplingNo: number; sourceRowIndex: number; deliveryNo: string | null };
  const excelImport: ExcelImport[] = [];
  const excelBySnoCount = new Map<number, number>();

  for (let r = 1; r < raw.length; r++) {
    const row = raw[r];
    if (!Array.isArray(row)) continue;
    if (row.every((c) => c == null || (typeof c === "string" && c.trim() === ""))) continue;
    excelTotal += 1;

    const action = toStrTrimmed(row[actionColIdx]);
    if (action !== "IMPORT") continue;
    excelImportRows += 1;

    const samplingNo = toIntOrNull(row[cm.samplingNo!]);
    if (samplingNo == null) continue;

    const sourceRowIndex = r + 1; // matches importer's r+1 convention
    const deliveryRaw    = row[deliveryColIdx];
    const deliveryStr    = deliveryRaw == null ? "" : String(deliveryRaw).trim();

    if (deliveryStr === "") excelBlankDelivery   += 1;
    else                    excelNonBlankDelivery += 1;

    excelImport.push({
      samplingNo,
      sourceRowIndex,
      deliveryNo: deliveryStr === "" ? null : deliveryStr,
    });
    excelBySnoCount.set(samplingNo, (excelBySnoCount.get(samplingNo) ?? 0) + 1);
  }

  // ── Load DB rows ────────────────────────────────────────────────────────
  const dbRows = await prisma.sampling_usage_log.findMany({
    select: {
      id:             true,
      samplingNo:     true,
      sourceRowIndex: true,
      deliveryNumber: true,
    },
  });
  const dbTotal            = dbRows.length;
  const dbAlreadyPopulated = dbRows.filter((r) => r.deliveryNumber !== null).length;
  const dbNull             = dbTotal - dbAlreadyPopulated;

  const dbBySnoCount = new Map<number, number>();
  const dbByKey     = new Map<string, { id: number; deliveryNumber: string | null }>();
  for (const r of dbRows) {
    dbBySnoCount.set(r.samplingNo, (dbBySnoCount.get(r.samplingNo) ?? 0) + 1);
    if (r.sourceRowIndex != null) {
      dbByKey.set(`${r.samplingNo}|${r.sourceRowIndex}`, {
        id:             r.id,
        deliveryNumber: r.deliveryNumber,
      });
    }
  }

  // ── Alignment check ─────────────────────────────────────────────────────
  const allSnos = new Set<number>([
    ...Array.from(excelBySnoCount.keys()),
    ...Array.from(dbBySnoCount.keys()),
  ]);
  const excelOnly:     number[] = [];
  const dbOnly:        number[] = [];
  const countMismatch: Array<{ samplingNo: number; excelRows: number; dbRows: number }> = [];
  for (const sno of Array.from(allSnos)) {
    const e = excelBySnoCount.get(sno) ?? 0;
    const d = dbBySnoCount.get(sno) ?? 0;
    if (e > 0 && d === 0) excelOnly.push(sno);
    else if (d > 0 && e === 0) dbOnly.push(sno);
    else if (e !== d) countMismatch.push({ samplingNo: sno, excelRows: e, dbRows: d });
  }
  // Stable order helps when comparing audit runs across days.
  excelOnly.sort((a, b) => a - b);
  dbOnly.sort((a, b) => a - b);
  countMismatch.sort((a, b) => a.samplingNo - b.samplingNo);

  // ── Build plan ──────────────────────────────────────────────────────────
  const plan: PlanRow[] = [];
  let skipBlank            = 0;
  let skipPopulated        = 0;
  let skipAlignmentFailure = 0;

  for (const e of excelImport) {
    if (e.deliveryNo === null) {
      skipBlank += 1;
      continue;
    }
    const db = dbByKey.get(`${e.samplingNo}|${e.sourceRowIndex}`);
    if (!db) {
      skipAlignmentFailure += 1;
      continue;
    }
    if (db.deliveryNumber !== null) {
      skipPopulated += 1;
      continue;
    }
    plan.push({
      samplingNo:     e.samplingNo,
      sourceRowIndex: e.sourceRowIndex,
      dbId:           db.id,
      intended:       e.deliveryNo,
    });
  }

  return {
    deliveryColIdx,
    plan,
    counts: {
      excelTotal,
      excelImportRows,
      excelWithDeliveryNonBlank: excelNonBlankDelivery,
      excelWithBlankDelivery:    excelBlankDelivery,
      dbTotal,
      dbAlreadyPopulated,
      dbNull,
      willUpdate:           plan.length,
      skipBlank,
      skipPopulated,
      skipAlignmentFailure,
    },
    alignment: { excelOnly, dbOnly, countMismatch },
  };
}

// ── Audit print ────────────────────────────────────────────────────────────

function printAudit(result: PlanResult, header: string): void {
  console.log(`=== SAMPLING USAGE LOG — DELIVERY NO BACKFILL (${header}) ===`);
  console.log(`Source Excel: ${REVIEWED_PATH}`);
  console.log(`Excel header located: "Delivery no" at column index ${result.deliveryColIdx}`);
  console.log("");

  console.log("Excel row counts:");
  console.log(`  Total rows in Excel: ${result.counts.excelTotal}`);
  console.log(`  Rows with Action=IMPORT: ${result.counts.excelImportRows}`);
  console.log(`  Rows with samplingNo + non-blank delivery no: ${result.counts.excelWithDeliveryNonBlank}`);
  console.log(`  Rows with blank delivery no: ${result.counts.excelWithBlankDelivery}`);
  console.log("");

  console.log("DB row counts:");
  console.log(`  Total sampling_usage_log rows: ${result.counts.dbTotal}`);
  console.log(`  Rows with deliveryNumber already populated: ${result.counts.dbAlreadyPopulated}`);
  console.log(`  Rows with NULL deliveryNumber: ${result.counts.dbNull}`);
  console.log("");

  console.log("Alignment check:");
  const sampleExcelOnly = result.alignment.excelOnly.slice(0, 5).join(", ") || "—";
  const sampleDbOnly    = result.alignment.dbOnly.slice(0, 5).join(", ")    || "—";
  console.log(`  SamplingNos in Excel but missing in DB: ${result.alignment.excelOnly.length}  (sample first 5: ${sampleExcelOnly})`);
  console.log(`  SamplingNos in DB but missing in Excel: ${result.alignment.dbOnly.length}  (sample first 5: ${sampleDbOnly})`);
  console.log(`  SamplingNos where Excel row count ≠ DB row count: ${result.alignment.countMismatch.length}`);
  for (const m of result.alignment.countMismatch.slice(0, 5)) {
    console.log(`    samplingNo=${m.samplingNo}, excelRows=${m.excelRows}, dbRows=${m.dbRows}`);
  }
  console.log("");

  console.log("Sample of intended UPDATEs (first 10 rows):");
  if (result.plan.length === 0) {
    console.log("  (none)");
  } else {
    for (const p of result.plan.slice(0, 10)) {
      console.log(`  samplingNo=${p.samplingNo}, sourceRowIndex=${p.sourceRowIndex}, currentDeliveryNumber=NULL → '${p.intended}'`);
    }
  }
  console.log("");

  console.log("=== SUMMARY ===");
  console.log(`Rows that will be updated: ${result.counts.willUpdate}`);
  console.log(`Rows that will be skipped (blank Excel value): ${result.counts.skipBlank}`);
  console.log(`Rows that will be skipped (already populated): ${result.counts.skipPopulated}`);
  console.log(`Rows with no matching Excel row (alignment failure): ${result.counts.skipAlignmentFailure}`);
}

// ── Modes ──────────────────────────────────────────────────────────────────

async function runAudit(): Promise<void> {
  const result = await loadAndPlan();
  printAudit(result, "AUDIT");
}

async function runCommit(): Promise<void> {
  const result = await loadAndPlan();
  printAudit(result, "COMMIT — DRY PASS");
  console.log("");

  if (result.counts.willUpdate === 0) {
    console.log("Nothing to update. Exiting.");
    return;
  }

  const answer = await askYesNo("Type 'yes' to proceed with UPDATE, anything else to abort: ");
  if (answer !== "yes") {
    console.log("Aborted. No rows updated.");
    return;
  }
  console.log("");
  console.log("Running UPDATEs (sequential)...");

  let updated  = 0;
  let attempts = 0;
  for (const p of result.plan) {
    attempts += 1;
    try {
      // Idempotent guard: only update if still NULL. $executeRaw returns
      // the affected row count.
      const affected = Number(await prisma.$executeRaw`
        UPDATE sampling_usage_log
           SET "deliveryNumber" = ${p.intended}
         WHERE id = ${p.dbId}
           AND "deliveryNumber" IS NULL
      `);
      updated += affected;
      if (attempts % 500 === 0 || attempts === result.plan.length) {
        console.log(`Updated ${updated} / ${result.plan.length} processed (attempts=${attempts})...`);
      }
    } catch (err) {
      console.error("");
      console.error(`Failed at samplingNo=${p.samplingNo} sourceRowIndex=${p.sourceRowIndex} dbId=${p.dbId}:`);
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  console.log("");
  console.log("=== DONE ===");
  console.log(`Rows updated: ${updated}`);
  console.log(`Rows skipped (blank): ${result.counts.skipBlank}`);
  console.log(`Rows skipped (already populated): ${result.counts.skipPopulated}`);
  console.log(`Rows skipped (alignment failure): ${result.counts.skipAlignmentFailure}`);
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args    = process.argv.slice(2);
  const modeArg = args.find((a) => a.startsWith("--mode=")) ?? "--mode=audit";
  const mode    = modeArg.split("=")[1] ?? "audit";

  if (mode === "audit") {
    await runAudit();
  } else if (mode === "commit") {
    await runCommit();
  } else {
    console.error(`Unknown mode: ${mode}. Use --mode=audit or --mode=commit`);
    process.exit(1);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
