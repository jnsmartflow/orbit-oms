import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Most recent mo_orders row for `customerCode` within the last 30 days,
// with its lines in a normalized shape ready for the Repeat Order action.
//
// Empty result is a valid 200 response with `{ lastOrder: null }` — the
// client renders an empty state, not an error. Many customers will have
// no recent orders (new dealers, code-mismatch with mo_orders.customerCode
// which is set by the parser).
//
// Boxes vs units: mo_order_lines.quantity is in UNITS (parser semantics).
// /place-order cart cells are in BOXES. Conversion happens client-side
// where packStep is already imported (lib/place-order/pack.ts).

export const dynamic = "force-dynamic";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type RecallLine = {
  productName:    string | null;
  baseColour:     string | null;
  packCode:       string | null;
  quantity:       number;
  isCarton:       boolean;
  cartonCount:    number | null;
  skuCode:        string | null;
  skuDescription: string | null;
  matchStatus:    string;
};

type LastOrderResponse = {
  lastOrder: null | {
    moOrderId:  number;
    receivedAt: string;
    soNumber:   string | null;
    lines:      RecallLine[];
  };
};

export async function GET(
  _req: Request,
  { params }: { params: { customerCode: string } },
): Promise<NextResponse<LastOrderResponse>> {
  const customerCode = decodeURIComponent(params.customerCode).trim();
  if (!customerCode) {
    return NextResponse.json({ lastOrder: null });
  }

  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

  // Sequential awaits — no prisma.$transaction (CLAUDE_CORE.md §3).
  const order = await prisma.mo_orders.findFirst({
    where:    { customerCode, receivedAt: { gte: cutoff } },
    orderBy:  { receivedAt: "desc" },
    select: {
      id:         true,
      receivedAt: true,
      soNumber:   true,
    },
  });

  if (!order) {
    return NextResponse.json({ lastOrder: null });
  }

  const lines = await prisma.mo_order_lines.findMany({
    where:   { moOrderId: order.id },
    orderBy: { lineNumber: "asc" },
    select: {
      productName:    true,
      baseColour:     true,
      packCode:       true,
      quantity:       true,
      isCarton:       true,
      cartonCount:    true,
      skuCode:        true,
      skuDescription: true,
      matchStatus:    true,
    },
  });

  return NextResponse.json({
    lastOrder: {
      moOrderId:  order.id,
      receivedAt: order.receivedAt.toISOString(),
      soNumber:   order.soNumber,
      lines:      lines.map((l) => ({
        productName:    l.productName,
        baseColour:     l.baseColour,
        packCode:       l.packCode,
        quantity:       l.quantity,
        isCarton:       l.isCarton,
        cartonCount:    l.cartonCount,
        skuCode:        l.skuCode,
        skuDescription: l.skuDescription,
        matchStatus:    l.matchStatus,
      })),
    },
  });
}
