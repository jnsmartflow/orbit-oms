import { getISTDayRange } from "@/lib/dates";
import type { PickingQueueRow } from "./types";

// The picker "My Picks" pending/done rule — ONE implementation, extracted from
// app/picking/page.tsx on 2026-07-29 ahead of the picker face moving off
// router.refresh() onto a client fetch. Both the server page (initial render)
// and the client refetch call this, so the two can never disagree about which
// tab a bill belongs to.
//
// Pure: no I/O, no Prisma, no clock read (see `now` below). lib/dates.ts is
// explicitly client-safe, so this module is importable from a client component.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Full ISO date-time WITHOUT a trailing Z or ±HH:MM offset.
const OFFSETLESS_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * Epoch ms for a `pickedAt` value, or NaN when it cannot be read.
 *
 * ⚠ HOST-INDEPENDENCE (2026-07-29). `Date.parse()` is only timezone-safe for
 * the shapes we actually receive — a real Date (server, via Prisma) or an ISO
 * string carrying `Z`/an offset (JSON and RSC always emit one). Per the ES
 * spec a date-TIME string with NO offset is parsed in the HOST's local zone,
 * which was harmless while this rule ran only on Vercel (UTC) but stops being
 * harmless the moment it also runs on a depot phone in Asia/Kolkata: the same
 * bill would land in different days on the two, and only near midnight.
 *
 * So an offset-less string is normalised to UTC rather than left to the host.
 * UTC is what the column actually holds (timestamptz, serialised as UTC), so
 * for every input that occurs today this changes nothing — it just refuses to
 * let the machine's timezone decide.
 */
function pickedAtMs(pickedAt: Date | string | null): number {
  if (pickedAt === null) return NaN;
  if (pickedAt instanceof Date) return pickedAt.getTime();
  const normalised = OFFSETLESS_DATETIME_RE.test(pickedAt)
    ? `${pickedAt.replace(" ", "T")}Z`
    : pickedAt;
  return Date.parse(normalised);
}

/**
 * Did the picker finish this bill during TODAY in IST?
 *
 * The window comes from lib/dates.ts's getISTDayRange() — the same
 * Date.now()+IST-offset → read-UTC-parts → Date.UTC(...) derivation
 * lib/picking/queue.ts:getISTTodayDate() uses, never a naive local midnight.
 * That helper is preferred over queue.ts's own (which is private, and returns
 * a date-ONLY anchor shaped for @db.Date equality): `pickedAt` is a
 * timestamptz, so it needs a half-open INSTANT window [start, end), not a
 * calendar-day value. Half-open also means a bill finished exactly at IST
 * midnight lands in the new day only — never counted twice.
 *
 * Returns FALSE on null or unparseable input. A done bill always has pickedAt
 * (POST /api/picking/done stamps it), so null means something is wrong — and a
 * bill we cannot date must not silently drift into a receipt that claims it
 * was finished today.
 */
function isPickedTodayIST(pickedAt: Date | string | null, start: Date, end: Date): boolean {
  const ms = pickedAtMs(pickedAt);
  if (Number.isNaN(ms)) return false;
  return ms >= start.getTime() && ms < end.getTime();
}

/**
 * The IST day containing `now`, as UTC boundaries.
 *
 * Derives the IST CALENDAR DATE from the passed instant explicitly (shift by
 * the fixed offset, then read UTC parts — never local getters), and hands that
 * date to getISTDayRange() so the midnight→UTC boundary maths has exactly one
 * implementation. Takes the instant as an argument rather than calling
 * Date.now() internally, so the caller owns the clock and the rule is testable.
 */
function istDayRangeFor(now: Date): { start: Date; end: Date } {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const y = istNow.getUTCFullYear();
  const m = String(istNow.getUTCMonth() + 1).padStart(2, "0");
  const d = String(istNow.getUTCDate()).padStart(2, "0");
  return getISTDayRange(`${y}-${m}-${d}`);
}

export interface PickerRowSplit {
  pending: PickingQueueRow[];
  done: PickingQueueRow[];
}

/**
 * Split a picking queue into ONE picker's two tabs.
 *
 * Scoping is on `pickerId` — a real FK — never on assignedToName, which is a
 * display string and not a scope boundary. A null viewerId yields two empty
 * lists (nobody resolved ⇒ nothing is his).
 *
 * ORDER IS THE SERVER'S. `rows` arrives already sorted by
 * lib/picking/sort.ts's PICKING_SPINE; every step here is Array.filter, which
 * preserves that order. Nothing re-sorts, and nothing should start.
 *
 * PENDING — all dates. isChecked is excluded alongside isDone (2026-07-18):
 * without it an approved (PICK_CHECKED) bill has isDone: false and would fall
 * back into "pending" with a live-looking Mark Done CTA on a bill the
 * supervisor already finished. A bill he has not finished carries over here
 * indefinitely — deliberately NOT date-fenced, so work left mid-shift is still
 * waiting next morning.
 *
 * DONE — today only. The stage test admits EITHER finished state, so a bill
 * does not vanish from his own history the moment a supervisor approves it;
 * the fence is on WHEN he finished it. Fenced on pickedAt, NOT
 * dispatchTargetDate: this tab is his daily receipt — "what did I finish
 * today" — so the day he did the work is the only thing that decides
 * membership. A bill he picked yesterday evening for today's dispatch
 * therefore belongs to YESTERDAY's receipt, even though it is dispatching
 * today.
 */
export function splitPickerRows(
  rows: PickingQueueRow[],
  viewerId: number | null,
  now: Date,
): PickerRowSplit {
  if (viewerId === null) return { pending: [], done: [] };

  const { start, end } = istDayRangeFor(now);
  const myRows = rows.filter((r) => r.pickerId === viewerId);

  return {
    pending: myRows.filter((r) => !r.isDone && !r.isChecked),
    done: myRows.filter(
      (r) => (r.isDone || r.isChecked) && isPickedTodayIST(r.pickedAt, start, end),
    ),
  };
}
