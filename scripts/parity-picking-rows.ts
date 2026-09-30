/**
 * scripts/parity-picking-rows.ts — READ-ONLY parity for live feed picking 4a (2026-09-30).
 *
 *   npx tsx scripts/parity-picking-rows.ts snapshot <file.json>          (before the onlyIds refactor)
 *   npx tsx scripts/parity-picking-rows.ts compare-snapshot <file.json>  (after it)
 *   npx tsx scripts/parity-picking-rows.ts                               (parity: full vs by-id / sync / picker filter)
 *
 * DATABASE_URL from .env (production). SELECTs only.
 *
 * snapshot / compare-snapshot: the FULL queue — supervisor (openPending) and each picker who holds a
 * bill (openPending + pickerId) — must be byte-identical before and after the refactor (keys sorted).
 *
 * parity (a comparison that differs is re-run up to 3 times before it counts, so a live write
 * landing between the two reads is not reported as a defect):
 *   1. full queue vs getPickingQueue({ onlyIds: every board id }) — rows (same order), waitingSkus,
 *      oilSkus, heldBack triple, date;
 *   2. the same in chunks of 20 ids → each chunk's rows = the full queue's rows for those ids;
 *   3. POST /api/picking/sync's builder (syncPicking) with every board id → patches = the full rows,
 *      siblings and heldBack triple;
 *   4. an off-board id → a null patch;
 *   5. a shown trip's bills via tripIds expansion → patches = the full-queue rows for its bills that are
 *      on the board, null for the rest;
 *   6. the picker filter (face=picker): for a sample of today's live order ids, for each picker who
 *      holds a bill, filterPickerOrderIds(ids, picker, held) = an independent SQL answer.
 * Exit 1 on any difference.
 */
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "@/lib/prisma";
import { getPickingQueue } from "@/lib/picking/queue";

function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
      return Object.keys(val as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (val as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return val;
  });
}

async function fullSnapshot() {
  const board = await getPickingQueue({ scope: "openPending" });
  const pickerIds = Array.from(new Set(board.rows.map((r) => r.pickerId).filter((p): p is number => p !== null))).sort(
    (a, b) => a - b,
  );
  const pickers: Record<string, unknown> = {};
  for (const p of pickerIds) pickers[String(p)] = await getPickingQueue({ scope: "openPending", pickerId: p });
  return { board, pickers };
}

const diffs: string[] = [];
let compared = 0;
async function compare(label: string, run: () => Promise<[unknown, unknown]>): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const [a, b] = await run();
    const sa = stable(a);
    const sb = stable(b);
    if (sa === sb) {
      compared++;
      console.log(`  ✓ ${label}${attempt > 1 ? ` (equal on try ${attempt})` : ""}`);
      return;
    }
    if (attempt === 3) {
      compared++;
      diffs.push(label);
      console.log(`  ✗ ${label}\n      A ${sa.slice(0, 500)}\n      B ${sb.slice(0, 500)}`);
    }
  }
}

async function parity() {
  const { syncPicking } = await import("@/lib/picking/sync");
  const { filterPickerOrderIds } = await import("@/lib/picking/picker-feed");

  const full0 = await getPickingQueue({ scope: "openPending" });
  const ids = full0.rows.map((r) => r.orderId);
  console.log(`board: ${ids.length} rows, ${full0.waitingSkus.length} waitingSkus, heldBack ${full0.heldBack}/${full0.heldBackTrucks}/${full0.heldBackUnplanned}\n`);

  const pickSiblings = (q: { waitingSkus: unknown; oilSkus: unknown; heldBack: number; heldBackTrucks: number; heldBackUnplanned: number; date: string }) => ({
    waitingSkus: q.waitingSkus,
    oilSkus: q.oilSkus,
    heldBack: q.heldBack,
    heldBackTrucks: q.heldBackTrucks,
    heldBackUnplanned: q.heldBackUnplanned,
    date: q.date,
  });

  console.log("1. full queue vs onlyIds = every board id");
  await compare("rows (same order)", async () => {
    const full = await getPickingQueue({ scope: "openPending" });
    const by = await getPickingQueue({ scope: "openPending", onlyIds: full.rows.map((r) => r.orderId) });
    return [full.rows, by.rows];
  });
  await compare("waitingSkus, oilSkus, heldBack triple, date", async () => {
    const full = await getPickingQueue({ scope: "openPending" });
    const by = await getPickingQueue({ scope: "openPending", onlyIds: full.rows.map((r) => r.orderId) });
    return [pickSiblings(full), pickSiblings(by)];
  });

  console.log("2. chunks of 20 ids");
  for (let i = 0; i < ids.length; i += 20) {
    const part = ids.slice(i, i + 20);
    await compare(`chunk ${i / 20 + 1} (${part.length} ids): rows + siblings`, async () => {
      const full = await getPickingQueue({ scope: "openPending" });
      const by = await getPickingQueue({ scope: "openPending", onlyIds: part });
      const want = new Set(part);
      return [
        {
          rows: full.rows.filter((r) => want.has(r.orderId)),
          waitingSkus: full.waitingSkus.filter((w) => want.has(w.orderId)),
          oilSkus: full.oilSkus.filter((w) => want.has(w.orderId)),
        },
        { rows: by.rows, waitingSkus: by.waitingSkus, oilSkus: by.oilSkus },
      ];
    });
  }

  const emptyBody = { orderIds: [] as number[], tripIds: [] as number[], shownIds: [] as number[], tintShownIds: [] as number[] };

  console.log("3. syncPicking over every board id");
  await compare("patches = full rows; siblings + heldBack triple", async () => {
    const full = await getPickingQueue({ scope: "openPending" });
    const s = await syncPicking({ ...emptyBody, orderIds: full.rows.map((r) => r.orderId) });
    const rows = s.patches.filter((p) => p.row !== null).map((p) => p.row);
    return [
      { rows: full.rows, ...pickSiblings(full) },
      {
        rows,
        waitingSkus: s.waitingSkus,
        oilSkus: s.oilSkus,
        heldBack: s.heldBack,
        heldBackTrucks: s.heldBackTrucks,
        heldBackUnplanned: s.heldBackUnplanned,
        date: s.date,
      },
    ];
  });

  console.log("4. off-board id");
  const [off] = await prisma.$queryRaw<{ id: number }[]>`
    SELECT id FROM orders WHERE "workflowStage" = 'cancelled' ORDER BY id DESC LIMIT 1`;
  if (off) {
    await compare(`order ${off.id} (cancelled) → null patch`, async () => {
      const s = await syncPicking({ ...emptyBody, orderIds: [off.id], shownIds: [off.id] });
      return [[{ id: off.id, row: null }], s.patches];
    });
  } else diffs.push("no off-board id found");

  console.log("5. a shown trip's bills via tripIds");
  const trips = await prisma.$queryRaw<{ id: number; n: number }[]>`
    SELECT t.id, count(o.id)::int AS n
      FROM trips t JOIN trip_drops d ON d."tripId" = t.id JOIN orders o ON o."tripDropId" = d.id
     WHERE t."shownAt" IS NOT NULL AND t.status <> 'cancelled'
     GROUP BY t.id ORDER BY t.id DESC LIMIT 3`;
  if (trips.length === 0) diffs.push("no shown trip found");
  for (const t of trips) {
    await compare(`trip ${t.id} (${t.n} bills) → its bills' patches = full-queue rows / null`, async () => {
      const full = await getPickingQueue({ scope: "openPending" });
      const bills = (
        await prisma.$queryRaw<{ id: number }[]>`
          SELECT o.id FROM orders o JOIN trip_drops d ON d.id = o."tripDropId" WHERE d."tripId" = ${t.id} ORDER BY o.id`
      ).map((b) => b.id);
      const byId = new Map(full.rows.map((r) => [r.orderId, r]));
      const expected = bills.map((id) => ({ id, row: byId.get(id) ?? null }));
      const s = await syncPicking({ ...emptyBody, tripIds: [t.id], shownIds: bills });
      const got = [...s.patches].sort((a, b) => a.id - b.id);
      return [expected, got];
    });
  }

  console.log("6. picker filter (face=picker)");
  const sample = (
    await prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT "entityId" AS id FROM (
        SELECT "entityId" FROM live_changes WHERE entity = 'order' ORDER BY seq DESC LIMIT 600) x`
  )
    .map((r) => Number(r.id))
    .filter((n) => Number.isInteger(n) && n > 0);
  const pickers = Array.from(new Set(full0.rows.map((r) => r.pickerId).filter((p): p is number => p !== null)));
  console.log(`   ${sample.length} live order ids, ${pickers.length} pickers`);
  for (const p of pickers) {
    const held = sample.slice(0, 3);
    await compare(`picker ${p}: filtered ids = SQL (assigned to him now) ∪ held`, async () => {
      const got = (await filterPickerOrderIds(sample, p, held)).slice().sort((a, b) => a - b);
      const mine = (
        await prisma.$queryRaw<{ id: number }[]>`
          SELECT order_id AS id FROM pick_assignments WHERE picker_id = ${p} AND order_id = ANY (${sample}::int[])`
      ).map((r) => r.id);
      const expected = Array.from(new Set([...mine, ...held.filter((h) => sample.includes(h))])).sort((a, b) => a - b);
      return [expected, got];
    });
  }

  // Five ids that are NOT the board's: cancelled bills, or checked on an earlier day.
  const unrelated = (
    await prisma.$queryRaw<{ id: number }[]>`
      SELECT o.id FROM orders o LEFT JOIN pick_assignments pa ON pa.order_id = o.id
       WHERE o."workflowStage" = 'cancelled'
          OR (o."workflowStage" = 'pick_checked' AND pa.checked_at < now() - interval '2 days')
       ORDER BY o.id DESC LIMIT 5`
  ).map((r) => r.id);
  console.log("7. unrelated ids read nothing heavy");
  await compare(`${unrelated.length} off-board ids (not shown) → no patches, no heldBack`, async () => {
    const s = await syncPicking({ ...emptyBody, orderIds: unrelated });
    return [{ patches: [], heldBack: undefined }, { patches: s.patches, heldBack: s.heldBack }];
  });

  console.log("\nTiming (wall, this machine, 3 runs)");
  for (const [label, fn] of [
    ["full queue", () => getPickingQueue({ scope: "openPending" })],
    ["sync, 5 board ids", () => syncPicking({ ...emptyBody, orderIds: ids.slice(0, 5) })],
    ["sync, 5 unrelated ids", () => syncPicking({ ...emptyBody, orderIds: unrelated })],
  ] as const) {
    const t: number[] = [];
    for (let i = 0; i < 3; i++) {
      const s = Date.now();
      await (fn as () => Promise<unknown>)();
      t.push(Date.now() - s);
    }
    console.log(`  ${label}: ${t.join(" / ")} ms`);
  }

  console.log(`\n${compared} comparisons, ${diffs.length} difference(s).`);
  for (const d of diffs) console.log(`  DIFF: ${d}`);
  return diffs.length === 0;
}

(async () => {
  const [mode, file] = process.argv.slice(2);
  let ok = true;
  if (mode === "snapshot") {
    if (!file) throw new Error("snapshot <file>");
    const snap = await fullSnapshot();
    fs.writeFileSync(file, stable(snap));
    console.log(`snapshot written: board ${snap.board.rows.length} rows, ${Object.keys(snap.pickers).length} pickers → ${file}`);
  } else if (mode === "compare-snapshot") {
    if (!file) throw new Error("compare-snapshot <file>");
    const before = JSON.parse(fs.readFileSync(file, "utf8")) as { board: unknown; pickers: Record<string, unknown> };
    const now = await fullSnapshot();
    const b = stable(before.board) === stable(now.board);
    console.log(`  board: ${b ? "identical" : "DIFFERENT"}`);
    ok = b;
    const keys = Array.from(new Set([...Object.keys(before.pickers), ...Object.keys(now.pickers)])).sort();
    for (const k of keys) {
      const same = stable(before.pickers[k]) === stable(now.pickers[k]);
      console.log(`  picker ${k}: ${same ? "identical" : "DIFFERENT"}`);
      ok = ok && same;
    }
    console.log(ok ? "SNAPSHOT MATCH — full queues byte-identical before/after" : "SNAPSHOT MISMATCH");
  } else {
    ok = await parity();
  }
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
})();
