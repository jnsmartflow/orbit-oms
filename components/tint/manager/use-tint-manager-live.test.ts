// components/tint/manager/use-tint-manager-live.test.ts
//   npx tsx --test components/tint/manager/use-tint-manager-live.test.ts (npm run test:tint-live)
//
// Tint step 4 — the Manager on the live feed. No DOM library is installed, so the hook runs under a
// tiny fake React (useRef / useState / useMemo / useCallback / useEffect) with a fake window /
// document / localStorage, a scripted fetch and node:test mock timers (Date included, so the
// controller's clock moves with them).

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
const live = require("./use-tint-manager-live") as typeof import("./use-tint-manager-live");
const { useTintManagerLive, isTintLive, boardOrderIds, capIds, TINT_LIVE_HINT_KEY } = live;

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
const SERVER_NOW = "2026-09-30T08:00:00.000Z"; // 13:30 IST — midnight is far away
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
const hit = (ids: number[], extra: Record<string, unknown> = {}) => ({
  enabled: true, cursor: "v1.101.0", changes: ids.length ? [{ entity: "order", ids }] : [], more: false, reset: false,
  lagSeconds: 0, serverNow: SERVER_NOW, ...extra,
});

type Opts = Parameters<typeof useTintManagerLive>[0];
function setup(over: Partial<Opts> = {}) {
  const counts = { board: 0, missing: 0, panel: 0 };
  let opts: Opts = {
    hold: false,
    boardIds: () => [3, 5, 9],
    missingIds: () => [42],
    panelOrderId: null,
    fetchBoard: async () => { counts.board++; },
    fetchMissing: async () => { counts.missing++; },
    onPanelBillChanged: () => { counts.panel++; },
    ...over,
  };
  let last = renderer.render(() => useTintManagerLive(opts));
  return {
    counts,
    rerender(patch: Partial<Opts> = {}) {
      opts = { ...opts, ...patch };
      last = renderer.render(() => useTintManagerLive(opts));
      return last;
    },
    get live() { return last.live; },
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

// ── pure ────────────────────────────────────────────────────────────────────
test("isTintLive / boardOrderIds / capIds", () => {
  assert.equal(isTintLive("live", false), true);
  assert.equal(isTintLive("unknown", true), true);
  assert.equal(isTintLive("unknown", false), false);
  assert.equal(isTintLive("off", true), false);
  assert.equal(isTintLive("fallback", true), false);
  const ids = boardOrderIds({
    orders: [{ id: 1 }, { id: 2 }],
    activeSplits: [{ order: { id: 2 } }, { order: { id: 3 } }],
    completedSplits: [{ order: { id: 4 } }],
    completedAssignments: [{ order: { id: 5 } }, { order: { id: 1 } }],
  } as never);
  assert.deepEqual(ids, [1, 2, 3, 4, 5]);
  assert.equal(capIds(Array.from({ length: 150 }, (_, i) => i + 1)).split(",").length, 100);
  assert.equal(capIds([]), "");
  assert.equal(TINT_LIVE_HINT_KEY, "orbit.live.tint");
});

// ── ON ──────────────────────────────────────────────────────────────────────
test("ON: screen=tint with held + missing; one reload at start; one per hit; never the marker", async () => {
  reset();
  await withTimers(async () => {
    answers = [HEAD, hit([5])];
    const h = setup();
    await flush();
    h.rerender();
    assert.equal(h.live, true);
    assert.equal(h.counts.board, 1, "the start full load (after the head cursor)");
    assert.equal(h.counts.missing, 1, "a full load re-reads the side list too");
    const first = new URL("http://x" + feedCalls()[0]);
    assert.equal(first.searchParams.get("screen"), "tint");
    assert.equal(first.searchParams.get("topics"), "order,config");
    assert.equal(first.searchParams.get("held"), "3,5,9");
    assert.equal(first.searchParams.get("missing"), "42");
    await advance(20_000);
    assert.equal(h.counts.board, 2, "ONE reload for the hit");
    assert.equal(calls.some((u) => u.includes("/api/tint/manager/marker")), false, "no marker probe on the feed");
    assert.equal(store.get(TINT_LIVE_HINT_KEY), "1", "hint written");
  });
});

test("ON: a non-tint glance ('nothing for you', changes: []) → no reload", async () => {
  reset();
  await withTimers(async () => {
    answers = [HEAD, hit([]), hit([])];
    const h = setup();
    await flush();
    const before = h.counts.board;
    await advance(40_000);
    assert.equal(h.counts.board, before);
  });
});

test("hold (panel / selection / re-sequence / modal): nothing while held, exactly ONE reload on release", async () => {
  reset();
  await withTimers(async () => {
    answers = [HEAD];
    const h = setup();
    await flush();
    const base = h.counts.board;
    h.rerender({ hold: true });
    answers = [hit([3]), hit([9]), hit([5])];
    const n0 = feedCalls().length;
    await advance(60_000);
    assert.ok(feedCalls().length - n0 >= 3, "the glance kept running while held");
    assert.equal(answers.length, 0, "all three hits were delivered");
    assert.equal(h.counts.board, base, "held");
    h.rerender({ hold: false });
    await flush();
    assert.equal(h.counts.board, base + 1, "applied once on release");
    await advance(20_000);
    assert.equal(h.counts.board, base + 1, "and not again");
  });
});

test("strip: onPanelBillChanged only when the OPEN bill is in the batch", async () => {
  reset();
  await withTimers(async () => {
    answers = [HEAD, hit([7]), hit([5])];
    const h = setup({ panelOrderId: 5, hold: true });
    await flush();
    await advance(20_000);
    assert.equal(h.counts.panel, 0, "7 is not the open bill");
    await advance(20_000);
    assert.equal(h.counts.panel, 1, "5 is");
  });
});

test("missingTouched → the side list re-read once; held until release", async () => {
  reset();
  await withTimers(async () => {
    answers = [HEAD];
    const h = setup();
    await flush();
    const m0 = h.counts.missing;
    const b0 = h.counts.board;
    answers = [hit([], { missingTouched: true })];
    await advance(20_000);
    assert.equal(h.counts.missing, m0 + 1);
    assert.equal(h.counts.board, b0, "no board reload for a side-list-only change");
    h.rerender({ hold: true });
    answers = [hit([], { missingTouched: true })];
    await advance(20_000);
    assert.equal(h.counts.missing, m0 + 1, "held");
    h.rerender({ hold: false });
    await flush();
    assert.equal(h.counts.missing, m0 + 2, "once on release");
  });
});

test("hidden tab → no feed requests", async () => {
  reset();
  await withTimers(async () => {
    answers = [HEAD];
    setup();
    await flush();
    setVisible(false);
    const n = feedCalls().length;
    await advance(5 * 60_000, 5_000);
    assert.equal(feedCalls().length, n);
  });
});

// ── OFF ─────────────────────────────────────────────────────────────────────
test("OFF: not live, no board / side-list fetch, hint cleared; one switch re-check a minute", async () => {
  reset();
  await withTimers(async () => {
    enabled = false;
    store.set(TINT_LIVE_HINT_KEY, "1");
    const h = setup();
    await flush();
    h.rerender();
    assert.equal(h.live, false, "→ the page mounts <LegacyTintManagerSync>");
    assert.equal(store.has(TINT_LIVE_HINT_KEY), false);
    await advance(120_000, 5_000);
    assert.equal(h.counts.board, 0);
    assert.equal(h.counts.missing, 0);
    assert.ok(feedCalls().length <= 3, `feed re-checks: ${feedCalls().length}`);
    assert.equal(calls.filter((u) => !u.startsWith("/api/live/changes")).length, 0, "nothing else fetched by the feed");
  });
});

test("the page mounts the legacy marker ONLY while the feed is not live, with today's exact props", () => {
  const src = readFileSync(path.join(__dirname, "..", "tint-manager-content.tsx"), "utf8").replace(/\r/g, "");
  assert.match(
    src,
    /\{!feedLive && \(\s*<LegacyTintManagerSync\s+paused=\{panelKey !== null \|\| selection\.size > 0\}\s+onProbe=\{setConnected\}\s+onChange=\{\(\) => \{ void fetchBoard\(\); \}\}\s*\/>\s*\)\}/,
  );
  assert.equal((src.match(/useTintManagerSync\(/g) ?? []).length, 0, "the page no longer calls the hook directly");
  assert.equal(/router\.refresh\(/.test(src), false);
});
