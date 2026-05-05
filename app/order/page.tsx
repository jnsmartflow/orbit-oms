"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Send } from "lucide-react";

// Public mobile order form for Sales Officers. Picker UI for customer
// and per-bill SKU/pack qty selection, builds a mailto: link to the
// depot's order inbox. Reachable at /order (whitelisted in middleware).
// Customer + SKU data fetched from /api/order/data on mount.

const ORDER_TO = "surat.order@outlook.com";

// ── Types ────────────────────────────────────────────────────────────────

type Customer = { name: string; code: string };
type Sku      = { name: string; packs: string[] };
type PackQty  = { pack: string; qty: number };
type BillLine = { name: string; packs: PackQty[] };
type Bill = {
  id:           number;
  searchQuery:  string;
  lines:        BillLine[];
  activeSku:    Sku | null;
  packQtys:     Record<string, number>;
};
type Dispatch = "Normal" | "Hold" | "Urgent";
type Marker   = "Truck" | "Cross Delivery" | "DTS" | null;

// ── Component ────────────────────────────────────────────────────────────

export default function OrderPage(): React.JSX.Element {
  // Data
  const [customers,    setCustomers]   = useState<Customer[]>([]);
  const [skus,         setSkus]        = useState<Sku[]>([]);
  const [dataLoading,  setDataLoading] = useState(true);

  // Customer
  const [selectedCust, setSelectedCust] = useState<Customer | null>(null);
  const [custQuery,    setCustQuery]    = useState("");

  // Order-level
  const [dispatch, setDispatch] = useState<Dispatch>("Normal");
  const [marker,   setMarker]   = useState<Marker>(null);

  // Ship to
  const [shipTo,      setShipTo]      = useState("");
  const [shipFocused, setShipFocused] = useState(false);

  // Bills
  const [bills,       setBills]       = useState<Bill[]>([]);
  const [billCounter, setBillCounter] = useState(0);

  // ── Effects ────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/order/data")
      .then((r) => r.json())
      .then((data: { customers?: Customer[]; skus?: Sku[] }) => {
        setCustomers(data.customers ?? []);
        setSkus(data.skus ?? []);
      })
      .catch(() => { /* silent — form still usable, just empty pickers */ })
      .finally(() => setDataLoading(false));
  }, []);

  // Initialise the first bill once data finishes loading.
  useEffect(() => {
    if (!dataLoading && bills.length === 0) addBill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoading]);

  // ── Customer handlers ─────────────────────────────────────────────────

  const custSuggestions = useMemo<Customer[]>(() => {
    if (custQuery.length < 2) return [];
    const q = custQuery.toLowerCase();
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || c.code.includes(q))
      .slice(0, 5);
  }, [custQuery, customers]);

  function selectCustomer(c: Customer): void {
    setSelectedCust(c);
    setCustQuery("");
  }

  function clearCustomer(): void {
    setSelectedCust(null);
    setCustQuery("");
  }

  // ── Ship-to handlers ──────────────────────────────────────────────────

  const shipSuggestions = useMemo<Customer[]>(() => {
    if (shipTo.length < 2) return [];
    const q = shipTo.toLowerCase();
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || c.code.includes(q))
      .slice(0, 5);
  }, [shipTo, customers]);

  function selectShipTo(c: Customer): void {
    setShipTo(`${c.name} (${c.code})`);
    setShipFocused(false);
  }

  // ── Bill handlers ─────────────────────────────────────────────────────

  function addBill(): void {
    const id = billCounter + 1;
    setBillCounter(id);
    setBills((prev) => [
      ...prev,
      { id, searchQuery: "", lines: [], activeSku: null, packQtys: {} },
    ]);
  }

  function removeBill(billId: number): void {
    setBills((prev) => prev.filter((b) => b.id !== billId));
  }

  function setBillQuery(billId: number, q: string): void {
    setBills((prev) => prev.map((b) => (b.id === billId ? { ...b, searchQuery: q } : b)));
  }

  function pickSku(billId: number, sku: Sku): void {
    const packQtys: Record<string, number> = {};
    for (const p of sku.packs) packQtys[p] = 0;
    setBills((prev) => prev.map((b) =>
      b.id === billId ? { ...b, activeSku: sku, packQtys, searchQuery: "" } : b,
    ));
  }

  function clearActiveSku(billId: number): void {
    setBills((prev) => prev.map((b) =>
      b.id === billId ? { ...b, activeSku: null, packQtys: {} } : b,
    ));
  }

  function stepPack(billId: number, pack: string, delta: number): void {
    setBills((prev) => prev.map((b) => {
      if (b.id !== billId) return b;
      const cur  = b.packQtys[pack] ?? 0;
      const next = Math.max(0, cur + delta);
      return { ...b, packQtys: { ...b.packQtys, [pack]: next } };
    }));
  }

  function setPack(billId: number, pack: string, raw: string): void {
    const parsed = parseInt(raw, 10);
    const qty    = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    setBills((prev) => prev.map((b) => {
      if (b.id !== billId) return b;
      return { ...b, packQtys: { ...b.packQtys, [pack]: qty } };
    }));
  }

  function addToBill(billId: number): void {
    setBills((prev) => prev.map((b) => {
      if (b.id !== billId || !b.activeSku) return b;
      const skuName = b.activeSku.name;
      const packs = b.activeSku.packs
        .filter((p) => (b.packQtys[p] ?? 0) > 0)
        .map((p) => ({ pack: p, qty: b.packQtys[p] }));
      if (packs.length === 0) return b;

      // Replace any existing line for this SKU within this bill.
      const filtered = b.lines.filter((l) => l.name !== skuName);
      const newLine: BillLine = { name: skuName, packs };
      return { ...b, lines: [...filtered, newLine], activeSku: null, packQtys: {} };
    }));
  }

  function deleteLineFromBill(billId: number, idx: number): void {
    setBills((prev) => prev.map((b) => {
      if (b.id !== billId) return b;
      return { ...b, lines: b.lines.filter((_, i) => i !== idx) };
    }));
  }

  function getSkuSuggestions(query: string): Sku[] {
    if (query.length < 2) return [];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return skus
      .filter((s) => words.every((w) => s.name.toLowerCase().includes(w)))
      .slice(0, 5);
  }

  // ── Email build ───────────────────────────────────────────────────────

  function buildEmail(): { subject: string; body: string; valid: boolean } {
    const name = selectedCust?.name ?? "";
    const code = selectedCust?.code ?? "";
    const lines: string[] = [];

    if (name || code) {
      const customerLine = name && code ? `${name} (${code})` : (name || code);
      lines.push("Customer: " + customerLine);
    }
    if (dispatch !== "Normal") lines.push("Dispatch: " + dispatch);
    if (marker)                lines.push("Marker: "   + marker);
    if (shipTo.trim())         lines.push("Ship To: "  + shipTo.trim());

    const activeBills = bills.filter((b) => b.lines.length > 0);
    activeBills.forEach((b) => {
      lines.push("");
      if (activeBills.length > 1) lines.push("Bill " + b.id);
      b.lines.forEach((l) => {
        const packStr = l.packs.map((p) => `${p.pack}*${p.qty}`).join(", ");
        lines.push(`${l.name} ${packStr}`);
      });
    });

    const subject = "Order"
      + (name ? ` — ${name}` : "")
      + (code ? ` ${code}`    : "");
    const valid   = !!selectedCust && activeBills.length > 0;

    return { subject, body: lines.join("\n"), valid };
  }

  const { subject, body, valid: canSend } = buildEmail();

  function handleSend(): void {
    if (!canSend) return;
    const url = `mailto:${ORDER_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-[#f2f2f7] pb-12">

      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100">
        <div className="max-w-[480px] mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-[34px] h-[34px] bg-teal-600 rounded-[9px] flex items-center justify-center flex-shrink-0">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="7" stroke="white" strokeWidth="1.6" />
              <circle cx="11" cy="11" r="2.2" fill="white" />
              <circle cx="18" cy="11" r="2" fill="white" />
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="text-[16px] font-semibold text-gray-900 leading-tight">Place Order</span>
            <span className="text-[11px] text-gray-400 leading-tight">JSW Dulux · Surat Depot</span>
          </div>
        </div>
      </div>

      <div className="max-w-[480px] mx-auto">

        {/* Customer */}
        <Section title="Customer">
          {dataLoading ? (
            <div className="flex items-center gap-2.5 px-4 py-3">
              <Search className="w-4 h-4 text-gray-300 shrink-0" />
              <input
                disabled
                placeholder="Loading customers…"
                className="flex-1 text-[16px] bg-transparent border-none outline-none placeholder:text-gray-300"
              />
            </div>
          ) : selectedCust ? (
            <div className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0 pr-3">
                <p className="text-[15px] font-semibold text-gray-900 truncate">{selectedCust.name}</p>
                <p className="text-[12px] text-gray-400 font-mono mt-0.5">{selectedCust.code}</p>
              </div>
              <button
                type="button"
                onClick={clearCustomer}
                className="text-[13px] text-teal-600 font-medium shrink-0"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 px-4 py-3">
                <Search className="w-4 h-4 text-gray-300 shrink-0" />
                <input
                  type="text"
                  value={custQuery}
                  onChange={(e) => setCustQuery(e.target.value)}
                  placeholder="Name or customer code…"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="flex-1 text-[16px] text-gray-900 bg-transparent border-none outline-none placeholder:text-gray-300"
                />
                {custQuery && (
                  <button
                    type="button"
                    onClick={() => setCustQuery("")}
                    className="text-gray-300 text-lg leading-none px-1"
                    aria-label="Clear"
                  >
                    ×
                  </button>
                )}
              </div>
              {custSuggestions.length > 0 && (
                <div className="border-t border-gray-100">
                  {custSuggestions.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => selectCustomer(c)}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left border-b border-gray-50 last:border-b-0 active:bg-gray-50"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-teal-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] text-gray-900 truncate">{c.name}</p>
                        <p className="text-[12px] text-gray-400 font-mono mt-0.5">{c.code}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </Section>

        {/* Products / Bills */}
        <div className="mx-[14px] mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2 pl-0.5">
            Products
          </p>
          <div className="flex flex-col gap-[10px]">
            {bills.map((b) => (
              <BillCard
                key={b.id}
                bill={b}
                dataLoading={dataLoading}
                getSkuSuggestions={getSkuSuggestions}
                onRemove={() => removeBill(b.id)}
                onSetQuery={(q) => setBillQuery(b.id, q)}
                onPickSku={(sku) => pickSku(b.id, sku)}
                onClearActiveSku={() => clearActiveSku(b.id)}
                onStepPack={(pack, delta) => stepPack(b.id, pack, delta)}
                onSetPack={(pack, raw) => setPack(b.id, pack, raw)}
                onAddToBill={() => addToBill(b.id)}
                onDeleteLine={(idx) => deleteLineFromBill(b.id, idx)}
              />
            ))}
            <button
              type="button"
              onClick={addBill}
              className="w-full h-11 mt-2 bg-white border-[1.5px] border-dashed border-gray-300 rounded-[14px] text-[14px] font-medium text-gray-400 active:bg-gray-50"
            >
              + Add Bill
            </button>
          </div>
        </div>

        {/* Ship To */}
        <Section title="Ship To">
          <div className="flex items-center gap-2.5 px-4 py-3">
            <Search className="w-4 h-4 text-gray-300 shrink-0" />
            <input
              type="text"
              value={shipTo}
              onChange={(e) => setShipTo(e.target.value)}
              onFocus={() => setShipFocused(true)}
              onBlur={() => setTimeout(() => setShipFocused(false), 150)}
              placeholder="Site name or alternate delivery address"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="flex-1 text-[16px] text-gray-900 bg-transparent border-none outline-none placeholder:text-gray-300"
            />
            {shipTo && (
              <button
                type="button"
                onClick={() => setShipTo("")}
                className="text-gray-300 text-lg leading-none px-1"
                aria-label="Clear"
              >
                ×
              </button>
            )}
          </div>
          {shipFocused && shipSuggestions.length > 0 && (
            <div className="border-t border-gray-100">
              {shipSuggestions.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectShipTo(c)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left border-b border-gray-50 last:border-b-0 active:bg-gray-50"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-teal-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-gray-900 truncate">{c.name}</p>
                    <p className="text-[12px] text-gray-400 font-mono mt-0.5">{c.code}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Section>

        {/* Dispatch */}
        <Section title="Dispatch">
          <div className="grid grid-cols-3 gap-2 p-3">
            <DispatchChip
              label="Normal"
              dotCls="bg-teal-500"
              selected={dispatch === "Normal"}
              selectedCls="border-teal-500 bg-teal-50 text-teal-700 font-semibold"
              onClick={() => setDispatch("Normal")}
            />
            <DispatchChip
              label="Hold"
              dotCls="bg-red-400"
              selected={dispatch === "Hold"}
              selectedCls="border-red-300 bg-red-50 text-red-700 font-semibold"
              onClick={() => setDispatch("Hold")}
            />
            <DispatchChip
              label="Urgent"
              dotCls="bg-amber-400"
              selected={dispatch === "Urgent"}
              selectedCls="border-amber-300 bg-amber-50 text-amber-700 font-semibold"
              onClick={() => setDispatch("Urgent")}
            />
          </div>
        </Section>

        {/* Order Marker */}
        <div className="mx-[14px] mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2 pl-0.5">
            Order Marker <span className="text-gray-300 font-normal normal-case tracking-normal">· optional</span>
          </p>
          <div className="bg-white rounded-[14px] overflow-hidden shadow-sm border border-gray-100">
            <div className="grid grid-cols-3 gap-2 p-3">
              <MarkerChip
                label="🚛 Truck"
                selected={marker === "Truck"}
                onClick={() => setMarker(marker === "Truck" ? null : "Truck")}
              />
              <MarkerChip
                label="🔄 Cross"
                selected={marker === "Cross Delivery"}
                onClick={() => setMarker(marker === "Cross Delivery" ? null : "Cross Delivery")}
              />
              <MarkerChip
                label="📦 DTS"
                selected={marker === "DTS"}
                onClick={() => setMarker(marker === "DTS" ? null : "DTS")}
              />
            </div>
          </div>
        </div>

        {/* Preview */}
        <Section title="Preview">
          <PreviewRow label="To" value={ORDER_TO} />
          <PreviewRow
            label="Subject"
            value={selectedCust ? subject : ""}
            placeholder="Subject will appear here"
          />
          <PreviewRow
            label="Body"
            value={body}
            placeholder="Body will appear here"
            isLast
          />
        </Section>

        {/* Send */}
        <div className="mx-[14px] mt-6">
          <button
            type="button"
            disabled={!canSend}
            onClick={handleSend}
            className={`w-full h-[52px] rounded-[14px] text-[16px] font-semibold flex items-center justify-center gap-2 transition-colors ${
              canSend
                ? "bg-teal-600 hover:bg-teal-700 text-white"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            <Send className="w-[17px] h-[17px]" />
            Send Order
          </button>
          <p className="text-center text-[12px] text-gray-400 mt-2">
            Opens your mail app · ready to send
          </p>
        </div>

      </div>
    </main>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title:    string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mx-[14px] mt-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2 pl-0.5">
        {title}
      </p>
      <div className="bg-white rounded-[14px] overflow-hidden shadow-sm border border-gray-100">
        {children}
      </div>
    </div>
  );
}

function DispatchChip({
  label, dotCls, selected, selectedCls, onClick,
}: {
  label:       string;
  dotCls:      string;
  selected:    boolean;
  selectedCls: string;
  onClick:     () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-[44px] rounded-[10px] border text-[14px] flex items-center justify-center gap-1.5 transition-colors ${
        selected ? selectedCls : "border-gray-200 bg-white text-gray-400 font-medium"
      }`}
    >
      <span className={`w-[7px] h-[7px] rounded-full ${dotCls}`} />
      <span>{label}</span>
    </button>
  );
}

function MarkerChip({
  label, selected, onClick,
}: {
  label:    string;
  selected: boolean;
  onClick:  () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-[44px] rounded-[10px] border text-[13px] flex items-center justify-center transition-colors ${
        selected
          ? "border-indigo-300 bg-indigo-50 text-indigo-700 font-semibold"
          : "border-gray-200 bg-white text-gray-400 font-medium"
      }`}
    >
      {label}
    </button>
  );
}

function PreviewRow({
  label, value, placeholder, isLast,
}: {
  label:        string;
  value:        string;
  placeholder?: string;
  isLast?:      boolean;
}): React.JSX.Element {
  const hasValue = value.length > 0;
  return (
    <div className={`flex gap-2.5 px-4 py-2.5 items-start ${isLast ? "" : "border-b border-gray-100"}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-300 w-[52px] shrink-0 pt-0.5">
        {label}
      </span>
      {hasValue ? (
        <span className="text-[13px] text-gray-900 font-mono flex-1 whitespace-pre-wrap break-words">
          {value}
        </span>
      ) : (
        <span className="text-[13px] text-gray-300 italic font-mono flex-1">
          {placeholder ?? ""}
        </span>
      )}
    </div>
  );
}

// ── Bill card ────────────────────────────────────────────────────────────

interface BillCardProps {
  bill:              Bill;
  dataLoading:       boolean;
  getSkuSuggestions: (query: string) => Sku[];
  onRemove:          () => void;
  onSetQuery:        (q: string) => void;
  onPickSku:         (sku: Sku) => void;
  onClearActiveSku:  () => void;
  onStepPack:        (pack: string, delta: number) => void;
  onSetPack:         (pack: string, raw: string) => void;
  onAddToBill:       () => void;
  onDeleteLine:      (idx: number) => void;
}

function BillCard({
  bill, dataLoading, getSkuSuggestions, onRemove, onSetQuery,
  onPickSku, onClearActiveSku, onStepPack, onSetPack, onAddToBill, onDeleteLine,
}: BillCardProps): React.JSX.Element {
  const suggestions = getSkuSuggestions(bill.searchQuery);
  const hasAnyQty   = Object.values(bill.packQtys).some((q) => q > 0);

  return (
    <div className="bg-white rounded-[14px] overflow-hidden shadow-sm border border-gray-100">

      {/* Bill header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50/40">
        <span className="text-[13px] font-semibold uppercase tracking-wide text-teal-600">
          Bill {bill.id}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="text-gray-300 text-xl leading-none px-1"
          aria-label="Remove bill"
        >
          ×
        </button>
      </div>

      {/* Active SKU area */}
      {bill.activeSku ? (
        <>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <p className="text-[15px] font-semibold text-gray-900 truncate pr-3">
              {bill.activeSku.name}
            </p>
            <button
              type="button"
              onClick={onClearActiveSku}
              className="text-[13px] text-teal-600 font-medium shrink-0"
            >
              Change
            </button>
          </div>

          {/* Pack counters */}
          {bill.activeSku.packs.map((pack) => (
            <div key={pack} className="flex items-center px-4 py-2.5 border-b border-gray-50">
              <div className="flex-1">
                <p className="text-[16px] font-medium text-gray-900">{pack}</p>
              </div>
              <div className="flex items-center bg-gray-100 rounded-[10px] overflow-hidden">
                <button
                  type="button"
                  onClick={() => onStepPack(pack, -1)}
                  className="w-10 h-10 flex items-center justify-center text-[22px] font-light text-teal-600 active:bg-gray-200"
                  aria-label={`Decrease ${pack}`}
                >
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  value={bill.packQtys[pack] ?? 0}
                  onChange={(e) => onSetPack(pack, e.target.value)}
                  onFocus={(e) => e.target.select()}
                  className="w-12 text-center text-[16px] font-semibold text-gray-900 bg-transparent border-none outline-none"
                />
                <button
                  type="button"
                  onClick={() => onStepPack(pack, 1)}
                  className="w-10 h-10 flex items-center justify-center text-[22px] font-light text-teal-600 active:bg-gray-200"
                  aria-label={`Increase ${pack}`}
                >
                  +
                </button>
              </div>
            </div>
          ))}

          {/* Add to bill button — only when at least one pack has qty > 0 */}
          {hasAnyQty && (
            <div className="px-4 py-3 border-t border-gray-100">
              <button
                type="button"
                onClick={onAddToBill}
                className="w-full h-11 bg-teal-600 hover:bg-teal-700 text-white rounded-[10px] text-[15px] font-semibold"
              >
                + Add to Bill {bill.id}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Search input */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-100">
            <Search className="w-4 h-4 text-gray-300 shrink-0" />
            <input
              type="text"
              disabled={dataLoading}
              value={bill.searchQuery}
              onChange={(e) => onSetQuery(e.target.value)}
              placeholder={dataLoading ? "Loading products…" : "Search product…"}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="flex-1 text-[16px] text-gray-900 bg-transparent border-none outline-none placeholder:text-gray-300 disabled:opacity-60"
            />
            {bill.searchQuery && (
              <button
                type="button"
                onClick={() => onSetQuery("")}
                className="text-gray-300 text-lg leading-none px-1"
                aria-label="Clear"
              >
                ×
              </button>
            )}
          </div>

          {/* SKU suggestions */}
          {suggestions.length > 0 && (
            <div>
              {suggestions.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => onPickSku(s)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left border-b border-gray-50 last:border-b-0 active:bg-gray-50"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-teal-600 shrink-0" />
                  <p className="text-[14px] text-gray-900 truncate flex-1">{s.name}</p>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Added lines list */}
      <div>
        {bill.lines.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-gray-300 italic text-center">
            No products added
          </p>
        ) : (
          bill.lines.map((line, idx) => (
            <div
              key={`${line.name}-${idx}`}
              className="flex items-center px-4 py-2.5 border-b border-gray-50 last:border-b-0"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-teal-600 shrink-0 mr-3" />
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium text-gray-900 truncate">{line.name}</p>
                <p className="text-[13px] text-teal-600 font-mono mt-0.5">
                  {line.packs.map((p) => `${p.pack}*${p.qty}`).join(", ")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDeleteLine(idx)}
                className="text-gray-300 text-xl ml-2 leading-none px-1"
                aria-label="Delete line"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

    </div>
  );
}
