import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { TinterType, PackCode } from "@prisma/client";

export const dynamic = "force-dynamic";

// Accepts both display labels ("20L") and enum keys ("L_20") for packCode
const PACK_CODE_MAP: Record<string, PackCode> = {
  "500ml":  PackCode.ml_500,
  "1L":     PackCode.L_1,
  "4L":     PackCode.L_4,
  "10L":    PackCode.L_10,
  "20L":    PackCode.L_20,
  // enum keys (from derivePackCode)
  "ml_500": PackCode.ml_500,
  "L_1":    PackCode.L_1,
  "L_4":    PackCode.L_4,
  "L_10":   PackCode.L_10,
  "L_20":   PackCode.L_20,
};

const ALLOWED_ROLES = [ROLES.TINT_OPERATOR, ROLES.TINT_MANAGER, ROLES.ADMIN];

// ── GET /api/tint/operator/shades ─────────────────────────────────────────────
// Default: ?shipToCustomerId=&tinterType=  → all active shades, sorted by shadeName ASC
// Suggestions: ?shipToCustomerId=&tinterType=&skuCode=&packCode=
//   → matching shades for that SKU line, each with lastUsedAt, sorted by lastUsedAt DESC
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!hasRole(session, ALLOWED_ROLES)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const shipToCustomerId = searchParams.get("shipToCustomerId")?.trim();
  const tinterTypeParam  = searchParams.get("tinterType")?.trim();
  const skuCode          = searchParams.get("skuCode")?.trim() ?? null;
  const packCodeParam    = searchParams.get("packCode")?.trim() ?? null;

  if (!shipToCustomerId) {
    return NextResponse.json({ error: "shipToCustomerId is required" }, { status: 400 });
  }
  if (!tinterTypeParam || !(tinterTypeParam in TinterType)) {
    return NextResponse.json({ error: "tinterType is required and must be TINTER or ACOTONE" }, { status: 400 });
  }

  const tinterType       = tinterTypeParam as TinterType;
  const isSuggestionsMode = skuCode !== null && packCodeParam !== null;

  if (isSuggestionsMode) {
    if (!(packCodeParam in PACK_CODE_MAP)) {
      return NextResponse.json({ error: "Invalid packCode" }, { status: 400 });
    }
    const packCode = PACK_CODE_MAP[packCodeParam];

    const shades = await prisma.shade_master.findMany({
      where: { shipToCustomerId, tinterType, skuCode, packCode, isActive: true },
    });

    // Fetch lastUsedAt for each shade in parallel
    const shadesWithLastUsed = await Promise.all(
      shades.map(async (shade) => {
        let lastUsedAt: Date | null = null;
        if (tinterType === TinterType.TINTER) {
          const result = await prisma.tinter_issue_entries.aggregate({
            _max: { createdAt: true },
            where: { baseSku: shade.baseSku },
          });
          lastUsedAt = result._max.createdAt;
        } else {
          const result = await prisma.tinter_issue_entries_b.aggregate({
            _max: { createdAt: true },
            where: { baseSku: shade.baseSku },
          });
          lastUsedAt = result._max.createdAt;
        }
        return { ...shade, lastUsedAt };
      }),
    );

    // Sort by lastUsedAt DESC — nulls last
    shadesWithLastUsed.sort((a, b) => {
      if (a.lastUsedAt === null && b.lastUsedAt === null) return 0;
      if (a.lastUsedAt === null) return 1;
      if (b.lastUsedAt === null) return -1;
      return b.lastUsedAt.getTime() - a.lastUsedAt.getTime();
    });

    return NextResponse.json({ data: shadesWithLastUsed });
  }

  // Default mode — all active shades for customer + tinterType
  const shades = await prisma.shade_master.findMany({
    where: { shipToCustomerId, tinterType, isActive: true },
    orderBy: { shadeName: "asc" },
  });

  return NextResponse.json({ data: shades });
}

// ── POST /api/tint/operator/shades ────────────────────────────────────────────
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!hasRole(session, ALLOWED_ROLES)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    shadeName, shipToCustomerId, shipToCustomerName, tinterType: tinterTypeRaw,
    packCode: packCodeRaw, skuCode: skuCodeRaw, baseSku, tinQty,
    YOX, LFY, GRN, TBL, WHT, MAG, FFR, BLK, OXR, HEY, HER, COB, COG,
    YE2, YE1, XY1, XR1, WH1, RE2, RE1, OR1, NO2, NO1, MA1, GR1, BU2, BU1,
  } = body as Record<string, unknown>;

  if (!shadeName || typeof shadeName !== "string" || !shadeName.trim()) {
    return NextResponse.json({ error: "shadeName is required" }, { status: 400 });
  }
  if (!shipToCustomerId || typeof shipToCustomerId !== "string") {
    return NextResponse.json({ error: "shipToCustomerId is required" }, { status: 400 });
  }
  if (!shipToCustomerName || typeof shipToCustomerName !== "string") {
    return NextResponse.json({ error: "shipToCustomerName is required" }, { status: 400 });
  }
  if (!tinterTypeRaw || !(tinterTypeRaw as string in TinterType)) {
    return NextResponse.json({ error: "tinterType must be TINTER or ACOTONE" }, { status: 400 });
  }
  if (packCodeRaw !== undefined && packCodeRaw !== null && !(packCodeRaw as string in PACK_CODE_MAP)) {
    return NextResponse.json({ error: "Invalid packCode" }, { status: 400 });
  }
  if (!baseSku || typeof baseSku !== "string") {
    return NextResponse.json({ error: "baseSku is required" }, { status: 400 });
  }

  const tinterType = tinterTypeRaw as TinterType;
  const packCode   = packCodeRaw != null ? PACK_CODE_MAP[packCodeRaw as string] ?? null : null;
  const skuCode    = skuCodeRaw !== undefined && skuCodeRaw !== null ? String(skuCodeRaw).trim() : null;

  // Duplicate check — includes skuCode
  const existing = await prisma.shade_master.findFirst({
    where: {
      shipToCustomerId: String(shipToCustomerId),
      shadeName:        String(shadeName).trim(),
      tinterType,
      packCode:         packCode ?? undefined,
      skuCode:          skuCode ?? undefined,
    },
  });
  if (existing) {
    return NextResponse.json(
      { conflict: true, existingId: existing.id, shadeName: existing.shadeName, skuCode: existing.skuCode },
      { status: 409 },
    );
  }

  const userId = parseInt(session!.user.id, 10);

  const created = await prisma.shade_master.create({
    data: {
      shadeName:          String(shadeName).trim(),
      shipToCustomerId:   String(shipToCustomerId),
      shipToCustomerName: String(shipToCustomerName),
      tinterType,
      packCode,
      skuCode,
      baseSku:            String(baseSku).trim(),
      tinQty:             Number(tinQty ?? 0),
      // TINTER columns
      YOX: Number(YOX ?? 0), LFY: Number(LFY ?? 0), GRN: Number(GRN ?? 0),
      TBL: Number(TBL ?? 0), WHT: Number(WHT ?? 0), MAG: Number(MAG ?? 0),
      FFR: Number(FFR ?? 0), BLK: Number(BLK ?? 0), OXR: Number(OXR ?? 0),
      HEY: Number(HEY ?? 0), HER: Number(HER ?? 0), COB: Number(COB ?? 0),
      COG: Number(COG ?? 0),
      // ACOTONE columns
      YE2: Number(YE2 ?? 0), YE1: Number(YE1 ?? 0), XY1: Number(XY1 ?? 0),
      XR1: Number(XR1 ?? 0), WH1: Number(WH1 ?? 0), RE2: Number(RE2 ?? 0),
      RE1: Number(RE1 ?? 0), OR1: Number(OR1 ?? 0), NO2: Number(NO2 ?? 0),
      NO1: Number(NO1 ?? 0), MA1: Number(MA1 ?? 0), GR1: Number(GR1 ?? 0),
      BU2: Number(BU2 ?? 0), BU1: Number(BU1 ?? 0),
      createdById: userId,
    },
  });

  return NextResponse.json(created, { status: 201 });
}
