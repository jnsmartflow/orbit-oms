"use client";

// Billing v2 — the Pick delete QUEUE (2026-09-27; extracted 2026-09-28).
//
// Two or more live bills share one SO number. Only billing knows whether the
// later bill is genuine or a mistake, so billing decides here, ONE GROUP AT A
// TIME, oldest first: All OK (keep every bill) or Pick delete (cancel one bill
// as a duplicate).
//
// WHERE IT RENDERS. Only inside the blocking popup
// (components/billing/billing-pick-delete-popup.tsx), on every Billing tab. It
// was the body of the Pick delete tab until 2026-09-28; that tab is now History
// only (billing-pick-delete-tab.tsx). Moved here UNCHANGED — the popup must look
// exactly like the tab did. Design: docs/prompts/drafts/web-update-2026-09-27-billing-
// pick-delete.md · mockup docs/mockups/billing/pick-delete-review.html.
//
// LAYOUT (2026-09-27 hand review). The group's bills sit side by side, ordered by
// REAL punch time (the timestamp, never the display string). The FIRST-PUNCH
// card is the baseline and is never marked; every later card is compared with
// it SKU by SKU and carries small bordered tags — Added / Removed / Qty was N.
// The lines arrive ALREADY MERGED per SKU (SAP per-batch split lines summed by
// lib/picking/group-lines.ts, in mergeBillLines) and ship WITH the list — one
// batched read, no per-bill fetch (2026-09-27) — so the comparison
// never sees raw batch rows. The screen deliberately names no verdict — it
// shows the difference and lets billing judge.
//
// OWNERSHIP. The duplicate-SO RULE is Picking's (lib/picking/duplicate-so.ts);
// the DECISION is Billing's (lib/billing/pick-delete.ts). Every button here only
// DRAWS what the routes allow — `canDelete` comes from pickDeleteCheck(), the
// same function the delete route runs, and the route re-checks on every press.
//
// 🔴 HIDE, NEVER DISABLE, FOR PERMISSION (CLAUDE_UI §10): without canEdit the
// All OK / Pick delete / Undo buttons are not rendered at all. A bill the RULE
// refuses keeps a greyed button with the reason in plain words — that is a fact
// about the bill, not about the viewer.
//
// Colours are Orbit tokens only (CLAUDE_UI §2.1): brand = the one commit (All
// OK, Next group); danger = Pick delete and the Removed tag; ok = the Added tag
// and the All OK panel; warn = the Qty-was tag; ink = neutral.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  useBillingPickDeleteMarkerPause,
  useBillingPickDeleteMarkerSubscription,
} from "@/components/billing/billing-marker-provider";
import { currentIstMonth } from "@/lib/billing/telephonic-so";
import { smartTitleCase } from "@/lib/mail-orders/utils";
import type {
  PickDeleteBill,
  PickDeleteGroup,
  PickDeleteLine,
  PickDeleteList,
} from "@/lib/billing/pick-delete-types";

export const PICK_DELETE_BASE = "/api/billing/pick-delete";
const BASE = PICK_DELETE_BASE;

/**
 * "Check the Pick delete count now." Fired on window by anything that knows a
 * group may have (re)appeared — the History tab after an Undo — and heard by the
 * popup host, which then probes the marker at once instead of waiting for 10s.
 */
export const PICK_DELETE_CHECK_EVENT = "billing:pick-delete-check";
/** The confirmation panel closes by itself after this long (design §3). */
const PANEL_MS = 6000;

// ── Formatting (IST) ────────────────────────────────────────────────────────

const DAY_FMT = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });
const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function fmtDayTime(iso: string | null): string {
  return iso ? `${DAY_FMT.format(new Date(iso))} · ${TIME_FMT.format(new Date(iso))}` : "—";
}
function fmtLitres(v: number | null): string {
  return v === null ? "—" : `${Number(v.toFixed(1))} L`;
}
export function customerOf(name: string | null): string {
  return name ? smartTitleCase(name) : "(Unmatched)";
}
/** This tab only: "Waiting" in place of the ladder's "Awaiting Support". The
 *  global label (lib/workflow-stages.ts) is untouched. */
function statusOf(b: PickDeleteBill): string {
  return b.stage === "pending_support" ? "Waiting" : b.stageLabel;
}
/** Punch time in ms; a bill with none sorts last. */
function punchMs(b: PickDeleteBill): number {
  return b.punchedAt ? new Date(b.punchedAt).getTime() : Number.POSITIVE_INFINITY;
}
function skuKey(l: PickDeleteLine): string {
  return l.sku.trim();
}

// ── Shared class strings ────────────────────────────────────────────────────

const BTN_BRAND =
  "rounded-lg bg-brand-600 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60";
export const BTN_SECONDARY =
  "rounded-md border border-ink-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-600 hover:bg-ink-25 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_DANGER =
  "rounded-lg border border-danger-bd bg-white px-3.5 py-1.5 text-[12.5px] font-semibold text-danger-text hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-60";
/** UI §10: a disabled button is grey, never a faded colour; same box as enabled. */
const BTN_REFUSED =
  "cursor-not-allowed rounded-lg border border-ink-100 bg-ink-50 px-3.5 py-1.5 text-[12.5px] font-semibold text-ink-400";
export const PILL = "inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold";
/** The change tags — small bordered text, never a filled block. */
const TAG = "ml-1.5 inline-block whitespace-nowrap rounded border px-1 text-[10px] font-semibold leading-[15px]";

// The per-bill lines table (lighter than the fixed standard — it sits inside a card).
const LTH = "border-b border-ink-50 px-3 py-1.5 text-left text-[10px] font-medium uppercase tracking-[0.04em] text-ink-400";
const LTD = "border-b border-ink-50 px-3 py-1.5 align-top";

// ── The confirmation panel's state ──────────────────────────────────────────

interface JustDone {
  decisionId: number;
  kind: "all_ok" | "pick_delete";
  soNumber: string;
  customer: string;
  correctPick: string;
}

export async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: "Could not reach the server — check the connection and try again." } };
  }
}

// ── The queue ───────────────────────────────────────────────────────────────

/** What the popup host needs to know to stay open or close. */
export interface PickDeleteQueueState {
  /** Groups on the last successful load (the list and the marker share one rule). */
  groups: number;
  /** A write is in flight or the confirmation panel is up — keep the popup open. */
  held: boolean;
}

export function PickDeleteQueue({
  canEdit,
  onState,
}: {
  canEdit: boolean;
  onState?: (s: PickDeleteQueueState) => void;
}) {
  // The list route also returns the History month; the queue reads only the
  // groups (ALL DATES), so any valid month will do.
  const [month] = useState<string>(() => currentIstMonth(new Date()));
  const [data, setData] = useState<PickDeleteList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cur, setCur] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justDone, setJustDone] = useState<JustDone | null>(null);
  /** After an Undo, jump back to that SO's group once the list reloads. */
  const [focusSo, setFocusSo] = useState<string | null>(null);

  const reqRef = useRef(0);
  const load = useCallback(async () => {
    const seq = ++reqRef.current;
    try {
      const res = await fetch(`${BASE}/list?month=${encodeURIComponent(month)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as PickDeleteList & { error?: string };
      if (seq !== reqRef.current) return;
      if (!res.ok) {
        setLoadError(body.error ?? "Could not load the list.");
        return;
      }
      setLoadError(null);
      setData(body);
    } catch {
      if (seq === reqRef.current) setLoadError("Could not load the list — check the connection.");
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live: refetch when the marker moves; hold it still while a write is in
  // flight or the confirmation panel is up (never move the ground under a hand).
  useBillingPickDeleteMarkerSubscription(load);
  useBillingPickDeleteMarkerPause("pick-delete-queue", busy || justDone !== null);

  const groups = useMemo(() => data?.groups ?? [], [data]);

  // Keep the cursor in range as groups come and go; honour a pending focus.
  useEffect(() => {
    if (focusSo !== null) {
      const i = groups.findIndex((g) => g.soNumber === focusSo);
      if (i >= 0) setCur(i);
      setFocusSo(null);
      return;
    }
    if (cur > 0 && cur >= groups.length) setCur(Math.max(0, groups.length - 1));
  }, [groups, cur, focusSo]);

  // The 6 s auto-close. Next group › and Undo clear it early.
  useEffect(() => {
    if (justDone === null) return;
    const t = window.setTimeout(() => setJustDone(null), PANEL_MS);
    return () => window.clearTimeout(t);
  }, [justDone]);

  const fail = useCallback(
    async (message: string) => {
      setNotice(message);
      await load();
    },
    [load],
  );

  const decideAllOk = useCallback(
    async (g: PickDeleteGroup) => {
      setBusy(true);
      setNotice(null);
      const r = await postJson(`${BASE}/all-ok`, { soNumber: g.soNumber, orderIds: g.orderIds });
      setBusy(false);
      if (!r.ok) return fail(String(r.data.error ?? "All OK was not saved."));
      setJustDone({
        decisionId: Number(r.data.decisionId),
        kind: "all_ok",
        soNumber: g.soNumber,
        customer: customerOf(g.customerName),
        correctPick: "",
      });
      await load();
    },
    [fail, load],
  );

  const decideDelete = useCallback(
    async (g: PickDeleteGroup, b: PickDeleteBill) => {
      setBusy(true);
      setNotice(null);
      const r = await postJson(`${BASE}/delete`, { orderId: b.orderId });
      setBusy(false);
      if (!r.ok) return fail(String(r.data.error ?? "The bill was not pick deleted."));
      const kept = Array.isArray(r.data.keptObdNumbers) ? (r.data.keptObdNumbers as string[]) : [];
      setJustDone({
        decisionId: Number(r.data.decisionId),
        kind: "pick_delete",
        soNumber: g.soNumber,
        customer: customerOf(g.customerName),
        correctPick: kept.join(", "),
      });
      if (typeof r.data.warning === "string") setNotice(r.data.warning);
      await load();
    },
    [fail, load],
  );

  const undo = useCallback(
    async (decisionId: number, soNumber: string | null) => {
      setBusy(true);
      setNotice(null);
      const r = await postJson(`${BASE}/undo`, { decisionId });
      setBusy(false);
      setJustDone(null);
      if (!r.ok) return fail(String(r.data.error ?? "Undo did not go through."));
      if (soNumber !== null) setFocusSo(soNumber);
      await load();
    },
    [fail, load],
  );

  // Tell the host what it needs to stay open or close — after each load, and
  // whenever a write or the confirmation panel starts or ends. Ref-latched so an
  // inline callback does not re-fire this every render.
  const onStateRef = useRef(onState);
  useEffect(() => {
    onStateRef.current = onState;
  }, [onState]);
  const held = busy || justDone !== null;
  useEffect(() => {
    if (data === null) return;
    onStateRef.current?.({ groups: groups.length, held });
  }, [data, groups.length, held]);

  const group = groups[cur] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-ink-25">
      <div className="flex flex-col gap-2.5 px-4 py-3">
        {/* ── Needs your decision ── */}
        <div className="flex flex-wrap items-center gap-2 px-0.5 pt-1">
          <span className="text-[13px] font-semibold text-ink-900">Needs your decision</span>
          {groups.length > 0 && (
            <span className="text-[12px] text-ink-500">
              {groups.length} group{groups.length === 1 ? "" : "s"}
            </span>
          )}
          {justDone === null && groups.length > 1 && (
            <div className="ml-auto flex items-center gap-2 text-[12px] text-ink-500">
              <button
                type="button"
                className={BTN_SECONDARY}
                disabled={cur === 0}
                onClick={() => setCur((c) => Math.max(0, c - 1))}
                aria-label="Previous group"
              >
                ‹ Prev
              </button>
              <span>
                Group <b className="text-ink-900">{cur + 1}</b> of <b className="text-ink-900">{groups.length}</b>
              </span>
              <button
                type="button"
                className={BTN_SECONDARY}
                disabled={cur >= groups.length - 1}
                onClick={() => setCur((c) => Math.min(groups.length - 1, c + 1))}
                aria-label="Next group"
              >
                Next ›
              </button>
            </div>
          )}
        </div>

        {notice !== null && (
          <div role="alert" className="rounded-lg border border-danger-bd bg-danger-bg px-3.5 py-2 text-[12px] font-medium text-danger-text">
            {notice}
          </div>
        )}

        {loadError !== null ? (
          <div className="rounded-lg border border-ink-100 bg-white px-4 py-5 text-center text-[12px] text-ink-500">
            {loadError}
          </div>
        ) : data === null ? (
          <div className="rounded-lg border border-ink-100 bg-white px-4 py-5 text-center text-[12px] text-ink-500">
            Loading…
          </div>
        ) : justDone !== null ? (
          <DonePanel
            done={justDone}
            hasNext={groups.length > 0}
            canEdit={canEdit}
            busy={busy}
            onUndo={() => void undo(justDone.decisionId, justDone.soNumber)}
            onNext={() => setJustDone(null)}
          />
        ) : group === null ? (
          <div className="rounded-lg border border-ink-100 bg-white px-4 py-5 text-center text-[12px] text-ink-500">
            Nothing to decide.
          </div>
        ) : (
          <GroupCard
            key={group.soNumber}
            group={group}
            canEdit={canEdit}
            busy={busy}
            onAllOk={() => void decideAllOk(group)}
            onDelete={(b) => void decideDelete(group, b)}
          />
        )}
      </div>
    </div>
  );
}

// ── The confirmation panel ──────────────────────────────────────────────────

function DonePanel({
  done,
  hasNext,
  canEdit,
  busy,
  onUndo,
  onNext,
}: {
  done: JustDone;
  hasNext: boolean;
  canEdit: boolean;
  busy: boolean;
  onUndo: () => void;
  onNext: () => void;
}) {
  const del = done.kind === "pick_delete";
  // The countdown bar shrinks over PANEL_MS; with reduced motion it stays full
  // (motion-safe:) — the timer itself still runs.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setStarted(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  return (
    <div
      role="status"
      className={`flex flex-col items-center gap-2.5 rounded-[10px] border border-l-[3px] bg-white px-5 py-7 text-center ${
        del ? "border-danger-bd border-l-danger" : "border-ok/30 border-l-ok"
      }`}
    >
      <div
        className={`grid h-11 w-11 place-items-center rounded-full text-[22px] font-bold ${
          del ? "bg-danger-bg text-danger-text" : "bg-ok-bg text-ok-text"
        }`}
        aria-hidden
      >
        {del ? "✕" : "✓"}
      </div>
      <h4 className="m-0 text-[16px] font-semibold text-ink-900">{del ? "Pick deleted" : "All OK"}</h4>
      <p className="m-0 max-w-[46ch] text-[13px] text-ink-500">
        {done.customer}
        {del && done.correctPick !== "" && (
          <>
            {" · Correct pick "}
            <b className="font-mono text-ink-900">{done.correctPick}</b>
          </>
        )}
      </p>
      <div className="h-[3px] w-40 overflow-hidden rounded-sm bg-ink-100">
        <div
          className={`h-full w-full bg-ink-500 transition-[width] duration-[6000ms] ease-linear ${
            started ? "motion-safe:w-0" : ""
          }`}
        />
      </div>
      <div className="mt-1.5 flex flex-wrap justify-center gap-2">
        {canEdit && (
          <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={onUndo}>
            Undo
          </button>
        )}
        {hasNext && (
          <button type="button" className={BTN_BRAND} onClick={onNext}>
            Next group ›
          </button>
        )}
      </div>
    </div>
  );
}

// ── One group ───────────────────────────────────────────────────────────────

/** One row of a bill's lines table, after the first-punch comparison. */
interface CmpRow {
  key: string;
  sku: string;
  name: string;
  qty: number;
  /** null = unmarked (the baseline card, or a line identical to the first bill). */
  change: { kind: "added" } | { kind: "removed" } | { kind: "qty"; was: number } | null;
}

function describe(l: PickDeleteLine): string {
  return `${l.name ?? "—"}${l.pack ? ` · ${l.pack}` : ""}`;
}

/**
 * Compare one bill with the FIRST-PUNCH bill, SKU by SKU. Both line sets are
 * already merged per SKU on the server (one line per SKU), so a Map keyed on the
 * SKU is exact. `base === null` → this IS the baseline: every row unmarked.
 */
function compareWithFirst(
  mine: PickDeleteLine[],
  base: PickDeleteLine[] | null,
): { rows: CmpRow[]; added: number; removed: number; changed: number } {
  if (base === null) {
    return {
      rows: mine.map((l) => ({ key: `l${l.id}`, sku: l.sku, name: describe(l), qty: l.unitQty, change: null })),
      added: 0,
      removed: 0,
      changed: 0,
    };
  }
  const baseBySku = new Map(base.map((l) => [skuKey(l), l]));
  const mineSkus = new Set(mine.map(skuKey));
  let added = 0;
  let removed = 0;
  let changed = 0;
  const rows: CmpRow[] = mine.map((l) => {
    const o = baseBySku.get(skuKey(l));
    let change: CmpRow["change"] = null;
    if (!o) {
      added++;
      change = { kind: "added" };
    } else if (o.unitQty !== l.unitQty) {
      changed++;
      change = { kind: "qty", was: o.unitQty };
    }
    return { key: `l${l.id}`, sku: l.sku, name: describe(l), qty: l.unitQty, change };
  });
  for (const o of base) {
    if (mineSkus.has(skuKey(o))) continue;
    removed++;
    rows.push({ key: `r${o.id}`, sku: o.sku, name: describe(o), qty: o.unitQty, change: { kind: "removed" } });
  }
  return { rows, added, removed, changed };
}

function GroupCard({
  group,
  canEdit,
  busy,
  onAllOk,
  onDelete,
}: {
  group: PickDeleteGroup;
  canEdit: boolean;
  busy: boolean;
  onAllOk: () => void;
  onDelete: (b: PickDeleteBill) => void;
}) {
  // Earliest punch first, on the TIMESTAMP; ties by order id so the order is stable.
  const bills = useMemo(
    () => [...group.bills].sort((a, b) => punchMs(a) - punchMs(b) || a.orderId - b.orderId),
    [group.bills],
  );

  // Lines ship WITH the list (one batched read, 2026-09-27) — no per-bill fetch,
  // no loading line. GET bill/[orderId] still exists but this tab no longer calls it.
  const baseLines = bills[0]?.lines ?? [];
  const many = group.bills.length > 2;

  return (
    <div className="overflow-hidden rounded-[10px] border border-ink-100 bg-white">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-3 p-4">
        {bills.map((b, i) => (
          <BillCard
            key={b.orderId}
            bill={b}
            customer={customerOf(group.customerName)}
            soNumber={group.soNumber}
            isFirst={i === 0}
            base={i === 0 ? null : baseLines}
            canEdit={canEdit}
            busy={busy}
            onDelete={() => onDelete(b)}
          />
        ))}
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3 border-t border-ink-50 px-4 py-3.5">
          <span className="text-[13px] font-semibold text-ink-900">
            {many ? "All bills genuine?" : "Both bills genuine?"}
          </span>
          <button type="button" className={BTN_BRAND} disabled={busy} onClick={onAllOk}>
            All OK, keep all bills
          </button>
          <span className="text-[12px] text-ink-500">or pick delete the wrong one above</span>
        </div>
      )}
    </div>
  );
}

function KV({ label, children, title, mono }: { label: string; children: ReactNode; title?: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.05em] text-ink-500">{label}</dt>
      <dd
        className={`m-0 mt-px overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium text-ink-900 ${
          mono ? "font-mono" : ""
        }`}
        title={title}
      >
        {children}
      </dd>
    </div>
  );
}

function BillCard({
  bill,
  customer,
  soNumber,
  isFirst,
  base,
  canEdit,
  busy,
  onDelete,
}: {
  bill: PickDeleteBill;
  customer: string;
  soNumber: string;
  isFirst: boolean;
  /** The first-punch bill's lines; null on the first card itself. */
  base: PickDeleteLine[] | null;
  canEdit: boolean;
  busy: boolean;
  onDelete: () => void;
}) {
  const cmp = useMemo(() => compareWithFirst(bill.lines, isFirst ? null : base), [bill.lines, base, isFirst]);

  let note = "";
  if (isFirst) note = "First punch";
  else {
    const parts: string[] = [];
    if (cmp.added) parts.push(`${cmp.added} added`);
    if (cmp.removed) parts.push(`${cmp.removed} removed`);
    if (cmp.changed) parts.push(`${cmp.changed} qty changed`);
    if (parts.length) note = `Compared with first bill: ${parts.join(" · ")}`;
  }

  return (
    <section aria-label={`Bill ${bill.obdNumber}`} className="flex flex-col overflow-hidden rounded-lg border border-ink-100 bg-white">
      <header className="border-b border-ink-100 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-semibold text-ink-900" title={customer}>
            {customer}
          </span>
          <span className={`${PILL} shrink-0 bg-ink-50 text-ink-700`}>{statusOf(bill)}</span>
        </div>
        <dl className="m-0 mt-2.5 grid grid-cols-3 gap-x-4 gap-y-2.5">
          <KV label="Punched">{fmtDayTime(bill.punchedAt)}</KV>
          <KV label="SO number" mono>{soNumber}</KV>
          <KV label="OBD" mono>{bill.obdNumber}</KV>
          <KV label="Volume">{fmtLitres(bill.volume)}</KV>
          <KV label="Lines">{bill.lineCount}</KV>
          <KV label="Article" title={bill.articleTag ?? undefined}>
            {bill.articleTag ?? "—"}
          </KV>
        </dl>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <th className={LTH}>SKU</th>
              <th className={LTH}>Description</th>
              <th className={`${LTH} text-right`}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {cmp.rows.map((r) => {
              const gone = r.change?.kind === "removed";
              return (
                <tr key={r.key} className={gone ? "text-ink-400" : "text-ink-900"}>
                  <td className={`${LTD} font-mono`}>{gone ? <s>{r.sku}</s> : r.sku}</td>
                  <td className={`${LTD} ${gone ? "" : "text-ink-700"}`}>
                    {gone ? <s>{r.name}</s> : r.name}
                    {r.change?.kind === "added" && <span className={`${TAG} border-ok/30 text-ok-text`}>Added</span>}
                    {r.change?.kind === "removed" && (
                      <span className={`${TAG} border-danger-bd text-danger-text`}>Removed</span>
                    )}
                    {r.change?.kind === "qty" && (
                      <span className={`${TAG} border-warn/30 text-warn-text`}>Qty was {r.change.was}</span>
                    )}
                  </td>
                  <td className={`${LTD} text-right font-mono`}>{gone ? <s>{r.qty}</s> : r.qty}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-3 py-2.5">
        <span className="text-[12px] text-ink-500">{note}</span>
        {canEdit &&
          (bill.canDelete ? (
            <button type="button" className={BTN_DANGER} disabled={busy} onClick={onDelete}>
              Pick delete this bill
            </button>
          ) : (
            <span className="flex items-center gap-2">
              <span className="text-[11.5px] text-ink-500" title={bill.refusal ?? undefined}>
                {bill.reason}
              </span>
              <button type="button" className={BTN_REFUSED} disabled title={bill.refusal ?? undefined}>
                Pick delete this bill
              </button>
            </span>
          ))}
      </footer>
    </section>
  );
}
