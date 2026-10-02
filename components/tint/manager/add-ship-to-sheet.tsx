"use client";

// components/tint/manager/add-ship-to-sheet.tsx — the Tint Manager's one-page
// "Add ship-to" form (2026-10-02, docs/mockups/tint-manager/
// tint-manager-add-shipto-form-mockup.html).
//
// Replaces CustomerMissingSheet on the Tint Manager (the "+ Add Ship to" tag,
// the nudge's "Add now" and the Assign / Base — No Tint interceptor). Saves
// through POST /api/tint/manager/ship-to/create, which runs the SAME customer
// create as the admin page (lib/customers/create-customer.ts) and adds the
// order-entry keyword row. The PAGE shows the one success toast.
//
//   1 Ship-to (from SAP)   code (read-only) · name (editable) · near-duplicate note
//   2 Site address & area  address (optional) · area (required, type-to-search)
//   3 Contacts             sales person (required, type-to-search + details card)
//                          receivers: name + optional phone, add / remove rows

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MIN_ADDRESS, PHONE_HINT, SO_NO_PHONE, firstShipToProblem, checkReceivers, normalizeMobile } from "@/lib/customers/ship-to-rules";

export interface AddShipToResult {
  customerCode: string;
  customerName: string;
  /** Orders the save re-linked (customerMissing → false). */
  billsUpdated: number;
  warnings:     string[];
}

interface AreaOpt { id: number; name: string }
interface SoOpt { id: number; name: string; employeeCode: string; phone: string | null; email: string | null }
interface Similar { id: number; customerCode: string; customerName: string; area: string }
interface Receiver { key: string; name: string; phone: string }

const newReceiver = (): Receiver => ({ key: `${Date.now()}-${Math.random()}`, name: "", phone: "" });

export function AddShipToSheet({
  open,
  onOpenChange,
  shipToCode,
  shipToName,
  warningMessage,
  onSaved,
}: {
  open:           boolean;
  onOpenChange:   (open: boolean) => void;
  shipToCode:     string | null | undefined;
  shipToName:     string | null | undefined;
  /** The Assign / Base — No Tint interceptor's reason, shown as one amber line. */
  warningMessage?: string;
  onSaved:        (result: AddShipToResult) => void;
}) {
  const [areas, setAreas] = useState<AreaOpt[]>([]);
  const [sos, setSos] = useState<SoOpt[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [area, setArea] = useState<AreaOpt | null>(null);
  const [so, setSo] = useState<SoOpt | null>(null);
  const [receivers, setReceivers] = useState<Receiver[]>([newReceiver()]);
  const [similar, setSimilar] = useState<Similar[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset + load the lists each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setName(shipToName ?? "");
    setAddress("");
    setArea(null);
    setSo(null);
    setReceivers([newReceiver()]);
    setSimilar(null);
    setError(null);
    setSaving(false);
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/tint/manager/ship-to/options", { cache: "no-store" });
        if (!res.ok) throw new Error(res.status === 403 ? "No permission to add customers" : `HTTP ${res.status}`);
        const data = (await res.json()) as { areas: AreaOpt[]; salesOfficers: SoOpt[] };
        if (!live) return;
        setAreas(data.areas ?? []);
        setSos(data.salesOfficers ?? []);
        setLoadErr(null);
      } catch (e) {
        if (live) setLoadErr(e instanceof Error ? e.message : "Could not load areas");
      }
    })();
    return () => { live = false; };
  }, [open, shipToName]);

  // Near-duplicate note — debounced, info only.
  useEffect(() => {
    if (!open) return;
    const q = name.trim();
    if (q.length < 3) { setSimilar([]); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/tint/manager/ship-to/options?similar=${encodeURIComponent(q)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { similar: Similar[] };
        if (live) setSimilar(data.similar ?? []);
      } catch { /* the note is optional */ }
    }, 400);
    return () => { live = false; window.clearTimeout(t); };
  }, [open, name]);

  // EVERY FIELD IS MANDATORY (2026-10-02) — lib/customers/ship-to-rules.ts, the
  // same rules the create route enforces. The footer names the first problem.
  const receiverRows = checkReceivers(receivers).rows;
  const problem = firstShipToProblem({
    name, address, hasArea: !!area, hasSo: !!so, soPhone: so?.phone, receivers,
  });
  const soNoPhone = !!so && (!so.phone || so.phone.trim() === "");
  const canSave = problem === null && !saving && !!shipToCode;
  const footerMsg = problem ?? "Saves to customer master + order-entry search.";

  const save = useCallback(async () => {
    if (!canSave || !area || !so || !shipToCode) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/tint/manager/ship-to/create", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          customerCode:   shipToCode,
          customerName:   name.trim(),
          address:        address.trim() || null,
          areaId:         area.id,
          salesOfficerId: so.id,
          receivers:      receiverRows.map((r) => ({ name: r.name, phone: r.phone })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<AddShipToResult> & { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Save failed (HTTP ${res.status})`);
        return;
      }
      onSaved({
        customerCode: data.customerCode ?? shipToCode,
        customerName: data.customerName ?? name.trim(),
        billsUpdated: data.billsUpdated ?? 0,
        warnings:     data.warnings ?? [],
      });
    } catch {
      setError("Network error — nothing was saved.");
    } finally {
      setSaving(false);
    }
  }, [canSave, area, so, shipToCode, name, address, receiverRows, onSaved]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-[rgba(27,24,38,0.32)]" onClick={() => !saving && onOpenChange(false)} />
      <div
        className="absolute inset-y-0 right-0 flex w-[560px] max-w-full flex-col bg-white shadow-[-16px_0_40px_rgba(27,24,38,0.16)]"
        role="dialog"
        aria-label="Add ship-to"
        onKeyDown={(e) => { if (e.key === "Escape" && !saving) { e.stopPropagation(); onOpenChange(false); } }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-ink-100 px-[22px] pb-3.5 pt-[18px]">
          <div>
            <h2 className="m-0 text-[17px] font-bold tracking-[-0.01em] text-ink-900">Add ship-to</h2>
            <p className="mt-[3px] text-[12.5px] text-ink-500">Not in the customer master yet. Save once — every bill to this ship-to is fixed.</p>
            {warningMessage && <p className="mt-1.5 text-[12px] font-semibold text-warn-text">{warningMessage}</p>}
          </div>
          <button type="button" onClick={() => onOpenChange(false)} disabled={saving} className="ml-auto text-ink-400 hover:text-ink-900" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-4 overflow-auto px-[22px] pb-5 pt-4">
          {loadErr && <p className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">{loadErr}</p>}

          {/* 1 — Ship-to */}
          <Group n={1} title="Ship-to (from SAP)">
            <div className="grid grid-cols-[150px_1fr] gap-3">
              <Field label="Code">
                <input className={cn(INPUT, "font-mono text-[12px]")} readOnly value={shipToCode ?? ""} />
              </Field>
              <Field label="Name" hint="edit only if SAP spelling is wrong">
                <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
              </Field>
            </div>
            <div className={cn(
              "rounded-lg px-3 py-2 text-[12px]",
              similar && similar.length > 0 ? "border border-[#FDE68A] bg-warn-bg text-warn-text" : "bg-ink-25 text-ink-500",
            )}>
              {similar === null ? "Checking the master for similar names…"
                : similar.length === 0 ? "No similar name in master."
                : (
                  <>
                    <b className="font-semibold">Similar name{similar.length > 1 ? "s" : ""} already in master</b> — check it isn&apos;t the same site:
                    <ul className="mt-1 space-y-0.5">
                      {similar.map((s) => (
                        <li key={s.id}><span className="font-mono text-[11px]">{s.customerCode}</span> · {s.customerName} <span className="text-ink-400">· {s.area}</span></li>
                      ))}
                    </ul>
                  </>
                )}
            </div>
          </Group>

          {/* 2 — Address & area */}
          <Group n={2} title="Site address & area">
            <Field label="Site address" hint="for the challan & driver" required>
              <textarea
                className={cn(INPUT, "h-[68px] resize-none py-2 leading-[1.4]")}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                maxLength={500}
                placeholder={"Building / plot, road, landmark\ne.g. Akshay Group site, Opp. Star Bazaar, Pal Road"}
              />
              {address.trim() !== "" && address.trim().length < MIN_ADDRESS && (
                <p className="mt-1 text-[11.5px] text-red-600">At least {MIN_ADDRESS} characters — building, road, landmark.</p>
              )}
            </Field>
            <Field label="Area" required>
              <Combo<AreaOpt>
                options={areas}
                value={area}
                onPick={setArea}
                text={(a) => a.name}
                placeholder="Type area — e.g. Adajan, Pal, Vapi…"
                empty="No area matches — ask admin to add it"
              />
            </Field>
          </Group>

          {/* 3 — Contacts */}
          <Group n={3} title="Contacts">
            <Field label="Sales person" required>
              <Combo<SoOpt>
                options={sos}
                value={so}
                onPick={setSo}
                text={(s) => s.name}
                sub={(s) => s.phone ?? ""}
                placeholder="Search sales officer…"
                empty="No sales officer matches"
              />
              {so && (
                <div className={cn(
                  "mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-[10px] border px-3 py-2.5",
                  soNoPhone ? "border-red-200 bg-red-50" : "border-ink-100 bg-ink-25",
                )}>
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-[12px] font-bold text-brand-700">
                    {so.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <b className="block truncate text-[13px] text-ink-900">{so.name}</b>
                    {soNoPhone ? (
                      // Mandatory: the challan prints his phone. The form never edits the SO master.
                      <span className="block text-[12px] font-semibold text-red-600">{SO_NO_PHONE}</span>
                    ) : (
                      <span className="block truncate text-[12px] text-ink-500">
                        {[so.phone, so.email].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </div>
                  <em className="rounded-[5px] bg-ok-bg px-[7px] py-0.5 text-[11px] font-semibold not-italic text-ok-text">Primary</em>
                </div>
              )}
            </Field>
            <Field label="Receiver at site" hint="who takes the delivery" required>
              {receivers.map((r, i) => {
                // Red only once something is typed (a fully empty row is just "missing").
                const nameBad = r.name.trim() !== "" && r.name.trim().length < 2;
                const phoneBad = r.phone.trim() !== "" && normalizeMobile(r.phone) === null;
                const partly = i > 0 && (r.name.trim() !== "") !== (r.phone.trim() !== "");
                return (
                <div key={r.key} className="mb-2">
                <div className="grid grid-cols-[1fr_170px_30px] items-center gap-2">
                  <input
                    className={cn(INPUT, (nameBad || (partly && r.name.trim() === "")) && "border-red-400")}
                    value={r.name}
                    placeholder={i === 0 ? "Receiver name" : "Another receiver"}
                    maxLength={100}
                    onChange={(e) => setReceivers((list) => list.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))}
                  />
                  <input
                    className={cn(INPUT, (phoneBad || (partly && r.phone.trim() === "")) && "border-red-400")}
                    value={r.phone}
                    placeholder="Mobile"
                    inputMode="tel"
                    maxLength={30}
                    onChange={(e) => setReceivers((list) => list.map((x) => (x.key === r.key ? { ...x, phone: e.target.value } : x)))}
                  />
                  {/* The first row is the main receiver — it has no ✕. */}
                  {i === 0 ? <span /> : (
                    <button
                      type="button"
                      className="h-[38px] text-[15px] text-ink-400 hover:text-red-600"
                      title="Remove this receiver"
                      onClick={() => setReceivers((list) => list.filter((x) => x.key !== r.key))}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {(nameBad || phoneBad) && (
                  <p className="mt-1 text-[11.5px] text-red-600">
                    {[nameBad ? "Name needs at least 2 characters" : null, phoneBad ? PHONE_HINT : null].filter(Boolean).join(" · ")}
                  </p>
                )}
                </div>
                );
              })}
              <button
                type="button"
                onClick={() => setReceivers((list) => [...list, newReceiver()])}
                className="text-[12.5px] font-semibold text-brand-700 hover:underline"
              >
                + Add another receiver
              </button>
            </Field>
          </Group>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-ink-100 px-[22px] py-3.5">
          <div className={cn("mr-auto text-[12px]", error ? "font-semibold text-red-600" : "text-ink-500")}>{error ?? footerMsg}</div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="h-[34px] rounded-lg border border-ink-200 bg-white px-3.5 text-[12.5px] font-semibold text-ink-700 hover:bg-ink-25"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { void save(); }}
            disabled={!canSave}
            className="h-[34px] rounded-lg bg-ink-900 px-3.5 text-[12.5px] font-semibold text-white hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save ship-to"}
          </button>
        </div>
      </div>
    </div>
  );
}

const INPUT =
  "w-full h-[38px] rounded-[9px] border border-ink-200 bg-white px-3 text-[13px] text-ink-900 outline-none " +
  "focus:border-brand-600 focus:shadow-[0_0_0_3px_theme(colors.brand.100)] read-only:bg-ink-25 read-only:text-ink-600";

function Group({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-400 after:h-px after:flex-1 after:bg-ink-100">
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-brand-600 text-[10.5px] text-white">{n}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 flex justify-between text-[12px] font-semibold text-ink-700">
        <span>{label}</span>
        <span className="flex items-center gap-2">
          {hint && <em className="font-medium not-italic text-ink-400">{hint}</em>}
          {required && <span className="font-medium text-[#E11D48]">required</span>}
        </span>
      </label>
      {children}
    </div>
  );
}

/** Type-to-search picker: ↑ ↓ to move, Enter to pick, Esc to close. */
function Combo<T extends { id: number }>({
  options, value, onPick, text, sub, placeholder, empty,
}: {
  options: T[];
  value: T | null;
  onPick: (v: T | null) => void;
  text: (v: T) => string;
  sub?: (v: T) => string;
  placeholder: string;
  empty: string;
}) {
  const [q, setQ] = useState(value ? text(value) : "");
  const [openList, setOpenList] = useState(false);
  const [k, setK] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Re-sync the box only when the PICKED value changes (`text` is an inline fn).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setQ(value ? text(value) : ""); }, [value]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hits = !s || (value && text(value).toLowerCase() === s)
      ? options
      : options.filter((o) => text(o).toLowerCase().includes(s));
    return hits.slice(0, 8);
  }, [q, options, value, text]);

  const pick = (o: T) => { onPick(o); setQ(text(o)); setOpenList(false); };

  const hl = (s: string) => {
    const t = q.trim();
    const i = t ? s.toLowerCase().indexOf(t.toLowerCase()) : -1;
    if (i < 0 || (value && text(value) === q)) return s;
    return <>{s.slice(0, i)}<mark className="rounded-[2px] bg-[#FEF3C7] text-inherit">{s.slice(i, i + t.length)}</mark>{s.slice(i + t.length)}</>;
  };

  return (
    <div className="relative">
      <input
        className={cn(INPUT, value && "border-ok")}
        value={q}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => { setK(0); setOpenList(true); }}
        onBlur={() => window.setTimeout(() => setOpenList(false), 120)}
        onChange={(e) => { setQ(e.target.value); setK(0); setOpenList(true); if (value) onPick(null); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpenList(true); setK((x) => Math.min(x + 1, list.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setK((x) => Math.max(x - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (openList && list[k]) pick(list[k]); }
          else if (e.key === "Escape" && openList) { e.stopPropagation(); setOpenList(false); }
        }}
      />
      {openList && (
        <div ref={listRef} className="absolute left-0 right-0 top-[42px] z-10 overflow-hidden rounded-[10px] border border-ink-100 bg-white shadow-[0_14px_30px_rgba(27,24,38,0.14)]">
          {list.length === 0 ? (
            <div className="px-3 py-2.5 text-[12px] text-ink-400">{empty}</div>
          ) : list.map((o, i) => (
            <div
              key={o.id}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setK(i)}
              className={cn("grid cursor-pointer grid-cols-[1fr_auto] items-center gap-2.5 px-3 py-[9px]", i === k && "bg-brand-50")}
            >
              <b className="truncate text-[13px] font-semibold text-ink-900">{hl(text(o))}</b>
              {sub && <span className="text-[11.5px] text-ink-500">{sub(o)}</span>}
            </div>
          ))}
          <div className="border-t border-ink-100 px-3 py-[7px] text-[11px] text-ink-400">↑ ↓ · Enter to pick</div>
        </div>
      )}
    </div>
  );
}
