// lib/stock-audit/queue-core.test.ts — npx tsx --test lib/stock-audit/queue-core.test.ts
//
// The stock-count offline queue's state transitions (Schema v27.80). Pure.

import test from "node:test";
import assert from "node:assert/strict";
import {
  applyOutcome,
  backoffMs,
  bannerFor,
  classifySend,
  dropConfirmed,
  editEntry,
  emptyQueue,
  enqueue,
  isQueueDoc,
  makeEntry,
  markSending,
  nextToSend,
  removeEntry,
  retryEntry,
  reviveQueue,
  submittedCount,
  toStored,
  type QueueDoc,
} from "./queue-core";
import type { CountLine } from "./types";

const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function entry(n: number, minute: number) {
  return makeEntry({
    clientId: ID(n),
    material: `52332${n}`,
    qty: 10 * n,
    inCatalog: true,
    skuDescription: "WEATHERCOAT WHITE",
    skuPack: "1L",
    countedAt: `2026-11-04T09:${String(minute).padStart(2, "0")}:00.000Z`,
  });
}

function doc(...ns: [number, number][]): QueueDoc {
  let d = emptyQueue(3, 7, "SA-0002");
  for (const [n, m] of ns) d = enqueue(d, entry(n, m));
  return d;
}

function line(id: number, clientId: string | null): CountLine {
  return {
    id,
    auditId: 7,
    material: "5233221",
    inCatalog: true,
    skuDescription: null,
    skuPack: null,
    qty: 1,
    clientId,
    countedAt: null,
    createdAt: "2026-11-04T09:00:00.000Z",
    updatedAt: "2026-11-04T09:00:00.000Z",
  };
}

test("enqueue: a new entry is waiting, attempts 0; a repeat clientId is ignored", () => {
  const d = doc([1, 5]);
  assert.equal(d.entries.length, 1);
  assert.equal(d.entries[0].state, "waiting");
  assert.equal(d.entries[0].attempts, 0);
  assert.equal(enqueue(d, entry(1, 9)).entries.length, 1);
});

test("makeEntry: not in catalog → notInCatalog true, no snapshot", () => {
  const e = makeEntry({ clientId: ID(1), material: "X1", qty: 5, inCatalog: false, skuDescription: "x", skuPack: "y", countedAt: "2026-11-04T09:00:00.000Z" });
  assert.equal(e.notInCatalog, true);
  assert.equal(e.skuDescription, null);
  assert.equal(e.skuPack, null);
});

test("nextToSend: the oldest waiting entry, skipping failed ones", () => {
  let d = doc([1, 30], [2, 10], [3, 20]);
  assert.equal(nextToSend(d)?.clientId, ID(2));
  d = applyOutcome(d, ID(2), classifySend({ ok: false, code: "INVALID", message: "" }));
  assert.equal(nextToSend(d)?.clientId, ID(3), "a failed entry never blocks the ones behind it");
});

test("send success removes the entry from the queue", () => {
  let d = doc([1, 1], [2, 2]);
  d = markSending(d, ID(1), "2026-11-04T09:10:00.000Z");
  d = applyOutcome(d, ID(1), classifySend({ ok: true }));
  assert.deepEqual(d.entries.map((e) => e.clientId), [ID(2)]);
});

test("NETWORK / TRY_AGAIN / UNKNOWN → back to waiting, attempts + 1", () => {
  for (const code of ["NETWORK", "TRY_AGAIN", "UNKNOWN"]) {
    let d = markSending(doc([1, 1]), ID(1), "2026-11-04T09:10:00.000Z");
    assert.equal(d.entries[0].state, "sending");
    d = applyOutcome(d, ID(1), classifySend({ ok: false, code, message: "" }));
    assert.equal(d.entries[0].state, "waiting", code);
    assert.equal(d.entries[0].attempts, 1, code);
    assert.equal(d.entries[0].lastTriedAt, "2026-11-04T09:10:00.000Z");
  }
});

test("AUDIT_CLOSED → failed{closed}, KEPT; retry does not revive it; remove (discard) does", () => {
  let d = applyOutcome(doc([1, 1]), ID(1), classifySend({ ok: false, code: "AUDIT_CLOSED", message: "closed" }));
  assert.equal(d.entries.length, 1);
  assert.equal(d.entries[0].state, "failed");
  assert.equal(d.entries[0].fail?.kind, "closed");
  assert.equal(nextToSend(d), null);
  d = retryEntry(d, ID(1));
  assert.equal(d.entries[0].state, "failed", "no retry on an audit-closed entry");
  d = editEntry(d, ID(1), 99);
  assert.equal(d.entries[0].qty, 10, "no edit on an audit-closed entry");
  assert.equal(removeEntry(d, ID(1)).entries.length, 0);
});

test("NOT_IN_CATALOG → failed{confirm}; confirm resends as Not in catalog", () => {
  let d = applyOutcome(doc([1, 1]), ID(1), classifySend({ ok: false, code: "NOT_IN_CATALOG", message: "" }));
  assert.equal(d.entries[0].fail?.kind, "confirm");
  d = retryEntry(d, ID(1), true);
  assert.equal(d.entries[0].state, "waiting");
  assert.equal(d.entries[0].fail, undefined);
  assert.equal(d.entries[0].notInCatalog, true);
  assert.equal(d.entries[0].inCatalog, false);
  assert.equal(d.entries[0].skuDescription, null);
});

test("INVALID / NOT_FOUND / CLIENT_ID_CONFLICT → failed{other}; tap = retry", () => {
  for (const code of ["INVALID", "NOT_FOUND", "CLIENT_ID_CONFLICT"]) {
    let d = applyOutcome(doc([1, 1]), ID(1), classifySend({ ok: false, code, message: "" }));
    assert.equal(d.entries[0].fail?.kind, "other", code);
    d = retryEntry(d, ID(1));
    assert.equal(d.entries[0].state, "waiting", code);
  }
});

test("401 / 403 / WRONG_USER → pause; the entry stays waiting", () => {
  const reasons = { UNAUTHORIZED: "auth", FORBIDDEN: "forbidden", WRONG_USER: "wrong_user" } as const;
  for (const [code, reason] of Object.entries(reasons)) {
    const o = classifySend({ ok: false, code, message: "" });
    assert.deepEqual(o, { kind: "pause", reason });
    const d = applyOutcome(markSending(doc([1, 1]), ID(1), "t"), ID(1), o);
    assert.equal(d.entries[0].state, "waiting");
    assert.equal(d.entries[0].attempts, 0);
  }
});

test("reload: a stored 'sending' comes back as 'waiting'; toStored never writes 'sending'", () => {
  const sending = markSending(doc([1, 1]), ID(1), "t");
  assert.equal(toStored(sending).entries[0].state, "waiting");
  const raw = JSON.parse(JSON.stringify(sending)) as unknown; // as if a tab died mid-send
  assert.ok(isQueueDoc(raw));
  assert.equal(reviveQueue(raw as QueueDoc).entries[0].state, "waiting");
});

test("revive drops entries of an unknown shape, keeps the good ones", () => {
  const d = doc([1, 1]);
  const raw = { ...d, entries: [...d.entries, { clientId: "nope" }] } as unknown as QueueDoc;
  assert.equal(reviveQueue(raw).entries.length, 1);
  assert.equal(isQueueDoc({ v: 2 }), false);
});

test("edit / remove of a waiting entry change only the phone copy; not while sending", () => {
  let d = doc([1, 1]);
  d = editEntry(d, ID(1), 77);
  assert.equal(d.entries[0].qty, 77);
  assert.equal(d.entries[0].clientId, ID(1), "same clientId after an edit");
  const s = markSending(d, ID(1), "t");
  assert.equal(editEntry(s, ID(1), 5).entries[0].qty, 77);
  assert.equal(removeEntry(s, ID(1)).entries.length, 1);
  assert.equal(removeEntry(d, ID(1)).entries.length, 0);
});

test("merge: entries already on the server are dropped (lost reply); a sending one is kept", () => {
  let d = doc([1, 1], [2, 2], [3, 3]);
  d = markSending(d, ID(3), "t");
  const next = dropConfirmed(d, [ID(1).toUpperCase(), null, ID(3)]);
  assert.deepEqual(next.entries.map((e) => e.clientId), [ID(2), ID(3)]);
});

test("submittedCount: server lines + queued entries the server does not hold", () => {
  const d = doc([1, 1], [2, 2]);
  assert.equal(submittedCount(d.entries, null), 2);
  assert.equal(submittedCount(d.entries, [line(10, null), line(11, ID(1))]), 3);
});

test("backoff 3 → 6 → 12 → 24 → 48 → 60 s cap, ±20%", () => {
  const mid = (): number => 0.5;
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 20].map((n) => backoffMs(n, mid)), [3000, 6000, 12000, 24000, 48000, 60000, 60000, 60000]);
  assert.equal(backoffMs(1, () => 0), 2400);
  assert.ok(backoffMs(6, () => 0.999999) <= 72000);
});

test("banner", () => {
  const base = { pending: 0, failedOther: 0, failedClosed: 0, paused: null, networkDown: false, recovered: false, persistent: true };
  assert.equal(bannerFor(base), null);
  assert.equal(bannerFor({ ...base, pending: 4, networkDown: true })?.text, "No signal · 4 waiting");
  assert.equal(bannerFor({ ...base, pending: 4, recovered: true })?.text, "Back online · sending 4");
  const signedOut = bannerFor({ ...base, pending: 2, paused: "auth" });
  assert.equal(signedOut?.text, "Signed out · 2 waiting");
  assert.equal(signedOut?.signIn, true);
  assert.equal(bannerFor({ ...base, failedClosed: 3 })?.text, "3 not sent — audit closed");
  assert.equal(bannerFor({ ...base, persistent: false })?.tone, "warn");
});
