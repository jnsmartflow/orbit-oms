import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const VALID_REASONS = [
  "out_of_stock",
  "wrong_pack",
  "discontinued",
  "other_depot",
  "other",
] as const;

export async function PATCH(
  req: Request,
  { params }: { params: { lineId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lineId = parseInt(params.lineId, 10);
  if (isNaN(lineId)) {
    return NextResponse.json({ error: "Invalid line ID" }, { status: 400 });
  }

  let body: {
    found: boolean;
    reason?: string;
    altSkuCode?: string;
    altSkuDescription?: string;
    note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.found !== "boolean") {
    return NextResponse.json({ error: "found must be boolean" }, { status: 400 });
  }

  if (body.reason && !(VALID_REASONS as readonly string[]).includes(body.reason)) {
    return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
  }

  const userId = parseInt(session.user.id, 10);

  // If found === true, clear all detail fields
  const data = body.found
    ? {
        found: true,
        reason: null,
        altSkuCode: null,
        altSkuDescription: null,
        note: null,
        updatedBy: userId,
        updatedAt: new Date(),
      }
    : {
        found: body.found,
        reason: body.reason ?? null,
        altSkuCode: body.altSkuCode ?? null,
        altSkuDescription: body.altSkuDescription ?? null,
        note: body.note ?? null,
        updatedBy: userId,
        updatedAt: new Date(),
      };

  const result = await prisma.mo_line_status.upsert({
    where: { lineId },
    create: { lineId, ...data },
    update: data,
    select: {
      found: true,
      reason: true,
      altSkuCode: true,
      altSkuDescription: true,
      note: true,
    },
  });

  return NextResponse.json({ success: true, lineStatus: result });
}
