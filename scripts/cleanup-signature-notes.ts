// Read-only verifier: finds signature / footer / mail-header junk left in mail-order notes,
// using the same isSignatureJunk() rules ingest applies since 7609a8f9.
//
//   npx tsx scripts/cleanup-signature-notes.ts   → DRY RUN only (never writes to the DB)
//
// The 2026-09-26 cleanup (1,164 mo_order_remarks rows deleted, 600 mo_orders.remarks strings
// changed) was applied via the Supabase SQL Editor from this script's dry-run output; expect 0 / 0.
// Scope: mo_order_remarks rows (never delivery/billing types) + the "; "-joined mo_orders.remarks.
// orders.remarks (the " | " copy) is left alone.
import { PrismaClient } from "@prisma/client";
import { isSignatureJunk } from "../lib/mail-orders/note-junk";
import { getOrderFlags, isOdCiFlagged } from "../lib/mail-orders/utils";
import type { MoOrder } from "../lib/mail-orders/types";

const prisma = new PrismaClient();
const PROTECTED_TYPES = new Set(["delivery", "billing"]);

function cleanRemarks(remarks: string, soName: string): string {
  return remarks
    .split("; ")
    .filter((part) => !isSignatureJunk(part, soName))
    .join("; ");
}

type FlagInput = { remarks: string | null; subject: string; billRemarks: string | null; deliveryRemarks: string | null; dispatchStatus: string | null };
function flagKey(o: FlagInput): string {
  const m = o as unknown as MoOrder;
  return `${getOrderFlags(m).join(",")}|${isOdCiFlagged(m)}`;
}

async function main() {
  console.log("=== DRY RUN — no database writes ===");

  const orders = await prisma.mo_orders.findMany({
    select: {
      id: true, soName: true, customerName: true, subject: true, remarks: true,
      billRemarks: true, deliveryRemarks: true, dispatchStatus: true,
    },
    orderBy: { id: "asc" },
  });
  const byId = new Map(orders.map((o) => [o.id, o]));

  const remarkRows = await prisma.mo_order_remarks.findMany({ orderBy: { id: "asc" } });

  // A) remark rows to delete
  const rowsToDelete = remarkRows.filter((r) => {
    if (PROTECTED_TYPES.has(r.remarkType)) return false;
    const o = byId.get(r.moOrderId);
    return !!o && isSignatureJunk(r.rawText, o.soName);
  });

  // B) mo_orders.remarks changes
  const orderChanges: Array<{ id: number; oldRemarks: string; newRemarks: string }> = [];
  for (const o of orders) {
    if (!o.remarks) continue;
    const next = cleanRemarks(o.remarks, o.soName);
    if (next !== o.remarks) orderChanges.push({ id: o.id, oldRemarks: o.remarks, newRemarks: next });
  }

  // Flag safety
  const flagDiffs: Array<{ id: number; before: string; after: string }> = [];
  for (const c of orderChanges) {
    const o = byId.get(c.id)!;
    const before = flagKey(o);
    const after = flagKey({ ...o, remarks: c.newRemarks });
    if (before !== after) flagDiffs.push({ id: c.id, before, after });
  }

  const touched = new Set<number>([...rowsToDelete.map((r) => r.moOrderId), ...orderChanges.map((c) => c.id)]);

  console.log("\n1. Totals");
  console.log(`   orders scanned:                ${orders.length}`);
  console.log(`   remark rows scanned:           ${remarkRows.length}`);
  console.log(`   remark rows to delete:         ${rowsToDelete.length}`);
  console.log(`   orders whose remarks change:   ${orderChanges.length}`);
  console.log(`   orders touched overall:        ${touched.size}`);

  // Top 30 deleted rawText (rows + remarks-string parts combined, normalised display)
  const counts = new Map<string, number>();
  for (const r of rowsToDelete) counts.set(r.rawText.trim(), (counts.get(r.rawText.trim()) ?? 0) + 1);
  console.log("\n2. Top 30 deleted mo_order_remarks.rawText");
  Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30)
    .forEach(([t, n]) => console.log(`   ${String(n).padStart(5)}  ${JSON.stringify(t)}`));

  const partCounts = new Map<string, number>();
  for (const c of orderChanges) {
    const o = byId.get(c.id)!;
    for (const p of c.oldRemarks.split("; ")) if (isSignatureJunk(p, o.soName)) partCounts.set(p.trim(), (partCounts.get(p.trim()) ?? 0) + 1);
  }
  console.log("\n2b. Top 30 dropped mo_orders.remarks parts");
  Array.from(partCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30)
    .forEach(([t, n]) => console.log(`   ${String(n).padStart(5)}  ${JSON.stringify(t)}`));

  // Samples: NOTES strip = the non-delivery/billing remark rows
  const deleteIds = new Set(rowsToDelete.map((r) => r.id));
  const rowsByOrder = new Map<number, typeof remarkRows>();
  for (const r of remarkRows) {
    if (PROTECTED_TYPES.has(r.remarkType)) continue;
    const list = rowsByOrder.get(r.moOrderId) ?? [];
    list.push(r);
    rowsByOrder.set(r.moOrderId, list);
  }
  const sampleIds = Array.from(touched).sort((a, b) => b - a);
  const step = Math.max(1, Math.floor(sampleIds.length / 10));
  console.log("\n3. Sample orders (NOTES strip before → after)");
  for (let i = 0; i < sampleIds.length && i / step < 10; i += step) {
    const o = byId.get(sampleIds[i])!;
    const rows = (rowsByOrder.get(o.id) ?? []).sort((a, b) => a.lineNumber - b.lineNumber);
    const before = rows.map((r) => r.rawText).join(" · ");
    const after = rows.filter((r) => !deleteIds.has(r.id)).map((r) => r.rawText).join(" · ");
    console.log(`   #${o.id} | ${o.customerName ?? "(unmatched)"} | so=${o.soName}`);
    console.log(`       before: ${before || "(empty)"}`);
    console.log(`       after:  ${after || "(empty)"}`);
  }

  console.log("\n4. Flag safety");
  if (flagDiffs.length === 0) console.log("   no change");
  else {
    console.log(`   BLOCKER — ${flagDiffs.length} order(s) change flags:`);
    flagDiffs.forEach((d) => console.log(`   #${d.id}: ${d.before} → ${d.after}`));
  }

  console.log("\nDry run complete — nothing written to the database.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
