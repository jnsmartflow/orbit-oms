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
// COLUMNS: ☐ · OBD+date · Invoice · Ship to · Route · Due · Vol · KG · Article
//          · Status
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
//  - Vol and KG right-aligned, plain numbers. Gift lines are OUT OF SCOPE.
//  - KG renders an EM DASH at zero, never "0" — see the cell.
//  - Article reuses formatArticleTag (D/C/T/B), CLAUDE_SUPPORT §4.19.
//  - The ☐ and # columns use NARROW padding so the row number never truncates
//    (Step-5 bug fix — 3% + 28px padding was clipping "1" to "1…").
//  - Invoice (2026-08-31) is SAP's own invoiceNo + invoiceDate, two lines,
//    shaped like the OBD cell and sitting right next to it — the two reference
//    numbers are scanned together. BLANK until SAP stamps the bill; absent
//    entirely on the showSlot (By group) arms. See the cell and `showInvoice`.

import type { ReactNode } from "react";
import { Building2, Droplet, Mail, MoreHorizontal, Zap } from "lucide-react";
// formatDateIST is the SHARED date-only formatter — the same one the detail
// panel's "Invoice date" cell reads (it used to be a private fmtDate in
// detail-details.tsx). One formatter, so the two surfaces cannot disagree.
import { formatArticleTag, formatDateIST } from "@/lib/floor/format";
import {
  StatusPill,
  rowStatus,
  isHeldBack,
  formatLitres,
  sumLitres,
  formatWeightKg,
  sumWeightKg,
} from "./status-pill";
import { isAllSelected, type FloorSelection } from "@/lib/floor/selection";
// SOFT variant only (2026-08-25). The solid DUP_SO_* tokens are the PICKING
// treatment and are deliberately no longer imported here: under `soft` every
// cell, badge and pill on a duplicate row renders exactly as it does on an
// ordinary row, so there is nothing left to flip. See the two-treatment note at
// the top of duplicate-so-tag.tsx.
import {
  DuplicateSoTag,
  DUP_SO_SOFT_BAR,
  DUP_SO_SOFT_ROW_CLASS,
} from "@/components/shared/duplicate-so-tag";
import type { FloorBoardRow } from "@/lib/floor/types";

export type FloorTableVariant = "live" | "history" | "upcoming";

// Retail Offtake / Decorative Projects = "goes to a site" SMUs (CORE §8; site
// set CONFIRMED against live data 2026-07). "Deco" (9 rows) is a known parked
// data issue — deliberately NOT handled here.
const PROJECT_SMUS = new Set(["Retail Offtake", "Decorative Projects"]);

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
function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso)
    .toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
    .replace(",", "");
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
 * The Due column's day label: "Today", or "Sat 12", or "Mon 8 Sep".
 *
 * ⚠ THE MONTH APPEARS ONLY WHEN IT DIFFERS from the day the board is anchored
 * on. The mockup writes "Mon 8" and "Sat 12", which is right for the ordinary
 * case — a bill a few days either side of today — and wrong for the one that
 * matters most: a badly carried-over bill dated 8 August, on a board anchored
 * in September, would read "Mon 8" and be taken for the 8th of this month. The
 * age chip beside it says 33d, but the DATE would be a lie, so the month goes
 * back in exactly when it is load-bearing. Today's board carries six overdue
 * bills, all in September (measured 2026-09-10), so this branch is quiet now
 * and correct when it is not.
 *
 * ⚠ NEVER `new Date(str)` — both arguments are date-only "YYYY-MM-DD" and an
 * offset-less string is read in the HOST's timezone (CORE §3). Same Date.UTC
 * parse fmtDay above uses.
 */
function fmtDueDay(dateOnly: string, anchorIso: string): string {
  if (dateOnly === anchorIso) return "Today";
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
function liveTime(row: FloorBoardRow, nowMs: number): string | null {
  const st = rowStatus(row);
  if (st === "done") return hhmm(asStr(row.checkedAt));
  if (st === "needsCheck") return shortElapsed(asStr(row.pickedAt), nowMs);
  if (st === "withPicker") return shortElapsed(asStr(row.assignedAt), nowMs);
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
  showInvoice = true,
  upcomingRows,
  anchorIso,
  chipFor,
  gateOn = false,
}: {
  rows: FloorBoardRow[];
  nowMs: number;
  variant?: FloorTableVariant;
  // Wired only on the live variant; undefined on history/upcoming.
  selection?: FloorSelection;
  onToggleRow?: (id: number) => void;
  onToggleAll?: (rows: FloorBoardRow[]) => void;
  onMarkUrgent?: (id: number) => void;
  onOpenDetail?: (id: number) => void;
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
  // ── RECUT 2026-09-10 (b) — DUE AND KG ARRIVE ──────────────────────────────
  //
  // Due sits after Route, where the old Slot column sat on the arms that had
  // one. KG sits immediately after Vol: they are the two size numbers and a
  // planner reads them as a pair against `vehicle_master.capacityKg`.
  //
  // 🔴 COUNTS, BEFORE → AFTER. "Before" is this morning's recut (which had
  // itself just taken # and Picker out); "after" is this change. Every arm
  // sums to 100 (CLAUDE_UI §27), and the header cells below match entry for
  // entry — count them.
  //
  //   interactive + invoice   8 → 10   (gained Due, KG)
  //   interactive + no-invoice 8 →  9   (gained Due, KG; lost the old Slot col)
  //   read-only  + invoice    7 →  9   (gained Due, KG)
  //   read-only  + no-invoice 7 →  8   (gained Due, KG; lost the old Slot col)
  //
  // The two no-invoice arms come out one SHORTER than the naive +2 because the
  // column they used to call "Slot" is the column now called "Due" — it is not
  // added beside itself. That is the whole reconciliation this recut turned on.
  //
  //                        ☐  OBD INV Ship Rt Due Vol KG Art Status
  const widths = interactive
    ? showInvoice
      ? [4, 14, 10, 20, 8, 13, 6, 6, 9, 10] //                              = 100
      : [4, 15, 22, 9, 14, 6, 6, 10, 14] //  ☐ OBD Ship Rt Due Vol KG Art St = 100
    : showInvoice
      ? [15, 11, 21, 8, 13, 6, 6, 9, 11] //  OBD INV Ship Rt Due Vol KG Art St = 100
      : [16, 23, 9, 14, 6, 6, 11, 15]; //    OBD Ship Rt Due Vol KG Art Status = 100
  // ⚠ THE HEADER CHECKBOX COVERS BOTH HALVES OF THIS TABLE. `toggleAll` is
  // per-TABLE (lib/floor/selection.ts documents it as per band), and the
  // upcoming rows are in this table — so a select-all that skipped them would
  // read as checked while half the list stayed unticked. The divider is a
  // separator, not a group: it has no checkbox of its own and gains none.
  const tableRows = upcoming.length > 0 ? [...rows, ...upcoming] : rows;
  const allOn = interactive && selection ? isAllSelected(selection, tableRows) : false;

  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        {widths.map((w, i) => (
          <col key={i} style={{ width: `${w}%` }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {interactive && (
            <th className={HEAD_TH_NARROW}>
              <input
                type="checkbox"
                aria-label="Select all rows in this group"
                className="h-[13px] w-[13px] cursor-pointer align-middle accent-brand-600"
                checked={allOn}
                onChange={() => onToggleAll?.(tableRows)}
              />
            </th>
          )}
          <th className={HEAD_TH}>OBD</th>
          {showInvoice && <th className={HEAD_TH}>Invoice</th>}
          <th className={HEAD_TH}>Ship to</th>
          <th className={HEAD_TH}>Route</th>
          <th className={HEAD_TH}>Due</th>
          <th className={`${HEAD_TH} text-right`}>Vol</th>
          <th className={`${HEAD_TH} text-right`}>KG</th>
          <th className={HEAD_TH}>Article</th>
          <th className={HEAD_TH}>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(renderRow)}
        {upcoming.length > 0 && (
          <>
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
            {upcoming.map(renderRow)}
          </>
        )}
      </tbody>
    </table>
  );

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
  function renderRow(row: FloorBoardRow) {
    const st = rowStatus(row);
    const pickable = st === "waiting" || st === "withPicker";
    const { isSite, isRedirect } = shipInfo(row);
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
    // The 3px red-500 left bar, as an inset shadow (never border-left —
    // this table is table-layout:fixed with colgroup percentages, UI §27,
    // and the first column's pl-[10px] pr-[4px] would be eaten by a real
    // border). It rides whichever cell is FIRST, and that changes with
    // `interactive`: the checkbox cell when the table is selectable, the
    // OBD cell when it is not (history / upcoming / the read-only
    // "what he's holding" list).
    const barStyle = dup ? { boxShadow: DUP_SO_SOFT_BAR } : undefined;

    // ── THE DUE CELL ─────────────────────────────────────────────────
    //
    // 🔴 THE BILL'S OWN `dispatchTargetDate` AND `windowTime`, NEVER THE
    // TRIP'S `tripDate`. A trip's bills genuinely carry different dates:
    // releaseBillsToFloor is called with `skipAlreadyReleased: true` from
    // the trip route (app/api/floor/trips/[id]/release/route.ts:171), so a
    // bill already on the floor keeps the slot somebody already promised
    // rather than being silently moved to the trip's day. Reading the trip
    // here would show the operator a date the bill does not have.
    // Recorded in code-discovery-2026-09-10-dates-weight-orphans.md §A5.2.
    //
    // 🔴 NEVER A BARE TIME. The slot tabs showed "10:30" with the date
    // hidden, so Wednesday's 10:30 and Thursday's 10:30 read as one queue
    // (FLOOR §10). Every state below carries the day or says there is no
    // slot at all.
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
      return (
        <>
          <span className={dayCls}>{fmtDueDay(target, anchorDay)}</span>
          {/* A date with no window is not reachable on today's board (0
              rows of 66, measured 2026-09-10) but is representable in the
              schema, so it renders the day alone rather than " · null". */}
          {row.windowTime && <span className="text-gray-500"> · {row.windowTime}</span>}
          {/* THE EXISTING AGE CHIP, MOVED — not a second one. It was in
              the OBD cell until this change. Red here, where it used to be
              grey: it now sits beside a red date and one signal in two
              colours reads as two different facts. */}
          {overdue && (
            <span
              title={`${row.ageDays} day${row.ageDays === 1 ? "" : "s"} past its dispatch date`}
              className="ml-1.5 rounded-[3px] bg-[#fdecea] px-[5px] py-px font-mono text-[9.5px] font-bold text-[#b42318]"
            >
              {row.ageDays}d
            </span>
          )}
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
      let histBody: ReactNode;
      if (row.isChecked) {
        const cAt = asStr(row.checkedAt);
        const lateDays = cAt && target ? diffDays(target, istDay(cAt)) : 0;
        const timeStr = lateDays > 0 ? fmtDateTime(cAt) : hhmm(cAt);
        histBody = (
          <span className="inline-flex items-center gap-1.5">
            <StatusPill status="done" time={timeStr} />
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
        histBody = <span className={"inline-flex items-center " + chipCls}>Not completed</span>;
      }
      statusCell = (
        <span className="inline-flex items-center gap-2">
          {histBody}
          <span className="hidden items-center gap-1 group-hover:inline-flex">
            <button
              type="button"
              title="Open details"
              onClick={() => onOpenDetail?.(row.orderId)}
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
          <span className="hidden items-center gap-1 group-hover:inline-flex">
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
        </span>
      );
    }

    return (
      <tr key={row.orderId} className={"group " + (dup ? DUP_SO_SOFT_ROW_CLASS : "hover:bg-[#fafafa]")}>
        {interactive && (
          /* FIRST CELL when the table is selectable — it carries the bar. */
          <td className={TD_NARROW} style={barStyle}>
            {/* Checkbox on Waiting / With-picker rows only (design §7.8).
                accent-brand-600 stays: it now sits on a pale wash rather
                than a red fill, and reads the same on every row either
                way. */}
            {pickable && (
              <input
                type="checkbox"
                aria-label={`Select ${row.obdNumber}`}
                className="h-[13px] w-[13px] cursor-pointer align-middle accent-brand-600"
                checked={selection?.has(row.orderId) ?? false}
                onChange={() => onToggleRow?.(row.orderId)}
              />
            )}
          </td>
        )}
        {/* On a NON-interactive table (history / upcoming / the read-only
            "what he's holding" list) the two narrow columns are not
            rendered, so THIS is the first cell and the bar lands here
            instead. `interactive` is the same flag that drives `widths`
            above, so the two can never disagree about which cell is first. */}
        <td className={TD} style={interactive ? undefined : barStyle}>
          <span className="font-mono text-[11.5px] font-medium text-[#111827]">
            {row.obdNumber}
          </span>
          {/* The tag rides the OBD cell — first column a reader lands on,
              and it never displaces the Status column's own meaning. */}
          {dup && <DuplicateSoTag variant="soft" className="ml-1.5 align-[1px]" />}
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
          {row.tripNumber && (
            <span
              title={`On trip ${row.tripNumber}${row.tripStatus ? ` · ${row.tripStatus}` : ""}`}
              className="ml-1.5 rounded-[3px] bg-gray-900 px-[5px] py-px align-[1px] font-mono text-[9.5px] font-semibold text-white"
            >
              {shortTripNumber(row.tripNumber)}
            </span>
          )}
          {/* ⚠ THE `no slot` CHIP AND THE AGE CHIP LEFT THIS CELL on
              2026-09-10 (b). Both are statements about WHEN the bill is
              due, and there is a Due column now — so they moved into it,
              where the date they qualify is sitting. Leaving either here
              would have printed it twice on the same row.

              What stays: the OBD number, the duplicate-SO tag and the trip
              tag. Those are identifiers, which is what this cell is for. */}
          <div className="flex items-center gap-1 text-[10px] text-[#9ca3af]">
            {fmtDateTime(obd)}
            {row.isEmailTime && (
              <span title="Email time" className="inline-flex shrink-0">
                <Mail size={9.5} />
              </span>
            )}
          </div>
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
        {showInvoice && (
          <td className={TD}>
            {row.invoiceNo && (
              <span className="font-mono text-[11.5px] font-medium text-[#111827]">
                {row.invoiceNo}
              </span>
            )}
            {row.invoiceDate && (
              <div className="text-[10px] text-[#9ca3af]">
                {formatDateIST(row.invoiceDate)}
              </div>
            )}
          </td>
        )}
        <td className={TD}>
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
          {row.isTint && (
            <Droplet
              size={12}
              className="ml-1 inline-block align-[-1px]"
              style={{ color: "#0284C7" }}
            />
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
        <td className={`${TD} whitespace-nowrap tabular-nums`}>{dueCell}</td>
        {/* formatLitres, not the raw Float. A single row rarely shows the
            fault, but the same function everywhere is what keeps a row,
            its band header and the pool header from disagreeing by a
            decimal on one screen. Display only — nothing stored moves. */}
        <td className={`${TD} text-right tabular-nums`}>{formatLitres(row.volumeLitres ?? 0)}</td>
        {/* KG (2026-09-10) — `weightKg` has ridden this payload since
            2026-08-11 (lib/floor/queries.ts:860) and was rendered by
            nothing. No query changed to put it on screen.

            🔴 ZERO PRINTS AS AN EM DASH. formatWeightKg returns null for
            0 because the importer stores a missing SAP gross weight as 0
            (app/api/import/obd/route.ts:600 and three siblings), so the
            two are the same value in the column. A printed "0" would let
            a planner load a van against vehicle_master.capacityKg and be
            short by whatever that bill really weighs; a dash says the
            number is missing, which is the true statement. 81 live orders
            are at 0 today, none of them on this board.

            Right-aligned and tabular, matching Vol — the two size numbers
            are read as a pair down the column. */}
        <td className={`${TD} text-right tabular-nums`}>
          {weightStr ?? (
            <span title="No weight recorded for this bill" className="text-[#c6c4d1]">
              &mdash;
            </span>
          )}
        </td>
        <td className={`${TD} text-[10.5px]`}>
          <span className="text-[#6b7280]">
            {row.articleTag ? formatArticleTag(row.articleTag) : "—"}
          </span>
        </td>
        <td className={TD}>{statusCell}</td>
      </tr>
    );
  }
}
