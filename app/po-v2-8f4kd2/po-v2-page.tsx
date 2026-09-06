"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, ChevronRight, Eraser, FileText, Home, MapPin, Send, Users, X } from "lucide-react";
import ProductDrawer from "./product-drawer";
import V2Sheet from "./v2-sheet";
import { CustomerListBody, CustomerSearchInput } from "./customer-list";
import { MIN_QUERY, ProductResults, ProductSearchInput, type V2ProductGroup } from "./product-search";
import ReviewScreen from "./review-screen";
import { buildV2Email, buildV2MailtoUrl } from "./v2-email";
import { DraftsScreen, SentScreen } from "./drafts-sent";
import {
  addSentOrder, clearLiveDraft, labelFor, loadLiveDraft, loadSavedDrafts,
  loadSentOrders, newDraftId, newSentId, removeSavedDraft, formatSavedAt, formatTime,
  loadFavs, toggleFav, type V2Fav,
  saveLiveDraft, snapshotOf, upsertSavedDraft,
  type V2SavedDraft, type V2SentOrder, type V2Snapshot,
} from "./v2-storage";
import {
  DIVIDER, FAMILIES, INK, MONO_BG, RULE, VIOLET, VIOLET_BG,
  EMPTY_ORDER, addRecent, buildCatalog, drawerMode, formatPack, loadRecents, monogram,
  optionPools, packRows, resolveGroup, unitsIn,
  type ApiCustomer, type ApiPayload, type ApiProduct,
  type V2CartLine, type V2Order, type V2Recent, type V2Resolved, type V2Tile,
} from "./v2-data";

// Hidden v2 salesman order page — the whole app, on one route.
//
// 🔴 CONTAINMENT — imports its own siblings, node_modules, and (the one
// documented exception) lib/place-order's email + ranking helpers, read-only.
// Nothing outside app/po-v2-8f4kd2/ is modified. Every colour is an inline
// style, so globals.css and tailwind.config.ts stay untouched.
//
// SIX SCREENS, ONE URL: dealer list, board, review, sent-confirmation, saved
// drafts, sent-today. All switched by state, not routing, so the fetched
// catalog and the order survive every switch with no store and no reload.
//
// PERSISTENCE lives in ./v2-storage under po2_* keys ONLY. v2 never touches a
// po_* or orbitoms_* key — sharing a slot with /po would mean two independent
// order books silently eating each other's drafts.
//
// NO HORIZONTAL SCROLL, met structurally rather than with an overflow-x
// crutch: four equal `1fr` tracks, `min-w-0` on grid/flex children (they
// default to `min-width:auto`, which is what actually causes runaway rows),
// and truncating text.

const TILE_TEXT_STYLE: React.CSSProperties = {
  color:           INK,
  letterSpacing:   "-0.01em",
  display:         "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
  overflow:        "hidden",
  overflowWrap:    "break-word",
  wordBreak:       "normal",
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; customers: ApiCustomer[]; products: ApiProduct[]; byTile: Map<string, V2Resolved> };

type Screen = "customers" | "order" | "review" | "sent" | "drafts" | "sentList";
type Sheet  = null | "switch" | "cancel" | "shipto" | "replace" | "summary";

export default function PoV2Page(): React.JSX.Element {
  const [load, setLoad]       = useState<LoadState>({ kind: "loading" });
  const [screen, setScreen]   = useState<Screen>("customers");
  const [dealer, setDealer]   = useState<ApiCustomer | null>(null);
  const [recents, setRecents] = useState<V2Recent[]>([]);
  const [favs, setFavs]       = useState<V2Fav[]>([]);
  const [query, setQuery]     = useState("");
  const [sheet, setSheet]     = useState<Sheet>(null);
  const [prodQuery, setProdQuery] = useState("");
  const [openTile, setOpenTile] = useState<V2Tile | null>(null);
  const [openGroup, setOpenGroup] = useState<V2ProductGroup | null>(null);
  const [lines, setLines]     = useState<V2CartLine[]>([]);
  const [order, setOrder]     = useState<V2Order>(EMPTY_ORDER);
  // NULL = "same as billing", the state email.ts omits the Ship To line for.
  const [shipTo, setShipTo]   = useState<ApiCustomer | null>(null);
  // Snapshot of what was SENT. The cart is cleared after the mailto, so the
  // Sent screen cannot read its counts back off live state.
  const [sent, setSent]       = useState<{ dealer: ApiCustomer; lines: number; units: number } | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<V2SavedDraft[]>([]);
  const [sentOrders, setSentOrders]   = useState<V2SentOrder[]>([]);
  // The draft a confirm sheet is about to replace live work with.
  const [pendingDraft, setPendingDraft] = useState<V2SavedDraft | null>(null);
  // The sent order whose read-only summary is open.
  const [openSent, setOpenSent]         = useState<V2SentOrder | null>(null);
  // Set once the live draft has been read, so the debounced writer below
  // cannot fire (and clear the key) before the restore has had its chance.
  const [hydrated, setHydrated] = useState(false);
  const restoredRef = useRef(false);
  // The id a reopened draft was saved under, so re-saving upserts in place.
  const openDraftIdRef = useRef<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const res = await fetch("/api/order/data", { cache: "no-store" });
      if (!res.ok) throw new Error(`Catalog request failed (${res.status})`);
      const data = (await res.json()) as ApiPayload;
      // The route swallows its own errors and answers 200 with empty arrays
      // (route.ts:140), so an empty catalog is a FAILURE here, not a valid
      // read. Treating it as success is what produces a silent empty screen.
      if (!Array.isArray(data.products) || data.products.length === 0) {
        throw new Error("Catalog came back empty");
      }
      const { byTile, report } = buildCatalog(data.products);
      // The catalog gate, kept live: the curated option lists are a snapshot
      // of 90 days of orders and the catalog moves underneath them, so a
      // reseed can invalidate a chip at any time.
      if (
        report.missingOptions.length || report.zeroRowTiles.length ||
        report.emptyPackChips.length || report.droppedDupes.length
      ) {
        console.warn("[po-v2] catalog gate", report);
      }
      setLoad({ kind: "ready", customers: data.customers ?? [], products: data.products, byTile });

      // Restore the live draft ONCE, and only after the payload lands — the
      // stored shipToCode has to be re-resolved against the fresh dealer list
      // rather than trusting a stale copy. Guarded by a ref so a Retry does
      // not clobber whatever the salesman has typed since.
      if (!restoredRef.current) {
        restoredRef.current = true;
        const draft = loadLiveDraft();
        if (draft) applySnapshot(draft, data.customers ?? []);
        setHydrated(true);
      }
    } catch (err) {
      setLoad({ kind: "error", message: err instanceof Error ? err.message : "Could not load the catalog" });
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);
  // Client-only reads, so the server render and the first client render agree.
  useEffect(() => {
    setRecents(loadRecents());
    setFavs(loadFavs());
    setSavedDrafts(loadSavedDrafts());
    setSentOrders(loadSentOrders());   // prunes to today+yesterday IST on read
  }, []);

  // Brief confirmation, self-dismissing. Cleared on unmount so a pending
  // timer cannot fire into a torn-down tree.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  /**
   * The live draft, written on a DEBOUNCE.
   *
   * 400ms, because this effect depends on `order` and the notes field is a
   * textarea — an undebounced write would hit localStorage on every keystroke,
   * which is a synchronous main-thread write on a phone.
   *
   * An order with no lines CLEARS the key rather than storing an empty shell:
   * there is nothing to restore, and a stored dealer with no items would
   * resurrect an order the salesman had already walked away from. That also
   * makes Send / Clear items / Start over clear the key for free, since all
   * three empty `lines`.
   */
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      if (dealer && lines.length > 0) saveLiveDraft(snapshotOf(dealer, lines, shipTo, order));
      else clearLiveDraft();
    }, 400);
    return () => clearTimeout(t);
  }, [hydrated, dealer, lines, shipTo, order]);

  const countsByTile = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const line of lines) counts[line.tileSap] = (counts[line.tileSap] ?? 0) + 1;
    return counts;
  }, [lines]);

  const orderUnits = useMemo(
    () => lines.reduce((sum, line) => sum + unitsIn(line.qtys), 0),
    [lines],
  );

  /**
   * Load a stored order onto the board. Shared by the live-draft restore, the
   * Drafts screen and "Send again" — one path, so all three behave alike.
   * `shipToCode` is re-resolved here against the CURRENT dealer list.
   */
  function applySnapshot(snap: V2Snapshot, pool: ApiCustomer[]): void {
    setDealer(snap.customer);
    setLines(snap.lines);
    setShipTo(snap.shipToCode ? (pool.find((c) => c.code === snap.shipToCode) ?? null) : null);
    setOrder({
      dispatch: snap.dispatch, callTarget: snap.callTarget,
      marker: snap.marker, crossDepot: snap.crossDepot, notes: snap.notes,
    });
    setProdQuery("");
    setScreen("order");
  }

  /** Load a saved draft, remembering its id so re-saving upserts in place. */
  function openDraft(d: V2SavedDraft): void {
    openDraftIdRef.current = d.id;
    applySnapshot(d.snapshot, customers);
  }

  /** Save the current order as a named draft and step back to the landing. */
  function saveDraft(): void {
    if (!dealer || lines.length === 0) return;
    const snapshot = snapshotOf(dealer, lines, shipTo, order);
    const id = openDraftIdRef.current ?? newDraftId();
    openDraftIdRef.current = id;
    setSavedDrafts(upsertSavedDraft({ id, label: labelFor(snapshot), savedAt: Date.now(), snapshot }));
    setToast("Draft saved");
    setScreen("customers");
  }

  /** Picking a dealer — from the landing list OR the switch sheet. */
  function pickDealer(c: ApiCustomer): void {
    setDealer(c);
    setRecents(addRecent(c));
    setQuery("");
    setSheet(null);
    setScreen("order");
    // 🔴 THE CART IS NOT TOUCHED. Lines are keyed on products, not on the
    // dealer, so swapping who the order is for keeps every line intact — that
    // is the whole point of the switch sheet.
  }

  /**
   * One place that builds a cart line, whichever door it came through.
   *
   * `packOrder` is snapshotted here from the ROW's pack array, which the
   * payload has already sorted into catalog order (route.ts:21-28). `qtys` is
   * a Record whose key order is the order the salesman tapped — fine for a
   * total, wrong for the printed pack string, and step 9's email has to match
   * /po byte for byte.
   */
  function commitLine(
    sap: string,
    label: string,
    picked: { option: string | null; row: ApiProduct; qtys: Record<string, number> },
  ): void {
    const qtys: Record<string, number> = {};
    for (const [packLabel, qty] of Object.entries(picked.qtys)) {
      if (qty > 0) qtys[packLabel] = qty;
    }
    setLines((prev) => [
      ...prev,
      {
        id: `${sap}-${Date.now()}-${prev.length}`,
        tileSap: sap, label, option: picked.option, rowId: picked.row.id, qtys,
        packOrder: picked.row.packs.map((p) => formatPack(p.packCode, p.unit)),
        // The WIRE name is built from these three by emailLineLabel — never
        // from `label` above, which is the curated board word.
        product:    picked.row.product,
        baseColour: picked.row.baseColour,
        subProduct: picked.row.subProduct,
      },
    ]);
  }

  /**
   * Commit every pick from one drawer visit. Flat and grid can return several
   * — one cart line per option that carries a quantity.
   */
  function addLines(
    sap: string,
    label: string,
    picks: { option: string | null; row: ApiProduct; qtys: Record<string, number> }[],
  ): void {
    for (const p of picks) commitLine(sap, label, p);
    setOpenTile(null);
    setOpenGroup(null);
  }

  /**
   * Removing the last line returns to the board — never an empty review.
   *
   * The filter runs on `lines` directly rather than inside a setLines updater:
   * an updater must be PURE, and React invokes it twice under StrictMode, so a
   * setScreen inside one fires twice. Same result, no side effect in a place
   * that promises not to have any.
   */
  function removeLine(id: string): void {
    const next = lines.filter((l) => l.id !== id);
    setLines(next);
    if (next.length === 0) setScreen("order");
  }

  /**
   * Send. Mirrors po-page.tsx:1953-1996.
   *
   * 🔴 ORDER OF OPERATIONS IS THE WHOLE THING. The mailto fires FIRST, inside
   * the tap gesture, before any state is touched — /po's comment at :1986 says
   * a synchronous navigation in the same tick cancels the pending external
   * handoff before the mail app opens. Everything after it is plain setState,
   * which never enters that queue.
   *
   * And the cart is cleared only AFTER the handoff. Clearing first would mean
   * a salesman who backs out of the mail app without sending returns to an
   * empty order with nothing to recover.
   */
  function handleSend(): void {
    if (!dealer) return;
    const { subject, body, valid } = buildV2Email({ dealer, shipTo, lines, order });
    if (!valid) return;

    window.location.href = buildV2MailtoUrl(subject, body);

    // Logged immediately AFTER the handoff — a plain localStorage write, which
    // never enters the navigation queue that the mailto is waiting on.
    const snapshot = snapshotOf(dealer, lines, shipTo, order);
    setSentOrders(addSentOrder({
      id: newSentId(), label: labelFor(snapshot), sentAt: Date.now(), snapshot,
    }));
    openDraftIdRef.current = null;

    setSent({ dealer, lines: lines.length, units: orderUnits });
    setLines([]);
    setOrder(EMPTY_ORDER);
    setShipTo(null);
    setProdQuery("");
    setScreen("sent");
  }

  /** Toggle a dealer's favourite star. Never opens the dealer. */
  function onToggleFav(c: ApiCustomer): void {
    setFavs(toggleFav({ name: c.name, code: c.code, area: c.area }));
  }

  const ready       = load.kind === "ready";
  const customers   = ready ? load.customers : [];
  const products    = ready ? load.products : [];
  const searching   = prodQuery.trim().length >= MIN_QUERY;
  const cartOpen    = lines.length > 0;
  const openProduct = ready && openTile ? load.byTile.get(openTile.sap) ?? null : null;
  // A searched PRODUCT resolves to its curated chips when it is one of the 32,
  // and to its own payload options (sortOrder, capped) when it is not.
  const tileLabelFor = (key: string): string | undefined =>
    ready ? load.byTile.get(key)?.label : undefined;
  const groupResolved = ready && openGroup
    ? resolveGroup(openGroup.key, openGroup.rows,
                   tileLabelFor(openGroup.key) ?? openGroup.best.displayName, load.byTile)
    : null;
  // The catalog rows behind whatever is open, and the shape they imply.
  // drawerMode() in v2-data is the ONE place that decision lives.
  const openTileRows = ready && openTile
    ? load.products.filter((p) => (p.product ?? p.subProduct) === openTile.sap)
    : [];
  const tileProduct = ready && openTile ? load.byTile.get(openTile.sap) : undefined;
  const tilePools = tileProduct ? optionPools(openTileRows) : undefined;
  const tileMode  = openTile ? drawerMode(openTileRows) : undefined;
  const groupPools = openGroup ? optionPools(openGroup.rows) : undefined;
  const groupMode  = openGroup ? drawerMode(openGroup.rows) : undefined;

  // ── Failure — a plain message and Retry, never a silent empty screen ─────
  if (load.kind === "error") {
    return (
      <main className="flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-white px-8 text-center">
        <p className="text-[15px] font-bold" style={{ color: INK }}>Could not load</p>
        <p className="text-[13px] leading-relaxed text-neutral-400">{load.message}</p>
        <button
          type="button" onClick={() => void fetchData()}
          className="mt-1 rounded-[13px] px-6 py-3 text-[15px] font-extrabold text-white"
          style={{ background: VIOLET }}
        >
          Retry
        </button>
      </main>
    );
  }

  // ══ SCREEN 1 — THE DEALER LIST ═══════════════════════════════════════════
  if (screen === "customers") {
    return (
      <main className="min-h-screen w-full bg-white" style={{ paddingBottom: 76 }}>
        <header
          className="sticky top-0 z-10 flex items-center gap-2 bg-white px-4 py-3"
          style={{ borderBottom: `1px solid ${RULE}` }}
        >
          <OrbitMark />
          <span className="text-[19px] font-extrabold" style={{ color: VIOLET, letterSpacing: "-0.03em" }}>
            Orbit
          </span>
          <span className="ml-auto shrink-0 font-mono text-[11px] text-neutral-400">SURAT DEPOT</span>
        </header>

        <div className="px-4 pt-3 pb-2">
          <CustomerSearchInput value={query} onChange={setQuery} />
        </div>

        {ready ? (
          <CustomerListBody
            customers={customers} recents={recents} favs={favs} query={query}
            onPick={pickDealer} onToggleFav={onToggleFav}
          />
        ) : (
          <p className="px-4 py-10 text-center text-[13px] text-neutral-400">Loading dealers…</p>
        )}

        <BottomNav active="home" onNavigate={(s2) => setScreen(s2)} />
        {toast && (
          <div className="fixed inset-x-0 z-30 flex justify-center px-4" style={{ bottom: 88 }}>
            <span className="rounded-full px-4 py-2 text-[13px] font-bold text-white"
                  style={{ background: INK }}>{toast}</span>
          </div>
        )}
      </main>
    );
  }

  // ══ SCREEN 5 — SAVED DRAFTS ══════════════════════════════════════════════
  if (screen === "drafts") {
    return (
      <>
        <DraftsScreen
          drafts={savedDrafts}
          onBack={() => setScreen("customers")}
          onRemove={(id) => setSavedDrafts(removeSavedDraft(id))}
          onOpen={(d) => {
            // 🔴 NEVER SILENTLY DISCARD WORK. A draft replaces the whole order,
            // so live lines get a confirm first; an empty order does not need
            // one, because there is nothing to lose.
            if (lines.length > 0) { setPendingDraft(d); setSheet("replace"); }
            else openDraft(d);
          }}
        />
        {sheet === "replace" && pendingDraft && (
          <V2Sheet
            onClose={() => { setSheet(null); setPendingDraft(null); }}
            footer={
              <button
                type="button"
                onClick={() => { setSheet(null); setPendingDraft(null); }}
                className="w-full rounded-[13px] py-3 text-[15px] font-extrabold text-white"
                style={{ background: VIOLET }}
              >
                Keep what I have
              </button>
            }
          >
            <div className="shrink-0 px-4 pt-1.5 pb-3">
              <h2 className="text-[18px] font-extrabold" style={{ color: INK, letterSpacing: "-0.025em" }}>
                Replace this order?
              </h2>
              <p className="text-[11.5px] text-neutral-400">
                {lines.length} {lines.length === 1 ? "line" : "lines"} on screen will be replaced by this draft
              </p>
            </div>
            <div className="shrink-0 px-4 pb-3">
              <button
                type="button"
                onClick={() => { const d = pendingDraft; setSheet(null); setPendingDraft(null); openDraft(d); }}
                className="flex w-full items-center gap-3 rounded-[13px] px-3 py-3 text-left"
                style={{ border: `1.5px solid ${RULE}` }}
              >
                <span className="flex shrink-0 items-center justify-center rounded-[9px]"
                      style={{ width: 32, height: 32, background: "#F2F1F5" }}>
                  <FileText className="h-4 w-4" strokeWidth={2.5} style={{ color: INK }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-bold" style={{ color: INK }}>
                    Load {pendingDraft.label}
                  </span>
                  <span className="block truncate text-[11.5px] text-neutral-400">
                    Saved {formatSavedAt(pendingDraft.savedAt)}
                  </span>
                </span>
              </button>
            </div>
          </V2Sheet>
        )}
      </>
    );
  }

  // ══ SCREEN 6 — SENT TODAY ════════════════════════════════════════════════
  if (screen === "sentList") {
    return (
      <>
        <SentScreen
          orders={sentOrders}
          onBack={() => setScreen("customers")}
          onOpen={(o) => { setOpenSent(o); setSheet("summary"); }}
        />
        {sheet === "summary" && openSent && (
          <V2Sheet
            onClose={() => { setSheet(null); setOpenSent(null); }}
            footer={
              <button
                type="button"
                onClick={() => {
                  const snap = openSent.snapshot;
                  setSheet(null); setOpenSent(null);
                  // 🔴 A FRESH ORDER, not a re-send. This loads the lines onto
                  // the board and stops — it never re-fires the mailto, so the
                  // salesman sees and confirms what goes out a second time.
                  openDraftIdRef.current = null;
                  applySnapshot(snap, customers);
                }}
                className="w-full rounded-[13px] py-3 text-[15px] font-extrabold text-white"
                style={{ background: VIOLET }}
              >
                Send again
              </button>
            }
          >
            <div className="shrink-0 px-4 pt-1.5 pb-3">
              <h2 className="truncate text-[18px] font-extrabold" style={{ color: INK, letterSpacing: "-0.025em" }}>
                {openSent.snapshot.customer.name}
              </h2>
              <p className="font-mono text-[11.5px] text-neutral-400">
                Sent {formatTime(openSent.sentAt)}
              </p>
            </div>
            {/* Read-only. No steppers, no remove — a sent order is history. */}
            <div className="min-h-0 overflow-y-auto">
              {openSent.snapshot.lines.map((line) => (
                <div key={line.id} className="flex items-start gap-3 px-4 py-2.5"
                     style={{ borderTop: `1px solid ${DIVIDER}` }}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-semibold" style={{ color: INK }}>{line.label}</p>
                    {line.option && (
                      <p className="truncate text-[11.5px] font-extrabold uppercase"
                         style={{ color: VIOLET, letterSpacing: ".06em" }}>{line.option}</p>
                    )}
                  </div>
                  {/* min-w-0, stacked — same fix as the review row. */}
                  <div className="min-w-0 text-right">
                    {packRows(line).map(({ label, qty }) => (
                      <p key={label} className="whitespace-nowrap font-mono text-[13px] tabular-nums" style={{ color: INK }}>
                        {label} ×{qty}
                      </p>
                    ))}
                    <p className="text-[11px] text-neutral-400">{unitsIn(line.qtys)} units</p>
                  </div>
                </div>
              ))}
            </div>
          </V2Sheet>
        )}
      </>
    );
  }

  // ══ SCREEN 4 — SENT ══════════════════════════════════════════════════════
  // Reached only after the mailto handoff. "Sent" means handed to the mail
  // app — it cannot know the mail actually left, and does not claim to.
  if (screen === "sent" && sent) {
    return (
      <main className="flex min-h-screen w-full flex-col items-center justify-center gap-2 bg-white px-8 text-center">
        <CheckCircle2 className="h-12 w-12" strokeWidth={2} style={{ color: "#16A34A" }} />
        <p className="mt-1 text-[19px] font-extrabold" style={{ color: INK, letterSpacing: "-0.02em" }}>
          Order sent
        </p>
        <p className="max-w-[280px] truncate text-[15px] font-bold" style={{ color: INK }}>
          {sent.dealer.name}
        </p>
        <p className="font-mono text-[12.5px] text-neutral-400">
          {sent.lines} {sent.lines === 1 ? "line" : "lines"} · {sent.units} units
        </p>

        <div className="mt-6 w-full max-w-[340px] space-y-2">
          <button
            type="button"
            onClick={() => { setSent(null); setScreen("order"); }}
            className="w-full truncate rounded-[13px] py-3 text-[15px] font-extrabold text-white"
            style={{ background: VIOLET }}
          >
            Another order for {firstWord(sent.dealer.name)}
          </button>
          <button
            type="button"
            onClick={() => {
              setSent(null); setDealer(null); setQuery(""); setScreen("customers");
            }}
            className="w-full rounded-[13px] py-3 text-[15px] font-extrabold"
            style={{ border: `1.5px solid ${RULE}`, color: INK }}
          >
            Different customer
          </button>
        </div>
      </main>
    );
  }

  // ══ SCREEN 3 — REVIEW ════════════════════════════════════════════════════
  // The ship-to sheet renders alongside it, so "Change" works from here.
  if (screen === "review" && dealer) {
    return (
      <>
        <ReviewScreen
          dealer={dealer}
          shipTo={shipTo}
          lines={lines}
          order={order}
          onBack={() => setScreen("order")}
          onEdit={() => setScreen("order")}
          onRemoveLine={removeLine}
          onOrderChange={setOrder}
          onSend={handleSend}
          onSaveDraft={saveDraft}
          onOpenShipTo={() => { setQuery(""); setSheet("shipto"); }}
        />
        {sheet === "shipto" && (
          <V2Sheet onClose={() => setSheet(null)}>
            <div className="shrink-0 px-4 pt-1.5 pb-3">
              <h2 className="text-[18px] font-extrabold" style={{ color: INK, letterSpacing: "-0.025em" }}>
                Ship to
              </h2>
              <p className="text-[11.5px] text-neutral-400">
                Where the goods go — the bill still goes to {dealer.name}
              </p>
            </div>
            <div className="shrink-0 px-4 pb-2">
              <CustomerSearchInput value={query} onChange={setQuery} />
            </div>
            <div className="min-h-0 overflow-y-auto">
              {/* A FIXED first row for the default, so "same as billing" is a
                  thing you can pick your way back to, not just the absence of
                  a choice. Hidden while searching — it is not a search hit. */}
              {query.trim().length === 0 && (
                <button
                  type="button"
                  onClick={() => { setShipTo(null); setSheet(null); }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  style={{
                    borderBottom: `1px solid ${DIVIDER}`,
                    background: shipTo === null ? VIOLET_BG : undefined,
                  }}
                >
                  <MapPin className="h-4 w-4 shrink-0" strokeWidth={2.5}
                          style={{ color: shipTo === null ? VIOLET : "#A3A3A3" }} />
                  <span className="min-w-0 flex-1 truncate text-[14.5px] font-bold" style={{ color: INK }}>
                    Same as billing
                  </span>
                  {shipTo === null && (
                    <Check className="h-4 w-4 shrink-0" strokeWidth={3} style={{ color: VIOLET }} />
                  )}
                </button>
              )}
              <CustomerListBody
                customers={customers} recents={recents} favs={favs} query={query}
                currentCode={shipTo?.code ?? null} onToggleFav={onToggleFav}
                onPick={(c) => { setShipTo(c); setSheet(null); setQuery(""); }}
              />
            </div>
          </V2Sheet>
        )}
      </>
    );
  }

  // ══ SCREEN 2 — THE BOARD ═════════════════════════════════════════════════
  return (
    <>
      <main className="min-h-screen w-full bg-white" style={{ paddingBottom: cartOpen ? 108 : 24 }}>
        {/* ── DEALER BAR — scrolls AWAY. The search row below takes over. ── */}
        <header
          className="flex items-center gap-3 bg-white px-4 py-2.5"
          style={{ borderBottom: `1px solid ${RULE}` }}
        >
          <button
            type="button"
            onClick={() => { setQuery(""); setSheet("switch"); }}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            <span className="min-w-0">
              <span className="block truncate text-[16px] font-extrabold tracking-tight" style={{ color: VIOLET }}>
                {dealer ? dealer.name.toUpperCase() : "—"}
              </span>
              <span className="block truncate font-mono text-[11px] text-neutral-400">
                {dealer ? `${dealer.code}${dealer.area ? ` · ${dealer.area}` : ""}` : ""}
              </span>
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-300" strokeWidth={2.5} />
          </button>
          {/* Opens the cancel sheet. It clears NOTHING on its own. */}
          <button
            type="button" aria-label="Start a new order"
            onClick={() => setSheet("cancel")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{ border: `1px solid ${RULE}` }}
          >
            <X className="h-4 w-4 text-neutral-400" strokeWidth={2.5} />
          </button>
        </header>

        {/* ── PRODUCT SEARCH — PINS to the top once the dealer bar scrolls ──
            Plain `position: sticky` inside the page's own scroll: no scroll
            listener, no measured offset, nothing to drift out of sync. The
            white background and bottom border are ALWAYS on rather than
            applied at the moment of pinning — detecting "pinned" needs either
            a scroll listener or a sentinel + IntersectionObserver, and a
            hairline under the search box reads fine unpinned too.

            The monogram is why the dealer bar is allowed to leave: it keeps
            Change customer one tap away when the name is off screen. */}
        <div
          className="sticky top-0 z-20 flex items-center gap-2.5 bg-white px-4 pb-2.5 pt-2.5"
          style={{ borderBottom: `1px solid ${RULE}` }}
        >
          <button
            type="button"
            aria-label="Change customer"
            onClick={() => { setQuery(""); setSheet("switch"); }}
            className="flex shrink-0 items-center justify-center rounded-[10px] text-[12px] font-extrabold text-neutral-600"
            style={{ width: 34, height: 34, background: MONO_BG }}
          >
            {dealer ? monogram(dealer.name) : "—"}
          </button>
          <div className="min-w-0 flex-1">
            <ProductSearchInput value={prodQuery} onChange={setProdQuery} />
          </div>
        </div>

        {/* Under 2 characters the board stands; at 2 the board is REPLACED by
            results. The dealer bar above and the cart bar below both stay, so
            searching never loses the salesman his context. */}
        {searching ? (
          <div>
            <ProductResults
              products={products}
              query={prodQuery}
              labelFor={tileLabelFor}
              onPick={(group) => setOpenGroup(group)}
            />
          </div>
        ) : (
        <>
        {/* ── FAMILY BLOCKS ────────────────────────────────────────────── */}
        {FAMILIES.map((family) => (
          <section key={family.name} className="px-4" style={{ paddingTop: 18 }}>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="shrink-0 text-[11px] font-bold uppercase"
                  style={{ letterSpacing: ".08em", color: "#8B8794" }}>
                {family.name}
              </h2>
              <span className="h-px flex-1" style={{ background: RULE }} />
            </div>
            <div className="grid grid-cols-4" style={{ gap: 8 }}>
              {family.tiles.map((tile) => {
                const count   = countsByTile[tile.sap] ?? 0;
                const inOrder = count > 0;
                return (
                  <button
                    key={tile.sap}
                    type="button"
                    disabled={!ready}
                    onClick={() => setOpenTile(tile)}
                    className="relative flex min-w-0 flex-col items-center justify-center rounded-[16px] px-[3px]"
                    style={{
                      height:     84,
                      background: inOrder ? VIOLET_BG : family.tint,
                      // Transparent, not absent: an in-cart tile grows a violet
                      // border and must not change size when it does.
                      border:     inOrder ? `1.5px solid ${VIOLET}` : "1.5px solid transparent",
                      opacity:    ready ? 1 : 0.45,
                    }}
                  >
                    {/* A product IMAGE goes here later, above the name — this is
                        already a centred column so it slots in without a
                        rewrite. No empty placeholder box now: 32 grey squares
                        would read as broken, not as pending. */}
                    <span className="text-center text-[13.5px] font-semibold" style={TILE_TEXT_STYLE}>
                      {tile.label}
                    </span>
                    {inOrder && (
                      <span
                        className="absolute flex items-center justify-center rounded-full text-[10px] font-extrabold text-white"
                        style={{ top: -7, right: -7, minWidth: 18, height: 18, padding: "0 5px", background: VIOLET }}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        </>
        )}
      </main>

      {/* ── BOTTOM BAR ─────────────────────────────────────────────────── */}
      {cartOpen && (
        <div
          className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 bg-white px-4 pt-3"
          style={{ borderTop: `1px solid ${RULE}`, paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold" style={{ color: INK }}>
              {lines.length} {lines.length === 1 ? "line" : "lines"}
            </p>
            <p className="truncate font-mono text-[11px] text-neutral-400">{orderUnits} units</p>
          </div>
          <button
            type="button"
            onClick={() => setScreen("review")}
            className="shrink-0 rounded-[13px] px-5 py-3 text-[15px] font-extrabold text-white"
            style={{ background: VIOLET }}
          >
            Review order
          </button>
        </div>
      )}

      {/* ── CHANGE-CUSTOMER SHEET ──────────────────────────────────────── */}
      {sheet === "switch" && (
        <V2Sheet onClose={() => setSheet(null)}>
          <div className="shrink-0 px-4 pt-1.5 pb-3">
            <h2 className="text-[18px] font-extrabold" style={{ color: INK, letterSpacing: "-0.025em" }}>
              Change customer
            </h2>
            <p className="text-[11.5px] text-neutral-400">
              {lines.length} {lines.length === 1 ? "line" : "lines"} already in this order — they stay
            </p>
          </div>
          <div className="shrink-0 px-4 pb-2">
            <CustomerSearchInput value={query} onChange={setQuery} />
          </div>
          <div className="min-h-0 overflow-y-auto">
            <CustomerListBody
              customers={customers} recents={recents} favs={favs} query={query}
              currentCode={dealer?.code ?? null} onPick={pickDealer} onToggleFav={onToggleFav}
            />
          </div>
        </V2Sheet>
      )}

      {/* ── CANCEL SHEET — clears nothing by itself ────────────────────── */}
      {sheet === "cancel" && (
        <V2Sheet
          onClose={() => setSheet(null)}
          footer={
            // The safe way out is the biggest target in the sheet.
            <button
              type="button" onClick={() => setSheet(null)}
              className="w-full rounded-[13px] py-3 text-[15px] font-extrabold text-white"
              style={{ background: VIOLET }}
            >
              Keep editing
            </button>
          }
        >
          <div className="shrink-0 px-4 pt-1.5 pb-3">
            <h2 className="text-[18px] font-extrabold" style={{ color: INK, letterSpacing: "-0.025em" }}>
              Start a new order?
            </h2>
            <p className="text-[11.5px] text-neutral-400">
              {lines.length} {lines.length === 1 ? "line" : "lines"} will be cleared
            </p>
          </div>
          <div className="shrink-0 space-y-2 px-4 pb-3">
            <DestructiveRow
              icon={<Eraser className="h-4 w-4" strokeWidth={2.5} style={{ color: INK }} />}
              label={`Clear items, keep ${firstWord(dealer?.name)}`}
              sub="Empty basket, same dealer on screen"
              onClick={() => { setLines([]); setOrder(EMPTY_ORDER); setShipTo(null); setSheet(null); }}
            />
            <DestructiveRow
              icon={<Users className="h-4 w-4" strokeWidth={2.5} style={{ color: INK }} />}
              label="Start over, choose a dealer"
              sub="Back to the dealer list"
              onClick={() => {
                setLines([]);
                setDealer(null);
                setQuery("");
                setProdQuery("");
                setOrder(EMPTY_ORDER);
                setShipTo(null);
                setSheet(null);
                setScreen("customers");
              }}
            />
          </div>
        </V2Sheet>
      )}

      {/* ── PRODUCT DRAWER, from the BOARD ─────────────────────────────── */}
      {/* `key` forces a fresh mount per tile, so selections never leak. */}
      {openTile && openProduct && (
        <ProductDrawer
          key={openTile.sap}
          product={openProduct}
          onClose={() => setOpenTile(null)}
          onAdd={(picks) => addLines(openTile.sap, openTile.label, picks)}
          pools={tilePools}
          mode={tileMode}
        />
      )}

      {/* ── PRODUCT DRAWER, from a SEARCH HIT ──────────────────────────── */}
      {/* A searched result is now a PRODUCT, so this opens the same drawer its
          tile would — curated chips for one of the 32, or its own payload
          options (sortOrder, capped) for anything else. */}
      {openGroup && groupResolved && (
        <ProductDrawer
          key={`group-${openGroup.key}`}
          product={groupResolved}
          onClose={() => setOpenGroup(null)}
          onAdd={(picks) => addLines(groupResolved.sap, groupResolved.label, picks)}
          pools={groupPools}
          mode={groupMode}
        />
      )}
    </>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

/** First word of the dealer's name, for the "keep {dealer}" label. */
function firstWord(name: string | undefined): string {
  const word = (name ?? "").trim().split(/\s+/)[0];
  return word && word.length > 0 ? word : "dealer";
}

/** The Orbit ring: a violet circle with a filled dot inside it. */
function OrbitMark(): React.JSX.Element {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: 20, height: 20, border: `2.4px solid ${VIOLET}` }}
    >
      <span className="block rounded-full" style={{ width: 6, height: 6, background: VIOLET }} />
    </span>
  );
}

/** One option row in the cancel sheet: icon square, bold label, grey sub-line. */
function DestructiveRow({ icon, label, sub, onClick }: {
  icon: React.ReactNode; label: string; sub: string; onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button" onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[13px] px-3 py-3 text-left"
      style={{ border: `1.5px solid ${RULE}` }}
    >
      <span
        className="flex shrink-0 items-center justify-center rounded-[9px]"
        style={{ width: 32, height: 32, background: "#F2F1F5" }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-bold" style={{ color: INK }}>{label}</span>
        <span className="block truncate text-[11.5px] text-neutral-400">{sub}</span>
      </span>
    </button>
  );
}

/** Home / Drafts / Sent. Home is where it renders; the other two navigate. */
function BottomNav({ active, onNavigate }: {
  active: "home";
  onNavigate: (screen: "drafts" | "sentList") => void;
}): React.JSX.Element {
  const items: { label: string; icon: typeof Home; active: boolean; go?: "drafts" | "sentList" }[] = [
    { label: "Home",   icon: Home,     active: active === "home" },
    { label: "Drafts", icon: FileText, active: false, go: "drafts" },
    { label: "Sent",   icon: Send,     active: false, go: "sentList" },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 flex bg-white pt-2"
      style={{ borderTop: `1px solid ${RULE}`, paddingBottom: "max(env(safe-area-inset-bottom), 8px)" }}
    >
      {items.map(({ label, icon: Icon, active: isOn, go }) => (
        <button
          key={label} type="button"
          onClick={() => go && onNavigate(go)}
          className="flex flex-1 flex-col items-center gap-0.5"
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={2.5}
                style={{ color: isOn ? VIOLET : "#A3A3A3" }} />
          <span className="text-[10px] font-extrabold"
                style={{ color: isOn ? VIOLET : "#A3A3A3" }}>
            {label}
          </span>
        </button>
      ))}
    </nav>
  );
}
