// Throwaway, READ-ONLY smoke test for the Table C enrichment fast-path.
// Run: npx tsx scripts/test-tablec-fastpath.ts   (NOT committed)
//
// Self-validating: every input is derived from the REAL dict built by the same
// helper the ingest route uses (buildTableCContext) — no hard-coded names.
import { readFileSync } from "fs";
import {
  enrichLine,
  buildSkuMaps,
  buildProductProfiles,
  buildKeywordRegexes,
  type ProductKeyword,
  type BaseKeyword,
  type SkuEntry,
  type EnrichResult,
} from "../lib/mail-orders/enrich";
import { buildTableCContext } from "../lib/mail-orders/table-c-context";

function loadEnv(path: string): void {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  } catch { /* file may not exist */ }
}
loadEnv(".env.local");
loadEnv(".env");

let pass = 0;
let fail = 0;
function assert(id: string, cond: boolean): void {
  if (cond) { console.log(`  ${id} PASS`); pass++; }
  else      { console.log(`  ${id} FAIL`); fail++; }
}

/** Compact signature for comparing two EnrichResults for equality. */
function sig(r: EnrichResult): string {
  return `${r.matchStatus}|${r.skuCode}|${r.productName}|${r.baseColour}|${r.packCode}`;
}

/** Split a tableC key "name|cleanPack" on the LAST "|". */
function splitKey(key: string): { name: string; pack: string } {
  const i = key.lastIndexOf("|");
  return { name: key.slice(0, i), pack: key.slice(i + 1) };
}

async function main(): Promise<void> {
  const { prisma } = await import("../lib/prisma");

  // ── Build the EXACT context the route uses ──────────────────────────────
  const { tableC, tableCResolver, collisionKeys } = await buildTableCContext(prisma);

  // ── Build the keyword-path inputs (legacy), same as the ingest route ────
  const [pkRaw, bkRaw, skuRaw] = await Promise.all([
    prisma.mo_product_keywords.findMany(),
    prisma.mo_base_keywords.findMany(),
    prisma.mo_sku_lookup.findMany(),
  ]);
  const productKeywords: ProductKeyword[] = pkRaw
    .map((r) => ({ keyword: r.keyword, category: r.category, product: r.product }))
    .sort((a, b) => b.keyword.length - a.keyword.length);
  const baseKeywords: BaseKeyword[] = bkRaw
    .map((r) => ({ keyword: r.keyword, category: r.category, baseColour: r.baseColour }))
    .sort((a, b) => b.keyword.length - a.keyword.length);
  const skuEntries: SkuEntry[] = skuRaw.map((r) => ({
    material: r.material, description: r.description, category: r.category,
    product: r.product, baseColour: r.baseColour, packCode: r.packCode, unit: r.unit,
    refMaterial: r.refMaterial, paintType: r.paintType, materialType: r.materialType,
    piecesPerCarton: r.piecesPerCarton ?? null,
  }));
  const { byCombo, byComboAlt, byMaterial } = buildSkuMaps(skuEntries);
  const productProfiles = buildProductProfiles(skuEntries, productKeywords, baseKeywords);
  const { prodRegexMap, baseRegexMap } = buildKeywordRegexes(productKeywords, baseKeywords);

  function run(rawText: string, packCode: string, withCtx: boolean): EnrichResult {
    return enrichLine(
      rawText, packCode, productKeywords, baseKeywords,
      byCombo, byMaterial, byComboAlt, productProfiles,
      prodRegexMap, baseRegexMap, null,
      withCtx ? tableC : undefined,
      withCtx ? tableCResolver : undefined,
    );
  }

  // ── 1. Counts + size invariant ──────────────────────────────────────────
  const fullKeyCount = tableC.size + collisionKeys.size;
  console.log("─".repeat(70));
  console.log(`tableC keys (usable)     : ${tableC.size}`);
  console.log(`collision keys excluded  : ${collisionKeys.size}`);
  console.log(`full distinct keys       : ${fullKeyCount}  (tableC + collisions)`);
  console.log("─".repeat(70));
  console.log("[1] DICT INVARIANTS");
  assert("1a collisions == 15", collisionKeys.size === 15);
  assert("1b tableC size == full - 15", tableC.size === fullKeyCount - 15);
  let anyCollisionInTable = false;
  for (const k of Array.from(collisionKeys)) if (tableC.has(k)) anyCollisionInTable = true;
  assert("1c no collision key in tableC", !anyCollisionInTable);

  // ── 2. APP HITS — 5 keys straight from the dict ─────────────────────────
  const sampleKeys = Array.from(tableC.keys()).slice(0, 5);
  console.log("\n[2] APP HITS (key → enrichLine WITH context)");
  for (const key of sampleKeys) {
    const { name, pack } = splitKey(key);
    const expected = tableC.get(key)!;
    const r = run(name, pack, true);
    assert(`2 "${name}" |${pack}`, r.matchStatus === "matched" && r.skuCode === expected);
  }

  // ── 3. WITH vs WITHOUT — proves the fast-path fires + its value ──────────
  console.log("\n[3] WITH vs WITHOUT (same 5 lines)");
  console.log("  " + "LINE".padEnd(34) + "WITH".padEnd(14) + "WITHOUT".padEnd(14) + "EXPECTED");
  let rescued = 0;
  for (const key of sampleKeys) {
    const { name, pack } = splitKey(key);
    const expected = tableC.get(key)!;
    const withR = run(name, pack, true);
    const withoutR = run(name, pack, false);
    const wSku = withR.skuCode || "(none)";
    const woSku = withoutR.skuCode || `(${withoutR.matchStatus})`;
    const flag = withoutR.skuCode !== expected ? "  ← RESCUED" : "";
    if (withoutR.skuCode !== expected) rescued++;
    const label = `${name}|${pack}`.slice(0, 32);
    console.log("  " + label.padEnd(34) + wSku.padEnd(14) + woSku.padEnd(14) + expected + flag);
  }
  console.log(`  (${rescued}/${sampleKeys.length} rows differ WITHOUT context — Table C rescued them)`);

  // ── 4. COLLISION — absent from dict, identical with/without ─────────────
  console.log("\n[4] COLLISION KEY");
  const collKey = Array.from(collisionKeys)[0];
  const { name: cName, pack: cPack } = splitKey(collKey);
  console.log(`  collision key: "${collKey}"`);
  assert("4a tableC.has(collision) == false", !tableC.has(collKey));
  const cWith = run(cName, cPack, true);
  const cWithout = run(cName, cPack, false);
  console.log(`  WITH   → ${sig(cWith)}`);
  console.log(`  WITHOUT→ ${sig(cWithout)}`);
  assert("4b collision WITH === WITHOUT (no fast-path pick)", sig(cWith) === sig(cWithout));

  // ── 5. TYPED FALLTHROUGH — messy human line, identical with/without ─────
  console.log("\n[5] TYPED FALLTHROUGH");
  const typedWith = run("vt pearl glo white", "20", true);
  const typedWithout = run("vt pearl glo white", "20", false);
  console.log(`  WITH   → ${sig(typedWith)}`);
  console.log(`  WITHOUT→ ${sig(typedWithout)}`);
  assert("5 typed line WITH === WITHOUT", sig(typedWith) === sig(typedWithout));

  console.log("\n" + "─".repeat(70));
  console.log(`TOTAL: ${pass} passed / ${fail} failed`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
