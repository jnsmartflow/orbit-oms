"use client";

// Billing v2 — ONE marker poll for the whole billing face.
//
// WHY THIS EXISTS. `BillingTabBar` and `BillingPickingTab` are SIBLINGS inside
// ReviewView's right pane, and each used to run its own `usePickingMarker`
// against the SAME `/api/billing/picking/marker`. The tab bar is mounted on
// both tabs (its Picking badge must stay live while the operator is on Orders);
// the picking tab mounts only when its tab is open. So on the Picking tab the
// page ran TWO independent timers hitting one endpoint — double the probes for
// exactly the same answer. Being siblings, neither could see the other.
//
// This provider owns the single poll and fans the result out to both. It
// renders NO DOM — just a context around whatever it wraps — so the OFF path is
// structurally unchanged (§23.1: gate with siblings, never wrapper divs).
//
// ⚠ SPLIT INTO TWO COMPONENTS ON PURPOSE. `enabled` decides which one renders,
// so the hook is either always called or never called for a given mount — never
// conditionally inside one component, which would break the rules of hooks if
// the flag ever flipped mid-session.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePickingMarker } from "@/lib/hooks/use-picking-marker";

const MARKER_URL = "/api/billing/picking/marker";

/**
 * Billing's own cadence: 30s, HALF the shared 15s default.
 *
 * This list is a desk handoff — bills the floor has approved, waiting to be
 * invoiced — not a live floor board. Its count moves a handful of times a day
 * (the marker logged ~88 calls on 2026-08-09 for one pilot user), and nothing
 * on this screen is time-critical to the second.
 *
 * ⚠ This is Billing's number ONLY. Floor stays on 15s: the same probe feeds its
 * connection strip through `onProbe`, so slowing it would make "not connected"
 * take twice as long to appear. Picking's two boards stay on 15s too.
 */
export const BILLING_MARKER_POLL_MS = 30_000;

interface BillingMarkerApi {
  /** Register a callback fired once per detected change. Returns an unsubscribe. */
  subscribe: (fn: () => void) => () => void;
  /**
   * Request/release a pause. Any subscriber holding a pause stops the SHARED
   * marker from firing onChange (it keeps polling and tracking, exactly like the
   * hook's own `paused`), and a change that lands while paused fires once on
   * release. Keyed so two holders cannot clobber each other.
   */
  setPaused: (key: string, paused: boolean) => void;
}

const INERT: BillingMarkerApi = {
  subscribe: () => () => {},
  setPaused: () => {},
};

const BillingMarkerContext = createContext<BillingMarkerApi>(INERT);

/** Subscribe to the shared marker. `onChange` fires once per detected change. */
export function useBillingMarkerSubscription(onChange: () => void): void {
  const { subscribe } = useContext(BillingMarkerContext);
  // Ref-latched so a caller passing an inline arrow does not resubscribe every
  // render — same trick the underlying hook uses for its own callbacks.
  const ref = useRef(onChange);
  useEffect(() => {
    ref.current = onChange;
  }, [onChange]);
  useEffect(() => subscribe(() => ref.current()), [subscribe]);
}

/** Hold the shared marker paused while `paused` is true, under a stable key. */
export function useBillingMarkerPause(key: string, paused: boolean): void {
  const { setPaused } = useContext(BillingMarkerContext);
  useEffect(() => {
    setPaused(key, paused);
    // Release on unmount, or a component that unmounts mid-selection would
    // wedge the marker paused for everyone else.
    return () => setPaused(key, false);
  }, [key, paused, setPaused]);
}

function ActiveBillingMarkerProvider({
  date,
  url = MARKER_URL,
  context: Context = BillingMarkerContext,
  children,
}: {
  date?: string;
  /** The Print tab's twin points this at its own marker (slice 9). */
  url?: string;
  context?: React.Context<BillingMarkerApi>;
  children: React.ReactNode;
}) {
  const subsRef = useRef(new Set<() => void>());
  const pauseKeysRef = useRef(new Set<string>());
  const [pauseCount, setPauseCount] = useState(0);

  const subscribe = useCallback((fn: () => void) => {
    subsRef.current.add(fn);
    return () => {
      subsRef.current.delete(fn);
    };
  }, []);

  const setPaused = useCallback((key: string, paused: boolean) => {
    const keys = pauseKeysRef.current;
    const had = keys.has(key);
    if (paused === had) return; // no-op — do not churn state
    if (paused) keys.add(key);
    else keys.delete(key);
    setPauseCount(keys.size);
  }, []);

  const api = useMemo<BillingMarkerApi>(() => ({ subscribe, setPaused }), [subscribe, setPaused]);

  // THE single poll. `paused` is true while ANY subscriber holds a pause — the
  // hook keeps polling and advancing its baseline, and flushes one onChange when
  // the last holder releases. That is the same contract each component had on
  // its own marker, now shared.
  usePickingMarker({
    scope: "openPending",
    url,
    date,
    pollMs: BILLING_MARKER_POLL_MS,
    paused: pauseCount > 0,
    onChange: () => {
      // Snapshot before iterating: a subscriber could unsubscribe during its own
      // callback, which would mutate the live Set mid-iteration.
      for (const fn of Array.from(subsRef.current)) fn();
    },
  });

  return <Context.Provider value={api}>{children}</Context.Provider>;
}

/**
 * Mount around any region containing billing components that need the marker.
 * With `enabled` false it is a pure pass-through: no timer, no fetch, and the
 * context stays INERT so a subscriber inside it simply never fires.
 */
export function BillingMarkerProvider({
  enabled,
  date,
  children,
}: {
  enabled: boolean;
  date?: string;
  children: React.ReactNode;
}) {
  if (!enabled) {
    return <BillingMarkerContext.Provider value={INERT}>{children}</BillingMarkerContext.Provider>;
  }
  return <ActiveBillingMarkerProvider date={date}>{children}</ActiveBillingMarkerProvider>;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE PRINT TAB'S MARKER (slice 9, 2026-09-15)
//
// A SECOND poll, on its own context, against /api/billing/print/marker — the
// Print pill's count and the Print tab's refetch. Separate from the Picking poll
// above because the two are different keys with different holders: a viewer
// with Print but not Picking must not poll Picking's route (403s all day), and
// the reverse. Same cadence, same pause contract, same pass-through when off.
// ─────────────────────────────────────────────────────────────────────────────

const PRINT_MARKER_URL = "/api/billing/print/marker";

const BillingPrintMarkerContext = createContext<BillingMarkerApi>(INERT);

/** Subscribe to the Print marker. `onChange` fires once per detected change. */
export function useBillingPrintMarkerSubscription(onChange: () => void): void {
  const { subscribe } = useContext(BillingPrintMarkerContext);
  const ref = useRef(onChange);
  useEffect(() => {
    ref.current = onChange;
  }, [onChange]);
  useEffect(() => subscribe(() => ref.current()), [subscribe]);
}

/** Hold the Print marker paused while `paused` is true, under a stable key. */
export function useBillingPrintMarkerPause(key: string, paused: boolean): void {
  const { setPaused } = useContext(BillingPrintMarkerContext);
  useEffect(() => {
    setPaused(key, paused);
    return () => setPaused(key, false);
  }, [key, paused, setPaused]);
}

/** Mount around the billing face for viewers holding `billing_print`/canView. */
export function BillingPrintMarkerProvider({
  enabled,
  date,
  children,
}: {
  enabled: boolean;
  date?: string;
  children: React.ReactNode;
}) {
  if (!enabled) {
    return <BillingPrintMarkerContext.Provider value={INERT}>{children}</BillingPrintMarkerContext.Provider>;
  }
  return (
    <ActiveBillingMarkerProvider date={date} url={PRINT_MARKER_URL} context={BillingPrintMarkerContext}>
      {children}
    </ActiveBillingMarkerProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// THE TELEPHONIC TAB'S MARKER (2026-09-22)
//
// A THIRD poll, on its own context, against /api/billing/telephonic/marker —
// the Telephonic pill's count and the Telephonic tab's refetch. Its own key
// (`billing_telephonic`) and its own holders, for the same no-403-polling reason
// as Print's. Same 30s cadence, same pause contract, same pass-through when off.
//
// The route sends `signature` (its match + skip-reason counts), which
// usePickingMarker compares beside count and latest — so the list refetches when
// ANY of the marker's four fields moves, not just two.
// ─────────────────────────────────────────────────────────────────────────────

const TELEPHONIC_MARKER_URL = "/api/billing/telephonic/marker";

const BillingTelephonicMarkerContext = createContext<BillingMarkerApi>(INERT);

/** Subscribe to the Telephonic marker. `onChange` fires once per detected change. */
export function useBillingTelephonicMarkerSubscription(onChange: () => void): void {
  const { subscribe } = useContext(BillingTelephonicMarkerContext);
  const ref = useRef(onChange);
  useEffect(() => {
    ref.current = onChange;
  }, [onChange]);
  useEffect(() => subscribe(() => ref.current()), [subscribe]);
}

/** Hold the Telephonic marker paused while `paused` is true, under a stable key. */
export function useBillingTelephonicMarkerPause(key: string, paused: boolean): void {
  const { setPaused } = useContext(BillingTelephonicMarkerContext);
  useEffect(() => {
    setPaused(key, paused);
    return () => setPaused(key, false);
  }, [key, paused, setPaused]);
}

/** Mount around the billing face for viewers holding `billing_telephonic`/canView. */
export function BillingTelephonicMarkerProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  if (!enabled) {
    return (
      <BillingTelephonicMarkerContext.Provider value={INERT}>{children}</BillingTelephonicMarkerContext.Provider>
    );
  }
  return (
    <ActiveBillingMarkerProvider url={TELEPHONIC_MARKER_URL} context={BillingTelephonicMarkerContext}>
      {children}
    </ActiveBillingMarkerProvider>
  );
}
