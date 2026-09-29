import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { isLiveFeedOn, readChangesAfter, readFeedMeta } from "@/lib/live/feed";
import {
  createHeadCache,
  decodeCursor,
  encodeCursor,
  groupChanges,
  horizonCursor,
  isPrunedPast,
  nextCursor,
  parseLimit,
  parseTopics,
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
//   1. session (401) → 2. canView on a page that consumes the feed (403; today
//      only 'floor' — checkAnyPermission, so the access notebook applies) →
//   3. the kill switch app_settings 'live.feed' (absent / false / read error =
//      OFF → 200 { enabled: false }, and NOTHING else is read).
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

const PAGE_KEYS_THAT_CONSUME_THE_FEED = ["floor"] as const;

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

  if (!(await isLiveFeedOn())) {
    return NextResponse.json({ enabled: false }, { headers: NO_STORE });
  }

  const url = new URL(req.url);
  const topics = parseTopics(url.searchParams.get("topics"));
  if (topics === null) {
    return NextResponse.json({ error: "topics must name at least one of: order, trip, config" }, { status: 400 });
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
      },
      { headers: NO_STORE },
    );
  }

  const { horizon, rows } = await readChangesAfter({ after, topics, limitPlusOne: limit + 1 });
  const more = rows.length > limit;
  const returned = more ? rows.slice(0, limit) : rows;
  const cursor = nextCursor({ after, returned, more, horizonTxId: horizon });
  if (!more) headCache.remember(cursor, meta.lagSeconds);

  return NextResponse.json(
    {
      enabled: true,
      cursor: encodeCursor(cursor),
      changes: groupChanges(returned),
      more,
      reset: false,
      lagSeconds: meta.lagSeconds,
      serverNow,
    },
    { headers: NO_STORE },
  );
}
