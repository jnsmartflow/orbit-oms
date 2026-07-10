// Single source of truth for Support's "done" output stage(s) — the parking-
// stage flip pattern (CLAUDE_SUPPORT.md §3). Each new downstream screen gets
// its own forward stage; every place that asks "is Support done with this
// order?" or "what stage does Support currently hand off to?" should read
// from here, not a pasted string literal, so the next flip edits one line.
//
// SUPPORT_DONE_STAGES — the union of every stage that has ever meant "Support
// decided dispatch." Historical rows keep their old value forever (no
// backfill, no rewrite) — this array is how every downstream isDone/notIn
// check stays aware of both the old word and the current one.
//
// SUPPORT_DONE_OUTPUT — the stage Support (and its automated equivalents,
// e.g. mail-order auto-dispatch) writes TODAY when it dispatches an order.
// Only this one, current value — never the historical ones — because
// consumers like /picking must see only NEW dispatches, not resurrect old rows.
export const SUPPORT_DONE_STAGES = ["closed", "pending_picking"];
export const SUPPORT_DONE_OUTPUT = "pending_picking";
