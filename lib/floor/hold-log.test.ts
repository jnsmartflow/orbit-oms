// lib/floor/hold-log.test.ts — npx tsx --test lib/floor/hold-log.test.ts
//
// The Hold table's source columns: every hold note has a label, no label is keyed
// on a note the reader does not look for, and the "System" rule for held-by.
// Pure — no database, no React.

import test from "node:test";
import assert from "node:assert/strict";
import {
  BILLING_CI_HOLD_NOTE,
  FLOOR_CLEAR_HOLD_NOTE,
  FLOOR_HOLD_NOTE,
  HOLD_LOG_NOTES,
  HOLD_SOURCE_BY_NOTE,
  MAIL_ORDER_AUTO_HOLD_NOTE,
  MAIL_ORDER_BILLING_HOLD_NOTE,
  heldByLabel,
} from "./hold-log";

test("HOLD_LOG_NOTES has nine notes and every one has a label", () => {
  assert.equal(HOLD_LOG_NOTES.length, 9);
  for (const note of HOLD_LOG_NOTES) {
    assert.ok(HOLD_SOURCE_BY_NOTE[note] !== undefined, `no label for "${note}"`);
  }
});

test("HOLD_SOURCE_BY_NOTE has no key outside HOLD_LOG_NOTES (no clear note)", () => {
  for (const key of Object.keys(HOLD_SOURCE_BY_NOTE)) {
    assert.ok(HOLD_LOG_NOTES.includes(key), `label keyed on non-hold note "${key}"`);
  }
  assert.equal(HOLD_SOURCE_BY_NOTE[FLOOR_CLEAR_HOLD_NOTE], undefined);
});

test("the two mail-order notes read billing vs auto", () => {
  assert.equal(HOLD_SOURCE_BY_NOTE[MAIL_ORDER_BILLING_HOLD_NOTE], "Billing · mail order");
  assert.equal(HOLD_SOURCE_BY_NOTE[MAIL_ORDER_AUTO_HOLD_NOTE], "Auto (mail order)");
});

test("heldByLabel: no log → null; user 1 on an import note → System; else the name", () => {
  assert.equal(heldByLabel(null, null, null), null);
  assert.equal(heldByLabel(MAIL_ORDER_AUTO_HOLD_NOTE, 1, "Harsh"), "System");
  assert.equal(heldByLabel(BILLING_CI_HOLD_NOTE, 1, "Harsh"), "System");
  assert.equal(heldByLabel(BILLING_CI_HOLD_NOTE, 25, "Deepanshu"), "Deepanshu");
  // User 1 pressing Hold on the floor is a person.
  assert.equal(heldByLabel(FLOOR_HOLD_NOTE, 1, "Harsh"), "Harsh");
  // A billing user's mail-order hold is never "System", even as user 1.
  assert.equal(heldByLabel(MAIL_ORDER_BILLING_HOLD_NOTE, 1, "Harsh"), "Harsh");
});
