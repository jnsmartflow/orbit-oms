import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { isBillingFeedOn, isLiveFeedOn, isPickingFeedOn, isTintFeedOn, readChangesAfter, readFeedMeta } from "@/lib/live/feed";
import { filterPickerOrderIds } from "@/lib/picking/picker-feed";
import { classifyTintManager, filterTintOperatorOrderIds } from "@/lib/tint/live-feed";
import { operatorSeesAll } from "@/lib/tint/live-feed-rule";
import {
  createHeadCache,
  decodeCursor,
  encodeCursor,
  groupChanges,
  horizonCursor,
  isPrunedPast,
  nextCursor,
  faceFitsScreen,
  HELD_MAX,
  narrowOrderIds,
  parseFace,
  parseHeldIds,
  parseLimit,
  parseScreen,
  parseTopics,
  type LiveGroup,
} from "@/lib/live/cursor";

export const dynamic = "force-dynamic";

// GET /api/live/changes?after=<cursor>&topics=order,trip,config&limit=500
//
// The catch-up call of the live change feed — design §F.1,
// docs/prompts/drafts/code-discovery-2026-09-29-live-change-feed.md. READ-ONLY.
// Returns changed IDS only, never business data; each screen then fetches the
// rows through its own permission-checked route.
//
// Order of checks:
//   1. session (401) → 2. canView on a page that consumes the feed (403; floor OR mail_orders OR picking
//      since 2026-09-30 — checkAnyPermission, so the access notebook applies) →
//   3. the kill switch app_settings 'live.feed' (+ 'live.feed.billing' for ?screen=billing; absent / false / read error =
//      OFF → 200 { enabled: false }, and NOTHING else is read).
//   Tint step 3 (2026-09-30): ?screen=tint also needs the face's own tick (tint_manager, or tint_operator
//   with face=operator) and 'live.feed.tint'. Manager answers carry `missingTouched`; see lib/tint/live-feed.ts.
//
// Cursor: opaque "v1.<txId>.<seq>" (lib/live/cursor.ts). No `after` → the
// current head, reset: true: a new client takes this BEFORE its first full load
// and polls from it, so a change landing during the load is delivered again
// (harmless) rather than skipped.
//
// Horizon (§C.4): only rows whose "txId" < pg_snapshot_xmin(pg_current_snapshot())
// and whose ("txId", seq) is after the cursor, ordered by ("txId", seq),
// limit + 1 to detect `more`. A cursor at or below live_feed_meta
// "prunedThroughTxId" → reset: true (full load).
//
// Cost per call with the switch ON: the cached switch read (≤ 1 per instance
// per 30 s) + one small horizon/watermark/lag statement + AT MOST ONE
// live_changes query (an index range scan on live_changes_tx_seq_idx — the SQL
// is in lib/live/feed.ts). Auth + permission cost nothing extra on a warm
// instance while the access notebook is on.
//
// Topic filtering: the cursor advances past rows of topics the caller did not
// ask for. A client that changes its topic list must start again with no cursor.

// 2026-09-30 (billing 2b-i): + "mail_orders" — billing staff hold mail_orders, not floor.
// The rule is: a session AND (floor canView OR mail_orders canView), each through
// checkAnyPermission (all roles, access notebook). Ids only — every row still comes
// from the screen's own permission-checked route.
// Picking 4a (2026-09-30): + "picking" — the supervisor and picker faces hold picking, not floor.
// Tint step 3 (2026-09-30): + "tint_manager", "tint_operator" — and ?screen=tint then re-checks the
// face's own key (Manager → tint_manager, face=operator → tint_operator), below.
const PAGE_KEYS_THAT_CONSUME_THE_FEED = ["floor", "mail_orders", "picking", "tint_manager", "tint_operator"] as const;

/** face=picker: keep only the order ids assigned to the session user now, or held by his phone. */
async function narrowForPicker(groups: LiveGroup[], pickerId: number, held: number[]): Promise<LiveGroup[]> {
  const order = groups.find((g) => g.entity === "order");
  const ids = (order?.ids ?? []).filter((id): id is number => typeof id === "number");
  const keep = new Set(await filterPickerOrderIds(ids, pickerId, held));
  return narrowOrderIds(groups, keep);
}

/** The ORDER ids of a page (numbers only). */
function orderIdsOf(groups: LiveGroup[]): number[] {
  const order = groups.find((g) => g.entity === "order");
  return (order?.ids ?? []).filter((id): id is number => typeof id === "number");
}

/**
 * ?screen=tint, Manager (no face): keep only ids on the board now or in `held`; say whether the
 * missing-customers side list may have changed. No tint id and no other entity → changes: [] —
 * "nothing for you". lib/tint/live-feed.ts.
 */
async function narrowForTintManager(
  groups: LiveGroup[],
  held: number[],
  missingHeld: number[],
): Promise<{ changes: LiveGroup[]; missingTouched: boolean }> {
  const decision = await classifyTintManager(orderIdsOf(groups), held, missingHeld);
  return { changes: narrowOrderIds(groups, new Set(decision.keep)), missingTouched: decision.missingTouched };
}

/** ?screen=tint&face=operator: keep only ids in the SESSION user's my-orders set now, or in `held`. */
async function narrowForTintOperator(groups: LiveGroup[], userId: number, seesAll: boolean, held: number[]): Promise<LiveGroup[]> {
  const keep = await filterTintOperatorOrderIds(orderIdsOf(groups), userId, seesAll, held);
  return narrowOrderIds(groups, new Set(keep));
}

// 7a (2026-09-30): per-instance safe-head cache — see HEAD_CACHE rules in
// lib/live/cursor.ts. A caller already AT the latest safe head this instance
// handed out (≤ 5 s ago) gets "no changes" with its own cursor and no
// live_changes read. Remembered only after a NON-full read or a fresh-head
// answer; never moves anyone's cursor, so it can delay a change ≤ 5 s but can
// never skip one.
const headCache = createHeadCache(() => Date.now());

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];

  let allowed = false;
  for (const pageKey of PAGE_KEYS_THAT_CONSUME_THE_FEED) {
    if (await checkAnyPermission(roles, pageKey, "canView")) {
      allowed = true;
      break;
    }
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);

  // ?screen=billing (2026-09-30) → enabled only when live.feed AND live.feed.billing are ON
  // (absent row = OFF). ?screen=picking (picking 4a) → live.feed AND live.feed.picking.
  // No screen → the global switch alone, exactly as before (Floor).
  const screen = parseScreen(url.searchParams.get("screen"));
  if (screen === undefined) {
    return NextResponse.json({ error: "screen must be: billing, picking, tint" }, { status: 400 });
  }
  // &face=picker&held=<ids ≤ 100> (picking only): the ORDER ids are narrowed to those assigned
  // to the SESSION user now, or in `held` (lib/picking/picker-feed.ts). Never a client picker id.
  // &face=operator&held=<ids ≤ 100> (tint only, tint step 3): the same, against the session user's my-orders set.
  const face = parseFace(url.searchParams.get("face"));
  if (face === undefined || !faceFitsScreen(face, screen)) {
    return NextResponse.json({ error: "face must be: picker (with screen=picking) or operator (with screen=tint)" }, { status: 400 });
  }
  const held = parseHeldIds(url.searchParams.get("held"));
  if (held === null) {
    return NextResponse.json({ error: `held must be up to ${HELD_MAX} comma-separated positive integers` }, { status: 400 });
  }
  // &missing=<ids ≤ 100> (tint Manager only): the ids its missing-customers side list shows.
  const tintManager = screen === "tint" && face === null;
  const rawMissing = url.searchParams.get("missing");
  const missingHeld = parseHeldIds(rawMissing);
  if (missingHeld === null || (!tintManager && missingHeld.length > 0)) {
    return NextResponse.json(
      { error: `missing must be up to ${HELD_MAX} comma-separated positive integers, with screen=tint and no face` },
      { status: 400 },
    );
  }
  const sessionUserId = Number(session.user.id);
  if ((face === "picker" || face === "operator") && (!Number.isInteger(sessionUserId) || sessionUserId <= 0)) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }
  // ?screen=tint: the face's own page key (the list above only proves SOME feed page).
  if (screen === "tint") {
    const tintKey = face === "operator" ? "tint_operator" : "tint_manager";
    if (!(await checkAnyPermission(roles, tintKey, "canView"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  const on =
    screen === "billing"
      ? await isBillingFeedOn()
      : screen === "picking"
        ? await isPickingFeedOn()
        : screen === "tint"
          ? await isTintFeedOn()
          : await isLiveFeedOn();
  if (!on) {
    return NextResponse.json({ enabled: false }, { headers: NO_STORE });
  }

  const topics = parseTopics(url.searchParams.get("topics"));
  if (topics === null) {
    return NextResponse.json({ error: "topics must name at least one of: order, trip, config, mail_order, so_tag" }, { status: 400 });
  }
  const limit = parseLimit(url.searchParams.get("limit"));
  const rawAfter = url.searchParams.get("after");
  const after = rawAfter === null || rawAfter.trim() === "" ? null : decodeCursor(rawAfter);
  if (rawAfter !== null && rawAfter.trim() !== "" && after === null) {
    return NextResponse.json({ error: "after is not a valid cursor" }, { status: 400 });
  }

  const serverNow = new Date().toISOString();

  // Cached safe head — no live_changes read, no meta read.
  const cached = after !== null ? headCache.hit(after) : null;
  if (after !== null && cached !== null) {
    return NextResponse.json(
      {
        enabled: true,
        cursor: encodeCursor(after),
        changes: [],
        more: false,
        reset: false,
        lagSeconds: cached.lagSeconds,
        serverNow,
        ...(tintManager ? { missingTouched: false } : {}),
      },
      { headers: NO_STORE },
    );
  }

  const meta = await readFeedMeta();

  // No cursor, or the log was pruned past it → start from the current head.
  if (after === null || isPrunedPast(after, meta.pruned)) {
    headCache.remember(horizonCursor(meta.horizon), meta.lagSeconds);
    return NextResponse.json(
      {
        enabled: true,
        cursor: encodeCursor(horizonCursor(meta.horizon)),
        changes: [],
        more: false,
        reset: true,
        lagSeconds: meta.lagSeconds,
        serverNow,
        ...(tintManager ? { missingTouched: false } : {}),
      },
      { headers: NO_STORE },
    );
  }

  const { horizon, rows } = await readChangesAfter({ after, topics, limitPlusOne: limit + 1 });
  const more = rows.length > limit;
  const returned = more ? rows.slice(0, limit) : rows;
  const cursor = nextCursor({ after, returned, more, horizonTxId: horizon });
  if (!more) headCache.remember(cursor, meta.lagSeconds);

  const grouped = groupChanges(returned);
  let changes: LiveGroup[] = grouped;
  let missingTouched: boolean | undefined;
  if (face === "picker") {
    changes = await narrowForPicker(grouped, sessionUserId, held);
  } else if (face === "operator") {
    changes = await narrowForTintOperator(grouped, sessionUserId, operatorSeesAll(session.user.role), held);
  } else if (tintManager) {
    const r = await narrowForTintManager(grouped, held, missingHeld);
    changes = r.changes;
    missingTouched = r.missingTouched;
  }

  return NextResponse.json(
    {
      enabled: true,
      cursor: encodeCursor(cursor),
      changes,
      more,
      reset: false,
      lagSeconds: meta.lagSeconds,
      serverNow,
      ...(missingTouched !== undefined ? { missingTouched } : {}),
    },
    { headers: NO_STORE },
  );
}
