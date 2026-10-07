// lib/challan-orders/check-failed-message.ts
//
// The client-safe half of check-failed.ts (slice 6c, 2026-10-07): the batch shape the
// alerts route returns and the strip's one-line message. Pure — no Prisma — so the
// "use client" alert strip can import it. check-failed.ts re-exports both.

export interface CheckFailedBatch {
  batchId: number;
  batchRef: string;
  createdAt: string;
  /** Bills of this batch still undecided — the ones the failed check withheld. */
  withheld: number;
}

/** The strip's line for one batch. */
export function checkFailedMessage(b: Pick<CheckFailedBatch, "batchRef" | "withheld">): string {
  return `Import ${b.batchRef}: ${b.withheld} bill${b.withheld === 1 ? "" : "s"} held — challan check failed — Retry`;
}
