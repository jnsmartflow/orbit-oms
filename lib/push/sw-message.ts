// lib/push/sw-message.ts — the message public/sw.js posts to open Orbit windows on a picking push
// (live feed picking 4b, 2026-09-30), and the page-side parser. PURE; tested in sw-message.test.ts.
//
// The service worker cannot import TypeScript, so it carries its OWN copy of the tag pattern.
// 🔴 PUSH_TAG_PATTERN_SOURCE below must stay byte-identical to the regex literal in public/sw.js —
// the test reads sw.js and fails if they drift.
//
// Tags are set by the push senders (CLAUDE_NOTIFICATIONS.md): pick-assigned-<orderId> (to the picker),
// pick-done-<orderId> (to supervisors), pick-cancelled-<orderId> (to the picker who held it),
// pick-direct-<orderId> (to the picker who held a bill the supervisor Direct Loaded, 2026-10-03).

export const PUSH_TAG_PATTERN_SOURCE = "^pick-(assigned|done|cancelled|direct)-(\\d+)$";
const PUSH_TAG_PATTERN = new RegExp(PUSH_TAG_PATTERN_SOURCE);

export type PickingPushKind = "assigned" | "done" | "cancelled" | "direct";

export interface OrbitPushMessage {
  type: "orbit-push";
  tag: string;
  kind: PickingPushKind;
  orderId: number;
}

/** A push tag → its kind and order id, or null for any other tag. */
export function parsePushTag(tag: unknown): { kind: PickingPushKind; orderId: number } | null {
  if (typeof tag !== "string") return null;
  const m = PUSH_TAG_PATTERN.exec(tag);
  if (!m) return null;
  const orderId = Number(m[2]);
  if (!Number.isInteger(orderId) || orderId <= 0) return null;
  return { kind: m[1] as PickingPushKind, orderId };
}

/** A `message` event's data → the push message, or null for anything else. */
export function parseOrbitPushMessage(data: unknown): OrbitPushMessage | null {
  const d = data as { type?: unknown; tag?: unknown } | null;
  if (!d || d.type !== "orbit-push") return null;
  const parsed = parsePushTag(d.tag);
  if (!parsed) return null;
  return { type: "orbit-push", tag: d.tag as string, ...parsed };
}
