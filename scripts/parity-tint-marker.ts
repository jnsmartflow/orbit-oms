/**
 * scripts/parity-tint-marker.ts — READ-ONLY live watch for the Tint quick win (2026-09-30).
 *
 *   npx tsx scripts/parity-tint-marker.ts [minutes=60] [everySec=15]
 *
 * DATABASE_URL from .env (production). SELECTs only — no writes, no DDL, no env values printed.
 *
 * Every window it computes:
 *   OLD signature  = (count, MAX(orders.updatedAt)) over the marker's exact predicate — the
 *                    body of app/api/tint/manager/marker/route.ts BEFORE the quick win, frozen below;
 *   NEW signature  = (count, GREATEST(orders max, m)) where m = the widened route's one extra
 *                    statement (max updatedAt of tint_assignments, order_splits, delivery_challans);
 *   BOARD fingerprint = count + MAX(updatedAt) over the tint set's orders AND all their
 *                    tint_assignments / order_splits / delivery_challans (a superset of "active").
 * Between windows: fingerprint moved but NEW did not → MISSED (must be 0). Fingerprint moved but
 * OLD did not → the blind 60 s tick's real work. NEW moved, fingerprint did not → false fire.
 *
 * The three reads are not one snapshot (no $transaction, CORE §3), so each window re-reads OLD and
 * NEW after the fingerprint; if either moved in between, the window is re-taken (up to 3 tries).
 * Exit 1 if MISSED > 0.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { getHideExclusion } from "@/lib/hide/visibility";
import { TINT_STATUS_DONE } from "@/lib/tint/assignment-status";
import { getBaseOperatorId } from "@/lib/tint/base-operator";
import type { Prisma } from "@prisma/client";

type Sig = { count: number; latest: string | null };

/** The marker's predicate, verbatim from the route at e5bc94e4 (UTC-midnight "today" kept). */
async function markerWhere(): Promise<Prisma.ordersWhereInput> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const hideExclusion = await getHideExclusion();
  const baseOperatorId = await getBaseOperatorId();
  const notBase = baseOperatorId !== null ? { assignedToId: { not: baseOperatorId } } : {};
  return {
    AND: [
      {
        orderType: "tint",
        isRemoved: false,
        OR: [
          { workflowStage: { in: ["pending_tint_assignment", "tint_assigned", "tinting_in_progress"] } },
          { tintAssignments: { some: { status: TINT_STATUS_DONE, completedAt: { gte: startOfToday }, ...notBase } } },
          { splits: { some: { status: TINT_STATUS_DONE, completedAt: { gte: startOfToday }, ...notBase } } },
        ],
      },
      hideExclusion,
    ],
  };
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const later = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null ? a : a >= b ? a : b; // ISO strings of one format sort as time

async function oldSig(where: Prisma.ordersWhereInput): Promise<Sig> {
  const agg = await prisma.orders.aggregate({ where, _count: true, _max: { updatedAt: true } });
  return { count: agg._count, latest: iso(agg._max.updatedAt) };
}

async function newSig(where: Prisma.ordersWhereInput): Promise<Sig> {
  const old = await oldSig(where);
  const rows = await prisma.$queryRaw<{ m: Date | null }[]>`
    SELECT GREATEST(
      (SELECT max("updatedAt") FROM tint_assignments),
      (SELECT max("updatedAt") FROM order_splits),
      (SELECT max("updatedAt") FROM delivery_challans)) AS m`;
  return { count: old.count, latest: later(old.latest, iso(rows[0]?.m ?? null)) };
}

async function fingerprint(where: Prisma.ordersWhereInput): Promise<string> {
  const set = await prisma.orders.findMany({ where, select: { id: true, updatedAt: true } });
  const ids = set.map((o) => o.id);
  let max: string | null = null;
  for (const o of set) max = later(max, iso(o.updatedAt));
  if (ids.length > 0) {
    const ta = await prisma.tint_assignments.aggregate({ where: { orderId: { in: ids } }, _max: { updatedAt: true } });
    const os = await prisma.order_splits.aggregate({ where: { orderId: { in: ids } }, _max: { updatedAt: true } });
    const dc = await prisma.delivery_challans.aggregate({ where: { orderId: { in: ids } }, _max: { updatedAt: true } });
    max = later(max, iso(ta._max.updatedAt));
    max = later(max, iso(os._max.updatedAt));
    max = later(max, iso(dc._max.updatedAt));
  }
  return `${set.length}|${max ?? "-"}`;
}

const key = (s: Sig) => `${s.count}|${s.latest ?? "-"}`;

type Window = { at: string; old: string; neu: string; fp: string; tries: number };

async function takeWindow(): Promise<Window> {
  let last: Window | null = null;
  for (let tries = 1; tries <= 3; tries++) {
    const where = await markerWhere();
    const o1 = key(await oldSig(where));
    const n1 = key(await newSig(where));
    const fp = await fingerprint(where);
    const o2 = key(await oldSig(where));
    const n2 = key(await newSig(where));
    last = { at: new Date().toISOString(), old: o2, neu: n2, fp, tries };
    if (o1 === o2 && n1 === n2) return last;
  }
  return last!;
}

async function main(): Promise<void> {
  const minutes = Number(process.argv[2] ?? 60);
  const everySec = Number(process.argv[3] ?? 15);
  const total = Math.max(2, Math.round((minutes * 60) / everySec));
  console.log(`[parity-tint-marker] ${total} windows, every ${everySec}s (read-only)`);

  const windows: Window[] = [];
  const started = Date.now();
  for (let i = 0; i < total; i++) {
    const due = started + i * everySec * 1000;
    const wait = due - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      windows.push(await takeWindow());
    } catch (e) {
      console.log(`  window ${i}: read failed (${String(e).slice(0, 120)}) — skipped`);
    }
  }

  let fpChanges = 0, missed = 0, oldMissed = 0, falseFires = 0, unstable = 0;
  const missedDetail: string[] = [];
  const oldMissedDetail: string[] = [];
  for (let i = 1; i < windows.length; i++) {
    const a = windows[i - 1], b = windows[i];
    if (b.tries > 1) unstable++;
    const fpMoved = a.fp !== b.fp, newMoved = a.neu !== b.neu, oldMoved = a.old !== b.old;
    if (fpMoved) fpChanges++;
    if (fpMoved && !newMoved) { missed++; missedDetail.push(`${b.at}  fp ${a.fp} → ${b.fp}  new ${b.neu}`); }
    if (fpMoved && !oldMoved) { oldMissed++; oldMissedDetail.push(`${b.at}  fp ${a.fp} → ${b.fp}  old ${b.old}`); }
    if (newMoved && !fpMoved) falseFires++;
  }

  console.log("");
  console.log("| measure | value |");
  console.log("|---|---|");
  console.log(`| windows taken | ${windows.length} (compared pairs ${Math.max(0, windows.length - 1)}) |`);
  console.log(`| windows re-taken (a write landed mid-read) | ${unstable} |`);
  console.log(`| board fingerprint changes | ${fpChanges} |`);
  console.log(`| **MISSED** — fingerprint moved, NEW signature did not | **${missed}** |`);
  console.log(`| OLD signature missed (the blind 60 s tick's real work) | ${oldMissed} |`);
  console.log(`| NEW false fires (moved, board did not) | ${falseFires} |`);
  if (missedDetail.length) { console.log("\nMISSED windows:"); missedDetail.forEach((l) => console.log("  " + l)); }
  if (oldMissedDetail.length) { console.log("\nOLD-missed windows:"); oldMissedDetail.forEach((l) => console.log("  " + l)); }
  console.log(missed === 0 ? "\nPASS — 0 missed" : "\nFAIL — missed > 0");
  await prisma.$disconnect();
  process.exit(missed === 0 ? 0 : 1);
}

void main();
