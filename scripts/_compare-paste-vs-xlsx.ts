/** SCRATCH — READ-ONLY. Proves lib/sap-paste produces the same ParseResult as
 *  lib/sap-parser for the same day (12.09.2026), apart from the two customer
 *  name fields the SAP screen list cuts short. Writes nothing. The only DB touch
 *  is the sku_master_v2 catalog SELECT inside buildObds, which BOTH parsers do.
 *
 *  Run: npx tsx scripts/_compare-paste-vs-xlsx.ts
 */
import * as fs from "fs";
import * as path from "path";
import { parseSapFile } from "../lib/sap-parser";
import { parseSapPaste, readPaste } from "../lib/sap-paste";
import { prisma } from "../lib/prisma";

const ROOT       = path.resolve(__dirname, "..");
const PASTE_PATH = path.join(ROOT, "docs", "fixtures", "12.09.2026.txt");
const XLSX_PATH  = path.join(ROOT, "docs", "fixtures", "EXPORT 12.09.XLSX");
const DATE       = new Date("2026-09-12");

const LINE_FIELDS = [
  "lineId", "skuCodeRaw", "unitQty", "volumeLine", "netWeight", "totalWeight",
  "batchCode", "isTinting",
] as const;
const NAME_FIELDS = ["billToCustomerName", "shipToCustomerName"] as const;

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures += 1;
}
const j = (v: unknown) => JSON.stringify(v);

async function main(): Promise<void> {
  const block = fs.readFileSync(PASTE_PATH, "utf8");
  const xbuf  = fs.readFileSync(XLSX_PATH);

  // ── The reader on its own ────────────────────────────────────────────────
  const read = readPaste(block);
  console.log("\n=== readPaste ===");
  console.log({ headerLine: read.headerLine, totalRows: read.totalRows, rows: read.rows.length,
                convertedSubItems: read.convertedSubItems, errors: read.errors.length, fatal: read.fatal });
  for (const e of read.errors.slice(0, 10)) console.log("  ERR", e.sourceLine, e.message);
  const sum = (k: "deliveryQuantity" | "volume" | "netWeight" | "totalWeight") =>
    read.rows.reduce((a, r) => a + (r[k] ?? 0), 0);
  const totals = { qty: sum("deliveryQuantity"), volume: sum("volume"), net: sum("netWeight"), total: sum("totalWeight") };
  console.log("raw-row totals:", { qty: totals.qty, volume: totals.volume.toFixed(1),
    net: totals.net.toFixed(3), total: totals.total.toFixed(3) });
  check("1,556 rows read", read.rows.length === 1556, String(read.rows.length));
  check("733 sub-items converted", read.convertedSubItems === 733, String(read.convertedSubItems));
  check("0 errors, no fatal", read.errors.length === 0 && read.fatal === null);
  check("totals qty 9,340", totals.qty === 9340, String(totals.qty));
  check("totals volume 44,976.2", totals.volume.toFixed(1) === "44976.2", totals.volume.toFixed(3));
  check("totals net 53,066.991", totals.net.toFixed(3) === "53066.991", totals.net.toFixed(3));
  check("totals total 56,712.080", totals.total.toFixed(3) === "56712.080", totals.total.toFixed(3));

  // ── Both pipelines ──────────────────────────────────────────────────────
  const paste = await parseSapPaste(block, { fallbackObdEmailDate: DATE });
  const xlsx  = await parseSapFile(xbuf, { fallbackObdEmailDate: DATE });
  if (paste.kind !== "ok") {
    console.log("\nPASTE BLOCKED:", paste.error);
    for (const e of paste.errors.slice(0, 20)) console.log("  ", e.sourceLine, e.message);
    process.exitCode = 1;
    return;
  }
  const p = paste.result;

  console.log("\n=== fileStats ===");
  console.log("paste:", p.fileStats);
  console.log("xlsx: ", xlsx.fileStats);
  check("fileStats identical", j(p.fileStats) === j(xlsx.fileStats));

  console.log("\n=== OBDs ===");
  check("229 OBDs (paste)", p.obds.length === 229, String(p.obds.length));
  check("OBD count identical", p.obds.length === xlsx.obds.length, `${p.obds.length} vs ${xlsx.obds.length}`);
  check("OBD numbers identical, same order",
    j(p.obds.map((o) => o.obdNumber)) === j(xlsx.obds.map((o) => o.obdNumber)));

  const itemCategoryByRow = (rows: typeof read.rows) => new Map(rows.map((r) => [r.rowNumber, r.itemCategory]));

  let lineMismatch = 0, headerMismatch = 0, otherMismatch = 0;
  const nameDiffs: Array<{ obd: string; field: string; paste: string | null; xlsx: string | null; prefix: boolean }> = [];
  const n = Math.min(p.obds.length, xlsx.obds.length);
  for (let i = 0; i < n; i += 1) {
    const a = p.obds[i], b = xlsx.obds[i];
    if (a.lines.length !== b.lines.length) {
      lineMismatch += 1;
      console.log(`  line count ${a.obdNumber}: ${a.lines.length} vs ${b.lines.length}`);
      continue;
    }
    for (let k = 0; k < a.lines.length; k += 1) {
      for (const f of LINE_FIELDS) {
        if (a.lines[k][f] !== b.lines[k][f]) {
          lineMismatch += 1;
          if (lineMismatch <= 15) console.log(`  line ${a.obdNumber}#${k} ${f}: ${j(a.lines[k][f])} vs ${j(b.lines[k][f])}`);
        }
      }
      // Everything else on the line (description, article, articleTag).
      const { lineId: _a, skuCodeRaw: _b, unitQty: _c, volumeLine: _d, netWeight: _e, totalWeight: _f, batchCode: _g, isTinting: _h, ...restA } = a.lines[k];
      const { lineId: _a2, skuCodeRaw: _b2, unitQty: _c2, volumeLine: _d2, netWeight: _e2, totalWeight: _f2, batchCode: _g2, isTinting: _h2, ...restB } = b.lines[k];
      if (j(restA) !== j(restB)) {
        otherMismatch += 1;
        if (otherMismatch <= 10) console.log(`  line-other ${a.obdNumber}#${k}: ${j(restA)} vs ${j(restB)}`);
      }
    }
    if (a.volume !== b.volume || a.grossWeight !== b.grossWeight) {
      headerMismatch += 1;
      console.log(`  summary ${a.obdNumber}: volume ${a.volume} vs ${b.volume}, grossWeight ${a.grossWeight} vs ${b.grossWeight}`);
    }
    for (const f of NAME_FIELDS) {
      if (a[f] !== b[f]) {
        nameDiffs.push({ obd: a.obdNumber, field: f, paste: a[f], xlsx: b[f],
          prefix: (b[f] ?? "").startsWith(a[f] ?? "") });
      }
    }
    // Every other header field (division, warehouse, soNumber, codes, totals, date…).
    const { lines: _l, billToCustomerName: _n1, shipToCustomerName: _n2, ...hA } = a;
    const { lines: _l2, billToCustomerName: _m1, shipToCustomerName: _m2, ...hB } = b;
    if (j(hA) !== j(hB)) {
      otherMismatch += 1;
      if (otherMismatch <= 10) console.log(`  header-other ${a.obdNumber}: ${j(hA)} vs ${j(hB)}`);
    }
  }
  check("every line: lineId/sku/qty/volume/net/total/batch/isTinting identical", lineMismatch === 0, `${lineMismatch} mismatches`);
  check("every OBD: summary volume + grossWeight identical", headerMismatch === 0, `${headerMismatch} mismatches`);
  check("everything else except names identical (description, article, articleTag, header fields)", otherMismatch === 0, `${otherMismatch} mismatches`);

  // itemCategory is not on ObdLineInput — compare it on the raw rows, matched
  // by sheet-equivalent row number (the paste numbers its rows to line up).
  // Parsing the xlsx rows again through the reader the file path uses:
  const { readSheet } = await import("../lib/sap-parser/read-sheet");
  const xrows = readSheet(xbuf).rows;
  const pc = itemCategoryByRow(read.rows), xc = itemCategoryByRow(xrows);
  let catMismatch = 0;
  check("raw row numbers identical", j(read.rows.map((r) => r.rowNumber)) === j(xrows.map((r) => r.rowNumber)));
  Array.from(xc.entries()).forEach(([row, cat]) => { if (pc.get(row) !== cat) catMismatch += 1; });
  check("every row: itemCategory identical", catMismatch === 0 && pc.size === xc.size, `${catMismatch} mismatches`);
  // Whole raw row, except names — the strongest form of the claim.
  let rawOther = 0;
  for (let i = 0; i < Math.min(read.rows.length, xrows.length); i += 1) {
    const { soldToName: _s, shipToName: _t, ...ra } = read.rows[i];
    const { soldToName: _s2, shipToName: _t2, ...rb } = xrows[i];
    if (j(ra) !== j(rb)) {
      rawOther += 1;
      if (rawOther <= 10) console.log(`  raw row ${ra.rowNumber}: ${j(ra)}\n           vs ${j(rb)}`);
    }
  }
  check("every raw row identical except the two names", rawOther === 0, `${rawOther} mismatches`);

  console.log("\n=== skipped + warnings ===");
  console.log(`paste skipped ${p.skipped.length}, xlsx skipped ${xlsx.skipped.length}; paste warnings ${p.warnings.length}, xlsx warnings ${xlsx.warnings.length}`);
  check("skipped-delivery lists identical", j(p.skipped) === j(xlsx.skipped));
  check("warning lists identical", j(p.warnings) === j(xlsx.warnings));

  console.log("\n=== customer-name differences (allowed — not a failure) ===");
  const byField = (f: string) => nameDiffs.filter((d) => d.field === f);
  for (const f of NAME_FIELDS) {
    const d = byField(f);
    console.log(`${f}: ${d.length} OBDs differ; paste text is a prefix of the xlsx name in ${d.filter((x) => x.prefix).length}`);
  }
  const maxLen = (f: typeof NAME_FIELDS[number]) => Math.max(...p.obds.map((o) => (o[f] ?? "").length));
  console.log(`longest pasted name: billTo ${maxLen("billToCustomerName")}, shipTo ${maxLen("shipToCustomerName")}`);
  for (const d of nameDiffs.slice(0, 12)) console.log(`  ${d.obd} ${d.field}: "${d.paste}"  <  "${d.xlsx}"${d.prefix ? "" : "   ⚠ NOT A PREFIX"}`);
  if (nameDiffs.length > 12) console.log(`  … ${nameDiffs.length - 12} more`);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
