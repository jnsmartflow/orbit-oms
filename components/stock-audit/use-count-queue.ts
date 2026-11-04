"use client";

// components/stock-audit/use-count-queue.ts — the stock-count OFFLINE QUEUE's
// sender (Schema v27.80, Smart Flow 2026-11-04). The rules are pure, in
// lib/stock-audit/queue-core.ts; storage is count-queue-store.ts; this hook
// is the loop that runs them while the page is open.
//
// SENDER: single-flight, one POST at a time, oldest countedAt first — the
// current audit's queue first, then any older audit's (their entries get
// "Failed — audit closed", or a 200 replay when the save had landed). 15 s
// timeout per POST (count-api.ts). Backoff after a network failure 3 → 6 → 12
// → 24 → 48 → 60 s cap ±20%; reset ("kick") on success, the `online` event,
// visibilitychange → visible, mount, every enqueue and every tap-to-retry.
// navigator.onLine is a banner hint only — never a reason to skip an attempt
// (weak Wi-Fi reports "online" while nothing gets through, and the reverse).
//
// TWO TABS: every change re-reads storage first (read-modify-write) and a
// `storage` event re-reads the docs. If both tabs send the same entry, the
// clientId makes the second a replay — harmless.
//
// HONEST LIMIT (no service worker in this phase): sending happens only while
// Orbit is open. A reload WITHOUT signal shows the browser's offline page; the
// counts stay in localStorage and send on the next open with signal.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { newClientId } from "@/lib/stock-audit/client-id";
import {
  applyOutcome,
  backoffMs,
  bannerFor,
  classifySend,
  dropConfirmed,
  editEntry,
  emptyQueue,
  enqueue as enqueueEntry,
  makeEntry,
  markSending,
  nextToSend,
  removeEntry,
  retryEntry,
  type Banner,
  type PauseReason,
  type QueueDoc,
  type QueuedEntry,
} from "@/lib/stock-audit/queue-core";
import type { CountLine } from "@/lib/stock-audit/types";
import { createLine } from "./count-api";
import {
  isMyQueueKey,
  listQueueAuditIds,
  readQueue,
  storageWorks,
  writeQueue,
} from "./count-queue-store";

export interface QueueAudit {
  id: number;
  auditNumber: string;
}

export interface EnqueueInput {
  material: string;
  qty: number;
  inCatalog: boolean;
  skuDescription: string | null;
  skuPack: string | null;
}

/** An entry as the screen shows it — "sending" is the live in-flight one. */
export interface ShownEntry extends QueuedEntry {
  shownState: "waiting" | "sending" | "failed";
}

export interface OlderQueue {
  auditId: number;
  auditNumber: string;
  entries: ShownEntry[];
}

interface Options {
  userId: number;
  /** THE open audit, or null (none open / still loading). */
  audit: QueueAudit | null;
  /** A send was confirmed — merge the line into the Submitted list. */
  onSent: (auditId: number, line: CountLine) => void;
  /** The queue emptied after at least one send — re-read my lines. */
  onDrained: (auditId: number) => void;
  /** A send was answered AUDIT_CLOSED for this audit. */
  onAuditClosed: (auditId: number) => void;
  /** A send was answered NOT_IN_CATALOG — the phone's SKU list may be stale. */
  onNotInCatalog: () => void;
}

export interface CountQueue {
  /** The current audit's unsent entries, newest first. */
  entries: ShownEntry[];
  /** Other audits' unsent entries (normally "audit closed"), newest first. */
  older: OlderQueue[];
  banner: Banner | null;
  /** false = localStorage is not working; Submit saves online only. */
  persistent: boolean;
  /** Save a new count on the phone. false = storage refused it (save online). */
  enqueue: (input: EnqueueInput) => boolean;
  edit: (auditId: number, clientId: string, qty: number) => void;
  remove: (auditId: number, clientId: string) => void;
  retry: (auditId: number, clientId: string, asNotInCatalog?: boolean) => void;
  /** After GET lines: drop queued entries the server already holds. */
  reconcile: (auditId: number, lines: CountLine[]) => void;
  /** Try sending now (e.g. after a sign-in in another tab). */
  kick: () => void;
}

function newestFirst(a: QueuedEntry, b: QueuedEntry): number {
  return a.countedAt < b.countedAt ? 1 : a.countedAt > b.countedAt ? -1 : 0;
}

export function useCountQueue({ userId, audit, onSent, onDrained, onAuditClosed, onNotInCatalog }: Options): CountQueue {
  const auditId = audit?.id ?? null;
  const auditNumber = audit?.auditNumber ?? "";

  /** Every doc this user has, keyed by audit id — the in-memory truth. */
  const docsRef = useRef<Map<number, QueueDoc>>(new Map());
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const [persistent, setPersistent] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [paused, setPaused] = useState<PauseReason | null>(null);
  const [networkDown, setNetworkDown] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [browserOffline, setBrowserOffline] = useState(false);

  const sendingRef = useRef(false);
  const failStreak = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentSinceDrain = useRef<Set<number>>(new Set());
  /** Every clientId the server confirmed in this page's life. If storage
   *  could not record a removal, the stale copy must not be sent in a loop. */
  const confirmed = useRef<Set<string>>(new Set());
  const mounted = useRef(true);

  // Callbacks live in refs so the loop never restarts on a parent re-render.
  const cb = useRef({ onSent, onDrained, onAuditClosed, onNotInCatalog });
  cb.current = { onSent, onDrained, onAuditClosed, onNotInCatalog };

  /** Re-read every doc of this user from storage. */
  const reloadAll = useCallback((): void => {
    const next = new Map<number, QueueDoc>();
    for (const id of listQueueAuditIds(userId)) {
      const d = readQueue(userId, id);
      if (d && d.entries.length > 0) next.set(id, d);
    }
    docsRef.current = next;
  }, [userId]);

  /** Read-modify-write one doc: always start from storage (another tab may have changed it). */
  const update = useCallback(
    (id: number, number: string, f: (d: QueueDoc) => QueueDoc): boolean => {
      const fresh = readQueue(userId, id) ?? docsRef.current.get(id) ?? emptyQueue(userId, id, number);
      const next = f(fresh);
      const ok = writeQueue(next);
      if (next.entries.length === 0) docsRef.current.delete(id);
      else docsRef.current.set(id, next);
      bump();
      return ok;
    },
    [userId, bump],
  );

  const clearTimer = (): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  /** The send loop. One entry at a time; returns when nothing is sendable. */
  const pump = useCallback(async (): Promise<void> => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    clearTimer();
    try {
      for (;;) {
        if (!mounted.current) return;
        reloadAll();
        // The current audit first, then older ones.
        const order = Array.from(docsRef.current.keys()).sort((a, b) =>
          a === auditId ? -1 : b === auditId ? 1 : a - b,
        );
        let doc: QueueDoc | null = null;
        let entry: QueuedEntry | null = null;
        for (const id of order) {
          let d = docsRef.current.get(id);
          if (d && d.entries.some((x) => confirmed.current.has(x.clientId))) {
            const drop = d;
            update(id, drop.auditNumber, (q) => ({
              ...q,
              entries: q.entries.filter((x) => !confirmed.current.has(x.clientId)),
            }));
            d = { ...drop, entries: drop.entries.filter((x) => !confirmed.current.has(x.clientId)) };
          }
          const e = d ? nextToSend(d) : null;
          if (d && e) {
            doc = d;
            entry = e;
            break;
          }
        }
        if (!doc || !entry) {
          // Drained (of sendable entries) — tell the shell to re-read.
          for (const id of Array.from(sentSinceDrain.current)) cb.current.onDrained(id);
          sentSinceDrain.current.clear();
          setRecovered(false);
          return;
        }

        const d0 = doc;
        const e0 = entry;
        docsRef.current.set(d0.auditId, markSending(d0, e0.clientId, new Date().toISOString()));
        setSendingId(e0.clientId);

        const r = await createLine(d0.auditId, {
          material: e0.material,
          qty: String(e0.qty),
          ...(e0.notInCatalog ? { notInCatalog: true } : {}),
          clientId: e0.clientId,
          userId,
          countedAt: e0.countedAt,
        });
        const outcome = classifySend(r.ok ? { ok: true } : { ok: false, code: r.error.code, message: r.error.message });
        update(d0.auditId, d0.auditNumber, (d) => applyOutcome(d, e0.clientId, outcome));
        setSendingId(null);

        if (outcome.kind === "sent" && r.ok) {
          confirmed.current.add(e0.clientId);
          failStreak.current = 0;
          setNetworkDown(false);
          setPaused(null);
          sentSinceDrain.current.add(d0.auditId);
          cb.current.onSent(d0.auditId, r.data.line);
          continue;
        }
        if (outcome.kind === "fail") {
          setNetworkDown(false);
          if (outcome.fail.kind === "closed") cb.current.onAuditClosed(d0.auditId);
          if (outcome.fail.kind === "confirm") cb.current.onNotInCatalog();
          continue; // a failed entry never blocks the ones behind it
        }
        if (outcome.kind === "pause") {
          setPaused(outcome.reason);
          return; // the whole queue waits for a kick (sign-in, visibility, online)
        }
        // retry — the network (or the server) is not answering: back off.
        failStreak.current += 1;
        setNetworkDown(true);
        setRecovered(true);
        const delay = backoffMs(failStreak.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          void pump();
        }, delay);
        return;
      }
    } finally {
      sendingRef.current = false;
      setSendingId(null);
    }
  }, [auditId, userId, reloadAll, update]);

  const kick = useCallback((): void => {
    failStreak.current = 0;
    setPaused(null);
    void pump();
  }, [pump]);

  // Mount / audit change: load, probe storage, send.
  useEffect(() => {
    mounted.current = true;
    setPersistent(storageWorks());
    reloadAll();
    bump();
    kick();
    return () => {
      mounted.current = false;
      clearTimer();
    };
  }, [auditId, reloadAll, bump, kick]);

  // Triggers: back online, back to the tab, another tab changed the queue.
  useEffect(() => {
    const onOnline = (): void => {
      setBrowserOffline(false);
      kick();
    };
    const onOffline = (): void => setBrowserOffline(true);
    const onVisible = (): void => {
      if (document.visibilityState === "visible") kick();
    };
    const onStorage = (e: StorageEvent): void => {
      if (!isMyQueueKey(e.key, userId)) return;
      reloadAll();
      bump();
    };
    setBrowserOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
    };
  }, [userId, kick, reloadAll, bump]);

  const enqueue = useCallback(
    (input: EnqueueInput): boolean => {
      if (auditId === null) return false;
      if (!storageWorks()) {
        setPersistent(false);
        return false;
      }
      const entry = makeEntry({ ...input, clientId: newClientId(), countedAt: new Date().toISOString() });
      const ok = update(auditId, auditNumber, (d) => enqueueEntry(d, entry));
      if (!ok) {
        // Quota full: undo the memory copy so it is not sent twice by the fallback.
        update(auditId, auditNumber, (d) => removeEntry(d, entry.clientId));
        setPersistent(false);
        return false;
      }
      kick();
      return true;
    },
    [auditId, auditNumber, update, kick],
  );

  const numberOf = useCallback(
    (id: number): string => docsRef.current.get(id)?.auditNumber ?? (id === auditId ? auditNumber : ""),
    [auditId, auditNumber],
  );

  const edit = useCallback(
    (id: number, clientId: string, qty: number): void => {
      update(id, numberOf(id), (d) => editEntry(d, clientId, qty));
      kick();
    },
    [update, numberOf, kick],
  );

  const remove = useCallback(
    (id: number, clientId: string): void => {
      update(id, numberOf(id), (d) => removeEntry(d, clientId));
    },
    [update, numberOf],
  );

  const retry = useCallback(
    (id: number, clientId: string, asNotInCatalog = false): void => {
      update(id, numberOf(id), (d) => retryEntry(d, clientId, asNotInCatalog));
      kick();
    },
    [update, numberOf, kick],
  );

  const reconcile = useCallback(
    (id: number, lines: CountLine[]): void => {
      const d = readQueue(userId, id);
      if (!d || d.entries.length === 0) return;
      const next = dropConfirmed(d, lines.map((l) => l.clientId));
      if (next.entries.length !== d.entries.length) update(id, d.auditNumber, () => next);
    },
    [userId, update],
  );

  // ── What the screen shows ─────────────────────────────────────────────────
  const { entries, older, banner } = useMemo(() => {
    void version;
    const show = (e: QueuedEntry): ShownEntry => ({
      ...e,
      shownState: e.clientId === sendingId ? "sending" : e.state === "failed" ? "failed" : "waiting",
    });
    let mine: ShownEntry[] = [];
    const others: OlderQueue[] = [];
    let pending = 0;
    let failedOther = 0;
    let failedClosed = 0;
    for (const d of Array.from(docsRef.current.values())) {
      const shown = d.entries.map(show).sort(newestFirst);
      for (const e of shown) {
        if (e.shownState !== "failed") pending++;
        else if (e.fail?.kind === "closed") failedClosed++;
        else failedOther++;
      }
      if (d.auditId === auditId) mine = shown;
      else if (shown.length > 0) others.push({ auditId: d.auditId, auditNumber: d.auditNumber, entries: shown });
    }
    return {
      entries: mine,
      older: others,
      banner: bannerFor({
        pending,
        failedOther,
        failedClosed,
        paused,
        networkDown: networkDown || browserOffline,
        recovered,
        persistent,
      }),
    };
  }, [version, sendingId, auditId, paused, networkDown, browserOffline, recovered, persistent]);

  return { entries, older, banner, persistent, enqueue, edit, remove, retry, reconcile, kick };
}
