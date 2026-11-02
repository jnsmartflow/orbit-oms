"use client";

// components/stock-audit/audit-page.tsx — /stock-audit, the desk screen.
//
// Follows docs/mockups/stock-audit/stock-audit-desktop.html in its NO-BOOK
// state (SA-0011). 🔴 PHASE 1 HAS NO BOOK STOCK: no upload strip, no "Replace
// file", no Book / Variance columns, no Variance / Not counted / Not in book
// chips. Do not add them here — book stock is phase 2, in its own table.
//
//   header: <UniversalHeader /> (CORE §3 — this screen is NOT a named
//           exception like /floor or /freight-trips). Its Row-1 search IS the
//           SKU summary search; Row-2 right carries "New audit".
//   rail:   every audit, open first then newest (the API's order).
//   main:   audit header + Counters / Close · four stat cards · SKU summary |
//           Ledger | Progress.
//
// Permissions are read ONCE on the server (app/(stock-audit)/stock-audit/
// page.tsx) and passed in: canEdit draws New audit / Counters / Close,
// canExport draws Export XLS. They only decide what is DRAWN — every
// /api/stock-audit route re-checks.
//
// LIVE: the stock_audit_* tables carry no live_changes trigger (CORE §13), so
// the selected audit's marker is polled every 15 s (usePickingMarker with its
// own url — the Freight Trips pattern), paused while any dialog is open. A
// change refetches the audit, the open ledger and the rail.
//
// Violet budget (UI §59.9 on the desk too): "New audit" is the one primary
// fill in view. Counters / Close / Export are neutral outline buttons; the
// rail selection is slate.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Lock, Plus, Users } from "lucide-react";
import { UniversalHeader } from "@/components/universal-header";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePickingMarker } from "@/lib/hooks/use-picking-marker";
import { cn } from "@/lib/utils";
import type { AuditDetail, AuditListItem, SkuLedger } from "@/lib/stock-audit/types";
import {
  closeAudit,
  createAudit,
  deskError,
  exportUrl,
  fetchAuditDetail,
  fetchAudits,
  fetchLedger,
  fmtDateTime,
  saveCounters,
} from "./audit-api";
import { LedgerTable, NotInCatalogTag, ProgressTable, SkuSummaryTable } from "./audit-tables";
import { fmtPcs, type CountError } from "./count-api";
import { CountersDialog } from "./counters-dialog";

const POLL_MS = 15_000;

type Tab = "summary" | "ledger" | "progress";
type DialogKind = null | "new" | "counters" | "close";

const TABS: { key: Tab; label: string }[] = [
  { key: "summary", label: "SKU summary" },
  { key: "ledger", label: "Ledger" },
  { key: "progress", label: "Progress" },
];

const OUTLINE_BTN =
  "inline-flex h-9 items-center gap-1.5 rounded-md border border-ink-100 bg-white px-3.5 text-[13px] text-ink-700 hover:bg-ink-50";

export function StockAuditPage({ canEdit, canExport }: { canEdit: boolean; canExport: boolean }): React.JSX.Element {
  const [audits, setAudits] = useState<AuditListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [q, setQ] = useState("");
  const [ledgerMaterial, setLedgerMaterial] = useState<string | null>(null);
  const [ledgerInput, setLedgerInput] = useState("");
  const [ledger, setLedger] = useState<SkuLedger | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  // ── Loads ──────────────────────────────────────────────────────────────────
  const loadAudits = useCallback(async (): Promise<AuditListItem[] | null> => {
    const r = await fetchAudits();
    if (!r.ok) {
      toast.error(deskError(r.error));
      return null;
    }
    setAudits(r.data.audits);
    return r.data.audits;
  }, []);

  const loadDetail = useCallback(async (id: number): Promise<void> => {
    const r = await fetchAuditDetail(id);
    if (r.ok) {
      setDetail(r.data);
      setDetailError(null);
    } else {
      setDetailError(deskError(r.error));
    }
  }, []);

  const loadLedger = useCallback(async (id: number, material: string): Promise<void> => {
    const r = await fetchLedger(id, material);
    if (r.ok) {
      setLedger(r.data);
      setLedgerError(null);
    } else {
      setLedger(null);
      setLedgerError(r.error.code === "INVALID" ? "Type a SKU code" : deskError(r.error));
    }
  }, []);

  useEffect(() => {
    void loadAudits();
  }, [loadAudits]);

  // First item selected by default; re-select if the selected one vanished.
  useEffect(() => {
    if (!audits || audits.length === 0) return;
    if (selectedId === null || !audits.some((a) => a.id === selectedId)) setSelectedId(audits[0].id);
  }, [audits, selectedId]);

  useEffect(() => {
    if (selectedId === null) return;
    setDetail(null);
    setDetailError(null);
    setLedger(null);
    setLedgerMaterial(null);
    setLedgerInput("");
    setTab("summary");
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // Ledger: the chosen SKU, else the first in the summary (the mockup's default).
  const ledgerTarget = ledgerMaterial ?? detail?.skus[0]?.material ?? null;
  useEffect(() => {
    if (tab !== "ledger" || selectedId === null || ledgerTarget === null) return;
    setLedgerInput(ledgerTarget);
    void loadLedger(selectedId, ledgerTarget);
  }, [tab, selectedId, ledgerTarget, loadLedger]);

  const refreshAll = useCallback(async (): Promise<void> => {
    if (selectedId === null) return;
    await loadDetail(selectedId);
    if (tab === "ledger" && ledgerTarget !== null) await loadLedger(selectedId, ledgerTarget);
    await loadAudits();
  }, [selectedId, tab, ledgerTarget, loadDetail, loadLedger, loadAudits]);

  // ── Actions ────────────────────────────────────────────────────────────────
  async function onCreate(counterIds: number[]): Promise<CountError | null> {
    const r = await createAudit(counterIds);
    if (!r.ok) return r.error;
    setDialog(null);
    toast.success(`${r.data.audit.auditNumber} created`);
    await loadAudits();
    setSelectedId(r.data.audit.id);
    return null;
  }

  async function onSaveCounters(counterIds: number[]): Promise<CountError | null> {
    if (selectedId === null) return null;
    const r = await saveCounters(selectedId, counterIds);
    if (!r.ok) return r.error;
    setDialog(null);
    toast.success("Counters saved");
    await refreshAll();
    return null;
  }

  async function onClose(): Promise<void> {
    if (selectedId === null) return;
    setClosing(true);
    setCloseError(null);
    const r = await closeAudit(selectedId);
    setClosing(false);
    if (!r.ok && r.error.code !== "AUDIT_CLOSED") {
      setCloseError(deskError(r.error));
      return;
    }
    setDialog(null);
    toast.success(`${detail?.audit.auditNumber ?? "Audit"} closed`);
    await refreshAll();
  }

  function openLedger(material: string): void {
    setLedgerMaterial(material);
    setTab("ledger");
  }

  const audit = detail?.audit ?? null;
  const isOpen = audit?.status === "open";
  const openCount = audits?.filter((a) => a.status === "open").length ?? 0;

  const needle = q.trim().toUpperCase();
  const skuRows = useMemo(() => {
    const rows = detail?.skus ?? [];
    if (needle === "") return rows;
    return rows.filter((r) => r.material.includes(needle) || (r.description ?? "").toUpperCase().includes(needle));
  }, [detail, needle]);

  const currentCounters = useMemo(
    () => (detail?.progress ?? []).filter((p) => p.assigned).map((p) => ({ userId: p.userId, name: p.name })),
    [detail],
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink-50">
      <UniversalHeader
        title="Stock audit"
        stats={[{ label: "open", value: openCount }]}
        searchPlaceholder="Search SKU or description"
        searchValue={q}
        onSearchChange={(v) => {
          setQ(v);
          if (v !== "") setTab("summary");
        }}
        showShortcutsButton={false}
        rightExtra={
          canEdit ? (
            <button
              type="button"
              onClick={() => setDialog("new")}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-brand-600 px-3 text-[12px] font-semibold text-white hover:bg-brand-700"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New audit
            </button>
          ) : undefined
        }
      />

      {/* Rail + main. Below 768px the rail stacks above (not designed for phones). */}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[260px_minmax(0,1fr)] md:grid-rows-1">
        <aside className="max-h-[35vh] overflow-y-auto border-b border-ink-100 bg-white md:max-h-none md:border-b-0 md:border-r">
          {audits === null && <p className="px-4 py-6 text-[13px] text-ink-400">Loading…</p>}
          {audits !== null && audits.length === 0 && (
            <p className="px-4 py-6 text-[13px] text-ink-500">
              No audits yet.{canEdit ? " Start one with New audit." : ""}
            </p>
          )}
          {audits?.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setSelectedId(a.id)}
              aria-current={a.id === selectedId}
              className={cn(
                "block w-full border-b border-l-[3px] border-b-ink-100 px-4 py-3.5 text-left hover:bg-ink-25",
                a.id === selectedId ? "border-l-data-slate bg-ink-25" : "border-l-transparent",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-semibold text-ink-900">{a.auditNumber}</span>
                <StatusPill status={a.status} />
              </div>
              <div className="text-[12px] text-ink-500">{fmtDateTime(a.createdAt)}</div>
              <div className="text-[12px] text-ink-500">
                {a.counters} {a.counters === 1 ? "counter" : "counters"} · {a.lines} {a.lines === 1 ? "line" : "lines"}
              </div>
            </button>
          ))}
        </aside>

        <main className="min-h-0 overflow-y-auto px-6 py-5">
          {selectedId !== null && (
            <AuditMarker
              key={selectedId}
              auditId={selectedId}
              paused={dialog !== null}
              onChange={() => void refreshAll()}
            />
          )}

          {detailError && <p className="text-[13px] text-danger-text">{detailError}</p>}
          {!detailError && selectedId !== null && !detail && <p className="text-[13px] text-ink-400">Loading…</p>}

          {audit && detail && (
            <>
              {/* Audit header */}
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-[20px] font-semibold text-ink-900">
                    {audit.auditNumber}
                    <StatusPill status={audit.status} />
                  </h2>
                  <p className="mt-1 text-[12px] text-ink-500">
                    Started {fmtDateTime(audit.createdAt)} by {audit.createdByName}
                    {audit.closedAt &&
                      ` · Closed ${fmtDateTime(audit.closedAt)}${audit.closedByName ? ` by ${audit.closedByName}` : ""}`}
                  </p>
                </div>
                {canEdit && isOpen && (
                  <div className="flex gap-2">
                    <button type="button" className={OUTLINE_BTN} onClick={() => setDialog("counters")}>
                      <Users className="h-4 w-4" aria-hidden="true" />
                      Counters
                    </button>
                    <button
                      type="button"
                      className={OUTLINE_BTN}
                      onClick={() => {
                        setCloseError(null);
                        setDialog("close");
                      }}
                    >
                      <Lock className="h-4 w-4" aria-hidden="true" />
                      Close audit
                    </button>
                  </div>
                )}
              </div>

              {/* Stat cards */}
              <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="SKUs counted" value={fmtPcs(detail.stats.skus)} />
                <Stat label="Total pieces" value={fmtPcs(detail.stats.pieces)} />
                <Stat label="Lines entered" value={fmtPcs(detail.stats.lines)} />
                <Stat label="Counters active" value={`${detail.stats.countersActive} / ${detail.stats.counters}`} />
              </div>

              {/* Tabs — NAV bucket: ink-900 label + brand-600 underline. */}
              <div className="mb-3.5 flex gap-1 border-b border-ink-100" role="tablist">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.key}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "-mb-px h-10 border-b-2 px-3.5 text-[13px]",
                      tab === t.key ? "border-brand-600 font-semibold text-ink-900" : "border-transparent text-ink-500 hover:text-ink-900",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === "summary" && (
                <>
                  <div className="mb-3 flex items-center justify-between gap-2.5">
                    <p className="text-[12px] text-ink-500">
                      {needle ? `${skuRows.length} of ${detail.skus.length} SKUs match “${q.trim()}”` : "Click a row to open its ledger."}
                    </p>
                    {canExport && (
                      // A plain link: the route answers with Content-Disposition:
                      // attachment, so the browser downloads SA-0001.xlsx itself.
                      <a href={exportUrl(audit.id)} className={OUTLINE_BTN} download>
                        <Download className="h-4 w-4" aria-hidden="true" />
                        Export XLS
                      </a>
                    )}
                  </div>
                  <SkuSummaryTable
                    rows={skuRows}
                    emptyText={detail.skus.length === 0 ? "Nothing counted yet" : "No SKU matches the search"}
                    onOpen={openLedger}
                  />
                </>
              )}

              {tab === "ledger" && (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-2.5">
                    <input
                      type="text"
                      value={ledgerInput}
                      onChange={(e) => setLedgerInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const m = ledgerInput.trim().toUpperCase();
                          if (m !== "") setLedgerMaterial(m);
                        }
                      }}
                      placeholder="Type SKU code, then Enter"
                      className="h-9 w-[240px] rounded-md border border-ink-100 bg-white px-3 font-mono text-[13px] text-ink-900 outline-none focus:border-brand-600"
                    />
                    {ledger && (
                      <span className="text-[12px] text-ink-500">
                        {ledger.inCatalog ? (
                          <>
                            {ledger.description ?? "—"} · {ledger.pack ?? "—"}
                          </>
                        ) : ledger.rows.length > 0 ? (
                          <NotInCatalogTag />
                        ) : null}
                      </span>
                    )}
                  </div>
                  {ledgerError && <p className="mb-2 text-[13px] text-danger-text">{ledgerError}</p>}
                  {ledgerTarget === null && <p className="text-[13px] text-ink-500">Nothing counted yet.</p>}
                  {ledger && <LedgerTable ledger={ledger} />}
                </>
              )}

              {tab === "progress" && <ProgressTable rows={detail.progress} />}
            </>
          )}
        </main>
      </div>

      <CountersDialog
        open={dialog === "new" || dialog === "counters"}
        mode={dialog === "counters" ? "edit" : "new"}
        auditNumber={audit?.auditNumber}
        current={dialog === "counters" ? currentCounters : []}
        onSave={dialog === "counters" ? onSaveCounters : onCreate}
        onClose={() => setDialog(null)}
      />

      <Dialog open={dialog === "close"} onOpenChange={(o) => !o && !closing && setDialog(null)}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-[16px] font-semibold text-ink-900">Close {audit?.auditNumber}?</DialogTitle>
            <DialogDescription className="text-[13px] text-ink-600">
              Counters can no longer add, edit or remove counts. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          {closeError && <p className="text-[13px] text-danger-text">{closeError}</p>}
          <DialogFooter className="gap-2">
            <button type="button" className={OUTLINE_BTN} onClick={() => setDialog(null)} disabled={closing}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onClose()}
              disabled={closing}
              className="inline-flex h-9 items-center rounded-md bg-brand-600 px-4 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {closing ? "Closing…" : "Close audit"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Polls one audit's marker. Mounted only while an audit is selected and keyed
 *  by its id, so a new selection starts a fresh baseline — and the hook can
 *  never fall back to its default /api/picking/marker url. */
function AuditMarker({ auditId, paused, onChange }: { auditId: number; paused: boolean; onChange: () => void }): null {
  usePickingMarker({
    scope: "openPending",
    url: `/api/stock-audit/audits/${auditId}/marker`,
    pollMs: POLL_MS,
    onChange,
    paused,
  });
  return null;
}

function StatusPill({ status }: { status: string }): React.JSX.Element {
  return status === "open" ? (
    <span className="rounded-full bg-ok-bg px-2 py-0.5 text-[11px] font-semibold text-ok-text">Open</span>
  ) : (
    <span className="rounded-full bg-ink-50 px-2 py-0.5 text-[11px] font-semibold text-ink-500">Closed</span>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-[10px] border border-ink-100 bg-white px-3.5 py-3">
      <div className="text-[12px] text-ink-500">{label}</div>
      <div className="mt-0.5 text-[22px] font-semibold tabular-nums text-ink-900">{value}</div>
    </div>
  );
}
