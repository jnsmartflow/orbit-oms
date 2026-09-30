// lib/live/feed-core.test.ts — npx tsx --test lib/live/feed-core.test.ts (npm run test:live-client)
//
// The client state machine of the live feed with a FAKE clock, fake timers and
// a scripted fetch: timing helpers, startup order, accumulation, the full-load
// triggers (reset, overflow, > 300, config, lag), off mode and its re-check,
// fallback after errors, hidden tab, extra-glance throttle, pause via take().

import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_GLANCE_MS,
  BACKOFF_CAP_MS,
  CONFIG_DEBOUNCE_MS,
  CONFIG_RELOAD_GAP_MS,
  EXTRA_GLANCE_GAP_MS,
  IDLE_AFTER_MS,
  IDLE_GLANCE_MS,
  LAG_RELOAD_GAP_MS,
  OFF_RECHECK_MS,
  LiveFeedController,
  backoffDelay,
  chunk,
  configReloadAt,
  createThrottle,
  glanceDelay,
  jitter,
  msToNextIstMidnight,
  type ChangesAnswer,
  type FeedMode,
} from "./feed-core";

// ── pure helpers ────────────────────────────────────────────────────────────
test("jitter stays within ±20 %", () => {
  assert.equal(jitter(10_000, 0), 8_000);
  assert.equal(jitter(10_000, 0.5), 10_000);
  assert.equal(jitter(10_000, 0.999999), 12_000);
});

test("glanceDelay: 15 s active, 60 s after 2 min idle", () => {
  assert.equal(glanceDelay(1_000_000, 1_000_000 - 1_000, 0.5), ACTIVE_GLANCE_MS);
  assert.equal(glanceDelay(1_000_000, 1_000_000 - IDLE_AFTER_MS, 0.5), IDLE_GLANCE_MS);
});

test("backoff doubles from 5 s and caps at 2 min, jitter included", () => {
  assert.equal(backoffDelay(1, 0.5), 5_000);
  assert.equal(backoffDelay(2, 0.5), 10_000);
  assert.equal(backoffDelay(3, 0.5), 20_000);
  assert.equal(backoffDelay(10, 0.999), BACKOFF_CAP_MS);
  assert.ok(backoffDelay(10, 0) <= BACKOFF_CAP_MS && backoffDelay(10, 0) >= BACKOFF_CAP_MS * 0.8);
});

test("throttle allows one per gap", () => {
  const t = createThrottle(3_000);
  assert.equal(t.tryTake(0), true);
  assert.equal(t.tryTake(2_999), false);
  assert.equal(t.tryTake(3_000), true);
});

test("configReloadAt: 5 s after the last change, ≥ 2 min after the last full load", () => {
  assert.equal(configReloadAt(100_000, -Infinity), 100_000 + CONFIG_DEBOUNCE_MS);
  assert.equal(configReloadAt(100_000, 90_000), 90_000 + CONFIG_RELOAD_GAP_MS);
});

test("msToNextIstMidnight reads the server clock in IST", () => {
  // 2026-09-30 18:29:00Z = 23:59 IST → 60 s to midnight
  assert.equal(msToNextIstMidnight("2026-09-30T18:29:00.000Z"), 60_000);
  // 18:30:00Z = 00:00 IST exactly → a full day
  assert.equal(msToNextIstMidnight("2026-09-30T18:30:00.000Z"), 86_400_000);
  assert.equal(msToNextIstMidnight("not a date"), null);
});

test("chunk splits by size", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 300), []);
});

// ── controller harness ──────────────────────────────────────────────────────
type Scripted = ChangesAnswer | Error;

function harness(script: Scripted[]) {
  let now = 1_000_000;
  let hidden = false;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  const calls: (string | null)[] = [];
  const modes: [FeedMode, FeedMode][] = [];
  const health: { connected: boolean; delayed: boolean }[] = [];
  const changes: { orderIds: number[]; tripIds: number[]; config: string[] }[] = [];
  let pending = 0;

  const ctl = new LiveFeedController({
    fetchChanges: async (after) => {
      calls.push(after);
      const next = script.shift();
      if (next === undefined) throw new Error("script exhausted");
      if (next instanceof Error) throw next;
      return next;
    },
    now: () => now,
    random: () => 0.5,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (h) => {
      timers.delete(h as number);
    },
    isHidden: () => hidden,
    log: () => {},
    onMode: (m, p) => modes.push([m, p]),
    onHealth: (h) => health.push(h),
    onChanges: (b) => changes.push(b),
    onPending: () => {
      pending++;
    },
    onServerNow: () => {},
  });

  const flush = () => new Promise((r) => setImmediate(r));
  async function advance(ms: number) {
    const until = now + ms;
    for (;;) {
      const due = Array.from(timers.entries())
        .filter(([, t]) => t.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = Math.max(now, due[1].at);
      timers.delete(due[0]);
      due[1].fn();
      await flush();
      await flush();
    }
    now = until;
  }
  return {
    ctl,
    calls,
    modes,
    health,
    changes,
    get pending() {
      return pending;
    },
    get now() {
      return now;
    },
    set now(v: number) {
      now = v;
    },
    setHidden(v: boolean) {
      hidden = v;
    },
    timerCount: () => timers.size,
    advance,
    flush: async () => {
      await flush();
      await flush();
    },
  };
}

const head = (cursor: string, extra: Partial<ChangesAnswer> = {}): ChangesAnswer => ({
  enabled: true,
  cursor,
  changes: [],
  more: false,
  reset: true,
  lagSeconds: 0,
  serverNow: "2026-09-30T06:00:00.000Z",
  ...extra,
});
const step = (cursor: string, changes: ChangesAnswer["changes"] = [], extra: Partial<ChangesAnswer> = {}): ChangesAnswer => ({
  enabled: true,
  cursor,
  changes,
  more: false,
  reset: false,
  lagSeconds: 0,
  serverNow: "2026-09-30T06:00:00.000Z",
  ...extra,
});

test("startup: head cursor first (no after), then a full load is due with reason start", async () => {
  const h = harness([head("v1.10.0")]);
  h.ctl.start();
  await h.flush();
  assert.deepEqual(h.calls, [null]);
  assert.equal(h.ctl.getMode(), "live");
  assert.deepEqual(h.ctl.take(), { kind: "full", reasons: ["start"] });
  h.ctl.noteFullLoad();
  assert.equal(h.ctl.take(), null);
});

test("glances poll from the cursor and accumulate order/trip ids until taken", async () => {
  const h = harness([
    head("v1.10.0"),
    step("v1.11.0", [{ entity: "order", ids: [5, 6] }]),
    step("v1.12.0", [{ entity: "order", ids: [6, 7] }, { entity: "trip", ids: [3] }]),
  ]);
  h.ctl.start();
  await h.flush();
  h.ctl.noteFullLoad();
  await h.advance(ACTIVE_GLANCE_MS);
  await h.advance(ACTIVE_GLANCE_MS);
  assert.deepEqual(h.calls, [null, "v1.10.0", "v1.11.0"]);
  assert.equal(h.changes.length, 2);
  assert.deepEqual(h.ctl.take(), { kind: "patch", orderIds: [5, 6, 7], tripIds: [3] });
  assert.equal(h.ctl.take(), null);
});

test("ordersPaused hands out trips only and keeps the order ids queued", async () => {
  const h = harness([head("v1.1.0"), step("v1.2.0", [{ entity: "order", ids: [1] }, { entity: "trip", ids: [9] }])]);
  h.ctl.start();
  await h.flush();
  h.ctl.noteFullLoad();
  await h.advance(ACTIVE_GLANCE_MS);
  assert.deepEqual(h.ctl.take({ ordersPaused: true }), { kind: "patch", orderIds: [], tripIds: [9] });
  assert.deepEqual(h.ctl.take(), { kind: "patch", orderIds: [1], tripIds: [] });
});

test("requeue puts ids back; noteFullLoad clears everything pending", async () => {
  const h = harness([head("v1.1.0")]);
  h.ctl.start();
  await h.flush();
  h.ctl.noteFullLoad();
  h.ctl.requeue([4], [2]);
  assert.deepEqual(h.ctl.pendingSnapshot().orders, [4]);
  h.ctl.noteFullLoad();
  assert.equal(h.ctl.take(), null);
});

test("more than 300 accumulated order ids → a full load, not a patch", async () => {
  const ids = Array.from({ length: 301 }, (_, i) => i + 1);
  const h = harness([head("v1.1.0"), step("v1.2.0", [{ entity: "order", ids }])]);
  h.ctl.start();
  await h.flush();
  h.ctl.noteFullLoad();
  await h.advance(ACTIVE_GLANCE_MS);
  assert.deepEqual(h.ctl.take(), { kind: "full", reasons: ["too-many"] });
  // …but not while rows are paused
  assert.equal(h.ctl.take({ ordersPaused: true }), null);
});

test("a full page (more) jumps to the head and asks for a full load (overflow)", async () => {
  const h = harness([head("v1.1.0"), step("v1.5.0", [{ entity: "order", ids: [1] }], { more: true }), head("v1.99.0")]);
  h.ctl.start();
  await h.flush();
  h.ctl.noteFullLoad();
  await h.advance(ACTIVE_GLANCE_MS);
  assert.deepEqual(h.calls, [null, "v1.1.0", null]);
  assert.equal(h.ctl.getCursor(), "v1.99.0");
  assert.deepEqual(h.ctl.take(), { kind: "full", reasons: ["overflow"] });
});

test("reset: true (pruned past) adopts the new cursor and asks for a full load", async () => {
  const h = harness([head("v1.1.0"), head("v1.50.0")]);
  h.ctl.start();
  await h.flush();
  h.ctl.noteFullLoad();
  await h.advance(ACTIVE_GLANCE_MS);
  assert.equal(h.ctl.getCursor(), "v1.50.0");
  assert.deepEqual(h.ctl.take(), { kind: "full", reasons: ["reset"] });
});

test("config: debounced 5 s, then at most one full load per 2 min", async () => {
  const h = harness([
    head("v1.1.0"),
    step("v1.2.0", [{ entity: "config", ids: ["app_settings"] }]),
    step("v1.3.0", [{ entity: "config", ids: ["vehicle_master"] }]),
  ]);
  h.ctl.start();
  await h.flush();
  h.ctl.take(); // start
  h.ctl.noteFullLoad(); // the start load at t0
  const t0 = h.now;
  await h.advance(ACTIVE_GLANCE_MS);
  // seen at t0+15 s, but the last full load was t0 → due at t0+2 min
  assert.equal(h.ctl.take(), null);
  await h.advance(ACTIVE_GLANCE_MS); // a second config change
  h.now = t0 + CONFIG_RELOAD_GAP_MS - 1;
  assert.equal(h.ctl.take(), null);
  h.now = t0 + CONFIG_RELOAD_GAP_MS;
  assert.deepEqual(h.ctl.take(), { kind: "full", reasons: ["config"] });
  h.ctl.noteFullLoad();
  assert.equal(h.ctl.take(), null);
});

test("config with no recent full load waits only the 5 s debounce", async () => {
  const h = harness([head("v1.1.0"), step("v1.2.0", [{ entity: "config", ids: ["route_master"] }])]);
  h.ctl.start();
  await h.flush();
  h.ctl.noteFullLoad();
  h.now += CONFIG_RELOAD_GAP_MS; // long after the start load
  await h.advance(1); // the overdue 15 s glance fires now
  assert.equal(h.ctl.take(), null);
  h.now += CONFIG_DEBOUNCE_MS;
  assert.deepEqual(h.ctl.take(), { kind: "full", reasons: ["config"] });
});

test("lag > 120 s: delayed health, and a full load at most every 2 min", async () => {
  const lag = { lagSeconds: 400 };
  const h = harness([head("v1.1.0"), step("v1.1.0", [], lag), step("v1.1.0", [], lag)]);
  h.ctl.start();
  await h.flush();
  h.ctl.noteFullLoad();
  const t0 = h.now;
  await h.advance(ACTIVE_GLANCE_MS);
  assert.deepEqual(h.health.at(-1), { connected: true, delayed: true });
  assert.equal(h.ctl.take(), null); // last full load was 15 s ago
  h.now = t0 + LAG_RELOAD_GAP_MS;
  assert.deepEqual(h.ctl.take(), { kind: "full", reasons: ["lag"] });
});

test("switch off: mode off, re-check from the head every 60 s; on again → switch-on full load", async () => {
  const h = harness([{ enabled: false }, { enabled: false }, head("v1.7.0")]);
  h.ctl.start();
  await h.flush();
  assert.equal(h.ctl.getMode(), "off");
  assert.equal(h.ctl.take(), null);
  await h.advance(OFF_RECHECK_MS);
  assert.equal(h.ctl.getMode(), "off");
  await h.advance(OFF_RECHECK_MS);
  assert.deepEqual(h.calls, [null, null, null]);
  assert.equal(h.ctl.getMode(), "live");
  assert.deepEqual(h.ctl.take(), { kind: "full", reasons: ["switch-on"] });
  assert.deepEqual(
    h.modes.map(([m]) => m),
    ["off", "live"],
  );
});

test("an error before the first answer → fallback at once; later errors back off; recovery → live", async () => {
  const h = harness([new Error("net"), new Error("net"), head("v1.3.0")]);
  h.ctl.start();
  await h.flush();
  assert.equal(h.ctl.getMode(), "fallback");
  assert.deepEqual(h.health.at(-1), { connected: false, delayed: false });
  await h.advance(5_000); // backoff 1
  assert.equal(h.calls.length, 2);
  await h.advance(10_000); // backoff 2
  assert.equal(h.ctl.getMode(), "live");
  assert.deepEqual(h.ctl.take(), { kind: "full", reasons: ["reset"] });
});

test("three consecutive errors while live → fallback; the next success returns to live without a head jump", async () => {
  const h = harness([head("v1.1.0"), new Error("a"), new Error("b"), new Error("c"), step("v1.2.0", [{ entity: "order", ids: [8] }])]);
  h.ctl.start();
  await h.flush();
  h.ctl.noteFullLoad();
  await h.advance(ACTIVE_GLANCE_MS);
  assert.equal(h.ctl.getMode(), "live");
  await h.advance(5_000);
  assert.equal(h.ctl.getMode(), "live");
  await h.advance(10_000);
  assert.equal(h.ctl.getMode(), "fallback");
  await h.advance(20_000);
  assert.equal(h.ctl.getMode(), "live");
  assert.deepEqual(h.calls, [null, "v1.1.0", "v1.1.0", "v1.1.0", "v1.1.0"]);
  assert.deepEqual(h.ctl.take(), { kind: "patch", orderIds: [8], tripIds: [] });
});

test("hidden tab: no requests; one glance on return", async () => {
  const h = harness([head("v1.1.0"), step("v1.2.0")]);
  h.ctl.start();
  await h.flush();
  h.setHidden(true);
  await h.advance(ACTIVE_GLANCE_MS * 5);
  assert.equal(h.calls.length, 1);
  assert.equal(h.timerCount(), 0);
  h.setHidden(false);
  h.ctl.noteVisible();
  await h.flush();
  assert.deepEqual(h.calls, [null, "v1.1.0"]);
});

test("idle: 60 s pace; the first input after idle glances at once; extra glances throttled to one per 3 s", async () => {
  const h = harness([head("v1.1.0"), step("v1.1.0"), step("v1.1.0"), step("v1.1.0"), step("v1.1.0")]);
  h.ctl.start();
  await h.flush();
  h.now += IDLE_AFTER_MS; // no input for 2 min
  await h.advance(ACTIVE_GLANCE_MS); // the pending 15 s timer (already scheduled while active)
  assert.equal(h.calls.length, 2);
  await h.advance(ACTIVE_GLANCE_MS);
  assert.equal(h.calls.length, 2); // idle → next at 60 s
  h.ctl.noteInput();
  await h.flush();
  assert.equal(h.calls.length, 3); // immediate
  h.ctl.noteFocus();
  await h.flush();
  assert.equal(h.calls.length, 3); // throttled (< 3 s) — a timer is pending anyway
  h.now += EXTRA_GLANCE_GAP_MS;
  h.ctl.noteFocus();
  await h.flush();
  assert.equal(h.calls.length, 4);
});

test("noteDisabled (a patch route said enabled:false) → off and the 60 s re-check", async () => {
  const h = harness([head("v1.1.0"), head("v1.2.0")]);
  h.ctl.start();
  await h.flush();
  h.ctl.noteDisabled();
  assert.equal(h.ctl.getMode(), "off");
  await h.advance(OFF_RECHECK_MS);
  assert.deepEqual(h.calls, [null, null]);
  assert.equal(h.ctl.getMode(), "live");
});

// ── extra entities (Billing: mail_order, so_tag — 2026-09-30) ──────────────
test("extra entities are accumulated per entity and handed out with the patch; order/trip-only work keeps its old shape", async () => {
  const h = harness([
    head("v1.1.0"),
    step("v1.2.0", [{ entity: "mail_order", ids: [501, 502] }, { entity: "so_tag", ids: [7] }]),
    step("v1.3.0", [{ entity: "mail_order", ids: [502, 503] }, { entity: "order", ids: [9] }]),
  ]);
  h.ctl.start();
  await h.flush();
  h.ctl.noteFullLoad();
  await h.advance(ACTIVE_GLANCE_MS);
  await h.advance(ACTIVE_GLANCE_MS);
  assert.deepEqual(h.changes[0], { orderIds: [], tripIds: [], config: [], extra: { mail_order: [501, 502], so_tag: [7] } });
  assert.deepEqual(h.ctl.take(), {
    kind: "patch",
    orderIds: [9],
    tripIds: [],
    extra: { mail_order: [501, 502, 503], so_tag: [7] },
  });
  assert.equal(h.ctl.take(), null);
});

test("extra-only changes still make a patch; requeue and noteFullLoad cover them", async () => {
  const h = harness([head("v1.1.0"), step("v1.2.0", [{ entity: "so_tag", ids: [3] }])]);
  h.ctl.start();
  await h.flush();
  h.ctl.noteFullLoad();
  await h.advance(ACTIVE_GLANCE_MS);
  assert.deepEqual(h.ctl.take(), { kind: "patch", orderIds: [], tripIds: [], extra: { so_tag: [3] } });
  h.ctl.requeue([], [], { mail_order: [1] });
  h.ctl.noteFullLoad();
  assert.equal(h.ctl.take(), null);
});

test("glanceNow glances at once, throttled like focus", async () => {
  const h = harness([head("v1.1.0"), step("v1.1.0"), step("v1.1.0")]);
  h.ctl.start();
  await h.flush();
  h.ctl.glanceNow("import-done");
  await h.flush();
  assert.equal(h.calls.length, 2);
  h.ctl.glanceNow("again");
  await h.flush();
  assert.equal(h.calls.length, 2); // < 3 s
});
