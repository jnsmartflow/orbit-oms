"use client";

// The ONE ship-to modal, for Billing (✎ pencil) and Floor (detail panel
// Ship-to button) — design docs/prompts/drafts/web-update-2026-10-19-ship-to-
// freetext.md §2, mockup docs/mockups/ship-to-freetext/ship-to-freetext-
// mockup.html (4 states). Free-text ship-to P2, 2026-10-19.
//
//   Current ship-to card + ↺ Reset to customer (disabled when nothing changed)
//   Tabs: Search dealer (no upload) · Type name (name / As per challan, Area —
//   REQUIRED, defaults to the customer's — and up to 3 challan copies)
//   Scope line · Cancel / Save (gray-900, UI §13 — owner 2026-10-19)
//
// EVERYTHING COMMITS ON SAVE, in ONE multipart request to the desk's route
// (Billing POST /api/billing/mail-order/ship-to, Floor POST /api/floor/ship-to).
// A Floor bill ON A TRIP (`trip`, 2026-10-24) saves to
// POST /api/floor/trips/[id]/ship-to instead — it stays on the trip and moves
// to the new shop's stop — and a dry run (`preview=1`) says where before Save.
// Picked files, ✕'d copies and Reset are only staged until then, so Cancel
// leaves nothing behind. The server re-checks every rule shown here (copy
// required, 3 copies, 4 MB, who may remove what) — this screen is the
// convenience, the route is the lock.
//
// Client component: imports only pure lib/ship-to/copy.ts and the client
// shrink helper — never lib/supabase.ts or a server lib.

import { useEffect, useMemo, useRef, useState } from "react";
import { ModalButton, ModalShell } from "@/components/shared/modal-shell";
import { smartTitleCase } from "@/lib/mail-orders/utils";
import {
  AS_PER_CHALLAN,
  COPIES_TOO_BIG_MESSAGE,
  MAX_ACTIVE_COPIES,
  MAX_SHIP_TO_TEXT_LEN,
  MAX_TOTAL_COPY_BYTES,
  isAsPerChallanText,
  type ShipToCopyOwner,
} from "@/lib/ship-to/copy";
import { shrinkCopyFile } from "@/lib/ship-to/shrink";
import { openShipToCopy } from "@/lib/ship-to/view-copy";

/** What the card at the top shows — the bill's / mail order's ship-to now. */
export interface ShipToCurrent {
  name: string;
  code: string | null;
  area: string | null;
  deliveryType: string | null;
  /** Any redirect (dealer or typed) — enables Reset and the `changed` tag. */
  isChanged: boolean;
  /** The typed ship-to, when there is one (prefills Type name). */
  typedText: string | null;
  typedAreaId: number | null;
  /** The bill-to dealer — "billed to …" under a typed ship-to. */
  billedToName: string | null;
  billedToCode: string | null;
}

interface DealerHit {
  id: number;
  customerCode: string | null;
  customerName: string;
  area: string | null;
  route: string | null;
  deliveryType: string | null;
}

interface AreaOption {
  id: number;
  name: string;
  deliveryType: string | null;
  route: string | null;
}

interface CopyRow {
  id: number;
  owner: ShipToCopyOwner;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedByName: string | null;
  canRemove: boolean;
}

/** The trip route's dry run (lib/trips/ship-to-on-trip.ts TripShipToPreview). */
interface TripPreview {
  tripNumber: string;
  unchanged: boolean;
  sameStop: boolean;
  joinsExisting: boolean;
  newShop: string;
  oldShop: string | null;
  oldStopCloses: boolean;
}

interface FailedBill {
  obdNumber: string;
  reason: string;
}

const ACCEPT = "image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf";

function fileKind(f: File): "image/jpeg" | "image/png" | "application/pdf" | null {
  if (f.type === "image/jpeg" || f.type === "image/png" || f.type === "application/pdf") return f.type;
  const ext = f.name.toLowerCase().split(".").pop();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "pdf") return "application/pdf";
  return null;
}

function fmtSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function typeLabel(contentType: string): string {
  return contentType === "application/pdf" ? "PDF" : contentType === "image/png" ? "PNG" : "JPG";
}

/** Delivery-type dot — the ShipToCard palette (UI §3). */
function dotClass(type: string | null): string {
  switch ((type ?? "").toUpperCase()) {
    case "LOCAL": return "bg-blue-600";
    case "UPCOUNTRY":
    case "UPC": return "bg-orange-600";
    case "IGT": return "bg-data-teal";
    case "CROSS": return "bg-rose-600";
    default: return "bg-gray-300";
  }
}

export function ShipToModal({
  desk,
  ownerId,
  refLabel,
  current,
  searchUrl,
  trip = null,
  onClose,
  onSaved,
}: {
  /** billing → ownerId is the mail order id; floor → the bill (orders) id. */
  desk: "billing" | "floor";
  ownerId: number;
  /** Beside the title: "SO 4500123456" / "OBD 9110143195". */
  refLabel: string | null;
  current: ShipToCurrent;
  /** The bill-to dealer's area. NOT read: the Area dropdown has no default
   *  (owner, 2026-10-20 — removed after hand test, do not re-add). Kept on the
   *  props so the two call sites stay unchanged. */
  customerAreaId?: number | null;
  /** Dealer search; `?q=` is appended. Default: the desk's own route. Reads
   *  either `{ results: [...] }` (Billing) or a bare array (Floor). */
  searchUrl?: string;
  /** Floor only: the trip the bill is on. Set → the save goes to that trip's
   *  ship-to route and a preview line shows the stop it lands on. */
  trip?: { tripId: number; tripNumber: string } | null;
  onClose: () => void;
  /** After a save landed — the caller reloads. */
  onSaved: () => void;
}): React.JSX.Element {
  const ownOwner: ShipToCopyOwner = desk;
  const onTrip = desk === "floor" && trip !== null;
  const saveUrl =
    desk === "billing"
      ? "/api/billing/mail-order/ship-to"
      : onTrip
        ? `/api/floor/trips/${trip.tripId}/ship-to`
        : "/api/floor/ship-to";
  const idField = desk === "billing" ? "moOrderId" : "orderId";
  const search = searchUrl ?? (desk === "billing" ? "/api/billing/ship-to-search" : "/api/floor/ship-to-search");

  const startTyped = current.typedText !== null;
  const [tab, setTab] = useState<"dealer" | "typed">(startTyped ? "typed" : "dealer");
  const [resetPending, setResetPending] = useState(false);

  // ── Search dealer ─────────────────────────────────────────────────────────
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<DealerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<DealerHit | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    const seq = ++seqRef.current;
    setSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`${search}?q=${encodeURIComponent(term)}`, { cache: "no-store" });
        const body = res.ok ? ((await res.json()) as unknown) : null;
        if (seq !== seqRef.current) return;
        const raw = Array.isArray(body) ? body : ((body as { results?: unknown[] } | null)?.results ?? []);
        setHits(
          (raw as Partial<DealerHit>[]).map((h) => ({
            id: h.id as number,
            customerCode: h.customerCode ?? null,
            customerName: h.customerName ?? "",
            area: h.area ?? null,
            route: h.route ?? null,
            deliveryType: h.deliveryType ?? null,
          })),
        );
      } catch {
        if (seq === seqRef.current) setHits([]);
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, search]);

  // ── Type name ─────────────────────────────────────────────────────────────
  const startApc = current.typedText !== null && isAsPerChallanText(current.typedText);
  const [text, setText] = useState(startTyped && !startApc ? (current.typedText ?? "") : "");
  const [asPerChallan, setAsPerChallan] = useState(startApc);
  const [areas, setAreas] = useState<AreaOption[] | null>(null);
  const [areaId, setAreaId] = useState<number | "">(current.typedAreaId ?? "");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/ship-to/areas", { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as { areas?: AreaOption[] } | null;
        if (!cancelled) setAreas(res.ok ? (body?.areas ?? []) : []);
      } catch {
        if (!cancelled) setAreas([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Copies: saved ones (listed), staged removals, staged new files ─────────
  const [copies, setCopies] = useState<CopyRow[]>([]);
  const [copiesLoaded, setCopiesLoaded] = useState(false);
  const [removeIds, setRemoveIds] = useState<number[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/ship-to/copies?${idField}=${ownerId}`, { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as { copies?: CopyRow[] } | null;
        if (!cancelled) setCopies(res.ok ? (body?.copies ?? []) : []);
      } catch {
        if (!cancelled) setCopies([]);
      } finally {
        if (!cancelled) setCopiesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idField, ownerId]);

  const keptCopies = copies.filter((c) => !removeIds.includes(c.id));
  const ownActive = keptCopies.filter((c) => c.owner === ownOwner).length + newFiles.length;
  const anyCopy = keptCopies.length + newFiles.length;
  const newBytes = newFiles.reduce((s, f) => s + f.size, 0);
  const tooBig = newBytes > MAX_TOTAL_COPY_BYTES;
  const slotsLeft = MAX_ACTIVE_COPIES - ownActive;

  async function addFiles(list: FileList | File[]) {
    setFileErr(null);
    const incoming = Array.from(list);
    if (incoming.length === 0) return;
    if (incoming.some((f) => fileKind(f) === null)) {
      setFileErr("Only JPG, PNG or PDF files.");
      return;
    }
    if (incoming.length > slotsLeft) {
      setFileErr(`Up to ${MAX_ACTIVE_COPIES} copies — ${slotsLeft <= 0 ? "remove one first" : `room for ${slotsLeft} more`}.`);
      return;
    }
    setPreparing(true);
    try {
      const shrunk: File[] = [];
      for (const f of incoming) shrunk.push(await shrinkCopyFile(f));
      setNewFiles((prev) => [...prev, ...shrunk]);
    } finally {
      setPreparing(false);
    }
  }

  async function viewCopy(id: number) {
    const problem = await openShipToCopy(id);
    if (problem !== null) setErr(problem);
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [failedBills, setFailedBills] = useState<FailedBill[] | null>(null);

  const typedReady =
    (asPerChallan || text.trim() !== "") &&
    areaId !== "" &&
    !tooBig &&
    ownActive <= MAX_ACTIVE_COPIES &&
    (!asPerChallan || anyCopy >= 1);
  // ── On a trip: the dry run (2026-10-24) ───────────────────────────────────
  // Re-asked whenever the chosen target changes, debounced; nothing is
  // uploaded and nothing is written. A refusal (D8, challan, held invoice…)
  // shows in the red box and Save stays off.
  const [preview, setPreview] = useState<TripPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const previewSeq = useRef(0);
  const previewKey = !onTrip
    ? null
    : resetPending
      ? "reset"
      : tab === "dealer"
        ? picked !== null
          ? `dealer:${picked.id}`
          : null
        : (asPerChallan || text.trim() !== "") && areaId !== ""
          ? `typed:${asPerChallan ? "apc" : text.trim()}:${areaId}`
          : null;
  useEffect(() => {
    const seq = ++previewSeq.current;
    setPreview(null);
    setPreviewErr(null);
    if (previewKey === null || trip === null) return;
    const t = window.setTimeout(async () => {
      const form = new FormData();
      form.append("orderId", String(ownerId));
      form.append("preview", "1");
      if (previewKey === "reset") form.append("mode", "reset");
      else if (previewKey.startsWith("dealer:")) {
        form.append("mode", "dealer");
        form.append("customerId", previewKey.slice("dealer:".length));
      } else {
        form.append("mode", "typed");
        if (asPerChallan) form.append("asPerChallan", "1");
        else form.append("text", text.trim());
        form.append("areaId", String(areaId));
      }
      try {
        const res = await fetch(`/api/floor/trips/${trip.tripId}/ship-to`, { method: "POST", body: form });
        const body = (await res.json().catch(() => null)) as { preview?: TripPreview; error?: string } | null;
        if (seq !== previewSeq.current) return;
        if (!res.ok) setPreviewErr(body?.error ?? `HTTP ${res.status}`);
        else setPreview(body?.preview ?? null);
      } catch {
        if (seq === previewSeq.current) setPreviewErr("Could not check the trip — try again.");
      }
    }, 300);
    return () => window.clearTimeout(t);
    // previewKey carries every target field; the rest are read at fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, ownerId, trip?.tripId]);

  const canSave =
    !busy &&
    !preparing &&
    previewErr === null &&
    (resetPending || (tab === "dealer" ? picked !== null : typedReady));

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setErr(null);
    const form = new FormData();
    form.append(idField, String(ownerId));
    if (resetPending) {
      form.append("mode", "reset");
    } else if (tab === "dealer" && picked) {
      form.append("mode", "dealer");
      form.append("customerId", String(picked.id));
    } else {
      form.append("mode", "typed");
      if (asPerChallan) form.append("asPerChallan", "1");
      else form.append("text", text.trim());
      form.append("areaId", String(areaId));
      for (const f of newFiles) form.append("files", f, f.name);
      for (const id of removeIds) form.append("removeCopyIds", String(id));
    }
    try {
      const res = await fetch(saveUrl, { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as { error?: string; failed?: FailedBill[] } | null;
      if (!res.ok) {
        setErr(body?.error ?? `Save failed (HTTP ${res.status})`);
        return;
      }
      const failed = body?.failed ?? [];
      if (failed.length > 0) {
        // Saved, but some bills were refused — say which before closing.
        setFailedBills(failed);
        return;
      }
      onSaved();
      onClose();
    } catch {
      setErr("Network error — nothing was confirmed. Check the ship-to and try again.");
    } finally {
      setBusy(false);
    }
  }

  const scopeLine =
    desk === "billing" ? (
      <>Applies to <b>all bills of this SO</b>, including ones that import later.</>
    ) : (
      <>Applies to <b>this bill only</b>.</>
    );

  const areaHint = asPerChallan
    ? "Pick the area from the challan. Decides route tab + trip stop."
    : "Decides route tab + trip stop.";

  const billedTo = current.billedToName ? smartTitleCase(current.billedToName) : null;
  const isTyped = current.typedText !== null;

  const areaOptions = useMemo(() => areas ?? [], [areas]);

  // ── Partial-success view: saved, some bills refused ───────────────────────
  if (failedBills !== null) {
    return (
      <ModalShell
        title="Ship-to saved"
        titleRef={refLabel}
        size="lg"
        onClose={() => {
          onSaved();
          onClose();
        }}
        footer={
          <ModalButton
            tone="confirm"
            onClick={() => {
              onSaved();
              onClose();
            }}
          >
            OK
          </ModalButton>
        }
      >
        <div className="rounded-[10px] bg-warn-bg px-3 py-2.5 text-[13px] text-warn-text">
          The mail order was saved. {failedBills.length === 1 ? "This bill was" : `These ${failedBills.length} bills were`} not
          changed:
        </div>
        <ul className="mt-3 space-y-1.5">
          {failedBills.map((f) => (
            <li key={f.obdNumber} className="text-[13px] text-ink-700">
              <span className="font-mono text-[12px] text-gray-800">{f.obdNumber}</span> — {f.reason}
            </li>
          ))}
        </ul>
      </ModalShell>
    );
  }

  return (
    <ModalShell
      title="Change ship-to"
      titleRef={refLabel}
      size="lg"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <ModalButton disabled={busy} onClick={onClose}>
            Cancel
          </ModalButton>
          <ModalButton tone="confirm" disabled={!canSave} onClick={() => void save()}>
            {busy ? "Saving…" : "Save ship-to"}
          </ModalButton>
        </>
      }
    >
      {/* ── Current ship-to ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 rounded-xl border border-ink-100 bg-ink-25 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.05em] text-ink-400">Current ship-to</div>
          <div className="flex min-w-0 items-center gap-2">
            {!isTyped && <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass(current.deliveryType)}`} />}
            <span className="truncate text-[15px] font-bold text-ink-900">{current.name || "—"}</span>
            {current.isChanged && (
              <span
                className="inline-flex h-4 shrink-0 items-center rounded border border-brand-600 bg-brand-600 px-[5px] text-[9.5px] font-semibold text-white"
                title="Ship-to changed from the bill-to address"
              >
                changed
              </span>
            )}
          </div>
          <div className="mt-[3px] flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-600">
            {current.code && (
              <span className="rounded border border-ink-100 bg-ink-50 px-1.5 font-mono text-[11px]">{current.code}</span>
            )}
            {[current.area, current.deliveryType].filter(Boolean).map((v, i) => (
              <span key={i}>
                {(current.code || i > 0) && "· "}
                {v}
              </span>
            ))}
            {isTyped && billedTo && (
              <span>
                · billed to {billedTo}
                {current.billedToCode && (
                  <span className="ml-1 rounded border border-ink-100 bg-ink-50 px-1.5 font-mono text-[11px]">
                    {current.billedToCode}
                  </span>
                )}
              </span>
            )}
            {copiesLoaded && copies.length > 0 && (
              <span>
                · 📄 {copies.length} {copies.length === 1 ? "copy" : "copies"}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          disabled={!current.isChanged || busy || resetPending}
          onClick={() => {
            setResetPending(true);
            setErr(null);
          }}
          className="shrink-0 whitespace-nowrap rounded-lg border border-ink-100 bg-white px-3 py-[7px] text-[12px] font-semibold text-ink-600 hover:bg-ink-25 disabled:cursor-default disabled:opacity-45"
        >
          ↺ Reset to customer
        </button>
      </div>

      {resetPending ? (
        <div className="mt-[18px] rounded-[10px] border border-ink-100 bg-white px-4 py-3.5 text-[13px] text-ink-700">
          On <b>Save</b>, the ship-to goes back to {billedTo ? <b>{billedTo}</b> : "the customer"}. Any challan copies are
          hidden (the files are kept).
          <button
            type="button"
            disabled={busy}
            onClick={() => setResetPending(false)}
            className="ml-2 font-semibold text-brand-700 hover:underline disabled:opacity-40"
          >
            Undo
          </button>
        </div>
      ) : (
        <>
          {/* ── Tabs ────────────────────────────────────────────────────── */}
          <div className="mt-[18px] flex gap-1 rounded-[10px] bg-ink-50 p-1">
            {(["dealer", "typed"] as const).map((t) => (
              <button
                key={t}
                type="button"
                disabled={busy}
                onClick={() => {
                  setTab(t);
                  setErr(null);
                }}
                className={
                  "flex-1 rounded-lg py-[9px] text-[14px] font-semibold transition-colors " +
                  (tab === t ? "bg-white text-ink-900 shadow-sm" : "text-ink-600 hover:text-ink-900")
                }
              >
                {t === "dealer" ? "Search dealer" : "Type name"}
              </button>
            ))}
          </div>

          {tab === "dealer" ? (
            <>
              <input
                type="text"
                autoFocus
                value={q}
                disabled={busy}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPicked(null);
                }}
                placeholder="Search dealer or site by name or code…"
                className="mt-3.5 w-full rounded-[10px] border border-ink-100 bg-white px-3 py-[11px] text-[16px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 sm:text-[14px]"
              />
              <div className="mt-2 h-[300px] overflow-auto rounded-[10px] border border-ink-100">
                {q.trim().length < 2 ? (
                  <p className="px-3.5 py-3 text-[12px] text-ink-400">Type at least 2 letters of the name or code.</p>
                ) : searching && hits.length === 0 ? (
                  <p className="px-3.5 py-3 text-[12px] text-ink-400">Searching…</p>
                ) : hits.length === 0 ? (
                  <p className="px-3.5 py-3 text-[12px] text-ink-400">No dealers found.</p>
                ) : (
                  hits.map((h) => {
                    const sel = picked?.id === h.id;
                    return (
                      <button
                        key={h.id}
                        type="button"
                        disabled={busy}
                        onClick={() => setPicked(h)}
                        className={
                          "flex w-full items-center gap-3 border-b border-ink-50 px-3.5 py-[11px] text-left last:border-b-0 " +
                          (sel ? "bg-brand-50 shadow-[inset_3px_0_0_#7C3AED]" : "hover:bg-ink-25")
                        }
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-semibold text-ink-900">{smartTitleCase(h.customerName)}</div>
                          {h.customerCode && <span className="font-mono text-[11px] text-ink-600">{h.customerCode}</span>}
                        </div>
                        <div className="shrink-0 text-right text-[12px] text-ink-600">
                          {h.area}
                          {h.deliveryType && (
                            <>
                              <br />
                              {h.deliveryType}
                            </>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="mt-[5px] text-[11px] text-ink-400">
                Dealer not in the list? Use <b>Type name</b>.
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 mt-[18px] block text-[12px] font-semibold text-ink-600">Ship-to name</label>
                  <input
                    type="text"
                    value={asPerChallan ? AS_PER_CHALLAN : text}
                    disabled={asPerChallan || busy}
                    maxLength={MAX_SHIP_TO_TEXT_LEN}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Site / godown name and landmark"
                    className="w-full rounded-[10px] border border-ink-100 bg-white px-3 py-[11px] text-[16px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 disabled:bg-ink-25 sm:text-[14px]"
                  />
                  <div className="mt-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setAsPerChallan((v) => !v)}
                      className={
                        "inline-flex rounded-full border px-[11px] py-[5px] text-[12px] " +
                        (asPerChallan
                          ? "border-brand-600 bg-brand-50 font-semibold text-brand-700"
                          : "border-ink-100 bg-white text-ink-700 hover:bg-ink-25")
                      }
                    >
                      {asPerChallan ? "✓ As per challan" : "As per challan"}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 mt-[18px] block text-[12px] font-semibold text-ink-600">
                    Area <span className="text-danger">*</span>
                  </label>
                  <select
                    value={areaId === "" ? "" : String(areaId)}
                    disabled={busy || areas === null}
                    onChange={(e) => setAreaId(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full rounded-[10px] border border-ink-100 bg-white px-3 py-[11px] text-[16px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 sm:text-[14px]"
                  >
                    <option value="">{areas === null ? "Loading areas…" : "Select area…"}</option>
                    {areaOptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.deliveryType ? ` · ${a.deliveryType}` : ""}
                      </option>
                    ))}
                  </select>
                  <div className="mt-[5px] text-[11px] text-ink-400">{areaHint}</div>
                </div>
              </div>

              <label className="mb-1.5 mt-[18px] block text-[12px] font-semibold text-ink-600">
                Dealer / SO challan copy{" "}
                {asPerChallan ? (
                  <span className="text-danger">* required</span>
                ) : (
                  <span className="font-normal text-ink-400">(optional · up to {MAX_ACTIVE_COPIES} · JPG, PNG, PDF)</span>
                )}
              </label>

              {(keptCopies.length > 0 || newFiles.length > 0) && (
                <div className="mb-2 grid gap-2 sm:grid-cols-3">
                  {keptCopies.map((c, i) => {
                    const removable = c.owner === ownOwner && c.canRemove;
                    return (
                      <div key={c.id} className="flex items-center gap-2 rounded-lg border border-ink-100 px-2.5 py-2">
                        <span>📄</span>
                        <button
                          type="button"
                          onClick={() => void viewCopy(c.id)}
                          className="min-w-0 flex-1 truncate text-left text-[12px] text-brand-700 hover:underline"
                          title={`Open — ${typeLabel(c.contentType)} · ${fmtSize(c.sizeBytes)}${c.uploadedByName ? ` · ${c.uploadedByName}` : ""}`}
                        >
                          Copy {i + 1} · {typeLabel(c.contentType)}
                          {c.owner !== ownOwner && <span className="ml-1 text-ink-400">(Billing)</span>}
                        </button>
                        {removable && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setRemoveIds((prev) => [...prev, c.id])}
                            aria-label="Remove copy"
                            className="shrink-0 text-ink-400 hover:text-ink-700"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {newFiles.map((f, i) => (
                    <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-ink-100 px-2.5 py-2">
                      <span>📄</span>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-ink-900" title={`${f.name} · ${fmtSize(f.size)}`}>
                        {f.name}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setNewFiles((prev) => prev.filter((_, j) => j !== i))}
                        aria-label="Remove file"
                        className="shrink-0 text-ink-400 hover:text-ink-700"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {slotsLeft > 0 && (
                <button
                  type="button"
                  disabled={busy || preparing}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!busy) void addFiles(e.dataTransfer.files);
                  }}
                  className={
                    "block w-full rounded-[10px] border-[1.5px] border-dashed text-center text-[13px] " +
                    (keptCopies.length + newFiles.length > 0 ? "p-3 " : "p-[22px] ") +
                    (asPerChallan && anyCopy === 0
                      ? "border-danger bg-ink-25 text-danger"
                      : "border-ink-100 bg-ink-25 text-ink-600 hover:border-ink-400")
                  }
                >
                  {preparing
                    ? "Preparing…"
                    : asPerChallan && anyCopy === 0
                      ? "📎 Attach the challan to save"
                      : keptCopies.length + newFiles.length > 0
                        ? "📎 Add another"
                        : "📎 Drop files here or tap to choose"}
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files) void addFiles(files);
                  e.target.value = "";
                }}
              />
              {(fileErr || tooBig) && (
                <p className="mt-1.5 text-[12px] font-medium text-danger-text">{tooBig ? COPIES_TOO_BIG_MESSAGE : fileErr}</p>
              )}
            </>
          )}
        </>
      )}

      {/* ON A TRIP — where the bill lands (mockup floor-past-trips tab 5). Shop
          names, never stop numbers: the stops renumber. */}
      {onTrip && preview !== null && !preview.unchanged && (
        <div className="mt-[18px] flex items-start gap-2.5 rounded-[10px] border border-brand-200 bg-white px-3.5 py-[11px] text-[13px] text-ink-700">
          <span aria-hidden className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] bg-brand-50 text-[14px] text-brand-700">
            {preview.joinsExisting || preview.sameStop ? "⇄" : "＋"}
          </span>
          <div>
            <div>
              On trip <b className="font-mono text-ink-900">{preview.tripNumber}</b>:{" "}
              {preview.sameStop ? (
                <>stays with <b className="text-ink-900">{preview.newShop}</b>.</>
              ) : preview.joinsExisting ? (
                <>will join <b className="text-ink-900">{preview.newShop}</b>.</>
              ) : (
                <>will make <b className="text-ink-900">a new stop · {preview.newShop}</b>.</>
              )}
            </div>
            {preview.oldStopCloses && preview.oldShop && (
              <div className="mt-0.5 text-[12px] text-ink-500">
                {preview.oldShop} will have no bills left. Its stop closes and the stops renumber.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-[18px] rounded-[10px] bg-brand-50 px-3 py-2.5 text-[13px] text-brand-700">{scopeLine}</div>

      {previewErr && (
        <div className="mt-3 rounded-[10px] border border-danger-bd bg-danger-bg px-3 py-2.5 text-[13px] font-medium text-danger-text">
          {previewErr}
        </div>
      )}

      {err && (
        <div className="mt-3 rounded-[10px] border border-danger-bd bg-danger-bg px-3 py-2.5 text-[13px] font-medium text-danger-text">
          {err}
        </div>
      )}
    </ModalShell>
  );
}
