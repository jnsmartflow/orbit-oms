// lib/tint/manual-pull-rules.test.ts — "+ Add to Tint" rules (2026-10-24).
// Run: npx tsx --test lib/tint/manual-pull-rules.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBillLookupTerm } from "@/lib/trips/find-bill";
import {
  MANUAL_TINT_PICK_CANCEL_STAGES,
  MANUAL_TINT_PULLABLE_STAGES,
  manualTintStageVerdict,
} from "@/lib/workflow-stages";
import {
  buildPullData,
  cancelledPickerFromNote,
  invoiceOfObdNote,
  judgePull,
  noLinesReason,
  pullLookupWhere,
  pullPushRecipients,
  pullStatusNote,
  type PullFacts,
} from "./manual-pull-rules";

// ── Lookup term → matches ────────────────────────────────────────────────────

test("an OBD term matches the OBD only — no invoice arm, no SO arm", () => {
  const term = parseBillLookupTerm(" 9105123456 ");
  assert.ok(term);
  assert.deepEqual(pullLookupWhere(term, []), { OR: [{ obdNumber: "9105123456" }] });
});

test("an invoice term (I + 9) matches orders.invoiceNo and every OBD whose invoice rows carry it", () => {
  const term = parseBillLookupTerm("i536229654");
  assert.ok(term);
  assert.deepEqual(pullLookupWhere(term, [11, 12]), {
    OR: [{ obdNumber: "I536229654" }, { invoiceNo: "I536229654" }, { id: { in: [11, 12] } }],
  });
});

test("the bare and the misread invoice forms both look up I + 9", () => {
  assert.deepEqual(parseBillLookupTerm("536229654")?.invoiceTerms, ["I536229654"]);
  assert.deepEqual(parseBillLookupTerm("1536229654")?.invoiceTerms, ["I536229654"]);
});

test("the lookup WHERE carries no removed / hide / challan filter (a found bill is judged, never hidden)", () => {
  const where = JSON.stringify(pullLookupWhere({ q: "9105123456", invoiceTerms: [] }, []));
  assert.ok(!where.includes("isRemoved"));
  assert.ok(!where.includes("workflowStage"));
  assert.ok(!where.includes("isHidden"));
});

test("invoice k of n note only for one invoice of a multi-invoice OBD", () => {
  assert.equal(
    invoiceOfObdNote(2, 3, "9105123456"),
    "Invoice 2 of 3 on OBD 9105123456; the whole OBD moves to tint",
  );
  assert.equal(invoiceOfObdNote(1, 1, "9105123456"), null);
  assert.equal(invoiceOfObdNote(null, 3, "9105123456"), null);
});

// ── Stage verdicts ───────────────────────────────────────────────────────────

test("stage verdicts: desk/queue pull, picker stages cancel the pick, everything else refused", () => {
  assert.deepEqual(MANUAL_TINT_PULLABLE_STAGES, ["pending_support", "pending_picking"]);
  assert.deepEqual(MANUAL_TINT_PICK_CANCEL_STAGES, ["pick_assigned", "pick_done", "pick_checked"]);
  for (const s of ["pending_support", "pending_picking"]) assert.equal(manualTintStageVerdict(s), "pull");
  for (const s of ["pick_assigned", "pick_done", "pick_checked"]) assert.equal(manualTintStageVerdict(s), "cancel_pick");
  for (const s of [
    "dispatched",
    "cancelled",
    "closed",
    "challan_linked",
    "order_created",
    "pending_tint_assignment",
    "tint_assigned",
    "tinting_in_progress",
    "something_new",
  ]) {
    assert.equal(manualTintStageVerdict(s), "refused", s);
  }
});

const BASE: PullFacts = {
  obdNumber: "9105123456",
  isRemoved: false,
  isActive: true,
  isChallanOrder: false,
  workflowStage: "pending_picking",
  orderType: "non_tint",
  pickerName: null,
  dispatchedInvoice: null,
  liveCiRefusal: null,
  activeLines: 4,
  removedLines: 0,
  erroredLines: 0,
};

test("judgePull: an untouched non-tint bill of ANY division is pullable (no SMU gate, no 7-day window)", () => {
  assert.deepEqual(judgePull(BASE), { verdict: "ok", reason: null });
});

test("judgePull: a picker's bill needs the confirm and names the picker", () => {
  const v = judgePull({ ...BASE, workflowStage: "pick_assigned", pickerName: "Ravi" });
  assert.equal(v.verdict, "confirm");
  assert.match(v.reason ?? "", /Ravi/);
  assert.equal(judgePull({ ...BASE, workflowStage: "pick_checked" }).verdict, "confirm");
});

test("judgePull: refusals, first reason wins", () => {
  const code = (f: Partial<PullFacts>) => {
    const v = judgePull({ ...BASE, ...f });
    return v.verdict === "refused" ? v.code : v.verdict;
  };
  assert.equal(code({ isRemoved: true, orderType: "tint" }), "REMOVED");
  assert.equal(code({ isChallanOrder: true }), "CHALLAN_ORDER");
  assert.equal(code({ workflowStage: "challan_linked" }), "CHALLAN_ORDER");
  assert.equal(code({ orderType: "tint" }), "ALREADY_TINT");
  assert.equal(code({ isActive: false }), "INACTIVE_ORDER");
  assert.equal(code({ workflowStage: "dispatched" }), "PAST_TINT");
  assert.equal(code({ workflowStage: "closed" }), "PAST_TINT");
  assert.equal(code({ workflowStage: "pick_done", dispatchedInvoice: "I536229654" }), "DISPATCHED");
  assert.equal(code({ liveCiRefusal: "This bill has CI-2026-00112 — it cannot be pulled into tinting here." }), "LIVE_CI");
  assert.equal(code({ activeLines: 0, removedLines: 2 }), "NO_LINES");
});

test("no-lines message counts removed and errored lines", () => {
  assert.equal(noLinesReason(3, 1), "No active lines on this OBD (3 removed, 1 errored)");
  assert.equal(noLinesReason(0, 0), "No active lines on this OBD");
});

// ── The pull's bill write ────────────────────────────────────────────────────

const NOW = new Date("2026-10-24T08:00:00.000Z");

test("pullData: an AUTO slot is cleared — the completion decides the tint bill's slot", () => {
  const d = buildPullData({
    dispatchSlotSource: "auto",
    operatorSequenceOrder: null,
    markSample: false,
    alreadySample: false,
    actorId: 7,
    now: NOW,
  });
  assert.deepEqual(d, {
    orderType: "tint",
    workflowStage: "pending_tint_assignment",
    manualTintEntry: true,
    slotId: null,
    originalSlotId: null,
    dispatchSlot: null,
    dispatchTargetDate: null,
    dispatchWindowId: null,
    dispatchSlotRuleId: null,
    dispatchSlotSource: null,
    directLoadedAt: null,
    directLoadedById: null,
  });
});

test("pullData: a no-slot bill (source null) is cleared the same way", () => {
  const d = buildPullData({
    dispatchSlotSource: null,
    operatorSequenceOrder: null,
    markSample: false,
    alreadySample: false,
    actorId: 7,
    now: NOW,
  });
  assert.equal(d.dispatchWindowId, null);
  assert.ok("dispatchTargetDate" in d);
});

test("pullData: a MANUAL slot survives; only the legacy slot columns clear", () => {
  const d = buildPullData({
    dispatchSlotSource: "manual",
    operatorSequenceOrder: null,
    markSample: false,
    alreadySample: false,
    actorId: 7,
    now: NOW,
  });
  for (const k of ["dispatchTargetDate", "dispatchWindowId", "dispatchSlotRuleId", "dispatchSlotSource"]) {
    assert.ok(!(k in d), k);
  }
  assert.equal(d.slotId, null);
  assert.equal(d.originalSlotId, null);
  assert.equal(d.dispatchSlot, null);
});

test("pullData: an operator sends it straight to tint_assigned with the queue tail", () => {
  const d = buildPullData({
    dispatchSlotSource: null,
    operatorSequenceOrder: 12,
    markSample: false,
    alreadySample: false,
    actorId: 7,
    now: NOW,
  });
  assert.equal(d.workflowStage, "tint_assigned");
  assert.equal(d.sequenceOrder, 12);
});

test("pullData: markSample stamps the mark once, never re-stamps an existing one", () => {
  const fresh = buildPullData({
    dispatchSlotSource: null,
    operatorSequenceOrder: null,
    markSample: true,
    alreadySample: false,
    actorId: 7,
    now: NOW,
  });
  assert.equal(fresh.sampleAt, NOW);
  assert.equal(fresh.sampleById, 7);
  const again = buildPullData({
    dispatchSlotSource: null,
    operatorSequenceOrder: null,
    markSample: true,
    alreadySample: true,
    actorId: 7,
    now: NOW,
  });
  assert.ok(!("sampleAt" in again));
  assert.ok(!("sampleById" in again));
});

// ── The status-log note ──────────────────────────────────────────────────────

test("status note names every part, and the revert reads the picker back out of it", () => {
  const note = pullStatusNote({
    reasonCode: "sample",
    reasonNotes: null,
    cancelledPickerName: "Ravi",
    pickCancelled: true,
    tripNumbers: ["L-261024-02"],
    operatorName: "Mahesh",
    markedSample: true,
  });
  assert.equal(
    note,
    "Manual tint pull: sample; marked Sample; cancelled pick by Ravi; off trip L-261024-02; assigned to Mahesh",
  );
  assert.equal(cancelledPickerFromNote(note), "Ravi");
  const plain = pullStatusNote({
    reasonCode: "other",
    reasonNotes: "dealer called",
    cancelledPickerName: null,
    pickCancelled: false,
    tripNumbers: [],
    operatorName: null,
    markedSample: false,
  });
  assert.equal(plain, "Manual tint pull: other — dealer called");
  assert.equal(cancelledPickerFromNote(plain), null);
  assert.equal(cancelledPickerFromNote("Manual tint reverted: other"), null);
  assert.equal(cancelledPickerFromNote(null), null);
});

// ── Push recipients ──────────────────────────────────────────────────────────

test("push: nobody when no picker held the bill", () => {
  assert.deepEqual(pullPushRecipients({ pickerId: null, supervisorIds: [1, 2], actorId: 9 }), {
    picker: null,
    supervisors: [],
  });
});

test("push: picker + supervisors, de-duped, minus the actor and minus the picker", () => {
  assert.deepEqual(pullPushRecipients({ pickerId: 5, supervisorIds: [1, 2, 2, 5, 9], actorId: 9 }), {
    picker: 5,
    supervisors: [1, 2],
  });
});

test("push: the actor is never told about their own press, even as the picker", () => {
  assert.deepEqual(pullPushRecipients({ pickerId: 9, supervisorIds: [1, 9], actorId: 9 }), {
    picker: null,
    supervisors: [1],
  });
});
