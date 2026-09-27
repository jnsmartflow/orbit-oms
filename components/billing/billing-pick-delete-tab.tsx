"use client";

// Billing v2 — the "Pick delete" tab (2026-09-27).
//
// Two or more live bills share one SO number. Only billing knows whether that is
// a genuine SAP split or a bill punched twice, so billing decides here, ONE
// GROUP AT A TIME, oldest first: All OK (keep every bill) or Pick delete (cancel
// one bill as a duplicate). Design: docs/prompts/drafts/web-update-2026-09-27-
// billing-pick-delete.md · mockup docs/mockups/billing/pick-delete-review.html.
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
// OK, Next group); danger = Pick delete; warn = the group accent and the
// "double punch" hint; ok = the "split" hint and the All OK panel; ink = neutral.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useBillingPickDeleteMarkerPause,
  useBillingPickDeleteMarkerSubscription,
} from "@/components/billing/billing-marker-provider";
import { smartTitleCase } from "@/lib/mail-orders/utils";
import type {
  PickDeleteBill,
  PickDeleteBillLines,
  PickDeleteDecidedRow,
  PickDeleteGroup,
  PickDeleteLine,
  PickDeleteList,
} from "@/lib/billing/pick-delete-types";

const BASE = "/api/billing/pick-delete";
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

function fmtDay(iso: string | null): string {
  return iso ? DAY_FMT.format(new Date(iso)) : "—";
}
function fmtDayTime(iso: string | null): string {
  return iso ? `${DAY_FMT.format(new Date(iso))} · ${TIME_FMT.format(new Date(iso))}` : "—";
}
function fmtLitres(v: number | null): string {
  return v === null ? "—" : `${Number(v.toFixed(1))} L`;
}
function customerOf(name: string | null): string {
  return name ? smartTitleCase(name) : "(Unmatched)";
}
function lineKey(l: PickDeleteLine): string {
  return `${l.sku.trim()}|${l.unitQty}`;
}

// ── Shared class strings ────────────────────────────────────────────────────

const BTN_BRAND =
  "rounded-lg bg-brand-600 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60";
const BTN_SECONDARY =
  "rounded-md border border-ink-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-600 hover:bg-ink-25 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_DANGER =
  "rounded-lg border border-danger-bd bg-white px-3.5 py-1.5 text-[12.5px] font-semibold text-danger-text hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-60";
/** UI §10: a disabled button is grey, never a faded colour; same box as enabled. */
const BTN_REFUSED =
  "cursor-not-allowed rounded-lg border border-ink-100 bg-ink-50 px-3.5 py-1.5 text-[12.5px] font-semibold text-ink-400";
const PILL = "inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold";

// Fixed table standard (CLAUDE_UI §27): 32px header, 36px rows, 10px uppercase
// header, 11px data — in ink tokens.
const TH =
  "h-[32px] border-b border-ink-100 px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-ink-400 whitespace-nowrap overflow-hidden text-ellipsis";
const TD = "h-[36px] border-b border-ink-50 px-3.5 text-[11px] text-ink-600 whitespace-nowrap overflow-hidden text-ellipsis";

// ── The confirmation panel's state ──────────────────────────────────────────

interface JustDone {
  decisionId: number;
  kind: "all_ok" | "pick_delete";
  soNumber: string;
  customer: string;
  correctPick: string;
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
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

// ── The tab ─────────────────────────────────────────────────────────────────

export function BillingPickDeleteTab({ month, canEdit }: { month: string; canEdit: boolean }) {
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
  useBillingPickDeleteMarkerPause("pick-delete-tab", busy || justDone !== null);

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

        {/* ── Decided ── */}
        <div className="mt-3 flex flex-wrap items-center gap-2 px-0.5">
          <span className="text-[13px] font-semibold text-ink-900">Decided</span>
          <span className="text-[12px] text-ink-500">every pick delete and All OK, with Undo</span>
        </div>
        <DecidedTable
          rows={data?.decided ?? []}
          canEdit={canEdit}
          busy={busy}
          onUndo={(row) => void undo(row.id, row.soNumber)}
        />
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
  // Lines, loaded for EVERY bill of the group on the first "Show lines" — the
  // "same in other bill" shading needs the other bills' lines too.
  const [lines, setLines] = useState<Record<number, PickDeleteLine[]> | null>(null);
  const [linesError, setLinesError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const loadingRef = useRef(false);

  const ensureLines = useCallback(async () => {
    if (lines !== null || loadingRef.current) return;
    loadingRef.current = true;
    const out: Record<number, PickDeleteLine[]> = {};
    try {
      for (const b of group.bills) {
        const res = await fetch(`${BASE}/bill/${b.orderId}`, { cache: "no-store" });
        if (!res.ok) throw new Error("load");
        const body = (await res.json()) as PickDeleteBillLines;
        out[b.orderId] = body.lines;
      }
      setLines(out);
      setLinesError(null);
    } catch {
      setLinesError("Could not load the lines.");
    } finally {
      loadingRef.current = false;
    }
  }, [group.bills, lines]);

  const toggle = (orderId: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
    void ensureLines();
  };

  const dup = group.hint === "double_punch";

  return (
    <div className="overflow-hidden rounded-[10px] border border-l-[3px] border-ink-100 border-l-warn bg-white">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-50 bg-ink-25 px-4 py-3">
        <span className="text-[13.5px] font-semibold text-ink-900">{customerOf(group.customerName)}</span>
        <span className="text-[12px] text-ink-500">
          SO <span className="font-mono font-semibold text-ink-900">{group.soNumber}</span> · {group.bills.length} bills ·
          first punch {fmtDay(group.firstPunchAt)}
        </span>
        <span
          className={`${PILL} border ${
            dup ? "border-warn/30 bg-warn-bg text-warn-text" : "border-ok/30 bg-ok-bg text-ok-text"
          }`}
        >
          {dup ? "Lines identical, looks like a double punch" : "Lines differ, looks like a split"}
        </span>
        {canEdit && (
          <button type="button" className={`${BTN_BRAND} ml-auto`} disabled={busy} onClick={onAllOk}>
            All OK, keep all bills
          </button>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3 px-4 py-3">
        {group.bills.map((b) => (
          <BillCard
            key={b.orderId}
            bill={b}
            others={group.bills.filter((o) => o.orderId !== b.orderId).map((o) => o.orderId)}
            lines={lines}
            linesError={linesError}
            open={open.has(b.orderId)}
            onToggle={() => toggle(b.orderId)}
            canEdit={canEdit}
            busy={busy}
            onDelete={() => onDelete(b)}
          />
        ))}
      </div>
    </div>
  );
}

function BillCard({
  bill,
  others,
  lines,
  linesError,
  open,
  onToggle,
  canEdit,
  busy,
  onDelete,
}: {
  bill: PickDeleteBill;
  others: number[];
  lines: Record<number, PickDeleteLine[]> | null;
  linesError: string | null;
  open: boolean;
  onToggle: () => void;
  canEdit: boolean;
  busy: boolean;
  onDelete: () => void;
}) {
  const mine = lines?.[bill.orderId] ?? null;
  const otherKeys = useMemo(() => {
    const s = new Set<string>();
    if (lines) for (const id of others) for (const l of lines[id] ?? []) s.add(lineKey(l));
    return s;
  }, [lines, others]);

  return (
    <div className="flex flex-col overflow-hidden rounded-[10px] border border-ink-100">
      <div className="flex items-center justify-between gap-2 border-b border-ink-50 px-3.5 py-3">
        <span className="font-mono text-[14px] font-medium text-ink-900">{bill.obdNumber}</span>
        <span className={`${PILL} bg-ink-50 text-ink-700`}>{bill.stageLabel}</span>
      </div>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 px-3.5 py-3 text-[12px]">
        <dt className="text-ink-500">Punched</dt>
        <dd className="m-0 text-ink-900">{fmtDayTime(bill.punchedAt)}</dd>
        <dt className="text-ink-500">Volume</dt>
        <dd className="m-0 text-ink-900">{fmtLitres(bill.volume)}</dd>
        <dt className="text-ink-500">Article</dt>
        <dd className="m-0 text-ink-900">{bill.articleTag ?? "—"}</dd>
        <dt className="text-ink-500">Lines</dt>
        <dd className="m-0 text-ink-900">{bill.lineCount}</dd>
      </dl>
      <button
        type="button"
        onClick={onToggle}
        className="px-3.5 pb-2.5 text-left text-[12px] font-semibold text-brand-700 hover:underline"
      >
        {open ? "Hide lines ▴" : "Show lines ▾"}
      </button>
      {open && (
        <div className="mx-3.5 mb-3 overflow-x-auto rounded-md border border-ink-50">
          {linesError !== null ? (
            <div className="px-2 py-2 text-[11px] text-danger-text">{linesError}</div>
          ) : mine === null ? (
            <div className="px-2 py-2 text-[11px] text-ink-500">Loading…</div>
          ) : (
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className="bg-ink-25 px-2 py-1.5 text-left text-[10px] font-medium uppercase text-ink-500">SKU</th>
                  <th className="bg-ink-25 px-2 py-1.5 text-left text-[10px] font-medium uppercase text-ink-500">Description</th>
                  <th className="bg-ink-25 px-2 py-1.5 text-left text-[10px] font-medium uppercase text-ink-500">Qty</th>
                  <th className="bg-ink-25 px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {mine.map((l) => {
                  const same = otherKeys.has(lineKey(l));
                  return (
                    <tr key={l.id} className={same ? "bg-warn-bg" : ""}>
                      <td className="border-t border-ink-50 px-2 py-1.5 font-mono text-ink-900">{l.sku}</td>
                      <td className="border-t border-ink-50 px-2 py-1.5 text-ink-700">
                        {l.name ?? "—"}
                        {l.pack ? ` · ${l.pack}` : ""}
                      </td>
                      <td className="border-t border-ink-50 px-2 py-1.5 font-mono text-ink-900">{l.unitQty}</td>
                      <td className="whitespace-nowrap border-t border-ink-50 px-2 py-1.5 text-[10px] text-warn-text">
                        {same ? "same in other bill" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
      {canEdit && (
        <div className="mt-auto flex items-center justify-end gap-2 border-t border-ink-50 px-3.5 py-2.5">
          {bill.canDelete ? (
            <button type="button" className={BTN_DANGER} disabled={busy} onClick={onDelete}>
              Pick delete this bill
            </button>
          ) : (
            <>
              <span className="text-[11.5px] text-ink-500" title={bill.refusal ?? undefined}>
                {bill.reason}
              </span>
              <button type="button" className={BTN_REFUSED} disabled title={bill.refusal ?? undefined}>
                Pick delete this bill
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Decided ─────────────────────────────────────────────────────────────────

function DecidedTable({
  rows,
  canEdit,
  busy,
  onUndo,
}: {
  rows: PickDeleteDecidedRow[];
  canEdit: boolean;
  busy: boolean;
  onUndo: (row: PickDeleteDecidedRow) => void;
}) {
  // SO · OBD · Customer · Decision · By · When · (Undo). Without canEdit the
  // Undo column is not drawn and Customer takes its width.
  const widths = canEdit ? [13, 20, 25, 13, 11, 10, 8] : [13, 20, 33, 13, 11, 10];
  return (
    <div className="overflow-x-auto rounded-lg border border-ink-100 bg-white">
      <table className="w-full min-w-[640px] border-collapse" style={{ tableLayout: "fixed" }}>
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={{ width: `${w}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className={TH}>SO</th>
            <th className={TH}>OBD</th>
            <th className={TH}>Customer</th>
            <th className={TH}>Decision</th>
            <th className={TH}>By</th>
            <th className={TH}>When</th>
            {canEdit && <th className={TH} />}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={canEdit ? 7 : 6} className="h-[48px] px-3.5 text-center text-[11px] text-ink-500">
                Nothing decided this month.
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const undone = r.undoneAt !== null;
              const pill = undone
                ? `${PILL} bg-ink-50 text-ink-500`
                : r.kind === "pick_delete"
                  ? `${PILL} bg-danger-bg text-danger-text`
                  : `${PILL} bg-ok-bg text-ok-text`;
              const label = undone ? "Undone" : r.kind === "pick_delete" ? "Pick deleted" : "All OK";
              return (
                <tr key={r.id}>
                  <td className={`${TD} font-mono text-ink-900`}>{r.soNumber}</td>
                  <td className={`${TD} font-mono`} title={r.obdNumbers.join(", ")}>
                    {r.obdNumbers.join(", ")}
                  </td>
                  <td className={TD}>{customerOf(r.customerName)}</td>
                  <td className={TD}>
                    <span className={pill}>{label}</span>
                  </td>
                  <td className={TD}>{r.decidedByName ?? "—"}</td>
                  <td className={TD}>{fmtDayTime(r.decidedAt)}</td>
                  {canEdit && (
                    <td className={`${TD} text-right`}>
                      <button type="button" className={BTN_SECONDARY} disabled={undone || busy} onClick={() => onUndo(r)}>
                        Undo
                      </button>
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
