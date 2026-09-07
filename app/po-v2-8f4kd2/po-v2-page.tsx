"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, ChevronLeft, FileText, Grid2x2, MapPin, Send, ShoppingCart } from "lucide-react";
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
  loadStarred, toggleStarred, type V2Star,
  saveLiveDraft, snapshotOf, upsertSavedDraft,
  type V2SavedDraft, type V2SentOrder, type V2Snapshot,
} from "./v2-storage";
import {
  BOARD, BRAND, BRAND_GRADIENT, BRAND_WASH, CARD_SHADOW, DIVIDER, FAINT,
  FILL, INK, MUTED, PAGE, RULE, SURFACE, URGENT, VIOLET, VIOLET_BG,
  EMPTY_ORDER, boardTile, buildBoard, buildCatalog, drawerMode, formatPack,
  mixToWhite, optionPools, packRows, resolveGroup, tileImage, tileKeyForMember,
  unitsIn, TILE_WASH,
  type ApiCustomer, type ApiPayload, type ApiProduct,
  type V2BoardTile, type V2CartLine, type V2Order, type V2Resolved,
  type V2ResolvedMember, type V2ResolvedTile,
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
// SEVEN SCREENS, ONE URL: board, review, the dealer picker, ship-to,
// sent-confirmation, saved drafts, sent-today. All switched by state, not
// routing, so the fetched catalog and the order survive every switch with no
// store and no reload.
//
// 🔴 THE TWO PICKERS ARE SCREENS AND NOT SHEETS, deliberately. A bottom sheet
// has to be sized against something, and with the iOS soft keyboard up the
// thing it was sized against was the wrong viewport — twice, across two rounds.
// A page has no such problem.
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
  | { kind: "ready"; customers: ApiCustomer[]; products: ApiProduct[];
      byTile: Map<string, V2Resolved>;
      /** The 9x4 board, EVERY MEMBER RESOLVED ON ITS OWN ROWS (buildBoard). */
      board: Map<string, V2ResolvedTile> };

type Screen = "order" | "review" | "dealer" | "shipto" | "sent" | "drafts" | "sentList";
type Sheet  = null | "clear" | "replace" | "summary";

export default function PoV2Page(): React.JSX.Element {
  const [load, setLoad]       = useState<LoadState>({ kind: "loading" });
  const [screen, setScreen]   = useState<Screen>("order");
  const [dealer, setDealer]   = useState<ApiCustomer | null>(null);
  const [starred, setStarred] = useState<V2Star[]>([]);
  const [query, setQuery]     = useState("");
  const [sheet, setSheet]     = useState<Sheet>(null);
  const [prodQuery, setProdQuery] = useState("");
  /**
   * 🔴 A TILE PLUS WHICH MEMBER TO OPEN ON. A merged tile has no single
   * product, so "which tile" is no longer enough to open a drawer.
   *
   * A board tap sets `initialMember` to members[0] — the top seller, which is
   * why members are ranked. A SEARCH sets it to the product actually searched
   * for, so typing "wood primer" lands on Wood Primer and not on whichever
   * member happens to lead the Primers tile.
   */
  const [openTile, setOpenTile] =
    useState<{ tile: V2BoardTile; initialMember: string } | null>(null);
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
   * Writes the visual viewport's HEIGHT into --vvh and its OFFSET into --vvo.
   * v2-sheet's overlay consumes both.
   *
   * 🔴 THE OFFSET IS THE HALF THAT WAS MISSING, and it is what broke the
   * product drawer when the number keypad opened. `position: fixed` lays out
   * against the LAYOUT viewport. When the keypad opens for an input near the
   * BOTTOM of the screen, iOS scrolls the VISUAL viewport down inside the
   * layout viewport to lift that input clear of the keys — visualViewport
   * .offsetTop. Nothing read it, so the overlay stayed pinned to a layout-top
   * that was now off screen and its bottom edge landed offsetTop pixels above
   * the real bottom, showing the board through the gap.
   *
   * The dealer sheet looked fixed by height alone only because its search box
   * is at the TOP of the sheet, so iOS never had to scroll for it.
   *
   * 🔴 THIS IS CLAUDE_UI.md §55's MECHANISM, NOT A SECOND ONE. /po has carried
   * it since /order was retired; the SSR fallback `html { --vvh: 100vh }` lives
   * in app/globals.css and `interactiveWidget: "resizes-content"` — what makes
   * Chromium SHRINK the layout viewport instead of overlaying it — is in
   * app/layout.tsx's app-wide viewport export. Both are inherited here and
   * neither is edited. What v2 was missing is only the WRITER, because /po's
   * lives inside /po's own component and never runs on this route.
   *
   * Straight to documentElement.style, NEVER React state: this fires on every
   * keyboard ramp frame and a setState here would be a render storm.
   *
   * Listens to BOTH resize AND scroll. On an iOS standalone PWA the keyboard
   * does not emit a clean resize — its final geometry arrives as a
   * visualViewport scroll/offset adjustment — so resize alone leaves --vvh at
   * the pre-keyboard height, which is exactly the bug this fixes.
   *
   * The h === lastH guard matters: a plain scroll reports an unchanged height,
   * and rewriting the property on every scroll tick churns the sheet's height
   * under the salesman's thumb.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    let lastH = -1;
    let lastT = -1;
    const update = (): void => {
      const h = vv ? vv.height : window.innerHeight;
      const t = vv ? vv.offsetTop : 0;
      // The guard matters: a plain scroll reports both unchanged, and rewriting
      // on every scroll tick churns the overlay's geometry under his thumb.
      if (h === lastH && t === lastT) return;
      lastH = h; lastT = t;
      const root = document.documentElement.style;
      root.setProperty("--vvh", `${h}px`);
      root.setProperty("--vvo", `${t}px`);
    };
    update();
    if (vv) {
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
    } else {
      window.addEventListener("resize", update);
    }
    return () => {
      if (vv) {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
      } else {
        window.removeEventListener("resize", update);
      }
      // Hand the property back to globals.css's 100vh rather than leaving a
      // stale pixel height behind for whatever renders next.
      document.documentElement.style.removeProperty("--vvh");
      document.documentElement.style.removeProperty("--vvo");
    };
  }, []);

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
      // 🔴 EVERY MEMBER RESOLVED SEPARATELY. buildBoard calls drawerMode,
      // optionPools and resolveGroup once per member on that member's own
      // rows — never on the union of a tile's members, which returns the
      // wrong mode for 12 of the 17 merged tiles.
      const board = buildBoard(data.products);
      // The catalog gate, kept live: the curated option lists are a snapshot
      // of 90 days of orders and the catalog moves underneath them, so a
      // reseed can invalidate a chip at any time.
      if (
        report.missingOptions.length || report.zeroRowTiles.length ||
        report.emptyPackChips.length || report.droppedDupes.length
      ) {
        console.warn("[po-v2] catalog gate", report);
      }
      if (board.report.missingMembers.length || board.report.emptyMembers.length) {
        console.warn("[po-v2] board gate", board.report);
      }
      setLoad({
        kind: "ready", customers: data.customers ?? [], products: data.products,
        byTile, board: board.byKey,
      });

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
    setStarred(loadStarred());
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

  /**
   * Open the dealer picker. One entry point, so the query is always cleared.
   *
   * 🔴 IT IS A SCREEN, NOT A SHEET. Two rounds were spent trying to make a
   * bottom sheet behave with the iOS keyboard — first it opened blank with its
   * content pushed off the top, then it needed --vvh sizing to stop doing that.
   * A full screen has none of those problems because there is nothing to size
   * against: the page scrolls, the keyboard shrinks the viewport, and the
   * browser does what it already knows how to do. It is also the structure the
   * product search and the drafts and sent screens already use, so this is the
   * pattern repeated rather than a fourth one invented.
   */
  function openDealerSheet(): void { setQuery(""); setScreen("dealer"); }

  /**
   * Empty the cart and go back to the board — but KEEP THE DEALER.
   *
   * He is standing in the same shop; the order was wrong, the customer was not.
   * Making him name the dealer again would punish a correction. Everything that
   * belongs to the ORDER goes: lines, dispatch, remark, notes and the ship-to
   * override, because a stale "ship to LAKHANI" surviving a clear is exactly the
   * kind of leftover that reaches a lorry.
   *
   * The reopened-draft id is dropped too, so the next Save draft files a new
   * draft rather than overwriting the one he had open.
   */
  function clearOrder(): void {
    setLines([]);
    setOrder(EMPTY_ORDER);
    setShipTo(null);
    openDraftIdRef.current = null;
    setSheet(null);
    setScreen("order");
  }

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
   * Commit a whole drawer visit: one cart line per option carrying a quantity.
   *
   * `packOrder` is snapshotted here from the ROW's pack array, which the
   * payload has already sorted into catalog order (route.ts:21-28). The qtys
   * Record's key order is the order the salesman tapped — fine for a total,
   * wrong for the printed pack string, and the email has to match /po byte for
   * byte. The WIRE name is built by emailLineLabel from product / baseColour /
   * subProduct, never from `label`, which is the curated board word.
   */
  function addLines(
    tileKey: string,
    labelOf: (row: ApiProduct) => string,
    picks: { option: string | null; row: ApiProduct; qtys: Record<string, number> }[],
    /**
     * ⚠ INTERIM SCOPE — the member whose picks these are, or null for the
     * search path that has no tile.
     *
     * REPLACE-BY-TILE IS THE DESTINATION, NOT TODAY'S BEHAVIOUR. The drawer
     * returns the complete edited set for whatever it was showing, and today
     * it shows ONE member. Replacing every line on the tile would therefore
     * delete the siblings the drawer never showed him — edit PU Prime Matt
     * and PU Prime Gloss silently vanishes from the order. So the replace is
     * scoped to the member, using the row identity already on the line.
     *
     * The seed (existingFor) uses the IDENTICAL predicate, so a line is never
     * written under one key and looked up under another and a duplicate
     * cannot appear. Step 4 widens both to the whole tile in one edit, when
     * the drawer starts returning every member's picks.
     */
    memberSap: string | null,
  ): void {
    // 🔴 REPLACE, NOT APPEND. The drawer opens SEEDED from whatever this
    // product already has in the cart, so what comes back is the complete,
    // edited set for it — every option he still wants, at the quantity he now
    // wants. Appending would double every line he merely looked at.
    //
    // Dropping an option in the drawer therefore deletes its line, which is the
    // only behaviour that makes the seeding honest: what he sees is what he
    // gets, including what he took away.
    setLines((prev) => {
      const kept = prev.filter((l) => !(
        l.tileSap === tileKey &&
        (memberSap === null || (l.product ?? l.subProduct) === memberSap)));
      const built: V2CartLine[] = picks.map((p, i) => {
        const qtys: Record<string, number> = {};
        for (const [packLabel, qty] of Object.entries(p.qtys)) if (qty > 0) qtys[packLabel] = qty;
        return {
          id: `${tileKey}-${Date.now()}-${i}`,
          // 🔴 tileSap IS THE TILE KEY; label IS THE MEMBER'S OWN NAME.
          // The review screen renders `label` as the product name, so a
          // merged tile must not print "Primers" where he needs "Wood
          // Primer". The label is derived from the ROW, not from what the
          // drawer was told, so it stays right when Step 4 lets one visit
          // touch several members.
          //
          // product / baseColour / subProduct are untouched: they are
          // snapshotted from the member's own menu row and they are the
          // three fields emailLineLabel reads. Nothing here reaches the wire.
          tileSap: tileKey, label: labelOf(p.row), option: p.option, rowId: p.row.id, qtys,
          packOrder: p.row.packs.map((pk) => formatPack(pk.packCode, pk.unit)),
          product: p.row.product, baseColour: p.row.baseColour, subProduct: p.row.subProduct,
        };
      });
      return [...kept, ...built];
    });
    setOpenTile(null);
    setOpenGroup(null);
  }

  /**
   * What the drawer opens SEEDED from — and it must be the same set addLines
   * will replace, or the two disagree and a duplicate appears that nobody can
   * see. The predicate is copied from addLines deliberately; when Step 4
   * widens one it widens both.
   */
  function existingFor(
    tileKey: string, memberSap: string | null,
  ): { option: string | null; qtys: Record<string, number> }[] {
    return lines
      .filter((l) => l.tileSap === tileKey &&
        (memberSap === null || (l.product ?? l.subProduct) === memberSap))
      .map((l) => ({ option: l.option, qtys: l.qtys }));
  }

  /** A row -> the label of the member it belongs to, for the cart line. */
  function memberLabelIn(tile: V2BoardTile): (row: ApiProduct) => string {
    return (row) => {
      const sap = row.product ?? row.subProduct;
      return tile.members.find((m) => m.sap === sap)?.label ?? tile.label;
    };
  }

  /**
   * A search hit opens its TILE when it has one, positioned on the product he
   * actually searched for.
   *
   * 🔴 THE LOOKUP IS DERIVED (tileKeyForMember), never a hand-written map.
   * Under Scheme A a tile's key IS its top member's sap, so the key moves the
   * day sales reorder the members — and a hard-coded table would be right for
   * exactly one ranking. A product on NO tile keeps today's behaviour to the
   * letter: its own resolution, its own drawer.
   */
  function openSearchHit(group: V2ProductGroup): void {
    const key = tileKeyForMember(group.key);
    const tile = key === null ? null : boardTile(key);
    if (tile) setOpenTile({ tile, initialMember: group.key });
    else setOpenGroup(group);
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
    // 🔴 SENDING DOES NOT STAR ANYBODY. The list used to build itself here, and
    // then had no way to take anything off it again. He stars a dealer himself,
    // with one tap, and that same tap is the remove.

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
  /**
   * The tile that is open, and the ONE member the drawer is showing.
   *
   * ⚠ INTERIM — product-drawer.tsx still knows exactly one product, and it is
   * Step 4's file. So a merged tile hands it ONE member and reaches only that
   * one: members[0] from a board tap, or the searched member from a search
   * hit. Step 4 gives the drawer its member column and this collapses to
   * handing it the whole tile. Do not read the single-member hand-off as the
   * design — it is scaffolding with a date on it.
   */
  const openResolved = ready && openTile ? load.board.get(openTile.tile.key) ?? null : null;
  const openMember: V2ResolvedMember | null = openResolved
    ? (openResolved.members.find((m) => m.sap === openTile?.initialMember)
       ?? openResolved.members[0] ?? null)
    : null;
  // A searched PRODUCT resolves to its curated chips when it is one of the 32,
  // and to its own payload options (sortOrder, capped) when it is not.
  const tileLabelFor = (key: string): string | undefined =>
    ready ? load.byTile.get(key)?.label : undefined;
  const groupResolved = ready && openGroup
    ? resolveGroup(openGroup.key, openGroup.rows,
                   tileLabelFor(openGroup.key) ?? openGroup.best.displayName, load.byTile)
    : null;
  // 🔴 THE OPEN MEMBER'S OWN mode AND pools, CARRIED FROM buildBoard.
  // Nothing here recomputes them, and nothing here may: the only shape a
  // caller with a tile in hand can reach for is the union, and the union is
  // wrong. V2ResolvedMember exists so that temptation has no target.
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
        <Wordmark size={44} colour="#FFFFFF" />
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
          onClearOrder={() => setSheet("clear")}
          onOpenShipTo={() => { setQuery(""); setScreen("shipto"); }}
        />
        {/* ── CLEAR CONFIRM — asked once, and only from the review header ───
            🔴 THIS IS WHERE THE URGENT COLOUR LIVES. The trigger upstairs is
            quiet text; the solid red is here, on a button nobody reaches
            without having already decided.

            Keep is on the LEFT and outlined, Clear on the right and solid. The
            two are the same size on purpose — the confirm is the protection,
            and shrinking the option he just asked for would be arguing with
            him rather than checking. */}
        {sheet === "clear" && (
          <V2Sheet
            onClose={() => setSheet(null)}
            footer={
              <>
                <button
                  type="button" onClick={() => setSheet(null)}
                  className="min-w-0 flex-1 rounded-[13px] py-3 text-[15px] font-extrabold"
                  style={{ border: `1.5px solid ${RULE}`, color: INK }}
                >
                  Keep
                </button>
                <button
                  type="button" onClick={clearOrder}
                  className="min-w-0 flex-1 rounded-[13px] py-3 text-[15px] font-extrabold text-white"
                  style={{ background: URGENT }}
                >
                  Clear
                </button>
              </>
            }
          >
            <div className="shrink-0 px-4 pt-1.5 pb-4">
              <h2 className="text-[18px] font-extrabold" style={{ color: INK, letterSpacing: "-0.025em" }}>
                Clear all {lines.length} {lines.length === 1 ? "item" : "items"}?
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed" style={{ color: MUTED }}>
                {dealer
                  ? `The order empties and you go back to the board. ${dealer.name} stays.`
                  : "The order empties and you go back to the board."}
              </p>
            </div>
          </V2Sheet>
        )}

        {toastHost}
      </>
    );
  }

  // ══ SCREEN — THE DEALER PICKER ═══════════════════════════════════════════
  // A full screen, reached from review and returning to it. Same shell as
  // Drafts and Sent: back arrow, title, and the search directly under it.
  if (screen === "dealer") {
    return (
      <>
        <PickerScreen
          title={dealer ? "Change dealer" : "Who is this order for?"}
          note={`${lines.length} ${lines.length === 1 ? "line" : "lines"} in this order — they stay`}
          query={query} onQuery={setQuery}
          onBack={() => { setQuery(""); setScreen("review"); }}
        >
          <CustomerListBody
            customers={customers} starred={starred} query={query}
            currentCode={dealer?.code ?? null}
            onPick={pickDealer}
            onToggleStar={(c) => setStarred(toggleStarred(c))}
          />
        </PickerScreen>
        {toastHost}
      </>
    );
  }

  // ══ SCREEN — SHIP TO ═════════════════════════════════════════════════════
  if (screen === "shipto") {
    return (
      <>
        <PickerScreen
          title="Ship to"
          note={dealer ? `Where the goods go — the bill still goes to ${dealer.name}` : "Where the goods go"}
          query={query} onQuery={setQuery}
          onBack={() => { setQuery(""); setScreen("review"); }}
        >
          {/* A FIXED first row for the default, so "same as billing" is a thing
              you can pick your way back to, not just the absence of a choice.
              Hidden while searching — it is not a search hit. */}
          {query.trim().length === 0 && (
            <button
              type="button"
              onClick={() => { setShipTo(null); setQuery(""); setScreen("review"); }}
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
              starred list is his own shortlist, but ship-to names a third party
              he has routinely never ordered FOR — LAKHANI PAINTS shipping
              against MOHAN COLOUR CO is a real order. Restricting this would
              break cross billing. */}
          <CustomerListBody
            customers={customers} starred={starred} query={query}
            currentCode={shipTo?.code ?? null}
            onPick={(c) => { setShipTo(c); setQuery(""); setScreen("review"); }}
            onToggleStar={(c) => setStarred(toggleStarred(c))}
          />
        </PickerScreen>
        {toastHost}
      </>
    );
  }

  // ══ SCREEN 2 — THE BOARD ═════════════════════════════════════════════════
  return (
    <>
      <main
        className="min-h-screen w-full"
        style={{
          // 🔴 THE BOARD IS A GROUND, NOT A SURFACE. The app has been one flat
          // white plane since it was built; depth is what a surface sitting
          // ABOVE a ground gives you, and it is why every quick-commerce app
          // reads as finished rather than as a wireframe. #FAFAFC is barely a
          // colour — it only has to be different enough for a white card to
          // have an edge without needing a border.
          background: PAGE,
          // The nav is always there; the cart bar stacks on top of it when the
          // order has lines. The board has to clear both.
          paddingBottom: `calc(${NAV_H} + ${cartOpen ? 84 : 16}px)`,
        }}
      >
        {/* ── THE BAND ─────────────────────────────────────────────────────
            🔴 THE SEARCH LIVES INSIDE THE VIOLET, NOT UNDER IT. With the bar on
            white below the wash, the violet read as a STRIPE — a band of colour
            with no job, sitting between a logo and a control. A header is a
            region that holds the things you identify and navigate with, so it
            holds both: the name and the depot on one row, the search on the
            next, and the catalogue starts where the colour stops.

            The bar itself stays WHITE with its border and shadow. A violet
            control on a violet ground would disappear; white on the wash is
            what makes it read as a thing sitting ON the header rather than a
            hole cut into it.

            TWO BLOCKS, ONE BAND. The brand row scrolls away — a logo does not
            need to follow a salesman down a page — and the search stays,
            keeping its slice of #F5F3FF behind it so that alone at the top it
            is still the header and not a box floating over the tiles. */}
        <div
          className="px-4"
          style={{
            background: BRAND_WASH,
            // 🔴 PADDING, NOT MARGIN. The colour has to run UNDER the status bar
            // and the content has to sit below it. A margin would push the whole
            // band down and leave the strip above it unpainted — which is the
            // white bar that made this read as a stripe stuck to the page.
            paddingTop: "calc(env(safe-area-inset-top) + 16px)",
          }}
        >
          {/* The wordmark alone. SURAT DEPOT is gone: the search below now
              fills the band, so the row does not need balancing, and the depot
              label was the one thing here nobody was reading. */}
          <Wordmark size={31} colour={BRAND} />
        </div>

        <div
          className="sticky top-0 z-20 px-4"
          style={{
            background: BRAND_WASH,
            borderBottom: `1px solid ${RULE}`,
            paddingTop: 12,
            paddingBottom: 16,
          }}
        >
          <ProductSearchInput value={prodQuery} onChange={setProdQuery} />
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
              onPick={openSearchHit}
            />
          </div>
        ) : (
        <>
        {/* ── FAMILY BLOCKS ────────────────────────────────────────────── */}
        {BOARD.map((family, familyIndex) => {
          // 🔴 THE FIRST TWO FAMILIES LOAD EAGERLY, EVERYTHING BELOW IS LAZY.
          // Eight tiles are what fits above the fold on a 390px phone, and they
          // are the eight a salesman opens most. Marking all 36 eager would put
          // 560 KB on the wire before the first tap on a depot 5G signal that
          // is 5G on the sign and not in the shed; marking all 36 lazy would
          // leave the first screen visibly empty on arrival, which reads as a
          // broken page rather than a loading one.
          const eager = familyIndex < 2;
          const wash  = mixToWhite(family.tint, TILE_WASH);
          return (
          <section
            className="mx-4"
            style={{
              marginTop: 11,
              background: SURFACE,
              borderRadius: 16,
              padding: "12px 11px 13px",
              boxShadow: CARD_SHADOW,
            }}
          >
            {/* The name lives INSIDE the card now, in sentence case and at
                reading size. The uppercase 11px label with a hairline running
                off to the right was a section divider on a flat page; on a card
                the card IS the division, so the label can go back to being a
                name. The rule is deleted, not hidden. */}
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <h2 className="min-w-0 truncate text-[14px] font-bold" style={{ color: INK }}>
                {family.name}
              </h2>
              <span
                className="shrink-0 rounded-full font-mono text-[10px]"
                style={{ color: FAINT, background: FILL, padding: "2px 7px" }}
              >
                {family.tiles.length}
              </span>
            </div>
            <div className="grid grid-cols-4" style={{ gap: 7 }}>
              {family.tiles.map((tile) => {
                const count   = countsByTile[tile.key] ?? 0;
                const inOrder = count > 0;
                // Null for the eight products with no art. An empty tinted
                // square is the whole treatment — no initials, no dash, no
                // placeholder glyph. A tile that says nothing reads as art that
                // has not arrived; a tile with "CS" in it reads as a decision.
                const src = tileImage(tile.slug);
                return (
                  <button
                    // 🔴 key ON THE TILE KEY, NOT A MEMBER SAP. Two merged
                    // tiles could share a leading member after a re-rank, and
                    // a stale React key leaks one drawer's state into the
                    // next.
                    key={tile.key}
                    type="button"
                    disabled={!ready}
                    // Nothing is asked first. This is the whole interaction.
                    // A board tap opens on members[0] — the top seller, which
                    // is the whole reason members are ranked.
                    onClick={() => setOpenTile({ tile, initialMember: tile.members[0].sap })}
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

      {/* ── BOTTOM BAR ───────────────────────────────────────────────────
          🔴 FLUSH AGAINST THE NAV — one block of two rows, the way every
          delivery app does it. `bottom: NAV_H` puts its bottom edge exactly on
          the nav's top edge, and neither carries a shadow, so there is no seam
          and nothing floats. The nav's own top hairline is the divider BETWEEN
          the two rows; this border is the outer edge of the block. */}
      {cartOpen && (
        <div
          className="fixed inset-x-0 z-20 flex items-center gap-3 px-4"
          style={{
            bottom: NAV_H,
            height: 64,
            background: SURFACE,
            borderTop: `1px solid ${RULE}`,
          }}
        >
          {/* A small tile, not a floating glyph — it gives the count something
              to sit against and makes the bar read as one object. */}
          <span
            className="flex shrink-0 items-center justify-center"
            style={{ width: 36, height: 36, borderRadius: 10, background: VIOLET_BG }}
          >
            <ShoppingCart className="h-[18px] w-[18px]" strokeWidth={2.2} style={{ color: VIOLET }} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-bold leading-tight" style={{ color: INK }}>
              {lines.length} {lines.length === 1 ? "line" : "lines"}
            </p>
            {/* 🔴 THE DEALER, NOT THE UNIT COUNT. "85 units" was a number
                nobody acts on from here — he cannot change it on this bar and
                the review screen totals it anyway. WHO the order is for is the
                thing he actually wants confirmed while he keeps adding, and it
                is the one fact the board itself no longer shows anywhere. */}
            <p className="truncate text-[11.5px] leading-tight" style={{ color: MUTED }}>
              {dealer ? dealer.name : "No dealer yet"}
            </p>
          </div>
          {/* 🔴 NO X AND NO CLEAR HERE. Clearing an order lives once, in the
              review header, behind a confirm. A second door onto a destructive
              action — and this one sitting under the thumb on every screen —
              is how an order gets emptied by accident. */}
          {/* A compact pill, not a full-width block: the bar's job is to say
              what is in the basket, and one short word is enough to open it. */}
          <button
            type="button"
            onClick={() => setScreen("review")}
            className="shrink-0 rounded-full px-5 py-2 text-[14px] font-extrabold text-white"
            style={{ background: BRAND }}
          >
            View
          </button>
        </div>
      )}

      {/* The nav lives on the BOARD only — never inside a drawer, the review
          screen or the dealer sheet, all of which are their own context. */}
      <BottomNav onNavigate={(next) => setScreen(next)} />
      {toastHost}

      {/* ── PRODUCT DRAWER, from the BOARD ─────────────────────────────── */}
      {/* ⚠ INTERIM, AND STEP 4 REPLACES IT. product-drawer.tsx knows exactly
          one product and is not this step's file, so a merged tile hands it
          ONE member — members[0] from a board tap, the searched product from
          a search hit — and the tile's other members are unreachable from the
          board until the drawer grows its member column. That is scaffolding,
          not the design.

          `key` carries the member too: switching member inside one tile must
          give a fresh drawer, or the previous member's quantities leak into
          the next one's packs. */}
      {openTile && openMember && (
        <ProductDrawer
          key={`${openTile.tile.key}::${openMember.sap}`}
          product={openMember}
          onClose={() => setOpenTile(null)}
          onAdd={(picks) => addLines(
            openTile.tile.key, memberLabelIn(openTile.tile), picks, openMember.sap)}
          existing={existingFor(openTile.tile.key, openMember.sap)}
          pools={openMember.pools}
          mode={openMember.mode}
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
          onAdd={(picks) => addLines(
            groupResolved.sap, () => groupResolved.label, picks, null)}
          existing={existingFor(groupResolved.sap, null)}
          pools={groupPools}
          mode={groupMode}
        />
      )}
    </>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

/**
 * The shell both dealer pickers share: back arrow, title, a note, and the
 * search input under them — all sticky, because on a screen whose whole purpose
 * is search the box is the last thing that should scroll away.
 *
 * 🔴 A SCREEN, NOT A SHEET, AND THAT IS THE FIX. A bottom sheet has to be
 * sized against something, and with the soft keyboard up the thing it was
 * sized against was the wrong viewport — twice. A page has no such problem:
 * the keyboard shrinks the viewport, the page scrolls, and the browser handles
 * it without being told. Same shell as Drafts and Sent.
 */
function PickerScreen({ title, note, query, onQuery, onBack, children }: {
  title: string;
  note: string;
  query: string;
  onQuery: (next: string) => void;
  onBack: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <main className="min-h-screen w-full" style={{ background: SURFACE, paddingBottom: 24 }}>
      <div className="sticky top-0 z-10 px-2 pt-2 pb-2"
           style={{ background: SURFACE, borderBottom: `1px solid ${RULE}` }}>
        <div className="flex items-center gap-1">
          <button
            type="button" aria-label="Back" onClick={onBack}
            className="flex h-9 w-9 shrink-0 items-center justify-center"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.5} style={{ color: INK }} />
          </button>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[17px] font-extrabold"
                  style={{ color: INK, letterSpacing: "-0.02em" }}>
              {title}
            </span>
            <span className="block truncate text-[11.5px]" style={{ color: MUTED }}>{note}</span>
          </span>
        </div>
        <div className="px-2 pt-2">
          {/* 🔴 NO autoFocus, DELIBERATELY. Focusing on mount raised the
              keyboard every single time this screen opened, which shrank the
              window before he had even looked at it — and most of the time he
              is not typing at all, he is tapping a starred dealer that is
              already on screen. The keyboard now comes up when he taps the box,
              which is when he actually wants it. */}
          <CustomerSearchInput value={query} onChange={onQuery} />
        </div>
      </div>
      {children}
    </main>
  );
}

/**
 * "Orbit", set as TEXT.
 *
 * 🔴 IT USED TO BE AN SVG OF FIVE HAND-CONSTRUCTED PATHS, AND IT READ "0rbit".
 * The O was very nearly a perfect circle, which is what a zero is; a real
 * typeface draws a capital O slightly narrower than it is tall and with the
 * stroke thinned at the top and bottom, and those are the cues that stop the
 * eye calling it a digit. Constructed letterforms looked fine at 512px on the
 * app icon and wrong at 26px in a header, and no amount of tuning the geometry
 * was going to beat a face that was drawn by someone.
 *
 * Plus Jakarta Sans is already loaded by app/layout.tsx via next/font and
 * exposed as --font-sans, which tailwind maps to the font-sans class. So this
 * costs no request and nothing outside this folder.
 *
 * 🔴 #7C3AED, NOT the brand doc's #5B21B6 — a DELIBERATE divergence. brand.800
 * reads as a bruise on a white working screen; brand.600 stays a brand colour
 * at 26px on white. The doc is wrong on that line and is being corrected. Do
 * not "fix" this back.
 *
 * The OUTLINED SVG STILL EXISTS and is still correct where it is used: the app
 * icon PNGs and anything printed, where the font cannot be guaranteed to be
 * present. It is only in-app rendering that never needed it.
 */
function Wordmark({ size, colour }: { size: number; colour: string }): React.JSX.Element {
  return (
    <span
      className="block font-sans font-bold"
      style={{
        fontSize: size,
        // An explicit line box, so the header's height is a number we chose
        // rather than whatever the face's default leading happens to be.
        lineHeight: `${Math.round(size * 1.08)}px`,
        letterSpacing: "-0.045em",
        color: colour,
      }}
    >
      Orbit
    </span>
  );
}

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
