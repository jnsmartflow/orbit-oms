// components/tint/manager/use-tint-manager-sync.test.ts
//   npx tsx --test components/tint/manager/use-tint-manager-sync.test.ts (npm run test:tint-sync)
//
// The Tint Manager quick win (2026-09-30): the blind 60 s refetch is gone, the 15 s marker probe
// and its "one probe on becoming visible" are unchanged, and the missing-customers poll runs only
// while the tab is visible. No DOM library is installed, so the hooks run under a tiny fake React
// (useRef / useMemo / useCallback / useEffect) with a fake `document`, a scripted `fetch`, and
// node:test's mock timers.

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
    render(hook: () => void) {
      cursor = 0;
      pending = [];
      hook();
      for (const p of pending) {
        const prev = slots[p.k];
        if (typeof prev.cleanup === "function") prev.cleanup();
        prev.cleanup = p.fn();
        prev.deps = p.deps;
      }
    },
    unmount() {
      for (const s of slots) if (s && typeof s.cleanup === "function") s.cleanup();
      slots = [];
    },
  };
}

const renderer = createRenderer();
// Route `react` to the fake BEFORE the hooks load (CJS under tsx).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as { _load: (req: string, ...rest: unknown[]) => unknown };
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === "react") return renderer.fakeReact;
  return origLoad.call(this, req, ...rest);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useTintManagerSync } = require("./use-tint-manager-sync") as typeof import("./use-tint-manager-sync");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useMissingCustomersPoll, MISSING_CUSTOMERS_POLL_MS } =
  require("./use-missing-customers-poll") as typeof import("./use-missing-customers-poll");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PICKING_MARKER_POLL_MS } = require("@/lib/hooks/use-picking-marker") as typeof import("@/lib/hooks/use-picking-marker");

// ── fake document + fetch ───────────────────────────────────────────────────
const listeners = new Set<() => void>();
const fakeDoc = {
  visibilityState: "visible" as "visible" | "hidden",
  addEventListener: (_t: string, fn: () => void) => listeners.add(fn),
  removeEventListener: (_t: string, fn: () => void) => listeners.delete(fn),
};
function setVisible(v: boolean) {
  fakeDoc.visibilityState = v ? "visible" : "hidden";
  Array.from(listeners).forEach((fn) => fn());
}
(globalThis as unknown as { document: unknown }).document = fakeDoc;

const calls: string[] = [];
let markerBody = { count: 5, latest: "2026-09-30T08:00:00.000Z" };
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  calls.push(url);
  return { ok: true, json: async () => markerBody };
};

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
async function advance(ms: number, step = 1_000) {
  for (let t = 0; t < ms; t += step) { mock.timers.tick(step); await flush(); }
}
const markerCalls = () => calls.filter((u) => u.startsWith("/api/tint/manager/marker")).length;

function reset() {
  calls.length = 0;
  listeners.clear();
  fakeDoc.visibilityState = "visible";
  markerBody = { count: 5, latest: "2026-09-30T08:00:00.000Z" };
}

// ── static ──────────────────────────────────────────────────────────────────
test("the sync hook has no setInterval and no SLOW_REFETCH_MS left", () => {
  const src = readFileSync(path.join(__dirname, "use-tint-manager-sync.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(/setInterval/.test(src), false);
  assert.equal(/SLOW_REFETCH_MS/.test(src), false);
});

// ── the marker path ─────────────────────────────────────────────────────────
test("marker: 15 s probe; no refetch by time alone; exactly one probe on visible after 10 min hidden", async () => {
  reset();
  mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  try {
    let changes = 0;
    renderer.render(() => useTintManagerSync({ paused: false, onChange: () => { changes++; }, onProbe: () => {} }));
    await flush();
    assert.equal(markerCalls(), 1, "baseline probe at mount");

    await advance(5 * 60_000);
    assert.equal(markerCalls(), 1 + (5 * 60_000) / PICKING_MARKER_POLL_MS, "one probe per 15 s");
    assert.equal(changes, 0, "an unchanged marker never refetches — the blind 60 s tick is gone");

    const before = markerCalls();
    setVisible(false);
    await advance(10 * 60_000);
    assert.equal(markerCalls(), before, "no probe while hidden");

    setVisible(true);
    await flush();
    assert.equal(markerCalls(), before + 1, "exactly one probe on becoming visible");
    await advance(PICKING_MARKER_POLL_MS - 1_000);
    assert.equal(markerCalls(), before + 1, "no burst after the visible probe");
    await advance(1_000);
    assert.equal(markerCalls(), before + 2, "then the 15 s cadence resumes");

    markerBody = { count: 5, latest: "2026-09-30T08:05:00.000Z" }; // a child write moved `latest`
    await advance(PICKING_MARKER_POLL_MS);
    assert.equal(changes, 1, "a moved `latest` fires one refetch");
  } finally {
    renderer.unmount();
    mock.timers.reset();
  }
});

test("marker: a change while paused fires once on resume (unchanged behaviour)", async () => {
  reset();
  mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  try {
    let changes = 0;
    const hook = (paused: boolean) => () =>
      useTintManagerSync({ paused, onChange: () => { changes++; }, onProbe: () => {} });
    renderer.render(hook(true));
    await flush();
    markerBody = { count: 6, latest: "2026-09-30T08:01:00.000Z" };
    await advance(PICKING_MARKER_POLL_MS);
    assert.equal(changes, 0, "held while paused");
    renderer.render(hook(false));
    assert.equal(changes, 1, "fires once on resume");
  } finally {
    renderer.unmount();
    mock.timers.reset();
  }
});

// ── the missing-customers poll ──────────────────────────────────────────────
test("missing-customers: mount + every 5 min while visible; nothing while hidden; one on visible; cleared on unmount", async () => {
  reset();
  mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  try {
    let n = 0;
    renderer.render(() => useMissingCustomersPoll(() => { n++; }));
    assert.equal(n, 1, "once on mount");
    await advance(MISSING_CUSTOMERS_POLL_MS, 60_000);
    assert.equal(n, 2, "every 5 min while visible");

    setVisible(false);
    await advance(30 * 60_000, 60_000);
    assert.equal(n, 2, "the timer does not fire while hidden");

    setVisible(true);
    assert.equal(n, 3, "once on becoming visible");
    await advance(MISSING_CUSTOMERS_POLL_MS, 60_000);
    assert.equal(n, 4);

    renderer.unmount();
    await advance(20 * 60_000, 60_000);
    assert.equal(n, 4, "the timer is cleared on unmount");
    assert.equal(listeners.size, 0, "the visibility listener is removed on unmount");
  } finally {
    renderer.unmount();
    mock.timers.reset();
  }
});

test("missing-customers: mounted hidden → one fetch, no timer until visible", async () => {
  reset();
  fakeDoc.visibilityState = "hidden";
  mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  try {
    let n = 0;
    renderer.render(() => useMissingCustomersPoll(() => { n++; }));
    assert.equal(n, 1);
    await advance(20 * 60_000, 60_000);
    assert.equal(n, 1);
    setVisible(true);
    assert.equal(n, 2);
  } finally {
    renderer.unmount();
    mock.timers.reset();
  }
});
