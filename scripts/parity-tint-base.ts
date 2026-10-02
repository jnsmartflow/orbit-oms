/**
 * scripts/parity-tint-base.ts — READ-ONLY parity for the Tint Manager's Base tab
 * (2026-10-01, docs/prompts/drafts/code-discovery-2026-10-01-tint-manager-base-tab.md §H, §I).
 *
 *   npx tsx scripts/parity-tint-base.ts
 *
 * Uses DATABASE_URL from .env. SELECTs only — it calls the same read builders the
 * routes call and never writes. Checks, for TODAY (live):
 *
 *   1. BASE FEED (lib/tint/base-feed.ts getTintBaseRows — the route's builder)
 *      = Floor's FULL live board (getFloorBoard, no extraWhere) filtered by
 *      isBaseBill, minus trip bills that did not join their CURRENT trip today
 *      (IST). The join day is derived independently here: the latest
 *      `bills_added` trip_activity row naming the bill on that same trip.
 *      Compared by id set, rowStatus() per id, and the whole row deep-equal.
 *   2. TM HOLD rows (getFloorHold with the route's extraWhere) = Floor's full
 *      Hold feed filtered to tint ∪ Base.
 *   3. TM CI rows (getFloorCancelled with the route's extraWhere) = Floor's full
 *      Cancelled feed filtered to tint ∪ Base.
 *   4. tintManagerBillRefusal — the Base rules (pure).
 *
 * Prints totals and every difference; exits 1 on any difference.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { getISTDayRange } from "@/lib/dates";
import { getFloorBoard, getFloorHold, getFloorCancelled } from "@/lib/floor/queries";
import { rowStatus } from "@/components/floor/status-pill";
import { TRIP_BILLS_ADDED } from "@/lib/trips/activity";
import { getTintBaseRows } from "@/lib/tint/base-feed";
import {
  BASE_BILL_WHERE,
  BASE_PICKER_HOLD_REFUSAL,
  isBaseBill,
  tintManagerBillRefusal,
} from "@/lib/tint/manager-bill";

const diffs: string[] = [];
const sortKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]))
  : v;
const same = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const typeOf = (isTint: boolean) => (isTint ? "tint" : "non_tint");

function compareIds(label: string, got: number[], want: number[]) {
  const g = new Set(got), w = new Set(want);
  const extra = got.filter((id) => !w.has(id)), missing = want.filter((id) => !g.has(id));
  if (extra.length) diffs.push(`${label}: ${extra.length} extra ids ${extra.slice(0, 10).join(",")}`);
  if (missing.length) diffs.push(`${label}: ${missing.length} missing ids ${missing.slice(0, 10).join(",")}`);
  if (got.length !== g.size) diffs.push(`${label}: duplicate ids`);
}

async function main() {
  // ── 1. Base feed ───────────────────────────────────────────────────────────
  const baseRows = await getTintBaseRows();
  const full = await getFloorBoard({ mode: "live" });
  const baseOnBoard = full.rows.filter((r) => isBaseBill({ orderType: typeOf(r.isTint), smu: r.smu }));

  // Independent join day: latest bills_added row naming the bill on its current trip.
  const dropIds = Array.from(new Set(baseOnBoard.map((r) => r.tripDropId).filter((d): d is number => d !== null)));
  const drops = dropIds.length ? await prisma.trip_drops.findMany({ where: { id: { in: dropIds } }, select: { id: true, tripId: true } }) : [];
  const tripOfDrop = new Map(drops.map((d) => [d.id, d.tripId]));
  const tripIds = Array.from(new Set(drops.map((d) => d.tripId)));
  const acts = tripIds.length
    ? await prisma.trip_activity.findMany({ where: { action: TRIP_BILLS_ADDED, tripId: { in: tripIds } }, select: { tripId: true, detail: true, createdAt: true } })
    : [];
  const joinedAt = new Map<string, Date>(); // `${tripId}:${orderId}` → latest add
  for (const a of acts) {
    const ids = (a.detail as { orderIds?: unknown } | null)?.orderIds;
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      const k = `${a.tripId}:${id}`;
      const prev = joinedAt.get(k);
      if (!prev || prev < a.createdAt) joinedAt.set(k, a.createdAt);
    }
  }
  const today = getISTDayRange();
  let cutTrip = 0;
  const expected = baseOnBoard.filter((r) => {
    if (r.tripDropId === null) return true;
    const at = joinedAt.get(`${tripOfDrop.get(r.tripDropId)}:${r.orderId}`);
    const keep = at !== undefined && at >= today.start && at < today.end;
    if (!keep) cutTrip++;
    return keep;
  });
  compareIds("BASE ids", baseRows.map((r) => r.orderId), expected.map((r) => r.orderId));
  const expById = new Map(expected.map((r) => [r.orderId, r]));
  let statusChecked = 0, rowChecked = 0;
  for (const r of baseRows) {
    const e = expById.get(r.orderId);
    if (!e) continue;
    if (rowStatus(r) !== rowStatus(e)) diffs.push(`BASE status ${r.obdNumber}: ${rowStatus(r)} vs ${rowStatus(e)}`);
    else statusChecked++;
    if (!same(r, e)) diffs.push(`BASE row ${r.obdNumber}: row differs from Floor's`);
    else rowChecked++;
  }
  const tally: Record<string, number> = {};
  for (const r of baseRows) { const k = `${rowStatus(r)} | ${r.smu}${r.tripNumber ? " | trip" : ""}`; tally[k] = (tally[k] ?? 0) + 1; }
  console.log(`BASE: Floor board ${full.rows.length} → Base bills ${baseOnBoard.length} → after trip cut-off ${expected.length} (cut ${cutTrip}); feed returned ${baseRows.length}; status ok ${statusChecked}, rows deep-equal ${rowChecked}`);
  console.log("  by status | smu:", tally);
  console.log("  trip numbers:", baseRows.filter((r) => r.tripNumber).map((r) => `${r.obdNumber}=${r.tripNumber}`).join(" ") || "(none)");

  // ── 2. TM Hold ─────────────────────────────────────────────────────────────
  const tmHold = await getFloorHold("All", undefined, undefined, { OR: [{ orderType: "tint" }, BASE_BILL_WHERE] });
  const allHold = await getFloorHold("All");
  const wantHold = allHold.filter((r) => r.isTint || isBaseBill({ orderType: "non_tint", smu: r.smu }));
  compareIds("HOLD ids", tmHold.map((r) => r.orderId), wantHold.map((r) => r.orderId));
  console.log(`HOLD: Floor ${allHold.length} → TM (tint ∪ Base) ${tmHold.length} (expected ${wantHold.length}; Base ${tmHold.filter((r) => !r.isTint).length})`);

  // ── 3. TM CI tab ───────────────────────────────────────────────────────────
  const tmCanc = await getFloorCancelled("All", undefined, undefined, { OR: [{ orderType: "tint" }, BASE_BILL_WHERE] });
  const allCanc = await getFloorCancelled("All");
  const wantCanc = allCanc.filter((r) => r.isTint || isBaseBill({ orderType: "non_tint", smu: r.smu }));
  compareIds("CI ids", tmCanc.map((r) => r.orderId), wantCanc.map((r) => r.orderId));
  console.log(`CI: Floor ${allCanc.length} → TM (tint ∪ Base) ${tmCanc.length} (expected ${wantCanc.length}; Base ${tmCanc.filter((r) => !r.isTint).length})`);

  // ── 4. The rule ────────────────────────────────────────────────────────────
  const base = { orderType: "non_tint", isRemoved: false, smu: "Decorative Projects" };
  const cases: Array<[string, string | null, string | null]> = [
    ["tint hand", tintManagerBillRefusal({ orderType: "tint", isRemoved: false, smu: null }, "hand"), null],
    ["base hold waiting", tintManagerBillRefusal({ ...base, workflowStage: "pending_picking" }, "hold"), null],
    ["base hold pick_assigned", tintManagerBillRefusal({ ...base, workflowStage: "pick_assigned" }, "hold"), BASE_PICKER_HOLD_REFUSAL],
    ["base hold pick_done", tintManagerBillRefusal({ ...base, workflowStage: "pick_done" }, "hold"), BASE_PICKER_HOLD_REFUSAL],
    ["base hold pick_checked", tintManagerBillRefusal({ ...base, workflowStage: "pick_checked" }, "hold"), null],
    ["base unhold pick_assigned", tintManagerBillRefusal({ ...base, workflowStage: "pick_assigned" }, "unhold"), null],
    ["base hand", tintManagerBillRefusal(base, "hand"), "Not available on a Base bill — use Floor"],
    ["base cancel", tintManagerBillRefusal(base, "cancel"), "Not available on a Base bill — use Floor"],
    ["base ci", tintManagerBillRefusal(base, "ci"), null],
    ["base shop", tintManagerBillRefusal(base, "shop-delivery"), null],
    ["deco retail", tintManagerBillRefusal({ orderType: "non_tint", isRemoved: false, smu: "Deco Retail" }, "hold"), "Not a tint or Base bill — use Floor"],
    ["no smu selected", tintManagerBillRefusal({ orderType: "non_tint", isRemoved: false }, "hold"), "Not a tint or Base bill — use Floor"],
    ["removed", tintManagerBillRefusal({ ...base, isRemoved: true }, "hold"), "Order not found"],
  ];
  for (const [name, got, want] of cases) if (got !== want) diffs.push(`RULE ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  console.log(`RULE: ${cases.length} cases`);

  await prisma.$disconnect();
  if (diffs.length) {
    console.log(`\nBASE PARITY FAILED — ${diffs.length} differences`);
    for (const d of diffs) console.log("  " + d);
    process.exit(1);
  }
  console.log("\nBASE PARITY OK — 0 differences");
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
