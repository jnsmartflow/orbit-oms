// Generator: rewrite taxonomy-preview.json for the SADOLIN menu rebuild.
// Removes the 7 ex-Woodcare brand families, adds a SADOLIN family array
// (one row per distinct proposedProduct+proposedBase), updates summary.
// Also prints the SADOLIN_UI (product -> tab) literal for the seed.
// Reads the sadolin CSV (source of truth). Writes ONLY taxonomy-preview.json.
import { promises as fs } from "node:fs";
import path from "node:path";

function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur); return out;
}
function productType(base: string): "PLAIN" | "BASE_VARIANT" | "COLOUR" {
  if (!base) return "PLAIN";
  if (/\bBASE$/i.test(base)) return "BASE_VARIANT";
  return "COLOUR";
}

async function main() {
  const jp = path.join("docs", "prompts", "archive", "drafts", "2026-04-to-05", "taxonomy-preview.json");
  const j = JSON.parse(await fs.readFile(jp, "utf8"));

  // 1. remove the 7 ex-Woodcare brand families
  const brands = ["2K PU", "LUXURIO", "PU PRIME", "NC", "MELAMINE", "WOOD STAIN", "WOOD FILLER"];
  for (const b of brands) delete j.newRowsByFamily[b];

  // 2. build SADOLIN rows from the CSV (distinct product+base)
  type Pair = { tabSeq: number; tab: string; brandSeq: number; product: string; base: string; display: string; tokens: string; ord: number; skus: number };
  const raw = await fs.readFile(path.join("docs", "SKU", "review", "sadolin-review-final-20260604.csv"), "utf8");
  const pairs = new Map<string, Pair>();
  let ord = 0;
  for (const line of raw.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const c = splitCsvLine(line);
    const product = c[5].trim(), base = c[6].trim();
    const key = `${product}|||${base}`;
    const e = pairs.get(key);
    if (!e) pairs.set(key, { tabSeq: Number(c[2]), tab: c[1].trim(), brandSeq: Number(c[4]), product, base, display: c[7].trim(), tokens: c[8].trim(), ord: ord++, skus: 1 });
    else e.skus++;
  }
  const sorted = Array.from(pairs.values()).sort((a, b) =>
    a.tabSeq - b.tabSeq || a.brandSeq - b.brandSeq || a.ord - b.ord);
  const rows = sorted.map((e, i) => ({
    family: "SADOLIN",
    subProduct: e.product,                       // join key = exact stock product name
    displayName: e.display,
    searchTokens: e.tokens,
    baseColour: e.base ? e.base : null,
    productType: productType(e.base),
    tinterType: null,
    sortOrder: 100 + (i + 1) * 10,               // monotonic by tab>brand>base
    isActive: true,
    skuCount: e.skus,
  }));
  j.newRowsByFamily["SADOLIN"] = rows;

  // 3. recompute summary.totalNewRows + familiesProduced
  let flat = 0; for (const k of Object.keys(j.newRowsByFamily)) flat += j.newRowsByFamily[k].length;
  j.summary.totalNewRows = flat;
  j.summary.familiesProduced = Object.keys(j.newRowsByFamily).length;

  await fs.writeFile(jp, JSON.stringify(j, null, 2) + "\n", "utf8");
  console.log(`Wrote ${jp}`);
  console.log(`SADOLIN rows: ${rows.length} ; new flat total: ${flat} ; familiesProduced: ${j.summary.familiesProduced}`);

  // SADOLIN_UI (product -> tab) literal for the seed §7.7 branch
  const prodTab = new Map<string, string>();
  for (const e of sorted) prodTab.set(e.product, e.tab);
  console.log("\n── paste into v2-catalog-seed-from-preview.ts (SADOLIN_UI) ──");
  console.log("const SADOLIN_UI: Record<string, string> = {");
  for (const [p, t] of Array.from(prodTab.entries())) console.log(`    ${JSON.stringify(p)}: ${JSON.stringify(t)},`);
  console.log("  };");
}
main().catch((e) => { console.error(e); process.exit(1); });
