"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { parsePastedLines, type MrnPasteResult } from "@/lib/mrn/paste";
import type { MrnDetail } from "@/lib/mrn/types";
import { ModalButton, ModalError, ModalShell } from "./modal-shell";

// P2 + P3 — the paste flow, two steps in one modal.
//
// Step 1 is the box. Step 2 is the preview: what Orbit matched, BEFORE anything
// is saved. The Back button returns to the box with the text intact.
//
// ⚠️ THE CLIENT PARSES FOR THE PREVIEW; THE SERVER PARSES FOR THE SAVE. Both
// call the SAME pure parsePastedLines() (lib/mrn/paste.ts), so they cannot
// disagree — but the confirm below sends the RAW BLOCK, never the client's
// parsed rows. The server re-parsing is what keeps one parsing authority: a
// browser that somehow parsed differently still cannot write a different answer.
//
// ⚠️ AN UNKNOWN SKU IS NORMAL AND NEVER BLOCKS. Roughly 27% of distinct active
// SAP codes resolve in neither catalog table (CORE §7.1.c). Those lines are
// added with the bare code and are fully checkable; the supervisor simply sees
// no product name. The banner NAMES the codes so billing can eyeball them for a
// typo — that is its job, not gatekeeping. There is no "fix these first" path
// and none may be added.
//
// A row that could not be PARSED is a different matter and does block, at the
// server: the route 400s the whole paste with per-row errors rather than
// silently dropping rows on what is a REPLACE.

interface PasteLinesModalProps {
  detail: MrnDetail;
  onClose: () => void;
  onSaved: () => void;
}

interface CatalogEntry {
  description: string;
  pack: string;
}

export function PasteLinesModal({
  detail,
  onClose,
  onSaved,
}: PasteLinesModalProps): React.JSX.Element {
  const [block, setBlock] = useState("");
  const [step, setStep] = useState<"input" | "preview">("input");
  const [catalog, setCatalog] = useState<Record<string, CatalogEntry>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Per-row parse failures the SERVER reported (it is the authority). */
  const [rowErrors, setRowErrors] = useState<{ sourceRow: number; raw: string; message: string }[]>([]);

  // Live parse, so the button can say "Check 36 lines" the way the mockup does.
  // Cheap and pure — no I/O.
  const parsed: MrnPasteResult = useMemo(() => parsePastedLines(block), [block]);

  const unmatched = useMemo(
    () => Array.from(new Set(parsed.rows.map((r) => r.skuCode).filter((c) => !catalog[c]))),
    [parsed.rows, catalog],
  );
  const matchedCount = parsed.rows.length - unmatched.length;

  async function goToPreview() {
    setBusy(true);
    setError(null);
    setRowErrors([]);
    try {
      // Read-only lookup — no write, nothing committed. See
      // app/api/mrn/resolve-skus/route.ts for why this endpoint exists.
      const res = await fetch("/api/mrn/resolve-skus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: parsed.rows.map((r) => r.skuCode) }),
      });
      if (res.ok) {
        const json = (await res.json()) as { entries: Record<string, CatalogEntry> };
        setCatalog(json.entries ?? {});
      }
      // A failed lookup is NOT a reason to block the paste. The preview simply
      // shows every code as unresolved; the lines still save correctly, because
      // the catalog was never what made them valid.
      setStep("preview");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    setRowErrors([]);
    try {
      const res = await fetch(`/api/mrn/${detail.id}/lines`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // The RAW BLOCK — see this file's header.
        body: JSON.stringify({ block }),
      });

      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          errors?: { sourceRow: number; raw: string; message: string }[];
          linesCleared?: boolean;
        };

        // 🔴 `linesCleared` IS THE ONE FAILURE THAT MUST NOT BE GENERALISED.
        // It means the delete succeeded and the create did not, so this MRN now
        // has ZERO lines. The route wrote that sentence deliberately; showing
        // "something went wrong" instead would leave the operator believing
        // their old lines survived. It is rendered verbatim, and the modal
        // stays OPEN on the input step with the block intact so they can simply
        // press the button again.
        setError(json.error ?? `Could not save the lines (${res.status}).`);
        if (json.errors) setRowErrors(json.errors);
        if (json.linesCleared || json.errors) setStep("input");
        return;
      }

      onSaved();
    } catch {
      setError("Could not reach the server. Try again — nothing was saved.");
    } finally {
      setBusy(false);
    }
  }

  // ── Step 1 ────────────────────────────────────────────────────────────────
  if (step === "input") {
    return (
      <ModalShell
        title="Paste lines from Excel"
        subtitle={
          <>
            Select the rows in your sheet, copy, then click in the box and paste. Three
            columns: <b>Sr no · SKU · Qty as per STI</b>.
          </>
        }
        width="wide"
        busy={busy}
        onClose={onClose}
        footer={
          <>
            <ModalButton onClick={onClose} disabled={busy}>
              Cancel
            </ModalButton>
            <ModalButton
              tone="confirm"
              onClick={goToPreview}
              disabled={busy || parsed.rows.length === 0}
            >
              {parsed.rows.length === 0
                ? "Check lines"
                : `Check ${parsed.rows.length} line${parsed.rows.length === 1 ? "" : "s"}`}
            </ModalButton>
          </>
        }
      >
        {error && <ModalError message={error} />}

        {rowErrors.length > 0 && (
          <div className="mb-3.5 overflow-hidden rounded-[9px] border border-red-200 bg-red-50">
            <div className="border-b border-red-200 px-[13px] py-2 text-[11.5px] font-semibold text-[#b42318]">
              Rows that could not be read
            </div>
            <ul className="max-h-[120px] overflow-y-auto px-[13px] py-2">
              {rowErrors.map((e) => (
                <li key={e.sourceRow} className="py-0.5 text-[11.5px] text-[#b42318]">
                  <span className="font-semibold">Row {e.sourceRow}</span> — {e.message}{" "}
                  <span className="font-mono text-[#98a2b3]">{e.raw.trim().slice(0, 40)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <textarea
          value={block}
          onChange={(e) => setBlock(e.target.value)}
          autoFocus
          spellCheck={false}
          placeholder={"1\t5575910\t32\n2\t5579816\t28\n3\t5579821\t32"}
          className="h-[186px] w-full resize-none rounded-[9px] border border-gray-200 bg-[#fcfcfd] px-3 py-[11px] font-mono text-[11.5px] leading-[1.85] text-[#475467] outline-none focus:border-gray-400"
        />

        <p className="mt-2 text-[11.5px] leading-[1.55] text-[#98a2b3]">
          Tab-separated or comma-separated both work. A header row is skipped
          automatically. Sr no is optional — if you leave it out, lines are numbered in
          paste order.
          {parsed.errors.length > 0 && (
            <>
              {" "}
              <span className="text-[#b45309]">
                {parsed.errors.length} row{parsed.errors.length === 1 ? "" : "s"} in this
                block cannot be read yet.
              </span>
            </>
          )}
        </p>
      </ModalShell>
    );
  }

  // ── Step 2 ────────────────────────────────────────────────────────────────
  return (
    <ModalShell
      title={`${parsed.rows.length} line${parsed.rows.length === 1 ? "" : "s"} ready`}
      subtitle={
        unmatched.length === 0 ? (
          <>All {matchedCount} SKUs matched the catalog.</>
        ) : (
          <>
            {matchedCount} SKU{matchedCount === 1 ? "" : "s"} matched the catalog.{" "}
            {unmatched.length} {unmatched.length === 1 ? "was" : "were"} not found — they
            will still be added, with the code only.
          </>
        )
      }
      width="wide"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <ModalButton onClick={() => setStep("input")} disabled={busy}>
            Back
          </ModalButton>
          <ModalButton tone="confirm" onClick={confirm} disabled={busy}>
            {busy
              ? "Saving…"
              : `Add ${parsed.rows.length} line${parsed.rows.length === 1 ? "" : "s"}`}
          </ModalButton>
        </>
      }
    >
      {error && <ModalError message={error} />}

      {unmatched.length > 0 && (
        <div className="mb-3 flex gap-[9px] rounded-[9px] border border-amber-200 bg-amber-50 px-[13px] py-[11px] text-[12.5px] leading-[1.55] text-amber-900">
          <AlertTriangle size={16} className="mt-px shrink-0" />
          <div>
            {unmatched.map((c, i) => (
              <span key={c}>
                {i > 0 && (i === unmatched.length - 1 ? " and " : ", ")}
                <b className="font-mono">{c}</b>
              </span>
            ))}{" "}
            {unmatched.length === 1 ? "is" : "are"} not in the SKU catalog. The supervisor
            will see the bare code with no product name.
          </div>
        </div>
      )}

      <div className="max-h-[250px] overflow-y-auto rounded-[9px] border border-[#e6e9ec]">
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col style={{ width: "6%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "46%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "11%" }} />
          </colgroup>
          <thead>
            <tr>
              <Th center>#</Th>
              <Th>SKU</Th>
              <Th>Description</Th>
              <Th center>Pack</Th>
              <Th center>Qty STI</Th>
              <Th center>Match</Th>
            </tr>
          </thead>
          <tbody>
            {parsed.rows.map((r) => {
              const hit = catalog[r.skuCode];
              return (
                <tr key={r.sourceRow} className={hit ? "" : "bg-amber-50/60"}>
                  <Td center muted>{r.lineNo}</Td>
                  <Td mono strong>{r.skuCode}</Td>
                  <Td>
                    {hit ? (
                      hit.description
                    ) : (
                      <span className="text-amber-800">
                        Not in catalog
                        <span className="ml-1.5 rounded border border-amber-200 bg-amber-100 px-[5px] py-px text-[9.5px] font-semibold text-amber-700">
                          UNKNOWN
                        </span>
                      </span>
                    )}
                  </Td>
                  <Td center>{hit?.pack ?? "—"}</Td>
                  <Td center strong>{r.qtySti}</Td>
                  <Td center>
                    <span className={hit ? "text-green-700" : "text-amber-700"}>
                      {hit ? "✓" : "!"}
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11.5px] leading-[1.55] text-[#98a2b3]">
        Pasting replaces every line currently on this MRN.
        {parsed.numbering === "sequential" && parsed.rows.length > 0 && (
          <> Lines are numbered in paste order — no usable Sr no column was found.</>
        )}
        {parsed.headerSkipped && <> A header row was skipped.</>}
      </p>
    </ModalShell>
  );
}

function Th({
  children,
  center,
}: {
  children: React.ReactNode;
  center?: boolean;
}): React.JSX.Element {
  return (
    <th
      className={
        "h-8 whitespace-nowrap border-b border-[#ebebeb] px-2 text-[10px] font-medium uppercase tracking-[0.05em] text-gray-400 " +
        (center ? "text-center" : "text-left")
      }
    >
      {children}
    </th>
  );
}

function Td({
  children,
  center,
  muted,
  strong,
  mono,
}: {
  children?: React.ReactNode;
  center?: boolean;
  muted?: boolean;
  strong?: boolean;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <td
      className={
        "h-9 overflow-hidden text-ellipsis whitespace-nowrap border-b border-[#f0f0f0] px-2 text-[11px] " +
        (center ? "text-center " : "") +
        (mono ? "font-mono " : "") +
        (muted ? "text-gray-400" : strong ? "font-medium text-gray-900" : "text-[#4b5563]")
      }
    >
      {children}
    </td>
  );
}
