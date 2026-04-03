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

/* ── Request body shape ────────────────────────────────────── */

interface IngestRequest {
  emailEntryId: string;
  soName: string;
  soEmail?: string;
  receivedAt: string;
  subject: string;
  deliveryRemarks?: string;
  remarks?: string;
  billRemarks?: string;
  lines: Array<{
    rawText: string;
    packCode: string;
    quantity: number;
  }>;
}

/* ── POST handler ──────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  try {
    // 1. Verify HMAC
    const rawBody = await req.text();
    const signature = req.headers.get("x-hmac-signature") ?? "";
    if (!verifyHmac(rawBody, signature)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse JSON
    let body: IngestRequest;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { emailEntryId, soName, soEmail, receivedAt, subject,
            deliveryRemarks, remarks, billRemarks, lines } = body;

    if (!emailEntryId || !soName || !receivedAt || !subject || !Array.isArray(lines)) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // 3. Dedup check
    const existing = await prisma.mo_orders.findUnique({
      where: { emailEntryId },
    });
    if (existing) {
      return NextResponse.json({ status: "duplicate", orderId: existing.id });
    }

    // 4. Load keyword data
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
    }));

    const { byCombo: skuByCombo, byMaterial: skuByMaterial } = buildSkuMaps(skuEntries);

    // 5. Create order
    const order = await prisma.mo_orders.create({
      data: {
        soName,
        soEmail: soEmail ?? null,
        receivedAt: new Date(receivedAt),
        subject,
        deliveryRemarks: deliveryRemarks ?? null,
        remarks: remarks ?? null,
        billRemarks: billRemarks ?? null,
        emailEntryId,
        status: "pending",
        totalLines: lines.length,
        matchedLines: 0,
      },
    });

    // 6. Enrich and insert each line
    let matchedCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const result = enrichLine(
        line.rawText,
        line.packCode,
        productKeywords,
        baseKeywords,
        skuByCombo,
        skuByMaterial,
      );
      if (result.matchStatus === "matched") matchedCount++;

      await prisma.mo_order_lines.create({
        data: {
          moOrderId: order.id,
          lineNumber: i + 1,
          rawText: line.rawText,
          packCode: line.packCode || null,
          quantity: line.quantity,
          productName: result.productName || null,
          baseColour: result.baseColour || null,
          skuCode: result.skuCode || null,
          skuDescription: result.skuDescription || null,
          refSkuCode: result.refSkuCode || null,
          matchStatus: result.matchStatus,
        },
      });
    }

    // 7. Update matched count
    await prisma.mo_orders.update({
      where: { id: order.id },
      data: { matchedLines: matchedCount },
    });

    // 8. Return response
    return NextResponse.json({
      status: "created",
      orderId: order.id,
      totalLines: lines.length,
      matchedLines: matchedCount,
    });
  } catch (err) {
    console.error("[mail-orders/ingest] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
