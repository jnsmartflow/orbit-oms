/**
 * scripts/parity-floor-rows.ts — READ-ONLY parity check for live feed 7a.
 *
 *   npx tsx scripts/parity-floor-rows.ts snapshot <file.json>          (before a refactor)
 *   npx tsx scripts/parity-floor-rows.ts compare-snapshot <file.json>  (after it — same IST day)
 *   npx tsx scripts/parity-floor-rows.ts                               (parity: full feeds vs by-id)
 *
 * Uses DATABASE_URL from .env. Issues SELECTs only — it calls the same read
 * builders the API routes call (lib/floor/queries.ts, lib/floor/rows.ts,
 * lib/floor/counts.ts, lib/trips/queries.ts) and never writes.
 *
 * parity mode, for TODAY (live):
 *   1. full board / hold / cancelled / trips feeds;
 *   2. every id they returned, fed back through the id-based builders in chunks
 *      of 300 (getFloorRowsByIds, getTripsForDate(…, ids));
 *   3. row-by-row deep-equal (keys sorted), plus: each id must come back on the
 *      tab it came from, and nothing may come back that was not asked for;
 *   4. getFloorTabCounts() vs the per-scope lengths of the full hold / cancelled
 *      feeds.
 * Prints totals and every difference; exits 1 on any difference.
 */
import "dotenv/config";
import fs from "node:fs";
import { getHideExclusion } from "@/lib/hide/visibility";
import { getFloorBoard, getFloorHold, getFloorCancelled } from "@/lib/floor/queries";
import { inScope } from "@/lib/floor/scope";
import { getTripsForDate, parseTripDate } from "@/lib/trips/queries";
import { getTodayIST } from "@/lib/dates";
import { prisma } from "@/lib/prisma";

/** JSON with object keys sorted, so key order can never create a false diff. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
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

function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function fullFeeds() {
  const hide = await getHideExclusion();
  const board = await getFloorBoard({ mode: "live", scope: "All", hideExclusion: hide });
  const hold = await getFloorHold("All", hide);
  const cancelled = await getFloorCancelled("All", hide);
  const today = parseTripDate(getTodayIST());
  const trips = await getTripsForDate(today, today);
  return { board, hold, cancelled, trips };
}

async function snapshot(file: string) {
  const f = await fullFeeds();
  fs.writeFileSync(file, stable(f));
  console.log(
    `snapshot written: ${file} — board ${f.board.rows.length} rows, hold ${f.hold.length}, ` +
      `cancelled ${f.cancelled.length}, trips ${f.trips.length}`,
  );
}

async function compareSnapshot(file: string) {
  const before = JSON.parse(fs.readFileSync(file, "utf8"));
  const after = JSON.parse(stable(await fullFeeds()));
  let diffs = 0;
  for (const key of ["board", "hold", "cancelled", "trips"] as const) {
    const a = stable(before[key]);
    const b = stable(after[key]);
    if (a === b) {
      console.log(`  ${key}: identical`);
    } else {
      diffs++;
      console.log(`  ${key}: DIFFERENT (before ${a.length} chars, after ${b.length} chars)`);
    }
  }
  console.log(diffs === 0 ? "SNAPSHOT MATCH — full feeds byte-identical before/after" : `SNAPSHOT DIFFS: ${diffs}`);
  return diffs;
}

async function parity() {
  // Imported here, not at the top: `snapshot` mode must also run against the
  // code BEFORE these modules existed (the before/after full-feed check).
  const { getFloorRowsByIds, FLOOR_ROWS_MAX_IDS } = await import("@/lib/floor/rows");
  const { getFloorTabCounts, FLOOR_TAB_SCOPES } = await import("@/lib/floor/counts");
  const FLOOR_SCOPES = FLOOR_TAB_SCOPES;
  const f = await fullFeeds();
  const diffs: string[] = [];
  const counted = { board: 0, hold: 0, cancelled: 0, trips: 0 };

  // ── rows: board + hold + cancelled, all through the one by-id builder ─────
  const expected = new Map<number, { tab: "board" | "hold" | "cancelled"; row: unknown }>();
  for (const r of f.board.rows) expected.set(r.orderId, { tab: "board", row: r });
  for (const r of f.hold) {
    if (expected.has(r.orderId)) diffs.push(`order ${r.orderId} is on board AND hold`);
    expected.set(r.orderId, { tab: "hold", row: r });
  }
  for (const r of f.cancelled) {
    if (expected.has(r.orderId)) diffs.push(`order ${r.orderId} is on ${expected.get(r.orderId)?.tab} AND cancelled`);
    expected.set(r.orderId, { tab: "cancelled", row: r });
  }

  for (const ids of chunks(Array.from(expected.keys()), FLOOR_ROWS_MAX_IDS)) {
    const res = await getFloorRowsByIds(ids);
    const got = new Map(res.rows.map((x) => [x.id, x]));
    for (const id of ids) {
      const want = expected.get(id)!;
      const have = got.get(id);
      if (!have) {
        diffs.push(`order ${id}: missing from the by-id answer`);
        continue;
      }
      if (have.tab !== want.tab) {
        diffs.push(`order ${id}: tab ${have.tab} by id, ${want.tab} in the full feed`);
        continue;
      }
      counted[want.tab]++;
      const a = stable(want.row);
      const b = stable(have.row);
      if (a !== b) diffs.push(`order ${id} (${want.tab}): row differs\n    full:  ${a}\n    by id: ${b}`);
    }
    for (const x of res.rows) if (!ids.includes(x.id)) diffs.push(`order ${x.id}: returned but not asked for`);
  }

  // An id NOT on any feed must come back tab null / row null.
  const probe = await prisma.orders.findFirst({
    where: { id: { notIn: Array.from(expected.keys()) } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (probe) {
    const res = await getFloorRowsByIds([probe.id]);
    const x = res.rows[0];
    if (!x || x.tab !== null || x.row !== null) diffs.push(`order ${probe.id} (off every feed): expected tab null, got ${x?.tab}`);
  }

  // ── trips: full vs by id ──────────────────────────────────────────────────
  const today = parseTripDate(getTodayIST());
  for (const ids of chunks(f.trips.map((t) => t.id), FLOOR_ROWS_MAX_IDS)) {
    const byId = await getTripsForDate(today, today, ids);
    const got = new Map(byId.map((t) => [t.id, t]));
    for (const t of f.trips.filter((x) => ids.includes(x.id))) {
      const have = got.get(t.id);
      if (!have) {
        diffs.push(`trip ${t.id}: missing from the by-id answer`);
        continue;
      }
      counted.trips++;
      const a = stable(t);
      const b = stable(have);
      if (a !== b) diffs.push(`trip ${t.id}: differs\n    full:  ${a}\n    by id: ${b}`);
    }
    if (byId.length !== ids.length) diffs.push(`trips by id returned ${byId.length} for ${ids.length} ids`);
  }

  // ── counts ────────────────────────────────────────────────────────────────
  const counts = await getFloorTabCounts();
  for (const scope of FLOOR_SCOPES) {
    const holdN = f.hold.filter((r) => inScope(r.deliveryType, scope)).length;
    const cancN = f.cancelled.filter((r) => inScope(r.deliveryType, scope)).length;
    if (counts.hold[scope] !== holdN) diffs.push(`counts.hold[${scope}] = ${counts.hold[scope]}, full feed ${holdN}`);
    if (counts.cancelled[scope] !== cancN) diffs.push(`counts.cancelled[${scope}] = ${counts.cancelled[scope]}, full feed ${cancN}`);
  }

  console.log(
    `compared: board ${counted.board}/${f.board.rows.length} · hold ${counted.hold}/${f.hold.length} · ` +
      `cancelled ${counted.cancelled}/${f.cancelled.length} · trips ${counted.trips}/${f.trips.length} · ` +
      `counts ${FLOOR_SCOPES.length} scopes × 2`,
  );
  console.log(`counts: ${stable(counts)}`);
  if (diffs.length === 0) {
    console.log("PARITY OK — 0 differences");
  } else {
    console.log(`PARITY DIFFERENCES: ${diffs.length}`);
    for (const d of diffs) console.log(`  - ${d}`);
  }
  return diffs.length;
}

async function main() {
  const [mode, file] = process.argv.slice(2);
  let failures = 0;
  if (mode === "snapshot" && file) await snapshot(file);
  else if (mode === "compare-snapshot" && file) failures = await compareSnapshot(file);
  else failures = await parity();
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(2);
});
