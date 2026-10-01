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
 *
 * 2026-10-01 (Tint Manager tabs build step 4): the read path is split by OWNER
 * (all-74/77 groups → "tint", every other → "billing"). NEW is now billing ∪
 * tint, compared against the single-desk legacy read, plus two DISJOINTNESS
 * checks (no open SO and no decided row on both desks) and an owner check on
 * every open group. Exit 1 also when the desks overlap. The legacy file stays
 * frozen — it is what proves the split loses nothing.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { getTwinIdsBySo } from "@/lib/picking/duplicate-so";
import { currentIstMonth } from "@/lib/billing/telephonic-so";
import { compareGroups, ownerOfSmus } from "@/lib/billing/pick-delete-rule";
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

/** billing ∪ tint as one map — and the SOs that appear in BOTH (must be none). */
function mergeMaps(b: Map<string, number[]>, t: Map<string, number[]>): { merged: Map<string, number[]>; both: string[] } {
  const merged = new Map(b);
  const both: string[] = [];
  for (const [so, ids] of Array.from(t.entries())) {
    if (merged.has(so)) both.push(so);
    merged.set(so, ids);
  }
  return { merged, both };
}

type List = Awaited<ReturnType<typeof listPickDelete>>;

/** billing ∪ tint lists → one list in the legacy order (compareGroups; decided newest first, id desc). */
function mergeLists(b: List, t: List): List {
  return {
    month: b.month,
    groups: [...b.groups, ...t.groups].sort(compareGroups),
    decided: [...b.decided, ...t.decided].sort(
      (x, y) => (x.decidedAt < y.decidedAt ? 1 : x.decidedAt > y.decidedAt ? -1 : y.id - x.id),
    ),
  };
}

const laterIso = (a: string | null, c: string | null) => (a === null ? c : c === null ? a : a > c ? a : c);

(async () => {
  const month = currentIstMonth(new Date());
  console.log(`Pick delete parity — ${new Date().toISOString()} — month ${month}`);
  console.log(`OLD = legacy (one desk) · NEW = billing ∪ tint (2026-10-01 owner split)\n`);

  console.log("1. marker");
  await compare("marker: legacy = billing + tint (count) / later of the two (latest)", async () => {
    const b = await getPickDeleteMarker("billing");
    const t = await getPickDeleteMarker("tint");
    return [await getPickDeleteMarkerLegacy(), { count: b.count + t.count, latest: laterIso(b.latest, t.latest) }];
  });

  console.log("2. open groups");
  await compare("open groups SO → ids: legacy = billing ∪ tint", async () => {
    const { merged } = mergeMaps(await getOpenGroups("billing"), await getOpenGroups("tint"));
    return [mapToObj(await getOpenGroupsLegacy()), mapToObj(merged)];
  });
  await compare("DISJOINT: no open SO in both billing and tint", async () => {
    const { both } = mergeMaps(await getOpenGroups("billing"), await getOpenGroups("tint"));
    return [[], both];
  });
  await compare("open ids: legacy = billing ∪ tint", async () => [
    (await getActionableGroupsLegacy()).openIds.slice().sort((a, b) => a - b),
    [...(await getActionableGroups("billing")).openIds, ...(await getActionableGroups("tint")).openIds].sort((a, b) => a - b),
  ]);
  await compare("every tint-owned open group is all-74/77; every billing one is not", async () => {
    const wrong: string[] = [];
    for (const owner of ["billing", "tint"] as const) {
      const groups = await getOpenGroups(owner);
      const ids = Array.from(groups.values()).flat();
      const rows = ids.length > 0 ? await prisma.orders.findMany({ where: { id: { in: ids } }, select: { id: true, smu: true } }) : [];
      const smuOf = new Map(rows.map((r) => [r.id, r.smu]));
      for (const [so, gIds] of Array.from(groups.entries())) {
        if (ownerOfSmus(gIds.map((id) => smuOf.get(id) ?? null)) !== owner) wrong.push(`${owner}:${so}`);
      }
    }
    return [[], wrong];
  });

  console.log("3–4. shown groups + per-bill checks");
  await compare("shown SO list + their ids: legacy = billing ∪ tint", async () => {
    const { merged } = mergeMaps((await getActionableGroups("billing")).groups, (await getActionableGroups("tint")).groups);
    return [mapToObj((await getActionableGroupsLegacy()).groups), mapToObj(merged)];
  });
  await compare("per-bill pickDeleteCheck of every shown bill", async () => {
    const o = await getActionableGroupsLegacy();
    const nb = await getActionableGroups("billing");
    const nt = await getActionableGroups("tint");
    const pick = (gs: { groups: Map<string, number[]>; checks: Map<number, unknown> }[]) =>
      Object.fromEntries(
        gs
          .flatMap((g) => Array.from(g.groups.values()).flat().map((id) => [id, g.checks.get(id) ?? null] as const))
          .sort((a, b) => a[0] - b[0]),
      );
    return [pick([o]), pick([nb, nt])];
  });

  console.log("5. list payload");
  await compare("list payload: legacy = billing ∪ tint (groups in legacy order, decided newest first)", async () => [
    await listPickDeleteLegacy(month),
    mergeLists(await listPickDelete(month, "billing"), await listPickDelete(month, "tint")),
  ]);
  await compare("DISJOINT: no decided row in both lists", async () => {
    const b = new Set((await listPickDelete(month, "billing")).decided.map((d) => d.id));
    return [[], (await listPickDelete(month, "tint")).decided.map((d) => d.id).filter((id) => b.has(id))];
  });

  console.log("6. write-path pre-checks vs each NEW list (incl. the desk check)");
  let preChecks = 0;
  let shownTotal = 0;
  for (const owner of ["billing", "tint"] as const) {
    const list = await listPickDelete(month, owner);
    shownTotal += list.groups.length;
    for (const g of list.groups) {
      // markAllOk's own test: the live set must equal orderIds — AND the group
      // must belong to this desk (ownerRefusal reads the twins' SMU).
      await compare(`[${owner}] All OK pre-check, SO ${g.soNumber}`, async () => {
        const twins = (await getTwinIdsBySo([g.soNumber])).get(g.soNumber) ?? [];
        const ok = twins.length >= 2 && stable(twins) === stable(g.orderIds);
        const smus = await prisma.orders.findMany({ where: { id: { in: twins } }, select: { smu: true } });
        return [{ accepted: true, desk: owner }, { accepted: ok, desk: ownerOfSmus(smus.map((r) => r.smu)) }];
      });
      preChecks++;
      for (const b of g.bills) {
        // pickDelete's own read + refusal (same select, same getTwinIdsBySo call).
        await compare(`[${owner}] Pick delete pre-check, SO ${g.soNumber} bill ${b.orderId}`, async () => {
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
  }
  console.log(`  (${shownTotal} shown group(s), ${preChecks} pre-check(s))`);

  const lm = await getPickDeleteMarkerLegacy();
  const bm = await getPickDeleteMarker("billing");
  const tm = await getPickDeleteMarker("tint");
  const ob = await getOpenGroups("billing");
  const ot = await getOpenGroups("tint");
  const disjoint = mergeMaps(ob, ot).both.length === 0;
  console.log(`\nCounts — actionable (marker): legacy ${lm.count} · billing ${bm.count} · tint ${tm.count}`);
  console.log(`Counts — open groups:          legacy ${(await getOpenGroupsLegacy()).size} · billing ${ob.size} · tint ${ot.size}`);
  console.log(`disjoint = ${disjoint}`);

  console.log("\nTiming (wall, from this machine, 3 runs each)");
  const mo = await time("marker OLD          ", () => getPickDeleteMarkerLegacy());
  const mn = await time("marker NEW (billing)", () => getPickDeleteMarker("billing"));
  const lo = await time("list   OLD          ", () => listPickDeleteLegacy(month));
  const ln = await time("list   NEW (billing)", () => listPickDelete(month, "billing"));
  const med = (xs: number[]) => xs.slice().sort((a, b) => a - b)[1];
  console.log(`  median marker ${med(mo)} → ${med(mn)} ms · list ${med(lo)} → ${med(ln)} ms`);

  console.log(`\n${compared} comparisons, ${diffs.length} difference(s).`);
  if (diffs.length > 0) {
    for (const d of diffs) console.log(`  DIFF: ${d}`);
  }
  await prisma.$disconnect();
  process.exit(diffs.length > 0 || !disjoint ? 1 : 0);
})();
