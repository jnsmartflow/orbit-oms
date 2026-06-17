"use client";

// ⚠️ TEMPORARY DEV PREVIEW — visual QA only. DELETE before shipping.
// Renders <TintSummaryDocument> with the approved mockup's dummy numbers so the
// four A4 pages can be eyeballed (and Ctrl+P print-previewed) with NO auth and
// NO live DB. The live report endpoint + builder are wired separately later.

import TintSummaryDocument, { type TintSummaryData } from "@/components/reports/tint-summary-document";

// Sample payload mirrors docs/mockups/MIS Report/tm-daily-report-mockup-FINAL.html
// 19:42 IST = 14:12 UTC on 2026-06-16.
const SAMPLE: TintSummaryData = {
  reportDate: "2026-06-16",
  generatedAt: "2026-06-16T14:12:00.000Z",
  summary: {
    remaining: { count: 8, litres: 460 },
    completed: { count: 16, litres: 1240 },
    intake: { count: 14, litres: 980 },
    workloadCleared: { pct: 67, done: 16, total: 24 },
  },
  movement: {
    opening: { count: 10, litres: 720 },
    intake: { count: 14, litres: 980 },
    completed: { count: 16, litres: 1240 },
    closing: { count: 8, litres: 460 },
  },
  pace: [
    { hourIST: 9, cumulativeLitres: 165 },
    { hourIST: 10, cumulativeLitres: 345 },
    { hourIST: 11, cumulativeLitres: 445 },
    { hourIST: 12, cumulativeLitres: 580 },
    { hourIST: 13, cumulativeLitres: 580 },
    { hourIST: 14, cumulativeLitres: 730 },
    { hourIST: 15, cumulativeLitres: 880 },
    { hourIST: 16, cumulativeLitres: 975 },
    { hourIST: 17, cumulativeLitres: 1090 },
    { hourIST: 18, cumulativeLitres: 1240 },
  ],
  trend: [
    { date: "2026-06-10", intakeCount: 12, completedCount: 14 },
    { date: "2026-06-11", intakeCount: 19, completedCount: 16 },
    { date: "2026-06-12", intakeCount: 15, completedCount: 18 },
    { date: "2026-06-13", intakeCount: 11, completedCount: 13 },
    { date: "2026-06-14", intakeCount: 0, completedCount: 0 },
    { date: "2026-06-15", intakeCount: 21, completedCount: 19 },
    { date: "2026-06-16", intakeCount: 14, completedCount: 16 },
  ],
  operators: [
    { operatorId: 1, name: "Deepak Vasava", jobs: 8, litres: 560 },
    { operatorId: 2, name: "Chandrasing Valvi", jobs: 8, litres: 680 },
  ],
  aging: [
    { bucket: "<1d", count: 5, litres: 280 },
    { bucket: "1d", count: 0, litres: 0 },
    { bucket: "2-3d", count: 2, litres: 110 },
    { bucket: "4-7d", count: 1, litres: 70 },
    { bucket: "8+", count: 0, litres: 0 },
  ],
  smu: [
    { name: "Decorative Projects", count: 9, litres: 820, completedCount: 6, completedLitres: 540 },
    { name: "Retail Offtake", count: 7, litres: 420, completedCount: 3, completedLitres: 180 },
  ],
  area: [
    { name: "Local", count: 8, litres: 560, completedCount: 5, completedLitres: 360 },
    { name: "Upcountry", count: 4, litres: 360, completedCount: 2, completedLitres: 200 },
    { name: "IGT", count: 2, litres: 180, completedCount: 1, completedLitres: 100 },
    { name: "Cross Depot", count: 2, litres: 140, completedCount: 0, completedLitres: 0 },
  ],
  topCustomers: [
    { customerId: 1, name: "THE MAPPLE SKYWALK", dealer: "Shree Paint Centre", obdCount: 2, litres: 180 },
    { customerId: 2, name: "VACANZA CITY", dealer: "Krishna Hardware", obdCount: 1, litres: 120 },
    { customerId: 3, name: "SUN SATTVAM", dealer: "Maruti Colour World", obdCount: 2, litres: 110 },
    { customerId: 4, name: "SHIVALIK GREENS", dealer: "Patel Paints", obdCount: 3, litres: 95 },
    { customerId: 5, name: "GREEN ACRES VILLA", dealer: "Deep Traders", obdCount: 1, litres: 80 },
  ],
  openRegister: [
    { obd: "81048902", site: "THE MAPPLE SKYWALK", litres: 70, status: "Hold", operator: null, ageDays: 4, isHold: true },
    { obd: "81048955", site: "VACANZA CITY", litres: 60, status: "Hold", operator: null, ageDays: 3, isHold: true },
    { obd: "81049010", site: "SUN SATTVAM", litres: 50, status: "Hold", operator: null, ageDays: 2, isHold: true },
    { obd: "81049288", site: "SHIVALIK GREENS", litres: 65, status: "Assigned", operator: "Deepak Vasava", ageDays: 0, isHold: false },
    { obd: "81049295", site: "RIVERSIDE HEIGHTS", litres: 55, status: "Assigned", operator: "Deepak Vasava", ageDays: 0, isHold: false },
    { obd: "81049307", site: "ORCHID RESIDENCY", litres: 45, status: "Assigned", operator: "Chandrasing Valvi", ageDays: 0, isHold: false },
    { obd: "81049313", site: "GREEN ACRES VILLA", litres: 40, status: "Assigned", operator: "Chandrasing Valvi", ageDays: 0, isHold: false },
    { obd: "81049320", site: "MARUTI COLOUR WORLD", litres: 75, status: "Assigned", operator: "Deepak Vasava", ageDays: 0, isHold: false },
  ],
  completedRegister: [
    { obd: "81049221", site: "THE MAPPLE SKYWALK", litres: 120, operator: "Deepak Vasava", doneAtIST: "2026-06-16T09:18:00" },
    { obd: "81049208", site: "SHIVALIK GREENS", litres: 45, operator: "Chandrasing Valvi", doneAtIST: "2026-06-16T09:46:00" },
    { obd: "81049233", site: "VACANZA CITY", litres: 120, operator: "Deepak Vasava", doneAtIST: "2026-06-16T10:12:00" },
    { obd: "81049240", site: "DEEP TRADERS GODOWN", litres: 60, operator: "Chandrasing Valvi", doneAtIST: "2026-06-16T10:41:00" },
    { obd: "81049255", site: "SHIVALIK GREENS", litres: 30, operator: "Deepak Vasava", doneAtIST: "2026-06-16T11:05:00" },
    { obd: "81049261", site: "SUN SATTVAM", litres: 70, operator: "Chandrasing Valvi", doneAtIST: "2026-06-16T11:39:00" },
    { obd: "81049277", site: "GREEN ACRES VILLA", litres: 80, operator: "Deepak Vasava", doneAtIST: "2026-06-16T12:14:00" },
    { obd: "81049282", site: "PATEL PAINTS COUNTER", litres: 55, operator: "Chandrasing Valvi", doneAtIST: "2026-06-16T12:50:00" },
    { obd: "81049290", site: "THE MAPPLE SKYWALK", litres: 60, operator: "Deepak Vasava", doneAtIST: "2026-06-16T14:08:00" },
    { obd: "81049301", site: "RIVERSIDE HEIGHTS", litres: 90, operator: "Chandrasing Valvi", doneAtIST: "2026-06-16T14:37:00" },
    { obd: "81049318", site: "SUN SATTVAM", litres: 40, operator: "Deepak Vasava", doneAtIST: "2026-06-16T15:02:00" },
    { obd: "81049324", site: "KRISHNA HARDWARE", litres: 110, operator: "Chandrasing Valvi", doneAtIST: "2026-06-16T15:48:00" },
    { obd: "81049339", site: "SHIVALIK GREENS", litres: 20, operator: "Deepak Vasava", doneAtIST: "2026-06-16T16:21:00" },
    { obd: "81049346", site: "MARUTI COLOUR WORLD", litres: 75, operator: "Chandrasing Valvi", doneAtIST: "2026-06-16T16:55:00" },
    { obd: "81049352", site: "ORCHID RESIDENCY", litres: 50, operator: "Deepak Vasava", doneAtIST: "2026-06-16T17:30:00" },
    { obd: "81049367", site: "SHREE PAINT CENTRE", litres: 115, operator: "Chandrasing Valvi", doneAtIST: "2026-06-16T18:09:00" },
  ],
  flags: { holdCount: 3, oldestHoldDays: 4, pausedToday: 0, skippedToday: 0, removedToday: 0 },
};

export default function TintSummaryPreviewPage() {
  return (
    <div style={{ background: "#e9ebef", minHeight: "100vh", paddingBottom: 40 }}>
      <div
        className="print-hide"
        style={{
          position: "sticky", top: 0, zIndex: 10, display: "flex", gap: 12, alignItems: "center",
          padding: "8px 16px", background: "#0b1220", color: "#fff", fontFamily: "system-ui, sans-serif", fontSize: 13,
        }}
      >
        <strong>DEV PREVIEW</strong>
        <span style={{ opacity: 0.7 }}>Tint Summary · sample data · no auth / no DB — delete before ship</span>
        <button
          onClick={() => window.print()}
          style={{ marginLeft: "auto", background: "#1c3f93", color: "#fff", border: 0, borderRadius: 6, padding: "6px 14px", fontSize: 13, cursor: "pointer" }}
        >
          Print / PDF
        </button>
      </div>
      <TintSummaryDocument data={SAMPLE} generatedByName="Chandresh Kolgha" />
    </div>
  );
}
