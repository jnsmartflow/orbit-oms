"use client";

// components/stock-audit/count-shell.tsx — /stock-count, the counter's phone
// screen. Owns: THE open audit, the Count | Submitted tabs, the one-box qty
// entry (new line / edit — v27.79: ONE number, always pieces), the downloaded
// SKU list, and the read-only states.
//
// OPEN COUNTING (Smart Flow, 2026-11-02): there is no counter list and at most
// one audit is open. Everyone holding Stock count counts in it, so the screen
// opens it straight away — no picker. None open → "No audit is open right
// now" + Check again. Closed under you → the closed banner + "Check for a new
// audit".
//
// The CI pattern (components/ci/ci-shell.tsx, CLAUDE_UI §59.4/§59.5):
//   • Phone — the two tabs are handed to RoleLayoutClient as `workflowTabs`,
//     which REPLACE the shared Home/Menu/You bar. Menu + You move to
//     ModuleMobileHeader (grid icon / avatar → useMobileShell()).
//   • The qty entry sets `hideBar`, so Submit owns the thumb zone.
//   • ≥768px the shared bar is `md:hidden` and never drawn, so the same two
//     tabs render as a segmented control at the top of a centred 480px column.
//   • `workflowTabs` is passed ONLY while an audit is open. On the empty state
//     the default Home/Menu/You bar stands (omitting the prop, not `[]` —
//     §59.2's landmine).
//
// Behaviour, wording and flow follow docs/mockups/stock-audit/stock-audit-
// mobile.html (openAudit/search/counter/submitted); its CSS is not used.
//
// SKU LIST: downloaded once and searched locally (catalog-store.ts). Stored
// copy shown at once; refreshed on every open and after a NOT_IN_CATALOG save.
//
// 🔴 Submitted (n) is the server's number: the lines are RE-READ after every
// save, edit and removal. Never a local +1.
// 🔴 BLIND COUNT: nothing here can show another person's lines, a total
// across counters, or an expected quantity — the API returns none.

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList, ListChecks, Search } from "lucide-react";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import { ModuleMobileHeader } from "@/components/shared/module-mobile-header";
import { useMobileShell } from "@/components/shared/mobile-shell-context";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";
import type { WorkflowTab } from "@/components/shared/workflow-tab-bar";
import type { NavItemConfig } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { CatalogRow } from "@/lib/stock-audit/sku-search";
import type { CountLine, MyAudit } from "@/lib/stock-audit/types";
import {
  createLine,
  fetchMyLines,
  fetchOpenAudit,
  fmtPcs,
  fmtStarted,
  friendlyError,
  removeLine,
  updateLine,
  type CountError,
  type LineBody,
} from "./count-api";
import { readStoredCatalog, refreshCatalog } from "./catalog-store";
import { CountCalculator } from "./count-calculator";
import { CountSearch, type PickedSku } from "./count-search";
import { CountSubmitted } from "./count-submitted";

type TabKey = "count" | "submitted";
const TAB_KEYS: readonly TabKey[] = ["count", "submitted"];
function isTabKey(v: string): v is TabKey {
  return (TAB_KEYS as readonly string[]).includes(v);
}

type CalcState = { kind: "new"; sku: PickedSku } | { kind: "edit"; line: CountLine };

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

  /** loading → the first answer; "none" = no audit open. */
  const [auditState, setAuditState] = useState<"loading" | "ready" | "none" | "error">("loading");
  const [auditError, setAuditError] = useState<string | null>(null);

  const [lines, setLines] = useState<CountLine[] | null>(null);
  const [linesError, setLinesError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

  const [catalog, setCatalog] = useState<CatalogRow[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [calc, setCalc] = useState<CalcState | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => setCalcOpen(calc !== null), [calc, setCalcOpen]);
  useEffect(() => setLineCount(lines === null ? undefined : lines.length), [lines, setLineCount]);

  // ── SKU list: the stored copy at once, then ask the server if it is current.
  const loadCatalog = useCallback(async (): Promise<void> => {
    const r = await refreshCatalog();
    if (r.ok) {
      setCatalog(r.catalog.rows);
      setCatalogError(null);
    } else {
      setCatalogError(
        r.error.code === "NETWORK" ? "Couldn't download the SKU list — check signal" : friendlyError(r.error),
      );
    }
  }, []);

  useEffect(() => {
    const stored = readStoredCatalog();
    if (stored) setCatalog(stored.rows);
    void loadCatalog();
  }, [loadCatalog]);

  /** AUDIT_CLOSED turns the screen read-only. True if it was that. */
  const applyLock = useCallback((e: CountError): boolean => {
    if (e.code === "AUDIT_CLOSED") {
      setClosed(true);
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
        if (r.data.audit.status !== "open") setClosed(true);
        return;
      }
      if (!applyLock(r.error)) setLinesError(friendlyError(r.error));
    },
    [applyLock],
  );

  const loadAudit = useCallback(async (): Promise<void> => {
    setAuditState("loading");
    const r = await fetchOpenAudit();
    if (!r.ok) {
      setAuditError(friendlyError(r.error));
      setAuditState("error");
      return;
    }
    setAuditError(null);
    setTab("count");
    setCalc(null);
    setFlash(null);
    setSaveError(null);
    setClosed(false);
    setLines(null);
    setLinesError(null);
    setResetKey((k) => k + 1);
    setAudit(r.data.audit);
    if (r.data.audit === null) {
      setAuditState("none");
      return;
    }
    setAuditState("ready");
    void loadLines(r.data.audit.id);
  }, [setAudit, setTab, loadLines]);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

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

  async function save(qty: string): Promise<void> {
    if (!audit || calc === null) return;
    const material = calc.kind === "new" ? calc.sku.material : calc.line.material;
    const inCatalog = calc.kind === "new" ? calc.sku.inCatalog : calc.line.inCatalog;
    const body: LineBody = {
      // An edit sends the line's own material — Edit changes the qty only.
      material,
      qty,
      ...(inCatalog ? {} : { notInCatalog: true }),
    };
    setBusy(true);
    setSaveError(null);
    const r = calc.kind === "new" ? await createLine(audit.id, body) : await updateLine(calc.line.id, body);
    setBusy(false);
    if (!r.ok) {
      if (applyLock(r.error)) return;
      if (r.error.code === "NOT_IN_CATALOG") {
        // Our list was stale — the code left the catalogue since it was
        // downloaded. Refresh the list, and turn this line into a
        // "Not in catalog" one: Submit again is the counter's confirm.
        void loadCatalog();
        if (calc.kind === "new") {
          setCalc({ kind: "new", sku: { ...calc.sku, inCatalog: false, description: null, pack: null } });
        } else {
          setCalc({ kind: "edit", line: { ...calc.line, inCatalog: false, skuDescription: null, skuPack: null } });
        }
        setSaveError(`${material} is no longer in the SKU catalog — tap ${calc.kind === "new" ? "Submit" : "Update"} again to count it as “Not in catalog”`);
        return;
      }
      // Everything else keeps the entry open with what they typed.
      setSaveError(friendlyError(r.error));
      return;
    }
    const wasEdit = calc.kind === "edit";
    setFlash(`${wasEdit ? "Updated" : "Submitted"} ${r.data.line.material} · ${fmtPcs(r.data.line.qty)} pcs`);
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
    setFlash(`Removed ${line.material} · ${fmtPcs(line.qty)} pcs`);
    await loadLines(audit.id);
    return true;
  }

  // ── Body ───────────────────────────────────────────────────────────────────
  let body: React.ReactNode;
  if (!audit) {
    body = <NoAudit state={auditState} error={auditError} onRetry={() => void loadAudit()} />;
  } else if (calc !== null) {
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
              }
        }
        initialQty={calc.kind === "new" ? "" : String(calc.line.qty)}
        submitLabel={calc.kind === "new" ? "Submit" : "Update"}
        busy={busy}
        error={saveError}
        onSubmit={(qty) => void save(qty)}
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
        readOnly={closed}
        removing={removing}
        removeError={removeError}
        onEdit={edit}
        onRemove={remove}
        onRetry={() => void loadLines(audit.id)}
      />
    );
  } else {
    body = (
      <CountSearch
        flash={flash}
        readOnly={closed}
        resetKey={resetKey}
        catalog={catalog}
        catalogError={catalogError}
        onRetryCatalog={() => void loadCatalog()}
        onPick={pick}
      />
    );
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

        {/* ≥768px: the segmented Count | Submitted (n). The phone uses the bottom bar. */}
        {audit && calc === null && (
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

        {audit && closed && (
          <div role="status" className="mx-4 mt-3 flex-none rounded-[10px] bg-warn-bg px-3 py-2.5 text-[14px] text-warn-text">
            This audit is closed — counts are locked.{" "}
            <button type="button" onClick={() => void loadAudit()} className="font-semibold underline">
              Check for a new audit
            </button>
          </div>
        )}

        {body}
      </div>
    </div>
  );
}

function NoAudit({
  state,
  error,
  onRetry,
}: {
  state: "loading" | "ready" | "none" | "error";
  error: string | null;
  onRetry: () => void;
}): React.JSX.Element {
  if (state === "error") {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-[14px] text-danger-text">{error}</p>
        <button type="button" onClick={onRetry} className="mt-2 text-[14px] font-semibold text-brand-700">
          Try again
        </button>
      </div>
    );
  }
  if (state !== "none") return <p className="px-4 py-10 text-center text-[14px] text-ink-400">Loading…</p>;
  return (
    <div className="flex flex-col items-center px-8 py-14 text-center">
      <ClipboardList className="mb-3 h-12 w-12 text-ink-200" strokeWidth={1.5} aria-hidden="true" />
      <p className="text-[16px] font-semibold text-ink-700">No audit is open right now</p>
      <p className="mt-1 text-[13px] text-ink-500">When your supervisor starts one, it opens here.</p>
      <button type="button" onClick={onRetry} className="mt-4 text-[14px] font-semibold text-brand-700">
        Check again
      </button>
    </div>
  );
}
