"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, FileText, Grid2x2, MapPin, Send } from "lucide-react";
import ProductDrawer from "./product-drawer";
import V2Sheet, { useBodyScrollLock } from "./v2-sheet";
import { CustomerListBody, CustomerSearchInput } from "./customer-list";
import { MIN_QUERY, ProductResults, ProductSearchInput, type V2ProductGroup } from "./product-search";
import ReviewScreen from "./review-screen";
import { buildV2Email, buildV2MailtoUrl } from "./v2-email";
import { DraftsScreen, SentScreen } from "./drafts-sent";
import {
  addSentOrder, clearLiveDraft, labelFor, loadLiveDraft, loadSavedDrafts,
  loadSentOrders, newDraftId, newSentId, removeSavedDraft, formatSavedAt, formatTime,
  addMyDealer, loadMyDealers, removeMyDealer, type V2Dealer,
  saveLiveDraft, snapshotOf, upsertSavedDraft,
  type V2SavedDraft, type V2SentOrder, type V2Snapshot,
} from "./v2-storage";
import {
  BRAND, BRAND_GRADIENT, DIVIDER, FAINT, FAMILIES, FILL, INK, MUTED, RULE,
  SURFACE, VIOLET, VIOLET_BG,
  EMPTY_ORDER, buildCatalog, drawerMode, formatPack,
  mixToWhite, optionPools, packRows, resolveGroup, tileImage, unitsIn, TILE_WASH,
  type ApiCustomer, type ApiPayload, type ApiProduct,
  type V2CartLine, type V2Order, type V2Resolved, type V2Tile,
} from "./v2-data";

// Hidden v2 salesman order page — the whole app, on one route.
//
// 🔴 CONTAINMENT — imports its own siblings, node_modules, and (the one
// documented exception) lib/place-order's email + ranking helpers, read-only.
// Nothing outside app/po-v2-8f4kd2/ is modified. Every colour is an inline
// style, so globals.css and tailwind.config.ts stay untouched.
//
// THE BOARD IS THE LANDING, AND IT NEVER MENTIONS A DEALER.
//
// 🔴 THE DEALER IS A FIELD ON THE WAY OUT, NOT A GATE ON THE WAY IN. Two
// earlier cuts got this wrong in two different ways: first a dealer LIST in
// front of the board, then a dealer BAR on it that a product tap had to detour
// around. Both made a salesman standing in a shop answer a question before he
// could start adding, and he does not know the answer yet — he is looking at
// the shelf, not at the account. So the board holds no dealer state at all; a
// tile tap opens its drawer and nothing else happens. Review asks, once.
//
// FIVE SCREENS, ONE URL: board, review, sent-confirmation, saved drafts,
// sent-today. All switched by state, not routing, so the fetched catalog and
// the order survive every switch with no store and no reload.
//
// PERSISTENCE lives in ./v2-storage under po2_* keys ONLY. v2 never touches a
// po_* or orbitoms_* key — sharing a slot with /po would mean two independent
// order books silently eating each other's drafts.
//
// NO HORIZONTAL SCROLL, met structurally rather than with an overflow-x
// crutch: four equal `1fr` tracks, `min-w-0` on grid/flex children (they
// default to `min-width:auto`, which is what actually causes runaway rows),
// and truncating text.

// The product name UNDER the tile, Blinkit-style: outside the square, left
// aligned, two lines at most.
//
// 🔴 NO MID-WORD BREAKS. `overflowWrap: break-word` used to be here, and at a
// 83px track it is what turns "Powerflexx" into "Powerfl / exx" and
// "Supercover" into "Supercov / er" — a product name broken across a line at a
// meaningless point is harder to scan than one that is clipped. Both are now
// `normal`, so the only break point is a space.
//
// The clip is the structural guarantee, not a nicety: with wrapping refused, a
// word wider than its track would otherwise push the grid out and put the whole
// board into horizontal scroll. `overflow: hidden` makes an over-long word
// cut off inside its own cell instead, so the board's no-sideways-scroll rule
// cannot be broken by a future product name.
const TILE_TEXT_STYLE: React.CSSProperties = {
  color:           INK,
  letterSpacing:   "-0.01em",
  lineHeight:      1.25,
  display:         "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
  overflow:        "hidden",
  overflowWrap:    "normal",
  wordBreak:       "normal",
  hyphens:         "none",
};

/**
 * The bottom nav's height including the safe area, as a CSS expression.
 *
 * The cart bar STACKS ABOVE the nav rather than replacing it: both are visible
 * at once, cart on top. Hiding the nav behind the cart is what made drafts and
 * sent orders unreachable the moment an order had a line in it, and merging
 * them into one bar puts a destructive "Review" beside two harmless tabs.
 */
const NAV_H = "calc(54px + max(env(safe-area-inset-bottom), 8px))";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; customers: ApiCustomer[]; products: ApiProduct[]; byTile: Map<string, V2Resolved> };

type Screen = "order" | "review" | "sent" | "drafts" | "sentList";
type Sheet  = null | "dealer" | "shipto" | "replace" | "summary";

export default function PoV2Page(): React.JSX.Element {
  const [load, setLoad]       = useState<LoadState>({ kind: "loading" });
  const [screen, setScreen]   = useState<Screen>("order");
  const [dealer, setDealer]   = useState<ApiCustomer | null>(null);
  const [mine, setMine]       = useState<V2Dealer[]>([]);
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

  /**
   * 🔴 THE PAGE HOLDS THE BODY-SCROLL LOCK FOR AS LONG AS *ANY* OVERLAY IS OPEN,
   * and this is what stops a sheet handoff from throwing him back to the top.
   *
   * Each sheet takes the shared ref-counted lock too, but counting alone is not
   * enough: when one sheet closes and another opens in the SAME commit, React
   * runs the outgoing cleanup before the incoming setup, so the count dips
   * 1 -> 0 -> 1 and the body is unlocked and re-locked inside one frame — which
   * is exactly the fixed -> static -> fixed sequence that made window.scrollTo
   * clamp to zero against an unsettled layout.
   *
   * This lock's dependency is a BOOLEAN that stays `true` right across such a
   * handoff, so its effect does not re-run, the count never reaches zero, and
   * the body is simply never touched. No timer, no rAF, no re-measuring.
   */
  useBodyScrollLock(sheet !== null || openTile !== null || openGroup !== null);

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
    setMine(loadMyDealers());
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
      if (lines.length > 0) saveLiveDraft(snapshotOf(dealer, lines, shipTo, order));
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

  /** Open the dealer sheet. One entry point, so the query is always cleared. */
  function openDealerSheet(): void { setQuery(""); setSheet("dealer"); }

  /** Empty the order and go back to the board. The dealer clears with it. */
  function startOver(): void {
    setLines([]);
    setDealer(null);
    setShipTo(null);
    setOrder(EMPTY_ORDER);
    setProdQuery("");
    setSheet(null);
    setScreen("order");
  }

  /** Load a saved draft, remembering its id so re-saving upserts in place. */
  function openDraft(d: V2SavedDraft): void {
    openDraftIdRef.current = d.id;
    applySnapshot(d.snapshot, customers);
  }

  /** Save the current order as a named draft and step back to the landing. */
  function saveDraft(): void {
    // 🔴 NO DEALER REQUIRED. A draft is what he saves BECAUSE he does not know
    // whose account it is yet; demanding one would defeat the feature.
    if (lines.length === 0) return;
    const snapshot = snapshotOf(dealer, lines, shipTo, order);
    const id = openDraftIdRef.current ?? newDraftId();
    openDraftIdRef.current = id;
    setSavedDrafts(upsertSavedDraft({ id, label: labelFor(snapshot), savedAt: Date.now(), snapshot }));
    setToast("Draft saved");
    // Stays on the board. There is nowhere else to go now, and bouncing him to
    // a list after saving would lose the products he can see.
  }

  /** Picking a dealer. One path, whether the sheet was opened by the search
   *  bar, by the dealer line, or by tapping a product with no dealer yet. */
  /**
   * Picking a dealer. Reached only from REVIEW, and it lands back on review.
   *
   * 🔴 IT NEVER SENDS. Choosing a dealer closes the sheet and stops there, with
   * the order on screen and Send now live under his thumb. Firing the mailto
   * here would turn one tap into an order leaving the building, which is the
   * one mistake the review screen exists to prevent.
   *
   * The cart is not touched either: lines are keyed on products, so changing
   * who the order is for keeps every line intact.
   */
  function pickDealer(c: ApiCustomer): void {
    setDealer(c);
    setQuery("");
    setSheet(null);
    setScreen("review");
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
    // No dealer yet: ask, and come straight back to review. Never send.
    if (!dealer) { openDealerSheet(); return; }
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
    // 🔴 THE LIST BUILDS ITSELF HERE, and only here. Sending is the signal that
    // this is a dealer he actually serves; merely opening one is not.
    setMine(addMyDealer(dealer));

    setSent({ dealer, lines: lines.length, units: orderUnits });
    setLines([]);
    setOrder(EMPTY_ORDER);
    setShipTo(null);
    setProdQuery("");
    setScreen("sent");
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

  /**
   * 🔴 MOUNTED ON EVERY SCREEN, NOT INSIDE ONE. The toast used to live in the
   * dealer-list screen's JSX. Saving a draft set the text and then navigated,
   * so the confirmation rendered on a screen the salesman had already left —
   * and when that screen went away, "Draft saved" would have gone silent
   * altogether. It is one element, added to every return below.
   */
  const toastHost = toast ? (
    <div className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4"
         style={{ bottom: `calc(${NAV_H} + 16px)` }}>
      <span className="rounded-full px-4 py-2 text-[13px] font-bold text-white"
            style={{ background: INK }}>{toast}</span>
    </div>
  ) : null;

  // ── First paint — the brand, not an empty white page ─────────────────────
  //
  // 🔴 THIS IS ALSO THE FIX FOR THE HOME-SCREEN SPLASH. iOS has no launch image
  // for this app (no apple-touch-startup-image is declared, deliberately — the
  // per-device sizes go stale with every new phone), so it paints a SCREENSHOT
  // of the last render while the app boots. Once the board carried product
  // photographs that screenshot became a wall of paint tins. Rendering the
  // brand while the catalog loads makes the screenshot the brand instead, and
  // it stays right from then on without a single static asset to maintain.
  if (load.kind === "loading") {
    return (
      <main className="flex min-h-screen w-full items-center justify-center"
            style={{ background: BRAND_GRADIENT }}>
        {/* Nothing else. No tagline, no spinner, no depot name. */}
        <img src="/brand/orbit-wordmark-white.svg" alt="Orbit"
             width={2216} height={771}
             style={{ width: "52%", maxWidth: 260, height: "auto" }} />
      </main>
    );
  }

  // ── Failure — a plain message and Retry, never a silent empty screen ─────
  if (load.kind === "error") {
    return (
      <main className="flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-white px-8 text-center">
        <p className="text-[15px] font-bold" style={{ color: INK }}>Could not load</p>
        <p className="text-[13px] leading-relaxed" style={{ color: MUTED }}>{load.message}</p>
        <button
          type="button" onClick={() => void fetchData()}
          className="mt-1 rounded-[13px] px-6 py-3 text-[15px] font-extrabold text-white"
          style={{ background: BRAND }}
        >
          Retry
        </button>
      </main>
    );
  }

  // ══ SCREEN 5 — SAVED DRAFTS ══════════════════════════════════════════════
  if (screen === "drafts") {
    return (
      <>
        <DraftsScreen
          drafts={savedDrafts}
          onBack={() => setScreen("order")}
          onRemove={(id) => setSavedDrafts(removeSavedDraft(id))}
          onOpen={(d) => {
            // 🔴 NEVER SILENTLY DISCARD WORK. A draft replaces the whole order,
            // so live lines get a confirm first; an empty order does not need
            // one, because there is nothing to lose.
            if (lines.length > 0) { setPendingDraft(d); setSheet("replace"); }
            else openDraft(d);
          }}
        />
        {toastHost}
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
              <p className="text-[11.5px]" style={{ color: MUTED }}>
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
                      style={{ width: 32, height: 32, background: FILL }}>
                  <FileText className="h-4 w-4" strokeWidth={2.5} style={{ color: INK }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-bold" style={{ color: INK }}>
                    Load {pendingDraft.label}
                  </span>
                  <span className="block truncate text-[11.5px]" style={{ color: MUTED }}>
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
          onBack={() => setScreen("order")}
          onOpen={(o) => { setOpenSent(o); setSheet("summary"); }}
        />
        {toastHost}
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
                {openSent.snapshot.customer?.name ?? "—"}
              </h2>
              <p className="font-mono text-[11.5px]" style={{ color: MUTED }}>
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
                    <p className="text-[11px]" style={{ color: MUTED }}>{unitsIn(line.qtys)} units</p>
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
        <p className="font-mono text-[12.5px]" style={{ color: MUTED }}>
          {sent.lines} {sent.lines === 1 ? "line" : "lines"} · {sent.units} units
        </p>

        <div className="mt-6 w-full max-w-[340px] space-y-2">
          <button
            type="button"
            onClick={() => { setSent(null); setScreen("order"); }}
            className="w-full truncate rounded-[13px] py-3 text-[15px] font-extrabold text-white"
            style={{ background: BRAND }}
          >
            Another order for {firstWord(sent.dealer.name)}
          </button>
          <button
            type="button"
            onClick={() => {
              setSent(null); startOver();
            }}
            className="w-full rounded-[13px] py-3 text-[15px] font-extrabold"
            style={{ border: `1.5px solid ${RULE}`, color: INK }}
          >
            Different customer
          </button>
        </div>
        {toastHost}
      </main>
    );
  }

  // ══ SCREEN 3 — REVIEW ════════════════════════════════════════════════════
  // The ship-to sheet renders alongside it, so "Change" works from here.
  if (screen === "review") {
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
          onOpenDealer={openDealerSheet}
          onOpenShipTo={() => { setQuery(""); setSheet("shipto"); }}
        />
        {/* ── DEALER SHEET — REVIEW ONLY ─────────────────────────────────
            The one place the app asks. Opened by the dealer row or by pressing
            Send without one, and it always returns HERE with the finished order
            still on screen. It is not rendered on the board at all. */}
      {sheet === "dealer" && (
        <V2Sheet
          onClose={() => setSheet(null)}
          fixedHeight
        >
          <div className="flex shrink-0 items-baseline gap-2 px-4 pt-1.5 pb-3">
            <h2 className="text-[18px] font-extrabold" style={{ color: INK, letterSpacing: "-0.025em" }}>
              {dealer ? "Change dealer" : "Who is this order for?"}
            </h2>
            <span className="ml-auto shrink-0 font-mono text-[10.5px] uppercase"
                  style={{ color: FAINT, letterSpacing: ".08em" }}>
              Surat depot
            </span>
          </div>
          <p className="shrink-0 px-4 pb-2 text-[12px]" style={{ color: MUTED }}>
            {lines.length} {lines.length === 1 ? "line" : "lines"} in this order — they stay
          </p>
          <div className="shrink-0 px-4 pb-2">
            <CustomerSearchInput value={query} onChange={setQuery} autoFocus />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <CustomerListBody
              customers={customers} mine={mine} query={query}
              currentCode={dealer?.code ?? null}
              onPick={pickDealer}
              onRemove={(code) => setMine(removeMyDealer(code))}
            />
          </div>
        </V2Sheet>
      )}
        {toastHost}
        {sheet === "shipto" && (
          <V2Sheet onClose={() => setSheet(null)}>
            <div className="shrink-0 px-4 pt-1.5 pb-3">
              <h2 className="text-[18px] font-extrabold" style={{ color: INK, letterSpacing: "-0.025em" }}>
                Ship to
              </h2>
              <p className="text-[11.5px]" style={{ color: MUTED }}>
                Where the goods go{dealer ? ` — the bill still goes to ${dealer.name}` : ""}
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
                          style={{ color: shipTo === null ? VIOLET : FAINT }} />
                  <span className="min-w-0 flex-1 truncate text-[14.5px] font-bold" style={{ color: INK }}>
                    Same as billing
                  </span>
                  {shipTo === null && (
                    <Check className="h-4 w-4 shrink-0" strokeWidth={3} style={{ color: VIOLET }} />
                  )}
                </button>
              )}
              {/* 🔴 SHIP-TO REACHES EVERY DEALER IN THE MASTER, by typing. The
                  landing has no all-dealers list by design, but ship-to names a
                  third party the salesman has routinely never ordered FOR —
                  LAKHANI PAINTS shipping against MOHAN COLOUR CO is a real
                  order. Restricting this to his own list would break cross
                  billing, so the fall-through in CustomerListBody is
                  load-bearing here and not a convenience. */}
              <CustomerListBody
                customers={customers} mine={mine} query={query}
                currentCode={shipTo?.code ?? null}
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
      <main
        className="min-h-screen w-full"
        style={{
          background: SURFACE,
          // The nav is always there; the cart bar stacks on top of it when the
          // order has lines. The board has to clear both.
          paddingBottom: `calc(${NAV_H} + ${cartOpen ? 84 : 16}px)`,
        }}
      >
        {/* ── HEADER — one slim row, and it asks nothing ────────────────────
            The mark, then product search. That is the whole board chrome.

            🔴 IT USED TO BE TWO ROWS AND ~109px OF STICKY, carrying a dealer
            name, a chevron and a clear button. All of it is gone with the
            dealer, which buys back more than a full row of products on a 390px
            phone and — the actual point — removes the last thing on this screen
            that could be read as a question. */}
        <div
          className="sticky top-0 z-20 flex items-center gap-2.5 px-4 pt-2.5 pb-2.5"
          style={{ background: SURFACE, borderBottom: `1px solid ${RULE}` }}
        >
          <img
            src="/brand/orbit-wordmark.svg" alt="Orbit"
            width={2216} height={771}
            className="shrink-0"
            style={{ height: 19, width: "auto" }}
          />
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
        {FAMILIES.map((family, familyIndex) => {
          // 🔴 THE FIRST TWO FAMILIES LOAD EAGERLY, EVERYTHING BELOW IS LAZY.
          // Eight tiles are what fits above the fold on a 390px phone, and they
          // are the eight a salesman opens most. Marking all 32 eager would put
          // 577 KB on the wire before the first tap on a depot 5G signal that
          // is 5G on the sign and not in the shed; marking all 32 lazy would
          // leave the first screen visibly empty on arrival, which reads as a
          // broken page rather than a loading one.
          const eager = familyIndex < 2;
          const wash  = mixToWhite(family.tint, TILE_WASH);
          return (
          <section key={family.name} className="px-4" style={{ paddingTop: 18 }}>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="shrink-0 text-[11px] font-bold uppercase"
                  style={{ letterSpacing: ".08em", color: FAINT }}>
                {family.name}
              </h2>
              <span className="h-px flex-1" style={{ background: RULE }} />
            </div>
            <div className="grid grid-cols-4" style={{ gap: 8 }}>
              {family.tiles.map((tile) => {
                const count   = countsByTile[tile.sap] ?? 0;
                const inOrder = count > 0;
                // Null for the eight products with no art. An empty tinted
                // square is the whole treatment — no initials, no dash, no
                // placeholder glyph. A tile that says nothing reads as art that
                // has not arrived; a tile with "CS" in it reads as a decision.
                const src = tileImage(tile.slug);
                return (
                  <button
                    key={tile.sap}
                    type="button"
                    disabled={!ready}
                    // Nothing is asked first. This is the whole interaction.
                    onClick={() => setOpenTile(tile)}
                    className="flex min-w-0 flex-col gap-1.5 text-left"
                    style={{ opacity: ready ? 1 : 0.45 }}
                  >
                    {/* THE SQUARE. No border by design — the art carries the
                        tile and a hairline around 32 of them is a grid of
                        outlines. aspect-ratio holds the space before the image
                        lands, so nothing on the board jumps as they arrive. */}
                    <span
                      className="relative block w-full overflow-hidden rounded-[14px]"
                      style={{ aspectRatio: "1 / 1", background: inOrder ? VIOLET_BG : wash }}
                    >
                      {src && (
                        <img
                          src={src}
                          alt={tile.label}
                          width={600}
                          height={600}
                          decoding="async"
                          loading={eager ? "eager" : "lazy"}
                          className="block h-full w-full"
                          style={{
                            objectFit: "contain",
                            // 🔴 MULTIPLY, NOT A PLAIN PAINT. Every file is an
                            // OPAQUE WHITE square — that is how the converter
                            // pads the tin to a uniform 84% share. Painted
                            // normally it would cover the family wash entirely
                            // and every tile would be a white box. Multiply
                            // leaves the backdrop untouched wherever the file
                            // is white and shows the tin everywhere else, so
                            // the tint survives and the tin sits ON it.
                            mixBlendMode: "multiply",
                          }}
                        />
                      )}
                      {inOrder && (
                        <span
                          className="absolute flex items-center justify-center rounded-full text-[10px] font-extrabold text-white"
                          style={{ top: 4, right: 4, minWidth: 18, height: 18, padding: "0 5px", background: VIOLET }}
                        >
                          {count}
                        </span>
                      )}
                    </span>

                    {/* THE NAME, outside the square. */}
                    <span className="block w-full text-[12px] font-semibold" style={TILE_TEXT_STYLE}>
                      {tile.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
          );
        })}
        </>
        )}
      </main>

      {/* ── BOTTOM BAR ─────────────────────────────────────────────────── */}
      {cartOpen && (
        <div
          className="fixed inset-x-0 z-20 flex items-center gap-3 px-4 py-3"
          style={{
            bottom: NAV_H,
            background: SURFACE,
            borderTop: `1px solid ${RULE}`,
          }}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold" style={{ color: INK }}>
              {lines.length} {lines.length === 1 ? "line" : "lines"}
            </p>
            <p className="truncate font-mono text-[11px]" style={{ color: MUTED }}>{orderUnits} units</p>
          </div>
          <button
            type="button"
            onClick={() => setScreen("review")}
            className="shrink-0 rounded-[13px] px-5 py-3 text-[15px] font-extrabold text-white"
            style={{ background: BRAND }}
          >
            Review order
          </button>
        </div>
      )}

      {/* The nav lives on the BOARD only — never inside a drawer, the review
          screen or the dealer sheet, all of which are their own context. */}
      <BottomNav onNavigate={(next) => setScreen(next)} />
      {toastHost}

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

/**
 * Board / Drafts / Sent. It renders on the board, so Board is always the
 * active item and there is no prop to pass wrong.
 *
 * 🔴 IT COSTS ABOUT 50px OF BOARD AND IS WORTH IT. Without it there is no way
 * at all to reach a saved draft or today's sent orders — po2_saved_drafts and
 * po2_sent_orders would keep being written and could never be read back. That
 * was the regression the old dealer-list screen had been quietly covering.
 */
function BottomNav({ onNavigate }: {
  onNavigate: (screen: "drafts" | "sentList") => void;
}): React.JSX.Element {
  const items: { label: string; icon: typeof Grid2x2; on: boolean; go?: "drafts" | "sentList" }[] = [
    { label: "Board",  icon: Grid2x2,  on: true },
    { label: "Drafts", icon: FileText, on: false, go: "drafts" },
    { label: "Sent",   icon: Send,     on: false, go: "sentList" },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 flex pt-2"
      style={{
        background: SURFACE,
        borderTop: `1px solid ${RULE}`,
        paddingBottom: "max(env(safe-area-inset-bottom), 8px)",
      }}
    >
      {items.map(({ label, icon: Icon, on, go }) => (
        <button
          key={label} type="button"
          onClick={() => go && onNavigate(go)}
          className="flex flex-1 flex-col items-center gap-0.5"
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={2.5} style={{ color: on ? VIOLET : FAINT }} />
          <span className="text-[10px] font-extrabold" style={{ color: on ? VIOLET : FAINT }}>
            {label}
          </span>
        </button>
      ))}
    </nav>
  );
}
