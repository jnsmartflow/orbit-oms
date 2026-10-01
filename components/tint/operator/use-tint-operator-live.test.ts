// components/tint/operator/use-tint-operator-live.test.ts
//   npx tsx --test components/tint/operator/use-tint-operator-live.test.ts (npm run test:tint-live)
//
// Tint step 5 — the Operator on the live feed. Same harness as the Manager's test
// (components/tint/manager/use-tint-manager-live.test.ts): a tiny fake React, a fake
// window / document / localStorage, a scripted fetch and node:test mock timers (Date too).

import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// ── a minimal hook runner ───────────────────────────────────────────────────
type Slot = { current?: unknown; value?: unknown; deps?: unknown[]; cleanup?: (() => void) | void };
const sameDeps = (a?: unknown[], b?: unknown[]) =>
  !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

function createRenderer() {
  let slots: Slot[] = [];
  let cursor = 0;
  let pending: { k: number; fn: () => (() => void) | void; deps?: unknown[] }[] = [];
  const fakeReact = {
    useRef(init: unknown) {
      const k = cursor++;
      if (!slots[k]) slots[k] = { current: init };
      return slots[k];
    },
    useState(init: unknown) {
      const k = cursor++;
      if (!slots[k]) slots[k] = { value: typeof init === "function" ? (init as () => unknown)() : init };
      const slot = slots[k];
      const set = (v: unknown) => {
        slot.value = typeof v === "function" ? (v as (p: unknown) => unknown)(slot.value) : v;
      };
      return [slot.value, set];
    },
    useMemo(fn: () => unknown, deps: unknown[]) {
      const k = cursor++;
      if (!slots[k] || !sameDeps(slots[k].deps, deps)) slots[k] = { value: fn(), deps };
      return slots[k].value;
    },
    useCallback(fn: unknown, deps: unknown[]) {
      return fakeReact.useMemo(() => fn, deps);
    },
    useEffect(fn: () => (() => void) | void, deps?: unknown[]) {
      const k = cursor++;
      if (!slots[k]) slots[k] = {};
      if (!deps || !sameDeps(slots[k].deps, deps)) pending.push({ k, fn, deps });
    },
  };
  return {
    fakeReact,
    render<T>(hook: () => T): T {
      cursor = 0;
      pending = [];
      const out = hook();
      for (const p of pending) {
        const prev = slots[p.k];
        if (typeof prev.cleanup === "function") prev.cleanup();
        prev.cleanup = p.fn();
        prev.deps = p.deps;
      }
      return out;
    },
    unmount() {
      for (const s of slots) if (s && typeof s.cleanup === "function") s.cleanup();
      slots = [];
    },
  };
}

const renderer = createRenderer();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as { _load: (req: string, ...rest: unknown[]) => unknown };
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === "react") return renderer.fakeReact;
  return origLoad.call(this, req, ...rest);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useTintOperatorLive, TINT_OPERATOR_LIVE_HINT_KEY } =
  require("./use-tint-operator-live") as typeof import("./use-tint-operator-live");

// ── fake browser ────────────────────────────────────────────────────────────
const docListeners = new Set<() => void>();
const store = new Map<string, string>();
const fakeDoc = {
  visibilityState: "visible" as "visible" | "hidden",
  addEventListener: (_t: string, fn: () => void) => docListeners.add(fn),
  removeEventListener: (_t: string, fn: () => void) => docListeners.delete(fn),
};
const g = globalThis as unknown as Record<string, unknown>;
g.document = fakeDoc;
g.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};
function setVisible(v: boolean) {
  fakeDoc.visibilityState = v ? "visible" : "hidden";
  Array.from(docListeners).forEach((fn) => fn());
}

const calls: string[] = [];
let answers: Record<string, unknown>[] = [];
let enabled = true;
const SERVER_NOW = "2026-10-01T06:00:00.000Z"; // 11:30 IST
g.fetch = async (url: string) => {
  calls.push(url);
  if (url.startsWith("/api/live/changes")) {
    const a = !enabled
      ? { enabled: false }
      : answers.shift() ?? { enabled: true, cursor: "v1.100.0", changes: [], more: false, reset: false, lagSeconds: 0, serverNow: SERVER_NOW };
    return { ok: true, json: async () => a };
  }
  return { ok: true, json: async () => ({}) };
};
const feedCalls = () => calls.filter((u) => u.startsWith("/api/live/changes"));

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
async function advance(ms: number, step = 1_000) {
  for (let t = 0; t < ms; t += step) { mock.timers.tick(step); await flush(); }
}

const HEAD = { enabled: true, cursor: "v1.100.0", changes: [], more: false, reset: true, lagSeconds: 0, serverNow: SERVER_NOW };
const hit = (ids: number[]) => ({
  enabled: true, cursor: "v1.101.0", changes: ids.length ? [{ entity: "order", ids }] : [], more: false, reset: false,
  lagSeconds: 0, serverNow: SERVER_NOW,
});

type Opts = Parameters<typeof useTintOperatorLive>[0];
function setup(over: Partial<Opts> = {}) {
  const counts = { refetch: 0 };
  let opts: Opts = {
    hold: false,
    tiTyped: false,
    openOrderId: 11,
    heldIds: () => [11, 12],
    refetch: async () => { counts.refetch++; },
    ...over,
  };
  let last = renderer.render(() => useTintOperatorLive(opts));
  return {
    counts,
    rerender(patch: Partial<Opts> = {}) {
      opts = { ...opts, ...patch };
      last = renderer.render(() => useTintOperatorLive(opts));
      return last;
    },
    get last() { return last; },
  };
}

function reset() {
  calls.length = 0;
  answers = [];
  enabled = true;
  store.clear();
  docListeners.clear();
  fakeDoc.visibilityState = "visible";
}
async function withTimers(fn: () => Promise<void>) {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse(SERVER_NOW) });
  try { await fn(); } finally { renderer.unmount(); mock.timers.reset(); }
}

// ── ON ──────────────────────────────────────────────────────────────────────
test("ON: screen=tint&face=operator&held=<his ids>; one refetch at start; one per hit", async () => {
  reset();
  await withTimers(async () => {
    answers = [HEAD, hit([12])];
    const h = setup();
    await flush();
    h.rerender();
    assert.equal(h.last.live, true);
    assert.equal(h.counts.refetch, 1, "the start full load");
    const u = new URL("http://x" + feedCalls()[0]);
    assert.equal(u.searchParams.get("screen"), "tint");
    assert.equal(u.searchParams.get("face"), "operator");
    assert.equal(u.searchParams.get("held"), "11,12");
    assert.equal(u.searchParams.get("topics"), "order,config");
    assert.equal(u.searchParams.get("missing"), null, "the Manager's side-list param is not sent");
    await advance(20_000);
    assert.equal(h.counts.refetch, 2, "ONE refetch for the hit");
    assert.equal(store.get(TINT_OPERATOR_LIVE_HINT_KEY), "1");
  });
});

test("ON: 'nothing for you' (changes: []) → no refetch", async () => {
  reset();
  await withTimers(async () => {
    answers = [HEAD, hit([]), hit([])];
    const h = setup();
    await flush();
    const r0 = h.counts.refetch;
    await advance(40_000);
    assert.equal(h.counts.refetch, r0);
  });
});

test("hold (modal open / action in flight): nothing while held, exactly ONE refetch on release", async () => {
  reset();
  await withTimers(async () => {
    answers = [HEAD];
    const h = setup();
    await flush();
    const r0 = h.counts.refetch;
    h.rerender({ hold: true });
    answers = [hit([12]), hit([14]), hit([12])];
    const n0 = feedCalls().length;
    await advance(60_000);
    assert.ok(feedCalls().length - n0 >= 3, "the glance kept running while held");
    assert.equal(h.counts.refetch, r0, "held");
    h.rerender({ hold: false });
    await flush();
    assert.equal(h.counts.refetch, r0 + 1, "applied once on release");
    await advance(20_000);
    assert.equal(h.counts.refetch, r0 + 1);
  });
});

test("a running job does not hold: a cancel of HIS OPEN job applies at once (no typed TI)", async () => {
  reset();
  await withTimers(async () => {
    answers = [HEAD, hit([11])];
    const h = setup({ openOrderId: 11, hold: false, tiTyped: false });
    await flush();
    const r0 = h.counts.refetch;
    await advance(20_000);
    assert.equal(h.counts.refetch, r0 + 1);
    h.rerender();
    assert.equal(h.last.openJobChanged, false, "no strip — it was applied");
  });
});

test("unsaved TI on the open job: a change to THAT job → strip, no swap; applied once the form is saved/cleared", async () => {
  reset();
  await withTimers(async () => {
    answers = [HEAD];
    const h = setup({ openOrderId: 11 });
    await flush();
    h.rerender({ tiTyped: true });
    const r0 = h.counts.refetch;
    answers = [hit([11])];
    await advance(20_000);
    h.rerender();
    assert.equal(h.counts.refetch, r0, "not swapped under his typing");
    assert.equal(h.last.openJobChanged, true, "the strip");
    h.rerender({ tiTyped: false });
    await flush();
    assert.equal(h.counts.refetch, r0 + 1, "applied once");
    h.rerender();
    assert.equal(h.last.openJobChanged, false);
  });
});

test("unsaved TI on the open job: a change to ANOTHER job still applies (a new job appears)", async () => {
  reset();
  await withTimers(async () => {
    answers = [HEAD];
    const h = setup({ openOrderId: 11 });
    await flush();
    h.rerender({ tiTyped: true }); // he starts typing after the page loaded
    const r0 = h.counts.refetch;
    answers = [hit([15])];
    await advance(20_000);
    h.rerender();
    assert.equal(h.counts.refetch, r0 + 1);
    assert.equal(h.last.openJobChanged, false);
  });
});

test("strip while a modal is open on his open job; Reload applies at once", async () => {
  reset();
  await withTimers(async () => {
    answers = [HEAD];
    const h = setup({ openOrderId: 11 });
    await flush();
    const r0 = h.counts.refetch;
    h.rerender({ hold: true });
    answers = [hit([11])];
    await advance(20_000);
    h.rerender();
    assert.equal(h.last.openJobChanged, true);
    assert.equal(h.counts.refetch, r0);
    h.last.reloadNow();
    await flush();
    h.rerender();
    assert.equal(h.counts.refetch, r0 + 1);
    assert.equal(h.last.openJobChanged, false);
  });
});

test("hidden → no feed requests; visible → one glance", async () => {
  reset();
  await withTimers(async () => {
    answers = [HEAD];
    setup();
    await flush();
    setVisible(false);
    const n = feedCalls().length;
    await advance(5 * 60_000, 5_000);
    assert.equal(feedCalls().length, n);
    setVisible(true);
    await flush();
    assert.equal(feedCalls().length, n + 1);
  });
});

// ── OFF ─────────────────────────────────────────────────────────────────────
test("OFF: not live, no refetch from the feed, hint cleared; only the switch re-check", async () => {
  reset();
  await withTimers(async () => {
    enabled = false;
    store.set(TINT_OPERATOR_LIVE_HINT_KEY, "1");
    const h = setup();
    await flush();
    h.rerender();
    assert.equal(h.last.live, false);
    assert.equal(store.has(TINT_OPERATOR_LIVE_HINT_KEY), false);
    await advance(120_000, 5_000);
    assert.equal(h.counts.refetch, 0);
    assert.ok(feedCalls().length <= 3, `switch re-checks: ${feedCalls().length}`);
    assert.equal(calls.filter((u) => !u.startsWith("/api/live/changes")).length, 0);
  });
});

test("the page: own actions refetch as before; only the feed keeps the selection; holds never mention the timer", () => {
  const src = readFileSync(path.join(__dirname, "..", "tint-operator-content.tsx"), "utf8").replace(/\r/g, "");
  assert.equal((src.match(/keepSelection: true/g) ?? []).length, 1, "only the feed's refetch keeps the selection");
  assert.ok((src.match(/await fetchOrders\(\);/g) ?? []).length >= 5, "own actions still call fetchOrders() plainly");
  const hold = src.slice(src.indexOf("const holdLive ="), src.indexOf("const tiTyped ="));
  assert.ok(hold.length > 0);
  assert.equal(/elapsed|tinting_in_progress|startedAt/.test(hold), false, "a running job is never a hold");
  assert.equal(/router\.refresh\(/.test(src), false);
});
