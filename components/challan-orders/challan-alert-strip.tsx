"use client";

// components/challan-orders/challan-alert-strip.tsx
//
// The red challan alerts (Challan orders slice 6, 2026-10-07; owner S6-1, S6-2, S6-6) —
// ONE component, shown at the top of the Challan orders screen (every mount) AND on
// Floor (S6-2 / S6-6: "on Floor as well"). Read from GET /api/challan-orders/alerts,
// which computes them live — so a banner only goes when the situation does, which is
// always a person's action (lib/challan-orders/alerts.ts lists which).
//
// Buttons are drawn only with challan_orders canEdit (hidden, never disabled — UI §10):
//   CATCH_FAILED    → Retry
//   DEALER_MISMATCH → Link anyway (billing decides, S6-1)
//   DOUBLE_DISPATCH → none: the fix is to cancel that OBD (Floor) or unlink the SO.
// Polls every 30 s while the tab is visible, and refetches after its own action.
//
// SLICE 6c — also one red line per IMPORT whose challan check could not run
// ("Import <batchRef>: N bills held — challan check failed — Retry"), read from
// import_batches so it shows even while the link table is down. Retry
// (POST /api/import/obd?action=challan-check-retry) is drawn for floor canEdit only —
// the server says so in `canRetryBatches`. If the alert source itself fails, the strip
// says "Challan check status unknown — contact admin" instead of going quiet.

import { useCallback, useEffect, useState } from "react";
import { checkFailedMessage, type CheckFailedBatch } from "@/lib/challan-orders/check-failed-message";

type AlertKind = "DOUBLE_DISPATCH" | "DEALER_MISMATCH" | "CATCH_FAILED";
interface ChallanAlert {
  kind: AlertKind;
  linkId: number;
  soNumber: string;
  orbNumber: string;
  orderId: number;
  obdNumber: string;
  workflowStage: string;
  message: string;
}

const TITLE: Record<AlertKind, string> = {
  DOUBLE_DISPATCH: "DOUBLE DISPATCH RISK",
  DEALER_MISMATCH: "Challan dealer mismatch — held",
  CATCH_FAILED: "Challan catch failed — Retry",
};

export function ChallanAlertStrip({
  canEdit,
  onChanged,
}: {
  canEdit: boolean;
  /** Called after a Retry / Link anyway so the host can reload its own list. */
  onChanged?: () => void;
}) {
  const [alerts, setAlerts] = useState<ChallanAlert[]>([]);
  const [batches, setBatches] = useState<CheckFailedBatch[]>([]);
  const [canRetryBatches, setCanRetryBatches] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [busyBatch, setBusyBatch] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/challan-orders/alerts", { cache: "no-store" });
      // 401 / 403: not this viewer's alerts — stay quiet. Anything else failing means
      // nobody can tell whether a challan check is stuck: say so (slice 6c).
      if (res.status === 401 || res.status === 403) return;
      if (!res.ok) {
        setUnknown(true);
        return;
      }
      const json = (await res.json()) as {
        alerts?: ChallanAlert[];
        batches?: CheckFailedBatch[];
        linkAlertsFailed?: boolean;
        canRetryBatches?: boolean;
      };
      setAlerts(json.alerts ?? []);
      setBatches(json.batches ?? []);
      setUnknown(json.linkAlertsFailed === true);
      setCanRetryBatches(json.canRetryBatches === true);
    } catch {
      setUnknown(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void load();
    }, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function act(a: ChallanAlert, linkAnyway: boolean) {
    if (busy !== null) return;
    setBusy(a.orderId);
    setError(null);
    try {
      const res = await fetch(`/api/challan-orders/links/${a.linkId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkAnyway }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? `Could not retry (HTTP ${res.status}).`);
      }
      await load();
      onChanged?.();
    } catch {
      setError("Could not reach the server — nothing changed.");
    } finally {
      setBusy(null);
    }
  }

  async function retryBatch(b: CheckFailedBatch) {
    if (busyBatch !== null) return;
    setBusyBatch(b.batchId);
    setError(null);
    try {
      const res = await fetch("/api/import/obd?action=challan-check-retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: b.batchId }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? `Could not retry ${b.batchRef} (HTTP ${res.status}).`);
      }
      await load();
      onChanged?.();
    } catch {
      setError("Could not reach the server — nothing changed.");
    } finally {
      setBusyBatch(null);
    }
  }

  if (alerts.length === 0 && batches.length === 0 && !unknown && error === null) return null;
  return (
    <div className="flex flex-col gap-1.5 px-3.5 py-2">
      {batches.map((b) => (
        <div
          key={`batch-${b.batchId}`}
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-800"
        >
          <span className="mt-px flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
            !
          </span>
          <span className="min-w-0 flex-1">
            <b className="font-bold">{checkFailedMessage(b)}</b>
            {" · "}These bills were NOT released to picking. Do not release them by hand —{" "}
            {canRetryBatches ? "press Retry." : "ask someone with Floor edit access to press Retry."}
          </span>
          {canRetryBatches && (
            <button
              type="button"
              onClick={() => void retryBatch(b)}
              disabled={busyBatch !== null}
              className="h-6 flex-shrink-0 rounded-md border border-red-300 bg-white px-2 text-[11px] font-medium text-red-800 hover:bg-red-100"
            >
              {busyBatch === b.batchId ? "Retrying…" : "Retry"}
            </button>
          )}
        </div>
      ))}
      {unknown && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-800">
          Challan check status unknown — contact admin.
        </div>
      )}
      {alerts.map((a) => (
        <div
          key={`${a.kind}-${a.orderId}`}
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-800"
        >
          <span className="mt-px flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
            !
          </span>
          <span className="min-w-0 flex-1">
            <b className="font-bold tracking-wide">{TITLE[a.kind]}</b> · {a.message}
          </span>
          {canEdit && a.kind === "CATCH_FAILED" && (
            <button
              type="button"
              onClick={() => void act(a, false)}
              disabled={busy !== null}
              className="h-6 flex-shrink-0 rounded-md border border-red-300 bg-white px-2 text-[11px] font-medium text-red-800 hover:bg-red-100"
            >
              {busy === a.orderId ? "Retrying…" : "Retry"}
            </button>
          )}
          {canEdit && a.kind === "DEALER_MISMATCH" && (
            <button
              type="button"
              onClick={() => void act(a, true)}
              disabled={busy !== null}
              className="h-6 flex-shrink-0 rounded-md border border-red-300 bg-white px-2 text-[11px] font-medium text-red-800 hover:bg-red-100"
            >
              {busy === a.orderId ? "Linking…" : "Link anyway"}
            </button>
          )}
        </div>
      ))}
      {error && <div className="text-[11.5px] text-red-700">{error}</div>}
    </div>
  );
}
