import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = 'force-dynamic';

const CONTAINER_TYPES = new Set(["tin", "drum", "carton", "bag"]);

// ── Simple CSV parser ─────────────────────────────────────────────────────────
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; }
    else { current += ch; }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim());
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  });
}

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided." }, { status: 400 });

  const rows = parseCSV(await file.text());
  if (rows.length === 0) {
    return NextResponse.json({ error: "CSV is empty or missing headers." }, { status: 400 });
  }

  let created = 0;
  let updated = 0;
  const failed: { row: number; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const skuCode = (row["skucode"] ?? "").trim().toUpperCase();
    const skuName = (row["skuname"] ?? "").trim();
    const containerType = (row["containertype"] ?? "").trim().toLowerCase();
    const grossWeightStr = (row["grossweightperunit"] ?? "").trim();

    if (!skuCode) { failed.push({ row: rowNum, reason: "skuCode is required." }); continue; }
    if (!skuName) { failed.push({ row: rowNum, reason: "skuName is required." }); continue; }
    if (containerType && !CONTAINER_TYPES.has(containerType)) {
      failed.push({ row: rowNum, reason: `Invalid containerType "${containerType}". Must be: tin, drum, carton, bag.` });
      continue;
    }

    const grossWeightPerUnit = parseFloat(grossWeightStr);
    if (!grossWeightStr || isNaN(grossWeightPerUnit) || grossWeightPerUnit <= 0) {
      failed.push({ row: rowNum, reason: "grossWeightPerUnit must be a positive number." });
      continue;
    }

    const packSize = (row["packsize"] ?? "").trim();
    const unitsPerCartonStr = (row["unitspercarton"] ?? "").trim();
    const unitsPerCarton = unitsPerCartonStr ? parseInt(unitsPerCartonStr, 10) : null;

    try {
      const existing = await prisma.sku_master.findUnique({ where: { skuCode } });
      if (existing) {
        await prisma.sku_master.update({
          where: { skuCode },
          data: {
            skuName,
            packSize,
            ...(containerType && { containerType }),
            unitsPerCarton,
            grossWeightPerUnit,
          },
        });
        updated++;
      } else {
        await prisma.sku_master.create({
          data: {
            skuCode,
            skuName,
            packSize,
            containerType: containerType || "tin",
            unitsPerCarton,
            grossWeightPerUnit,
          },
        });
        created++;
      }
    } catch (err) {
      failed.push({ row: rowNum, reason: `Database error: ${(err as Error).message}` });
    }
  }

  return NextResponse.json({ created, updated, failed });
}
