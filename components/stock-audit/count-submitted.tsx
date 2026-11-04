"use client";

// components/stock-audit/count-submitted.tsx — the Submitted tab: MY entries
// in this audit, each with a status, Edit and Remove.
//
// Follows docs/mockups/stock-audit/stock-audit-mobile.html submitted():
// "Your entries in SA-…", rows "{code} · {qty} pcs" / description · pack /
// time, the Edit icon, and "Nothing submitted yet." Remove is NOT in the
// mockup — it is Smart Flow's soft-delete decision (2026-11-02) and sits
// beside Edit behind a confirm sheet. v27.79 (2026-11-03): a line is ONE qty,
// always pieces; Edit changes the qty only.
//
// OFFLINE QUEUE (v27.80, Smart Flow 2026-11-04): the list MERGES two sources —
//   · entries still ON THE PHONE (use-count-queue.ts), on top, newest first,
//     each with a pill: Waiting · Sending · Failed. Edit / Remove change only
//     the phone copy (no network); both are disabled only while that row is
//     sending. Tap a Failed pill to retry; a NOT_IN_CATALOG one opens the
//     "Count as Not in catalog?" sheet. "Failed — audit closed" has no retry:
//     the counter may DISCARD it, behind a confirm (Smart Flow decision 1).
//   · the server's lines, "Sent". Edit / Remove = PATCH / DELETE (need signal).
// Entries from an OLDER audit that never got sent are listed below, so they
// are never silently lost.
//
// BLIND: these are the session user's own entries only (the API never returns
// anyone else's).

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { MOBILE_NAV_CLEARANCE } from "@/components/shared/mobile-shell";
import { cn } from "@/lib/utils";
import type { CountLine } from "@/lib/stock-audit/types";
import { fmtPcs, fmtTime } from "./count-api";
import type { OlderQueue, ShownEntry } from "./use-count-queue";

interface Props {
  auditId: number;
  auditNumber: string;
  lines: CountLine[] | null;
  loadError: string | null;
  /** The lines shown are the phone's last copy (no signal). */
  offlineCopy: boolean;
  flash: string | null;
  readOnly: boolean;
  queued: ShownEntry[];
  older: OlderQueue[];
  removing: boolean;
  removeError: string | null;
  onEdit: (line: CountLine) => void;
  /** Resolves true when the line was removed (the sheet then closes). */
  onRemove: (line: CountLine) => Promise<boolean>;
  onEditQueued: (entry: ShownEntry) => void;
  onRemoveQueued: (auditId: number, entry: ShownEntry) => void;
  onRetryQueued: (auditId: number, entry: ShownEntry) => void;
  onConfirmNotInCatalog: (auditId: number, entry: ShownEntry) => void;
  onRetry: () => void;
}

type Confirm =
  | { kind: "sent"; line: CountLine }
  | { kind: "queued"; auditId: number; entry: ShownEntry };

const PILL = "inline-flex flex-none items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold";

function pillFor(e: ShownEntry): { label: string; cls: string } {
  if (e.shownState === "sending") return { label: "Sending…", cls: "bg-ink-50 text-ink-600" };
  if (e.shownState === "waiting") return { label: "Waiting", cls: "bg-ink-50 text-ink-600" };
  if (e.fail?.kind === "closed") return { label: "Failed — audit closed", cls: "bg-danger-bg text-danger-text" };
  if (e.fail?.kind === "confirm") return { label: "Failed — not in catalog · tap", cls: "bg-danger-bg text-danger-text" };
  return { label: "Failed · tap to retry", cls: "bg-danger-bg text-danger-text" };
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-ink-100 text-ink-600 active:bg-ink-50 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function CountSubmitted({
  auditId,
  auditNumber,
  lines,
  loadError,
  offlineCopy,
  flash,
  readOnly,
  queued,
  older,
  removing,
  removeError,
  onEdit,
  onRemove,
  onEditQueued,
  onRemoveQueued,
  onRetryQueued,
  onConfirmNotInCatalog,
  onRetry,
}: Props): React.JSX.Element {
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [nic, setNic] = useState<{ auditId: number; entry: ShownEntry } | null>(null);

  // A queued entry the server already holds (its reply was lost) shows once, as Sent.
  const serverIds = new Set<string>();
  for (const l of lines ?? []) if (l.clientId) serverIds.add(l.clientId);
  const unsent = queued.filter((e) => !serverIds.has(e.clientId));
  const nothing = unsent.length === 0 && lines !== null && lines.length === 0;

  function tapPill(aId: number, e: ShownEntry): void {
    if (e.shownState !== "failed" || e.fail?.kind === "closed") return;
    if (e.fail?.kind === "confirm") setNic({ auditId: aId, entry: e });
    else onRetryQueued(aId, e);
  }

  function queuedRow(aId: number, e: ShownEntry, allowEdit: boolean): React.JSX.Element {
    const pill = pillFor(e);
    const sending = e.shownState === "sending";
    const closed = e.fail?.kind === "closed";
    const tappable = e.shownState === "failed" && !closed;
    return (
      <li key={e.clientId} className="flex items-center justify-between gap-2.5 border-b border-ink-100 py-3.5">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold tabular-nums text-ink-900">
            {e.material} · {fmtPcs(e.qty)} pcs
          </div>
          <div className="truncate text-[12.5px] text-ink-500">
            {e.inCatalog ? `${e.skuDescription ?? ""}${e.skuPack ? ` · ${e.skuPack}` : ""}` : "Not in catalog"}
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-[12px] tabular-nums text-ink-400">{fmtTime(e.countedAt)}</span>
            {tappable ? (
              <button type="button" onClick={() => tapPill(aId, e)} className={cn(PILL, pill.cls)}>
                {pill.label}
              </button>
            ) : (
              <span className={cn(PILL, pill.cls)}>{pill.label}</span>
            )}
          </div>
        </div>
        <div className="flex flex-none gap-1">
          {allowEdit && !closed && (
            <IconButton label={`Edit ${e.material}`} disabled={sending} onClick={() => onEditQueued(e)}>
              <Pencil className="h-[18px] w-[18px]" />
            </IconButton>
          )}
          <IconButton
            label={closed ? `Discard ${e.material}` : `Remove ${e.material}`}
            disabled={sending}
            onClick={() => setConfirm({ kind: "queued", auditId: aId, entry: e })}
          >
            <Trash2 className="h-[18px] w-[18px]" />
          </IconButton>
        </div>
      </li>
    );
  }

  const sheet = confirm === null ? null : sheetText(confirm);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4" style={{ paddingBottom: MOBILE_NAV_CLEARANCE }}>
      {flash && (
        <div role="status" className="mb-3 rounded-[10px] bg-ok-bg px-3 py-2.5 text-[14px] text-ok-text">
          {flash}
        </div>
      )}
      <div className="mb-1 text-[13px] text-ink-500">Your entries in {auditNumber}</div>
      {offlineCopy && (
        <p className="mb-1 text-[12.5px] text-ink-400">No signal — sent entries as last seen on this phone.</p>
      )}

      {unsent.length > 0 && <ul>{unsent.map((e) => queuedRow(auditId, e, !readOnly))}</ul>}

      {loadError && (
        <div className="py-6 text-center">
          <p className="text-[14px] text-danger-text">{loadError}</p>
          <button type="button" onClick={onRetry} className="mt-2 text-[14px] font-semibold text-brand-700">
            Try again
          </button>
        </div>
      )}

      {!loadError && lines === null && unsent.length === 0 && (
        <p className="py-6 text-center text-[14px] text-ink-400">Loading…</p>
      )}

      {!loadError && nothing && <p className="py-6 text-center text-[14px] text-ink-500">Nothing submitted yet.</p>}

      {lines !== null && lines.length > 0 && (
        <ul>
          {lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2.5 border-b border-ink-100 py-3.5">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold tabular-nums text-ink-900">
                  {l.material} · {fmtPcs(l.qty)} pcs
                </div>
                <div className="truncate text-[12.5px] text-ink-500">
                  {l.inCatalog ? `${l.skuDescription ?? ""}${l.skuPack ? ` · ${l.skuPack}` : ""}` : "Not in catalog"}
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="text-[12px] tabular-nums text-ink-400">{fmtTime(l.updatedAt)}</span>
                  <span className={cn(PILL, "bg-ok-bg text-ok-text")}>Sent</span>
                </div>
              </div>
              {!readOnly && (
                <div className="flex flex-none gap-1">
                  <IconButton label={`Edit ${l.material}`} onClick={() => onEdit(l)}>
                    <Pencil className="h-[18px] w-[18px]" />
                  </IconButton>
                  <IconButton label={`Remove ${l.material}`} onClick={() => setConfirm({ kind: "sent", line: l })}>
                    <Trash2 className="h-[18px] w-[18px]" />
                  </IconButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {older.map((q) => (
        <div key={q.auditId} className="mt-5">
          <div className="mb-1 text-[13px] text-ink-500">Not sent — {q.auditNumber || "an earlier audit"}</div>
          <ul>{q.entries.map((e) => queuedRow(q.auditId, e, false))}</ul>
        </div>
      ))}

      {confirm !== null && sheet !== null && (
        <BottomSheet onClose={() => !removing && setConfirm(null)} labelId="sc-rm-title">
          <h2 id="sc-rm-title" className="text-[17px] font-bold text-ink-900">
            {sheet.title}
          </h2>
          <p className="mt-1.5 text-[14px] tabular-nums text-ink-600">{sheet.what}</p>
          {sheet.body && <p className="mt-1 text-[14px] text-ink-600">{sheet.body}</p>}
          {confirm.kind === "sent" && removeError && <p className="mt-2 text-[14px] text-danger-text">{removeError}</p>}
          <div className="mt-4 flex gap-2.5">
            <button
              type="button"
              disabled={removing}
              onClick={() => setConfirm(null)}
              className="h-12 flex-1 rounded-[12px] bg-ink-50 text-[15px] font-semibold text-ink-700"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={removing}
              onClick={async () => {
                if (confirm.kind === "sent") {
                  if (await onRemove(confirm.line)) setConfirm(null);
                } else {
                  onRemoveQueued(confirm.auditId, confirm.entry);
                  setConfirm(null);
                }
              }}
              className="h-12 flex-1 rounded-[12px] bg-danger text-[15px] font-semibold text-white disabled:opacity-60"
            >
              {removing && confirm.kind === "sent" ? "Removing…" : sheet.action}
            </button>
          </div>
        </BottomSheet>
      )}

      {nic !== null && (
        <BottomSheet onClose={() => setNic(null)} labelId="sc-nic2-title">
          <h2 id="sc-nic2-title" className="text-[17px] font-bold text-ink-900">
            Count as Not in catalog?
          </h2>
          <p className="mt-1.5 text-[14px] text-ink-600">
            {nic.entry.material} is not in the SKU catalog. Check it against the label — it will be saved as “Not in
            catalog”.
          </p>
          <div className="mt-4 flex gap-2.5">
            <button
              type="button"
              onClick={() => setNic(null)}
              className="h-12 flex-1 rounded-[12px] bg-ink-50 text-[15px] font-semibold text-ink-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onConfirmNotInCatalog(nic.auditId, nic.entry);
                setNic(null);
              }}
              className="h-12 flex-1 rounded-[12px] bg-brand-600 text-[15px] font-semibold text-white active:bg-brand-700"
            >
              Count it
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

function sheetText(c: Confirm): { title: string; what: string; body: string | null; action: string } {
  if (c.kind === "sent") {
    return { title: "Remove this count?", what: `${c.line.material} · ${fmtPcs(c.line.qty)} pcs`, body: null, action: "Remove" };
  }
  const what = `${c.entry.material} · ${fmtPcs(c.entry.qty)} pcs`;
  if (c.entry.fail?.kind === "closed") {
    return { title: "Discard this count?", what, body: "The audit is closed, so it can't be sent.", action: "Discard" };
  }
  return { title: "Remove this entry?", what, body: "It hasn't been sent yet.", action: "Remove" };
}

function BottomSheet({
  onClose,
  labelId,
  children,
}: {
  onClose: () => void;
  labelId: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] rounded-t-[18px] bg-white p-5"
        style={{ paddingBottom: `calc(${MOBILE_NAV_CLEARANCE} + 12px)` }}
      >
        {children}
      </div>
    </div>
  );
}
