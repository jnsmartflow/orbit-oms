# Code Discovery — Ship-to override (manual + mail-order), mirroring dispatchStatus
2026-07-07 · Read-only diagnosis · Schema v27.7 · Enrichment v3

Goal for this doc: map how ship-to override is stored/edited today, and how dispatchStatus flows through mail-order enrichment (the pattern to copy). No app code was changed to produce this.

Files read: docs/CLAUDE_CORE.md, docs/CLAUDE_MAIL_ORDERS.md, prisma/schema.prisma (`orders`, `mo_orders`), app/api/support/orders/route.ts, app/api/support/orders/[id]/route.ts, app/api/support/orders/[id]/assign-slot/route.ts, components/support/support-orders-table.tsx, app/api/import/obd/route.ts (`applyMailOrderEnrichment`), lib/mail-orders/utils.ts (`splitDeliveryRemarks`), app/api/mail-orders/ingest/route.ts (grep), lib/mail-orders/delivery-match.ts (referenced via CLAUDE_MAIL_ORDERS.md §6).

---

## Ship-to storage today

**`orders` model (prisma/schema.prisma) — candidate columns:**

```
shipToCustomerId     String                    // NOT NULL — the SAP/import-given ship-to code
shipToCustomerName   String?                   // as SAP sent it
customerId           Int?                      // FK → delivery_point_master, resolved match
customer             delivery_point_master?    @relation(fields: [customerId], references: [id])
shipToOverride       Boolean                   @default(false)   // FLAG ONLY — no value column
slotToOverride       Boolean                   @default(false)
customerMissing      Boolean                   @default(false)
```

`shipToOverride` on `orders` is a **boolean flag with no paired value column**. There is nothing on `orders` that stores "the alternate ship-to" as a distinct identity (no `shipToOverrideCustomerId`, no `shipToOverrideName`, nothing parallel to `customerId`). Original ship-to (`shipToCustomerId`/`shipToCustomerName`) is the only ship-to identity ever populated on this table, always from SAP.

**`mo_orders` model — candidate columns:**

```
customerName     String?
customerCode     String?
deliveryRemarks  String?
shipToOverride   Boolean?   @default(false)
slotToOverride   Boolean?   @default(false)
```

Same shape: `shipToOverride` is a flag. `mo_orders` has **no dedicated ship-to value column either** — the override *value* is smuggled inside the free-text `deliveryRemarks` column as an appended suffix, parsed back out on read. From `lib/mail-orders/utils.ts:844-869` (`splitDeliveryRemarks`):

```ts
export function splitDeliveryRemarks(
  deliveryRemarks: string | null | undefined,
  shipToOverride: boolean,
): ParsedDeliveryRemarks {
  ...
  if (!shipToOverride) {
    return { shipToName: null, shipToCode: null, deliveryInstruction: text };
  }
  const suffixRegex = /\s*\[→\s*([^()\[\]]+?)\s*\((\d+)\)\s*\]\s*$/;
  const match = text.match(suffixRegex);
  if (!match) {
    return { shipToName: text, shipToCode: null, deliveryInstruction: null };
  }
  const suffixName = match[1].trim();
  const suffixCode = match[2].trim();
  ...
```

`CLAUDE_MAIL_ORDERS.md §6` confirms the writer side: `matchDeliveryCustomer()` in `delivery-match.ts` "searches `delivery_point_master` from `deliveryRemarks`. Override if different customer code found. Appends `[→ CustomerName (Code)]` to `deliveryRemarks`." So the mail-order pipeline resolves ship-to overrides against `delivery_point_master` (a real customer lookup), then re-encodes the result as text in `deliveryRemarks` rather than storing a clean FK.

**S2 — What the Support board shows as ship-to:**

`app/api/support/orders/route.ts:12-26` (`ORDER_INCLUDE`) includes the resolved customer relation:
```ts
customer: {
  select: {
    id: true,
    customerName: true,
    dispatchDeliveryType: { select: { name: true } },
    area: { select: { name: true, primaryRoute: { select: { name: true } }, deliveryType: { select: { name: true } } } },
  },
},
```
`components/support/support-orders-table.tsx:1091` renders:
```tsx
{order.customer?.customerName ?? order.shipToCustomerName ?? "—"}
```
and line 1107 separately shows the raw code: `{order.shipToCustomerId}`. So Support's "ship-to" is **`order.customer.customerName`** (resolved via `customerId` → `delivery_point_master`) when a match exists, falling back to the raw SAP `shipToCustomerName` only when unmatched (`customerMissing` path — see "Missing customer resolver", `CLAUDE_MAIL_ORDERS.md §19`). Nothing here reads `orders.shipToOverride` for display — the flag is currently a write-only artifact copied over from `mo_orders` during enrichment (see D2/enrichment code below) with no reader on the Support board.

**S3 — Can Support edit ship-to today?**

No. `app/api/support/orders/[id]/route.ts:81-86` (`patchSchema`) is the only PATCH route on a Support order, and its full field set is:
```ts
const patchSchema = z.object({
  dispatchStatus: z.string().optional(),
  priorityLevel:  z.number().int().min(1).max(5).optional(),
  dispatchSlot:   z.string().nullable().optional(),
  note:           z.string().optional(),
});
```
No `shipTo*` field anywhere in this schema, nor in the `updateData` build (lines 122-166), nor in any other route under `app/api/support/orders/**` (`assign-slot`, `hold`, `cancel`, `dispatch`, `release`, `undo-dispatch`, `undo-cancel`, `preset-slot` — grepped, none touch `shipTo*`). **Ship-to on Support is display-only today; there is no write path.**

---

## Dispatch status pattern (to mirror)

**D1 — Storage:**
- `orders.dispatchStatus` → `String?` (schema.prisma:645), no enum, no default. Observed values in code: `"dispatch"`, `"hold"`, or `null`. Per `CLAUDE_CORE.md §13`: "`orders.dispatchStatus` Hold value is lowercase `\"hold\"`." (the capitalized `"Hold"` belongs only to `mo_orders`).
- `mo_orders.dispatchStatus` → `String?  @default("Dispatch")` (schema.prisma:1367), allowed values `"Dispatch" | "Hold"` per `CLAUDE_MAIL_ORDERS.md §2`.

**D2 — How mail-order enrichment sets it** — `app/api/import/obd/route.ts`, inside `applyMailOrderEnrichment()` (lines 227-303):
```ts
const mailOrder = await prisma.mo_orders.findFirst({
  where: { soNumber: soNum },
  orderBy: { createdAt: "desc" },
});
if (!mailOrder) continue;

const updateData: Record<string, unknown> = { mailMatched: true };

if (mailOrder.dispatchStatus) {
  const loweredStatus = mailOrder.dispatchStatus.toLowerCase();
  updateData.dispatchStatus = loweredStatus;
  // heldAt set per-order below — updateMany can't apply per-row values
}
...
await prisma.orders.updateMany({
  where: { soNumber: soNum },
  data: updateData,
});
```
Decided by: whatever value already sits in `mo_orders.dispatchStatus` (set at ingest time — parser detects `Dispatch:`/`Hold` in app-format emails, or the column default `"Dispatch"` applies). Enrichment just **lowercases and copies** it onto every `orders` row sharing that `soNumber` via `updateMany`. Same block (lines 259-264) does the identical copy-through for `shipToOverride`/`slotToOverride`:
```ts
if (mailOrder.shipToOverride) {
  updateData.shipToOverride = true;
}
if (mailOrder.slotToOverride) {
  updateData.slotToOverride = true;
}
```
This confirms: **the flag-copy plumbing for `shipToOverride` already exists** in the enrichment writer — it already mirrors `dispatchStatus`'s copy pattern one-for-one. What's missing is a *value* to copy (see Gap list below), not the copy mechanism itself.

**D3 — Manual edit from Support (the pattern to reuse for ship-to):**
`app/api/support/orders/[id]/route.ts:135-144`:
```ts
if (dispatchStatus !== undefined && dispatchStatus !== order.dispatchStatus) {
  updateData.dispatchStatus = dispatchStatus || null;
  logEntries.push({
    orderId:     id,
    fromStage:   order.dispatchStatus ?? null,
    toStage:     dispatchStatus || "cleared",
    changedById: userId,
    note:        logNote,
  });
}
```
...written inside the `$transaction` at lines 172-198 (`order_status_logs` insert for every changed field, `dispatch_change_queue` insert specifically when `dispatchStatus === "hold"`, then `tx.orders.update(...)`). This diff-against-current → log-entry → transactional-update shape is exactly the scaffold a ship-to PATCH field would slot into.

---

## Gap list — manual override

Smallest-scope read of what would need to change (no code written):

- **New value column needed on `orders`** — today only `shipToOverride` (Boolean flag) exists; there is no column to hold *which* ship-to it was overridden to. Would need something like a resolved FK (mirroring `customerId`'s pattern against `delivery_point_master`) — e.g. `shipToOverrideCustomerId Int? → delivery_point_master`, OR a free-text pair like `mo_orders` uses (fragile, not recommended to copy verbatim onto a structured `orders` row when a clean FK is available here).
- **Extend `patchSchema`** in `app/api/support/orders/[id]/route.ts` to accept the new field(s), diff against current value, push an `order_status_logs` entry (same shape as the `dispatchStatus` block), and include in `updateData` inside the existing `$transaction`.
- **UI field** — `support-orders-table.tsx` currently has no ship-to edit affordance at all (only the "missing customer" resolver sheet, which *creates* a `delivery_point_master` row, a different flow). A new UI control (inline edit / modal) would be needed to let Support pick a different ship-to and PATCH it.
- **Decide read-side behaviour** — once a value column exists, `support-orders-table.tsx:1091` and the Support board's `ORDER_INCLUDE` would need to prefer the override value over `order.customer.customerName` when `shipToOverride === true` (mirrors how `mo_orders`' `ShipToCard` prefers the parsed override identity — `CLAUDE_MAIL_ORDERS.md §9.5`).

## Gap list — mail-order override

- **The copy plumbing in `applyMailOrderEnrichment()` already exists** for the boolean flag (lines 259-261) — this part needs no change to keep working.
- **What's missing is a value to copy.** `mo_orders`' own ship-to override value isn't a clean column either — it's encoded inside `deliveryRemarks` via the `[→ Name (Code)]` suffix (`delivery-match.ts`, parsed by `splitDeliveryRemarks`). To carry a *real* override value from mail-order enrichment into `orders`, enrichment would need to either: (a) parse `mailOrder.deliveryRemarks` with `splitDeliveryRemarks()` to recover `shipToCode`, then resolve that code against `delivery_point_master` to get an id to write into a new `orders` override column, or (b) have `delivery-match.ts` write a clean resolved id onto `mo_orders` directly (a parallel schema change on `mo_orders` too) instead of only text-encoding it, which enrichment could then copy straight across.
- **Tie to customer-matching:** `delivery-match.ts`'s `matchDeliveryCustomer()` already resolves ship-to overrides against `delivery_point_master` at ingest time (per `CLAUDE_MAIL_ORDERS.md §6`) — so the resolved id is known at that moment but is discarded/re-encoded as text rather than persisted as an id. Reusing that resolution (rather than re-deriving it later) would be the cheaper path once schema exists.

**Flag — is ship-to a resolved delivery point, or free text?** Both patterns coexist today: `orders.customerId`/`mo_orders`'s underlying match are resolved `delivery_point_master` ids; but the *override* signal on both tables is carried as a bare boolean, and on `mo_orders` the override's actual identity is free text (a suffix pattern inside `deliveryRemarks`), not an id. Any new override-value column should decide up front whether it stores a resolved `delivery_point_master` id (consistent with `customerId`) or free text (consistent with the existing `mo_orders` suffix convention) — recommend the former since `delivery-match.ts` already resolves against `delivery_point_master` before it ever writes the suffix.

## Schema change needed? (yes/no)

**Yes.** No column on `orders` or `mo_orders` currently stores a ship-to override *value* — both tables only carry the boolean `shipToOverride` flag. A new column (or pair of columns, e.g. an id + a denormalized name for display) is needed on `orders` before Support can manually set an override, and — separately — either a new column on `mo_orders` or a parse-then-resolve step in enrichment is needed before mail-order enrichment can carry a real override value through to `orders`. All other plumbing (the flag copy-through in `applyMailOrderEnrichment`, the diff→log→transactional-update scaffold in the Support PATCH route, and the `delivery_point_master` resolution already done by `delivery-match.ts`) already exists and can be reused/extended rather than rebuilt.
