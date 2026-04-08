import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await prisma.system_config.findMany({
    where: {
      key: {
        in: [
          "slot_morning_cutoff",
          "slot_afternoon_cutoff",
          "slot_evening_cutoff",
        ],
      },
    },
  });

  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  return NextResponse.json({
    morning: map.slot_morning_cutoff ?? "10:30",
    afternoon: map.slot_afternoon_cutoff ?? "12:30",
    evening: map.slot_evening_cutoff ?? "15:30",
  });
}
