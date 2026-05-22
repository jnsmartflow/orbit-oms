// scripts/classify-sampling-excel.ts
//
// Sampling Library — Excel classifier (post 3a-recover SKU-master fallback).
// Phase A (default):   inspect Excel structure and exit.
// Phase B (CLASSIFY=1): classify rows + write reviewable output, using SAP
//                       stock as the primary fallback and legacy sku-master
//                       as the secondary fallback when DESC is blank or its
//                       tail is unparseable.
//
// Spec:  docs/prompts/drafts/SAMPLING_LIBRARY_DESIGN_SPEC.md
//
// Run (inspect):  npx tsx scripts/classify-sampling-excel.ts
// Run (classify): $env:CLASSIFY="1"; npx tsx scripts/classify-sampling-excel.ts
// PS quoting fallback: bash -c "CLASSIFY=1 npx tsx scripts/classify-sampling-excel.ts"

import * as XLSX from "xlsx";
import * as path from "path";
import * as fs from "fs";
import {
  SOURCE_PATH,
  STOCK_PATH,
  SKU_MASTER_PATH,
  runClassification,
  type Action,
  type NormalisedRow,
  type ClassificationResult,
} from "./lib/sampling-classifier";

const OUTPUT_PATH = "docs/plans/sampling-register/Tinting_data_Tracker_N_REVIEWED.xlsx";

// ── Phase A — inspect ───────────────────────────────────────────────────────

function inspect(wb: XLSX.WorkBook): void {
  console.log("===== Excel structure =====");
  console.log(`Total sheets: ${wb.SheetNames.length}`);
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    const headers: string[] = ((raw[0] ?? []) as unknown[]).map((c) => (c == null ? "" : String(c)));
    const sample: unknown[] = (raw[1] ?? []) as unknown[];
    const sampleObj: Record<string, unknown> = {};
    for (let i = 0; i < headers.length; i++) {
      sampleObj[headers[i] || `col${i + 1}`] = sample[i] ?? null;
    }
    console.log("");
    console.log(`Sheet: ${name}`);
    console.log(`  Total rows: ${Math.max(0, raw.length - 1)}`);
    console.log(`  Total cols: ${headers.length}`);
    console.log(`  Headers: ${JSON.stringify(headers)}`);
    console.log(`  Sample row 2: ${JSON.stringify(sampleObj)}`);
  }
}

// ── Phase B — classify + write reviewed Excel ───────────────────────────────

function isNonIntegerSamplingRaw(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "number") return Number.isFinite(v) && Math.floor(v) !== v;
  const s = String(v).trim();
  return /^\d+\.\d+$/.test(s);
}

function classify(wb: XLSX.WorkBook): void {
  if (!fs.existsSync(STOCK_PATH)) {
    console.error(`Stock file not found: ${STOCK_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(SKU_MASTER_PATH)) {
    console.error(`SKU master not found: ${SKU_MASTER_PATH}`);
    process.exit(1);
  }

  const result: ClassificationResult = runClassification(wb);
  const { stockLoad, legacyLoad, sheetMetas, includedSheets, canonHeaders,
          sheetRowsByName, allRows, invalidRows, groups, decisions } = result;

  console.log("");
  console.log("===== SKU sources loaded =====");
  console.log(`Stock file:    ${stockLoad.map.size} unique SKUs (collisions: ${stockLoad.collisions})`);
  console.log(`Legacy master: ${legacyLoad.map.size} unique SKUs (collisions: ${legacyLoad.collisions.length})`);

  console.log("");
  console.log("===== Sheet inclusion =====");
  for (const m of sheetMetas) {
    console.log(`  ${m.included ? "INCLUDE" : "EXCLUDE"}  "${m.name}"  ${m.excludeReason ? `(${m.excludeReason})` : ""}`);
  }

  // ── Write output Excel ─────────────────────────────────────────────────────
  const outHeaders = [...canonHeaders, "Action", "Remarks"];
  const dataAoa: unknown[][] = [outHeaders];

  for (const m of includedSheets) {
    const rows = sheetRowsByName.get(m.name) ?? [];
    for (const row of rows) {
      let action: Action;
      let remarks: string;
      if (row.samplingNo == null) {
        action = "SKIP";
        if (isNonIntegerSamplingRaw(row.samplingRaw)) {
          remarks = "non-integer sampling no";
        } else {
          remarks = "invalid sampling no";
        }
      } else {
        const d = decisions.get(row.samplingNo)!;
        action = d.action;
        remarks = d.remarks;
      }
      dataAoa.push([...row.originalCells, action, remarks]);
    }
  }
  const dataSheet = XLSX.utils.aoa_to_sheet(dataAoa);

  const summaryAoa: unknown[][] = [
    ["samplingNo", "rowCount", "action", "remarks", "shadeNames", "skuCodes", "tinterType"],
  ];
  const orderedKeys = Array.from(groups.keys()).sort((a, b) => a - b);
  for (const no of orderedKeys) {
    const rows = groups.get(no)!;
    const d = decisions.get(no)!;
    summaryAoa.push([
      no, rows.length, d.action, d.remarks,
      d.shadeNames.join(" | "), d.skuCodes.join(" | "), d.tinterType,
    ]);
  }
  if (invalidRows.length > 0) {
    summaryAoa.push([null, invalidRows.length, "SKIP", "rows without a valid sampling no", "", "", ""]);
  }
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryAoa);

  const outWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(outWb, dataSheet, "Data");
  XLSX.utils.book_append_sheet(outWb, summarySheet, "Summary");

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  XLSX.writeFile(outWb, OUTPUT_PATH);

  // ── Terminal summary ───────────────────────────────────────────────────────
  let fromDesc   = 0;
  let fromStock  = 0;
  let fromLegacy = 0;
  let unresolved = 0;
  for (const r of allRows) {
    if (r.packSource === "desc")        fromDesc   += 1;
    else if (r.packSource === "stock")  fromStock  += 1;
    else if (r.packSource === "legacy") fromLegacy += 1;
    else                                unresolved += 1;
  }

  const counts: Record<Action, { groups: number; rows: number }> = {
    IMPORT: { groups: 0, rows: 0 },
    REVIEW: { groups: 0, rows: 0 },
    SKIP:   { groups: 0, rows: 0 },
  };
  const reviewReasons = new Map<string, number>();
  const skipReasons   = new Map<string, number>();
  let recoveryImpact = 0;
  for (const [no, d] of Array.from(decisions.entries())) {
    const rows = groups.get(no)!;
    counts[d.action].groups += 1;
    counts[d.action].rows   += rows.length;
    if (d.action === "IMPORT" && rows.some((r: NormalisedRow) => r.descBlank)) {
      recoveryImpact += 1;
    }
    if (d.action === "REVIEW") {
      const first = d.remarks.split(" | ")[0] || "other";
      const bucket = first.startsWith("multi-shade")                                ? "multi-shade"
        : first.startsWith("partial blank")                                         ? "partial blank shadeName"
        : first.startsWith("unknown pack")                                          ? "unknown pack"
        : first.startsWith("no DESC, SKU not in stock or legacy master")            ? "no DESC, SKU not in stock or legacy master"
        : first.startsWith("no DESC, SKU in master but pack unrecognized")          ? "no DESC, SKU in master but pack unrecognized"
        : first;
      reviewReasons.set(bucket, (reviewReasons.get(bucket) ?? 0) + 1);
    } else if (d.action === "SKIP") {
      skipReasons.set(d.remarks, (skipReasons.get(d.remarks) ?? 0) + 1);
    }
  }
  if (invalidRows.length > 0) {
    counts.SKIP.rows += invalidRows.length;
    const key = "invalid/non-integer sampling no";
    skipReasons.set(key, (skipReasons.get(key) ?? 0) + invalidRows.length);
  }

  console.log("");
  console.log("===== Classification summary =====");
  console.log(`Total rows read:               ${allRows.length}`);
  console.log(`Total unique sampling numbers: ${groups.size}`);
  console.log("");
  console.log("===== Pack source breakdown =====");
  console.log(`From DESC column:               ${fromDesc} rows`);
  console.log(`Recovered via stock master:     ${fromStock} rows`);
  console.log(`Recovered via legacy master:    ${fromLegacy} rows`);
  console.log(`Unresolved (REVIEW):            ${unresolved} rows`);
  console.log("");
  console.log(`IMPORT: ${counts.IMPORT.groups} sampling nos (${counts.IMPORT.rows} rows)`);
  console.log(`REVIEW: ${counts.REVIEW.groups} sampling nos (${counts.REVIEW.rows} rows)`);
  console.log(`SKIP:   ${counts.SKIP.groups} sampling nos (${counts.SKIP.rows} rows)`);

  console.log("");
  console.log("Top 5 REVIEW reasons:");
  const sortedReview = Array.from(reviewReasons.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (sortedReview.length === 0) console.log("  (none)");
  else sortedReview.forEach((entry, i) => console.log(`  ${i + 1}. ${entry[0]} — ${entry[1]} sampling nos`));

  console.log("");
  console.log("Top 5 SKIP reasons:");
  const sortedSkip = Array.from(skipReasons.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (sortedSkip.length === 0) console.log("  (none)");
  else sortedSkip.forEach((entry, i) => console.log(`  ${i + 1}. ${entry[0]} — ${entry[1]}`));

  console.log("");
  console.log("===== Recovery impact vs previous run =====");
  console.log(`Sampling nos previously REVIEW for missing SKU → now IMPORT: ${recoveryImpact}`);

  console.log("");
  console.log(`Output written to: ${OUTPUT_PATH}`);
}

// ── Entry point ──────────────────────────────────────────────────────────────

function main(): void {
  const abs = path.resolve(SOURCE_PATH);
  if (!fs.existsSync(abs)) {
    console.error(`Source file not found: ${SOURCE_PATH}`);
    process.exit(1);
  }
  const wb = XLSX.readFile(abs, { cellDates: false });

  inspect(wb);

  if (process.env.CLASSIFY !== "1") {
    console.log("");
    console.log("Set CLASSIFY=1 to run classification and write output Excel.");
    process.exit(0);
  }

  classify(wb);
  console.log("");
  console.log("Re-classification complete. New reviewed Excel ready. Awaiting Smart Flow review of updated IMPORT/REVIEW/SKIP buckets.");
}

main();
