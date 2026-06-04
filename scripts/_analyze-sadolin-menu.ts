// READ-ONLY analysis for the SADOLIN menu rebuild. No writes.
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

async function main() {
  const jp = path.join("docs", "prompts", "archive", "drafts", "2026-04-to-05", "taxonomy-preview.json");
  const j = JSON.parse(await fs.readFile(jp, "utf8"));
  const brands = ["2K PU", "LUXURIO", "PU PRIME", "NC", "MELAMINE", "WOOD STAIN", "WOOD FILLER"];
  let removed = 0;
  for (const b of brands) { const n = (j.newRowsByFamily[b] ?? []).length; console.log(`  remove family ${b.padEnd(12)} = ${n} rows`); removed += n; }
  let flat = 0; for (const k of Object.keys(j.newRowsByFamily)) flat += j.newRowsByFamily[k].length;
  console.log(`TOTAL removed: ${removed}`);
  console.log(`current flat total: ${flat} ; summary.totalNewRows: ${j.summary.totalNewRows}`);

  const raw = await fs.readFile(path.join("docs", "SKU", "review", "sadolin-review-final-20260604.csv"), "utf8");
  const pairs = new Map<string, { tab: string; tabSeq: number; brandSeq: number; product: string; base: string; display: string; tokens: string; skus: number }>();
  const tabs = new Map<string, number>();
  for (const line of raw.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const c = splitCsvLine(line);
    const tab = c[1].trim(), tabSeq = Number(c[2]), brandSeq = Number(c[4]);
    const product = c[5].trim(), base = c[6].trim(), display = c[7].trim(), tokens = c[8].trim();
    const key = `${product}|||${base}`;
    tabs.set(tab, tabSeq);
    const e = pairs.get(key);
    if (!e) pairs.set(key, { tab, tabSeq, brandSeq, product, base, display, tokens, skus: 1 });
    else e.skus++;
  }
  console.log(`\nDistinct (product,base) menu rows: ${pairs.size}`);
  console.log(`Tabs (tabSeq): ${JSON.stringify(Array.from(tabs.entries()).sort((a, b) => a[1] - b[1]))}`);
  const prodTab = new Map<string, Set<string>>();
  for (const e of Array.from(pairs.values())) { if (!prodTab.has(e.product)) prodTab.set(e.product, new Set()); prodTab.get(e.product)!.add(e.tab); }
  const multi = Array.from(prodTab.entries()).filter(([, s]) => s.size > 1);
  console.log(`Products spanning >1 tab (should be 0): ${multi.length} ${JSON.stringify(multi.map(([p, s]) => [p, Array.from(s)]))}`);
  console.log(`Distinct products: ${prodTab.size}`);
  // per tab row counts
  const perTab = new Map<string, number>();
  for (const e of Array.from(pairs.values())) perTab.set(e.tab, (perTab.get(e.tab) ?? 0) + 1);
  console.log(`Per-tab row counts: ${JSON.stringify(Array.from(perTab.entries()))}`);
  console.log(`\nNew flat total would be: ${flat} - ${removed} + ${pairs.size} = ${flat - removed + pairs.size}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
