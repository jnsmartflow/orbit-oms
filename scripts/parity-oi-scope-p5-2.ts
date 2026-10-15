// scripts/parity-oi-scope-p5-2.ts — READ-ONLY. Freezes the trip set the P5-2
// parity runs cover, so the before and after runs look at the SAME trips.
//
//   npx tsx scripts/parity-oi-scope-p5-2.ts <scope.json> [--since=7d]
//
// Scope (owner, 2026-10-15): every non-cancelled trip dated in the last N days
// (IST) PLUS every trip on TODAY's desk (lib/trips/live-trips.ts
// liveTripsOnDeskWhere — today's trips and earlier trips still holding an
// unfinished bill). NOT "every draft / released trip": 813 of 858 non-cancelled
// trips are draft / released (only 45 were ever marked dispatched), so that is
// the full history the depot PC cannot hold. Run it ONCE, on the OLD code —
// P5-2 changes liveTripsOnDeskWhere, which is exactly why the set is frozen.
// Then pass --scope=<scope.json> to parity-oi-trips / readers-b / readers-c / p5-1.

import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";

const prisma = new PrismaClient();
const file = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "";
const sinceArg = process.argv.find((a) => a.startsWith("--since="));
const DAYS = sinceArg ? Number(sinceArg.slice("--since=".length).replace(/d$/, "")) : 7;

(async () => {
  if (!file) throw new Error("usage: parity-oi-scope-p5-2.ts <scope.json> [--since=7d]");
  const { liveTripsOnDeskWhere } = await import("../lib/trips/live-trips");
  const { getTodayIST } = await import("../lib/dates");
  const today = getTodayIST();
  const todayDate = new Date(`${today}T00:00:00Z`);
  const from = new Date(todayDate.getTime() - DAYS * 86_400_000);
  const recent = await prisma.trips.findMany({ where: { status: { not: "cancelled" }, tripDate: { gte: from } }, select: { id: true } });
  const desk = await prisma.trips.findMany({ where: liveTripsOnDeskWhere(todayDate), select: { id: true } });
  const ids = Array.from(new Set([...recent, ...desk].map((t) => t.id))).sort((a, b) => a - b);
  writeFileSync(file, JSON.stringify({ today, days: DAYS, recent: recent.length, desk: desk.length, ids }));
  console.log(`scope ${today} · last ${DAYS} days: ${recent.length} · on today's desk: ${desk.length} · union: ${ids.length} → ${file}`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
