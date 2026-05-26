import { prisma } from "@/lib/prisma";

export interface SyncChallanFormulasResult {
  orderId:                number;
  challanId:              number | null;
  totalLatestTiRows:      number;
  upserted:               number;
  skippedNullRawLineItem: number;
  skippedNonTinting:      number;
  skippedManualOverride:  number;
  skippedNoText:          number;
  reason?:                "no-challan" | "voided" | "ok";
}

interface TiRow {
  id:            number;
  rawLineItemId: number | null;
  shadeName:     string | null;
  samplingNo:    string | null;
  createdAt:     Date;
  source:        "tinter" | "tinter_b";
}

function buildFormulaText(
  shadeName:  string | null,
  samplingNo: string | null,
): string | null {
  const shade = shadeName?.trim() ? shadeName.trim() : null;
  const samp  = samplingNo?.trim() ? samplingNo.trim() : null;
  if (shade && samp) return `${shade} · S/N ${samp}`;
  if (shade)         return shade;
  if (samp)          return `S/N ${samp}`;
  return null;
}

export async function syncChallanFormulasFromTi(
  orderId: number,
): Promise<SyncChallanFormulasResult> {
  const result: SyncChallanFormulasResult = {
    orderId,
    challanId:              null,
    totalLatestTiRows:      0,
    upserted:               0,
    skippedNullRawLineItem: 0,
    skippedNonTinting:      0,
    skippedManualOverride:  0,
    skippedNoText:          0,
  };

  // 1. Locate the challan. Bail on missing or voided — no writes either way.
  const challan = await prisma.delivery_challans.findUnique({
    where:  { orderId },
    select: { id: true, isVoided: true },
  });

  if (!challan) {
    result.reason = "no-challan";
    return result;
  }
  if (challan.isVoided) {
    result.reason    = "voided";
    result.challanId = challan.id;
    return result;
  }

  result.challanId = challan.id;
  result.reason    = "ok";

  // 2. Pull TI rows from both tables. DB-level filter on rawLineItemId keeps
  //    the payload small; we still null-guard in step 3 to satisfy the type.
  const tinterRows = await prisma.tinter_issue_entries.findMany({
    where:  { orderId, rawLineItemId: { not: null } },
    select: {
      id:            true,
      rawLineItemId: true,
      shadeName:     true,
      samplingNo:    true,
      createdAt:     true,
    },
  });

  const tinterBRows = await prisma.tinter_issue_entries_b.findMany({
    where:  { orderId, rawLineItemId: { not: null } },
    select: {
      id:            true,
      rawLineItemId: true,
      shadeName:     true,
      samplingNo:    true,
      createdAt:     true,
    },
  });

  const combined: TiRow[] = [
    ...tinterRows.map((r)  => ({ ...r, source: "tinter"   as const })),
    ...tinterBRows.map((r) => ({ ...r, source: "tinter_b" as const })),
  ];

  // 3. Group by rawLineItemId; pick the latest createdAt per group across
  //    both tables (insert-only TI tables — newest row is the truth).
  const latestByLine = new Map<number, TiRow>();
  for (const row of combined) {
    if (row.rawLineItemId == null) {
      result.skippedNullRawLineItem++;
      continue;
    }
    const existing = latestByLine.get(row.rawLineItemId);
    if (!existing || row.createdAt.getTime() > existing.createdAt.getTime()) {
      latestByLine.set(row.rawLineItemId, row);
    }
  }

  result.totalLatestTiRows = latestByLine.size;
  if (latestByLine.size === 0) return result;

  // 4. Resolve isTinting for each candidate line. Query by id set — schema
  //    has no orderId column on import_raw_line_items (keyed by obdNumber),
  //    and id is globally unique so the id-set query is sufficient.
  const rawIds = Array.from(latestByLine.keys());
  const rawLineItems = await prisma.import_raw_line_items.findMany({
    where:  { id: { in: rawIds } },
    select: { id: true, isTinting: true },
  });
  const isTintingMap = new Map(rawLineItems.map((li) => [li.id, li.isTinting]));

  // 5. Load existing formula rows so we can honour manual-override locks.
  const existingFormulas = await prisma.delivery_challan_formulas.findMany({
    where:  { challanId: challan.id },
    select: { rawLineItemId: true, isManuallyOverridden: true },
  });
  const overrideMap = new Map(
    existingFormulas.map((f) => [f.rawLineItemId, f.isManuallyOverridden]),
  );

  // 6. Per-line upsert, sequential awaits. No $transaction (CORE §3).
  for (const [rawLineItemId, latestTiRow] of Array.from(latestByLine.entries())) {
    if (isTintingMap.get(rawLineItemId) !== true) {
      result.skippedNonTinting++;
      continue;
    }
    if (overrideMap.get(rawLineItemId) === true) {
      result.skippedManualOverride++;
      continue;
    }

    const formulaText = buildFormulaText(latestTiRow.shadeName, latestTiRow.samplingNo);
    if (formulaText === null) {
      result.skippedNoText++;
      continue;
    }

    const now = new Date();
    await prisma.delivery_challan_formulas.upsert({
      where: {
        challanId_rawLineItemId: {
          challanId:     challan.id,
          rawLineItemId,
        },
      },
      create: {
        challanId:            challan.id,
        rawLineItemId,
        formula:              formulaText,
        isManuallyOverridden: false,
        autoFilledAt:         now,
        sourceTiEntryId:      latestTiRow.id,
      },
      update: {
        formula:         formulaText,
        autoFilledAt:    now,
        sourceTiEntryId: latestTiRow.id,
        // isManuallyOverridden intentionally untouched — locked rows are
        // already filtered out above; non-locked rows stay non-locked.
      },
    });
    result.upserted++;
  }

  return result;
}
