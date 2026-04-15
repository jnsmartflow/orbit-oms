import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  enrichLine,
  buildSkuMaps,
  buildProductProfiles,
  buildKeywordRegexes,
  type ProductKeyword,
  type BaseKeyword,
  type SkuEntry,
} from "@/lib/mail-orders/enrich";
import { extractCustomerFromSubject, matchCustomer, parseSubject } from "@/lib/mail-orders/customer-match";
import { matchDeliveryCustomer } from "@/lib/mail-orders/delivery-match";
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
  bodyCustomerName?: string;
  bodyCustomerCode?: string;
  lines: Array<{
    rawText: string;
    packCode: string;
    quantity: number;
    isCarton?: boolean;
    carryProduct?: string | null;
  }>;
  remarkLines?: Array<{
    rawText: string;
    remarkType: string;
    detectedBy: string;
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
            lines, remarkLines } = body;

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
      paintType: r.paintType,
      materialType: r.materialType,
      piecesPerCarton: r.piecesPerCarton ?? null,
    }));

    const { byCombo: skuByCombo, byComboAlt: skuByComboAlt, byMaterial: skuByMaterial } = buildSkuMaps(skuEntries);
    const productProfiles = buildProductProfiles(skuEntries, productKeywords, baseKeywords);
    const { prodRegexMap, baseRegexMap } = buildKeywordRegexes(productKeywords, baseKeywords);

    // 4b. Customer matching — subject first, body fallback
    const subjectParsed = parseSubject(subject);

    // Propagate subject-extracted delivery remarks
    const deliveryFromSubject = subjectParsed.remarks
      .filter(r => r.remarkType === "delivery")
      .map(r => r.text)
      .join("; ");

    // Propagate subject-extracted billing remarks
    const billFromSubject = subjectParsed.remarks
      .filter(r => r.remarkType === "billing")
      .map(r => r.text)
      .join("; ");

    const customerInput = subjectParsed.customerCode
      ? subjectParsed.customerName
        ? `${subjectParsed.customerCode} ${subjectParsed.customerName}`
        : subjectParsed.customerCode
      : subjectParsed.customerName;

    let customerMatch = await matchCustomer(customerInput);

    // Body fallback: if subject matching failed or is weak,
    // try body customer info
    if (
      customerMatch.customerMatchStatus !== "exact" &&
      (body.bodyCustomerCode || body.bodyCustomerName)
    ) {
      const bodyInput = body.bodyCustomerCode
        ? body.bodyCustomerName
          ? `${body.bodyCustomerCode} ${body.bodyCustomerName}`
          : body.bodyCustomerCode
        : body.bodyCustomerName || "";

      if (bodyInput.trim()) {
        const bodyMatch = await matchCustomer(bodyInput);

        // Use body match if it's better than subject match
        if (
          bodyMatch.customerMatchStatus === "exact" ||
          (bodyMatch.customerMatchStatus === "multiple" &&
            customerMatch.customerMatchStatus === "unmatched")
        ) {
          customerMatch = bodyMatch;
          console.log(
            `[Customer Match] Body fallback: "${bodyInput}" → ${bodyMatch.customerMatchStatus}` +
              (bodyMatch.customerCode ? ` (${bodyMatch.customerCode})` : ""),
          );
        }
      }
    }

    // Learned keyword auto-match check
    if (customerMatch.customerMatchStatus !== "exact") {
      let learnedText = subject.trim();
      learnedText = learnedText.replace(/^(?:(?:fw|fwd|re)\s*:\s*)+/i, "").trim();
      learnedText = learnedText.replace(/^urgent\s+/i, "").trim();
      if (/^order\s*:/i.test(learnedText)) {
        learnedText = learnedText.replace(/^order\s*:\s*/i, "").trim();
      } else if (/^order\s+for\s+/i.test(learnedText)) {
        learnedText = learnedText.replace(/^order\s+for\s+/i, "").trim();
      } else if (/^order-\d+\s*/i.test(learnedText)) {
        learnedText = learnedText.replace(/^order-\d+\s*/i, "").trim();
      } else if (/^order\s+-\s*/i.test(learnedText)) {
        learnedText = learnedText.replace(/^order\s+-\s*/i, "").trim();
      } else if (/^order\s+/i.test(learnedText)) {
        learnedText = learnedText.replace(/^order\s+/i, "").trim();
      }
      learnedText = learnedText.replace(/\s*-\s*order$/i, "").trim();
      learnedText = learnedText.replace(/\.+$/, "").trim();
      // Strip customer codes (leading/trailing digits)
      learnedText = learnedText.replace(/^\d{4,}\s+/, "").trim();
      learnedText = learnedText.replace(/\s+\d{4,}$/, "").trim();
      learnedText = learnedText.replace(/\s*\(\d{4,}\)\s*/, " ").trim();
      learnedText = learnedText.toUpperCase().replace(/\s{2,}/g, " ").trim();

      if (learnedText.length >= 3) {
        const learnedRows = await prisma.mo_learned_customers.findMany({
          where: { normalizedText: learnedText },
        });

        if (learnedRows.length > 0) {
          const best = learnedRows.reduce((a, b) =>
            a.hitCount > b.hitCount ? a : b
          );

          let operators: number[] = [];
          try { operators = JSON.parse(best.operators); } catch {}
          const uniqueOps = new Set(operators).size;

          const hasConflict = learnedRows.some(
            (r) => r.customerCode !== best.customerCode && r.hitCount >= 2
          );

          const codeExists = await prisma.mo_customer_keywords.findFirst({
            where: { customerCode: best.customerCode },
          });

          // AUTO-MATCH if all guards pass
          if (
            best.hitCount >= 3 &&
            uniqueOps >= 2 &&
            !hasConflict &&
            codeExists
          ) {
            customerMatch = {
              customerCode: best.customerCode,
              customerName: codeExists.customerName,
              customerMatchStatus: "exact",
              customerCandidates: null,
            };
            console.log(
              `[Customer Match] Learned auto-match: "${learnedText}" → ${best.customerCode} (hit=${best.hitCount}, ops=${uniqueOps})`,
            );
          }
          // BOOST: upgrade unmatched to multiple so operator sees learned candidate
          else if (
            customerMatch.customerMatchStatus === "unmatched" &&
            best.hitCount >= 1 &&
            codeExists
          ) {
            const candidates = learnedRows
              .filter((r) => r.hitCount >= 1)
              .slice(0, 5)
              .map((r) => ({
                code: r.customerCode,
                name: "",
                area: "" as string | null,
                deliveryType: "" as string | null,
                route: "" as string | null,
              }));

            for (const c of candidates) {
              const info = await prisma.mo_customer_keywords.findFirst({
                where: { customerCode: c.code },
              });
              if (info) {
                c.name = info.customerName;
                c.area = info.area;
                c.deliveryType = info.deliveryType;
                c.route = info.route;
              }
            }

            customerMatch = {
              customerCode: null,
              customerName: null,
              customerMatchStatus: "multiple",
              customerCandidates: JSON.stringify(candidates),
            };
            console.log(
              `[Customer Match] Learned boost: "${learnedText}" → showing ${candidates.length} learned candidates`,
            );
          }
        }
      }
    }

    console.log(
      `[Customer Match] "${customerInput}" → ${customerMatch.customerMatchStatus}` +
        (customerMatch.customerCode ? ` (${customerMatch.customerCode})` : "") +
        (subjectParsed.remarks.length > 0
          ? ` | Subject remarks: ${subjectParsed.remarks.map(r => r.text).join(", ")}`
          : ""),
    );

    // 4c. Ship-to override detection from deliveryRemarks
    let finalDeliveryRemarks = deliveryFromSubject
      ? deliveryFromSubject + (deliveryRemarks ? "; " + deliveryRemarks : "")
      : deliveryRemarks ?? null;
    const finalBillRemarks = billFromSubject
      ? billFromSubject + (billRemarks ? "; " + billRemarks : "")
      : billRemarks ?? null;
    let finalShipToOverride = shipToOverride || false;

    if (deliveryRemarks && deliveryRemarks.trim()) {
      const deliveryMatch = await matchDeliveryCustomer(
        deliveryRemarks,
        customerMatch.customerCode,
      );
      if (deliveryMatch && deliveryMatch.isOverride) {
        finalShipToOverride = true;
        finalDeliveryRemarks = `${deliveryRemarks} [→ ${deliveryMatch.customerName} (${deliveryMatch.customerCode})]`;
        console.log(
          `[Ship-To Override] "${deliveryRemarks}" → ${deliveryMatch.customerName} (${deliveryMatch.customerCode})`,
        );
      }
    }

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
        deliveryRemarks: finalDeliveryRemarks,
        remarks: remarks ?? null,
        billRemarks: finalBillRemarks,
        dispatchStatus: dispatchStatus || "Dispatch",
        dispatchPriority: dispatchPriority || "Normal",
        shipToOverride: finalShipToOverride,
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
      const isCarton = line.isCarton ?? false;

      const result = enrichLine(
        line.rawText,
        line.packCode,
        productKeywords,
        baseKeywords,
        skuByCombo,
        skuByMaterial,
        skuByComboAlt,
        productProfiles,
        prodRegexMap,
        baseRegexMap,
        line.carryProduct || null,
      );

      // Carton multiplication
      let finalQty = line.quantity;
      let cartonCount: number | null = null;

      if (isCarton && result.matchStatus === "matched" && result.skuCode) {
        const matchedKey = `${result.productName}|${result.baseColour}|${result.packCode}`;
        const matchedSku = skuByCombo.get(matchedKey);
        if (matchedSku?.piecesPerCarton) {
          cartonCount = line.quantity;
          finalQty = line.quantity * matchedSku.piecesPerCarton;
        } else {
          cartonCount = line.quantity;
        }
      }

      if (result.matchStatus === "matched") matchedCount++;

      await prisma.mo_order_lines.create({
        data: {
          moOrderId: order.id,
          lineNumber: i + 1,
          originalLineNumber: i + 1,
          rawText: line.rawText,
          packCode: result.packCode || line.packCode || null,
          quantity: finalQty,
          productName: result.productName || null,
          baseColour: result.baseColour || null,
          skuCode: result.skuCode || null,
          skuDescription: result.skuDescription || null,
          refSkuCode: result.refSkuCode || null,
          paintType: result.paintType || null,
          materialType: result.materialType || null,
          matchStatus: result.matchStatus,
          isCarton,
          cartonCount,
        },
      });
    }

    // 6b. Check volume for auto-split
    const insertedLines = await prisma.mo_order_lines.findMany({
      where: { moOrderId: order.id },
      orderBy: { lineNumber: "asc" },
      select: { id: true, lineNumber: true, quantity: true, packCode: true, matchStatus: true, productName: true, paintType: true, materialType: true },
    });

    const totalVolume = insertedLines.reduce(
      (sum, l) => sum + getLineVolume(l.quantity, l.packCode), 0,
    );

    // 6b. Store remark lines (if any)
    if (remarkLines && remarkLines.length > 0) {
      let remarkNum = 0;
      for (const rl of remarkLines) {
        if (rl.remarkType === "noise") continue;
        remarkNum++;
        await prisma.mo_order_remarks.create({
          data: {
            moOrderId: order.id,
            lineNumber: remarkNum,
            rawText: rl.rawText,
            remarkType: rl.remarkType,
            detectedBy: rl.detectedBy,
          },
        });
      }
    }

    // 6c. Store subject-extracted remarks
    if (subjectParsed.remarks.length > 0) {
      let subjectRemarkNum = 0;
      for (const sr of subjectParsed.remarks) {
        subjectRemarkNum++;
        await prisma.mo_order_remarks.create({
          data: {
            moOrderId: order.id,
            lineNumber: 900 + subjectRemarkNum,
            rawText: sr.text,
            remarkType: sr.remarkType,
            detectedBy: "subject",
          },
        });
      }
    }

    if (insertedLines.length > 1 && (totalVolume > SPLIT_VOLUME_THRESHOLD || insertedLines.length > SPLIT_LINE_THRESHOLD)) {
      // 6c. Auto-split
      const lineItems = insertedLines.map((l, idx) => ({
        index: idx,
        quantity: l.quantity,
        packCode: l.packCode,
        productName: l.productName,
        paintType: l.paintType,
        materialType: l.materialType,
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
          deliveryRemarks: finalDeliveryRemarks,
          remarks: body.remarks ?? null,
          billRemarks: finalBillRemarks,
          dispatchStatus: body.dispatchStatus || "Dispatch",
          dispatchPriority: body.dispatchPriority || "Normal",
          shipToOverride: finalShipToOverride,
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

      // Store subject remarks for split order B
      if (subjectParsed.remarks.length > 0) {
        let subjectRemarkNumB = 0;
        for (const sr of subjectParsed.remarks) {
          subjectRemarkNumB++;
          await prisma.mo_order_remarks.create({
            data: {
              moOrderId: orderB.id,
              lineNumber: 900 + subjectRemarkNumB,
              rawText: sr.text,
              remarkType: sr.remarkType,
              detectedBy: "subject",
            },
          });
        }
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
