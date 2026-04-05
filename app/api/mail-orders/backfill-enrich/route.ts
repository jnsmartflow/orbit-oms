import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  enrichLine,
  buildSkuMaps,
  type ProductKeyword,
  type BaseKeyword,
  type SkuEntry,
} from "@/lib/mail-orders/enrich";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/* ── HMAC verification ─────────────────────────────────────── */

function verifyHmac(body: string, signature: string): boolean {
  const secret = process.env.MAIL_ORDER_HMAC_SECRET;
  if (!secret) return false;

  const expected = createHmac("sha256", secret).update(body).digest("hex");

  const sigBuf = Buffer.from(signature, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) return false;

  return timingSafeEqual(sigBuf, expBuf);
}

/* ── Match status rank ────────────────────────────────────── */

const STATUS_RANK: Record<string, number> = {
  unmatched: 0,
  partial: 1,
  matched: 2,
};

/* ── Shared backfill logic ─────────────────────────────────── */

async function runBackfill() {
  const [productKeywordsRaw, baseKeywordsRaw, skuEntriesRaw] = await Promise.all([
    prisma.mo_product_keywords.findMany(),
    prisma.mo_base_keywords.findMany(),
    prisma.mo_sku_lookup.findMany(),
  ]);

  const productKeywords: ProductKeyword[] = productKeywordsRaw
    .map((r) => ({ keyword: r.keyword, category: r.category, product: r.product }))
    .sort((a, b) => b.keyword.length - a.keyword.length);

  const baseKeywords: BaseKeyword[] = baseKeywordsRaw
    .map((r) => ({ keyword: r.keyword, category: r.category, baseColour: r.baseColour }))
    .sort((a, b) => b.keyword.length - a.keyword.length);

  const skuEntries: SkuEntry[] = skuEntriesRaw.map((r) => ({
    material: r.material,
    description: r.description,
    category: r.category,
    product: r.product,
    baseColour: r.baseColour,
    packCode: r.packCode,
    unit: r.unit,
    refMaterial: r.refMaterial,
    paintType: r.paintType,
    materialType: r.materialType,
  }));

  const { byCombo: skuByCombo, byMaterial: skuByMaterial } = buildSkuMaps(skuEntries);

  const allLines = await prisma.mo_order_lines.findMany({
    select: {
      id: true,
      rawText: true,
      packCode: true,
      matchStatus: true,
    },
  });

  let updated = 0;
  let alreadyMatched = 0;
  let stillUnmatched = 0;
  const total = allLines.length;

  const BATCH_SIZE = 100;
  for (let i = 0; i < allLines.length; i += BATCH_SIZE) {
    const batch = allLines.slice(i, i + BATCH_SIZE);

    const updates: Promise<unknown>[] = [];
    for (const line of batch) {
      const result = enrichLine(
        line.rawText,
        line.packCode ?? "",
        productKeywords,
        baseKeywords,
        skuByCombo,
        skuByMaterial,
      );

      const oldRank = STATUS_RANK[line.matchStatus] ?? 0;
      const newRank = STATUS_RANK[result.matchStatus] ?? 0;

      if (newRank > oldRank) {
        updates.push(
          prisma.mo_order_lines.update({
            where: { id: line.id },
            data: {
              productName: result.productName || null,
              baseColour: result.baseColour || null,
              skuCode: result.skuCode || null,
              skuDescription: result.skuDescription || null,
              refSkuCode: result.refSkuCode || null,
              paintType: result.paintType || null,
              materialType: result.materialType || null,
              matchStatus: result.matchStatus,
              packCode: result.packCode || line.packCode || null,
            },
          }),
        );
        updated++;
      } else if (line.matchStatus === "matched") {
        alreadyMatched++;
      } else {
        stillUnmatched++;
      }
    }

    await Promise.all(updates);

    if ((i + BATCH_SIZE) % 500 < BATCH_SIZE) {
      console.log(`[Backfill] Processed ${Math.min(i + BATCH_SIZE, total)}/${total} lines (${updated} updated so far)`);
    }
  }

  console.log(`[Backfill] Done: ${total} total, ${updated} updated, ${alreadyMatched} already matched, ${stillUnmatched} still unmatched`);

  return { total, updated, alreadyMatched, stillUnmatched };
}

/* ── POST handler (HMAC-protected) ────────────────────────── */

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-hmac-signature") ?? "";
    if (!verifyHmac(rawBody, signature)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await runBackfill();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[Backfill] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// TEMPORARY — delete after backfill
export async function GET() {
  try {
    const result = await runBackfill();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[Backfill] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
