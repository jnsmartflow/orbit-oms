import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

// ── Simple CSV parser (no external lib) ───────────────────────────────────────
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
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

function parseBool(val: string): boolean {
  return ["true", "1", "yes", "y"].includes(val.toLowerCase().trim());
}

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const text = await file.text();
  const rows = parseCSV(text);
  if (rows.length === 0) {
    return NextResponse.json({ error: "CSV is empty or missing headers." }, { status: 400 });
  }

  // Pre-load all areas and sub-areas for lookup
  const [allAreas, allSubAreas] = await Promise.all([
    prisma.area_master.findMany({ select: { id: true, name: true } }),
    prisma.sub_area_master.findMany({ select: { id: true, name: true, areaId: true } }),
  ]);

  const areaByName = new Map(allAreas.map((a) => [a.name.toLowerCase(), a]));
  const subAreaByNameAndArea = new Map(
    allSubAreas.map((s) => [`${s.areaId}:${s.name.toLowerCase()}`, s])
  );

  let created = 0;
  let updated = 0;
  const failed: { row: number; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // 1-indexed, +1 for header row

    const customerCode = (row["customercode"] ?? "").trim().toUpperCase();
    const customerName = (row["customername"] ?? "").trim();

    if (!customerCode) {
      failed.push({ row: rowNum, reason: "customerCode is required." });
      continue;
    }
    if (!customerName) {
      failed.push({ row: rowNum, reason: "customerName is required." });
      continue;
    }

    const areaName = (row["areaname"] ?? "").trim().toLowerCase();
    const area = areaByName.get(areaName);
    if (!area) {
      failed.push({ row: rowNum, reason: `Area "${row["areaname"]}" not found.` });
      continue;
    }

    let subAreaId: number | undefined;
    const subAreaName = (row["subareaname"] ?? "").trim().toLowerCase();
    if (subAreaName) {
      const subArea = subAreaByNameAndArea.get(`${area.id}:${subAreaName}`);
      if (!subArea) {
        failed.push({
          row: rowNum,
          reason: `Sub-area "${row["subareaname"]}" not found in area "${row["areaname"]}".`,
        });
        continue;
      }
      subAreaId = subArea.id;
    }

    const isKeyCustomer = parseBool(row["iskeycustomer"] ?? "");
    const isKeySite = parseBool(row["iskeysite"] ?? "");

    try {
      const existing = await prisma.delivery_point_master.findUnique({
        where: { customerCode },
      });

      if (existing) {
        await prisma.delivery_point_master.update({
          where: { customerCode },
          data: { customerName, areaId: area.id, subAreaId: subAreaId ?? null, isKeyCustomer, isKeySite },
        });
        updated++;
      } else {
        await prisma.delivery_point_master.create({
          data: { customerCode, customerName, areaId: area.id, subAreaId: subAreaId ?? null, isKeyCustomer, isKeySite },
        });
        created++;
      }
    } catch (err) {
      failed.push({ row: rowNum, reason: `Database error: ${(err as Error).message}` });
    }
  }

  return NextResponse.json({ created, updated, failed });
}
