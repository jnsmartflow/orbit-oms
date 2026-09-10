"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, ChevronLeft, FileText, Grid2x2, MapPin, Send, Settings, ShoppingCart, Star } from "lucide-react";
// 🔴 CONTAINMENT EXCEPTION 2 — the SPLASH's mark, read-only, never modified.
// See the note below on why the earliest paint cannot use live text.
import { OrbitWordmark } from "@/components/shared/orbit-wordmark";
import ProductDrawer from "./product-drawer";
import V2Sheet, { useBodyScrollLock } from "./v2-sheet";
import { CustomerListBody, CustomerSearchInput } from "./customer-list";
import { MIN_QUERY, ProductResults, ProductSearchInput, type V2ProductGroup } from "./product-search";
import ReviewScreen, { type V2ReviewSheet } from "./review-screen";
import { buildV2Email, buildV2MailtoUrl } from "./v2-email";
import { DraftsScreen, SentScreen } from "./drafts-sent";
import OrderDetail, { ATTENTION, ATTENTION_BG, NAV_H, belowNav } from "./order-sheet";
import {
  addSentOrder, clearLiveDraft, draftDisplayName, labelFor, loadLiveDraft, loadSavedDrafts,
  loadSentOrders, newDraftId, newSentId, removeSavedDraft, renameSavedDraft,
  formatSavedAt, formatTime,
  loadStarred, toggleStarred, type V2Star,
  addFavProduct, isFavProduct, loadFavProducts, removeFavProduct, type V2FavProduct,
  saveLiveDraft, snapshotOf, upsertSavedDraft,
  type V2SavedDraft, type V2SentOrder, type V2Snapshot,
} from "./v2-storage";
import {
  BOARD, BRAND, BRAND_WASH, CARD_SHADOW, DIVIDER, FAINT,
  FAVOURITE, FILL, INK, MUTED, PAGE, RULE, SCREEN_TITLE, SEARCH_BG, SURFACE, URGENT, VIOLET,
  VIOLET_BG,
  CUTOUT_SHADOW, TRANSPARENT_ART,
  EMPTY_ORDER, boardTile, boardTileArtFor, buildBoard, buildCatalog, drawerMode,
  formatPack, mixToWhite, optionPools, packRows,
  resolveGroup, tileImage, tileKeyForMember, unitsIn, TILE_WASH,
  type ApiCustomer, type ApiPayload, type ApiProduct,
  type V2BoardTile, type V2CartLine, type V2Order, type V2Resolved,
  type V2ResolvedMember, type V2ResolvedTile,
} from "./v2-data";

// Hidden v2 salesman order page — the whole app, on one route.
//
// 🔴 CONTAINMENT — imports its own siblings, node_modules, and TWO documented
// exceptions, both read-only:
//
//   1. lib/place-order's email + ranking helpers. Reimplementing the wire
//      format would drift from /po the first time somebody edited the original,
//      and the drift would be silent — the mail still sends, the parser just
//      stops recognising the product.
//
//   2. components/shared/orbit-wordmark — THE SPLASH ONLY, and the reason is
//      that THE SPLASH CANNOT WAIT FOR A FONT. It is the earliest paint in the
//      app, and the local Wordmark below is live text in Plus Jakarta Sans
//      loaded with `display: "swap"` — so on a cold start the first thing a
//      salesman sees is the word set in his phone's system face, which then
//      swaps under him. The shared component is outlined PATH data and has no
//      such moment. The BOARD MASTHEAD keeps the local text deliberately: by
//      the time the board renders the font has arrived, and the masthead is
//      the one place a size can be nudged without anyone noticing it drift
//      from ten other screens.
//
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

/**
 * The wordmark size in the MASTHEAD BAND — the violet-wash header block.
 *
 * ⚠ IT HAS EXACTLY ONE CONSUMER: the board masthead. It briefly had two —
 * cd85e189 put the wordmark in the dealer-picker band as well — and that was
 * reverted the same day, because a picker band has to identify a SCREEN and a
 * logo cannot. Do not read the singular as dead code and delete it: the
 * constant is what stops the board's 31 from being re-typed as a literal, and
 * the board is the one place a stray nudge would be noticed last.
 *
 * ⚠ THE SPLASH IS NOT A MASTHEAD and does not use this. It renders the
 * wordmark alone and centred on a full-bleed gradient at 44px in white, which
 * is a different job at a different scale — routing it through this constant
 * would shrink the splash the next time somebody adjusts a header.
 */
export const MASTHEAD_WORDMARK = 31;

/**
 * The SPLASH mark's size, in INK HEIGHT — the unit OrbitWordmark takes.
 *
 * 🔴 IT IS NOT 44, AND 44 IS NOT WRONG EITHER. They are the same mark at the
 * same visual size stated in two different units, and the conversion is the
 * whole point of this constant existing rather than a literal:
 *
 *     44px font size  x  0.769  =  33.8px of ink
 *
 * `OrbitWordmark`'s viewBox is cut tight to the letters — 769 units of a
 * 1000-unit em — so its `height` measures INK, while the local Wordmark's
 * `size` measures TYPE. CLAUDE_UI.md:411-416 states the ratio and ends with
 * "anyone specifying this component in px must say which of the two they
 * mean", because a cut of the login page once passed 66 for 45 and rendered a
 * third too big. Passing 44 here would have made the same mistake.
 *
 * ⚠ IT IS DELIBERATELY NOT SHARED WITH MASTHEAD_WORDMARK. That one is a font
 * size for a different component; these two constants are not interchangeable
 * and must never be pointed at each other.
 */
export const SPLASH_WORDMARK_INK = 33.8;

/**
 * THE SPLASH MOTION — "Trail", per docs/mockups/po-v2/splash-motion.html.
 *
 * A dot runs the width of the word dragging a fading gradient tail behind it,
 * and the tail resolves into the solid rule that is the end state. Three layers
 * under the wordmark, 640ms end to end: the mark is readable at 380ms and the
 * line has landed at 640ms.
 *
 * 🔴 EVERY KEYFRAME AND EASING IS LIFTED VERBATIM from that file's "The motion,
 * ready to lift" block. They were reviewed and approved as a set; the delays
 * are what make the tail hand over to the rule cleanly, so nudging one number
 * breaks the handover rather than adjusting it. If the motion needs to change,
 * change the mockup, look at it, and then copy it here again.
 *
 * 🔴 THE NAMES ARE PREFIXED AND THAT IS NOT DECORATION. The mockup calls these
 * orbitRise/orbitRun/etc, and app/globals.css already ships `orbit-rise` and
 * `orbit-draw` for the LOGIN page. Those are different CSS identifiers so they
 * would not technically collide, but two animation families one hyphen apart in
 * one document is a trap for whoever edits next. v2Splash* matches v2SheetUp
 * and v2ScrimIn, the convention this folder already uses.
 *
 * 🔴 A SCOPED <style>, NOT globals.css. Same containment rule as v2-sheet.tsx:
 * every colour in v2 is an inline style and nothing here touches globals.css or
 * tailwind.config.ts. Keyframes cannot be inline, so they ride in the element.
 *
 * ⚠ THE GRADIENT'S TRANSPARENT STOP IS rgba(124,58,237,0), NOT `transparent`.
 * The ready-to-lift block writes `transparent`, which several engines
 * interpolate through transparent BLACK and render as a grey smear across the
 * middle of the tail. Brand-at-zero-alpha is the same colour the mockup's own
 * rendered `.tail` uses, and it fades cleanly. Same picture, no artefact.
 */
const SPLASH_CSS = `
@keyframes v2SplashRise { from { opacity:0; transform:translateY(9px) } to { opacity:1; transform:none } }
@keyframes v2SplashRun  { 0%   { left:0;    opacity:0 }
                          12%  { opacity:1 }
                          88%  { opacity:1 }
                          100% { left:100%; opacity:0 } }
@keyframes v2SplashTail { from { transform:scaleX(0) } to { transform:scaleX(1) } }
@keyframes v2SplashFade { to   { opacity:0 } }
@keyframes v2SplashRule { from { opacity:0 } to { opacity:1 } }

.v2-splash-mark { animation: v2SplashRise .38s cubic-bezier(.2,.85,.25,1) both }

/* The strip the three layers share, 13px under the word's own box. */
.v2-splash-fx   { position:absolute; left:0; right:0; bottom:-13px; height:3px }

/* THE END STATE. It is opacity 0 through its 460ms delay (fill mode both), so
   the tail is the only thing on the strip until the handover. */
.v2-splash-rule { position:absolute; inset:0; border-radius:999px;
                  background:${BRAND};
                  animation: v2SplashRule .18s ease-out .46s both }

/* Grows from nothing under the dot, then fades out as the rule fades in. */
.v2-splash-tail { position:absolute; inset:0; border-radius:999px;
                  transform-origin:left center;
                  background:linear-gradient(90deg, rgba(124,58,237,0) 0%, ${BRAND} 100%);
                  animation: v2SplashTail .42s cubic-bezier(.3,0,.25,1) .10s both,
                             v2SplashFade .16s ease-in .44s forwards }

/* 🔴 THE ONE THING THAT ANIMATES LAYOUT, and deliberately: 'left' on a 6px
   square is cheap where a transform would have to fight the -6px margin that
   keeps it inside the right edge. The mockup calls this out as its single
   exception. top:-1.5px centres 6px of dot on 3px of line. */
.v2-splash-dot  { position:absolute; top:-1.5px; left:100%; width:6px; height:6px;
                  margin-left:-6px; border-radius:999px; background:${BRAND}; opacity:0;
                  animation: v2SplashRun .42s cubic-bezier(.3,0,.25,1) .10s both }

/* 🔴 THE FINISHED STATE, INSTANTLY. Everything above rests on its ARRIVED
   value, which is what lets 'animation:none' land on the design rather than on
   an invisible wordmark or a 0px rule — the same principle CLAUDE_UI records
   for the login page's two entrances. The dot and the tail are transitional and
   simply never appear. */
@media (prefers-reduced-motion: reduce) {
  .v2-splash-mark, .v2-splash-dot, .v2-splash-tail, .v2-splash-rule { animation: none }
  .v2-splash-dot, .v2-splash-tail { opacity: 0 }
}
`;

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
/**
 * 🔴 v2 TILE LABEL: CENTRED · ONE SIZE · FIXED 2-LINE BLOCK.
 * Applies to every image-with-label grid in v2. Owner ruling 2026-09-09.
 *
 * The other grid is BigTile/TileName in product-drawer.tsx, which serves both
 * the rail and the strip. There is no third — the two remaining image sites
 * (the Tin in order-sheet.tsx and in review-screen.tsx) put the name BESIDE
 * the picture in a row, not under it, and are deliberately not this shape.
 *
 * 🔴 minHeight IS IN em, NOT PIXELS, AND THAT IS THE POINT. 2 lines x the 1.25
 * line-height below = 2.5em, so the block is exactly two lines whatever the
 * font size is. Written in px it would silently become the wrong height the
 * first time somebody changed the size, and the symptom — one-word and
 * two-word tiles sitting at different heights — is the thing this ruling
 * exists to fix.
 *
 * min-height and NOT height: the clamp is 2 lines here, but a hard height
 * would cut a clamped line through the middle rather than let it end.
 */
const TILE_TEXT_STYLE: React.CSSProperties = {
  color:           INK,
  letterSpacing:   "-0.01em",
  lineHeight:      1.25,
  minHeight:       "2.5em",
  display:         "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
  overflow:        "hidden",
  overflowWrap:    "normal",
  wordBreak:       "normal",
  hyphens:         "none",
};
/* ═══════════════════════════════════════════════════════════════════════════
 * 🔴 A FAVOURITE IS A BOARD TILE KEY AND NOTHING ELSE.
 *
 * Storage holds { key, at }. The label, the picture and the wash are all
 * resolved HERE on every render out of BOARD, so a tile that is re-labelled or
 * given a photograph follows on the next load with nothing to migrate.
 *
 * 🔴 THE CAPTION IS THE TILE LABEL ALONE — "PU Prime", "Luxurio", "Gloss".
 *
 * It was "{tile} {member}" while a favourite was a MEMBER, because a bare
 * "Matt" says nothing with no parent on screen. A TILE label is already
 * self-contained: it is the same word the board prints under the same picture
 * in its own family. So the parent-prefix rule and the de-doubling that went
 * with it do not apply to favourites any more.
 *
 * ⚠ BOTH RULES STILL STAND EVERYWHERE ELSE — the drawer's rail and strip still
 * shorten a member against its tile (eb6d8e2f), and tileLabelFor still warns
 * that a search row has no parent either. Nothing here repeals them.
 *
 * Returns null when the tile has left BOARD. That null is also the liveness
 * test the storage prune runs on, so a favourite that cannot render cannot
 * survive either.
 * ═══════════════════════════════════════════════════════════════════════════ */
type FavView = {
  /** V2BoardTile.key — under Scheme A, members[0].sap. */
  key:     string;
  caption: string;
  src:     string | null;
  wash:    string;
};

function resolveFav(key: string): FavView | null {
  const tile = boardTile(key);
  if (!tile) return null;
  const art = boardTileArtFor(key);
  return { key, caption: tile.label, src: art.src, wash: art.wash };
}

/**
 * The bottom nav's height including the safe area, as a CSS expression.
 *
 * The cart bar STACKS ABOVE the nav rather than replacing it: both are visible
 * at once, cart on top. Hiding the nav behind the cart is what made drafts and
 * sent orders unreachable the moment an order had a line in it, and merging
 * them into one bar puts a destructive "Review" beside two harmless tabs.
 */
// 🔴 NAV_H MOVED TO order-sheet.tsx and is imported above. The list screens
// need the same number to keep their last card clear of the nav, and they
// cannot import it from here — the page imports THEM. One home, no drift.

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; customers: ApiCustomer[]; products: ApiProduct[];
      byTile: Map<string, V2Resolved>;
      /** The 9x4 board, EVERY MEMBER RESOLVED ON ITS OWN ROWS (buildBoard). */
      board: Map<string, V2ResolvedTile> };

type Screen = "order" | "review" | "dealer" | "shipto" | "sent"
            | "drafts" | "sentList" | "draftDetail" | "sentDetail";
// 🔴 "summary" AND "draft" ARE GONE FROM HERE. Both details are SCREENS now —
// a sheet is for a decision you dismiss, an order you read through is a place
// you went to. What is left are the three things that really are decisions.
type Sheet  = null | "clear" | "load" | "rename" | "delete";

/**
 * 🔴 MERGE, NOT APPEND, WHEN HE ASKS TO ADD.
 *
 * Two cart lines for ONE catalogue row emit as two separately numbered lines in
 * the same email, and the depot reads that as a mistake rather than a total. He
 * asked to add; the sum of two quantities he typed is what adding means.
 *
 * IDENTICAL means the same rowId AND the same option — the same catalogue row,
 * which is the thing the email is built from. Anything that differs by either
 * stays its own line, because it is its own product.
 *
 * packOrder is taken from the line already on the board and NOT re-derived: two
 * lines with the same rowId were snapshotted from the same menu row, so they
 * carry the same pack order, and the email needs that catalog order rather than
 * the order of anybody's thumbs.
 */
function mergeLines(current: V2CartLine[], incoming: V2CartLine[]): {
  lines: V2CartLine[]; merged: number;
} {
  const out = current.map((l) => ({ ...l, qtys: { ...l.qtys } }));
  let merged = 0;
  for (const inc of incoming) {
    const hit = out.find((l) => l.rowId === inc.rowId && l.option === inc.option);
    if (hit) {
      merged++;
      for (const [pack, qty] of Object.entries(inc.qtys)) {
        if (qty > 0) hit.qtys[pack] = (hit.qtys[pack] ?? 0) + qty;
      }
    } else {
      // A fresh id, or React sees two children with one key the moment the
      // same draft is added twice.
      out.push({ ...inc, id: `${inc.tileSap}-${Date.now()}-${out.length}`, qtys: { ...inc.qtys } });
    }
  }
  return { lines: out, merged };
}

export default function PoV2Page(): React.JSX.Element {
  const [load, setLoad]       = useState<LoadState>({ kind: "loading" });
  const [screen, setScreen]   = useState<Screen>("order");
  const [dealer, setDealer]   = useState<ApiCustomer | null>(null);
  /**
   * TWO STAR LISTS, ONE PER PICKER, AND THEY NEVER MERGE.
   *
   * 🔴 `starred` IS THE CUSTOMER LIST AND KEEPS THE OLD KEY AND THE OLD DATA.
   * Every star anybody has today was made on the customer picker, so it stays
   * exactly what it was. `shipToStarred` is new and starts empty on every
   * phone — see V2StarList in v2-storage for why it is not seeded.
   *
   * ⚠ NEVER PASS ONE WHERE THE OTHER BELONGS. CustomerListBody computes its
   * filled/empty stars from whichever array it is handed, so handing it the
   * wrong one silently shows the wrong shortlist AND lets a tap write to the
   * wrong store. The two branches below each name their own.
   */
  const [starred, setStarred] = useState<V2Star[]>([]);
  const [shipToStarred, setShipToStarred] = useState<V2Star[]>([]);
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
  // The sent order whose read-only sheet is open.
  const [openSent, setOpenSent]         = useState<V2SentOrder | null>(null);
  // The saved draft whose read-only sheet is open — Delete and Continue.
  const [openDraftDetail, setOpenDraftDetail] = useState<V2SavedDraft | null>(null);
  /**
   * The order a "replace or add" prompt is about to put on the board.
   *
   * It holds the SNAPSHOT rather than the draft, because the same prompt serves
   * Continue and Send again and only one of those has a draft behind it.
   */
  const [pendingLoad, setPendingLoad] = useState<V2Snapshot | null>(null);
  // The draft a rename field or a delete confirm is about.
  const [renameTarget, setRenameTarget] = useState<V2SavedDraft | null>(null);
  const [renameText, setRenameText]     = useState("");
  const [deleteTarget, setDeleteTarget] = useState<V2SavedDraft | null>(null);
  // Set once the live draft has been read, so the debounced writer below
  // cannot fire (and clear the key) before the restore has had its chance.
  const [hydrated, setHydrated] = useState(false);
  const restoredRef = useRef(false);
  // The id a reopened draft was saved under, so re-saving upserts in place.
  const openDraftIdRef = useRef<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** "warn" is the refusal tone — see toastHost. Reset with every new toast. */
  const [toastTone, setToastTone] = useState<"info" | "warn">("info");
  /**
   * The favourite PRODUCTS, by member sap. Client-only: localStorage is not
   * readable on the server and a first render that guessed would flash the
   * wrong board. Empty until the effect below runs, which is also the honest
   * state for a phone that has never favourited anything.
   */
  const [favProducts, setFavProducts] = useState<V2FavProduct[]>([]);
  /** The header gear's picker. Not a screen — the board stays underneath. */
  const [favManage, setFavManage] = useState(false);

  /**
   * The review screen's two pickers, LIFTED HERE from review-screen.tsx.
   *
   * They were the only overlays in v2 the page could not see, and an ordered
   * closing authority cannot close a layer it does not know about. Nothing
   * about them changed: the markup is still down there, they still commit only
   * on a pick, and dismissing either still writes nothing.
   */
  const [reviewSheet, setReviewSheet] = useState<V2ReviewSheet>(null);

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
    setStarred(loadStarred("dealer"));
    setShipToStarred(loadStarred("shipto"));
    setSavedDrafts(loadSavedDrafts());
    setSentOrders(loadSentOrders());   // prunes to today+yesterday IST on read
  }, []);

  // Brief confirmation, self-dismissing. Cleared on unmount so a pending
  // timer cannot fire into a torn-down tree.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => { setToast(null); setToastTone("info"); }, 1800);
    return () => clearTimeout(t);
  }, [toast]);

  /**
   * 🔴 FAVOURITES LOAD ONCE, AND THE PRUNE IS THE POINT OF THE PREDICATE.
   *
   * loadFavProducts cannot decide for itself whether a stored sap is still
   * real — v2-storage imports nothing from v2-data and must not, or the two
   * files become circular. So the liveness test is handed in from here, where
   * BOARD is already in scope, and a member that has left the board is dropped
   * silently on this read, and a list still in v1 MEMBER shape is migrated to
   * tile keys at the same time. That is the only place either happens: pruning
   * on write would fix only what this build happens to touch.
   */
  useEffect(() => {
    setFavProducts(loadFavProducts());
  }, []);

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

  /**
   * 🔴 AND THE SAME WRITE, IMMEDIATELY, ON THE WAY OUT.
   *
   * The debounce above is right and stays — `order` carries the notes
   * textarea, so an undebounced write would hit localStorage on every
   * keystroke, synchronously, on a phone. What it cannot do is survive the
   * page going away inside its own 400ms: the component unmounts, the cleanup
   * clears the timer, and whatever changed in that window is gone. A back
   * press off the board, a swipe-away, a call arriving, the OS reclaiming
   * memory — all of them land in that window sooner or later, and the salesman
   * loses the line he just added.
   *
   * ⚠ /po HAS NEVER HAD THIS PROBLEM because it saves SYNCHRONOUSLY at every
   * mutation (savePoDraft, ~40 call sites, no debounce). v2 traded that for
   * the keystroke cost and owes this in return.
   *
   * 🔴 pagehide AND visibilitychange, NOT beforeunload. beforeunload is
   * unreliable on mobile — iOS Safari fires it inconsistently and Chrome
   * ignores it for bfcache-eligible navigations. `pagehide` is the one event
   * both fire on a real navigation, and `visibilitychange` to "hidden" is what
   * catches the app being backgrounded without unloading at all, which is the
   * commonest way a depot phone leaves this screen.
   *
   * 🔴 IT READS A REF, NOT A CLOSURE, AND THAT IS THE TRAP THIS AVOIDS. The
   * listener is registered ONCE — empty dependency array — so a closure would
   * capture the cart as it was on mount and faithfully save an empty order for
   * the rest of the session. Putting the state in the deps instead would
   * re-register both listeners on every keystroke, which is the same churn the
   * debounce exists to prevent. A ref rewritten each render is read at CALL
   * time and costs nothing, which is the discipline navRef already uses.
   *
   * IDEMPOTENT. It applies the SAME rule as the effect above, both halves: an
   * order with lines is saved, an order without them CLEARS the key. If the
   * debounced write also fires, the second write stores a byte-identical
   * snapshot; only `updatedAt` is refreshed, which is what a save is for and
   * cannot lose anything.
   */
  const liveRef = useRef({
    hydrated: false,
    dealer:   null as ApiCustomer | null,
    lines:    [] as V2CartLine[],
    shipTo:   null as ApiCustomer | null,
    order:    EMPTY_ORDER,
  });
  liveRef.current = { hydrated, dealer, lines, shipTo, order };

  useEffect(() => {
    const flush = (): void => {
      const s = liveRef.current;
      // Before hydration there is nothing real to write, and writing would
      // clobber a stored draft with the empty initial state.
      if (!s.hydrated) return;
      if (s.lines.length > 0) saveLiveDraft(snapshotOf(s.dealer, s.lines, s.shipTo, s.order));
      else clearLiveDraft();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

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
  function openDealerSheet(): void { openLayer(); setQuery(""); setScreen("dealer"); }

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
    commitToBoard();
    setLines([]);
    setOrder(EMPTY_ORDER);
    setShipTo(null);
    openDraftIdRef.current = null;
    setSheet(null);
    setScreen("order");
  }

  /** Empty the order and go back to the board. The dealer clears with it. */
  function startOver(): void {
    commitToBoard();
    setLines([]);
    setDealer(null);
    setShipTo(null);
    setOrder(EMPTY_ORDER);
    setProdQuery("");
    setSheet(null);
    setScreen("order");
  }

  /** Load a saved draft, remembering its id so re-saving upserts in place. */
  /**
   * Put a stored order on the board, asking first if there is anything to lose.
   *
   * 🔴 EMPTY BOARD: no question. There is nothing to replace and a prompt with
   * one sensible answer is a tap he has to make for nothing.
   * 🔴 NOT EMPTY: ask ONCE, and offer both — replace what is there, or add to
   * it. Never guess, and never silently discard an order he was halfway
   * through.
   *
   * The draftId argument is the id to re-save under when this came from a
   * saved draft, so "Save draft" on a reopened basket upserts in place rather
   * than making a second copy. Null for a sent order, which is a fresh order.
   */
  function loadOntoBoard(snap: V2Snapshot, draftId: string | null): void {
    openDraftIdRef.current = draftId;
    if (lines.length === 0) { applySnapshot(snap, customers); return; }
    setPendingLoad(snap);
    openLayer();
    setSheet("load");
  }

  /**
   * 🔴 THE SHIP-TO DEALER FOR A STORED ORDER, RESOLVED AGAINST THE LIVE LIST.
   *
   * The snapshot holds a shipToCode and nothing else, deliberately: a stored
   * customer object would go stale the moment an area or a name changed. Only
   * this page has the refetched list, so only this page can turn the code into
   * a name — and when the code is no longer in the list (a dealer removed since
   * the order was sent) it returns null and the detail prints the bare code
   * rather than inventing anything.
   *
   * snapshotOf writes the code ONLY when it differs from the billing dealer, so
   * a non-null shipToCode already means "somewhere else".
   */
  function shipToOf(snap: V2Snapshot): ApiCustomer | null {
    if (!snap.shipToCode) return null;
    return customers.find((c) => c.code === snap.shipToCode) ?? null;
  }

  /**
   * 🔴 THE ONE HANDLER BEHIND ALL FIVE BOTTOM-NAV SITES.
   *
   * A tab goes to its own screen from anywhere — including Board, which is
   * `screen: "order"` and was not reachable from the nav at all until this.
   *
   * It clears BOTH detail states on the way. A detail screen is `screen ===
   * "draftDetail" && openDraftDetail`, so leaving the object behind would not
   * show the wrong screen today — but it would keep a stale draft alive behind
   * a rename or a delete, and the confirm sheets read those very fields.
   *
   * 🔴 THIS IS NOT THE CHEVRON. From a detail the chevron goes back to the
   * LIST it came from (onBack, at each detail's call site); the Board tab goes
   * to the BOARD. Two controls, two destinations, and neither may be made to
   * do the other's job.
   */
  function navTo(next: "order" | "drafts" | "sentList"): void {
    /* 🔴 THE TABS ARE PEERS, SO ONLY LEAVING THE BOARD IS "FORWARD".
     *
     * Board -> Drafts is a level down and pushes one entry. Drafts -> Sent is
     * LATERAL and pushes nothing, or a man flicking between the two tabs would
     * build a stack he then has to press back through. Either -> Board is a
     * close, and it goes through the same authority as every other close so a
     * detail screen open underneath is popped with it.
     *
     * This is /po's rule (po-page.tsx:1215-1235), which pushes only when
     * `browseScreen === "home"` and closes both peers through one branch.
     */
    const from = navRef.current.screen;
    if (next === "order") { commitToBoard(); }
    else if (from === "order") { openLayer(); }
    setOpenDraftDetail(null);
    setOpenSent(null);
    setScreen(next);
  }

  /** REPLACE — the board becomes this order, dealer and remarks included. */
  function applyReplace(snap: V2Snapshot): void {
    commitToBoard();
    setSheet(null); setPendingLoad(null);
    applySnapshot(snap, customers);
  }

  /**
   * ADD — its lines join what is there, identical rows summed.
   *
   * The DEALER and the remarks are NOT taken. He is adding products to an order
   * he is already building, and overwriting whose account it goes on would be a
   * silent change to the one field that decides where the paint is billed.
   */
  function applyAdd(snap: V2Snapshot): void {
    commitToBoard();
    setSheet(null); setPendingLoad(null);
    const { lines: next, merged } = mergeLines(lines, snap.lines);
    setLines(next);
    setProdQuery("");
    setScreen("order");
    setToast(merged > 0
      ? `Added · ${merged} ${merged === 1 ? "line" : "lines"} merged`
      : `Added ${snap.lines.length} ${snap.lines.length === 1 ? "product" : "products"}`);
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
    commitClose(1);
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
    commitClose(1);
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
  ): { member: string; option: string | null; qtys: Record<string, number> }[] {
    return lines
      .filter((l) => l.tileSap === tileKey &&
        (memberSap === null || (l.product ?? l.subProduct) === memberSap))
      // 🔴 EACH LINE CARRIES ITS MEMBER. The drawer seeds every member of the
      // tile at once, and "90 Base" is an option on four different members —
      // without this the seed could not tell whose quantity it was holding.
      // It is the catalog join key, the same expression addLines writes from.
      .map((l) => ({ member: l.product ?? l.subProduct, option: l.option, qtys: l.qtys }));
  }

  /**
   * A row -> the label of the member it belongs to, for the cart line.
   *
   * 🔴 A PINNED MEMBER IS MATCHED ON baseColour AS WELL AS sap, AND THE PINNED
   * ONES ARE TRIED FIRST.
   *
   * Two members can share one sap — Wood Primer White and Wood Primer Pink are
   * both "WOOD PRIMER" — so matching on sap alone returned the FIRST of them
   * for both rows, and a Pink line would have been written into the cart
   * labelled "Wood Primer White". The email would still have been right (it is
   * built from the row's own three fields, never from this label), which is
   * what made it dangerous: the wrong word would have been on the screen the
   * salesman checks and nowhere in the message that proves it.
   *
   * The second lookup EXCLUDES pinned members deliberately. Without that, a
   * WOOD PRIMER row carrying some third baseColour would fall through the
   * pinned test and then take the first pinned member's label anyway — the
   * original bug, one branch further down. Falling through to the tile label is
   * the honest answer for a row no member claims.
   *
   * Case-sensitive, because the pins are (v2-data's V2Member.option says why).
   */
  function memberLabelIn(tile: V2BoardTile): (row: ApiProduct) => string {
    return (row) => {
      const sap = row.product ?? row.subProduct;
      const pinned = tile.members.find(
        (m) => m.option !== undefined && m.sap === sap && m.option === row.baseColour);
      if (pinned) return pinned.label;
      return tile.members.find((m) => m.option === undefined && m.sap === sap)?.label ?? tile.label;
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
    openLayer();
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
    if (next.length === 0) { commitClose(1); setScreen("order"); }
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
   * The tile that is open, and which member it opens ON.
   *
   * The drawer takes the WHOLE tile now and runs the member level itself. This
   * only says where to land: the top seller from a board tap, the searched
   * product from a search hit.
   */
  const openResolved = ready && openTile ? load.board.get(openTile.tile.key) ?? null : null;
  const openMember: V2ResolvedMember | null = openResolved
    ? (openResolved.members.find((m) => m.sap === openTile?.initialMember)
       ?? openResolved.members[0] ?? null)
    : null;
  // A searched PRODUCT resolves to its curated chips when it is one of the 32,
  // and to its own payload options (sortOrder, capped) when it is not.
  /**
   * The favourites as the board draws them — resolved, then sorted A-Z ON THE
   * CAPTION.
   *
   * 🔴 A-Z ON WHAT IS PRINTED, not on the sap and not on `at`. The point of an
   * alphabetical fav group is that a tile does not move under the thumb
   * between one order and the next; sorting by the stored key would order by a
   * string the salesman never sees ("WS PROTECT DUSTPROOF" filing under W),
   * and sorting by `at` would reshuffle the whole group every time he added
   * one. `at` is kept only as a tiebreak, and BOARD_INVARIANTS already refuses
   * two tiles sharing a key so it can never actually be needed.
   */
  const favViews = useMemo(() => {
    const views: FavView[] = [];
    for (const f of favProducts) { const v = resolveFav(f.key); if (v) views.push(v); }
    return views.sort((a, b) => a.caption.localeCompare(b.caption));
  }, [favProducts]);

  /**
   * EVERY TILE ON THE BOARD, GROUPED BY FAMILY, IN THE BOARD'S OWN ORDER.
   *
   * 🔴 37 ROWS, NOT 98. This listed every MEMBER until 2026-09-09 and that was
   * the wrong unit twice over: 98 rows is not a list anybody browses, and "PU
   * Prime Matt", "PU Prime Sealer" and "PU Prime Gloss" each spending one of
   * eight slots is not how a salesman thinks about PU Prime. One star brings
   * the whole drawer.
   *
   * 🔴 IT MAPS BOARD DIRECTLY, WHICH IS THE SAME ARRAY THE BOARD RENDER MAPS.
   * Not a copy of the family order and not a sort — the identical constant, in
   * the identical order, so the picker and the board cannot drift into
   * disagreeing about which family comes first.
   *
   * Rows within a family keep BOARD's own tile order, which is the 90-day
   * ranking, so the ones he is most likely to want sit nearest the top of each
   * group. No search box, per the ruling and for a reason worth writing down:
   * a salesman choosing eight favourites is BROWSING. He is not looking up a
   * name he knows, he is picking the ones he sells.
   *
   * Rows come from resolveFav, the same function the board tiles use, so a row
   * and its tile cannot disagree about the label or the tin.
   */
  const pickerGroups = useMemo(
    () => BOARD.map((family) => ({
      name: family.name,
      rows: family.tiles
        .map((t) => resolveFav(t.key))
        .filter((v): v is FavView => v !== null),
    })),
    [],
  );

  /**
   * 🔴 THE PICKER PUSHES ONE HISTORY ENTRY AND CLOSES BY GOING BACK.
   *
   * ⚠ AND IT IS THE ONLY THING IN v2 THAT DOES. There is no history handling
   * anywhere else in this folder — no pushState, no popstate, not in V2Sheet
   * and not on any screen. That is a v2-wide gap, NOT something f4c0444c
   * introduced, and this does not close it: the drawer, the dealer picker, the
   * review screen and the confirms all still leave the page on Android back.
   * Fixing those is a job of its own; see /po's single-back-authority model.
   *
   * What this does is make the ONE overlay added here behave, so a hardware
   * back dismisses the picker instead of walking off the order. Done and the
   * scrim both route through the same back(), so there is exactly one exit and
   * the entry can never be left on the stack.
   */
  // ⚠ THE PRIVATE HISTORY CODE THAT USED TO LIVE HERE IS GONE. This picker had
  // its own pushState, its own back() and its own popstate listener — the only
  // history handling in the folder, added so that ONE overlay behaved while
  // every other one leaked a back press out of the app. It is now an ordinary
  // layer: it opens through openLayer and closes through the one authority,
  // like the other eleven. Nothing about what it DOES changed.
  function openFavPicker(): void { openLayer(); setFavManage(true); }
  function closeFavPicker(): void { setFavManage(false); }

  /* ═══════════════════════════════════════════════════════════════════════
   * THE CLOSING AUTHORITY
   *
   * 🔴 ONE FUNCTION, ONE ORDERED LIST, AND THE ORDER IS THE WHOLE POINT.
   *
   * v2 had eleven ways to close something and no agreement between them about
   * what "on top" meant, because nothing ever had to ask: each control closed
   * the one thing it was wired to. That works for a tap on a named button and
   * not at all for a gesture — the Android back button says "close whatever is
   * in front of me" and nothing in this folder could answer.
   *
   * ⚠ THIS PROMPT ADDS NO HISTORY. No pushState, no popstate, no back(). The
   * question "what is on top" and the question "who asked" are separable, and
   * this is only the first. Everything here is exercised by tapping buttons,
   * which is what makes the history step that follows a small one.
   *
   * 🔴 THE SNAPSHOT IS A REF, REWRITTEN EVERY RENDER — /po's navStateRef, and
   * for /po's reason. A closer that read state through a closure would capture
   * whatever was live when its handler was created, and the handler that
   * matters most is the one created earliest. A ref is read at CALL time, and
   * reading it triggers no render.
   */
  const navRef = useRef({
    sheet:        null as Sheet,
    reviewSheet:  null as V2ReviewSheet,
    favManage:    false,
    drawer:       false,
    screen:       "order" as Screen,
  });
  navRef.current = {
    sheet,
    reviewSheet,
    favManage,
    drawer: openTile !== null || openGroup !== null,
    screen,
  };

  /* ── THE HISTORY STACK ────────────────────────────────────────────────
   *
   * 🔴 ONE ENTRY PER OPEN LAYER, AND THE BROWSER'S BACK IS JUST ANOTHER WAY
   * TO ASK closeTopLayer. Ported from /po (po-page.tsx:1066-1128), which has
   * run this shape in the depot for months. Two refs, and each prevents one
   * specific failure:
   *
   *   depthRef       — how many entries WE pushed above the base. Without it
   *                    a close cannot tell "there is an entry to consume"
   *                    from "we are at the base and back means exit".
   *   suppressPopRef — marks a popstate WE caused, after the caller has
   *                    already changed state. Without it a commit runs its
   *                    close twice: once itself, once through the handler.
   *
   * 🔴 THREE SHAPES, AND WHICH ONE A CONTROL USES DEPENDS ON WHETHER IT HAS
   * ALREADY CHANGED STATE. /po looks contradictory here until you sort its 29
   * back() calls into two piles, and it is the same split:
   *
   *   openLayer()      forward. Push one entry.
   *   requestClose()   a DISMISS — scrim, Cancel, back chevron. Pops one
   *                    entry and lets the handler do the closing, so a button
   *                    and a hardware back run the SAME code.
   *   commitClose(n)   a COMMIT — pick a depot, Delete, Replace, Add. The
   *                    caller has already changed state, so this only
   *                    CONSUMES the entries and suppresses the popstate.
   *
   * ⚠ THE HANDLER DECREMENTS ONLY WHEN IT ACTS. A suppressed pop had its
   * depth adjusted by commitClose already; decrementing again would drift the
   * count low and leave stale entries, which is exactly the "back does nothing
   * and he presses it twice" failure.
   */
  const depthRef       = useRef(0);
  const suppressPopRef = useRef(false);

  /** Forward into a layer. Exactly one entry, every time. */
  function openLayer(): void {
    if (typeof window === "undefined") return;
    window.history.pushState({ v2Layer: true }, "");
    depthRef.current += 1;
  }

  /**
   * A DISMISS. Pops one entry; the popstate handler closes the layer.
   *
   * 🔴 THE STATE CHANGE HAPPENS IN THE HANDLER, NOT HERE, and that is what
   * makes a Cancel button and a hardware back literally the same path. If this
   * closed the layer itself and then popped, the two routes would be two
   * implementations that drift.
   */
  function requestClose(): void {
    if (typeof window !== "undefined" && depthRef.current > 0) window.history.back();
    else closeTopLayer();   // no entry to consume (SSR, or already at base)
  }

  /**
   * A COMMIT. The caller has done the work AND closed the layer; this consumes
   * the entries so a later back does not close something a second time.
   *
   * One go(-n) fires ONE popstate, which is why the count is adjusted here and
   * the handler skips its own decrement for a suppressed pop.
   */
  function commitClose(n: number): void {
    if (typeof window === "undefined") return;
    const steps = Math.min(n, depthRef.current);
    if (steps <= 0) return;
    depthRef.current -= steps;
    suppressPopRef.current = true;
    window.history.go(-steps);
  }

  /** A COMMIT that lands on the board from wherever it was. */
  function commitToBoard(): void { commitClose(depthRef.current); }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = (): void => {
      if (suppressPopRef.current) { suppressPopRef.current = false; return; }
      depthRef.current = Math.max(0, depthRef.current - 1);
      // 🔴 closeTopLayer IS CAPTURED FROM THE FIRST RENDER AND THAT IS SAFE.
      // It reads navRef, a ref rewritten every render, and calls setState
      // functions, which React guarantees are stable. Nothing it touches can
      // go stale — the same reason /po registers its handler once with an
      // empty dependency array.
      closeTopLayer();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** What the closer just shut, so a caller can tell "nothing" from "something". */
  type ClosedLayer =
    | "sheet" | "reviewSheet" | "favPicker" | "drawer" | "detail" | "screen" | null;

  /**
   * Close the TOPMOST open layer and say which it was. `null` means nothing
   * was open — the board with no overlay, which is the state an app is allowed
   * to be exited from.
   *
   * 🔴 THE IF-CHAIN IS THE Z-ORDER, WRITTEN DOWN ONCE. Read it top to bottom
   * and it is the stacking order of the whole app. It is derived from what can
   * actually be open together, not from what could be in theory:
   *
   *   · SCREENS ARE EXCLUSIVE. Every one is an early `return` from this
   *     component, so exactly one is ever mounted.
   *   · AT MOST ONE OVERLAY SITS ON A SCREEN. `sheet` is a single enum, so its
   *     four members cannot overlap; `reviewSheet` is another; the drawer and
   *     the favourites picker each cover the board with their own scrim.
   *   · SO THE ORDER IS ABOUT WHICH LAYER WINS IF TWO EVER DO OVERLAP, and it
   *     follows the DOM. On review, `sheet === "clear"` renders AFTER
   *     <ReviewScreen>, so it paints over the Call and Cross pickers and is
   *     checked first. Everything else falls out of that same reading.
   *
   * 🔴 IT READS THE LIVE SNAPSHOT AND NOTHING ELSE — never an argument saying
   * what to close, never a tag left behind by whoever opened it. /po's handler
   * makes the same point about itself: it "never reads a pushed entry's tag,
   * only this live enum". A tag can be stale; what is on screen cannot.
   *
   * 🔴 EACH BRANCH CALLS THE LAYER'S OWN EXISTING CLOSE, side effects and all.
   * This gathers the closes; it does not reimplement them. The load sheet still
   * drops its pending snapshot, the drawer still takes its search query down
   * with it by unmounting, the dealer screen still clears the query, and the
   * clear confirm still clears NOTHING on dismiss.
   */
  function closeTopLayer(): ClosedLayer {
    const s = navRef.current;

    // 1. The confirms and pickers that overlay ANY screen.
    if (s.sheet !== null) {
      setSheet(null);
      // Each carries its own subject, and dropping it is part of the close —
      // a stale pendingLoad would be re-offered by the next open.
      setPendingLoad(null);
      setRenameTarget(null);
      setDeleteTarget(null);
      return "sheet";
    }

    // 2. The review screen's own two pickers. Dismissing writes NOTHING —
    //    that is the rule that makes a half-set Dispatch impossible.
    if (s.reviewSheet !== null) { setReviewSheet(null); return "reviewSheet"; }

    // 3. The favourites picker, over the board.
    //    ⚠ closeFavPicker calls history.back(), which is the ONE piece of
    //    history handling that already existed in this folder. It is called
    //    here, not reimplemented, and not changed.
    if (s.favManage) { closeFavPicker(); return "favPicker"; }

    // 4. The product drawer, over the board. Both openers, one close: only one
    //    can be set at a time, and nulling both is what every existing control
    //    already did.
    if (s.drawer) { setOpenTile(null); setOpenGroup(null); return "drawer"; }

    // 5. A detail screen returns to the LIST it was opened from, not to the
    //    board. Checked before the plain screens below so one close is one
    //    level, exactly as /po does for its Sent receipt.
    if (s.screen === "draftDetail") { setOpenDraftDetail(null); setScreen("drafts");   return "detail"; }
    if (s.screen === "sentDetail")  { setOpenSent(null);        setScreen("sentList"); return "detail"; }

    // 6. The two pickers reached FROM review go back to review, clearing the
    //    dealer search on the way out as their back chevrons always have.
    if (s.screen === "dealer" || s.screen === "shipto") {
      setQuery(""); setScreen("review"); return "screen";
    }

    // 7. Everything else that is not the board returns to the board.
    if (s.screen !== "order") { setScreen("order"); return "screen"; }

    // 8. The board, with nothing over it. There is nothing left to close.
    return null;
  }

  /**
   * One tap on a picker star. Add, or remove, or refuse at eight.
   *
   * 🔴 THE REFUSAL IS THE ONLY BRANCH THAT SAYS ANYTHING. Adding and removing
   * are visible on the board a moment later and a toast for each would be
   * noise on a control he is using deliberately. Being refused is invisible —
   * the star simply would not fill — so that one needs words.
   */
  function toggleFavProduct(sap: string): void {
    if (isFavProduct(sap, favProducts)) {
      setFavProducts(removeFavProduct(sap, favProducts));
      return;
    }
    const { result, favs } = addFavProduct(sap, favProducts);
    if (result === "full") {
      setToastTone("warn");
      setToast("Favourites full (8 of 8) — remove one first");
      return;
    }
    setFavProducts(favs);
  }

  // 🔴 SEARCH ROWS ARE TITLED FROM FAMILIES, NOT BOARD — which is the only
  // reason the 2026-09-09 member-label shortening was safe. A BOARD member
  // label ("Int", "Matt", "Sealer") is a caption UNDER ITS PARENT TILE and
  // reads as one; a search result has no parent on screen, so repointing this
  // at BOARD would put a bare "Int" in a list and nothing would say Int of
  // what. Repoint it and shorten the labels back at the same time, or not at
  // all. (The search HAYSTACK is untouched either way — mobile-search.ts
  // matches searchTokens + displayName + baseColour and has never seen a
  // board label.)
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
         style={{ bottom: belowNav(16) }}>
      {/* 🔴 ONE TONE OTHER THAN INK, AND ONLY FOR A REFUSAL. Every other toast
          here reports something that HAPPENED ("Draft saved", "Added"); the
          favourites cap reports something that did NOT, and it needs to read
          differently or it looks like a confirmation. Amber, not red — being
          full is not a fault, and red is reserved for something being wrong. */}
      <span className="rounded-full px-4 py-2 text-[13px] font-bold"
            style={toastTone === "warn"
              ? { background: ATTENTION_BG, color: ATTENTION, border: `1px solid ${ATTENTION}33` }
              : { background: INK, color: "#FFFFFF" }}>{toast}</span>
    </div>
  ) : null;

  /**
   * 🔴 REPLACE OR ADD — ASKED ONCE, WITH BOTH ANSWERS ON SCREEN.
   *
   * It used to offer one: "Load this draft", against a "Keep what I have"
   * footer. That is a yes/no dressed as a choice, and it made the salesman who
   * wanted BOTH orders throw one away and rebuild it by hand.
   *
   * Shared by Continue and by Send again, because both are the same question.
   */
  const loadSheet = sheet === "load" && pendingLoad ? (
    <V2Sheet
      onClose={requestClose}
      footer={
        <button
          type="button"
          onClick={() => { setSheet(null); setPendingLoad(null); }}
          className="w-full rounded-[13px] py-3 text-[15px] font-semibold"
          style={{ border: `1.5px solid ${RULE}`, color: INK }}
        >
          Cancel
        </button>
      }
    >
      <div className="shrink-0 px-4 pt-1.5 pb-3">
        <h2 className="text-[18px] font-bold" style={{ color: INK, letterSpacing: "-0.025em" }}>
          You have an order on the board
        </h2>
        <p className="text-[11.5px]" style={{ color: MUTED }}>
          {lines.length} {lines.length === 1 ? "product" : "products"} already added
        </p>
      </div>
      <div className="shrink-0 space-y-2 px-4 pb-4">
        <button
          type="button"
          onClick={() => applyAdd(pendingLoad)}
          className="w-full rounded-[13px] px-3 py-3 text-left"
          style={{ border: `1.5px solid ${RULE}` }}
        >
          <span className="block text-[15px] font-semibold" style={{ color: INK }}>
            Add to this order
          </span>
          <span className="block text-[12px]" style={{ color: MUTED }}>
            {/* Says out loud what merging will do, BEFORE he taps. */}
            {pendingLoad.lines.length} {pendingLoad.lines.length === 1 ? "product" : "products"} joins
            what is here; the same product twice is added up
          </span>
        </button>
        <button
          type="button"
          onClick={() => applyReplace(pendingLoad)}
          className="w-full rounded-[13px] px-3 py-3 text-left"
          style={{ border: `1.5px solid ${RULE}` }}
        >
          <span className="block text-[15px] font-semibold" style={{ color: URGENT }}>
            Replace what is here
          </span>
          <span className="block text-[12px]" style={{ color: MUTED }}>
            The {lines.length} {lines.length === 1 ? "product" : "products"} on the board
            {" "}are removed, and its dealer is used
          </span>
        </button>
      </div>
    </V2Sheet>
  ) : null;

  /** Rename — SAVED drafts only. The in-progress draft has no name to give. */
  const renameSheet = sheet === "rename" && renameTarget ? (
    <V2Sheet
      onClose={requestClose}
      footer={
        <>
          <button
            type="button"
            onClick={() => { setSheet(null); setRenameTarget(null); }}
            className="shrink-0 rounded-[13px] px-5 py-3 text-[15px] font-semibold"
            style={{ border: `1.5px solid ${RULE}`, color: INK }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              const next = renameSavedDraft(renameTarget.id, renameText);
              setSavedDrafts(next);
              // Keep the open detail sheet in step with what was just written.
              setOpenDraftDetail(next.find((d) => d.id === renameTarget.id) ?? null);
              commitClose(1); setSheet(null); setRenameTarget(null);
            }}
            className="min-w-0 flex-1 rounded-[13px] py-3 text-[15px] font-semibold text-white"
            style={{ background: BRAND }}
          >
            Save name
          </button>
        </>
      }
    >
      <div className="shrink-0 px-4 pt-1.5 pb-3">
        <h2 className="text-[18px] font-bold" style={{ color: INK, letterSpacing: "-0.025em" }}>
          Name this draft
        </h2>
        <p className="truncate text-[11.5px]" style={{ color: MUTED }}>
          {labelFor(renameTarget.snapshot)}
        </p>
      </div>
      <div className="shrink-0 px-4 pb-4">
        <input
          type="text" autoFocus value={renameText}
          onChange={(e) => setRenameText(e.target.value)}
          placeholder="Wednesday route"
          aria-label="Draft name"
          // 16px, or Safari zooms the page on focus. maxLength mirrors the
          // 40 v2-storage trims to — the field simply stops rather than
          // accepting characters it is about to throw away. No counter: the
          // cap is settled and a number nobody is near is noise.
          maxLength={40}
          className="w-full rounded-[12px] px-3 py-3 text-[16px] outline-none"
          style={{ background: SEARCH_BG, color: INK }}
        />
        <p className="mt-2 text-[11.5px]" style={{ color: MUTED }}>
          Leave it empty to go back to the dealer's name.
        </p>
      </div>
    </V2Sheet>
  ) : null;

  /**
   * Delete — behind a confirm, and it names what it is about to remove.
   *
   * 🔴 THE ONLY THING THAT DELETES A DRAFT. Continue does not, saving does not,
   * sending does not. A basket he uses at four shops has to survive being used.
   */
  const deleteSheet = sheet === "delete" && deleteTarget ? (
    <V2Sheet
      onClose={requestClose}
      footer={
        <>
          <button
            type="button"
            onClick={() => { setSheet(null); setDeleteTarget(null); }}
            className="min-w-0 flex-1 rounded-[13px] py-3 text-[15px] font-semibold"
            style={{ border: `1.5px solid ${RULE}`, color: INK }}
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={() => {
              setSavedDrafts(removeSavedDraft(deleteTarget.id));
              commitClose(navRef.current.screen === "draftDetail" ? 2 : 1);
              setDeleteTarget(null); setOpenDraftDetail(null); setSheet(null);
              // The draft is gone, so the screen showing it has to go too.
              setScreen("drafts");
              setToast("Draft deleted");
            }}
            className="min-w-0 flex-1 rounded-[13px] py-3 text-[15px] font-semibold text-white"
            style={{ background: URGENT }}
          >
            Delete
          </button>
        </>
      }
    >
      <div className="shrink-0 px-4 pt-1.5 pb-4">
        <h2 className="text-[18px] font-bold" style={{ color: INK, letterSpacing: "-0.025em" }}>
          Delete this draft?
        </h2>
        <p className="mt-1 truncate text-[13px] font-bold" style={{ color: INK }}>
          {draftDisplayName(deleteTarget)}
        </p>
        <p className="text-[11.5px]" style={{ color: MUTED }}>
          {deleteTarget.snapshot.lines.length}
          {deleteTarget.snapshot.lines.length === 1 ? " product" : " products"} · saved
          {" "}{formatSavedAt(deleteTarget.savedAt)}
        </p>
      </div>
    </V2Sheet>
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
      /* 🔴 WHITE, NOT THE GRADIENT. A full screen of violet was the loudest
         thing in the app and it was shown at the moment the app has least to
         say. White with the mark in BRAND is the same brand, quieter, and it
         matches the ground every screen behind it uses. */
      <main className="flex min-h-screen w-full items-center justify-center bg-white">
        <style>{SPLASH_CSS}</style>

        {/* 🔴 THE OUTLINED SVG HERE, AND ONLY HERE. The local Wordmark below is
            live text in a font loaded with `display: "swap"`, and this is the
            EARLIEST PAINT IN THE APP — so on a cold start it drew "Orbit" in
            the phone's system face and then swapped it under the salesman's
            eyes, on the one screen whose entire job is to say whose app this
            is. Outlined path data has no such moment: it is correct in the
            first frame and on a device with no network at all.

            ⚠ THE BOARD MASTHEAD STILL USES THE LOCAL TEXT and must keep it.
            By the time the board renders the font has arrived, and the
            masthead is the one place a size can be nudged without dragging ten
            other screens with it.

            🔴 HEIGHT, NOT FONT SIZE — the units are different and passing one
            for the other is a documented mistake (CLAUDE_UI.md:411-416). The
            viewBox is cut tight to the ink, 769 of a 1000-unit em, so
            `height` is INK height while the local component's `size` is a FONT
            size. The 44 this splash has always used is a font size:

                44 x 0.769 = 33.8px of ink

            Passing 44 straight through would have drawn the mark about 30%
            too large. The same trap cost the login page a cut once, at 66.

            🔴 COLOUR COMES FROM THE WRAPPER. OrbitWordmark paints with
            `currentColor` and accepts only `height` and `className` — no
            colour prop, no style prop. The inline `color` below is what it
            inherits, which keeps this folder's rule that every colour is an
            inline style and tailwind.config.ts is never touched.

            ⚠ NOTHING HERE GATES THE LOAD. There is no timer, no minimum
            duration and no "animation finished" state anywhere on this path.
            The branch above is the only thing that decides whether this screen
            exists, so if the catalogue arrives at 300ms the splash goes at
            300ms, mid-animation, and that is correct. A salesman opening a warm
            app should see a flash and nothing more. */}
        <div className="relative w-fit">
          <div className="v2-splash-mark" style={{ color: BRAND }}>
            <OrbitWordmark height={SPLASH_WORDMARK_INK} />
          </div>
          {/* Rule first so the tail and the dot ride above it. No tagline —
              the mockup's own section explains why: the splash has no fixed
              length, so a line timed to fade in at 700ms would show about half
              the time, and branding that appears at random reads as a fault. */}
          <div className="v2-splash-fx" aria-hidden>
            <span className="v2-splash-rule" />
            <span className="v2-splash-tail" />
            <span className="v2-splash-dot" />
          </div>
        </div>
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
          className="mt-1 rounded-[13px] px-6 py-3 text-[15px] font-semibold text-white"
          style={{ background: BRAND }}
        >
          Retry
        </button>
      </main>
    );
  }

  // ══ SCREEN 5 — DRAFTS ═══════════════════════════════════════════════════
  if (screen === "drafts") {
    // The board's own state IS the in-progress draft — the same object the
    // debounced writer puts in po2_draft. Read from live state rather than
    // re-read from storage, so the card cannot lag what is on the board.
    const liveSnap = lines.length > 0
      ? { snapshot: snapshotOf(dealer, lines, shipTo, order), savedAt: Date.now() }
      : null;
    return (
      <>
        <DraftsScreen
          live={liveSnap}
          drafts={savedDrafts}
          // In progress IS the board. Opening it is going back to it.
          onOpenLive={() => setScreen("order")}
          onOpen={(d) => { openLayer(); setOpenDraftDetail(d); setScreen("draftDetail"); }}
          // 🔴 THE SAME CONFIRM THE DETAIL'S Delete OPENS — one sheet, one
          // wording, one place removeSavedDraft is ever called. DraftsScreen
          // hands this to SAVED cards only; the in-progress card is the order
          // he is building and Clear order on the board is how that goes.
          onDelete={(d) => { openLayer(); setDeleteTarget(d); setSheet("delete"); }}
        />
        <BottomNav active="drafts" onNavigate={navTo} />
        {toastHost}

        {loadSheet}
        {renameSheet}
        {deleteSheet}
      </>
    );
  }

  // ══ SCREEN 6 — SENT ═════════════════════════════════════════════════════
  if (screen === "sentList") {
    return (
      <>
        <SentScreen
          orders={sentOrders}
          onOpen={(o) => { openLayer(); setOpenSent(o); setScreen("sentDetail"); }}
        />
        <BottomNav active="sent" onNavigate={navTo} />
        {toastHost}

        {loadSheet}
      </>
    );
  }

  // ══ SCREEN 7 — ONE SAVED DRAFT ══════════════════════════════════════════
  if (screen === "draftDetail" && openDraftDetail) {
    return (
      <>
        <OrderDetail
          snapshot={openDraftDetail.snapshot}
          status="Saved"
          when={formatSavedAt(openDraftDetail.savedAt)}
          shipTo={shipToOf(openDraftDetail.snapshot)}
          onBack={requestClose}
          footer={
            <>
              <button
                type="button"
                onClick={() => { openLayer(); setDeleteTarget(openDraftDetail); setSheet("delete"); }}
                className="shrink-0 rounded-[13px] px-4 py-3 text-[15px] font-semibold"
                style={{ border: `1.5px solid ${RULE}`, color: URGENT }}
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => { setRenameTarget(openDraftDetail);
                                 setRenameText(openDraftDetail.name ?? "");
                                 openLayer(); setSheet("rename"); }}
                className="shrink-0 rounded-[13px] px-4 py-3 text-[15px] font-semibold"
                style={{ border: `1.5px solid ${RULE}`, color: INK }}
              >
                Rename
              </button>
              {/* 🔴 CONTINUE LEAVES THE DRAFT WHERE IT IS. Nothing is deleted by
                  using it — a basket he works through four shops keeps working,
                  and no tap makes something vanish. Delete is the only thing
                  that deletes, and it sits behind a confirm. */}
              <button
                type="button"
                onClick={() => { const d = openDraftDetail;
                                 setOpenDraftDetail(null);
                                 loadOntoBoard(d.snapshot, d.id); }}
                className="min-w-0 flex-1 truncate rounded-[13px] py-3 text-[15px] font-semibold text-white"
                style={{ background: BRAND }}
              >
                Continue
              </button>
            </>
          }
        />
        <BottomNav active="drafts" onNavigate={navTo} />
        {toastHost}
        {loadSheet}
        {renameSheet}
        {deleteSheet}
      </>
    );
  }

  // ══ SCREEN 8 — ONE SENT ORDER ═══════════════════════════════════════════
  if (screen === "sentDetail" && openSent) {
    return (
      <>
        <OrderDetail
          snapshot={openSent.snapshot}
          status="Sent"
          when={formatSavedAt(openSent.sentAt)}
          shipTo={shipToOf(openSent.snapshot)}
          onBack={requestClose}
          // A chip reading "Sent", on a screen reached from a list headed Sent,
          // from a tab called Sent. The DRAFT detail keeps its chip: Saved vs
          // Auto-saved is a distinction nothing else on that screen makes.
          showStatusChip={false}
          footer={
            /* 🔴 ONE BUTTON, AND NO "EDIT". Send again already puts the order on
               the board, which is where editing happens — a second button would
               be two names for one action. It is also a FRESH order and never a
               re-send: it never re-fires the mailto, so he sees and confirms
               what goes out a second time. */
            <button
              type="button"
              onClick={() => { const snap = openSent.snapshot;
                               setOpenSent(null);
                               loadOntoBoard(snap, null); }}
              className="w-full rounded-[13px] py-3 text-[15px] font-semibold text-white"
              style={{ background: VIOLET }}
            >
              Send again
            </button>
          }
        />
        <BottomNav active="sent" onNavigate={navTo} />
        {toastHost}
        {loadSheet}
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
        <p className="mt-1 text-[19px] font-bold" style={{ color: INK, letterSpacing: "-0.02em" }}>
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
            className="w-full truncate rounded-[13px] py-3 text-[15px] font-semibold text-white"
            style={{ background: BRAND }}
          >
            Another order for {firstWord(sent.dealer.name)}
          </button>
          <button
            type="button"
            onClick={() => {
              setSent(null); startOver();
            }}
            className="w-full rounded-[13px] py-3 text-[15px] font-semibold"
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
          onBack={requestClose}
          onEdit={() => setScreen("order")}
          onRemoveLine={removeLine}
          onOrderChange={setOrder}
          onSend={handleSend}
          onSaveDraft={saveDraft}
          onOpenDealer={openDealerSheet}
          onClearOrder={() => { openLayer(); setSheet("clear"); }}
          reviewSheet={reviewSheet}
          onReviewSheet={(next) => {
            // OPEN pushes; a PICK is a commit that consumes its own entry.
            if (next === null) commitClose(1); else openLayer();
            setReviewSheet(next);
          }}
          onCloseTop={requestClose}
          onOpenShipTo={() => { openLayer(); setQuery(""); setScreen("shipto"); }}
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
            onClose={requestClose}
            footer={
              <>
                <button
                  type="button" onClick={() => setSheet(null)}
                  className="min-w-0 flex-1 rounded-[13px] py-3 text-[15px] font-semibold"
                  style={{ border: `1.5px solid ${RULE}`, color: INK }}
                >
                  Keep
                </button>
                <button
                  type="button" onClick={clearOrder}
                  className="min-w-0 flex-1 rounded-[13px] py-3 text-[15px] font-semibold text-white"
                  style={{ background: URGENT }}
                >
                  Clear
                </button>
              </>
            }
          >
            <div className="shrink-0 px-4 pt-1.5 pb-4">
              <h2 className="text-[18px] font-bold" style={{ color: INK, letterSpacing: "-0.025em" }}>
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
          query={query} onQuery={setQuery}
          onBack={requestClose}
        >
          {/* THE CUSTOMER LIST — the old key, the old data, unchanged. */}
          <CustomerListBody
            customers={customers} starred={starred} query={query}
            currentCode={dealer?.code ?? null}
            onPick={pickDealer}
            onToggleStar={(c) => setStarred(toggleStarred(c, "dealer"))}
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
          query={query} onQuery={setQuery}
          onBack={requestClose}
        >
          {/* A FIXED first row for the default, so "same as billing" is a thing
              you can pick your way back to, not just the absence of a choice.
              Hidden while searching — it is not a search hit. */}
          {query.trim().length === 0 && (
            <button
              type="button"
              onClick={() => { commitClose(1); setShipTo(null); setQuery(""); setScreen("review"); }}
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
              break cross billing.

              🔴 AND IT HAS ITS OWN SHORTLIST. This used to read and write the
              CUSTOMER stars, which made the two screens one list wearing two
              titles: starring a delivery address promoted it among the shops
              he bills, and every shop he bills was offered as a delivery
              address. `shipToStarred` is that list's own store, and both the
              rendered fill and the tap write go to it and nowhere else. */}
          <CustomerListBody
            customers={customers} starred={shipToStarred} query={query}
            currentCode={shipTo?.code ?? null}
            onPick={(c) => { commitClose(1); setShipTo(c); setQuery(""); setScreen("review"); }}
            onToggleStar={(c) => setShipToStarred(toggleStarred(c, "shipto"))}
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
          paddingBottom: belowNav(cartOpen ? 84 : 16),
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
          {/* The wordmark, and opposite it the ONE way into favourites.
              SURAT DEPOT is gone: the search below fills the band, so the row
              does not need balancing, and the depot label was the one thing
              here nobody was reading.

              🔴 WHITE ON THE WASH, for the reason the search bar is white on
              the wash: a violet control on a violet ground disappears. 44px,
              §60's tap-target floor, with the glyph at 18 inside it.

              🔴 IT IS HERE AND NOT ON THE FAVOURITES CARD. The gear used to
              live on that card, and the card hides when there are no
              favourites — so a phone with none had no gear and no way to set
              one. Reported from a real phone. One entry point, on a row that
              is always drawn.

              ⚠ THIS ROW SCROLLS AWAY. Only the search row below is sticky, by
              an earlier decision that a logo need not follow a salesman down a
              page. The gear now rides with the logo, so it is off screen once
              he scrolls into Wood. It is always THERE — never conditional —
              but it is not always ON SCREEN. If that turns out to matter, the
              fix is to move it into the sticky row below, not to make it
              conditional again. */}
          <div className="flex items-center justify-between gap-3">
            <Wordmark size={MASTHEAD_WORDMARK} colour={BRAND} />
            <button
              type="button"
              aria-label="Choose favourite products"
              onClick={openFavPicker}
              className="flex shrink-0 items-center justify-center rounded-full"
              style={{ width: 44, height: 44, background: SURFACE, boxShadow: CARD_SHADOW }}
            >
              <Settings className="h-[18px] w-[18px]" strokeWidth={2.5} style={{ color: BRAND }} />
            </button>
          </div>
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
        {/* ── THE FAVOURITES BLOCK ─────────────────────────────────────────
            🔴 A FAMILY CARD IN EVERY RESPECT EXCEPT THAT IT IS NOT A FAMILY.
            Same section shell, radius, padding, shadow, header row and 4-up
            grid at gap 7, because it behaves like a family and should read as
            one. But it is built from storage, not from BOARD, and it is
            rendered ABOVE the map rather than pushed into the constant —
            BOARD_INVARIANTS bounds a family at 2 to 8 TILES (FAMILY_MIN /
            FAMILY_MAX), so a group holding one favourite would fail the build
            and a group holding none has no tiles at all.

            🔴 NOTHING WHEN EMPTY. Not a prompt, not an empty card. An
            instruction that never goes away costs eight tiles of the first
            screen forever, and the way in is the gear, not a placeholder. */}
        {favViews.length > 0 && (
          <section
            className="mx-4"
            style={{ marginTop: 11, background: SURFACE, borderRadius: 16,
                     padding: "12px 11px 13px", boxShadow: CARD_SHADOW }}
          >
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <h2 className="min-w-0 truncate text-[14px] font-bold" style={{ color: INK }}>
                Favourites
              </h2>
              {/* 🔴 NO GEAR HERE ANY MORE — it moved to the page header. This
                  card hides when there are no favourites, so a gear on it was
                  unreachable from the only state that needs it. The count pill
                  matches every other family card. */}
              <span className="shrink-0 rounded-full font-mono text-[10px]"
                    style={{ color: FAINT, background: FILL, padding: "2px 7px" }}>
                {favViews.length}
              </span>
            </div>
            <div className="grid grid-cols-4" style={{ gap: 7 }}>
              {favViews.map((fav) => {
                const count   = countsByTile[fav.key] ?? 0;
                const inOrder = count > 0;
                return (
                  <button
                    key={fav.key}
                    type="button"
                    disabled={!ready}
                    // 🔴 EXACTLY WHAT ITS HOME TILE DOES — members[0], the top
                    // seller. No initialMember and no initialOption: a
                    // favourite is the TILE, so it opens the drawer the same
                    // way tapping the tile in its own family would, and the
                    // two copies cannot behave differently.
                    onClick={() => {
                      const t = boardTile(fav.key);
                      if (t) { openLayer(); setOpenTile({ tile: t, initialMember: t.members[0].sap }); }
                    }}
                    className="flex min-w-0 flex-col gap-1.5 text-left"
                    style={{ opacity: ready ? 1 : 0.45 }}
                  >
                    <span className="relative block w-full overflow-hidden rounded-[14px]"
                          style={{ aspectRatio: "1 / 1", background: inOrder ? VIOLET_BG : fav.wash }}>
                      {fav.src && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={fav.src} alt={fav.caption} width={600} height={600}
                          decoding="async"
                          // 🔴 EAGER, AND THE BOUND BELOW COMES DOWN TO PAY FOR
                          // IT. This block is the top of the screen now, so
                          // lazy art here would leave the first thing he sees
                          // blank. The family loop drops from two eager to one
                          // so the number of eager blocks does not grow.
                          loading="eager"
                          className="block h-full w-full"
                          style={{ objectFit: "contain", mixBlendMode: "multiply" }}
                        />
                      )}
                      {inOrder && (
                        <span className="absolute flex items-center justify-center rounded-full text-[10px] font-bold text-white"
                              style={{ top: 4, right: 4, minWidth: 18, height: 18, padding: "0 5px", background: VIOLET }}>
                          {count}
                        </span>
                      )}
                    </span>
                    {/* v2 tile label: centred · one size · fixed 2-line block.
                        Applies to every image-with-label grid in v2. Owner
                        ruling 2026-09-09. The caption is the TILE LABEL, the
                        same word its home copy carries — see FavView. */}
                    <span className="block w-full text-center text-[12px] font-semibold" style={TILE_TEXT_STYLE}>
                      {fav.caption}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── FAMILY BLOCKS ────────────────────────────────────────────── */}
        {BOARD.map((family, familyIndex) => {
          // 🔴 THE FIRST TWO FAMILIES LOAD EAGERLY, EVERYTHING BELOW IS LAZY.
          // Eight tiles are what fits above the fold on a 390px phone, and they
          // are the eight a salesman opens most. Marking all 36 eager would put
          // 560 KB on the wire before the first tap on a depot 5G signal that
          // is 5G on the sign and not in the shed; marking all 36 lazy would
          // leave the first screen visibly empty on arrival, which reads as a
          // broken page rather than a loading one.
          // 🔴 WAS < 2, NOW < 1 WHEN THE FAV BLOCK IS SHOWING. The rule this
          // number encodes is "about eight tiles' worth of art loads eagerly,
          // because that is what fits above the fold". Inserting the Fav block
          // above this map does not shift familyIndex, so leaving it at 2 would
          // have made THREE blocks eager and put the extra weight on the wire
          // for nothing. The fav tiles are the ones now at the top, so they
          // take the budget and Enamel keeps the rest.
          const eager = familyIndex < (favViews.length > 0 ? 1 : 2);
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
                // A LOOKUP, NOT A SNIFF — v2-data's TRANSPARENT_ART names the
                // slugs whose file is a cut-out. Nothing about the extension
                // or the folder says whether a background was actually
                // removed; an opaque alpha channel looks identical from here.
                const cut = TRANSPARENT_ART.has(tile.slug);
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
                    onClick={() => { openLayer(); setOpenTile({ tile, initialMember: tile.members[0].sap }); }}
                    className="flex min-w-0 flex-col gap-1.5 text-left"
                    style={{ opacity: ready ? 1 : 0.45 }}
                  >
                    {/* THE SQUARE. No border by design — the art carries the
                        tile and a hairline around 32 of them is a grid of
                        outlines. aspect-ratio holds the space before the image
                        lands, so nothing on the board jumps as they arrive.

                        🔴 A CUT-OUT TILE HAS NO SQUARE AT ALL. See
                        TRANSPARENT_ART in v2-data: the four Enamel tiles carry
                        a tin on transparency, so the tinted panel behind them
                        goes and the tin sits on the card itself.

                        overflow-hidden GOES WITH IT, and has to: the tin fills
                        the box edge to edge, so its drop-shadow falls OUTSIDE
                        that box. Clipping would cut the shadow off exactly
                        where it is meant to show. The rounding is inert
                        without a background, so it goes too.

                        ⚠ THE IN-CART VIOLET WASH DOES NOT RENDER ON THESE
                        FOUR. It is a background, and they have none. The count
                        badge in the corner is what says "in this order" on a
                        cut-out tile — one signal instead of two. Worth an eye
                        before this look spreads past Enamel. */}
                    <span
                      className={`relative block w-full${cut ? "" : " overflow-hidden rounded-[14px]"}`}
                      style={{
                        aspectRatio: "1 / 1",
                        background: cut ? undefined : (inOrder ? VIOLET_BG : wash),
                      }}
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
                            // contain, and the file is already square, so this
                            // is an exact fill — nothing insets and nothing
                            // stretches.
                            objectFit: "contain",
                            // 🔴 MULTIPLY, NOT A PLAIN PAINT — FOR AN OPAQUE
                            // FILE. Those are OPAQUE WHITE squares: the
                            // converter pads the tin to a uniform 84% share, so
                            // painted normally the file would cover the family
                            // wash and every tile would be a white box.
                            // Multiply leaves the backdrop wherever the file is
                            // white and shows the tin everywhere else.
                            //
                            // 🔴 AND IT MUST NOT TOUCH A CUT-OUT. There is no
                            // white ground to drop out, so multiply would just
                            // darken the tin against the card — the pixels are
                            // the product, not a backdrop.
                            mixBlendMode: cut ? undefined : "multiply",
                            // Follows the tin's outline because drop-shadow
                            // reads alpha; a box-shadow would draw the very
                            // rectangle this change removes. See CUTOUT_SHADOW.
                            filter: cut ? CUTOUT_SHADOW : undefined,
                          }}
                        />
                      )}
                      {inOrder && (
                        <span
                          className="absolute flex items-center justify-center rounded-full text-[10px] font-bold text-white"
                          style={{ top: 4, right: 4, minWidth: 18, height: 18, padding: "0 5px", background: VIOLET }}
                        >
                          {count}
                        </span>
                      )}
                    </span>

                    {/* THE NAME, outside the square.
                        v2 tile label: centred · one size · fixed 2-line block.
                        Applies to every image-with-label grid in v2. Owner
                        ruling 2026-09-09.

                        🔴 text-center IS SET HERE, ON THE LABEL. The button
                        above still carries text-left because the tile's other
                        contents want it; before this the label simply
                        INHERITED that and was the only left-aligned thing in
                        either grid. One declaration, on the element it
                        describes — not a change to the button, which would
                        move things that are not labels. */}
                    <span className="block w-full text-center text-[12px] font-semibold" style={TILE_TEXT_STYLE}>
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
            onClick={() => { openLayer(); setScreen("review"); }}
            className="shrink-0 rounded-full px-5 py-2 text-[14px] font-semibold text-white"
            style={{ background: BRAND }}
          >
            View
          </button>
        </div>
      )}

      {/* 🔴 FIVE SITES, AND THE LIST IS CLOSED: the board, the two lists and
          the two details. It is NEVER inside a drawer, the review screen, the
          dealer sheet or the post-send confirmation — each of those is its own
          context with its own way out, and a tab bar under a decision invites
          a tap that abandons it. */}
      <BottomNav active="board" onNavigate={navTo} />
      {toastHost}

      {/* ── PRODUCT DRAWER, from the BOARD ─────────────────────────────── */}
      {/* 🔴 THE WHOLE TILE GOES DOWN, AND THE WHOLE TILE COMES BACK.
          The drawer runs its own member level, so every prop here is
          tile-scoped and the four of them have to agree:

            tile      every member, each resolved on its own rows
            existing  EVERY member's saved lines, not just the open one — seed
                      one and return all and the rest is deleted on Add
            onAdd     memberSap null: replace the tile's lines wholesale,
                      because the picks now cover the tile wholesale
            key       the TILE only. It used to carry the member, which
                      remounted the drawer on every member switch and threw
                      away the quantities the salesman had just typed.

          `pools` and `mode` are gone from here: they are per member and the
          drawer reads them off tile.members, which is where buildBoard put
          them precisely so nothing would be tempted to use the union. */}
      {openTile && openMember && (
        <ProductDrawer
          key={openTile.tile.key}
          product={openMember}
          tile={openResolved ?? undefined}
          initialMember={openTile.initialMember}
          onClose={requestClose}
          onAdd={(picks) => addLines(
            openTile.tile.key, memberLabelIn(openTile.tile), picks, null)}
          existing={existingFor(openTile.tile.key, null)}
        />
      )}

      {/* ── THE FAVOURITES PICKER ────────────────────────────────────────
          🔴 THE ONE WAY TO SET A FAVOURITE. The star used to live in the
          product drawer and the gear on the Favourites card; both are gone.
          The card hides when empty, so its gear was unreachable from the only
          state that needs it, and two entry points for one setting is a
          question about which one is authoritative. One control, in the page
          header, always drawn.

          EVERY PRODUCT, GROUPED BY FAMILY, IN BOARD ORDER — all 98 members,
          not the eight already chosen. This is where he BROWSES: he is not
          looking up a name he knows, he is picking the ones he sells, so
          there is deliberately NO search box. Nine headed groups is a scroll,
          not a problem.

          A SHEET, NOT A SCREEN. The board stays underneath because this is a
          setting he dismisses, not a place he goes.

          No confirm on un-starring. It is not destructive — the product is
          still on its own family tile, untouched, and re-starring is one tap
          on the same star. */}
      {favManage && (
        <V2Sheet onClose={requestClose} fixedHeight footer={
          <button
            type="button" onClick={() => { commitClose(1); closeFavPicker(); }}
            className="w-full rounded-[13px] py-3 text-[15px] font-semibold text-white"
            style={{ background: BRAND }}
          >
            Done
          </button>
        }>
          <div className="shrink-0 px-4 pt-1.5 pb-3">
            <h2 className="text-[18px] font-bold" style={{ color: INK, letterSpacing: "-0.025em" }}>
              Favourites
            </h2>
            {/* The count is the whole state of this screen, so it is the
                subtitle rather than a badge somewhere. At eight it is also the
                warning, which is why it says "of 8" and not just a number. */}
            <p className="text-[11.5px]" style={{ color: MUTED }}>
              {favViews.length} of 8 · they show first on the board
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto"
               style={{ paddingBottom: "calc(76px + env(safe-area-inset-bottom))" }}>
            {pickerGroups.map((group) => (
              <div key={group.name}>
                {/* The family name, as a sticky heading — nineteen Aquatech
                    rows is longer than a screen and losing which family you
                    are in halfway down is how a list stops being browsable. */}
                <h3 className="sticky top-0 z-10 px-4 pb-1.5 pt-3 text-[10px] font-bold uppercase"
                    style={{ color: MUTED, letterSpacing: ".13em", background: SURFACE }}>
                  {group.name}
                </h3>
                {group.rows.map((row) => {
                  const starred = isFavProduct(row.key, favProducts);
                  return (
                    <button
                      key={row.key}
                      type="button"
                      // THE WHOLE ROW IS THE TARGET, not just the star. A 44px
                      // glyph at the far right of a 390px row is a long reach
                      // with a thumb, and there is nothing else a tap here
                      // could mean.
                      onClick={() => toggleFavProduct(row.key)}
                      aria-pressed={starred}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
                      style={{ borderTop: `1px solid ${RULE}` }}
                    >
                      <span className="shrink-0 overflow-hidden rounded-[10px]"
                            style={{ width: 38, height: 38, background: row.wash }}>
                        {row.src && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={row.src} alt="" width={600} height={600} decoding="async" loading="lazy"
                               className="block h-full w-full"
                               style={{ objectFit: "contain", mixBlendMode: "multiply" }} />
                        )}
                      </span>
                      {/* THE TILE LABEL — "PU Prime", the same string the
                          board prints under the same picture, from the same
                          resolveFav, so a row and its tile cannot disagree. */}
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold"
                            style={{ color: starred ? VIOLET : INK }}>
                        {row.caption}
                      </span>
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center">
                        <Star className="h-[18px] w-[18px]" strokeWidth={2.5}
                              fill={starred ? FAVOURITE : "none"}
                              style={{ color: starred ? FAVOURITE : FAINT }} />
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </V2Sheet>
      )}

      {/* ── PRODUCT DRAWER, from a SEARCH HIT ──────────────────────────── */}
      {/* A searched result is now a PRODUCT, so this opens the same drawer its
          tile would — curated chips for one of the 32, or its own payload
          options (sortOrder, capped) for anything else. */}
      {openGroup && groupResolved && (
        <ProductDrawer
          key={`group-${openGroup.key}`}
          product={groupResolved}
          onClose={requestClose}
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
 * The shell both dealer pickers share: back arrow, title, and the search input
 * under them — all sticky, because on a screen whose whole purpose is search
 * the box is the last thing that should scroll away.
 *
 * 🔴 A SCREEN, NOT A SHEET, AND THAT IS THE FIX. A bottom sheet has to be
 * sized against something, and with the soft keyboard up the thing it was
 * sized against was the wrong viewport — twice. A page has no such problem:
 * the keyboard shrinks the viewport, the page scrolls, and the browser handles
 * it without being told. Same shell as Drafts and Sent.
 */
function PickerScreen({ title, query, onQuery, onBack, children }: {
  title: string;
  query: string;
  onQuery: (next: string) => void;
  onBack: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <main className="min-h-screen w-full" style={{ background: SURFACE, paddingBottom: 24 }}>
      {/* ── THE BAND ──────────────────────────────────────────────────────
          The wash, the rule under it and the safe-area treatment are the board
          masthead's own values (the block above ProductSearchInput), so
          stepping off the board into a picker does not look like leaving the
          app. The vertical rhythm is the board's too — 16 above the title row,
          12 to the search, 16 below it.

          🔴 THE WORDMARK WAS HERE FOR ONE COMMIT AND IS GONE (cd85e189, and
          reverted the same day). A logo identifies an APP; this band has to
          identify a SCREEN, and the screen is a question — "Who is this order
          for?" — that the list underneath answers. With Orbit in the band the
          question was pushed into the scrolling body, where it scrolled away
          from the search box that belongs with it. The wordmark now lives on
          the board and the splash and nowhere else.

          🔴 THE TITLE AND THE SEARCH ARE PINNED TOGETHER, and that is the
          whole point of this block. On a screen whose entire purpose is search,
          the box is the last thing that should scroll away — and the question
          it is answering has to still be on screen while he types. Both are
          inside this one sticky div; do not move either of them out of it.

          ⚠ NO GEAR ON THE RIGHT. Favourite PRODUCTS belong to the board, and
          this screen picks a dealer. The right-hand side stays empty. */}
      <div
        className="sticky top-0 z-10 px-2"
        style={{
          background: BRAND_WASH,
          borderBottom: `1px solid ${RULE}`,
          // PADDING, NOT MARGIN — the wash has to run under the status bar.
          paddingTop: "calc(env(safe-area-inset-top) + 16px)",
          paddingBottom: 16,
        }}
      >
        <div className="flex items-center gap-1">
          <button
            type="button" aria-label="Back" onClick={onBack}
            className="flex h-9 w-9 shrink-0 items-center justify-center"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.5} style={{ color: INK }} />
          </button>
          {/* SCREEN_TITLE — 20/700, and THIS screen is the one that still fits
              the description in that constant's own note: the biggest text on
              the screen, alone on its line, naming the screen.

              ⚠ CHECKOUT NO LONGER SHARES IT. The dealer name in the review
              header forked to DEALER_TITLE (17/600) because it has to wrap
              beside two icon buttons and above a code line, which is a
              different job at a different width. Do not "reunify" them on the
              strength of them once having matched — the fork is the point, and
              the two constants sit next to each other in v2-data saying so.

              🔴 THE SUBORDINATE NOTE IS GONE, and the band is shorter for it.
              It said "{n} lines in this order — they stay" here and "the bill
              still goes to {dealer}" on ship-to: two reassurances against a
              fear nothing on the screen creates. Nothing about picking a dealer
              suggests the order is at risk, so the line answered a question
              nobody asked while pushing the search box further from the title
              it belongs with. The title alone is the band now. */}
          <span className="min-w-0 flex-1">
            <span className="block truncate" style={{ ...SCREEN_TITLE, color: INK }}>
              {title}
            </span>
          </span>
        </div>
        <div className="px-2 pt-3">
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
 * Board / Drafts / Sent.
 *
 * 🔴 IT COSTS ABOUT 50px OF BOARD AND IS WORTH IT. Without it there is no way
 * at all to reach a saved draft or today's sent orders — po2_saved_drafts and
 * po2_sent_orders would keep being written and could never be read back. That
 * was the regression the old dealer-list screen had been quietly covering.
 *
 * 🔴 IT USED TO HARDCODE ITSELF, AND THAT WAS ONE BUG WEARING TWO FACES.
 *
 * It was written when it rendered on the BOARD and nowhere else, so it said
 * `on: true` for Board and gave Board no `go` — the comment above it even
 * claimed "there is no prop to pass wrong". bba21b8c put it on four more
 * screens without giving it either. From the Drafts or Sent list, and from
 * both details, Board was therefore the lit tab AND a dead button: the
 * handler is `go && onNavigate(go)` and Board had no `go`. Wrong tab lit,
 * no way home, one cause.
 *
 * So the active tab is now a PROP the caller states, and every item has a
 * destination. `active` is the SCREEN GROUP, not the screen: a detail lights
 * the tab of the list it belongs to, because that is where the user is.
 */
function BottomNav({ active, onNavigate }: {
  active: "board" | "drafts" | "sent";
  onNavigate: (screen: "order" | "drafts" | "sentList") => void;
}): React.JSX.Element {
  const items: { label: string; icon: typeof Grid2x2; tab: "board" | "drafts" | "sent";
                 go: "order" | "drafts" | "sentList" }[] = [
    { label: "Board",  icon: Grid2x2,  tab: "board",  go: "order" },
    { label: "Drafts", icon: FileText, tab: "drafts", go: "drafts" },
    { label: "Sent",   icon: Send,     tab: "sent",   go: "sentList" },
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
      {items.map(({ label, icon: Icon, tab, go }) => {
        const on = tab === active;
        return (
          <button
            key={label} type="button"
            // Every tab navigates, the lit one included. Tapping the screen you
            // are already on is a no-op state set, not a dead button.
            onClick={() => onNavigate(go)}
            aria-current={on ? "page" : undefined}
            className="flex flex-1 flex-col items-center gap-0.5"
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2.5} style={{ color: on ? VIOLET : FAINT }} />
            <span className="text-[10px] font-bold" style={{ color: on ? VIOLET : FAINT }}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
