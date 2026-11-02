"use client";

// components/stock-audit/count-shell.tsx — /stock-count, the counter's phone
// screen. Owns: which audit is open, the Count | Submitted tabs, the
// calculator (new line / edit), and the read-only states.
//
// The CI pattern (components/ci/ci-shell.tsx, CLAUDE_UI §59.4/§59.5):
//   • Phone — the two tabs are handed to RoleLayoutClient as `workflowTabs`,
//     which REPLACE the shared Home/Menu/You bar. Menu + You move to
//     ModuleMobileHeader (grid icon / avatar → useMobileShell()).
//   • The calculator sets `hideBar`, so Submit owns the thumb zone.
//   • ≥768px the shared bar is `md:hidden` and never drawn, so the same two
//     tabs render as a segmented control at the top of a centred 480px column
//     — finding 5 of the phase-1 plan. The sidebar handles navigation there,
//     and the Menu/You sheets (also md:hidden) are not used.
//   • `workflowTabs` is passed ONLY while an audit is open. On the picker /
//     empty state the default Home/Menu/You bar stands (omitting the prop, not
//     `[]` — §59.2's landmine).
//
// Behaviour, wording and flow follow docs/mockups/stock-audit/stock-audit-
// mobile.html (home/openAudit/search/counter/submitted); its CSS is not used.
//
// 🔴 Submitted (n) is the server's number: the lines are RE-READ after every
// save, edit and removal. Never a local +1.
// 🔴 BLIND COUNT: nothing here can show another person's lines, a total
// across counters, or an expected quantity — the API returns none.

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, ClipboardList, ListChecks, Search } from "lucide-react";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import { ModuleMobileHeader } from "@/components/shared/module-mobile-header";
import { useMobileShell } from "@/components/shared/mobile-shell-context";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";
import type { WorkflowTab } from "@/components/shared/workflow-tab-bar";
import type { NavItemConfig } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { COUNT_MODE } from "@/lib/stock-audit/status";
import type { CountLine, MyAudit } from "@/lib/stock-audit/types";
import {
  createLine,
  fetchMyAudits,
  fetchMyLines,
  fmtPcs,
  fmtStarted,
  friendlyError,
  removeLine,
  updateLine,
  type CountError,
  type LineBody,
} from "./count-api";
import { CountCalculator, type CalcValues } from "./count-calculator";
import { CountSearch, type PickedSku } from "./count-search";
import { CountSubmitted } from "./count-submitted";

type TabKey = "count" | "submitted";
const TAB_KEYS: readonly TabKey[] = ["count", "submitted"];
function isTabKey(v: string): v is TabKey {
  return (TAB_KEYS as readonly string[]).includes(v);
}

type CalcState = { kind: "new"; sku: PickedSku } | { kind: "edit"; line: CountLine };

/** Why the open audit is read-only, if it is. */
type Lock = null | "closed" | "removed";

interface ShellProps {
  role: RoleSidebarRole;
  userName: string;
  userInitials: string;
  navItems: NavItemConfig[];
}

export function StockCountShell(props: ShellProps): React.JSX.Element {
  // RoleLayoutClient mounts MobileShellProvider; useMobileShell() must be
  // called BELOW it, so the screen body is its own component.
  const [audit, setAudit] = useState<MyAudit | null>(null);
  const [tab, setTab] = useState<TabKey>("count");
  const [calcOpen, setCalcOpen] = useState(false);
  const [lineCount, setLineCount] = useState<number | undefined>(undefined);

  const workflowTabs: WorkflowTab[] | undefined = audit
    ? [
        { key: "count", label: "Count", icon: Search },
        { key: "submitted", label: "Submitted", icon: ListChecks, count: lineCount },
      ]
    : undefined;

  return (
    <RoleLayoutClient
      role={props.role}
      userName={props.userName}
      userInitials={props.userInitials}
      navItems={props.navItems}
      workflowTabs={workflowTabs}
      activeTabKey={tab}
      onTabChange={(k) => {
        if (isTabKey(k)) setTab(k);
      }}
      hideBar={calcOpen}
    >
      <StockCountScreen
        userInitials={props.userInitials}
        audit={audit}
        setAudit={setAudit}
        tab={tab}
        setTab={setTab}
        setCalcOpen={setCalcOpen}
        setLineCount={setLineCount}
      />
    </RoleLayoutClient>
  );
}

interface ScreenProps {
  userInitials: string;
  audit: MyAudit | null;
  setAudit: (a: MyAudit | null) => void;
  tab: TabKey;
  setTab: (t: TabKey) => void;
  setCalcOpen: (open: boolean) => void;
  setLineCount: (n: number | undefined) => void;
}

function StockCountScreen({
  userInitials,
  audit,
  setAudit,
  tab,
  setTab,
  setCalcOpen,
  setLineCount,
}: ScreenProps): React.JSX.Element {
  const { openMenu, openYou } = useMobileShell();

  const [audits, setAudits] = useState<MyAudit[] | null>(null);
  const [auditsError, setAuditsError] = useState<string | null>(null);
  const firstLoad = useRef(true);

  const [lines, setLines] = useState<CountLine[] | null>(null);
  const [linesError, setLinesError] = useState<string | null>(null);
  const [lock, setLock] = useState<Lock>(null);

  const [calc, setCalc] = useState<CalcState | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => setCalcOpen(calc !== null), [calc, setCalcOpen]);
  useEffect(() => setLineCount(lines === null ? undefined : lines.length), [lines, setLineCount]);

  /** NOT_ASSIGNED / AUDIT_CLOSED turn the screen read-only. True if it was one. */
  const applyLock = useCallback((e: CountError): boolean => {
    if (e.code === "NOT_ASSIGNED") {
      setLock("removed");
      setCalc(null);
      return true;
    }
    if (e.code === "AUDIT_CLOSED") {
      setLock("closed");
      setCalc(null);
      return true;
    }
    return false;
  }, []);

  const loadLines = useCallback(
    async (auditId: number): Promise<void> => {
      const r = await fetchMyLines(auditId);
      if (r.ok) {
        setLines(r.data.lines);
        setLinesError(null);
        if (r.data.audit.status !== "open") setLock("closed");
        return;
      }
      if (!applyLock(r.error)) setLinesError(friendlyError(r.error));
    },
    [applyLock],
  );

  const openAudit = useCallback(
    (a: MyAudit) => {
      setAudit(a);
      setTab("count");
      setCalc(null);
      setFlash(null);
      setSaveError(null);
      setLock(null);
      setLines(null);
      setLinesError(null);
      setResetKey((k) => k + 1);
      void loadLines(a.id);
    },
    [setAudit, setTab, loadLines],
  );

  const loadAudits = useCallback(async (): Promise<void> => {
    const r = await fetchMyAudits();
    if (!r.ok) {
      setAuditsError(friendlyError(r.error));
      return;
    }
    setAuditsError(null);
    setAudits(r.data.audits);
    // Exactly one → straight in, but only on arrival: a person who came BACK
    // to the list is never bounced out of it again.
    if (firstLoad.current && r.data.audits.length === 1) openAudit(r.data.audits[0]);
    firstLoad.current = false;
  }, [openAudit]);

  useEffect(() => {
    void loadAudits();
  }, [loadAudits]);

  function backToList(): void {
    setAudit(null);
    setCalc(null);
    setLines(null);
    setLock(null);
    setFlash(null);
    setAudits(null);
    void loadAudits();
  }

  function changeTab(t: TabKey): void {
    setTab(t);
    setCalc(null);
    setFlash(null);
    setSaveError(null);
  }

  // Tab change from the shared bar (phone) clears the same things.
  const lastTab = useRef(tab);
  useEffect(() => {
    if (lastTab.current !== tab) {
      lastTab.current = tab;
      setCalc(null);
      setFlash(null);
      setSaveError(null);
    }
  }, [tab]);

  function pick(sku: PickedSku): void {
    setFlash(null);
    setSaveError(null);
    setCalc({ kind: "new", sku });
  }

  function edit(line: CountLine): void {
    setFlash(null);
    setSaveError(null);
    setCalc({ kind: "edit", line });
  }

  async function save(values: CalcValues): Promise<void> {
    if (!audit || calc === null) return;
    const isCartons = values.mode === COUNT_MODE.cartons;
    const material = calc.kind === "new" ? calc.sku.material : calc.line.material;
    const inCatalog = calc.kind === "new" ? calc.sku.inCatalog : calc.line.inCatalog;
    const body: LineBody = {
      material,
      mode: values.mode,
      stack: values.stack,
      rows: values.rows,
      depth: values.depth,
      pcsPerCarton: isCartons ? values.pcsPerCarton : null,
      loose: values.loose,
      ...(inCatalog ? {} : { notInCatalog: true }),
    };
    setBusy(true);
    setSaveError(null);
    const r = calc.kind === "new" ? await createLine(audit.id, body) : await updateLine(calc.line.id, body);
    setBusy(false);
    if (!r.ok) {
      // Lock codes close the calculator and show the banner; everything else
      // keeps it open with what they typed (network, invalid …).
      if (!applyLock(r.error)) setSaveError(friendlyError(r.error));
      return;
    }
    const wasEdit = calc.kind === "edit";
    setFlash(`${wasEdit ? "Updated" : "Submitted"} ${r.data.line.material} · ${fmtPcs(r.data.line.totalPcs)} pcs`);
    setCalc(null);
    setTab(wasEdit ? "submitted" : "count");
    lastTab.current = wasEdit ? "submitted" : "count";
    setResetKey((k) => k + 1);
    await loadLines(audit.id);
  }

  async function remove(line: CountLine): Promise<boolean> {
    if (!audit) return true;
    setRemoving(true);
    setRemoveError(null);
    const r = await removeLine(line.id);
    setRemoving(false);
    if (!r.ok) {
      if (applyLock(r.error)) return true;
      setRemoveError(friendlyError(r.error));
      return false;
    }
    setFlash(`Removed ${line.material} · ${fmtPcs(line.totalPcs)} pcs`);
    await loadLines(audit.id);
    return true;
  }

  const readOnly = lock !== null;
  const multi = (audits?.length ?? 0) > 1;

  // ── Body ───────────────────────────────────────────────────────────────────
  let body: React.ReactNode;
  if (!audit) {
    body = <AuditPicker audits={audits} error={auditsError} onOpen={openAudit} onRetry={() => void loadAudits()} />;
  } else if (lock === "removed") {
    body = (
      <div className="px-4 py-10 text-center">
        <p className="text-[15px] font-semibold text-ink-900">You&apos;ve been taken off this audit</p>
        <p className="mt-1 text-[13px] text-ink-500">Your counts are kept. Ask your supervisor if this is a mistake.</p>
        <button type="button" onClick={backToList} className="mt-4 text-[15px] font-semibold text-brand-700">
          Back to my audits
        </button>
      </div>
    );
  } else if (calc !== null) {
    const initial: CalcValues =
      calc.kind === "new"
        ? {
            mode: calc.sku.defaultMode,
            stack: "",
            rows: "",
            depth: "",
            pcsPerCarton: calc.sku.piecesPerCarton !== null ? String(calc.sku.piecesPerCarton) : "",
            loose: "",
          }
        : {
            mode: calc.line.mode,
            stack: String(calc.line.stack),
            rows: String(calc.line.rows),
            depth: String(calc.line.depth),
            pcsPerCarton: calc.line.pcsPerCarton !== null ? String(calc.line.pcsPerCarton) : "",
            loose: String(calc.line.loose),
          };
    body = (
      <CountCalculator
        key={calc.kind === "new" ? `new-${calc.sku.material}` : `edit-${calc.line.id}`}
        sku={
          calc.kind === "new"
            ? calc.sku
            : {
                material: calc.line.material,
                description: calc.line.skuDescription,
                pack: calc.line.skuPack,
                inCatalog: calc.line.inCatalog,
                piecesPerCarton: calc.line.pcsPerCarton,
              }
        }
        initial={initial}
        submitLabel={calc.kind === "new" ? "Submit" : "Update"}
        busy={busy}
        error={saveError}
        onSubmit={(v) => void save(v)}
        onCancel={() => {
          const wasEdit = calc.kind === "edit";
          setCalc(null);
          setSaveError(null);
          if (wasEdit) setTab("submitted");
        }}
      />
    );
  } else if (tab === "submitted") {
    body = (
      <CountSubmitted
        auditNumber={audit.auditNumber}
        lines={lines}
        loadError={linesError}
        flash={flash}
        readOnly={readOnly}
        removing={removing}
        removeError={removeError}
        onEdit={edit}
        onRemove={remove}
        onRetry={() => void loadLines(audit.id)}
      />
    );
  } else {
    body = <CountSearch flash={flash} readOnly={readOnly} resetKey={resetKey} onPick={pick} />;
  }

  const title = audit ? audit.auditNumber : "Stock count";
  const subtitle = audit ? fmtStarted(audit.createdAt) : undefined;

  return (
    // `fixed inset-0`, not min-h-full — the CI / Picking reason (a fixed box
    // measures against the viewport, so the ground fills to the tab bar).
    // md:left-[72px] keeps the desktop sidebar rail uncovered.
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-ink-25 md:left-[72px] md:bg-ink-50">
      <div className="md:hidden">
        <ModuleMobileHeader
          title={title}
          subtitle={subtitle}
          avatarInitials={userInitials}
          onAvatarClick={openYou}
          onMenuClick={openMenu}
          showSearch={false}
        />
      </div>

      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-white md:mx-auto md:my-6 md:max-w-[480px] md:rounded-[14px] md:border md:border-ink-100">
        {/* Desktop heading — the phone has the masthead above. */}
        <div className="hidden flex-none border-b border-ink-100 px-4 py-3 md:block">
          <h1 className="text-[17px] font-bold text-brand-600">{title}</h1>
          {subtitle && <p className="text-[12.5px] text-ink-500">{subtitle}</p>}
        </div>

        {/* Back to the list — only when there is a list to go back to. */}
        {audit && multi && calc === null && lock !== "removed" && (
          <button
            type="button"
            onClick={backToList}
            className="flex flex-none items-center gap-1.5 px-4 pt-3 text-[14px] font-semibold text-brand-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            My audits
          </button>
        )}

        {/* ≥768px: the segmented Count | Submitted (n). The phone uses the bottom bar. */}
        {audit && calc === null && lock !== "removed" && (
          <div className="hidden flex-none gap-1 px-4 pt-3 md:flex" role="tablist" aria-label="Stock count">
            {TAB_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => changeTab(k)}
                className={cn(
                  "h-10 flex-1 rounded-[10px] border text-[14px]",
                  tab === k ? "border-data-slate bg-ink-25 font-semibold text-ink-900" : "border-ink-100 text-ink-500",
                )}
              >
                {k === "count" ? "Count" : `Submitted (${lines?.length ?? "…"})`}
              </button>
            ))}
          </div>
        )}

        {lock === "closed" && (
          <div role="status" className="mx-4 mt-3 flex-none rounded-[10px] bg-warn-bg px-3 py-2.5 text-[14px] text-warn-text">
            This audit is closed — counts are locked
          </div>
        )}

        {body}
      </div>
    </div>
  );
}

function AuditPicker({
  audits,
  error,
  onOpen,
  onRetry,
}: {
  audits: MyAudit[] | null;
  error: string | null;
  onOpen: (a: MyAudit) => void;
  onRetry: () => void;
}): React.JSX.Element {
  if (error) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-[14px] text-danger-text">{error}</p>
        <button type="button" onClick={onRetry} className="mt-2 text-[14px] font-semibold text-brand-700">
          Try again
        </button>
      </div>
    );
  }
  if (audits === null) return <p className="px-4 py-10 text-center text-[14px] text-ink-400">Loading…</p>;
  if (audits.length === 0) {
    return (
      <div className="flex flex-col items-center px-8 py-14 text-center">
        <ClipboardList className="mb-3 h-12 w-12 text-ink-200" strokeWidth={1.5} aria-hidden="true" />
        <p className="text-[16px] font-semibold text-ink-700">No open audit assigned to you</p>
        <p className="mt-1 text-[13px] text-ink-500">Ask your supervisor to add you to an audit.</p>
        <button type="button" onClick={onRetry} className="mt-4 text-[14px] font-semibold text-brand-700">
          Check again
        </button>
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
      <div className="mb-1 text-[13px] text-ink-500">Your open audits</div>
      <ul>
        {audits.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onOpen(a)}
              className="flex w-full items-center justify-between gap-2.5 border-b border-ink-100 py-3.5 text-left active:bg-ink-25"
            >
              <span>
                <span className="block text-[15px] font-semibold text-ink-900">{a.auditNumber}</span>
                <span className="block text-[12.5px] text-ink-500">
                  {fmtStarted(a.createdAt)} · {a.myLines} {a.myLines === 1 ? "line" : "lines"} by you
                </span>
              </span>
              <ChevronRight className="h-5 w-5 flex-none text-ink-400" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3.5 text-[12px] text-ink-400">Only audits you&apos;re assigned to show here.</p>
    </div>
  );
}
