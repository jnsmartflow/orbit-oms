// Shared per-entry sampling-resolution logic for the TI write paths.
// Phase 4 spec §2.7 — three scenarios:
//   1. NEW sampling  — allocate next_sampling_no, create parent + first recipe
//   2. NEW variant   — create sampling_recipes row under existing samplingNo
//   3. UPDATE variant — last-write-wins on pigment values
//
// Sequential awaits only (CORE §3). P2002 race protection on Scenario 1
// allocation, mirrors createBatchWithRetry in app/api/import/obd/route.ts.

import { Prisma, type PackCode, type TinterType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// IST year prefix (last 2 digits) for next_sampling_no allocation.
export function getIstYearPrefix(): string {
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return String(istNow.getUTCFullYear()).slice(-2);
}

export async function allocateNextSamplingNo(yearPrefix: string): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ next: string }>>`
    SELECT next_sampling_no(${yearPrefix}) AS next
  `;
  const next = rows[0]?.next;
  if (!next) throw new Error("next_sampling_no returned empty");
  return next;
}

export interface ResolveSamplingArgs {
  tinterType:     TinterType;
  bodySamplingNo: string | null;
  bodyShadeName:  string | null;
  baseSku:        string;
  packCode:       PackCode;
  userId:         number;
  siteId:         number | null;
  dealerName:     string | null;
  yearPrefix:     string;
  // Pigment values for the recipe row. Sampling_recipes has all 27 columns,
  // so the caller can pass only the 13 TINTER or 14 ACOTONE codes for its
  // tinterType — the rest default to 0 in the schema.
  pigments:       Record<string, number>;
}

export interface ResolveSamplingResult {
  resolvedSamplingNo: string;
  resolvedShadeName:  string;
  isNewSampling:      boolean;
  isNewVariant:       boolean;
}

/**
 * Throws if `bodySamplingNo` is null and `bodyShadeName` is null too — the
 * caller is responsible for rejecting that combination at validation time.
 * Throws "Sampling number X not found" when the caller supplies a
 * samplingNo that doesn't exist in sampling_register.
 */
export async function resolveSamplingForEntry(
  args: ResolveSamplingArgs,
): Promise<ResolveSamplingResult> {
  const { bodySamplingNo, bodyShadeName, baseSku, packCode, pigments } = args;

  if (bodySamplingNo === null) {
    // ── Scenario 1: NEW sampling ────────────────────────────────────────
    if (bodyShadeName === null) {
      throw new Error("resolveSamplingForEntry: both samplingNo and shadeName are null — validate at the caller");
    }
    const newNo = await createNewSamplingWithRetry({ ...args, shadeName: bodyShadeName });
    return {
      resolvedSamplingNo: newNo,
      resolvedShadeName:  bodyShadeName,
      isNewSampling:      true,
      isNewVariant:       false,
    };
  }

  const parent = await prisma.sampling_register.findUnique({
    where:  { samplingNo: bodySamplingNo },
    select: { samplingNo: true, shadeName: true },
  });
  if (!parent) throw new Error(`Sampling number ${bodySamplingNo} not found`);

  const variant = await prisma.sampling_recipes.findUnique({
    where:  { samplingNo_skuCode_packCode: { samplingNo: bodySamplingNo, skuCode: baseSku, packCode } },
    select: { id: true },
  });

  if (variant) {
    // ── Scenario 3: UPDATE existing variant ───────────────────────────
    await prisma.sampling_recipes.update({
      where: { id: variant.id },
      data:  pigments,
    });
    let resolvedShadeName = parent.shadeName;
    if (bodyShadeName && bodyShadeName !== parent.shadeName) {
      await prisma.sampling_register.update({
        where: { samplingNo: bodySamplingNo },
        data:  { shadeName: bodyShadeName },
      });
      resolvedShadeName = bodyShadeName;
    }
    return {
      resolvedSamplingNo: bodySamplingNo,
      resolvedShadeName,
      isNewSampling:      false,
      isNewVariant:       false,
    };
  }

  // ── Scenario 2: NEW variant under existing samplingNo ───────────────
  await prisma.sampling_recipes.create({
    data: {
      samplingNo: bodySamplingNo,
      skuCode:    baseSku,
      packCode,
      isPrimary:  false,
      usageCount: 0,
      ...pigments,
    },
  });
  return {
    resolvedSamplingNo: bodySamplingNo,
    resolvedShadeName:  bodyShadeName ?? parent.shadeName,
    isNewSampling:      false,
    isNewVariant:       true,
  };
}

interface CreateNewSamplingArgs {
  yearPrefix:  string;
  shadeName:   string;
  userId:      number;
  siteId:      number | null;
  dealerName:  string | null;
  tinterType:  TinterType;
  baseSku:     string;
  packCode:    PackCode;
  pigments:    Record<string, number>;
}

async function createNewSamplingWithRetry(args: CreateNewSamplingArgs): Promise<string> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const samplingNo = await allocateNextSamplingNo(args.yearPrefix);
    try {
      await prisma.sampling_register.create({
        data: {
          samplingNo,
          shadeName:   args.shadeName,
          tinterType:  args.tinterType,
          createdById: args.userId,
          siteId:      args.siteId,
          dealerName:  args.dealerName,
          isActive:    true,
          needsReview: false,
        },
      });
      // Sequential — recipe insert AFTER parent succeeds. Partial-state
      // allowed by spec §4.2 if this throws: parent stays, recipe missing,
      // error propagates to caller.
      await prisma.sampling_recipes.create({
        data: {
          samplingNo,
          skuCode:    args.baseSku,
          packCode:   args.packCode,
          isPrimary:  true,
          usageCount: 0,
          ...args.pigments,
        },
      });
      return samplingNo;
    } catch (err) {
      lastErr = err;
      const isP2002 =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!isP2002 || attempt === 2) throw err;
      // Retry with a fresh next number.
    }
  }
  throw lastErr ?? new Error("Failed to allocate sampling number");
}
