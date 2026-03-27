import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = 'force-dynamic';

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

function parseContacts(
  row: Record<string, string>,
  roleMap: Map<string, { id: number; name: string }>
) {
  const contacts = [];
  for (let n = 1; n <= 3; n++) {
    const name = (row[`contact${n}_name`] ?? "").trim();
    if (!name) continue;
    const phone     = (row[`contact${n}_phone`]     ?? "").trim() || null;
    const roleRaw   = (row[`contact${n}_role`]      ?? "").trim().toLowerCase();
    const isPrimary = parseBool(row[`contact${n}_isprimary`] ?? "false");
    const roleId    = roleMap.get(roleRaw)?.id ?? null;
    contacts.push({ name, phone, isPrimary, contactRoleId: roleId });
  }
  return contacts;
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

  // Pre-load all lookup tables
  const [allAreas, allSubAreas, allRoutes, allDeliveryTypes, allSalesOfficers, allContactRoles, allCustomerTypes, allPremisesTypes] = await Promise.all([
    prisma.area_master.findMany({ select: { id: true, name: true } }),
    prisma.sub_area_master.findMany({ select: { id: true, name: true, areaId: true } }),
    prisma.route_master.findMany({ select: { id: true, name: true } }),
    prisma.delivery_type_master.findMany({ select: { id: true, name: true } }),
    prisma.sales_officer_master.findMany({ select: { id: true, name: true } }),
    prisma.contact_role_master.findMany({ select: { id: true, name: true } }),
    prisma.customer_type_master.findMany({ select: { id: true, name: true } }),
    prisma.premises_type_master.findMany({ select: { id: true, name: true } }),
  ]);

  const areaByName = new Map(allAreas.map((a) => [a.name.toLowerCase(), a]));
  const subAreaByNameAndArea = new Map(
    allSubAreas.map((s) => [`${s.areaId}:${s.name.toLowerCase()}`, s])
  );
  const routeByName        = new Map(allRoutes.map((r) => [r.name.toLowerCase(), r]));
  const deliveryTypeByName = new Map(allDeliveryTypes.map((d) => [d.name.toLowerCase(), d]));
  const salesOfficerByName = new Map(allSalesOfficers.map((s) => [s.name.toLowerCase(), s]));
  const contactRoleByName  = new Map(allContactRoles.map((r) => [r.name.toLowerCase(), r]));
  const customerTypeByName = new Map(allCustomerTypes.map((t) => [t.name.toLowerCase(), t]));
  const premisesTypeByName = new Map(allPremisesTypes.map((t) => [t.name.toLowerCase(), t]));

  let created_count = 0;
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
    const isKeySite     = parseBool(row["iskeysite"] ?? "");

    const ratingRaw = (row["customerrating"] ?? "").trim().toUpperCase();
    const extraFields = {
      address:                (row["address"] ?? "").trim() || null,
      primaryRouteId:         routeByName.get((row["routename"] ?? "").trim().toLowerCase())?.id ?? null,
      dispatchDeliveryTypeId: deliveryTypeByName.get((row["deliverytypename"] ?? "").trim().toLowerCase())?.id ?? null,
      customerTypeId:         customerTypeByName.get((row["customertypename"] ?? "").trim().toLowerCase())?.id ?? null,
      premisesTypeId:         premisesTypeByName.get((row["premisestypename"] ?? "").trim().toLowerCase())?.id ?? null,
      salesOfficerId:         salesOfficerByName.get((row["salesofficername"] ?? "").trim().toLowerCase())?.id ?? null,
      customerRating:         (["A", "B", "C"].includes(ratingRaw) ? ratingRaw : null) as "A" | "B" | "C" | null,
      acceptsPartialDelivery: parseBool(row["acceptspartialdelivery"] ?? "true"),
      isActive:               parseBool(row["isactive"] ?? "true"),
      latitude:               parseFloat(row["latitude"] ?? "") || null,
      longitude:              parseFloat(row["longitude"] ?? "") || null,
      workingHoursStart:      (row["workinghoursstart"] ?? "").trim() || null,
      workingHoursEnd:        (row["workinghoursend"] ?? "").trim() || null,
      noDeliveryDays:         (row["nodeliverydays"] ?? "").trim()
                                ? (row["nodeliverydays"]).trim().split("|").map((d) => d.trim()).filter(Boolean)
                                : [],
    };

    try {
      const existing = await prisma.delivery_point_master.findUnique({
        where: { customerCode },
      });

      let deliveryPointId: number;
      if (existing) {
        await prisma.delivery_point_master.update({
          where: { customerCode },
          data: { customerName, areaId: area.id, subAreaId: subAreaId ?? null, isKeyCustomer, isKeySite, ...extraFields },
        });
        deliveryPointId = existing.id;
        updated++;
      } else {
        const created = await prisma.delivery_point_master.create({
          data: { customerCode, customerName, areaId: area.id, subAreaId: subAreaId ?? null, isKeyCustomer, isKeySite, ...extraFields },
        });
        deliveryPointId = created.id;
        created_count++;
      }

      const contacts = parseContacts(row, contactRoleByName);
      if (contacts.length > 0) {
        await prisma.delivery_point_contacts.deleteMany({
          where: { deliveryPointId },
        });
        await prisma.delivery_point_contacts.createMany({
          data: contacts.map((c) => ({
            deliveryPointId,
            name:          c.name,
            phone:         c.phone,
            isPrimary:     c.isPrimary,
            contactRoleId: c.contactRoleId,
          })),
        });
      }
    } catch (err) {
      failed.push({ row: rowNum, reason: `Database error: ${(err as Error).message}` });
    }
  }

  return NextResponse.json({ created: created_count, updated, failed });
}
