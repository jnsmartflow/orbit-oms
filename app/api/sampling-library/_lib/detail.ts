import { prisma } from "@/lib/prisma";
import type { PackCode, TinterType } from "@prisma/client";

export interface UsageSummaryRow {
  site:         string | null;
  siteCode:     string | null;
  dealer:       string | null;
  so:           string | null;
  firstUseDate: string | null;
  lastUseDate:  string | null;
  uses:         number;
}

export interface SamplingDetail {
  samplingNo:       string;
  shadeName:        string;
  tinterType:       TinterType;
  siteId:           number | null;
  siteName:         string | null;
  siteNameRaw:      string | null;
  siteMissing:      boolean;
  salesOfficerId:   number | null;
  salesOfficerName: string | null;
  dealerName:       string | null;
  notes:            string | null;
  isActive:         boolean;
  needsReview:      boolean;
  createdBy:        { id: number; name: string };
  createdAt:        string;
  updatedAt:        string;
  recipeCount:      number;
  primaryRecipe:    { skuCode: string; packCode: PackCode } | null;
  lastUsedAt:       string | null;
  totalUsageCount:  number;
  // Aggregates over sampling_usage_log for the multi-dealer/site meta strip
  dealersTotal:     number;
  sitesTotal:       number;
  primaryDealer:    string | null;
  primarySite:      string | null;
  primarySiteMissing: boolean;
  allDealers:       string[];
  allSites:         string[];
  // Per (site, dealer) tuple rollup powering the USED AT table
  usageSummary:     UsageSummaryRow[];
}

/**
 * Fetch + assemble the canonical sampling-library detail response.
 * Returns null when the samplingNo doesn't exist. Sequential awaits
 * (CORE §3 — no prisma.$transaction).
 */
export async function buildSamplingDetail(
  samplingNo: string,
): Promise<SamplingDetail | null> {
  const row = await prisma.sampling_register.findUnique({
    where: { samplingNo },
    include: {
      site:         { select: { customerName: true } },
      salesOfficer: { select: { name: true } },
      createdBy:    { select: { id: true, name: true } },
    },
  });
  if (!row) return null;

  const primaryRecipe = await prisma.sampling_recipes.findFirst({
    where:  { samplingNo, isPrimary: true },
    select: { skuCode: true, packCode: true },
  });

  const agg = await prisma.sampling_recipes.aggregate({
    where:  { samplingNo },
    _sum:   { usageCount: true },
    _max:   { lastUsedAt: true },
    _count: { _all: true },
  });

  // ── Multi-dealer / multi-site aggregates (Issue E) ────────────────────────
  // Sequential awaits per CORE §3 — no prisma.$transaction.
  const dealerDistinct = await prisma.sampling_usage_log.findMany({
    where:    { samplingNo, dealerNameRaw: { not: null } },
    distinct: ["dealerNameRaw"],
    select:   { dealerNameRaw: true },
  });
  const dealersTotal = dealerDistinct.length;

  const siteDistinct = await prisma.sampling_usage_log.findMany({
    where:    { samplingNo, siteNameRaw: { not: null } },
    distinct: ["siteNameRaw"],
    select:   { siteNameRaw: true },
  });
  const sitesTotal = siteDistinct.length;

  // Pick the earliest-ever (dealer, site) pair so the meta strip lines up
  // with the CREATED ON date — "who used this shade first".
  const pairs = await prisma.sampling_usage_log.groupBy({
    by:     ["dealerNameRaw", "siteNameRaw"],
    where:  { samplingNo, dealerNameRaw: { not: null }, siteNameRaw: { not: null } },
    _count: { _all: true },
    _min:   { usageDate: true },
    _max:   { usageDate: true },
    orderBy: { _min: { usageDate: "asc" } },
    take:   1,
  });
  const primaryDealer = pairs[0]?.dealerNameRaw ?? null;
  const primarySite   = pairs[0]?.siteNameRaw   ?? null;

  const dealerGroups = await prisma.sampling_usage_log.groupBy({
    by:      ["dealerNameRaw"],
    where:   { samplingNo, dealerNameRaw: { not: null } },
    _count:  { _all: true },
    orderBy: { _count: { dealerNameRaw: "desc" } },
  });
  const allDealers = dealerGroups
    .map((g) => g.dealerNameRaw)
    .filter((n): n is string => n !== null);

  const siteGroups = await prisma.sampling_usage_log.groupBy({
    by:      ["siteNameRaw"],
    where:   { samplingNo, siteNameRaw: { not: null } },
    _count:  { _all: true },
    orderBy: { _count: { siteNameRaw: "desc" } },
  });
  const allSites = siteGroups
    .map((g) => g.siteNameRaw)
    .filter((n): n is string => n !== null);

  // ── USED AT rollup — one row per distinct (siteNameRaw, dealerNameRaw) ───
  const pairGroups = await prisma.sampling_usage_log.groupBy({
    by:     ["siteNameRaw", "dealerNameRaw"],
    where:  {
      samplingNo,
      OR: [
        { siteNameRaw:   { not: null } },
        { dealerNameRaw: { not: null } },
      ],
    },
    _count:  { _all: true },
    _min:    { usageDate: true },
    _max:    { usageDate: true },
    orderBy: { _count: { siteNameRaw: "desc" } },
  });

  // Resolve each distinct siteNameRaw → delivery_point_master by name
  // (case-insensitive). sampling_usage_log has no siteId column, so we match
  // by customerName the same way the importer did.
  const distinctSiteNames = Array.from(
    new Set(pairGroups.map((g) => g.siteNameRaw).filter((n): n is string => n != null)),
  );
  const masters = distinctSiteNames.length === 0
    ? []
    : await prisma.delivery_point_master.findMany({
        where: {
          OR: distinctSiteNames.map((name) => ({
            customerName: { equals: name, mode: "insensitive" as const },
          })),
        },
        select: {
          id:                true,
          customerCode:      true,
          customerName:      true,
          salesOfficer:      { select: { name: true } },
          salesOfficerGroup: { select: { salesOfficer: { select: { name: true } } } },
        },
      });
  const masterByName = new Map<string, (typeof masters)[number]>();
  for (const m of masters) {
    const key = m.customerName.trim().toLowerCase();
    if (!masterByName.has(key)) masterByName.set(key, m);
  }

  // primarySiteMissing surfaces the amber badge in the meta strip when the
  // first-ever site for this shade has no delivery_point_master match.
  const primarySiteMissing = primarySite !== null
    ? !masterByName.has(primarySite.trim().toLowerCase())
    : false;

  const usageSummary: UsageSummaryRow[] = pairGroups.map((g) => {
    const master = g.siteNameRaw
      ? masterByName.get(g.siteNameRaw.trim().toLowerCase()) ?? null
      : null;
    const so = master
      ? master.salesOfficerGroup?.salesOfficer?.name ?? master.salesOfficer?.name ?? null
      : null;
    return {
      site:         g.siteNameRaw,
      siteCode:     master?.customerCode ?? null,
      dealer:       g.dealerNameRaw,
      so,
      firstUseDate: g._min?.usageDate ? g._min.usageDate.toISOString() : null,
      lastUseDate:  g._max?.usageDate ? g._max.usageDate.toISOString() : null,
      uses:         g._count?._all ?? 0,
    };
  });

  // USED AT ordering: site name asc (case-insensitive + hyphen/space-
  // collapsed for comparison), then uses desc on ties. Null/empty site
  // names sort to the bottom so named sites stay contiguous. SQL ORDER BY
  // on the groupBy is case-sensitive in Postgres, hence the JS re-sort
  // here. row.site itself is never mutated — only the comparison key.
  const normaliseForSort = (s: string): string =>
    s.toLowerCase()
     .replace(/-/g, " ")      // hyphen → space
     .replace(/\s+/g, " ")    // collapse runs of whitespace
     .trim();

  usageSummary.sort((a, b) => {
    const aHas = !!(a.site && a.site.trim() !== "");
    const bHas = !!(b.site && b.site.trim() !== "");
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (!aHas)        return b.uses - a.uses;
    const aKey = normaliseForSort(a.site!);
    const bKey = normaliseForSort(b.site!);
    const cmp  = aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    if (cmp !== 0) return cmp;
    return b.uses - a.uses;
  });

  return {
    samplingNo:       row.samplingNo,
    shadeName:        row.shadeName,
    tinterType:       row.tinterType,
    siteId:           row.siteId,
    siteName:         row.site?.customerName ?? null,
    siteNameRaw:      row.siteNameRaw,
    siteMissing:      row.siteId === null && row.siteNameRaw !== null,
    salesOfficerId:   row.salesOfficerId,
    salesOfficerName: row.salesOfficer?.name ?? null,
    dealerName:       row.dealerName,
    notes:            row.notes,
    isActive:         row.isActive,
    needsReview:      row.needsReview,
    createdBy:        { id: row.createdBy.id, name: row.createdBy.name },
    createdAt:        row.createdAt.toISOString(),
    updatedAt:        row.updatedAt.toISOString(),
    recipeCount:      agg._count?._all ?? 0,
    primaryRecipe:    primaryRecipe
      ? { skuCode: primaryRecipe.skuCode, packCode: primaryRecipe.packCode }
      : null,
    lastUsedAt:       agg._max?.lastUsedAt ? agg._max.lastUsedAt.toISOString() : null,
    totalUsageCount:  agg._sum?.usageCount ?? 0,
    dealersTotal,
    sitesTotal,
    primaryDealer,
    primarySite,
    primarySiteMissing,
    allDealers,
    allSites,
    usageSummary,
  };
}
