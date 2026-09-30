/**
 * scripts/parity-pick-delete.ts — READ-ONLY parity for the bounded Pick delete read (2026-09-30).
 *
 *   npx tsx scripts/parity-pick-delete.ts
 *
 * Uses DATABASE_URL from .env (production). SELECTs only — it calls the read
 * builders and the write paths' PRE-CHECK reads (never a write function).
 *
 * OLD = scripts/parity-pick-delete-legacy.ts (the read path frozen at 48a5e978).
 * NEW = lib/billing/pick-delete.ts.
 *
 * Compares, OLD vs NEW, on live data:
 *   1. the marker {count, latest};
 *   2. the open groups (SO → ids) and the open ids;
 *   3. the shown SO list;
 *   4. every shown bill's pickDeleteCheck (canDelete, label, message);
 *   5. the full list payload for the current IST month (groups — exact order
 *      AND order-insensitive — bills, lines, labels, hint; decided rows);
 *   6. the write paths' pre-checks for every shown group — markAllOk's live-set
 *      test and pickDelete's refusal per bill, read exactly as those functions
 *      read — against what the NEW list tells the UI.
 * A comparison that differs is re-run (up to 3 tries) before it counts, so a
 * live write landing between OLD and NEW is not reported as a defect.
 * Prints totals, every difference, and old/new wall time (3 runs each).
 * Exit 1 on any difference.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { getTwinIdsBySo } from "@/lib/picking/duplicate-so";
import { currentIstMonth } from "@/lib/billing/telephonic-so";
import {
  getActionableGroups,
  getOpenGroups,
  getPickDeleteMarker,
  listPickDelete,
  pickDeleteRefusal,
} from "@/lib/billing/pick-delete";
import {
  getActionableGroupsLegacy,
  getOpenGroupsLegacy,
  getPickDeleteMarkerLegacy,
  listPickDeleteLegacy,
} from "./parity-pick-delete-legacy";

/** JSON with object keys sorted, so key order can never create a false diff. */
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

const diffs: string[] = [];
let compared = 0;

async function compare(label: string, run: () => Promise<[unknown, unknown]>): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const [oldV, newV] = await run();
    const a = stable(oldV);
    const b = stable(newV);
    if (a === b) {
      compared++;
      console.log(`  ✓ ${label}${attempt > 1 ? ` (equal on try ${attempt})` : ""}`);
      return;
    }
    if (attempt === 3) {
      compared++;
      diffs.push(label);
      console.log(`  ✗ ${label}\n      OLD ${a.slice(0, 600)}\n      NEW ${b.slice(0, 600)}`);
    }
  }
}

async function time(label: string, fn: () => Promise<unknown>): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    const s = Date.now();
    await fn();
    out.push(Date.now() - s);
  }
  console.log(`  ${label}: ${out.join(" / ")} ms`);
  return out;
}

const mapToObj = (m: Map<string, number[]>) =>
  Object.fromEntries(Array.from(m.entries()).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));

(async () => {
  const month = currentIstMonth(new Date());
  console.log(`Pick delete parity — ${new Date().toISOString()} — month ${month}\n`);

  console.log("1. marker");
  await compare("marker {count, latest}", async () => [await getPickDeleteMarkerLegacy(), await getPickDeleteMarker()]);

  console.log("2. open groups");
  await compare("open groups SO → ids", async () => [mapToObj(await getOpenGroupsLegacy()), mapToObj(await getOpenGroups())]);
  await compare("open ids", async () => [
    (await getActionableGroupsLegacy()).openIds.slice().sort((a, b) => a - b),
    (await getActionableGroups()).openIds.slice().sort((a, b) => a - b),
  ]);

  console.log("3–4. shown groups + per-bill checks");
  await compare("shown SO list + their ids", async () => [
    mapToObj((await getActionableGroupsLegacy()).groups),
    mapToObj((await getActionableGroups()).groups),
  ]);
  await compare("per-bill pickDeleteCheck of every shown bill", async () => {
    const o = await getActionableGroupsLegacy();
    const n = await getActionableGroups();
    const pick = (g: typeof o) =>
      Object.fromEntries(
        Array.from(g.groups.values())
          .flat()
          .sort((a, b) => a - b)
          .map((id) => [id, g.checks.get(id) ?? null]),
      );
    return [pick(o), pick(n)];
  });

  console.log("5. list payload");
  await compare("list payload, exact (incl. group order)", async () => [
    await listPickDeleteLegacy(month),
    await listPickDelete(month),
  ]);
  await compare("list payload, groups order-insensitive", async () => {
    const bySo = (l: Awaited<ReturnType<typeof listPickDelete>>) => ({
      ...l,
      groups: l.groups.slice().sort((a, b) => (a.soNumber < b.soNumber ? -1 : 1)),
    });
    return [bySo(await listPickDeleteLegacy(month)), bySo(await listPickDelete(month))];
  });

  console.log("6. write-path pre-checks vs the NEW list");
  const list = await listPickDelete(month);
  let preChecks = 0;
  for (const g of list.groups) {
    // markAllOk's own test (lib/billing/pick-delete.ts markAllOk): the live set must equal orderIds.
    await compare(`All OK pre-check, SO ${g.soNumber}`, async () => {
      const twins = (await getTwinIdsBySo([g.soNumber])).get(g.soNumber) ?? [];
      const ok = twins.length >= 2 && stable(twins) === stable(g.orderIds);
      return [{ accepted: true }, { accepted: ok }];
    });
    preChecks++;
    for (const b of g.bills) {
      // pickDelete's own read + refusal (same select, same getTwinIdsBySo call).
      await compare(`Pick delete pre-check, SO ${g.soNumber} bill ${b.orderId}`, async () => {
        const order = await prisma.orders.findUnique({
          where: { id: b.orderId },
          select: {
            id: true,
            soNumber: true,
            workflowStage: true,
            isRemoved: true,
            tripDropId: true,
            tripDrop: { select: { trip: { select: { tripNumber: true } } } },
          },
        });
        let refusal: string | null = "Bill not found";
        if (order && !order.isRemoved && order.soNumber) {
          const twins = (await getTwinIdsBySo([order.soNumber])).get(order.soNumber) ?? [];
          refusal = await pickDeleteRefusal(
            {
              id: order.id,
              workflowStage: order.workflowStage,
              tripDropId: order.tripDropId,
              tripNumber: order.tripDrop?.trip.tripNumber ?? null,
            },
            twins,
          );
        }
        return [
          { canDelete: b.canDelete, refusal: b.refusal },
          { canDelete: refusal === null, refusal },
        ];
      });
      preChecks++;
    }
  }
  console.log(`  (${list.groups.length} shown group(s), ${preChecks} pre-check(s))`);

  console.log("\nTiming (wall, from this machine, 3 runs each)");
  const mo = await time("marker OLD", () => getPickDeleteMarkerLegacy());
  const mn = await time("marker NEW", () => getPickDeleteMarker());
  const lo = await time("list   OLD", () => listPickDeleteLegacy(month));
  const ln = await time("list   NEW", () => listPickDelete(month));
  const med = (xs: number[]) => xs.slice().sort((a, b) => a - b)[1];
  console.log(`  median marker ${med(mo)} → ${med(mn)} ms · list ${med(lo)} → ${med(ln)} ms`);

  console.log(`\n${compared} comparisons, ${diffs.length} difference(s).`);
  if (diffs.length > 0) {
    for (const d of diffs) console.log(`  DIFF: ${d}`);
  }
  await prisma.$disconnect();
  process.exit(diffs.length > 0 ? 1 : 0);
})();
