import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { TinterType, PackCode } from "@prisma/client";

export const dynamic = "force-dynamic";

// Accepts both display labels ("20L") and enum keys ("L_20") for packCode
const PACK_CODE_MAP: Record<string, PackCode> = {
  "500ml":   PackCode.ml_500,
  "0.9L":    PackCode.L_0_9,
  "0.925L":  PackCode.L_0_925,
  "1L":      PackCode.L_1,
  "3.6L":    PackCode.L_3_6,
  "3.7L":    PackCode.L_3_7,
  "4L":      PackCode.L_4,
  "9L":      PackCode.L_9,
  "9.25L":   PackCode.L_9_25,
  "10L":     PackCode.L_10,
  "15L":     PackCode.L_15,
  "18L":     PackCode.L_18,
  "18.5L":   PackCode.L_18_5,
  "20L":     PackCode.L_20,
  "22L":     PackCode.L_22,
  "30L":     PackCode.L_30,
  "40L":     PackCode.L_40,
  // enum keys (from derivePackCode)
  "ml_500":  PackCode.ml_500,
  "L_0_9":   PackCode.L_0_9,
  "L_0_925": PackCode.L_0_925,
  "L_1":     PackCode.L_1,
  "L_3_6":   PackCode.L_3_6,
  "L_3_7":   PackCode.L_3_7,
  "L_4":     PackCode.L_4,
  "L_9":     PackCode.L_9,
  "L_9_25":  PackCode.L_9_25,
  "L_10":    PackCode.L_10,
  "L_15":    PackCode.L_15,
  "L_18":    PackCode.L_18,
  "L_18_5":  PackCode.L_18_5,
  "L_20":    PackCode.L_20,
  "L_22":    PackCode.L_22,
  "L_30":    PackCode.L_30,
  "L_40":    PackCode.L_40,
};

const ALLOWED_ROLES = [ROLES.TINT_OPERATOR, ROLES.TINT_MANAGER, ROLES.ADMIN];

// ── PUT /api/tint/operator/shades/[id] ────────────────────────────────────────
export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!hasRole(session, ALLOWED_ROLES)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = parseInt(params.id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
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

  if (tinterTypeRaw !== undefined && !(tinterTypeRaw as string in TinterType)) {
    return NextResponse.json({ error: "tinterType must be TINTER or ACOTONE" }, { status: 400 });
  }
  if (packCodeRaw !== undefined && packCodeRaw !== null && !(packCodeRaw as string in PACK_CODE_MAP)) {
    return NextResponse.json({ error: "Invalid packCode" }, { status: 400 });
  }

  const existing = await prisma.shade_master.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Shade not found" }, { status: 404 });
  }

  const updated = await prisma.shade_master.update({
    where: { id },
    data: {
      ...(shadeName         !== undefined && { shadeName: String(shadeName).trim() }),
      ...(shipToCustomerId  !== undefined && { shipToCustomerId: String(shipToCustomerId) }),
      ...(shipToCustomerName !== undefined && { shipToCustomerName: String(shipToCustomerName) }),
      ...(tinterTypeRaw     !== undefined && { tinterType: tinterTypeRaw as TinterType }),
      ...(packCodeRaw       !== undefined && { packCode: packCodeRaw != null ? PACK_CODE_MAP[packCodeRaw as string] ?? null : null }),
      ...(skuCodeRaw        !== undefined && { skuCode: skuCodeRaw !== null ? String(skuCodeRaw).trim() : null }),
      ...(baseSku           !== undefined && { baseSku: String(baseSku).trim() }),
      ...(tinQty            !== undefined && { tinQty: Number(tinQty) }),
      // TINTER columns
      ...(YOX !== undefined && { YOX: Number(YOX) }),
      ...(LFY !== undefined && { LFY: Number(LFY) }),
      ...(GRN !== undefined && { GRN: Number(GRN) }),
      ...(TBL !== undefined && { TBL: Number(TBL) }),
      ...(WHT !== undefined && { WHT: Number(WHT) }),
      ...(MAG !== undefined && { MAG: Number(MAG) }),
      ...(FFR !== undefined && { FFR: Number(FFR) }),
      ...(BLK !== undefined && { BLK: Number(BLK) }),
      ...(OXR !== undefined && { OXR: Number(OXR) }),
      ...(HEY !== undefined && { HEY: Number(HEY) }),
      ...(HER !== undefined && { HER: Number(HER) }),
      ...(COB !== undefined && { COB: Number(COB) }),
      ...(COG !== undefined && { COG: Number(COG) }),
      // ACOTONE columns
      ...(YE2 !== undefined && { YE2: Number(YE2) }),
      ...(YE1 !== undefined && { YE1: Number(YE1) }),
      ...(XY1 !== undefined && { XY1: Number(XY1) }),
      ...(XR1 !== undefined && { XR1: Number(XR1) }),
      ...(WH1 !== undefined && { WH1: Number(WH1) }),
      ...(RE2 !== undefined && { RE2: Number(RE2) }),
      ...(RE1 !== undefined && { RE1: Number(RE1) }),
      ...(OR1 !== undefined && { OR1: Number(OR1) }),
      ...(NO2 !== undefined && { NO2: Number(NO2) }),
      ...(NO1 !== undefined && { NO1: Number(NO1) }),
      ...(MA1 !== undefined && { MA1: Number(MA1) }),
      ...(GR1 !== undefined && { GR1: Number(GR1) }),
      ...(BU2 !== undefined && { BU2: Number(BU2) }),
      ...(BU1 !== undefined && { BU1: Number(BU1) }),
    },
  });

  return NextResponse.json(updated);
}
