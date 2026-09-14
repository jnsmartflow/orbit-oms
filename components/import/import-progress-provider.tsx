"use client";

// components/import/import-progress-provider.tsx
//
// Owns the ONE in-flight OBD import WRITE for this browser tab, so the operator
// can close the Import window and keep working while it runs. The header's pill
// (components/import/import-progress-pill.tsx) renders whatever this holds.
//
// 🔴 THE FETCH LIVES HERE, NOT IN THE MODAL. The modal is mounted by
// UniversalHeader, which every board renders for itself — so it unmounts on
// every client-side navigation. A request started there would be orphaned (its
// result landing in a component that no longer exists) the moment the operator
// moved screen, which is the whole thing this provider exists to prevent. It is
// mounted once, in the ROOT layout (app/layout.tsx), the only layout that
// survives navigation between every screen.
//
// ⚠ PER-TAB AND IN-MEMORY ON PURPOSE. No localStorage (CLAUDE_UI). A hard
// refresh or closing the tab loses the RESULT — the import itself still
// finishes on the server, because the request was already sent.
//
// ⚠ NEVER router.refresh() from here. A history pop discards a pending refresh
// (CORE §3), and nothing here needs one — boards refresh through their own
// live-sync.
//
// Only the WRITE (confirm) comes through here. Preview is a quick read the
// operator is looking at on purpose; it stays inside the modal.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { PasteUnresolvedCustomer } from "@/lib/import-types";

/** What the modal hands over when the operator confirms. */
export interface ImportJobRequest {
  /** Known up front for a paste or a previewed file; null when not. */
  obdCount:    number | null;
  /** Shown in the panel only — the pill never names the source. */
  sourceLabel: string;
  url:         string;
  init:        RequestInit;
}

export interface ImportRunResult {
  batchRef:            string;
  created:             number;
  patched:             number;
  unchanged:           number;
  errored:             number;
  unresolvedCustomers: PasteUnresolvedCustomer[];
}

interface JobMeta {
  obdCount:    number | null;
  sourceLabel: string;
}

export type ImportRunState =
  | { status: "idle" }
  | { status: "running"; job: JobMeta }
  | { status: "done";    job: JobMeta; result: ImportRunResult }
  | { status: "failed";  job: JobMeta; error: string };

export interface ImportProgressContextValue {
  state: ImportRunState;
  /**
   * Start the write. Returns false — and starts nothing — while an import is
   * running, or while a FAILURE is still on screen: an unseen failure must not
   * be wiped by the next import. A finished (green) result IS replaced.
   */
  startImport: (job: ImportJobRequest) => boolean;
  /** Clear a finished or failed result. No-op while running. */
  dismiss: () => void;
}

const IDLE: ImportRunState = { status: "idle" };

const ImportProgressContext = createContext<ImportProgressContextValue>({
  state:       IDLE,
  startImport: () => false,
  dismiss:     () => undefined,
});

export function useImportProgress(): ImportProgressContextValue {
  return useContext(ImportProgressContext);
}

const NETWORK_FAILURE =
  "Could not reach the server. The import may still have finished — check the orders before importing again.";

export function ImportProgressProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ImportRunState>(IDLE);
  // The live status, readable synchronously — so two clicks in the same tick
  // cannot both pass the "is anything running?" check before a re-render.
  const statusRef = useRef<ImportRunState["status"]>("idle");

  const set = useCallback((next: ImportRunState) => {
    statusRef.current = next.status;
    setState(next);
  }, []);

  const startImport = useCallback((job: ImportJobRequest): boolean => {
    if (statusRef.current === "running" || statusRef.current === "failed") return false;

    const meta: JobMeta = { obdCount: job.obdCount, sourceLabel: job.sourceLabel };
    set({ status: "running", job: meta });

    void (async () => {
      let res: Response;
      try {
        res = await fetch(job.url, job.init);
      } catch {
        set({ status: "failed", job: meta, error: NETWORK_FAILURE });
        return;
      }

      // 🔴 Content-type BEFORE res.json(): a platform 413/502 is not JSON and
      // would otherwise surface as a parse error instead of what happened.
      const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
      if (!isJson) {
        set({
          status: "failed",
          job:    meta,
          error:  res.status === 413
            ? "The import was too large for the server to accept."
            : `Import failed — the server returned ${res.status}.`,
        });
        return;
      }

      let data: {
        ok?:       boolean;
        error?:    string;
        errors?:   unknown[];
        batchRef?: string;
        summary?:  { created?: number; patched?: number; unchanged?: number; errored?: number };
        unresolvedCustomers?: PasteUnresolvedCustomer[];
      };
      try {
        data = await res.json();
      } catch {
        set({ status: "failed", job: meta, error: `Import failed — unreadable response (${res.status}).` });
        return;
      }

      if (!res.ok || data.ok === false || !data.summary) {
        const lines = Array.isArray(data.errors) && data.errors.length > 0
          ? ` (${data.errors.length} line${data.errors.length === 1 ? "" : "s"} could not be read)`
          : "";
        set({
          status: "failed",
          job:    meta,
          error:  `${data.error ?? `Import failed — the server returned ${res.status}.`}${lines}`,
        });
        return;
      }

      set({
        status: "done",
        job:    meta,
        result: {
          batchRef:            data.batchRef ?? "—",
          created:             data.summary.created   ?? 0,
          patched:             data.summary.patched   ?? 0,
          unchanged:           data.summary.unchanged ?? 0,
          errored:             data.summary.errored   ?? 0,
          unresolvedCustomers: data.unresolvedCustomers ?? [],
        },
      });
    })();

    return true;
  }, [set]);

  const dismiss = useCallback(() => {
    if (statusRef.current === "running") return;
    set(IDLE);
  }, [set]);

  const value = useMemo<ImportProgressContextValue>(
    () => ({ state, startImport, dismiss }),
    [state, startImport, dismiss],
  );

  return <ImportProgressContext.Provider value={value}>{children}</ImportProgressContext.Provider>;
}
