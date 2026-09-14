/** SCRATCH — READ-ONLY. Runs resolvePasteCustomerNames over every OBD in the
 *  12.09.2026 paste fixture AS IF ALL WERE NEW, and compares the result with
 *  the .xlsx names for the same day. Writes nothing — the only DB touches are
 *  the catalog SELECT inside buildObds and the one delivery_point_master SELECT.
 *
 *  Run: npx tsx scripts/_test-paste-names.ts
 */
import * as fs from "fs";
import * as path from "path";
import { parseSapFile } from "../lib/sap-parser";
import { parseSapPaste } from "../lib/sap-paste";
import { resolvePasteCustomerNames } from "../lib/sap-paste/resolve-names";
import { prisma } from "../lib/prisma";

const ROOT = path.resolve(__dirname, "..");
const DATE = new Date("2026-09-12");
const FIELDS = ["billToCustomerName", "shipToCustomerName"] as const;
const CODE = { billToCustomerName: "billToCustomerId", shipToCustomerName: "shipToCustomerId" } as const;
const COUNTER_CODE = "899199";

async function main(): Promise<void> {
  const block = fs.readFileSync(path.join(ROOT, "docs", "fixtures", "12.09.2026.txt"), "utf8");
  const xbuf  = fs.readFileSync(path.join(ROOT, "docs", "fixtures", "EXPORT 12.09.XLSX"));

  const paste = await parseSapPaste(block, { fallbackObdEmailDate: DATE });
  if (paste.kind !== "ok") throw new Error(`paste blocked: ${paste.error}`);
  const xlsx = await parseSapFile(xbuf, { fallbackObdEmailDate: DATE });
  const xByObd = new Map(xlsx.obds.map((o) => [o.obdNumber, o]));

  const before = paste.result.obds;
  const beforeJson = JSON.stringify(before);
  const all = new Set(before.map((o) => o.obdNumber));
  const res = await resolvePasteCustomerNames(before, all);

  console.log(`OBDs: ${before.length} (all treated as new)`);
  console.log(`input untouched after call: ${JSON.stringify(before) === beforeJson}`);
  console.log(`returned new objects: ${res.obds.every((o, i) => o !== before[i])}`);

  // ── Repaired, split by field ─────────────────────────────────────────────
  const repairedBy: Record<string, number> = { billToCustomerName: 0, shipToCustomerName: 0 };
  const repairedCases: Array<{ obd: string; field: string; code: string; pasted: string; repaired: string; xlsx: string | null }> = [];
  res.obds.forEach((o, i) => {
    for (const f of FIELDS) {
      if (o[f] !== before[i][f]) {
        repairedBy[f] += 1;
        repairedCases.push({ obd: o.obdNumber, field: f, code: String(o[CODE[f]]),
          pasted: String(before[i][f]), repaired: String(o[f]), xlsx: xByObd.get(o.obdNumber)?.[f] ?? null });
      }
    }
  });
  console.log(`\n=== REPAIRED: ${res.repaired} (bill-to ${repairedBy.billToCustomerName}, ship-to ${repairedBy.shipToCustomerName}) ===`);

  // ── Kept, by reason ──────────────────────────────────────────────────────
  for (const reason of ["not-in-master", "no-match"] as const) {
    const k = res.kept.filter((x) => x.reason === reason);
    console.log(`\n=== KEPT — ${reason}: ${k.length} (bill-to ${k.filter((x) => x.field === "billToCustomerName").length}, ship-to ${k.filter((x) => x.field === "shipToCustomerName").length}) ===`);
    for (const x of k) {
      const o = before.find((b) => b.obdNumber === x.obdNumber)!;
      const code = String(o[CODE[x.field]]);
      const xName = xByObd.get(x.obdNumber)?.[x.field] ?? null;
      const cut = xName !== x.text;
      console.log(`  ${x.obdNumber} ${x.field === "billToCustomerName" ? "bill" : "ship"} code ${code.padEnd(8)} pasted "${x.text}"  xlsx "${xName}"${cut ? "  ← STILL SHORT" : "  (already complete)"}`);
    }
  }
  if (res.kept.some((x) => x.reason === "no-match")) {
    const codes = Array.from(new Set(res.kept.filter((x) => x.reason === "no-match")
      .map((x) => String(before.find((b) => b.obdNumber === x.obdNumber)![CODE[x.field]]))));
    const rows = await prisma.delivery_point_master.findMany({
      where: { customerCode: { in: codes } }, select: { customerCode: true, customerName: true },
    });
    console.log(`  master names for the no-match codes:`);
    for (const r of rows) console.log(`    ${r.customerCode.padEnd(8)} "${r.customerName}"`);
  }

  // ── Repaired but NOT equal to the .xlsx name ─────────────────────────────
  const disagree = repairedCases.filter((c) => c.repaired !== c.xlsx);
  const caseOnly = disagree.filter((c) => c.repaired.toUpperCase() === (c.xlsx ?? "").toUpperCase());
  console.log(`\n=== REPAIRED NAME ≠ XLSX NAME: ${disagree.length} of ${repairedCases.length} (casing only: ${caseOnly.length}, different text: ${disagree.length - caseOnly.length}) ===`);
  for (const c of disagree) {
    const tag = caseOnly.includes(c) ? "case" : "TEXT";
    console.log(`  [${tag}] ${c.obd} ${c.field === "billToCustomerName" ? "bill" : "ship"} ${c.code.padEnd(8)} master "${c.repaired}"  vs  xlsx "${c.xlsx}"`);
  }
  console.log(`repaired AND identical to xlsx: ${repairedCases.length - disagree.length}`);

  // ── Names still short after repair, vs the xlsx ──────────────────────────
  let stillShort = 0;
  res.obds.forEach((o) => {
    const x = xByObd.get(o.obdNumber);
    for (const f of FIELDS) {
      const r = o[f], full = x?.[f];
      if (r && full && r.length < full.length && full.toUpperCase().startsWith(r.toUpperCase())) stillShort += 1;
    }
  });
  console.log(`names still shorter than the xlsx after repair: ${stillShort}`);

  // ── 899199, the counter code ─────────────────────────────────────────────
  console.log(`\n=== CODE ${COUNTER_CODE} ===`);
  const master = await prisma.delivery_point_master.findUnique({
    where: { customerCode: COUNTER_CODE }, select: { customerName: true },
  });
  console.log(`master name: "${master?.customerName ?? "(not in master)"}"`);
  let renamed = 0, seen = 0;
  res.obds.forEach((o, i) => {
    for (const f of FIELDS) {
      if (o[CODE[f]] !== COUNTER_CODE) continue;
      seen += 1;
      const changed = o[f] !== before[i][f];
      if (changed) renamed += 1;
      const k = res.kept.find((x) => x.obdNumber === o.obdNumber && x.field === f);
      console.log(`  ${o.obdNumber} ${f === "billToCustomerName" ? "bill" : "ship"}: pasted "${before[i][f]}" → stored "${o[f]}"  ${changed ? "⚠ RENAMED" : "kept"}${k ? ` (${k.reason})` : " (below look-up length)"}`);
    }
  });
  console.log(`${COUNTER_CODE}: ${seen} name field(s) in fixture, ${renamed} renamed → ${renamed === 0 && seen > 0 ? "PASS" : "FAIL"}`);

  // Synthetic: a long counter-sale name the master label does NOT start with.
  const synth = { ...before[0], obdNumber: "SYNTH-899199",
    billToCustomerId: COUNTER_CODE, shipToCustomerId: COUNTER_CODE,
    billToCustomerName: "RAMESHBHAI PATEL HARDW", shipToCustomerName: "RAMESHBHAI PATEL HARDWARE" };
  const s = await resolvePasteCustomerNames([synth], new Set(["SYNTH-899199"]));
  const sOk = s.repaired === 0 && s.obds[0].billToCustomerName === synth.billToCustomerName
    && s.obds[0].shipToCustomerName === synth.shipToCustomerName;
  console.log(`synthetic long walk-in name on ${COUNTER_CODE}: repaired=${s.repaired}, kept=${s.kept.map((k) => k.reason).join(",")} → ${sOk ? "PASS" : "FAIL"}`);

  // Scope: an OBD NOT in createObdNumbers is never touched.
  const scoped = await resolvePasteCustomerNames(before, new Set());
  console.log(`empty create set → repaired=${scoped.repaired}, kept=${scoped.kept.length} → ${scoped.repaired === 0 && scoped.kept.length === 0 ? "PASS" : "FAIL"}`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
