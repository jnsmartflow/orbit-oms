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
import { extractCustomerFromSubject, matchCustomer } from "@/lib/mail-orders/customer-match";
import { getLineVolume, SPLIT_VOLUME_THRESHOLD, SPLIT_LINE_THRESHOLD, splitLinesByCategory } from "@/lib/mail-orders/utils";

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
  dispatchStatus?: string;
  dispatchPriority?: string;
  shipToOverride?: boolean;
  slotToOverride?: boolean;
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
            deliveryRemarks, remarks, billRemarks,
            dispatchStatus, dispatchPriority, shipToOverride, slotToOverride,
            lines } = body;

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

    // 4b. Customer matching
    const extractedCustomer = extractCustomerFromSubject(subject);
    const customerMatch = await matchCustomer(extractedCustomer);
    console.log(
      `[Customer Match] "${extractedCustomer}" → ${customerMatch.customerMatchStatus}` +
        (customerMatch.customerCode ? ` (${customerMatch.customerCode})` : ""),
    );

    // 5. Create order
    const order = await prisma.mo_orders.create({
      data: {
        soName,
        soEmail: soEmail ?? null,
        receivedAt: new Date(receivedAt),
        subject,
        customerCode: customerMatch.customerCode,
        customerName: customerMatch.customerName,
        customerMatchStatus: customerMatch.customerMatchStatus,
        customerCandidates: customerMatch.customerCandidates,
        deliveryRemarks: deliveryRemarks ?? null,
        remarks: remarks ?? null,
        billRemarks: billRemarks ?? null,
        dispatchStatus: dispatchStatus || "Dispatch",
        dispatchPriority: dispatchPriority || "Normal",
        shipToOverride: shipToOverride || false,
        slotToOverride: slotToOverride || false,
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
          originalLineNumber: i + 1,
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

    // 6b. Check volume for auto-split
    const insertedLines = await prisma.mo_order_lines.findMany({
      where: { moOrderId: order.id },
      orderBy: { lineNumber: "asc" },
      select: { id: true, lineNumber: true, quantity: true, packCode: true, matchStatus: true, productName: true },
    });

    const totalVolume = insertedLines.reduce(
      (sum, l) => sum + getLineVolume(l.quantity, l.packCode), 0,
    );

    if (totalVolume > SPLIT_VOLUME_THRESHOLD || insertedLines.length > SPLIT_LINE_THRESHOLD) {
      // 6c. Auto-split
      const lineItems = insertedLines.map((l, idx) => ({
        index: idx,
        quantity: l.quantity,
        packCode: l.packCode,
        productName: l.productName,
      }));

      const [groupAIndices, groupBIndices] = splitLinesByCategory(lineItems);

      const groupALines = groupAIndices.map((i) => insertedLines[i]);
      const groupBLines = groupBIndices.map((i) => insertedLines[i]);

      const groupAMatched = groupALines.filter((l) => l.matchStatus === "matched").length;
      const groupBMatched = groupBLines.filter((l) => l.matchStatus === "matched").length;

      // Create Group B order (copy all fields from original)
      const orderB = await prisma.mo_orders.create({
        data: {
          soName: body.soName,
          soEmail: body.soEmail ?? null,
          receivedAt: new Date(body.receivedAt),
          subject: body.subject,
          customerName: order.customerName,
          customerCode: order.customerCode,
          customerMatchStatus: order.customerMatchStatus,
          customerCandidates: order.customerCandidates,
          deliveryRemarks: body.deliveryRemarks ?? null,
          remarks: body.remarks ?? null,
          billRemarks: body.billRemarks ?? null,
          dispatchStatus: body.dispatchStatus || "Dispatch",
          dispatchPriority: body.dispatchPriority || "Normal",
          shipToOverride: body.shipToOverride || false,
          slotToOverride: body.slotToOverride || false,
          emailEntryId: `${emailEntryId}__B`,
          status: "pending",
          totalLines: groupBLines.length,
          matchedLines: groupBMatched,
          splitFromId: order.id,
          splitLabel: "B",
        },
      });

      // Update original order to be Group A
      await prisma.mo_orders.update({
        where: { id: order.id },
        data: {
          splitLabel: "A",
          totalLines: groupALines.length,
          matchedLines: groupAMatched,
        },
      });

      // Reassign Group B lines to orderB
      const groupBLineIds = groupBLines.map((l) => l.id);
      await prisma.mo_order_lines.updateMany({
        where: { id: { in: groupBLineIds } },
        data: { moOrderId: orderB.id },
      });

      // Re-number lineNumber sequentially for Group A
      for (let i = 0; i < groupALines.length; i++) {
        await prisma.mo_order_lines.update({
          where: { id: groupALines[i].id },
          data: { lineNumber: i + 1 },
        });
      }

      // Re-number lineNumber sequentially for Group B
      for (let i = 0; i < groupBLines.length; i++) {
        await prisma.mo_order_lines.update({
          where: { id: groupBLines[i].id },
          data: { lineNumber: i + 1 },
        });
      }

      return NextResponse.json({
        status: "created",
        split: true,
        orderA: { id: order.id, totalLines: groupALines.length, matchedLines: groupAMatched },
        orderB: { id: orderB.id, totalLines: groupBLines.length, matchedLines: groupBMatched },
        totalVolume: Math.round(totalVolume),
      });
    }

    // 7. Update matched count (no split needed)
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
