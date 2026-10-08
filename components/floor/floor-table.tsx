"use client";

// Floor Control — the floor row table (design §7.5). Fixed layout, colgroup
// percentages summing to 100 (CLAUDE_UI §27). Rendered by the flat slot-tab
// view, inside each slot band (All), inside each route row (By route), and by
// the Upcoming strip — one component, three `variant`s.
//
// Step 5: the checkbox and the ⚡ row action are now LIVE (selection + urgent
// toggle). The ⋯ (details) button stays INERT — the detail panel is a later
// step. On history/upcoming variants everything stays read-only.
//
// COLUMNS: ☐ · OBD+date · Invoice · Ship to · Route · Due · Vol/KG · Article tag
//          · Article (supervisor's article no., 2026-10-06) · Status
//  - The # and Picker columns were REMOVED 2026-09-10 with the trip desk. See
//    the width arrays for the before/after counts.
//  - 🔴 DUE IS THE OLD `showSlot` COLUMN PROMOTED, not a new one beside it.
//    That column was built on 2026-08-31 for the By-group view alone, for
//    exactly this reason: grouping deliberately spanned slots, so there was no
//    slot TAB to carry the time and the row had to say it itself. The slot tabs
//    are now gone from every view, so every view has that problem and every
//    view gets the column. What changed with the promotion: the date leads
//    instead of hiding in a 10px line underneath, "Today" is spelled out, a
//    future date reads blue and an overdue one red, and the age chip moved in
//    beside it. The `showSlot` flag is retired — see `showInvoice` below.
//  - Vol and KG are ONE STACKED COLUMN (2026-09-10 c): litres on line one,
//    kilos underneath, both right-aligned and tabular. Two side-by-side
//    numeric columns cost two lots of 28px cell padding and two column
//    minimums for two short values that are read together, and ten positions
//    did not fit — Due, Status and Article were all clipping on the live
//    screen. Stacking them is one position for the same two facts, and it is
//    the shape the OBD and Invoice cells already use. Gift lines OUT OF SCOPE.
//  - KG renders an EM DASH at zero, never "0" — see the cell.
//  - Article reuses formatArticleTag (D/C/T/B), CLAUDE_SUPPORT §4.19.
//  - The ☐ and # columns use NARROW padding so the row number never truncates
//    (Step-5 bug fix — 3% + 28px padding was clipping "1" to "1…").
//  - Invoice (2026-08-31) is SAP's own invoiceNo + invoiceDate, two lines,
//    shaped like the OBD cell and sitting right next to it — the two reference
//    numbers are scanned together. BLANK until SAP stamps the bill; absent
//    entirely on the showSlot (By group) arms. See the cell and `showInvoice`.

import type { ReactNode } from "react";
import { Building2, MoreHorizontal, Zap } from "lucide-react";
import { formatArticleTag } from "@/lib/floor/format";
// The OBD date line + Invoice lines + fmtDateTime live in ./bill-ref-cells
// (2026-10-02) so the Tint Manager renders Floor's markup, not a copy. Output
// here is byte-identical. formatDateIST (the shared date-only formatter the
// panel's "Invoice date" reads) is used inside InvoiceLines.
import { InvoiceLines, ObdDateLine, fmtDateTime } from "./bill-ref-cells";
// TINT / BASE -- one owner for the word, shared with both picking boards. The
// pinks it paints are copied FROM this module's neighbour status-pill.tsx.
import { ColourWorkBadge } from "@/components/picking/card-atoms";
import { GiftBadge } from "./gift-badge";
import { HandBadge } from "@/components/shared/hand-badge";
import { ChallanBadge } from "@/components/shared/challan-badge";
import {
  StatusPill,
  rowStatus,
  isHeldBack,
  formatLitres,
  sumLitres,
  formatWeightKg,
  sumWeightKg,
} from "./status-pill";
import { deskKeyOf, isAllDeskSelected, type FloorDeskKey } from "@/lib/floor/selection";
// SOFT variant only (2026-08-25). The solid DUP_SO_* tokens are the PICKING
// treatment and are deliberately no longer imported here: under `soft` every
// cell, badge and pill on a duplicate row renders exactly as it does on an
// ordinary row, so there is nothing left to flip. See the two-treatment note at
// the top of duplicate-so-tag.tsx.
import {
  DuplicateSoTag,
  DUP_SO_SOFT_ACCENT,
  DUP_SO_SOFT_BAR,
} from "@/components/shared/duplicate-so-tag";
// INVOICE PAIRS (2026-10-08) — which rows merge, what a split row says.
import {
  KOfNChip,
  PairPlaceChip,
  buildPairRenders,
  pairBarShadow,
  useFloorPairRows,
  type PairRender,
} from "./pair-cells";
import type { FloorBoardRow } from "@/lib/floor/types";

export type FloorTableVariant = "live" | "history" | "upcoming";

// Retail Offtake / Decorative Projects = "goes to a site" SMUs (CORE §8; site
// set CONFIRMED against live data 2026-07). "Deco" (9 rows) is a known parked
// data issue — deliberately NOT handled here.
const PROJECT_SMUS = new Set(["Retail Offtake", "Decorative Projects"]);

// THE SEARCH HIT (2026-10-06). Floor search marks every bill the number named
// with `data-search-hit="on"` (floor-page.tsx, found by the row's
// `data-order-id`), and it STAYS until Clear search, a new search, or another
// row's detail panel. This is that mark: AMBER from the Orbit `warn` tokens —
// `warn.bg` ground + a 3px solid `warn` bar on the first cell. Not the violet
// selected look (a found row is not a ticked row), not ok-green Done, not the
// tint pill, not re-delivery orange.
//
// 🔴 `!` ON BOTH, ON PURPOSE. A row that is selected AND found shows amber
// (the selected look is `bg-brand-50` + a brand bar), and a duplicate-SO row
// paints its bar as an INLINE boxShadow on the first cell — only !important
// beats an inline style. Exported so the Hold and Cancel & CI tables wear the
// identical class; inert anywhere nothing sets the attribute (Freight Trips).
// ⚠ The bar is ONE arbitrary variant, not `data-[…]:[&>td:first-child]:` — that
// stacking compiles to `tr>td:first-child[data-search-hit=on]` (the attribute
// on the CELL), which never matches. Checked in the built CSS.
export const SEARCH_HIT_ROW_CLS =
  "data-[search-hit=on]:!bg-warn-bg [&[data-search-hit=on]>td:first-child]:!shadow-[inset_3px_0_0_theme(colors.warn.DEFAULT)]";

// Exported so the Hold and Cancelled tabs mark a site bill / a redirect by the
// SAME rule the floor table uses (design §7.5). Shared predicate, not shared
// markup — each table owns its own cell, but the rule can never drift.
export function shipMarkers(row: { smu: string | null; isShipToOverride: boolean }): {
  isSite: boolean;
  isRedirect: boolean;
} {
  return {
    isSite: row.smu !== null && PROJECT_SMUS.has(row.smu) && !row.isShipToOverride,
    isRedirect: row.isShipToOverride,
  };
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function asStr(v: string | Date | null): string | null {
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  return null;
}
function hhmm(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}
function istDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function diffDays(fromDayIso: string, toDayIso: string): number {
  const [ay, am, ad] = fromDayIso.split("-").map(Number);
  const [by, bm, bd] = toDayIso.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
// Two-char units (design §7.7): 16m / 17h / 2d.
function shortElapsed(fromIso: string | null, nowMs: number): string | null {
  if (!fromIso) return null;
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from)) return null;
  const mins = Math.max(0, Math.floor((nowMs - from) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}
/**
 * The trip tag's SHORT form — "L-260910-02" → "L-02".
 *
 * 🔴 IT EXISTS BECAUSE THE FULL NUMBER TRUNCATED TO NOTHING USEFUL. The tag
 * rides inside the OBD cell (no column was added — see the note at the call
 * site), and that cell already carries the OBD number, a possible duplicate-SO
 * tag and a possible age chip. An eleven-character number ellipsised to "L-26…"
 * tells the reader the type letter and the century, which is no information at
 * all. The type and the sequence are what distinguish one of the day's trips
 * from another, and every band on screen is the same day, so the date is the
 * part that can go.
 *
 * ⚠ THE FULL NUMBER IS STILL REACHABLE — it is the band header above the row,
 * and it is on the tag's `title` for a hover. Nothing is hidden, only shortened.
 *
 * ⚠ FALLS BACK TO THE WHOLE STRING on anything that is not the expected shape.
 * The format is `{T}-{YYMMDD}-{NN}` and `chk_trips_number_shape` enforces it in
 * the database, so the else branch should be unreachable — but a tag is not
 * worth throwing over, and printing the real value is the honest failure.
 */
function shortTripNumber(tripNumber: string): string {
  const m = tripNumber.match(/^([A-Z])-\d{6}-(\d+)$/);
  return m ? `${m[1]}-${m[2]}` : tripNumber;
}

// dispatchTargetDate is date-only — parse the Date.UTC way, never new Date(str).
function fmtDay(dateOnly: string | null): string {
  if (!dateOnly) return "";
  const [y, m, d] = dateOnly.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WD[dt.getUTCDay()]} ${dt.getUTCDate()} ${MON[dt.getUTCMonth()]}`;
}

/**
 * The Due column's day label — "Sat 12", or "Mon 8 Sep", or NULL for the day the
 * board is anchored on.
 *
 * 🔴 NULL ON THE ANCHOR DAY, WHICH MAKES THE CELL SHOW A BARE TIME. READ THIS
 * BEFORE "FIXING" IT, because it looks exactly like the landmine FLOOR §10
 * records and it is the opposite of it.
 *
 * THE OLD BUG: the slot tabs printed "10:30" and the date appeared NOWHERE — not
 * on the tab, not on the row, not in the header. Wednesday's 10:30 and
 * Thursday's 10:30 sat in one pile and there was no way, anywhere on the screen,
 * to tell them apart. The bare time was unreadable because it was unqualified.
 *
 * WHY THIS IS SAFE: the date is printed the moment it is not the anchor day, on
 * the row itself, in colour. So a bare time now MEANS the anchor day and can
 * mean nothing else — "10:30" and "Sat 12 · 10:30" are two different cells, and
 * a reader who sees no date has been told the date. Spelling out "Today" on the
 * ~80% of rows that are due today (53 of 66, measured 2026-09-10) cost the
 * column enough width to clip the ones that are not, which turned the honest
 * label into the reason the useful one was unreadable.
 *
 * ⚠ "ANCHOR DAY", NOT "TODAY". In History the board shows a past day and its
 * rows are that day's, so the bare time means the day on screen. That is why
 * this takes `anchorIso` rather than reading a clock.
 *
 * ⚠ THE MONTH APPEARS ONLY WHEN IT DIFFERS from the anchor. The mockup writes
 * "Mon 8" and "Sat 12", which is right for a bill a few days either side of
 * today and wrong for the case that matters most: a badly carried-over bill
 * dated 8 August, on a September board, would read "Mon 8" and be taken for the
 * 8th of this month. The age chip beside it says 33d, but the DATE would be a
 * lie, so the month goes back in exactly when it is load-bearing.
 *
 * ⚠ NEVER `new Date(str)` — both arguments are date-only "YYYY-MM-DD" and an
 * offset-less string is read in the HOST's timezone (CORE §3). Same Date.UTC
 * parse fmtDay above uses.
 */
function fmtDueDay(dateOnly: string, anchorIso: string): string | null {
  if (dateOnly === anchorIso) return null;
  const [y, m, d] = dateOnly.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const sameMonth = dateOnly.slice(0, 7) === anchorIso.slice(0, 7);
  return sameMonth
    ? `${WD[dt.getUTCDay()]} ${dt.getUTCDate()}`
    : `${WD[dt.getUTCDay()]} ${dt.getUTCDate()} ${MON[dt.getUTCMonth()]}`;
}

// Live elapsed by status (design §7.7). Waiting has NO anchor in the payload —
// no release/updated timestamp on FloorBoardRow — so it shows no time; an honest
// blank beats a wrong duration (deferred follow-up needs releasedAt).
/**
 * The time inside a live pill. In-progress states show ELAPSED, finished states
 * show the CLOCK — the board's standing rule, unchanged.
 *
 * ── THE TINT PILLS GET ONE TIME BETWEEN THEM, AND THAT IS THE HONEST ANSWER
 * (2026-09-14). Four times were wanted; the board payload can supply exactly
 * one, and the other three live on `tint_assignments`, which the board query
 * deliberately does not read (the rail feed that used to was deleted on
 * 2026-09-13 for costing 772 ms and 25 statements of a request nothing
 * rendered). Fetching for a pill would spend that back:
 *
 *   Waiting        ELAPSED, and it is real. A tint order is created straight at
 *                  `pending_tint_assignment` (app/api/import/obd/route.ts:3307),
 *                  so its arrival IS the moment it began waiting for an
 *                  operator. `obdDateTime` is already on the row.
 *   With operator  would need `tint_assignments.createdAt`  — NOT on the payload.
 *   Tinting        would need `tint_assignments.startedAt`  — NOT on the payload.
 *   Tint done      CLOCK, added 2026-09-14 after the cost was measured. The
 *                  board now reads ONE tint column, `tintCompletedAt`, for
 *                  exactly this pill — see that field on FloorBoardRow.
 *
 * The three without a source render with NO TIME rather than borrowing one that
 * looks right and is not — `obdDateTime` would tick up for all of them and read
 * as "mixing for 3d" on a bill an operator picked up ten minutes ago. All three
 * timestamps ARE on the detail panel, which reads the assignment row once, on
 * click. That is the trade: a clock per row would cost a round trip on every
 * board load and every 30-second poll; a click costs one, when asked.
 */
function liveTime(row: FloorBoardRow, nowMs: number): string | null {
  const st = rowStatus(row);
  if (st === "done") return hhmm(asStr(row.checkedAt));
  // Direct Loading — finished, so the clock, same format as Done; the time it
  // was loaded (it has no checkedAt: no assignment row).
  if (st === "direct") return hhmm(asStr(row.directLoadedAt));
  if (st === "needsCheck") return shortElapsed(asStr(row.pickedAt), nowMs);
  if (st === "withPicker") return shortElapsed(asStr(row.assignedAt), nowMs);
  if (st === "tintPending") return shortElapsed(asStr(row.obdDateTime), nowMs);
  // FINISHED, so the CLOCK, exactly as "done" reads — the board's standing rule
  // is elapsed while in progress, wall time once finished. Null when the stamp
  // is missing: no time beats a borrowed one (2026-09-14).
  if (st === "tintDone") return hhmm(asStr(row.tintCompletedAt));
  return null;
}

// Ship-to flags (design §7.5). Both markers are exact: the site rule reads the
// SMU set above, and a redirect now prints the real ORIGINAL → REDIRECT pair —
// FloorBoardRow carries `customerName` + `shipToOverrideName` alongside the
// effective `dealerName` (lib/floor/types.ts), the same pair the rail card has
// always shown. (It used to have only the effective dealer and could print a
// nameless "→ ship-to changed" caption — CLAUDE_FLOOR §8b.)
function shipInfo(row: FloorBoardRow) {
  return shipMarkers(row);
}

// ── THE SQUARE TAGS OF THE SHIP-TO BLOCK TABLE (2026-10-06, owner; mockup
// floor-division-blocks-final.html .cw.t / .cw.b) ─────────────────────────────
// `shipToBlock` rows ONLY. Floor-local on purpose: ColourWorkBadge, GiftBadge,
// HandBadge and DuplicateSoTag are shared pills (Picking cards, Hold, the rail…)
// and keep their rounded look everywhere else. The WORDS and RULES are theirs —
// only the shape and the TINT / BASE / GIFT colours here are the block view's.
const BLOCK_TAG_COLOUR_WORK = {
  tint: "bg-[#fdf2f8] text-[#be185d]",
  // Brown, so BASE never reads as a paler TINT.
  base: "bg-[#f6f1ea] text-[#8a5a2b]",
} as const;
const BLOCK_TAG_GIFT = "bg-[#f4f4f6] text-[#55556a]";
// The danger soft pair Floor already uses (cancelled-tab.tsx, floor-action-bar.tsx).
const BLOCK_TAG_URGENT = "bg-danger-bg text-danger-text";
// HandBadge's own colours (components/shared/hand-badge.tsx) WITHOUT its 1px
// border, so every block tag is one height (owner, 2026-10-06).
const BLOCK_TAG_HAND = "bg-data-brown/10 text-data-brown";
// DUP_SO_SOFT_BADGE_CLASS's colours (components/shared/duplicate-so-tag.tsx)
// without its border — same reason.
const BLOCK_TAG_SAME = "bg-[#fef2f2] text-[#b91c1c]";
// ChallanBadge's own colours (components/shared/challan-badge.tsx — CLAUDE_UI §3
// "Split" purple) without its border, the same treatment HAND gets above.
const BLOCK_TAG_CHALLAN = "bg-purple-50 text-purple-700";

/**
 * The block row's per-bill tags, in the owner's order: URGENT · TINT/BASE ·
 * GIFT · HAND · SAME. Each keeps its surface's own test — URGENT is
 * `priorityLevel === 1`, the ⚡ rule; TINT/BASE is `colourWork`, the
 * ColourWorkBadge rule. Only the first tag gets the ~8px gap after the number.
 */
function blockTags(row: FloorBoardRow, dup: boolean): ReactNode[] {
  const tags: Array<{ key: string; cls: string; title: string; label: string }> = [];
  // CHALLAN (2026-10-07, Challan orders M1) — FIRST: it says why the number in
  // front of it is an ORB number. This table's square shape; the shared
  // ChallanBadge pill everywhere else.
  if (row.isChallanOrder)
    tags.push({ key: "challan", cls: BLOCK_TAG_CHALLAN, title: "Challan order — goods sent without a SAP bill yet", label: "Challan" });
  if (row.priorityLevel === 1) tags.push({ key: "urgent", cls: BLOCK_TAG_URGENT, title: "Urgent", label: "Urgent" });
  if (row.colourWork !== null)
    tags.push({
      key: "cw",
      cls: BLOCK_TAG_COLOUR_WORK[row.colourWork],
      title: row.colourWork === "tint" ? "Tinted — colour mixed by an operator" : "Base — no tinting",
      label: row.colourWork === "tint" ? "Tint" : "Base",
    });
  if (row.isGift) tags.push({ key: "gift", cls: BLOCK_TAG_GIFT, title: "Gift — not counted in L / kg", label: "Gift" });
  if (row.isHand)
    tags.push({
      key: "hand",
      cls: BLOCK_TAG_HAND,
      title: "Hand — the dealer collects from the depot. Plan it on a Hand trip.",
      label: "✋ Hand",
    });
  if (dup)
    tags.push({
      key: "same",
      cls: BLOCK_TAG_SAME,
      title: "Another live order shares this SO number — open both and check",
      label: "Same",
    });
  return tags.map((t, i) => (
    <BlockTag key={t.key} cls={t.cls} first={i === 0} title={t.title}>
      {t.label}
    </BlockTag>
  ));
}

function BlockTag({
  cls,
  first = false,
  title,
  children,
}: {
  cls: string;
  /** The first tag after the OBD number gets the ~8px gap; the rest 6px. */
  first?: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      aria-label={title}
      className={`${first ? "ml-2" : "ml-1.5"} inline-block whitespace-nowrap rounded-[4px] px-[5px] py-[1px] align-[1px] text-[10.5px] font-bold uppercase leading-[1.4] tracking-[0.06em] ${cls}`}
    >
      {children}
    </span>
  );
}

const HEAD_TH = "h-[31px] border-b border-[#ebebeb] px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const HEAD_TH_NARROW = "h-[31px] border-b border-[#ebebeb] px-1 text-center text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
// ⚠ THE BASE + SKIN SPLIT IS GONE, and its absence is the point. It existed
// because the SOLID duplicate-SO row needed its own border AND text colour, and
// appending `text-white` after `text-[#4b5563]` does not reliably win (Tailwind
// resolves same-property utilities by stylesheet order, not class-string order).
// Under the SOFT variant a duplicate row keeps the standard border and the
// standard text — only its ground and its left bar change — so there is exactly
// one cell class again and no conflicting utility to sequence.
const TD = "px-3.5 py-2 text-[11px] whitespace-nowrap overflow-hidden text-ellipsis border-b border-[#f0f0f0] text-[#4b5563]";
const TD_NARROW = "px-1 py-2 text-center text-[11px] border-b border-[#f0f0f0] text-[#4b5563]";

export function FloorTable({
  rows,
  nowMs,
  variant = "live",
  selection,
  onToggleRow,
  onToggleAll,
  onMarkUrgent,
  onOpenDetail,
  onToggleRedelivery,
  onOpenRedelivery,
  showInvoice = true,
  operatorByOrderId,
  upcomingRows,
  anchorIso,
  chipFor,
  gateOn = false,
  hideTripTag = false,
  showArea = false,
  selectionLocked = false,
  shipToBlock = false,
  part,
  billedToFor,
}: {
  rows: FloorBoardRow[];
  nowMs: number;
  variant?: FloorTableVariant;
  /**
   * Drop the trip tag from the OBD cell (floor redesign, 2026-09-15, owner).
   *
   * TRUE only for the per-stop tables INSIDE a trip panel: every bill there is
   * on that trip, so the tag repeats the heading on every row. The pool, the
   * upcoming half and By route keep it — out there trips are mixed together and
   * the tag is the only thing saying which load a bill belongs to.
   */
  hideTripTag?: boolean;
  /**
   * Show the bill's AREA in the Route column's place (2026-09-19, owner).
   *
   * TRUE only for the tables a By route CARD opens: every bill there is on the
   * route the planner clicked, so Route would repeat its heading on every row,
   * and Area is what varies. Flat keeps Route, and so does the trip panel.
   *
   * ⚠ IT CHANGES A CELL AND ITS HEADER, NEVER A COLUMN — the same slot, the
   * same width entry, so the cards' tables line up with every other table on
   * the screen (see the ROUTE cell below for what a missing cell does).
   */
  showArea?: boolean;
  /**
   * Keep the tick column but render NO tick boxes in it (2026-09-18).
   *
   * TRUE only for the trip panel while bills are being ADDED to it: the trip
   * sits above the pool, and one shared selection means a ticked trip row
   * would mix "take this off" into an add. The column itself stays — dropping
   * it (by omitting the selection handlers, as the read-only views do) would
   * change `widths` and slide every column of the trip sideways the moment
   * "+ Add bills" is pressed, which is exactly the movement this avoids.
   */
  selectionLocked?: boolean;
  /**
   * THE SHIP-TO BLOCK TABLE (2026-10-06, owner — the open route card's
   * division bands, components/floor/ship-to-blocks.tsx). Seven positions:
   * OBD · Invoice · Area · Due · Vol/KG · Article · Status. NO tick column —
   * the row itself is the tick (click / Space / Enter) and the OBD number opens
   * the detail panel. Ship to is GONE — the block header above the table names
   * the ship-to, and every bill under it goes there.
   *
   * 🔴 ONE FLAG, TESTED IN ALL THREE PLACES — the colgroup (`widths`), the <th>
   * row and the <td>s. The marks the Ship-to cell carried per bill (TINT/BASE,
   * ⚡ → an URGENT tag, GIFT, HAND) move into the OBD cell as square tags
   * (`blockTags`), still behind this flag; ★ and the
   * site icon belong to the block header. Invoice is always on (it implies
   * `hasExtra`). Default false = every other caller is byte-identical.
   */
  shipToBlock?: boolean;
  /**
   * Draw only PART of the table (2026-10-06, the block layout only):
   *   "head" — colgroup + header row, no body. The ONE header a route section
   *            shows above all its blocks; its tick covers `rows`.
   *   "body" — colgroup + body, no header. Each block's own table.
   * Both halves use the same `widths`, so the columns line up down the section.
   * Omitted = the whole table, as every other caller has it.
   */
  part?: "head" | "body";
  /**
   * Per-row "billed to X" under the OBD date line — ONLY with `shipToBlock`,
   * and only passed when the bills in a block disagree about who they are
   * billed to (otherwise the block header says it once). Null = no line.
   */
  billedToFor?: (row: FloorBoardRow) => string | null;
  // Wired only on the live variant; undefined on history/upcoming.
  // A plain Set<number> (Hold-style callers) or the desk's Set<number | rd:id>;
  // read-only here — the table only asks `has`.
  selection?: ReadonlySet<FloorDeskKey>;
  onToggleRow?: (id: number) => void;
  onToggleAll?: (rows: FloorBoardRow[]) => void;
  onMarkUrgent?: (id: number) => void;
  onOpenDetail?: (id: number) => void;
  /**
   * RE-DELIVERY rows (2026-10-03, row.redelivery set by trip-desk.tsx). Their
   * tick goes HERE with the trip_redeliveries id — never onToggleRow with the
   * bill's orderId (lib/floor/selection.ts deskKeyOf). Their RE-DEL chip and ⋯
   * open the read-only info modal; they have no ⚡ and no detail panel.
   */
  onToggleRedelivery?: (redeliveryId: number) => void;
  onOpenRedelivery?: (redeliveryId: number) => void;
  /**
   * Render the Invoice column? Default true.
   *
   * ⚠ THIS PROP WAS CALLED `showSlot` UNTIL 2026-09-10 AND WAS INVERTED. It
   * used to mean "swap Picker for a Slot column", and the Invoice column's
   * presence fell out of it as `showInvoice = !showSlot` — a consequence the
   * old comment flagged as a coincidence rather than a rule. The Due column is
   * now unconditional (it IS that Slot column, promoted — see the file header),
   * so the only thing the flag still controlled was Invoice. Renaming it to
   * what it does is the whole change; the two call sites that passed `showSlot`
   * now pass `showInvoice={false}` and get the identical column set they got
   * before, minus the duplicate date column they would otherwise now have.
   *
   * OWNER DECISION 2026-08-31, unchanged: NO Invoice column on those arms. They
   * are WAITING-ONLY views, and a waiting bill has no invoice by construction
   * (live check that day: 0 of the 4 still-open rows carried one, against 65 of
   * the 70 at pick_checked) — a permanently blank column on the views with the
   * least room to spare.
   */
  showInvoice?: boolean;
  /**
   * Order id → tint operator name, for the Tinting tab's Operator column
   * (2026-09-14). Absent everywhere else, and the column with it.
   *
   * 🔴 IT TAKES THE INVOICE COLUMN'S SLOT RATHER THAN ADDING A TENTH. This
   * file's own header warns that the widths, the `<th>`s and the `<td>`s map
   * POSITIONALLY and that one missing cell shifts every column to its right —
   * a bug that has already happened once, to Route. A third conditional would
   * have taken the width matrix from four arms to eight, each hand-counted to
   * 100. Sharing one slot keeps it at four and keeps ONE condition, `hasExtra`,
   * in all three places.
   *
   * The two are MUTUALLY EXCLUSIVE and the Tinting tab passes
   * `showInvoice={false}` alongside this. That costs nothing real: an invoice
   * number is stamped by SAP long after picking, and every bill on that tab is
   * at `pending_tint_assignment` or `tint_assigned` — the column would be blank
   * on every row, which is the same argument the two waiting-only views already
   * won for dropping it.
   *
   * ⚠ A MISS RENDERS A DASH, NOT A BLANK. A bill at `pending_tint_assignment`
   * has no assignment row by definition, and an empty cell would read as "we do
   * not know" rather than "nobody has it".
   */
  operatorByOrderId?: Map<number, string | null>;
  /**
   * Bills promised for a LATER date — `zone: "upcoming"` (lib/floor/queries.ts).
   *
   * 🔴 RENDERED IN THIS TABLE, BELOW A DIVIDER, NOT IN A STRIP OF THEIR OWN.
   * They used to live in `upcoming-strip.tsx`, a collapsed block at the foot of
   * the board whose rows could not be ticked; that component stopped rendering
   * with the old board on 2026-09-10 and the bills vanished from the screen
   * entirely. They are back in the list because a planner building Saturday's
   * load on Thursday needs to SEE Saturday's bills and put them on a trip, and
   * a locked strip made that impossible.
   *
   * ⚠ THEY ARE ORDINARY ROWS. Same cells, same checkbox rules, same actions —
   * the ONLY thing marking them is the divider above them and the blue date in
   * their own Due cell. Nothing here re-implements the old lock, and nothing
   * should: locking assignment is /picking's job and it still does it, on
   * `zone` (picking-board-mobile.tsx:4281).
   *
   * Omitted or empty = no divider, no extra rows, byte-identical to a table
   * without this prop.
   */
  upcomingRows?: FloorBoardRow[];
  /**
   * The day this board is anchored on, "YYYY-MM-DD" — what the Due column calls
   * "Today".
   *
   * ⚠ NOT A CLOCK READ. In History the board shows a PAST day and its rows are
   * that day’s, so "Today" has to mean the day on screen, not the real one.
   * FloorBoardResult.date is exactly that anchor (lib/floor/queries.ts sets it
   * from anchorDate) and the desk passes it straight through.
   *
   * Omitted, it falls back to the IST calendar day of `nowMs`, which is correct
   * for every live caller and is what a caller with no board payload would mean.
   */
  anchorIso?: string;
  /**
   * Is the picking visibility gate ON? (2026-09-09.)
   *
   * ⚠ CHANGES A CELL'S CONTENT, NEVER THE COLUMN SET. It swaps the Status
   * pill's label on held-back waiting rows and does nothing else — no colgroup
   * entry, no <th>, no width array arm. That is the entire point of carrying
   * this fact on an element that is already in every row: the widths map
   * POSITIONALLY (see the warning above `widths`), so a tenth column here would
   * shunt every column right on two of the four arms.
   *
   * Default false = every pre-existing call site is byte-identical, and so is
   * the whole screen whenever the gate is off.
   */
  gateOn?: boolean;
  /**
   * Optional chip rendered under the dealer name in the Ship-to cell. The
   * caller owns the whole element, so no tone/colour vocabulary leaks into this
   * table. Undefined (every pre-existing call site) renders nothing at all.
   */
  chipFor?: (row: FloorBoardRow) => ReactNode;
}) {
  // A live table is interactive only when a caller actually wired selection.
  // Every existing live call site passes onToggleRow (floor-board's selProps),
  // so this is byte-identical for all of them; history/upcoming were already
  // false on `variant` alone. What it BUYS: the By-picker "what he's holding"
  // view (2026-08-11) renders the ordinary live table — live status pills, ⚡
  // and ⋯ still working — simply by omitting the selection handlers, with no
  // new prop threaded through slot-band and route-row to reach here.
  const interactive = variant === "live" && !!onToggleRow;
  // The upcoming block, normalised once. Read by the width arrays' neighbour
  // (the divider's colSpan), by the body and by nothing else.
  const upcoming = upcomingRows ?? [];
  // IST, never the host timezone (CORE §3). `en-CA` yields "YYYY-MM-DD".
  const anchorDay =
    anchorIso ?? new Date(nowMs).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  // ⚠ INVOICE SITS IMMEDIATELY AFTER OBD (owner call 2026-08-31, on the live
  // screen). The OBD number and the invoice number are the two REFERENCE
  // NUMBERS the operator scans together — reading one off the board to find
  // the other is the whole job — so they belong side by side rather than at
  // opposite ends of the row.
  //
  // ⚠ THE WIDTHS MAP POSITIONALLY. The colgroup, the header cells and these
  // four arrays are three lists that must agree entry for entry; a header that
  // grows a column the colgroup did not silently shunts every column to its
  // right. Moving a column means moving its <col> width, its <th> and its <td>
  // together, in the same commit.
  //
  // ── RECUT 2026-09-10 (c) — TEN POSITIONS DID NOT FIT ──────────────────────
  //
  // On the live screen Due rendered "Today · 10:…", Status "Needs check 16…"
  // and Article clipped too. Two changes bought the room back, and neither
  // removes a fact from the row:
  //
  //   1. Due drops the word "Today" — see fmtDueDay. 53 of 66 rows on the
  //      board are due today, so ~80% of them were spending 40px on a word
  //      whose absence now says the same thing.
  //   2. Vol and KG STACK into one position. They are two short numbers read
  //      as a pair; side by side they cost two lots of 28px padding and two
  //      column minimums, and the pair is exactly the shape the OBD and
  //      Invoice cells already stack.
  //
  // 🔴 COUNTS, BEFORE → AFTER. Every arm sums to 100 (CLAUDE_UI §27) and the
  // header cells below match entry for entry — count all three lists.
  //
  //   interactive + invoice     10 → 9
  //   interactive + no-invoice   9 → 8
  //   read-only  + invoice       9 → 8
  //   read-only  + no-invoice    8 → 7
  //
  // WHERE THE RECOVERED WIDTH WENT, sized from live content measured
  // 2026-09-10 (ship-to max 33 chars, route max 11 "IGT / CROSS", article tag
  // max 19 chars displayed, litres max "3,507 L", kilos max "4,551 kg"):
  //   Status  10 → 18   the pill "Needs check · 16m" is ~137px WITH padding,
  //                     and the two hover buttons add another 58px
  //   Ship to 20 → 17   it ellipsises by design; a name column always will,
  //                     and the full name is in the detail panel. It gave
  //                     width rather than took it.
  //   Route    8 →  9   ⚠ THE ONE POINT ROUTE TOOK IS FROM SHIP TO, AND THAT
  //                     IS NOT HIDING A PROBLEM. Route content is BOUNDED —
  //                     the longest name in route_master is "IGT / CROSS" at
  //                     11 characters, ~94px with padding — so it can be made
  //                     to fit exactly and then never clips. Ship-to names are
  //                     unbounded (33 characters on today’s board) and will
  //                     ellipsise at ANY width this table can afford, which is
  //                     why the point is worth more there than here.
  //   Article  9 → 12   "168 D · 35 C · 11 T" is ~136px with padding
  //   Due     13 → 12   it needs less now that "Today" is gone
  //   Vol/KG 6+6 → 7    one position instead of two
  //
  // 🔴 THE CELL ORDER, WRITTEN OUT SO IT CAN BE COUNTED BY EYE. Three lists
  // must match this, entry for entry, on every arm — the colgroup below, the
  // <th> row, and the <td>s in renderRow. Two of the nine are conditional and
  // the condition must be the SAME in all three places:
  //
  //   1  ☐        only when `interactive`
  //   2  OBD
  //   3  Invoice  only when `showInvoice`
  //   4  Ship to  NOT on `shipToBlock`
  //   5  SO       (2026-10-06 — the Sales Officer; every arm)
  //   6  Route    (Area on `showArea` / `shipToBlock`)
  //   7  Due
  //   8  Vol / KG
  //   9  Article tag  (SAP's plan — header was "Article" until 2026-10-06)
  //  10  Article      (2026-10-06 — the supervisor's article no.)
  //  11  Status
  //
  // A `{cond && <td>}` that is false renders NOTHING — it does not leave a
  // gap — so one missing cell shifts every column to its right by one and the
  // headers quietly describe the wrong values. That is exactly what happened
  // to Route between e656ad80 and this fix; see the note on its cell.
  //
  //                        ☐  OBD INV Ship SO Rt Due V/KG Tag Art Status
  //
  // ── 2026-10-06 — ARTICLE TAG + ARTICLE (owner) ────────────────────────────
  // The old "Article" column is now headed "Article tag" (content unchanged,
  // formatArticleTag — what SAP says should go out). A NEW narrow "Article"
  // column follows it: pick_assignments.articleCount, the number the
  // supervisor wrote on the drum (Schema v27.58). Every arm gains ONE entry,
  // 6%, taken from the columns with slack in THAT arm — Ship to (it ellipsises
  // by design), the article tag, and a point of Due/Area/OBD where needed.
  // BEFORE → AFTER, each = 100:
  //   ship-to block          [20,14,13,14,10,13,16]        → [18,14,12,13,10,11,6,16]
  //   interactive + extra    [3,13,9,17,9,12,7,12,18]      → [3,13,9,13,9,11,7,11,6,18]
  //   interactive, no extra  [3,14,21,9,12,7,14,20]        → [3,14,17,9,12,7,12,6,20]
  //   read-only + extra      [14,10,19,9,12,7,12,17]       → [14,10,15,9,11,7,11,6,17]
  //   read-only, no extra    [15,23,10,13,8,14,17]         → [15,19,10,13,8,12,6,17]
  // Status keeps its width everywhere — the 2026-09-10 measurement ("Needs
  // check · 16m" + the hover buttons) still binds.
  // ⚠ ONE CONDITION, NOT TWO. Invoice and Operator share the third slot and are
  // mutually exclusive (see `operatorByOrderId`), so the matrix stays at four
  // arms and the colgroup, the <th> row and the <td>s all test THIS.
  // `shipToBlock` always shows Invoice (its own arms below assume it).
  const hasExtra = showInvoice || operatorByOrderId !== undefined || shipToBlock;
  // ── THE SHIP-TO BLOCK ARM (2026-10-06, recut the same day, owner) ─────────
  // NO tick column: a block row is ticked by CLICKING it, and the route's and
  // the block's ticks sit at the OBD column's left edge instead. Ship to is
  // gone (the block header names it); Area is back, in the Route/Area slot.
  // ONE arm, live and History alike — `tickColumn` is false on both.
  //                    OBD INV SO Area Due V/KG Tag Art Status
  const tickColumn = interactive && !shipToBlock;
  const areaCol = showArea || shipToBlock;
  // ── 2026-10-06 — SO (owner) ──────────────────────────────────────────────
  // Whose bill it is, RIGHT AFTER Ship to, in EVERY arm (no new condition).
  // Donor = Ship to (owner). On the ship-to block arm there is no Ship to, so
  // SO sits where it would (after INV) and takes from Area 12→8 and Article
  // tag 11→8. BEFORE → AFTER, each = 100:
  //   ship-to block          [18,14,12,13,10,11,6,16]      → [18,14,7,8,13,10,8,6,16]
  //   interactive + extra    [3,13,9,13,9,11,7,11,6,18]    → [3,13,9,7,6,9,11,7,11,6,18]
  //   interactive, no extra  [3,14,17,9,12,7,12,6,20]      → [3,14,10,7,9,12,7,12,6,20]
  //   read-only + extra      [14,10,15,9,11,7,11,6,17]     → [14,10,8,7,9,11,7,11,6,17]
  //   read-only, no extra    [15,19,10,13,8,12,6,17]       → [15,11,8,10,13,8,12,6,17]
  // ⚠ interactive + extra (the Floor tab's own arm) had the least Ship to to
  // give: 13 → 7 + 6. Eyeball it at depot width before trusting it.
  const widths = shipToBlock
    ? [18, 14, 7, 8, 13, 10, 8, 6, 16] //   OBD INV SO Area Due V/KG Tag Art Status = 100
    : interactive
    ? hasExtra
      ? [3, 13, 9, 7, 6, 9, 11, 7, 11, 6, 18] // ☐ OBD INV Ship SO Rt Due V/KG Tag Art Status = 100
      : [3, 14, 10, 7, 9, 12, 7, 12, 6, 20] //   ☐ OBD Ship SO Rt Due V/KG Tag Art Status = 100
    : hasExtra
      ? [14, 10, 8, 7, 9, 11, 7, 11, 6, 17] //  OBD INV Ship SO Rt Due V/KG Tag Art Status = 100
      : [15, 11, 8, 10, 13, 8, 12, 6, 17]; //    OBD Ship SO Rt Due V/KG Tag Art Status   = 100
  // ⚠ THE HEADER CHECKBOX COVERS BOTH HALVES OF THIS TABLE. Select-all is
  // per-TABLE (lib/floor/selection.ts documents it as per band), and the
  // upcoming rows are in this table — so a select-all that skipped them would
  // read as checked while half the list stayed unticked. The divider is a
  // separator, not a group: it has no checkbox of its own and gains none.
  //
  // 🔴 isAllIdsSelected, NOT isAllSelected (2026-09-10 d). The stage-gated one
  // counted only Waiting and With-picker rows, so on a table of finished bills
  // it reported "all selected" while ticking nothing — the same gate as the
  // per-row `selectable` below, in a second place, which is exactly where a
  // half-done fix of this leaves a header checkbox that lies.
  const tableRows = upcoming.length > 0 ? [...rows, ...upcoming] : rows;
  const allOn = interactive && selection ? isAllDeskSelected(selection, tableRows) : false;

  // ── INVOICE PAIRS (2026-10-08, owner) ─────────────────────────────────────
  // Worked out PER LIST: the due rows and the upcoming rows separately, so a
  // pair is never merged across the divider (a member on the other side reads
  // as split). `pairLive` false (History / upcoming variants) = "k of n" and
  // the merge only — no place chips, no amber.
  //
  // 🔴 A MERGED BLOCK'S ROWS 2..n DRAW FEWER CELLS, AND THAT IS THE LANDMINE
  // ABOVE `widths`, SPENT ON PURPOSE. Row 1 carries the ☐ (when `tickColumn`)
  // and the Invoice cell (when `invCell`) with rowSpan = n; the rows under it
  // leave out EXACTLY those two, so every column to their right still lines up.
  // Per arm, row 1 → rows 2..n:
  //   ship-to block         9 → 8   (Invoice merged; the row is its own tick)
  //   interactive + extra  11 → 9   (☐ and Invoice merged)
  //     … Tinting/Operator 11 → 10  (☐ only — the operator is per bill)
  //   interactive, no extra 10 → 9  (☐ only)
  //   read-only + extra    10 → 9   (Invoice only — History, load-plan panels)
  //   read-only, no extra   9 → 9   (nothing merged; chips only)
  const pairRows = useFloorPairRows();
  const pairLive = variant === "live";
  const pairsDue = buildPairRenders(rows, pairLive, pairRows);
  const pairsUp = buildPairRenders(upcoming, pairLive, pairRows);
  // The Invoice cell is drawn (the third slot is Invoice, not Operator).
  const invCell = hasExtra && !operatorByOrderId;

  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        {widths.map((w, i) => (
          <col key={i} style={{ width: `${w}%` }} />
        ))}
      </colgroup>
      {part !== "body" && (
      <thead>
        <tr>
          {tickColumn && (
            <th className={HEAD_TH_NARROW}>
              {!selectionLocked && (
              <input
                type="checkbox"
                aria-label="Select all rows in this group"
                className="h-[13px] w-[13px] cursor-pointer align-middle accent-brand-600"
                checked={allOn}
                onChange={() => onToggleAll?.(tableRows)}
              />
              )}
            </th>
          )}
          {shipToBlock ? (
            // The ROUTE tick, at the OBD column's left edge — the same 14px
            // the block headers' ticks sit at (ship-to-blocks.tsx).
            <th className={HEAD_TH}>
              {interactive && !selectionLocked && (
                <input
                  type="checkbox"
                  aria-label="Select every due bill on this route"
                  className="mr-2 h-[13px] w-[13px] cursor-pointer align-middle accent-brand-600"
                  checked={allOn}
                  onChange={() => onToggleAll?.(tableRows)}
                />
              )}
              OBD
            </th>
          ) : (
            <th className={HEAD_TH}>OBD</th>
          )}
          {hasExtra && <th className={HEAD_TH}>{operatorByOrderId ? "Operator" : "Invoice"}</th>}
          {/* Ship to: gone on the block table (`shipToBlock`) — the SAME flag
              `widths` tests above and the <td>s test below. The Route/Area
              slot stays and reads Area there (`areaCol`). */}
          {!shipToBlock && <th className={HEAD_TH}>Ship to</th>}
          {/* SO (2026-10-06) — every arm, unconditional; on the block arm it
              lands right after INV, where Ship to would sit. */}
          <th className={HEAD_TH}>SO</th>
          <th className={HEAD_TH}>{areaCol ? "Area" : "Route"}</th>
          <th className={HEAD_TH}>Due</th>
          <th className={`${HEAD_TH} text-right`}>Vol / KG</th>
          <th className={HEAD_TH}>Article tag</th>
          {/* 2026-10-06 — the supervisor's article no. In EVERY arm, Tinting's
              Operator arm included (its bills are never checked, so the cells
              are empty there): one column set, no new width arm. */}
          <th className={`${HEAD_TH} text-right`}>Article</th>
          <th className={HEAD_TH}>Status</th>
        </tr>
      </thead>
      )}
      {part !== "head" && (
      <>
        {/* ONE <tbody> PER RUN (2026-10-08): plain rows share one; a merged
            invoice pair gets its own, so hovering any of its rows shades the
            whole block (a rowspan'd cell belongs to row 1 only — a per-<tr>
            hover would leave it white under row 2). See renderList. */}
        {renderList(rows, pairsDue, "d")}
        {upcoming.length > 0 && (
          <>
          <tbody>
            {/* ── THE UPCOMING DIVIDER ────────────────────────────────────
                🔴 A ROW INSIDE THIS TABLE, SPANNING EVERY COLUMN. The table is
                `table-fixed` with a colgroup of percentages (CLAUDE_UI §27), so
                a divider drawn any other way — a second table, a div between
                two tables, a cell in one column — would either break the column
                alignment or need its own widths to keep. `colSpan` reads
                `widths.length`, the SAME array the colgroup maps, so the two
                cannot drift: change an arm and the span changes with it.

                It carries its own totals because "how much is already promised
                for later in the week" is the question the block exists to
                answer, and counting the rows by eye is not an answer. */}
            <tr>
              <td
                colSpan={widths.length}
                className="border-y border-gray-200 bg-[#fbfaff] px-3.5 py-[7px]"
              >
                <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-brand-700">
                  Upcoming — promised for later dates
                </span>
                <span className="ml-2.5 text-[11px] tabular-nums text-gray-500">
                  {upcoming.length} bill{upcoming.length === 1 ? "" : "s"} ·{" "}
                  {formatLitres(sumLitres(upcoming))} L
                  {(() => {
                    const w = sumWeightKg(upcoming);
                    const str = formatWeightKg(w.kg);
                    if (str === null) return null;
                    return (
                      <> · {str}{w.unknown > 0 ? "+" : ""} kg</>
                    );
                  })()}
                </span>
              </td>
            </tr>
          </tbody>
          {renderList(upcoming, pairsUp, "u")}
          </>
        )}
      </>
      )}
    </table>
  );

  /**
   * One list's rows as <tbody> runs: consecutive plain (and split-pair) rows
   * share a tbody; each MERGED invoice block gets its own, with the hover on the
   * tbody. Nothing is merged across lists — the caller calls this once per list.
   */
  function renderList(list: FloorBoardRow[], pairs: Map<number, PairRender>, keyBase: string): ReactNode[] {
    const out: ReactNode[] = [];
    let plain: ReactNode[] = [];
    const flush = () => {
      if (plain.length === 0) return;
      out.push(<tbody key={`${keyBase}-${out.length}`}>{plain}</tbody>);
      plain = [];
    };
    let i = 0;
    while (i < list.length) {
      const p = pairs.get(list[i].orderId);
      if (p?.together) {
        flush();
        const block = list.slice(i, i + p.size);
        out.push(
          <tbody key={`${keyBase}-inv-${list[i].invoiceNo}`} className="hover:bg-[#fafafa]">
            {block.map((r) => renderRow(r, pairs.get(r.orderId) ?? null))}
          </tbody>,
        );
        i += p.size;
      } else {
        plain.push(renderRow(list[i], p ?? null));
        i++;
      }
    }
    flush();
    return out;
  }

  /**
   * ONE row renderer, called for the due rows and again for the upcoming ones.
   *
   * ⚠ AN UPCOMING ROW IS RENDERED IDENTICALLY. No greying, no lock, no removed
   * checkbox — the only difference is the divider above it and the blue date its
   * own Due cell computes. Branching here is what the retired upcoming-strip did
   * and it is what made a Saturday bill impossible to put on Thursday's trip.
   *
   * Declared AFTER the return deliberately: a function declaration is hoisted,
   * so this reads top-down as "the table, then the row" rather than burying the
   * 200-line row body between the colgroup and the tbody.
   */
  function renderRow(row: FloorBoardRow, pair: PairRender | null) {
    const st = rowStatus(row);
    // INVOICE PAIR (2026-10-08) — see renderList / pair-cells.tsx. `spanned` =
    // a merged block's rows 2..n: the ☐ and Invoice cells above already cover
    // them, so this row leaves both out (the per-arm counts above `pairRows`).
    const merged = pair?.together === true;
    const spanned = merged && !pair.first;
    // 🔴 EVERY ROW IN AN INTERACTIVE TABLE IS SELECTABLE (2026-09-10 d).
    //
    // This read `st === "waiting" || st === "withPicker"` and was THE reason a
    // Done bill could not be put on a trip: no checkbox rendered on it at all.
    // The rule dates from when a tick meant "hand this to a picker", where a
    // finished bill is genuinely not a candidate. A tick means "put this on a
    // trip" now, trip membership was never stage-gated (schema decision record
    // §2), and a checked bill is the most loadable thing on the board.
    //
    // ⚠ `interactive` STILL GATES THE COLUMN. History and the read-only lists
    // render no checkbox column at all, which is a different question and is
    // unchanged — see `widths`. This only decides whether the input renders
    // INSIDE a column that already exists, so no cell count moves.
    // `selectionLocked` (2026-09-18) is the one exception — see the prop.
    const selectable = !selectionLocked;
    // 🔴 A RE-DELIVERY ROW (2026-10-03) is ticked by `rd:<id>`, never by
    // row.orderId — that id belongs to the bill's FIRST trip (deskKeyOf).
    const rd = row.redelivery ?? null;
    const selKey = deskKeyOf(row);
    const { isSite, isRedirect } = shipInfo(row);
    const billedTo = shipToBlock && billedToFor ? billedToFor(row) : null;
    // THE TRIP TAG (2026-09-09), built once: beside the number on every row,
    // or on the date line of an ORB row (2026-10-07, M2) — see the OBD cell.
    const tripTag = row.tripNumber ? (
      <span
        // Just the number (slice 6). This appended the RAW stored status —
        // "· draft", "· released" — the one place the column's own word
        // reached the floor. Those words are off the screen now.
        title={`On trip ${row.tripNumber}`}
        className={`${row.isChallanOrder ? "" : "ml-1.5 "}rounded-[3px] bg-gray-900 px-[5px] py-px align-[1px] font-mono text-[9.5px] font-semibold text-white`}
      >
        {shortTripNumber(row.tripNumber)}
      </span>
    ) : null;
    const obd = asStr(row.obdDateTime);
    const target = row.dispatchTargetDate;
    // ── Duplicate-SO, SOFT variant (2026-08-25) ─────────────────────────
    // Applies on every variant (live / history / upcoming) — a twin is a
    // twin whichever view you found it in. Ground + hover come from
    // CLASSES, never an inline background: an inline style would beat the
    // `hover:` rule and silently kill the row hover this board relies on.
    //
    // ⚠ NOTHING ELSE ON THE ROW BRANCHES ON `dup` ANY MORE. Cells, chips,
    // the age badge, the ⚡, the site/tint glyphs and the StatusPill all
    // render exactly as they do on an ordinary row — that is the whole
    // difference between this and the solid treatment, which had to flip
    // every one of them to white so they would not vanish into the fill.
    // The signal is carried by the ground and the 3px bar alone.
    const dup = row.hasDuplicateSo;
    const chipCls =
      "rounded-[4px] bg-[#f3f4f6] px-2 py-[2px] text-[10px] font-semibold text-[#6b7280]";
    // The 4px red-500 left bar, as an inset shadow (never border-left —
    // this table is table-layout:fixed with colgroup percentages, UI §27,
    // and the first column's pl-[10px] pr-[4px] would be eaten by a real
    // border). It rides whichever cell is FIRST, and that changes with
    // `interactive`: the checkbox cell when the table is selectable, the
    // OBD cell when it is not (history / upcoming / the read-only
    // "what he's holding" list).
    //
    // ── THE PAIR BAR (2026-10-08) — 3px violet (all members past the tint
    // room) or amber (one still tinting / a member elsewhere), on the same
    // first-cell edge. Both bars are inline shadows, so they COMPOSE: pair bar
    // outermost, the duplicate-SO red beside it. On a merged block with a tick
    // column the pair bar rides the rowspan'd ☐ (one bar down the whole block)
    // and the red moves to each row's OBD cell.
    const pairShadow = pairBarShadow(pair?.bar ?? null);
    const dupShadow = dup ? DUP_SO_SOFT_BAR : null;
    const bothShadow =
      pairShadow && dupShadow ? `${pairShadow}, inset 7px 0 0 ${DUP_SO_SOFT_ACCENT}` : pairShadow ?? dupShadow;
    const tickShadow = merged ? pairShadow : bothShadow;
    const asStyle = (s: string | null) => (s ? { boxShadow: s } : undefined);

    // ── THE DUE CELL ─────────────────────────────────────────────────
    //
    // 🔴 THE BILL'S OWN `dispatchTargetDate` AND `windowTime`, NEVER THE
    // TRIP'S `tripDate`. A trip's bills genuinely carry different dates:
    // no trip action writes a bill's slot (slice 3, 2026-09-14 — the trip
    // release route that once could was deleted), so a bill keeps the slot
    // somebody already promised whatever trip it rides. Reading the trip
    // here would show the operator a date the bill does not have.
    // Recorded in code-discovery-2026-09-10-dates-weight-orphans.md §A5.2.
    //
    // 🔴 A BARE TIME MEANS THE ANCHOR DAY AND NOTHING ELSE. The day is
    // printed the moment it is not the anchor day, so the absence of a
    // day IS the statement. This is not the FLOOR §10 landmine, where the
    // date appeared nowhere on the screen at all — read fmtDueDay's header
    // before changing it back.
    //
    // Four states, decided by the row's own `zone` and `ageDays` — both
    // computed server-side by the ONE expression lib/picking/queue.ts:763
    // and lib/floor/queries.ts:793 share, so this cell cannot disagree
    // with the partition that put the row above or below the divider.
    const dueCell = (() => {
      // (1) No date at all. The engine could not schedule it; putting it
      // on a trip is what gives it one. Quiet violet, not a warning — this
      // is the ordinary state of a bill in the pool, not a fault.
      if (!target) {
        return (
          <span
            title="No dispatch slot — putting this bill on a trip gives it one"
            className="rounded-[3px] border border-[#e2d7fb] bg-[#f2ecfd] px-[5px] py-px text-[9px] font-bold uppercase tracking-[0.05em] text-[#6d28d9]"
          >
            no slot
          </span>
        );
      }
      const overdue = (row.ageDays ?? 0) > 0;
      const future = row.zone === "upcoming";
      const dayCls = overdue
        ? "font-semibold text-[#b42318]"
        : future
          ? "font-semibold text-[#2563eb]"
          : "font-semibold text-gray-900";
      // null on the anchor day — see fmtDueDay. The three cases below are
      // exhaustive over (day present?) × (window present?), and the
      // (2) case is the ~80% one.
      const dayLabel = fmtDueDay(target, anchorDay);
      const ageChip = overdue ? (
        // THE EXISTING AGE CHIP, MOVED — not a second one. It was in the
        // OBD cell until 2026-09-10 (b). Red here, where it used to be
        // grey: it sits beside a red date now, and one signal in two
        // colours reads as two different facts.
        <span
          title={`${row.ageDays} day${row.ageDays === 1 ? "" : "s"} past its dispatch date`}
          className="ml-1.5 rounded-[3px] bg-[#fdecea] px-[5px] py-px font-mono text-[9.5px] font-bold text-[#b42318]"
        >
          {row.ageDays}d
        </span>
      ) : null;

      // (2) The anchor day. Bare time, in the plain colour — an anchor-day
      // row is neither future nor overdue, so `dayCls` is the plain arm by
      // construction and the time carries it alone.
      if (dayLabel === null) {
        return (
          <>
            {/* A date with no window is representable in the schema and was
                0 rows of 66 on 2026-09-10. It says the day rather than
                rendering an empty cell. */}
            <span className={dayCls}>{row.windowTime ?? "Today"}</span>
            {ageChip}
          </>
        );
      }
      // (3) and (4) — any other day, with or without a window.
      return (
        <>
          <span className={dayCls}>{dayLabel}</span>
          {row.windowTime && <span className="text-gray-500"> · {row.windowTime}</span>}
          {ageChip}
        </>
      );
    })();

    // Null when the weight is unknown — see the KG cell and formatWeightKg.
    const weightStr = formatWeightKg(row.weightKg);

    let statusCell: ReactNode;
    if (variant === "upcoming") {
      statusCell = <span className={"inline-flex items-center " + chipCls}>for {fmtDay(target)}</span>;
    } else if (variant === "history") {
      // The day's outcome, plus a ⋯ that opens the READ-ONLY detail panel
      // (2026-08-25). Before this, `onOpenDetail` was passed to this table
      // on every variant (floor-board's selProps) and simply had no
      // trigger here — the prop was wired and unreachable, so a past bill
      // could not be opened at all and its SKU lines and Activity log were
      // on no screen.
      //
      // ⚠ ⋯ ONLY — deliberately NOT the ⚡ the live arm carries. ⚡ is
      // `onMarkUrgent`, a WRITE (/api/floor/actions mark-urgent), and
      // prioritising a bill on a day that has already shipped is
      // meaningless. The panel it opens is view-only: floor-page passes
      // source "history", which suppresses every action (detail-panel's
      // `readOnly`).
      // 🔴 THIS BRANCH ASKS rowStatus() LIKE EVERY OTHER STATUS SURFACE DOES,
      // AND IT MUST KEEP DOING SO (fixed 2026-09-11).
      //
      // It used to test `row.isChecked` and pass the STRING LITERAL
      // `status="done"` — the only hardcoded StatusPill status anywhere in the
      // repo. That bypassed status-pill.tsx's rowStatus(), which is the one
      // owner of "what state is this row in", so this cell could not learn about
      // a stage the owner already knew about.
      //
      // What that cost: when `dispatched` was added on 2026-09-11 and
      // getFloorBoard started reporting `isChecked: true` for a shipped bill
      // (correctly — it was checked on its way out), all 137 rows on 2026-08-10
      // fell into this branch and rendered a confident green **Done** on bills
      // that had left the depot. The By-route bar beside them said "65 of 65
      // done" in slate, because THAT path went through rowStatus. Two surfaces,
      // one day, two different answers.
      //
      // ⚠ DO NOT PUT `row.isChecked` BACK IN THIS TEST. It is not a tidier way
      // to ask the same question: `isChecked` is TRUE for a dispatched bill, so
      // testing it here silently re-folds two distinct states into one pill and
      // reintroduces exactly this bug. Ask `st`.
      let histBody: ReactNode;
      if (st === "done" || st === "direct" || st === "dispatched") {
        // A Direct Loaded bill finished at directLoadedAt — it has no checkedAt.
        const cAt = asStr(row.checkedAt ?? row.directLoadedAt);
        const lateDays = cAt && target ? diffDays(target, istDay(cAt)) : 0;
        const timeStr = lateDays > 0 ? fmtDateTime(cAt) : hhmm(cAt);
        histBody = (
          <span className="inline-flex items-center gap-1.5">
            {/* `st`, never a literal. It carries "done" or "dispatched" and the
                pill's own META owns both labels and both colours. */}
            <StatusPill status={st} time={timeStr} />
            {lateDays > 0 && (
              <span
                className={
                  "rounded-[3px] px-[5px] py-px text-[9.5px] font-bold " +
                  "bg-[#f3f4f6] text-[#6b7280]"
                }
              >
                {lateDays}d late
              </span>
            )}
          </span>
        );
      } else {
        // ⚠ "Not completed" IS STILL TRUE HERE, and the reason is worth stating
        // because the obvious reading is that this branch is now stale.
        //
        // The `if` above catches every FINISHED state — checked, and shipped.
        // What reaches this `else` is only `waiting`, `withPicker` and
        // `needsCheck`: a bill that was on the board that day and had not been
        // signed off by the end of it. That is precisely "not completed", and it
        // stays precisely that however many terminal stages the ladder grows,
        // BECAUSE the test above asks rowStatus() rather than naming stages.
        //
        // A new terminal stage therefore needs one edit — adding it to the `if`
        // — and this line needs none. Had the `if` kept testing `isChecked`,
        // every future terminal stage would have silently landed here and been
        // labelled "Not completed" on work that was finished.
        histBody = <span className={"inline-flex items-center " + chipCls}>Not completed</span>;
      }
      statusCell = (
        <span className="inline-flex items-center gap-2">
          {histBody}
          <span className="hidden items-center gap-1 group-hover:inline-flex" onClick={shipToBlock ? (e) => e.stopPropagation() : undefined}>
            <button
              type="button"
              title={rd ? "Re-delivery details" : "Open details"}
              onClick={() => (rd ? onOpenRedelivery?.(rd.id) : onOpenDetail?.(row.orderId))}
              className="inline-flex h-[23px] w-[23px] items-center justify-center rounded-[5px] border border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:text-gray-600"
            >
              <MoreHorizontal size={12} />
            </button>
          </span>
        </span>
      );
    } else {
      // live
      const urgent = row.priorityLevel === 1;
      statusCell = (
        <span className="inline-flex items-center gap-2">
          {/* The pill carries the handover fact — NO NEW COLUMN. The rule
              is isHeldBack()'s (status-pill.tsx); only the gate state is
              this table's business. With the gate off this is
              heldBack={false} on every row, so the cell renders exactly
              the pill it has always rendered. */}
          <StatusPill
            status={st}
            time={liveTime(row, nowMs)}
            heldBack={gateOn && isHeldBack(row)}
          />
          {/* Row hover actions (design §7.10). ⚡ is LIVE (instant urgent
              toggle, lights red when urgent); ⋯ is INERT (detail panel is
              a later step). */}
          {rd ? (
            // A RE-DELIVERY row: no ⚡ (it would write the real bill) and no
            // detail panel (its actions write the real bill too). ⋯ opens the
            // read-only re-delivery info instead.
            <span className="hidden items-center gap-1 group-hover:inline-flex" onClick={shipToBlock ? (e) => e.stopPropagation() : undefined}>
              <button
                type="button"
                title="Re-delivery details"
                onClick={() => onOpenRedelivery?.(rd.id)}
                className="inline-flex h-[23px] w-[23px] items-center justify-center rounded-[5px] border border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:text-gray-600"
              >
                <MoreHorizontal size={12} />
              </button>
            </span>
          ) : (
          <span className="hidden items-center gap-1 group-hover:inline-flex" onClick={shipToBlock ? (e) => e.stopPropagation() : undefined}>
            <button
              type="button"
              title={urgent ? "Clear urgent" : "Mark urgent"}
              onClick={() => onMarkUrgent?.(row.orderId)}
              className={`inline-flex h-[23px] w-[23px] items-center justify-center rounded-[5px] border ${
                urgent ? "border-red-200 bg-red-50 text-red-500" : "border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:text-gray-600"
              }`}
            >
              <Zap size={12} />
            </button>
            <button
              type="button"
              title="Open details"
              onClick={() => onOpenDetail?.(row.orderId)}
              className="inline-flex h-[23px] w-[23px] items-center justify-center rounded-[5px] border border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:text-gray-600"
            >
              <MoreHorizontal size={12} />
            </button>
          </span>
          )}
        </span>
      );
    }

    // 🔴 NO ROW WASH ON A DUPLICATE-SO ROW SINCE 2026-09-13 — the bar and the
    // SAME tag carry it, and the row hovers like every other. A wash and a
    // status pill are two jobs fighting over one channel: every colour on this
    // row is already a status (amber Needs check, blue With picker, green Done,
    // slate Dispatched, pink Tinting), so a coloured ground is a second colour
    // system competing on the same pixels. Pale pink "Tint pending" on the pale
    // red wash is the pair that actually blurred, but re-hueing the wash only
    // moves the collision to whichever status owns the new hue — there is no
    // free colour left. Full reasoning on DUP_SO_SOFT_ROW_CLASS
    // (components/shared/duplicate-so-tag.tsx), which this file no longer
    // imports. The bar went 3px → 4px in the same change to carry the load.
    // ── THE BLOCK ROW IS ITS OWN TICK (2026-10-06, owner) ────────────────────
    // No checkbox column on `shipToBlock`: a click anywhere on the row (or
    // Space / Enter while it has focus) toggles the SAME key the checkbox did
    // (deskKeyOf → onToggleRow / onToggleRedelivery). The OBD number, the tags
    // and the Status hover buttons stop the click, so they never toggle. A
    // selected row wears Tint Manager's selected look (board-base-tab.tsx):
    // brand-50 ground + a 3px brand bar on the first cell — which replaces the
    // duplicate-SO bar while selected (the SAME tag still says it). History and
    // a locked selection: no toggle at all.
    const toggleThis = () => (rd ? onToggleRedelivery?.(rd.id) : onToggleRow?.(row.orderId));
    const blockClickable = shipToBlock && interactive && selectable;
    const blockSelected = blockClickable && (selection?.has(selKey) ?? false);
    const blockRowProps = blockClickable
      ? {
          tabIndex: 0,
          "aria-selected": blockSelected,
          onClick: toggleThis,
          onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              toggleThis();
            }
          },
        }
      : {};
    // A merged pair's rows take their hover from their own <tbody> (renderList).
    const hoverCls = merged ? "" : " hover:bg-[#fafafa]";
    const rowCls = !shipToBlock
      ? `group${hoverCls}`
      : blockSelected
        ? "group cursor-pointer bg-brand-50 outline-none focus-visible:bg-brand-100 [&>td:first-child]:shadow-[inset_3px_0_0_theme(colors.brand.600)]"
        : blockClickable
          ? `group cursor-pointer outline-none${hoverCls} focus-visible:bg-brand-50`
          : `group${hoverCls}`;
    const stop = (e: React.MouseEvent) => e.stopPropagation();
    return (
      <tr key={String(selKey)} className={`${rowCls} ${SEARCH_HIT_ROW_CLS}`} data-order-id={row.orderId} {...blockRowProps}>
        {tickColumn && !spanned && (
          /* FIRST CELL when the table is selectable — it carries the bar. On a
             merged invoice block it spans every row of the block. */
          <td className={TD_NARROW} style={asStyle(tickShadow)} rowSpan={merged ? pair.size : undefined}>
            {/* Checkbox on Waiting / With-picker rows only (design §7.8).
                accent-brand-600 stays: it now sits on a pale wash rather
                than a red fill, and reads the same on every row either
                way. */}
            {selectable && merged ? (
              // ONE TICK FOR THE INVOICE. Reads checked when EVERY member is
              // selected. ⚠ THIS COMMIT toggles the FIRST member only (the
              // existing per-bill toggle); the next commit (5) makes it toggle
              // every member together.
              <input
                type="checkbox"
                aria-label={`Select invoice ${row.invoiceNo ?? ""}`}
                className="h-[13px] w-[13px] cursor-pointer align-middle accent-brand-600"
                checked={pair.memberIds.every((id) => selection?.has(id) ?? false)}
                onChange={() => onToggleRow?.(pair.memberIds[0])}
              />
            ) : selectable && (
              <input
                type="checkbox"
                aria-label={`Select ${row.obdNumber}`}
                className="h-[13px] w-[13px] cursor-pointer align-middle accent-brand-600"
                checked={selection?.has(selKey) ?? false}
                onChange={() => (rd ? onToggleRedelivery?.(rd.id) : onToggleRow?.(row.orderId))}
              />
            )}
          </td>
        )}
        {/* On a NON-interactive table (history / upcoming / the read-only
            "what he's holding" list) the two narrow columns are not
            rendered, so THIS is the first cell and the bar lands here
            instead. `interactive` is the same flag that drives `widths`
            above, so the two can never disagree about which cell is first. */}
        <td
          className={TD}
          style={asStyle(blockSelected ? null : tickColumn ? (merged ? dupShadow : null) : bothShadow)}
        >
          {shipToBlock ? (
            // The DETAIL PANEL opens from the number on the block table (the
            // row click selects). Same handlers as the ⋯ button; never toggles.
            <button
              type="button"
              title={rd ? "Re-delivery details" : "Open details"}
              onClick={(e) => {
                e.stopPropagation();
                if (rd) onOpenRedelivery?.(rd.id);
                else onOpenDetail?.(row.orderId);
              }}
              className="cursor-pointer font-mono text-[11.5px] font-medium text-[#111827] hover:underline"
            >
              {row.obdNumber}
            </button>
          ) : (
          <span className="font-mono text-[11.5px] font-medium text-[#111827]">
            {row.obdNumber}
          </span>
          )}
          {/* INVOICE PAIR (2026-10-08) — "k of n", right after the number,
              every arm. Its place chip goes in the Invoice cell, or on the
              date line below where there is no Invoice cell. */}
          {pair && <KOfNChip k={pair.k} n={pair.n} invoiceNo={row.invoiceNo} />}
          {/* SHIP-TO BLOCK (2026-10-06): the TINT / BASE word moves here from the
              Ship-to cell, right after the number (the mockup's place), as a
              SQUARE tag (BlockTag below). Same `colourWork` rule as
              ColourWorkBadge, which stays Picking's pill. Never on any other table. */}
          {/* All the block row's per-bill tags, in ONE fixed order (owner,
              2026-10-06): URGENT · TINT/BASE · GIFT · HAND · SAME. URGENT
              replaces the ⚡ glyph on this table only. */}
          {shipToBlock && <span onClick={stop}>{blockTags(row, dup)}</span>}
          {/* The tag rides the OBD cell — first column a reader lands on,
              and it never displaces the Status column's own meaning.
              (The block table draws its own square SAME tag above.) */}
          {dup && !shipToBlock && <DuplicateSoTag variant="soft" className="ml-1.5 align-[1px]" />}
          {/* RE-DEL (2026-10-03) — a bill that came back on an earlier truck,
              planned again on this trip. The trip-number chip's shape, in the
              `warn` token (CLAUDE_UI §2.1 — never red, never a data.* colour).
              A button: it opens the read-only re-delivery info. */}
          {rd && (
            <button
              type="button"
              onClick={() => onOpenRedelivery?.(rd.id)}
              title={`Re-delivery · attempt ${rd.attemptNo} — click for its history`}
              className="ml-1.5 rounded-[3px] border border-warn/40 bg-warn-bg px-[5px] py-px align-[1px] font-mono text-[9.5px] font-semibold text-warn-text hover:border-warn"
            >
              RE-DEL
            </button>
          )}
          {/* THE TRIP TAG (2026-09-09) — INSIDE the OBD cell, never a new
              column. This table's colgroup, header cells and FOUR width
              arrays map POSITIONALLY, so a tenth column shunts every
              column right on two of the four arms; the visibility-gate
              build made the same call and put its new fact on the status
              pill for the same reason.

              It rides the OBD cell because that is where the row's other
              identifiers already live — the duplicate-SO tag and the age
              chip are its neighbours — and because a trip number IS a
              reference number, like the OBD beside it.

              Renders NOTHING when the bill is on no trip, which is most of
              the board: no empty space, no dash, no placeholder. */}
          {/* Never on a RE-DEL row: its tripNumber is the bill's FIRST trip.
              ⚠ NOR BESIDE AN ORB NUMBER (2026-10-07, Challan orders M2): the
              14-character ORB-2026-NNNNN fills the OBD track, so on an ORB row
              the tag rides the date line below instead (ObdDateLine `trailing`).
              The width arrays are untouched. */}
          {row.tripNumber && !hideTripTag && !rd && !row.isChallanOrder && tripTag}
          {/* ⚠ THE `no slot` CHIP AND THE AGE CHIP LEFT THIS CELL on
              2026-09-10 (b). Both are statements about WHEN the bill is
              due, and there is a Due column now — so they moved into it,
              where the date they qualify is sitting. Leaving either here
              would have printed it twice on the same row.

              What stays: the OBD number, the duplicate-SO tag and the trip
              tag. Those are identifiers, which is what this cell is for. */}
          <ObdDateLine
            iso={obd}
            isEmailTime={row.isEmailTime}
            trailing={
              <>
                {row.tripNumber && !hideTripTag && !rd && row.isChallanOrder ? tripTag : null}
                {/* No Invoice cell on this arm (Tinting's Operator slot, or a
                    read-only table without the column) → a SPLIT row's chip
                    rides here, e.g. "1 on Floor". A merged block's "N at tint"
                    is not repeated per row here — its amber bar says it. */}
                {!invCell && !merged && pair?.chip && <PairPlaceChip chip={pair.chip} />}
              </>
            }
          />
          {/* Per-row "billed to" — only when the block's bills disagree (the
              header says it once otherwise). See `billedToFor`. */}
          {shipToBlock && billedTo !== null && (
            <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] text-[#9ca3af]" title={`Billed to ${billedTo}`}>
              billed to {billedTo}
            </div>
          )}
        </td>
        {/* INVOICE — SAP's own invoiceNo + invoiceDate, shaped like the
            OBD cell it now sits beside: mono number on line 1, muted 10px
            date underneath. Adjacent to OBD on purpose (owner call
            2026-08-31) — these are the two reference numbers the operator
            scans together, so reading one to find the other is one glance
            rather than a trip across the row.

            ⚠ EMPTY WHEN EMPTY. No em dash, no "pending", no placeholder —
            unlike Route / Picker / Article below, which all print "—" for
            a value that SHOULD be there and is not. A missing invoice is
            not a gap in the data: SAP stamps invoices in its own
            sub-hourly batches, so a bill still being picked simply has
            none yet (0 of the 4 open rows on 2026-08-31 carried one). A
            dash would read as "we looked and found nothing", which is a
            different and wrong claim — and it would put a mark on nearly
            every row of a busy morning's board.

            The two lines are independent rather than sharing one guard:
            patch-headers fills invoiceNo and invoiceDate with separate
            fill-if-null tests (app/api/import/obd/route.ts), so one can
            in principle arrive without the other, and each line should
            tell the truth about its own field.

            ⚠ NOT THE FIRST CELL, even on a read-only table — the OBD cell
            above still is, so the duplicate-SO bar (`barStyle`) stays put
            and must NOT be moved here.

            formatDateIST is the SHARED formatter the detail panel's
            "Invoice date" reads — never a second local one. */}
        {/* ⚠ `shipToBlock` drops the SHIP TO cell below (and the ☐ cell above,
            via `tickColumn`), and the Route cell reads Area — the same flags
            the colgroup and the <th> row test (count: OBD INV SO Area Due V/KG
            Tag Art Status = 9 on that arm). */}
        {/* THE SHARED THIRD SLOT — Invoice, or Operator on the Tinting tab. One
            condition, `hasExtra`, matching the colgroup and the <th> above; see
            `operatorByOrderId` for why they share rather than sit side by side. */}
        {hasExtra &&
          (operatorByOrderId ? (
            <td className={TD}>
              {/* A DASH, NEVER A BLANK. A bill at pending_tint_assignment has no
                  assignment row at all, and an empty cell reads as "unknown"
                  rather than "nobody has it yet". */}
              {operatorByOrderId.get(row.orderId) ? (
                <span className="text-[11.5px] font-medium text-[#111827]">
                  {operatorByOrderId.get(row.orderId)}
                </span>
              ) : (
                <span className="text-[11.5px] text-[#d1d5db]">—</span>
              )}
            </td>
          ) : spanned ? null : (
            // ONE Invoice cell for a merged pair (rowSpan = n, centred), and the
            // pair chip under it: "1 at tint" on a block, or the missing
            // member(s) on a split row — "2 on hold", "2 at tint"…
            <td className={`${TD} align-middle`} rowSpan={merged ? pair.size : undefined}>
              <InvoiceLines invoiceNo={row.invoiceNo} invoiceDate={row.invoiceDate} />
              {pair?.chip && (
                <div className="mt-0.5 overflow-hidden text-ellipsis">
                  <PairPlaceChip chip={pair.chip} />
                </div>
              )}
            </td>
          ))}
        {!shipToBlock && (
        <td className={TD}>
          {/* CHALLAN (2026-10-07, Challan orders M2) — BEFORE the dealer name, in
              the cell where TINT / BASE / GIFT / HAND already sit; no new column. */}
          {row.isChallanOrder && (
            <span className="mr-1.5 inline-block align-[-1px]">
              <ChallanBadge />
            </span>
          )}
          <span className="text-[11.5px] font-medium text-[#111827]">
            {row.dealerName}
          </span>
          {/* ★ amber and ⚡ red now render exactly as on an ordinary row — the
              soft variant has no fill to eat them, which is why the ⚡ can
              still carry Urgent on a Same-SO row (see the colour ruling in
              duplicate-so-tag.tsx). */}
          {row.isKeyCustomer && (
            <span className="ml-1.5" style={{ color: "#f59e0b" }}>
              ★
            </span>
          )}
          {row.priorityLevel === 1 && (
            <span className="ml-1" style={{ color: "#ef4444" }}>
              ⚡
            </span>
          )}
          {isSite && (
            <Building2
              size={12}
              className="ml-1 inline-block align-[-1px]"
              style={{ color: "#475569" }}
            />
          )}
          {/* TINT / BASE — the word, in place of a 🖜 droplet that keyed on
              `orderType` and so called a bill closed as "Base — No Tint"
              tinted. `ml-1` is the droplet's own spacing, kept. Renders null
              outside the two project divisions, exactly as the droplet rendered
              nothing on a plain bill. */}
          {row.colourWork !== null && (
            <span className="ml-1 inline-block align-[-1px]">
              <ColourWorkBadge work={row.colourWork} />
            </span>
          )}
          {/* GIFT — SAP material type GIFTS. After TINT/BASE, same spacing.
              Its L/kg are left out of every total (lib/orders/gift.ts), and
              the VOL / KG cell greys them to match. */}
          {row.isGift && (
            <span className="ml-1 inline-block align-[-1px]">
              <GiftBadge />
            </span>
          )}
          {/* HAND — the dealer collects (2026-09-24). After TINT/BASE and GIFT,
              same spacing; no new column. */}
          {row.isHand && (
            <span className="ml-1 inline-block align-[-1px]">
              <HandBadge />
            </span>
          )}
          {isSite && (
            <div className="text-[10.5px] text-[#9ca3af]">
              billed to {row.billToName ?? "—"}
            </div>
          )}
          {/* Ship-to redirect — the ORIGINAL → REDIRECT pair, worded and
              emphasised like rail-card.tsx's own ship-to line ("Ship to
              <b>{target}</b>") so the desk table and the rail card describe
              one bill the same way. Violet is unchanged.

              ⚠ FIXED-LAYOUT TABLE (CLAUDE_UI §27): this rides INSIDE the
              existing Ship-to column — no new column, no widened `widths`
              entry. Two names in one 20% track will overflow, so the line
              truncates with an ellipsis of its own (the <td>'s overflow
              rules clip a child but give it no ellipsis) and the full pair
              is on `title` for a hover.

              An unmatched bill has no `customer` row, so `customerName` is
              null — it keeps the old nameless caption rather than printing
              a blank on one side of the arrow. */}
          {isRedirect && (
            <div
              className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-brand-800"
              title={
                row.customerName && row.shipToOverrideName
                  ? `${row.customerName} → ship to ${row.shipToOverrideName}`
                  : undefined
              }
            >
              {row.customerName && row.shipToOverrideName ? (
                <>
                  {row.customerName}
                  <span className="mx-1 opacity-60">→</span>
                  <b className="font-semibold">{row.shipToOverrideName}</b>
                </>
              ) : (
                "→ ship-to changed"
              )}
            </div>
          )}
          {chipFor?.(row)}
        </td>
        )}
        {/* SO — whose bill it is (2026-10-06). Every arm, unconditional, the
            same as its <th>. Ellipsis from TD; the full name on hover. A depot
            mailbox reads "Telecaller" in grey; not found is a grey dash. */}
        <td
          className={TD}
          title={
            row.salesOfficerSource === "telecaller"
              ? "Telecaller — the mail order came from a depot mailbox"
              : row.salesOfficerName ?? undefined
          }
        >
          {row.salesOfficerName === null ? (
            <span className="text-[11.5px] text-[#d1d5db]">—</span>
          ) : row.salesOfficerSource === "telecaller" ? (
            <span className="text-[11.5px] text-[#9ca3af]">{row.salesOfficerName}</span>
          ) : (
            <span className="text-[11.5px] text-[#4b5563]">{row.salesOfficerName}</span>
          )}
        </td>
        {/* 🔴 ROUTE. THIS CELL WENT MISSING IN e656ad80 AND CAME BACK HERE.
            The Due column was introduced by replacing a two-part anchor —
            the Route cell plus the old guarded Slot cell — with the Due
            cell alone, and the Route cell went with it. The colgroup and
            the header kept their nine entries while the body rendered
            eight, so every column from here rightwards drew one position
            left: the ROUTE header showed the time, DUE was empty, and the
            Status pill sat under ARTICLE.

            It was not caught because the check that was supposed to catch
            it counted `<td` with a regex over the whole function, and one
            of the matches was the string "<td>" inside a COMMENT. Eight
            real cells plus one commented one read as nine. Count the cells
            against the list in the widths block above, by eye, and never
            trust a regex that has not been made comment-blind. */}
        <td className={TD} title={shipToBlock ? row.area ?? undefined : undefined}>
          {(areaCol ? row.area : row.route) ?? "—"}
        </td>
        <td className={`${TD} whitespace-nowrap tabular-nums`}>{dueCell}</td>
        {/* ── VOL / KG, ONE STACKED CELL (2026-09-10 c) ──────────────────
            Litres on line one, kilos underneath, both right-aligned and
            tabular so the digits line up down the column. Two positions
            became one because ten did not fit and these two are the
            cheapest pair to merge: they are short, they are read
            together, and the row already stacks OBD over its date and
            invoice over its date.

            formatLitres, not the raw Float. A single row rarely shows the
            fault, but the same function everywhere is what keeps a row,
            its band header and the pool header from disagreeing by a
            decimal on one screen. Display only — nothing stored moves.

            🔴 AN UNKNOWN WEIGHT PRINTS AN EM DASH ON ITS OWN LINE, never
            "0". formatWeightKg returns null for 0 because the importer
            stores a missing SAP gross weight as 0
            (app/api/import/obd/route.ts:600 and three siblings), so the
            two are the same value in the column. A printed "0" would let
            a planner load a van against vehicle_master.capacityKg and be
            short by whatever that bill really weighs. The dash keeps the
            second line occupied so every row in the column is the same
            height — a cell that collapsed to one line would make the whole
            table jump row by row. */}
        {/* A GIFT's figures are SAP placeholders and are left out of every
            total — shown, but greyed in the muted ink so they read as "not
            counted" beside the GIFT pill in the ship-to cell. */}
        <td
          // SWAP TD's text colour, never stack a second one: two colour
          // utilities on one element resolve by stylesheet order, not class order.
          className={`${row.isGift ? TD.replace("text-[#4b5563]", "text-ink-400") : TD} text-right tabular-nums`}
          title={row.isGift ? "Gift — not counted in L / kg" : undefined}
        >
          <div>{formatLitres(row.volumeLitres ?? 0)} L</div>
          <div className={`text-[10px] ${row.isGift ? "text-ink-400" : "text-[#9ca3af]"}`}>
            {weightStr !== null ? (
              `${weightStr} kg`
            ) : (
              <span title="No weight recorded for this bill">&mdash;</span>
            )}
          </div>
        </td>
        <td className={`${TD} text-[10.5px]`}>
          <span className="text-[#6b7280]">
            {row.articleTag ? formatArticleTag(row.articleTag) : "—"}
          </span>
        </td>
        {/* ── ARTICLE — the supervisor's article no. (2026-10-06) ─────────────
            pick_assignments.articleCount, entered on Approve. NOT the tag to
            its left (SAP's plan) — a separate, counted fact.

            🔴 GATED ON rowStatus, NEVER isChecked — the same `st` the Status
            pill reads. `done` (checked) and `dispatched` show the number, or
            a muted "—" when it is NULL (approved before 2026-10-06). Every
            other status renders an EMPTY cell, including `direct`: a Direct
            Loaded bill never goes through Approve and has no article no. by
            design, so a dash there would read as "missing". Never "0".

            Colour is SWAPPED on TD, never stacked — same rule as the Vol/KG
            cell above. */}
        <td
          className={`${
            (st === "done" || st === "dispatched") && row.articleCount != null
              ? TD.replace("text-[#4b5563]", "text-ok-text font-semibold")
              : TD.replace("text-[#4b5563]", "text-ink-400")
          } text-right tabular-nums`}
        >
          {st === "done" || st === "dispatched" ? (row.articleCount ?? "—") : null}
        </td>
        <td className={TD}>{statusCell}</td>
      </tr>
    );
  }
}
