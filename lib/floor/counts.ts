// lib/floor/counts.ts — LIVE FEED 7a: the lazy tabs' label counts.
//
// Served by: GET /api/floor/counts. Proven by: scripts/parity-floor-rows.ts
// (these numbers vs the per-scope lengths of the full hold / cancelled feeds).
//
// In 7b the On hold and Cancel & CI tabs load only when clicked; their tab
// pills still need a number. This returns, per delivery-type scope, what the
// full feed would list BEFORE the client's search and flag filters (those can
// only run on rows the client holds):
//   · hold      — floorHoldWhere() AND the hide exclusion (the SAME imported
//                 predicate getFloorHold uses), counted per scope with the same
//                 dealer → area → delivery type rule the feed applies;
//   · cancelled — the length of getFloorCancelled itself, per scope (it is a
//                 today-only feed of a handful of rows, cheap since the partial
//                 index order_status_logs_cancelled_created_idx, v27.46).
// NOT the Floor tab: its badge is derived client-side from rows the client
// always holds, after search, filters and the client-only tint-room split
// (status-pill.tsx isTintRoomRow) — a server number would disagree with it.
//
// SELECT-only, sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";
import { getHideExclusion } from "@/lib/hide/visibility";
import { floorHoldWhere, getFloorCancelled } from "@/lib/floor/queries";
import { inScope } from "@/lib/floor/scope";
import { getTodayIST } from "@/lib/dates";
import type { FloorScope } from "@/lib/floor/types";

/** Every delivery-type scope the Floor chips offer (FloorScope, lib/floor/types.ts). */
export const FLOOR_TAB_SCOPES: FloorScope[] = ["All", "Local", "Upcountry", "IGT / Cross"];

export interface FloorTabCounts {
  /** Today, IST — the Cancel & CI tab is today-only. */
  date: string;
  hold: Record<FloorScope, number>;
  cancelled: Record<FloorScope, number>;
}

function tally(deliveryTypes: (string | null)[]): Record<FloorScope, number> {
  const out = {} as Record<FloorScope, number>;
  for (const scope of FLOOR_TAB_SCOPES) out[scope] = deliveryTypes.filter((t) => inScope(t, scope)).length;
  return out;
}

const DELIVERY_TYPE_ONLY = {
  area: { select: { deliveryType: { select: { name: true } } } },
} as const;

export async function getFloorTabCounts(): Promise<FloorTabCounts> {
  const hide = await getHideExclusion();

  const held = await prisma.orders.findMany({
    where: { AND: [floorHoldWhere(), hide] },
    select: {
      customer: { select: DELIVERY_TYPE_ONLY },
      shipToOverrideCustomer: { select: DELIVERY_TYPE_ONLY },
    },
  });
  // The feed's own rule (getFloorHold): the EFFECTIVE dealer is the ship-to
  // override when set, else the customer; its area's delivery type decides scope.
  const holdTypes = held.map((o) => (o.shipToOverrideCustomer ?? o.customer)?.area?.deliveryType?.name ?? null);

  const cancelled = await getFloorCancelled("All", hide);

  return {
    date: getTodayIST(),
    hold: tally(holdTypes),
    cancelled: tally(cancelled.map((r) => r.deliveryType)),
  };
}
