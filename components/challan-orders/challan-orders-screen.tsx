"use client";

// components/challan-orders/challan-orders-screen.tsx
//
// THE SHARED CHALLAN ORDERS SCREEN (Challan orders slice 5, 2026-10-07 — design
// web-update-2026-10-06-challan-orders.md D8 / D8b; mockups
// docs/mockups/challan-orders/billing-challan-orders.html + view-only.html v2).
//
// Built ONCE, mounted three ways — the Billing tab (review-view.tsx), the Floor
// tab (floor-page.tsx) and the Place Order "Challan orders" link
// (place-order-page.tsx). `mount` only changes the chrome; the tabs, rows and
// rules are identical everywhere.
//
// `canEdit` (challan_orders canEdit) draws the Paste SO box, Link and the ✕
// Unlink. Without it they are NOT RENDERED — never disabled (UI §10) — and the
// header carries the "view only — Billing links SOs" chip. The routes re-check
// the tick; if the two disagree, the ROUTE is right.
//
// Live: its own marker poll (/api/challan-orders/marker via usePickingMarker),
// because a Place Order viewer may hold none of the keys the live feed admits
// (plan §6). Every write refetches at once.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePickingMarker } from "@/lib/hooks/use-picking-marker";
import { ChallanAlertStrip } from "@/components/challan-orders/challan-alert-strip";
import { useChallanOrdersAccess } from "@/components/challan-orders/challan-orders-access-provider";
import { DESK_CANCEL_REASON_OPTIONS, deskCancelRequiresNote, type DeskCancelReason } from "@/lib/floor/desk-cancel-reasons";
import {
  ageTone,
  type ChallanBoard,
  type ChallanHistory,
  type ChallanLineMatch,
  type ChallanRow,
  type ChallanStatus,
  type PasteSoResponse,
} from "@/lib/challan-orders/board-types";

type InnerTab = "not_billed" | "waiting" | "billed" | "history";
export type ChallanMount = "billing" | "floor" | "place_order";

const MARKER_URL = "/api/challan-orders/marker";

const HEAD_TH = "h-[31px] border-b border-[#ebebeb] px-3 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const TD = "px-3 py-2 align-top text-[11.5px] text-[#4b5563] border-b border-[#f0f0f0] overflow-hidden text-ellipsis";

function fmtDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}
function fmtDateTime(iso: string): string {
  return new Date(iso)
    .toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
    .replace(",", "");
}
function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
function istDaysAgo(n: number): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000 - n * 86_400_000).toISOString().slice(0, 10);
}
function shortTrip(tripNumber: string): string {
  // L-260928-02 → L-02 (the Floor trip tag's short form).
  const m = /^([A-Z])-\d{6}-(\d+)/.exec(tripNumber);
  return m ? `${m[1]}-${m[2]}` : tripNumber;
}

function AgeChip({ days }: { days: number }) {
  const tone = ageTone(days);
  const cls =
    tone === "red"
      ? "bg-red-50 text-red-700 border-red-200"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-gray-50 text-gray-600 border-gray-200";
  return <span className={`inline-block rounded border px-1.5 py-px font-mono text-[11px] font-semibold ${cls}`}>{days}d</span>;
}

const STATUS_CHIP: Record<ChallanStatus, { label: string; cls: string }> = {
  in_picking: { label: "In picking", cls: "bg-gray-50 text-gray-600 border-gray-200" },
  sent: { label: "Sent", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  waiting: { label: "Waiting", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  billed: { label: "Billed", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelled: { label: "Cancelled", cls: "bg-red-50 text-red-700 border-red-200" },
};

// Slice 7 — the line match (mockup .match.ok / .match.bad, the ok / warn tokens).
const MATCH_OK = "bg-[#ECFDF5] border-[#a7f3d0] text-[#047857]";
const MATCH_BAD = "bg-[#FFFBEB] border-[#fde68a] text-[#B45309]";

function MatchChip({ m }: { m: ChallanLineMatch }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[10.5px] font-semibold ${m.ok ? MATCH_OK : MATCH_BAD}`}>
      {m.ok ? "✅ Match" : `⚠ ${m.differing} line${m.differing === 1 ? "" : "s"} differ${m.differing === 1 ? "s" : ""}`}
    </span>
  );
}

/** Tins cell: the challan's tins, plus SAP's (muted) when they differ — "36 / 34". */
function TinsCell({ r }: { r: ChallanRow }) {
  const m = r.match;
  if (m && m.challanTins !== m.sapTins) {
    return (
      <>
        {m.challanTins} <span className="text-[#9ca3af]">/ {m.sapTins}</span>
      </>
    );
  }
  return <>{r.tins ?? "—"}</>;
}

/** The expanded side-by-side lines (mockup "detail" row). */
function MatchDetail({ r, m }: { r: ChallanRow; m: ChallanLineMatch }) {
  const DTH = "h-[28px] border-b border-[#ebebeb] bg-gray-50 px-3 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
  const DTD = "h-[32px] border-b border-[#f0f0f0] px-3 text-[11px] text-[#4b5563] whitespace-nowrap overflow-hidden text-ellipsis";
  const diffCls = (d: number) => (d === 0 ? "text-gray-300" : "font-bold text-[#B45309]");
  const signed = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0");
  return (
    <div className="pb-3 pl-[46px] pr-[18px] pt-1">
      <div className="py-1.5 text-[10.5px] text-gray-500">
        Challan <b className="font-semibold text-gray-900">{r.orbNumber}</b> vs SAP{" "}
        <b className="font-mono font-semibold text-gray-900">{m.obdNumbers.join(", ")}</b> — matched by material code, tins
        summed over every linked OBD
      </div>
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          {[16, 42, 14, 14, 14].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className={DTH}>Material code</th>
            <th className={DTH}>Product</th>
            <th className={`${DTH} text-right`}>Challan tins</th>
            <th className={`${DTH} text-right`}>SAP tins</th>
            <th className={`${DTH} text-right`}>Diff</th>
          </tr>
        </thead>
        <tbody>
          {m.lines.map((l) => (
            <tr key={l.material} className={l.diff !== 0 ? "bg-[#fffdf5]" : undefined}>
              <td className={`${DTD} font-mono`}>{l.material}</td>
              <td className={DTD}>{l.product || "—"}</td>
              <td className={`${DTD} text-right tabular-nums`}>{l.challanTins}</td>
              <td className={`${DTD} text-right tabular-nums`}>{l.sapTins}</td>
              <td className={`${DTD} text-right tabular-nums ${diffCls(l.diff)}`}>{signed(l.diff)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-gray-50 font-bold text-gray-900">
            <td className={`${DTD} border-t border-gray-200`} />
            <td className={`${DTD} border-t border-gray-200 text-gray-900`}>Total</td>
            <td className={`${DTD} border-t border-gray-200 text-right tabular-nums text-gray-900`}>{m.challanTins}</td>
            <td className={`${DTD} border-t border-gray-200 text-right tabular-nums text-gray-900`}>{m.sapTins}</td>
            <td className={`${DTD} border-t border-gray-200 text-right tabular-nums ${diffCls(m.sapTins - m.challanTins)}`}>
              {signed(m.sapTins - m.challanTins)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Dealer({ r }: { r: ChallanRow }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium text-[#111827]">{r.billToName}</div>
      <div className="truncate text-[10.5px] text-[#9ca3af]">
        <span className="font-mono">{r.billToCode}</span>
        {r.billToArea && <> · {r.billToArea}</>}
      </div>
    </div>
  );
}

function ShipTo({ r }: { r: ChallanRow }) {
  if (!r.shipToName) return <span className="text-[#9ca3af]">Same as billing</span>;
  return (
    <div className="min-w-0">
      <div className="truncate text-[#111827]">{r.shipToName}</div>
      <div className="truncate text-[10.5px] text-[#9ca3af]">
        <span className="font-mono">{r.shipToCode}</span> · another dealer{r.shipToArea && <> · {r.shipToArea}</>}
      </div>
    </div>
  );
}

function SentOn({ r }: { r: ChallanRow }) {
  if (r.tripNumber && r.tripDate) {
    return (
      <div>
        <span className="rounded-[3px] bg-gray-900 px-[5px] py-px font-mono text-[9.5px] font-semibold text-white">
          {shortTrip(r.tripNumber)}
        </span>{" "}
        {fmtDay(r.tripDate)}
        <div className="font-mono text-[10px] text-[#9ca3af]">{r.tripNumber}</div>
      </div>
    );
  }
  return (
    <div>
      <span className="text-[#6b7280]">In picking</span>
      <div className="text-[10px] text-[#9ca3af]">created {fmtDateTime(r.createdAt)}</div>
    </div>
  );
}

/** Per-row result of a paste: an error, a warning that can be overridden ("Link anyway" —
 *  S5-2 mail-order dealer, S6-5 Telephonic tag), or what the late-paste safety net did. */
type RowNotice = {
  kind: "error" | "warning" | "info";
  text: string;
  so: string;
  code?: "DEALER_MISMATCH" | "TELEPHONIC_TAG";
};

export function ChallanOrdersScreen({
  canEdit,
  isAdmin: isAdminProp,
  mount,
  onBack,
}: {
  canEdit: boolean;
  /** lib/rbac.ts isSuperuser — draws "Cancel OBD" on a linked SAP bill (S6-7). The
   *  route re-checks; without it the action is not rendered. */
  isAdmin?: boolean;
  mount: ChallanMount;
  /** Place Order only — "← Back to order" (the cart stays mounted behind). */
  onBack?: () => void;
}) {
  // Floor passes isAdmin as a prop; Billing and Place Order carry it on the access provider.
  const ctxAccess = useChallanOrdersAccess();
  const isAdmin = isAdminProp ?? ctxAccess.isAdmin;
  const [tab, setTab] = useState<InnerTab>("not_billed");
  const [board, setBoard] = useState<ChallanBoard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [soDraft, setSoDraft] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState<Record<number, RowNotice>>({});
  // Overrides already given for a row's pending paste — both can be needed in turn.
  const [confirms, setConfirms] = useState<Record<number, { dealer?: boolean; tele?: boolean }>>({});
  // Admin "Cancel OBD" on a linked SAP bill (S6-7): the open form, by bill id.
  const [cancelFor, setCancelFor] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState<DeskCancelReason>("other");
  const [cancelRemark, setCancelRemark] = useState<string>("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  // Slice 7 — rows whose side-by-side line match is open (Billed + History), by ORB order id.
  const [openMatch, setOpenMatch] = useState<Record<number, boolean>>({});
  const toggleMatch = (orderId: number) => setOpenMatch((o) => ({ ...o, [orderId]: !o[orderId] }));

  // History filters.
  const [from, setFrom] = useState<string>(istDaysAgo(29));
  const [to, setTo] = useState<string>(istToday());
  const [q, setQ] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [history, setHistory] = useState<ChallanHistory | null>(null);

  const loadBoard = useCallback(async () => {
    try {
      const res = await fetch("/api/challan-orders/list", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBoard((await res.json()) as ChallanBoard);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load");
    }
  }, []);

  const loadHistory = useCallback(async () => {
    const qs = new URLSearchParams({ from, to, q, page: String(page) });
    try {
      const res = await fetch(`/api/challan-orders/history?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHistory((await res.json()) as ChallanHistory);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load");
    }
  }, [from, to, q, page]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);
  useEffect(() => {
    if (tab === "history") void loadHistory();
  }, [tab, loadHistory]);

  const reloadAll = useCallback(() => {
    void loadBoard();
    if (tab === "history") void loadHistory();
  }, [loadBoard, loadHistory, tab]);

  // The shared marker poll (plan §6) — 30 s, tab-hidden pause, silent failure.
  usePickingMarker({ scope: "openPending", url: MARKER_URL, pollMs: 30_000, onChange: reloadAll });

  async function paste(r: ChallanRow, override?: "DEALER_MISMATCH" | "TELEPHONIC_TAG") {
    const so = (override ? notice[r.orderId]?.so : soDraft[r.orderId]) ?? "";
    if (!so.trim() || busyId !== null) return;
    const given = { ...(override ? confirms[r.orderId] : {}) };
    if (override === "DEALER_MISMATCH") given.dealer = true;
    if (override === "TELEPHONIC_TAG") given.tele = true;
    setConfirms((c) => ({ ...c, [r.orderId]: given }));
    setBusyId(r.orderId);
    try {
      const res = await fetch("/api/challan-orders/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orbOrderId: r.orderId,
          soNumber: so,
          confirmDealerMismatch: given.dealer === true,
          confirmTelephonic: given.tele === true,
        }),
      });
      const json = (await res.json().catch(() => null)) as PasteSoResponse | null;
      if (json && json.ok) {
        setSoDraft((d) => ({ ...d, [r.orderId]: "" }));
        setConfirms((c) => ({ ...c, [r.orderId]: {} }));
        // The late-paste safety net (slice 6): say what it did. A touched OBD also
        // stays on the red alert strip above until a person acts.
        const rec = json.reconcile;
        const parts: string[] = [];
        if (rec?.caught.length) parts.push(`Pulled back OBD ${rec.caught.join(", ")} into this challan.`);
        if (rec?.held.length) parts.push(`OBD ${rec.held.join(", ")} is billed to a different dealer — held, not linked.`);
        for (const t of rec?.touched ?? []) parts.push(`DOUBLE DISPATCH RISK — OBD ${t.obdNumber}: ${t.reason}.`);
        if (rec?.failed.length) parts.push(`OBD ${rec.failed.map((f) => f.obdNumber).join(", ")} could not be linked — Retry from the red alert.`);
        setNotice((n) => {
          const next = { ...n };
          if (parts.length === 0) delete next[r.orderId];
          else
            next[r.orderId] = {
              kind: rec && (rec.touched.length || rec.failed.length || rec.held.length) ? "error" : "info",
              text: `Linked SO ${so}. ${parts.join(" ")}`,
              so,
            };
          return next;
        });
        reloadAll();
      } else if (json && json.warning) {
        setNotice((n) => ({ ...n, [r.orderId]: { kind: "warning", text: json.error, so, code: json.code } }));
      } else {
        setNotice((n) => ({
          ...n,
          [r.orderId]: { kind: "error", text: json?.error ?? `Could not link (HTTP ${res.status}).`, so },
        }));
      }
    } catch {
      setNotice((n) => ({ ...n, [r.orderId]: { kind: "error", text: "Could not reach the server — nothing was linked.", so } }));
    } finally {
      setBusyId(null);
    }
  }

  async function unlink(linkId: number, orderId: number) {
    if (busyId !== null) return;
    setBusyId(orderId);
    try {
      const res = await fetch(`/api/challan-orders/links/${linkId}/unlink`, { method: "POST" });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setNotice((n) => ({ ...n, [orderId]: { kind: "error", text: json?.error ?? `Could not unlink (HTTP ${res.status}).`, so: "" } }));
      }
      reloadAll();
    } catch {
      setNotice((n) => ({ ...n, [orderId]: { kind: "error", text: "Could not reach the server — nothing changed.", so: "" } }));
    } finally {
      setBusyId(null);
    }
  }

  // Render functions, NOT components: defined inside the screen, a component
  // would remount on every keystroke and the SO box would lose focus.
  function pasteBox(r: ChallanRow, placeholder = "SO number") {
    return (
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          inputMode="numeric"
          value={soDraft[r.orderId] ?? ""}
          onChange={(e) => setSoDraft((d) => ({ ...d, [r.orderId]: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === "Enter") void paste(r);
          }}
          placeholder={placeholder}
          maxLength={14}
          className="h-7 w-[110px] rounded-md border border-gray-200 px-2 font-mono text-[11.5px] text-gray-900 placeholder:font-sans placeholder:text-gray-400 focus:border-brand-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void paste(r)}
          disabled={busyId !== null || !(soDraft[r.orderId] ?? "").trim()}
          className={`h-7 rounded-md px-2.5 text-[11.5px] font-medium ${
            busyId !== null || !(soDraft[r.orderId] ?? "").trim()
              ? "border border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
              : "border border-gray-900 bg-gray-900 text-white hover:bg-gray-800"
          }`}
        >
          Link
        </button>
      </div>
    );
  }

  function noticeRow(r: ChallanRow, colSpan: number) {
    const n = notice[r.orderId];
    if (!n) return null;
    const dismiss = () =>
      setNotice((all) => {
        const next = { ...all };
        delete next[r.orderId];
        return next;
      });
    return (
      <tr>
        <td colSpan={colSpan} className="border-b border-[#f0f0f0] px-3 pb-2">
          <div
            role="alert"
            className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-[11.5px] ${
              n.kind === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : n.kind === "info"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            <span className="flex-1">{n.text}</span>
            {n.kind === "warning" && canEdit && (
              <button
                type="button"
                onClick={() => void paste(r, n.code)}
                disabled={busyId !== null}
                className="h-6 rounded-md border border-amber-300 bg-white px-2 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
              >
                Link anyway
              </button>
            )}
            <button type="button" onClick={dismiss} aria-label="Dismiss" className="text-[14px] leading-none opacity-60 hover:opacity-100">
              ×
            </button>
          </div>
        </td>
      </tr>
    );
  }

  async function cancelObd(orderId: number) {
    if (busyId !== null) return;
    setBusyId(orderId);
    setCancelError(null);
    try {
      const res = await fetch(`/api/challan-orders/linked-obds/${orderId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasonKey: cancelReason, remark: cancelRemark }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setCancelError(json?.error ?? `Could not cancel (HTTP ${res.status}).`);
        return;
      }
      setCancelFor(null);
      setCancelRemark("");
      reloadAll();
    } catch {
      setCancelError("Could not reach the server — nothing changed.");
    } finally {
      setBusyId(null);
    }
  }

  /** The SAP bills billed against a challan (slice 6) — with admin "Cancel OBD" (S6-7). */
  function linkedObdsCell(r: ChallanRow) {
    if (r.linkedObds.length === 0) return <span className="text-[#9ca3af]">—</span>;
    return r.linkedObds.map((b) => {
      const live = b.workflowStage === "challan_linked";
      return (
        <div key={b.orderId} className="py-px">
          <div className="flex items-center gap-1.5">
            <span className={`font-mono ${live ? "text-[#111827]" : "text-[#9ca3af] line-through"}`}>{b.obdNumber}</span>
            {!live && <span className="text-[10.5px] text-[#9ca3af]">cancelled</span>}
            {live && isAdmin && cancelFor !== b.orderId && (
              <button
                type="button"
                onClick={() => { setCancelFor(b.orderId); setCancelError(null); }}
                className="text-[10.5px] font-medium text-red-600 hover:underline"
              >
                Cancel OBD
              </button>
            )}
          </div>
          {live && isAdmin && cancelFor === b.orderId && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <select
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value as DeskCancelReason)}
                className="h-6 rounded border border-gray-200 px-1 text-[11px]"
              >
                {DESK_CANCEL_REASON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input
                type="text"
                value={cancelRemark}
                onChange={(e) => setCancelRemark(e.target.value)}
                placeholder={deskCancelRequiresNote(cancelReason) ? "remark (required)" : "remark"}
                className="h-6 w-[120px] rounded border border-gray-200 px-1.5 text-[11px]"
              />
              <button
                type="button"
                onClick={() => void cancelObd(b.orderId)}
                disabled={busyId !== null || (deskCancelRequiresNote(cancelReason) && !cancelRemark.trim())}
                className="h-6 rounded bg-red-600 px-2 text-[11px] font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
              >
                Cancel OBD
              </button>
              <button type="button" onClick={() => setCancelFor(null)} className="text-[11px] text-gray-500 hover:underline">
                Keep
              </button>
              {cancelError && <span className="w-full text-[11px] text-red-700">{cancelError}</span>}
            </div>
          )}
        </div>
      );
    });
  }

  const counts = board?.counts ?? { notBilled: 0, waiting: 0, billed: 0 };
  const seg = useMemo(
    () =>
      [
        { key: "not_billed" as const, label: "Not billed", count: board ? counts.notBilled : null },
        { key: "waiting" as const, label: "Waiting for OBD", count: board ? counts.waiting : null },
        { key: "billed" as const, label: "Billed", count: board ? counts.billed : null },
        { key: "history" as const, label: "History", count: null },
      ],
    [board, counts.notBilled, counts.waiting, counts.billed],
  );

  // ── Tables ────────────────────────────────────────────────────────────────
  function notBilledTable() {
    const rows = board?.notBilled ?? [];
    const widths = canEdit ? [14, 21, 19, 6, 16, 6, 18] : [16, 25, 23, 7, 20, 9];
    const cols = widths.length;
    return (
      <table className="w-full table-fixed border-collapse">
        <colgroup>{widths.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
        <thead>
          <tr>
            <th className={HEAD_TH}>ORB no.</th>
            <th className={HEAD_TH}>Dealer</th>
            <th className={HEAD_TH}>Ship to</th>
            <th className={`${HEAD_TH} text-right`}>Tins</th>
            <th className={HEAD_TH}>Sent on</th>
            <th className={HEAD_TH}>Age</th>
            {canEdit && <th className={HEAD_TH}>Paste SO</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={cols} className="px-3 py-8 text-center text-[12px] text-gray-400">Nothing waiting to be billed.</td></tr>
          ) : (
            rows.map((r) => (
              <FragmentRows key={r.orderId}>
                <tr>
                  <td className={TD}><span className="font-mono font-medium text-[#111827]">{r.orbNumber}</span></td>
                  <td className={TD}><Dealer r={r} /></td>
                  <td className={TD}><ShipTo r={r} /></td>
                  <td className={`${TD} text-right tabular-nums`}>{r.tins ?? "—"}</td>
                  <td className={TD}><SentOn r={r} /></td>
                  <td className={TD}><AgeChip days={r.ageDays} /></td>
                  {canEdit && <td className={TD}>{pasteBox(r)}</td>}
                </tr>
                {noticeRow(r, cols)}
              </FragmentRows>
            ))
          )}
        </tbody>
      </table>
    );
  }

  function waitingTable() {
    const rows = board?.waiting ?? [];
    const widths = canEdit ? [14, 20, 28, 7, 14, 17] : [15, 23, 30, 8, 12, 12];
    const cols = widths.length;
    return (
      <table className="w-full table-fixed border-collapse">
        <colgroup>{widths.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
        <thead>
          <tr>
            <th className={HEAD_TH}>ORB no.</th>
            <th className={HEAD_TH}>Dealer</th>
            <th className={HEAD_TH}>SO no(s).</th>
            <th className={`${HEAD_TH} text-right`}>Tins</th>
            <th className={HEAD_TH}>Linked by</th>
            <th className={HEAD_TH}>{canEdit ? "Linked at · add SO" : "Linked at"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={cols} className="px-3 py-8 text-center text-[12px] text-gray-400">No SO is waiting for its OBD.</td></tr>
          ) : (
            rows.map((r) => {
              const linked = r.links.filter((l) => l.status === "linked").length;
              return (
                <FragmentRows key={r.orderId}>
                  <tr>
                    <td className={TD}><span className="font-mono font-medium text-[#111827]">{r.orbNumber}</span></td>
                    <td className={TD}>
                      <Dealer r={r} />
                      {linked > 0 && (
                        <div className="text-[10.5px] text-amber-700">part-billed — {linked} of {r.links.length} OBDs in</div>
                      )}
                      {r.linkedObds.length > 0 && <div className="mt-1 text-[11px]">{linkedObdsCell(r)}</div>}
                    </td>
                    <td className={TD}>
                      {r.links.map((l) => (
                        <div key={l.id} className="flex items-center gap-1.5">
                          <span className="font-mono text-[#111827]">{l.soNumber}</span>
                          {l.status === "linked" ? (
                            <span className="text-[10.5px] text-emerald-700">· OBD {l.obdNumber} ✓</span>
                          ) : (
                            <span className="text-[10.5px] text-amber-700">· waiting</span>
                          )}
                          {canEdit && l.status === "waiting" && (
                            <button
                              type="button"
                              title="Unlink this SO"
                              aria-label={`Unlink SO ${l.soNumber}`}
                              onClick={() => void unlink(l.id, r.orderId)}
                              disabled={busyId !== null}
                              className="text-[13px] leading-none text-gray-300 hover:text-red-500"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{r.tins ?? "—"}</td>
                    <td className={TD}>
                      {Array.from(new Set(r.links.map((l) => l.linkedByName ?? "—"))).join(", ")}
                    </td>
                    <td className={TD}>
                      {r.links.map((l) => (
                        <div key={l.id}>{fmtDateTime(l.linkedAt)}</div>
                      ))}
                      {canEdit && (
                        <div className="mt-1">
                          {pasteBox(r, "another SO")}
                        </div>
                      )}
                    </td>
                  </tr>
                  {noticeRow(r, cols)}
                </FragmentRows>
              );
            })
          )}
        </tbody>
      </table>
    );
  }

  function billedTable() {
    const rows = board?.billed ?? [];
    const widths = [13, 19, 13, 15, 13, 9, 14, 4];
    return (
      <table className="w-full table-fixed border-collapse">
        <colgroup>{widths.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
        <thead>
          <tr>
            <th className={HEAD_TH}>ORB no.</th>
            <th className={HEAD_TH}>Dealer</th>
            <th className={HEAD_TH}>SO(s)</th>
            <th className={HEAD_TH}>OBD(s)</th>
            <th className={HEAD_TH}>Invoice no.</th>
            <th className={`${HEAD_TH} text-right`}>Tins</th>
            <th className={HEAD_TH}>Match</th>
            <th className={HEAD_TH} aria-label="Lines" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={widths.length} className="px-3 py-8 text-center text-[12px] text-gray-400">Nothing billed in the last 7 days — older ones are in History.</td></tr>
          ) : (
            rows.map((r) => {
              const m = r.match;
              const open = m !== null && openMatch[r.orderId] === true;
              return (
                <FragmentRows key={r.orderId}>
                  {/* Slice 7: the row opens the side-by-side lines. */}
                  <tr onClick={m ? () => toggleMatch(r.orderId) : undefined} className={m ? "cursor-pointer hover:bg-gray-50" : undefined}>
                    <td className={TD}><span className="font-mono font-medium text-[#111827]">{r.orbNumber}</span></td>
                    <td className={TD}><Dealer r={r} /></td>
                    <td className={`${TD} font-mono`}>{r.links.map((l) => <div key={l.id}>{l.soNumber}</div>)}</td>
                    {/* Every SAP bill billed against this challan (slice 6) — part-billing lists
                        them all; admin can cancel one (S6-7). Its clicks never toggle the row. */}
                    <td className={`${TD} cursor-auto`} onClick={(e) => e.stopPropagation()}>{linkedObdsCell(r)}</td>
                    <td className={`${TD} font-mono`}>
                      {r.linkedObds.filter((b) => b.workflowStage === "challan_linked").map((b) => <div key={b.orderId}>{b.invoiceNo ?? "—"}</div>)}
                    </td>
                    <td className={`${TD} text-right tabular-nums`}><TinsCell r={r} /></td>
                    <td className={TD}>{m ? <MatchChip m={m} /> : <span className="text-[#9ca3af]">—</span>}</td>
                    <td className={`${TD} text-right text-[11px] text-gray-400`}>{m ? (open ? "▾" : "▸") : ""}</td>
                  </tr>
                  {open && m && (
                    <tr>
                      <td colSpan={widths.length} className="border-b border-[#f0f0f0] p-0">
                        <MatchDetail r={r} m={m} />
                      </td>
                    </tr>
                  )}
                </FragmentRows>
              );
            })
          )}
        </tbody>
      </table>
    );
  }

  function historyTable() {
    const rows = history?.rows ?? [];
    const widths = [14, 22, 13, 11, 28, 12];
    const pages = history ? Math.max(1, Math.ceil(history.total / history.pageSize)) : 1;
    return (
      <>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-[#f0f0f0]">
          <label className="text-[11px] text-gray-500">Created</label>
          <input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPage(1); }}
            className="h-7 rounded-md border border-gray-200 px-2 text-[11.5px]" />
          <span className="text-[11px] text-gray-400">to</span>
          <input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(1); }}
            className="h-7 rounded-md border border-gray-200 px-2 text-[11.5px]" />
          <input
            type="text"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search ORB / dealer / SO"
            className="ml-auto h-7 w-[220px] rounded-md border border-gray-200 px-2 text-[11.5px] focus:border-brand-500 focus:outline-none"
          />
        </div>
        <table className="w-full table-fixed border-collapse">
          <colgroup>{widths.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
          <thead>
            <tr>
              <th className={HEAD_TH}>ORB no.</th>
              <th className={HEAD_TH}>Dealer</th>
              <th className={HEAD_TH}>Created</th>
              <th className={HEAD_TH}>Status</th>
              <th className={HEAD_TH}>SO(s)</th>
              <th className={`${HEAD_TH} text-right`}>Tins</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={widths.length} className="px-3 py-8 text-center text-[12px] text-gray-400">No challan orders in this range.</td></tr>
            ) : (
              rows.map((r) => {
                const chip = STATUS_CHIP[r.status];
                // Slice 7: a billed row's chip carries the match and opens the lines.
                const m = r.match;
                const open = m !== null && openMatch[r.orderId] === true;
                return (
                  <FragmentRows key={r.orderId}>
                  <tr onClick={m ? () => toggleMatch(r.orderId) : undefined} className={m ? "cursor-pointer hover:bg-gray-50" : undefined}>
                    <td className={TD}><span className="font-mono font-medium text-[#111827]">{r.orbNumber}</span></td>
                    <td className={TD}><Dealer r={r} /></td>
                    <td className={TD}>{fmtDateTime(r.createdAt)}</td>
                    <td className={TD}>
                      {m ? (
                        <>
                          <span className={`inline-block rounded border px-1.5 py-px text-[10.5px] font-semibold ${m.ok ? MATCH_OK : MATCH_BAD}`}>
                            Billed {m.ok ? "✅" : "⚠"}
                          </span>
                          {!m.ok && (
                            <div className="text-[10px] text-[#9ca3af]">{m.challanTins} / {m.sapTins} tins</div>
                          )}
                        </>
                      ) : (
                        <span className={`inline-block rounded border px-1.5 py-px text-[10.5px] font-semibold ${chip.cls}`}>{chip.label}</span>
                      )}
                    </td>
                    <td className={`${TD} cursor-auto`} onClick={(e) => e.stopPropagation()}>
                      {r.links.length === 0 ? (
                        <span className="text-[#9ca3af]">—</span>
                      ) : (
                        r.links.map((l) => (
                          <div key={l.id} className="flex items-center gap-1.5">
                            <span className={`font-mono ${l.status === "unlinked" ? "text-[#9ca3af] line-through" : "text-[#111827]"}`}>
                              {l.soNumber}
                            </span>
                            <span className="text-[10.5px] text-[#9ca3af]">
                              · {l.status === "linked" ? `OBD ${l.obdNumber}` : l.status}
                            </span>
                            {/* A cancelled challan's SO is unlinked automatically (S5-3); a
                                'waiting' one can still be unlinked by hand here. */}
                            {canEdit && l.status === "waiting" && (
                              <button
                                type="button"
                                aria-label={`Unlink SO ${l.soNumber}`}
                                onClick={() => void unlink(l.id, r.orderId)}
                                disabled={busyId !== null}
                                className="text-[13px] leading-none text-gray-300 hover:text-red-500"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{r.tins ?? "—"}</td>
                  </tr>
                  {open && m && (
                    <tr>
                      <td colSpan={widths.length} className="border-b border-[#f0f0f0] p-0">
                        <MatchDetail r={r} m={m} />
                      </td>
                    </tr>
                  )}
                  </FragmentRows>
                );
              })
            )}
          </tbody>
        </table>
        {history && history.total > history.pageSize && (
          <div className="flex items-center justify-end gap-2 px-3 py-2 text-[11.5px] text-gray-500">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              className="h-7 rounded-md border border-gray-200 px-2 disabled:cursor-not-allowed disabled:text-gray-300">‹ Prev</button>
            <span>Page {page} of {pages} · {history.total} orders</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
              className="h-7 rounded-md border border-gray-200 px-2 disabled:cursor-not-allowed disabled:text-gray-300">Next ›</button>
          </div>
        )}
      </>
    );
  }

  const caption: Record<InnerTab, string> = {
    not_billed: "Goods sent on an Orbit challan, no SAP bill yet · oldest first · amber at 3 days, red at 7",
    waiting: "SO pasted — the OBD file has not been imported yet · stays here until every SO has its OBD",
    billed: "Every SO has its OBD · billed in the last 7 days — older ones are in History",
    history: "Every challan order · status as of now",
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      {mount === "place_order" && (
        <div className="flex items-center gap-2 border-b border-gray-200 px-3.5 py-2">
          <button type="button" onClick={onBack} className="text-[12px] font-medium text-brand-700 hover:underline">
            ← Back to order
          </button>
          <span className="text-[13px] font-semibold text-gray-900">Challan orders</span>
          <span className="text-[11px] text-gray-400">your cart is kept</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-3.5 py-2.5">
        <div className="flex items-center gap-0.5 rounded-[8px] bg-gray-100 p-[3px]">
          {seg.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setTab(s.key)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-[6px] px-[11px] py-1 text-[12px] ${
                tab === s.key ? "bg-white font-medium text-gray-900 shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {s.label}
              {s.count !== null && <span className="font-mono text-[10.5px] text-gray-400">{s.count}</span>}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-[11.5px] text-gray-500">
          {board?.oldestNotBilledDays != null && <span>oldest unbilled {board.oldestNotBilledDays} days</span>}
          {!canEdit && (
            <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-px text-[10.5px] text-gray-500">
              view only — Billing links SOs
            </span>
          )}
        </div>
      </div>
      {/* The red challan alerts (slice 6: S6-1, S6-2, S6-6) — same strip as Floor's. */}
      <ChallanAlertStrip canEdit={canEdit} onChanged={reloadAll} />
      <div className="px-3.5 pt-2 text-[11px] text-gray-400">{caption[tab]}</div>
      {loadError && (
        <div role="alert" className="mx-3.5 mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-[11.5px] text-red-700">
          Could not load challan orders ({loadError}). It will retry on the next refresh.
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "not_billed" && notBilledTable()}
        {tab === "waiting" && waitingTable()}
        {tab === "billed" && billedTable()}
        {tab === "history" && historyTable()}
      </div>
    </div>
  );
}

/** A keyed fragment for a row + its notice row. */
function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
