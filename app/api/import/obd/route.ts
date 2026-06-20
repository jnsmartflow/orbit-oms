import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import type { Session } from "next-auth";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";
import { IMPORT_TEMPLATES } from "@/lib/import-templates";
import type { ImportTemplateId } from "@/lib/import-templates";
import type {
  ImportLinePreview,
  ImportObdPreview,
  ImportPreviewResponse,
  ImportConfirmBody,
  ImportConfirmResponse,
} from "@/lib/import-types";
import { upsertObd, resolveSmuFromDivision } from "@/lib/import-upsert";
import type {
  ExistingLine,
  ExistingOrder,
  ExistingSummary,
  ObdInput,
} from "@/lib/import-upsert";
import { parseSapFile, FileFormatError, FileParseError } from "@/lib/sap-parser";

export const dynamic = "force-dynamic";

// ── Private row-shape types (XLS → typed objects) ─────────────────────────────

interface RawHeaderRow {
  "OBD Number"?:            unknown;
  "Status"?:                unknown;
  "SMU"?:                   unknown;
  "SMU Code"?:              unknown;
  "MaterialType"?:          unknown;
  "NatureOfTransaction"?:   unknown;
  "Warehouse"?:             unknown;
  "OBD Email Date"?:        unknown;
  "OBD Email Time"?:        unknown;
  "UnitQty"?:               unknown;
  "GrossWeight"?:           unknown;
  "Volume"?:                unknown;
  "Bill To Customer Id"?:   unknown;
  "Bill To Customer Name"?: unknown;
  "ShipToCustomerId"?:      unknown;
  "Ship To Customer Name"?: unknown;
  "InvoiceNo"?:             unknown;
  "InvoiceDate"?:           unknown;
  "SONum"?:                 unknown;
  [key: string]:            unknown;
}

interface RawLineRow {
  "obd_number"?:      unknown;
  "sku_codes"?:       unknown;
  "sku_description"?: unknown;
  "unit_qty"?:        unknown;
  "volume_line"?:     unknown;
  "Tinting"?:         unknown;
  [key: string]:      unknown;
}

// ── XLSX helpers ──────────────────────────────────────────────────────────────

function parseSheet<T>(workbook: XLSX.WorkBook, sheetName: string): T[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found in file`);
  return XLSX.utils.sheet_to_json<T>(sheet, { raw: true, defval: null });
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

function toInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? Math.round(v) : parseInt(String(v), 10);
  return isNaN(n) ? null : n;
}

function parseDateCell(v: unknown): Date | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    const info = XLSX.SSF.parse_date_code(v);
    if (info) return new Date(info.y, info.m - 1, info.d, info.H, info.M, info.S);
    return null;
  }
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v.trim());
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function parseTimeCell(v: unknown): string | null {
  if (v instanceof Date) {
    const h = String(v.getHours()).padStart(2, "0");
    const m = String(v.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
  if (typeof v === "number") {
    // Excel time fraction: 0–1 represents 0:00–23:59
    const totalMin = Math.round(v * 24 * 60);
    const h = Math.floor(totalMin / 60) % 24;
    const m = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (/^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
  }
  return null;
}

function parseBooleanCell(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number")  return value === 1;
  if (typeof value === "string")  return value.toLowerCase() === "true" || value === "1";
  return false;
}

// ── Slot resolution ───────────────────────────────────────────────────────────

function resolveSlot(
  emailTime: string | null,
): { dispatchSlot: string; slotId: number } {
  // Simple time-based slot assignment — mirrors Mail Orders' receivedAt logic.
  // Fallback to Night (id=4) if emailTime is missing.
  if (!emailTime)                 return { dispatchSlot: "Night",     slotId: 4 };
  if (emailTime < "10:30")        return { dispatchSlot: "Morning",   slotId: 1 };
  if (emailTime < "12:30")        return { dispatchSlot: "Afternoon", slotId: 2 };
  if (emailTime < "15:30")        return { dispatchSlot: "Evening",   slotId: 3 };
  return { dispatchSlot: "Night", slotId: 4 };
}

// ── Merge IST email time into date ───────────────────────────────────────────

function mergeEmailDateTime(emailDate: Date | null, emailTime: string | null): Date | null {
  if (!emailDate || !emailTime) return emailDate;
  const [h, m] = emailTime.split(":").map(Number);
  // Source time is IST (UTC+5:30) — convert to UTC for storage
  const istMinutes = h * 60 + m;
  const utcMinutes = istMinutes - 330; // subtract 5h30m
  const utcH = Math.floor(((utcMinutes % 1440) + 1440) % 1440 / 60);
  const utcM = ((utcMinutes % 60) + 60) % 60;
  const dt = new Date(emailDate);
  dt.setUTCHours(utcH, utcM, 0, 0);
  // If IST time was before 05:30 (e.g. 01:00 IST = previous day 19:30 UTC)
  if (utcMinutes < 0) dt.setUTCDate(dt.getUTCDate() - 1);
  return dt;
}

// ── batchRef generation ───────────────────────────────────────────────────────

async function generateBatchRef(): Promise<string> {
  const now     = new Date();
  const y       = now.getFullYear();
  const mo      = String(now.getMonth() + 1).padStart(2, "0");
  const d       = String(now.getDate()).padStart(2, "0");
  const dateStr = `${y}${mo}${d}`;
  const prefix  = `BATCH-${dateStr}-`;

  // Find highest existing sequence number for today.
  // Using LIKE on batchRef directly (not date-window) so we don't
  // miss batches with createdAt in odd timezones or backdated test data.
  const latest = await prisma.import_batches.findFirst({
    where:   { batchRef: { startsWith: prefix } },
    orderBy: { batchRef: "desc" },
    select:  { batchRef: true },
  });

  let nextSeq = 1;
  if (latest) {
    const tail   = latest.batchRef.slice(prefix.length); // e.g. "047"
    const parsed = parseInt(tail, 10);
    if (!Number.isNaN(parsed)) {
      nextSeq = parsed + 1;
    }
  }

  return `${prefix}${String(nextSeq).padStart(3, "0")}`;
}

/**
 * Create an import_batches row, retrying on P2002 (unique-constraint
 * violation on batchRef) up to maxRetries times. Each retry regenerates
 * a fresh batchRef via generateBatchRef. Used at all three import-path
 * entry points so the same hardening applies to manual-template,
 * manual-sap, and auto-import.
 */
async function createBatchWithRetry(
  data:        Prisma.import_batchesCreateInput,
  maxRetries = 3,
): Promise<{ id: number; batchRef: string }> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const batch = await prisma.import_batches.create({ data });
      return { id: batch.id, batchRef: batch.batchRef };
    } catch (err) {
      const isP2002 =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002";
      if (!isP2002 || attempt === maxRetries - 1) {
        lastErr = err;
        break;
      }
      // Collision — regenerate batchRef and retry.
      data = { ...data, batchRef: await generateBatchRef() };
    }
  }
  throw lastErr;
}

// ── Mail-order enrichment hook ────────────────────────────────────────────────

async function applyMailOrderEnrichment(soNumbers: (string | null)[]): Promise<void> {
  const unique = Array.from(new Set(soNumbers.filter(Boolean))) as string[];
  if (unique.length === 0) return;

  for (const soNum of unique) {
    const mailOrder = await prisma.mo_orders.findFirst({
      where: { soNumber: soNum },
      orderBy: { createdAt: "desc" },
    });
    if (!mailOrder) continue;

    const updateData: Record<string, unknown> = {};

    if (mailOrder.dispatchStatus) {
      updateData.dispatchStatus = mailOrder.dispatchStatus;
    }

    if (mailOrder.dispatchPriority) {
      updateData.priorityLevel = mailOrder.dispatchPriority === "Urgent" ? 1 : 3;
    }

    const remarkParts = [
      mailOrder.deliveryRemarks,
      mailOrder.remarks,
      mailOrder.billRemarks,
    ].filter(Boolean);
    if (remarkParts.length > 0) {
      updateData.remarks = remarkParts.join(" | ");
    }

    if (mailOrder.shipToOverride) {
      updateData.shipToOverride = true;
    }
    if (mailOrder.slotToOverride) {
      updateData.slotToOverride = true;
    }

    // Order date/time enrichment: use mail order receivedAt as the true order time
    if (mailOrder.receivedAt) {
      updateData.orderDateTime = mailOrder.receivedAt;

      // Recalculate slotId from mail order received time (IST)
      // Skip for tint orders — their slot is assigned at tinting completion
      const matchingOrder = await prisma.orders.findFirst({
        where: { soNumber: soNum },
        select: { orderType: true },
      });
      if (matchingOrder?.orderType !== "tint") {
        const istDate = new Date(mailOrder.receivedAt.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
        const h = istDate.getHours();
        const m = istDate.getMinutes();
        const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        const { slotId } = resolveSlot(timeStr);
        updateData.slotId = slotId;
        updateData.originalSlotId = slotId;
      }
    }

    if (Object.keys(updateData).length === 0) continue;

    await prisma.orders.updateMany({
      where: { soNumber: soNum },
      data: updateData,
    });

    console.log(`[mail-order-enrichment] Applied to soNumber=${soNum}`);
  }
}

// ── Effect-firing helpers (consumed by manual-SAP confirm) ───────────────────

/**
 * Create a delivery_challans row for one order. Idempotent: returns silently
 * if the order already has a challan (handles the patch-path case where a
 * challan-create effect re-fires for an order that previously had eligible SMU).
 *
 * Sequence-number reservation: caller pre-computes a baseline from the
 * current max challan number and supplies `nextSeq` as a closure that
 * returns and advances the next reserved number. This eliminates intra-batch
 * collisions (sequential awaits + closure = unique numbers per call).
 *
 * Inter-batch races (two operators confirming simultaneously) are caught
 * via P2002 try/catch with a single re-fetch-and-retry — beyond that we
 * surface the error to the caller's effect-loop, which logs and continues.
 */
async function createChallanForOrder(
  orderId:  number,
  nextSeq:  () => number,
  year:     number,
): Promise<void> {
  const existing = await prisma.delivery_challans.findFirst({
    where:  { orderId },
    select: { id: true },
  });
  if (existing) return;

  const seq = nextSeq();
  const challanNumber = `CHN-${year}-${String(seq).padStart(5, "0")}`;
  try {
    await prisma.delivery_challans.create({
      data: { orderId, challanNumber },
    });
  } catch (err) {
    if ((err as { code?: string }).code !== "P2002") throw err;

    // Inter-batch race: another operator's batch took this number.
    // Re-fetch DB max and retry with the next free seq above it.
    const latest = await prisma.delivery_challans.findFirst({
      orderBy: { id: "desc" },
      select: { challanNumber: true },
    });
    let retrySeq = seq + 1;
    if (latest?.challanNumber) {
      const parts   = latest.challanNumber.split("-");
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) retrySeq = lastNum + 1;
    }
    await prisma.delivery_challans.create({
      data: {
        orderId,
        challanNumber: `CHN-${year}-${String(retrySeq).padStart(5, "0")}`,
      },
    });
  }
}

/**
 * Upsert one row into import_obd_query_summary for an order. Used by the
 * manual-SAP confirm path's effect loop. The `orderId` column is @unique,
 * so this is an upsert — both the create-path (new OBD) and patch-path
 * (existing OBD whose lines changed) callers can use it without branching.
 *
 * Computes totals from the current active import_raw_line_items rows for
 * the order's OBD. Reads the rows here rather than accepting them as an
 * arg so callers don't need to hold them in memory after upsertObd returns.
 */
async function rebuildQuerySummaryForOrder(
  orderId:   number,
  obdNumber: string,
): Promise<void> {
  const lines = await prisma.import_raw_line_items.findMany({
    where:  { obdNumber, lineStatus: "active" },
    select: { unitQty: true, volumeLine: true, isTinting: true, article: true, articleTag: true },
  });

  const summary = await prisma.import_raw_summary.findFirst({
    where:   { obdNumber },
    orderBy: { id: "asc" },
    select:  { grossWeight: true, totalUnitQty: true, volume: true },
  });

  const totalLines   = lines.length;
  const totalUnitQty = lines.reduce((sum, l) => sum + l.unitQty,                 0);
  const totalVolume  = lines.reduce((sum, l) => sum + (l.volumeLine ?? 0),       0);
  const totalArticle = lines.reduce((sum, l) => sum + (l.article ?? 0),          0);
  const hasTinting   = lines.some((l) => l.isTinting);

  // articleTag aggregation: parse "<qty> <type>" pairs and sum by type.
  const tagTotals: Record<string, number> = {};
  for (const l of lines) {
    if (!l.articleTag) continue;
    const parts = l.articleTag.split(" ");
    if (parts.length >= 2) {
      const qty  = parseInt(parts[0], 10);
      const type = parts.slice(1).join(" ");
      if (!isNaN(qty) && type) tagTotals[type] = (tagTotals[type] ?? 0) + qty;
    }
  }
  const typeOrder     = ["Drum", "Bag", "Carton", "Tin"];
  const articleTagStr = typeOrder
    .filter((t) => tagTotals[t] > 0)
    .map((t) => `${tagTotals[t]} ${t}`)
    .join(", ") || null;

  const totalUnitQtyResolved = totalLines > 0 ? totalUnitQty : (summary?.totalUnitQty ?? 0);
  const totalVolumeResolved  = totalLines > 0 ? totalVolume  : (summary?.volume       ?? 0);

  await prisma.import_obd_query_summary.upsert({
    where:  { orderId },
    update: {
      totalLines,
      totalUnitQty: totalUnitQtyResolved,
      totalWeight:  summary?.grossWeight ?? 0,
      totalVolume:  totalVolumeResolved,
      hasTinting,
      totalArticle,
      articleTag:   articleTagStr,
    },
    create: {
      orderId,
      obdNumber,
      totalLines,
      totalUnitQty: totalUnitQtyResolved,
      totalWeight:  summary?.grossWeight ?? 0,
      totalVolume:  totalVolumeResolved,
      hasTinting,
      totalArticle,
      articleTag:   articleTagStr,
    },
  });
}

// ── PREVIEW handler ───────────────────────────────────────────────────────────

async function handlePreview(req: Request, session: Session): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Failed to parse multipart form data" }, { status: 400 });
  }

  // ── Template resolution ───────────────────────────────────────────────────
  const rawTemplateId = formData.get("templateId") as string | null;
  const templateId: ImportTemplateId =
    rawTemplateId && rawTemplateId in IMPORT_TEMPLATES
      ? (rawTemplateId as ImportTemplateId)
      : "two_file_v1";
  const template = IMPORT_TEMPLATES[templateId];

  // ── STEP A — Parse XLS files ─────────────────────────────────────────────
  let headerRows: RawHeaderRow[];
  let lineRows:   RawLineRow[] = [];
  let batchFileName: string;
  let lineFileName  = "";

  if (template.files.combined) {
    // combined_v2: single workbook, two sheets
    const combinedEntry = formData.get("combinedFile");
    if (!(combinedEntry instanceof File)) {
      return NextResponse.json({ error: "combinedFile is required" }, { status: 400 });
    }
    batchFileName = combinedEntry.name;
    try {
      const buf = Buffer.from(await combinedEntry.arrayBuffer());
      const wb  = XLSX.read(buf, { type: "buffer", cellDates: false });
      headerRows = parseSheet<RawHeaderRow>(wb, template.sheets.header);
      if (template.sheets.lineItems) {
        const lineSheet = wb.Sheets[template.sheets.lineItems];
        if (lineSheet) {
          lineRows = XLSX.utils.sheet_to_json<RawLineRow>(lineSheet, { raw: true, defval: null });
        }
      }
    } catch {
      return NextResponse.json(
        { error: "Cannot parse file. Check sheet names." },
        { status: 400 },
      );
    }
  } else {
    // two_file_v1: separate header file + optional line file
    const headerFileEntry = formData.get("headerFile");
    const lineFileEntry   = formData.get("lineFile");
    if (!(headerFileEntry instanceof File)) {
      return NextResponse.json({ error: "headerFile is required" }, { status: 400 });
    }
    batchFileName = headerFileEntry.name;
    try {
      const headerBuf = Buffer.from(await headerFileEntry.arrayBuffer());
      const headerWb  = XLSX.read(headerBuf, { type: "buffer", cellDates: false });
      headerRows = parseSheet<RawHeaderRow>(headerWb, template.sheets.header);
      if (lineFileEntry instanceof File && template.sheets.lineItems) {
        lineFileName = lineFileEntry.name;
        const lineBuf = Buffer.from(await lineFileEntry.arrayBuffer());
        const lineWb  = XLSX.read(lineBuf, { type: "buffer", cellDates: false });
        lineRows = parseSheet<RawLineRow>(lineWb, template.sheets.lineItems);
      }
    } catch {
      return NextResponse.json(
        { error: "Cannot parse file. Check sheet names." },
        { status: 400 },
      );
    }
  }

  if (headerRows.length === 0) {
    return NextResponse.json({ error: "Header file has no data rows" }, { status: 422 });
  }

  // ── STEP B — Validate headers (2 bulk queries, no N+1) ───────────────────
  const allObdNumbers    = headerRows.map((r) => toStr(r["OBD Number"])).filter(Boolean);
  const allCustomerCodes = headerRows.map((r) => toStr(r["ShipToCustomerId"])).filter(Boolean);

  const [existingOrders, existingCustomers] = await Promise.all([
    // NO isRemoved filter — must see soft-removed orders so we can mark a
    // re-imported OBD as "previously_removed" and skip it (no auto-restore).
    prisma.orders.findMany({
      where:  { obdNumber: { in: allObdNumbers } },
      select: { obdNumber: true, isRemoved: true },
    }),
    prisma.delivery_point_master.findMany({
      where:  { customerCode: { in: allCustomerCodes } },
      select: { customerCode: true },
    }),
  ]);

  const existingObdSet  = new Set(existingOrders.map((o) => o.obdNumber));
  const removedObdSet   = new Set(existingOrders.filter((o) => o.isRemoved).map((o) => o.obdNumber));
  const existingCustSet = new Set(existingCustomers.map((c) => c.customerCode));

  // ── STEP C — Validate line items (1 bulk query, skipped if no line file) ──
  let existingSkuSet = new Set<string>();

  if (lineRows.length > 0) {
    const allSkuCodes = lineRows.map((r) => toStr(r["sku_codes"])).filter(Boolean);
    const existingSkus = await prisma.sku_master.findMany({
      where:  { skuCode: { in: allSkuCodes } },
      select: { skuCode: true },
    });
    existingSkuSet = new Set(existingSkus.map((s) => s.skuCode));
  }

  // Group line rows by obdNumber for fast lookup
  const linesByObd = new Map<string, RawLineRow[]>();
  for (const lr of lineRows) {
    const obd = toStr(lr["obd_number"]);
    if (!obd) continue;
    if (!linesByObd.has(obd)) linesByObd.set(obd, []);
    linesByObd.get(obd)!.push(lr);
  }

  // ── STEP D — Generate batchRef ────────────────────────────────────────────
  const batchRef = await generateBatchRef();
  const userId   = parseInt(session.user.id, 10);

  // ── STEP E1 — Create import_batches row (outside any transaction) ─────────
  let batchId: number;
  try {
    const batch = await createBatchWithRetry({
      batchRef,
      importedBy:   { connect: { id: userId } },
      headerFile:   `[${templateId}] ${batchFileName}`,
      lineFile:     lineFileName,
      status:       "processing",
    });
    batchId = batch.id;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create batch" },
      { status: 500 },
    );
  }

  // ── STEP E2 — Build in-memory interims + summaryData array ───────────────

  // Interim line shape (in-memory, before DB IDs are known)
  interface LineInterim {
    lineId:            number;
    skuCodeRaw:        string;
    skuDescriptionRaw: string | null;
    batchCode:         string | null;
    unitQty:           number;
    volumeLine:        number | null;
    isTinting:         boolean;
    article:           number | null;
    articleTag:        string | null;
    rowStatus:         "valid" | "error";
    rowError:          string | null;
  }

  // Interim OBD shape
  interface ObdInterim {
    obdNumber:          string;
    shipToId:           string | null;
    shipToCustomerName: string | null;
    emailDate:          Date | null;
    totalUnitQty:       number | null;
    grossWeight:        number | null;
    rowStatus:          "valid" | "duplicate" | "previously_removed" | "error" | "warning";
    rowError:           string | null;
    lines:              LineInterim[];
  }

  const obdInterims:  ObdInterim[] = [];
  const summaryData: Prisma.import_raw_summaryCreateManyInput[] = [];

  for (const hr of headerRows) {
    const obdNumber = toStr(hr["OBD Number"]);
    if (!obdNumber) continue;

    const shipToId          = toStr(hr["ShipToCustomerId"]) || null;
    const shipToCustomerName = toStr(hr["Ship To Customer Name"]) || null;
    const emailDate         = parseDateCell(hr["OBD Email Date"]);
    const emailTime         = parseTimeCell(hr["OBD Email Time"]);
    const invoiceDate       = parseDateCell(hr["InvoiceDate"]);

    let rowStatus: "valid" | "duplicate" | "previously_removed" | "error" | "warning" = "valid";
    let rowError:  string | null = null;

    if (removedObdSet.has(obdNumber)) {
      // Re-import of an OBD that was previously soft-removed by TM/Admin.
      // Skip silently — do NOT auto-restore. Admin must explicitly restore.
      rowStatus = "previously_removed";
    } else if (existingObdSet.has(obdNumber)) {
      rowStatus = "duplicate";
    } else if (shipToId && !existingCustSet.has(shipToId)) {
      rowStatus = "warning";
      rowError  = `Unknown customer: ${shipToId}`;
    }

    // Build line interims for this OBD
    const obdLines   = linesByObd.get(obdNumber) ?? [];
    const lines: LineInterim[] = obdLines.map((lr, idx) => {
      const skuCodeRaw = toStr(lr["sku_codes"]);
      const lineIdRaw  = idx + 1;
      const unitQty    = toInt(lr["unit_qty"]) ?? 0;
      const volumeLine = toNum(lr["volume_line"]);
      const isTinting  = parseBooleanCell(lr["Tinting"]);
      const article    = lr["article"]     != null ? parseInt(String(lr["article"]), 10)  : null;
      const articleTag = lr["article_tag"] != null ? String(lr["article_tag"]).trim()     : null;

      let lineStatus: "valid" | "error" = "valid";
      let lineError:  string | null     = null;
      if (!skuCodeRaw) {
        lineStatus = "error";
        lineError  = "Missing SKU code";
      } else if (!existingSkuSet.has(skuCodeRaw)) {
        // Warning only — unknown SKUs are enriched with skuId=null (best-effort)
        lineError = `Unknown SKU: ${skuCodeRaw} — manual mapping required`;
      }

      return {
        lineId:            lineIdRaw,
        skuCodeRaw,
        skuDescriptionRaw: toStr(lr["sku_description"]) || null,
        batchCode:         null,
        unitQty,
        volumeLine,
        isTinting,
        article:    isNaN(article as number) ? null : article,
        articleTag: articleTag || null,
        rowStatus:         lineStatus,
        rowError:          lineError,
      };
    });

    obdInterims.push({
      obdNumber, shipToId, shipToCustomerName, emailDate,
      totalUnitQty: toInt(hr["UnitQty"]),
      grossWeight:  toNum(hr["GrossWeight"]),
      rowStatus, rowError, lines,
    });

    summaryData.push({
      batchId,
      obdNumber,
      sapStatus:           toStr(hr["Status"])              || null,
      smu:                 toStr(hr["SMU"])                 || null,
      smuCode:             toStr(hr["SMU Code"])            || null,
      materialType:        toStr(hr["MaterialType"])        || null,
      natureOfTransaction: toStr(hr["NatureOfTransaction"]) || null,
      warehouse:           toStr(hr["Warehouse"])           || null,
      obdEmailDate:        emailDate,
      obdEmailTime:        emailTime,
      totalUnitQty:        toInt(hr["UnitQty"]),
      grossWeight:         toNum(hr["GrossWeight"]),
      volume:              toNum(hr["Volume"]),
      billToCustomerId:    toStr(hr["Bill To Customer Id"])   || null,
      billToCustomerName:  toStr(hr["Bill To Customer Name"]) || null,
      shipToCustomerId:    shipToId,
      shipToCustomerName,
      invoiceNo:           toStr(hr["InvoiceNo"]) || null,
      soNumber:            toStr(hr["SONum"]) || null,
      invoiceDate,
      rowStatus,
      rowError,
    });
  }

  // ── STEP E3 — Bulk insert summaries (1 query) ─────────────────────────────
  try {
    await prisma.import_raw_summary.createMany({ data: summaryData });
  } catch (err) {
    await prisma.import_batches
      .update({ where: { id: batchId }, data: { status: "failed" } })
      .catch(() => undefined);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to write summaries" },
      { status: 500 },
    );
  }

  // ── STEP E4 — Fetch inserted summary IDs ─────────────────────────────────
  const insertedSummaries = await prisma.import_raw_summary.findMany({
    where:  { batchId },
    select: { id: true, obdNumber: true },
  });
  const summaryIdMap = new Map(insertedSummaries.map((s) => [s.obdNumber, s.id]));

  // ── STEP E5 — Bulk insert line items (1 query) ────────────────────────────
  const lineItemData = obdInterims.flatMap((obd) => {
    const rawSummaryId = summaryIdMap.get(obd.obdNumber);
    if (!rawSummaryId) return [];
    return obd.lines.map((line) => ({
      rawSummaryId,
      obdNumber:         obd.obdNumber,
      lineId:            line.lineId,
      skuCodeRaw:        line.skuCodeRaw,
      skuDescriptionRaw: line.skuDescriptionRaw,
      batchCode:         line.batchCode,
      unitQty:           line.unitQty,
      volumeLine:        line.volumeLine,
      isTinting:         line.isTinting,
      article:           line.article,
      articleTag:        line.articleTag,
      rowStatus:         line.rowStatus,
      rowError:          line.rowError,
    }));
  });

  if (lineItemData.length > 0) {
    try {
      await prisma.import_raw_line_items.createMany({ data: lineItemData });
    } catch (err) {
      await prisma.import_batches
        .update({ where: { id: batchId }, data: { status: "failed" } })
        .catch(() => undefined);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to write line items" },
        { status: 500 },
      );
    }
  }

  // ── STEP E6 — Fetch inserted line item IDs (for preview response keys) ────
  const summaryIds = Array.from(summaryIdMap.values());
  const insertedLines = summaryIds.length > 0
    ? await prisma.import_raw_line_items.findMany({
        where:  { rawSummaryId: { in: summaryIds }, lineStatus: "active" },
        select: { id: true, obdNumber: true, lineId: true },
      })
    : [];
  // Key: "obdNumber:lineId" → DB id
  const lineDbIdMap = new Map(
    insertedLines.map((l) => [`${l.obdNumber}:${l.lineId}`, l.id]),
  );

  // ── STEP E7 — Build previewObds from in-memory interims + DB IDs ──────────
  const previewObds: ImportObdPreview[] = obdInterims.map((obd) => {
    const rawSummaryId = summaryIdMap.get(obd.obdNumber) ?? 0;

    const previewLines: ImportLinePreview[] = obd.lines.map((line) => ({
      rawLineItemId:     lineDbIdMap.get(`${obd.obdNumber}:${line.lineId}`) ?? 0,
      lineId:            line.lineId,
      skuCodeRaw:        line.skuCodeRaw,
      skuDescriptionRaw: line.skuDescriptionRaw,
      unitQty:           line.unitQty,
      isTinting:         line.isTinting,
      rowStatus:         line.rowStatus,
      rowError:          line.rowError,
    }));

    const tintLineCount = previewLines.filter((l) => l.isTinting).length;

    return {
      rawSummaryId,
      obdNumber:          obd.obdNumber,
      shipToCustomerId:   obd.shipToId,
      shipToCustomerName: obd.shipToCustomerName,
      obdEmailDate:       obd.emailDate?.toISOString() ?? null,
      totalUnitQty:       obd.totalUnitQty,
      grossWeight:        obd.grossWeight,
      rowStatus:          obd.rowStatus,
      rowError:           obd.rowError,
      lineCount:          previewLines.length,
      tintLineCount,
      orderType:          tintLineCount > 0 ? "tint" : "non_tint",
      lines:              previewLines,
    };
  });

  // ── STEP F — Build summary counts and return ─────────────────────────────
  const validObds              = previewObds.filter((o) => o.rowStatus === "valid").length;
  const duplicateObds          = previewObds.filter((o) => o.rowStatus === "duplicate").length;
  const previouslyRemovedObds  = previewObds.filter((o) => o.rowStatus === "previously_removed").length;
  const errorObds              = previewObds.filter((o) => o.rowStatus === "error").length;
  const warningObds            = previewObds.filter((o) => o.rowStatus === "warning").length;
  const allLines      = previewObds.flatMap((o) => o.lines);
  const validLines    = allLines.filter((l) => l.rowStatus === "valid").length;
  const errorLines    = allLines.filter((l) => l.rowStatus === "error").length;

  const payload: ImportPreviewResponse = {
    batchId,
    batchRef,
    summary: {
      totalObds:             previewObds.length,
      validObds,
      duplicateObds,
      previouslyRemovedObds,
      errorObds,
      warningObds,
      totalLines:            allLines.length,
      validLines,
      errorLines,
    },
    obds: previewObds,
  };

  return NextResponse.json(payload);
}

// ── CONFIRM handler ───────────────────────────────────────────────────────────

async function handleConfirm(req: Request, session: Session): Promise<NextResponse> {
  let body: ImportConfirmBody;
  try {
    body = (await req.json()) as ImportConfirmBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { batchId, confirmedObdIds } = body;
  if (!batchId || !Array.isArray(confirmedObdIds) || confirmedObdIds.length === 0) {
    return NextResponse.json({ error: "batchId and confirmedObdIds are required" }, { status: 400 });
  }

  const userId = parseInt(session.user.id, 10);

  // ── STEP A — Load batch and confirmed raw rows ────────────────────────────
  const batch = await prisma.import_batches.findUnique({ where: { id: batchId } });
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }
  if (batch.status === "completed") {
    return NextResponse.json({ error: "Batch already confirmed" }, { status: 409 });
  }

  const rawSummaries = await prisma.import_raw_summary.findMany({
    where: {
      id:        { in: confirmedObdIds },
      batchId,
      // Whitelist insertable rowStatuses. Excludes "duplicate" and the new
      // "previously_removed" (re-imported soft-removed OBDs — admin restore required).
      rowStatus: { in: ["valid", "warning"] },
    },
    include: {
      rawLineItems: {
        where: { lineStatus: "active" },
        select: {
          id:         true,
          obdNumber:  true,
          lineId:     true,
          skuCodeRaw: true,
          unitQty:    true,
          volumeLine: true,
          isTinting:  true,
          article:    true,
          articleTag: true,
          rowStatus:  true,
        },
      },
    },
  });

  // ── STEP B — Bulk preload for enrichment (no N+1) ────────────────────────
  const allCustomerCodes = rawSummaries
    .map((s) => s.shipToCustomerId)
    .filter((c): c is string => c !== null);

  const allSkuCodes = rawSummaries
    .flatMap((s) => s.rawLineItems)
    .map((l) => l.skuCodeRaw)
    .filter((c): c is string => Boolean(c));

  const [customers, skus] = await Promise.all([
    prisma.delivery_point_master.findMany({
      where:  { customerCode: { in: allCustomerCodes } },
      select: {
        id:                     true,
        customerCode:           true,
        isKeyCustomer:          true,
        isKeySite:              true,
        dispatchDeliveryTypeId: true,
        area: { select: { deliveryTypeId: true } },
      },
    }),
    prisma.sku_master.findMany({
      where:  { skuCode: { in: allSkuCodes } },
      select: { id: true, skuCode: true },
    }),
  ]);

  const customerByCode = new Map(customers.map((c) => [c.customerCode, c]));
  const skuByCode      = new Map(skus.map((s) => [s.skuCode, s]));

  // ── STEP C — Build all data arrays in memory ─────────────────────────────

  // Per-summary interim: computed fields needed for multiple insert arrays
  interface OrderInterim {
    obdNumber:           string;
    orderType:           string;
    workflowStage:       string;
    hasTinting:          boolean;
    validLines:          typeof rawSummaries[0]["rawLineItems"];
    totalLineQty:        number;
    totalVolume:         number;
    // order row data (minus id)
    orderData:           Prisma.ordersCreateManyInput;
  }

  const orderInterims: OrderInterim[] = [];

  for (const summary of rawSummaries) {
    const customer = summary.shipToCustomerId
      ? (customerByCode.get(summary.shipToCustomerId) ?? null)
      : null;

    const emailDateTime = mergeEmailDateTime(summary.obdEmailDate, summary.obdEmailTime);

    const validLines    = summary.rawLineItems; // already filtered to rowStatus=valid
    const hasTinting    = validLines.some((l) => l.isTinting);
    const orderType     = hasTinting ? "tint" : "non_tint";
    const workflowStage = orderType === "tint"
      ? "pending_tint_assignment"
      : "pending_support";

    // Tint orders: slot assigned at tinting completion, not import
    const { dispatchSlot, slotId } = orderType === "tint"
      ? { dispatchSlot: null as string | null, slotId: null as number | null }
      : resolveSlot(summary.obdEmailTime);

    const priorityLevel = (customer?.isKeyCustomer || customer?.isKeySite) ? 1 : 3;

    // Pre-compute line totals (include all lines, even unknown SKUs)
    let totalLineQty = 0;
    let totalVolume  = 0;
    for (const line of validLines) {
      totalLineQty += line.unitQty;
      totalVolume  += line.volumeLine ?? 0;
    }

    orderInterims.push({
      obdNumber: summary.obdNumber,
      orderType,
      workflowStage,
      hasTinting,
      validLines,
      totalLineQty,
      totalVolume,
      orderData: {
        obdNumber:           summary.obdNumber,
        batchId:             batch.id,
        customerId:          customer?.id ?? null,
        shipToCustomerId:    summary.shipToCustomerId ?? summary.obdNumber,
        shipToCustomerName:  summary.shipToCustomerName,
        orderType,
        workflowStage,
        dispatchSlot,
        slotId,
        originalSlotId:      slotId,
        priorityLevel,
        invoiceNo:           summary.invoiceNo,
        soNumber:            summary.soNumber,
        invoiceDate:         summary.invoiceDate,
        obdEmailDate:        emailDateTime,
        orderDateTime:       emailDateTime,
        smu:                 summary.smu,
        sapStatus:           summary.sapStatus,
        materialType:        summary.materialType,
        natureOfTransaction: summary.natureOfTransaction,
        warehouse:           summary.warehouse,
        totalUnitQty:        summary.totalUnitQty,
        grossWeight:         summary.grossWeight,
        volume:              summary.volume,
        customerMissing:     summary.rowStatus === "warning",
      },
    });
  }

  // ── STEP D1 — Bulk create orders ──────────────────────────────────────────
  const confirmedObdNumbers = orderInterims.map((o) => o.obdNumber);
  let ordersCreated = 0;
  let linesEnriched = 0;

  try {
    await prisma.orders.createMany({
      data: orderInterims.map((o) => o.orderData),
    });
    ordersCreated = orderInterims.length;
  } catch (err) {
    await prisma.import_batches
      .update({ where: { id: batchId }, data: { status: "failed" } })
      .catch(() => undefined);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create orders" },
      { status: 500 },
    );
  }

  // ── STEP D1b — Mail-order enrichment hook ─────────────────────────────────
  await applyMailOrderEnrichment(orderInterims.map((o) => o.orderData.soNumber ?? null));

  // ── STEP D2 — Fetch inserted order IDs ───────────────────────────────────
  const insertedOrders = await prisma.orders.findMany({
    where:  { obdNumber: { in: confirmedObdNumbers }, batchId: batch.id },
    select: { id: true, obdNumber: true },
  });
  const orderIdMap = new Map(insertedOrders.map((o) => [o.obdNumber, o.id]));

  // ── STEP D2b — Auto-create delivery challans ────────────────────────────
  {
    const CHALLAN_SMU_VALUES = ["Retail Offtake", "Decorative Projects"];

    // Find which orders need challans (by SMU from raw summary)
    const challanOrders = orderInterims
      .filter((o) => {
        const summary = rawSummaries.find((s) => s.obdNumber === o.obdNumber);
        const smu = summary?.smu ?? "";
        return CHALLAN_SMU_VALUES.includes(smu);
      })
      .map((o) => ({
        orderId: orderIdMap.get(o.obdNumber) ?? 0,
        obdNumber: o.obdNumber,
        orderDateTime: o.orderData.orderDateTime,
      }))
      .filter((o) => o.orderId > 0)
      .sort((a, b) => {
        const tA = a.orderDateTime ? new Date(a.orderDateTime as Date).getTime() : 0;
        const tB = b.orderDateTime ? new Date(b.orderDateTime as Date).getTime() : 0;
        return tA - tB;
      });

    if (challanOrders.length > 0) {
      try {
        // Get current max challan number
        const lastChallan = await prisma.delivery_challans.findFirst({
          orderBy: { id: "desc" },
          select: { challanNumber: true },
        });

        let nextSeq = 1;
        if (lastChallan?.challanNumber) {
          const parts = lastChallan.challanNumber.split("-");
          const lastNum = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(lastNum)) nextSeq = lastNum + 1;
        }

        const year = new Date().getFullYear();

        for (const co of challanOrders) {
          const challanNumber = `CHN-${year}-${String(nextSeq).padStart(5, "0")}`;
          await prisma.delivery_challans.create({
            data: {
              orderId: co.orderId,
              challanNumber,
            },
          });
          nextSeq++;
        }

        console.log(`[import] Auto-created ${challanOrders.length} delivery challan(s)`);
      } catch (err) {
        // Non-fatal — log but don't fail the import
        console.error("[import] Challan auto-creation failed:", err);
      }
    }
  }

  // ── STEP D3 — Bulk create import_obd_query_summary ───────────────────────
  const querySummaryData: Prisma.import_obd_query_summaryCreateManyInput[] =
    orderInterims.map((o) => {
      const orderId  = orderIdMap.get(o.obdNumber) ?? 0;
      const hasLines = o.validLines.length > 0;
      // find matching rawSummary for fallback totals
      const rs = rawSummaries.find((s) => s.obdNumber === o.obdNumber);

      // Sum total articles across all valid lines
      const totalArticle = o.validLines.reduce((sum, l) => sum + (l.article ?? 0), 0);

      // Group by tag type and sum — e.g. "30 Drum, 2 Carton, 1 Tin"
      const tagTotals: Record<string, number> = {};
      for (const l of o.validLines) {
        if (!l.articleTag) continue;
        // Parse tag parts — each part is like "30 Drum" or "1 Carton" or "2 Tin"
        const parts = l.articleTag.split(' ');
        if (parts.length >= 2) {
          const qty  = parseInt(parts[0], 10);
          const type = parts.slice(1).join(' ');  // handles "Carton" and "Tin"
          if (!isNaN(qty) && type) {
            tagTotals[type] = (tagTotals[type] ?? 0) + qty;
          }
        }
      }
      // Build summary string in order: Drum → Bag → Carton → Tin
      const typeOrder = ['Drum', 'Bag', 'Carton', 'Tin'];
      const articleTagStr = typeOrder
        .filter(t => tagTotals[t] > 0)
        .map(t => `${tagTotals[t]} ${t}`)
        .join(', ') || null;

      return {
        obdNumber:    o.obdNumber,
        orderId,
        totalLines:   o.validLines.length,
        totalUnitQty: hasLines ? o.totalLineQty : (rs?.totalUnitQty ?? 0),
        totalWeight:  rs?.grossWeight ?? 0,
        totalVolume:  hasLines ? o.totalVolume  : (rs?.volume ?? 0),
        hasTinting:   o.hasTinting,
        totalArticle,
        articleTag:   articleTagStr,
      };
    });

  try {
    await prisma.import_obd_query_summary.createMany({ data: querySummaryData });
  } catch (err) {
    await prisma.import_batches
      .update({ where: { id: batchId }, data: { status: "failed" } })
      .catch(() => undefined);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create query summaries" },
      { status: 500 },
    );
  }

  // ── STEP D4 — Bulk create order_status_logs ───────────────────────────────
  const statusLogData: Prisma.order_status_logsCreateManyInput[] =
    orderInterims.map((o) => ({
      orderId:     orderIdMap.get(o.obdNumber) ?? 0,
      fromStage:   null,
      toStage:     o.workflowStage,
      changedById: userId,
      note:        `Created via import batch ${batch.batchRef}`,
    }));

  try {
    await prisma.order_status_logs.createMany({ data: statusLogData });
  } catch (err) {
    await prisma.import_batches
      .update({ where: { id: batchId }, data: { status: "failed" } })
      .catch(() => undefined);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create status logs" },
      { status: 500 },
    );
  }

  // ── STEP D5 — Bulk create import_enriched_line_items ─────────────────────
  // Best-effort enrichment: unknown SKUs get skuId=null rather than being skipped.
  // NOTE: lineWeight stored as 0 — sku_master.grossWeightPerUnit not yet in schema
  const enrichedData: Prisma.import_enriched_line_itemsCreateManyInput[] = [];
  for (const o of orderInterims) {
    for (const line of o.validLines) {
      const sku = skuByCode.get(line.skuCodeRaw);
      enrichedData.push({
        rawLineItemId: line.id,
        skuId:         sku?.id ?? null,
        unitQty:       line.unitQty,
        volumeLine:    line.volumeLine,
        lineWeight:    sku ? 0 : null,
        isTinting:     line.isTinting,
        note:          sku ? null : "Unknown SKU — manual mapping required",
      });
      linesEnriched++;
    }
  }

  if (enrichedData.length > 0) {
    try {
      await prisma.import_enriched_line_items.createMany({ data: enrichedData });
    } catch (err) {
      await prisma.import_batches
        .update({ where: { id: batchId }, data: { status: "failed" } })
        .catch(() => undefined);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to enrich line items" },
        { status: 500 },
      );
    }
  }

  // ── STEP D6 — Update import_batches status ────────────────────────────────
  const allBatchRows = await prisma.import_raw_summary.findMany({
    where:  { batchId },
    select: { rowStatus: true },
  });
  const skippedObds = allBatchRows.filter((s) => s.rowStatus === "duplicate").length;
  const failedObds  = allBatchRows.filter((s) => s.rowStatus === "error").length;

  await prisma.import_batches
    .update({
      where: { id: batchId },
      data: {
        status:     "completed",
        totalObds:  confirmedObdIds.length,
        skippedObds,
        failedObds,
      },
    })
    .catch(() => undefined);

  // ── Step 4B — Shadow upsertObd in dry-run mode (no behaviour change) ─────
  // Gated by IMPORT_SHADOW_MODE env var, default off. Outer try/catch ensures
  // shadow can never crash the confirm response. Duplicates were filtered
  // at preview (rowStatus="duplicate" excluded from rawSummaries) — shadow
  // covers only created/errored OBDs; the duplicate count is recorded in
  // metadata.batchDuplicatesSkipped for context.
  await runManualTemplateShadow({
    rawSummaries,
    confirmedObdNumbers,
    batchDuplicatesSkipped: skippedObds,
    batchId,
    batchRef:               batch.batchRef,
    userId,
  });

  // ── STEP F — Return ImportConfirmResponse ─────────────────────────────────
  const result: ImportConfirmResponse = {
    success:       true,
    batchId:       batch.id,
    batchRef:      batch.batchRef,
    ordersCreated,
    linesEnriched,
  };

  return NextResponse.json(result);
}

// ── MANUAL-SAP PREVIEW handler ────────────────────────────────────────────────
//
// Step 7 — first endpoint of the manual-SAP path. Pure read + classify.
// Operator uploads a SAP OBT export XLSX; this handler parses it, classifies
// each parsed OBD as new / patch / skipped / error against current DB state,
// and returns the per-OBD outcome list to the UI for review. NO live writes.
//
// Auth: handled by the action router (session + import_obd canImport).
// Feature flag: SAP_IMPORT_ENABLED must be the literal "true".

const MANUAL_SAP_MAX_BYTES = 10 * 1024 * 1024; // 10MB

async function handleManualSapPreview(_req: Request, _session: Session): Promise<NextResponse> {
  if (process.env.SAP_IMPORT_ENABLED !== "true") {
    return NextResponse.json(
      { ok: false, error: "SAP import path not enabled in this environment" },
      { status: 503 },
    );
  }

  const parsed = await parseManualSapForm(_req);
  if (parsed.kind === "error") return parsed.response;
  const { fileName, buffer, fallbackObdEmailDate } = parsed;

  let parseResult;
  try {
    parseResult = parseSapFile(buffer, { fallbackObdEmailDate });
  } catch (err) {
    if (err instanceof FileParseError || err instanceof FileFormatError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    throw err;
  }

  const obdNumbers = parseResult.obds.map((o) => o.obdNumber);
  const shipToIds  = parseResult.obds
    .map((o) => o.shipToCustomerId)
    .filter((c): c is string => c !== null && c !== "");
  const skuCodes = Array.from(new Set(
    parseResult.obds.flatMap((o) => o.lines.map((l) => l.skuCodeRaw)).filter(Boolean),
  ));

  const [existingOrders, existingCustomers, existingSkus] = await Promise.all([
    obdNumbers.length > 0
      ? prisma.orders.findMany({
          where:  { obdNumber: { in: obdNumbers } },
          select: { obdNumber: true },
        })
      : Promise.resolve([] as { obdNumber: string }[]),
    shipToIds.length > 0
      ? prisma.delivery_point_master.findMany({
          where:  { customerCode: { in: shipToIds } },
          select: { customerCode: true },
        })
      : Promise.resolve([] as { customerCode: string }[]),
    skuCodes.length > 0
      ? prisma.sku_master.findMany({
          where:  { skuCode: { in: skuCodes } },
          select: { skuCode: true },
        })
      : Promise.resolve([] as { skuCode: string }[]),
  ]);

  const existingObdSet  = new Set(existingOrders.map((o) => o.obdNumber));
  const existingCustSet = new Set(existingCustomers.map((c) => c.customerCode));
  const existingSkuSet  = new Set(existingSkus.map((s) => s.skuCode));

  // Group warnings by delivery for per-OBD `issues[]` annotation.
  const warningsByObd = new Map<string, string[]>();
  for (const w of parseResult.warnings) {
    if (!w.delivery) continue;
    if (!warningsByObd.has(w.delivery)) warningsByObd.set(w.delivery, []);
    // Strip the trailing "Future: …" suffix on duplicate-sku-summed for compact display.
    const compact = w.message.replace(/\. Future:.*$/, "");
    warningsByObd.get(w.delivery)!.push(`${w.kind}: ${compact}`);
  }

  type PreviewObd = {
    obdNumber:    string;
    outcome:      "new" | "patch" | "skipped" | "error";
    lineCount:    number;
    totalUnitQty: number;
    issues:       string[];
  };

  const obdEntries: PreviewObd[] = [];

  // Created (non-skipped) OBDs.
  for (const o of parseResult.obds) {
    const issues: string[] = warningsByObd.get(o.obdNumber) ?? [];
    if (o.shipToCustomerId && !existingCustSet.has(o.shipToCustomerId)) {
      issues.push(`unknown customer code: ${o.shipToCustomerId}`);
    }
    if (!o.division || !resolveSmuFromDivision(o.division).smu) {
      issues.push(`unmapped SMU division: ${o.division ?? "(none)"}`);
    }
    for (const line of o.lines) {
      if (!existingSkuSet.has(line.skuCodeRaw)) {
        issues.push(`unknown SKU: ${line.skuCodeRaw}`);
      }
    }
    obdEntries.push({
      obdNumber:    o.obdNumber,
      outcome:      existingObdSet.has(o.obdNumber) ? "patch" : "new",
      lineCount:    o.lines.length,
      totalUnitQty: o.totalUnitQty ?? 0,
      issues,
    });
  }

  // Skipped OBDs (parser-level skip rules).
  for (const s of parseResult.skipped) {
    const issues = warningsByObd.get(s.delivery) ?? [];
    issues.unshift(`skip-reason: ${s.reason} (rows ${s.rowNumbers.join(",")})`);
    obdEntries.push({
      obdNumber:    s.delivery,
      outcome:      "skipped",
      lineCount:    0,
      totalUnitQty: 0,
      issues,
    });
  }

  const summary = {
    newOBDs:     obdEntries.filter((o) => o.outcome === "new").length,
    patchOBDs:   obdEntries.filter((o) => o.outcome === "patch").length,
    skippedOBDs: obdEntries.filter((o) => o.outcome === "skipped").length,
    errorOBDs:   obdEntries.filter((o) => o.outcome === "error").length,
  };

  return NextResponse.json({
    ok:        true,
    filename:  fileName,
    fileStats: parseResult.fileStats,
    summary,
    obds:      obdEntries,
    warnings:  parseResult.warnings,
  });
}

// ── MANUAL-SAP CONFIRM handler ────────────────────────────────────────────────
//
// Step 7 — second endpoint. Re-parses the uploaded file, calls upsertObd per
// OBD via the bulk-preloaded existing state, fires downstream effects, and
// writes one import_batches row tagged "[manual-sap]". Audit per-OBD lives
// in order_status_logs via lib/import-upsert/audit.ts.

async function handleManualSapConfirm(_req: Request, session: Session): Promise<NextResponse> {
  if (process.env.SAP_IMPORT_ENABLED !== "true") {
    return NextResponse.json(
      { ok: false, error: "SAP import path not enabled in this environment" },
      { status: 503 },
    );
  }

  const parsedForm = await parseManualSapForm(_req);
  if (parsedForm.kind === "error") return parsedForm.response;
  const { fileName, buffer, fallbackObdEmailDate, dateStr } = parsedForm;

  let parseResult;
  try {
    parseResult = parseSapFile(buffer, { fallbackObdEmailDate });
  } catch (err) {
    if (err instanceof FileParseError || err instanceof FileFormatError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    throw err;
  }

  const userId = parseInt(session.user.id, 10);
  if (isNaN(userId)) {
    return NextResponse.json({ ok: false, error: "Invalid session user id" }, { status: 500 });
  }

  // Create batch row (P2002-safe via createBatchWithRetry).
  const batchRef = await generateBatchRef();
  const batch = await createBatchWithRetry({
    batchRef,
    importedBy:   { connect: { id: userId } },
    headerFile:   `[manual-sap] ${fileName} (obdEmailDate: ${dateStr})`,
    lineFile:     "",
    status:       "processing",
  });
  const batchId = batch.id;

  try {
    const obdNumbers = parseResult.obds.map((o) => o.obdNumber);

    // Bulk preload for upsertObd injection.
    const [shadowOrders, shadowSummaries, shadowCustomers] = await Promise.all([
      obdNumbers.length > 0
        ? prisma.orders.findMany({
            where: { obdNumber: { in: obdNumbers } },
            select: {
              id: true, obdNumber: true, customerId: true, shipToCustomerName: true,
              customerMissing: true, orderType: true, workflowStage: true, slotId: true,
              invoiceNo: true, invoiceDate: true, soNumber: true,
              obdEmailDate: true, orderDateTime: true, smu: true, sapStatus: true,
              materialType: true, natureOfTransaction: true, warehouse: true,
              totalUnitQty: true, grossWeight: true, volume: true,
            },
          })
        : Promise.resolve([] as Array<ExistingOrder & { obdNumber: string }>),
      obdNumbers.length > 0
        ? prisma.import_raw_summary.findMany({
            where:   { obdNumber: { in: obdNumbers } },
            orderBy: { id: "asc" },
            select:  { id: true, obdNumber: true, obdEmailTime: true, smuCode: true },
          })
        : Promise.resolve([] as Array<{ id: number; obdNumber: string; obdEmailTime: string | null; smuCode: string | null }>),
      prisma.delivery_point_master.findMany({
        where:  { customerCode: { in: parseResult.obds.map((o) => o.shipToCustomerId).filter((c): c is string => c !== null && c !== "") } },
        select: { id: true, customerCode: true },
      }),
    ]);

    const orderByObd = new Map<string, ExistingOrder>();
    for (const o of shadowOrders) {
      const { obdNumber, ...existing } = o;
      orderByObd.set(obdNumber, existing as ExistingOrder);
    }

    const summaryByObd = new Map<string, ExistingSummary>();
    for (const s of shadowSummaries) {
      if (!summaryByObd.has(s.obdNumber)) {
        summaryByObd.set(s.obdNumber, { id: s.id, obdEmailTime: s.obdEmailTime, smuCode: s.smuCode });
      }
    }

    const summaryIds = Array.from(summaryByObd.values()).map((s) => s.id);
    const shadowLines = summaryIds.length > 0
      ? await prisma.import_raw_line_items.findMany({
          where:  { rawSummaryId: { in: summaryIds } }, // no lineStatus filter — patch logic needs to see soft-removed
          select: {
            id: true, rawSummaryId: true, lineId: true, skuCodeRaw: true,
            unitQty: true, volumeLine: true, isTinting: true, lineStatus: true,
          },
        })
      : [];

    const linesBySummaryId = new Map<number, ExistingLine[]>();
    for (const l of shadowLines) {
      if (!linesBySummaryId.has(l.rawSummaryId)) linesBySummaryId.set(l.rawSummaryId, []);
      linesBySummaryId.get(l.rawSummaryId)!.push(l as ExistingLine);
    }

    const customerIdByCode = new Map(shadowCustomers.map((c) => [c.customerCode, c.id]));

    // Per-OBD upsert loop.
    const now = new Date();
    type Counter = { created: number; patched: number; unchanged: number; errored: number };
    const counters: Counter = { created: 0, patched: 0, unchanged: 0, errored: 0 };
    const errors: Array<{ obdNumber: string; message: string }> = [];

    type ResultEntry = { obdNumber: string; outcome: string; orderId: number | null; effects: import("@/lib/import-upsert").DownstreamEffect[] };
    const results: ResultEntry[] = [];

    for (const input of parseResult.obds) {
      const existingOrder   = orderByObd.get(input.obdNumber) ?? null;
      const existingSummary = summaryByObd.get(input.obdNumber) ?? null;
      const existingLines   = existingSummary
        ? (linesBySummaryId.get(existingSummary.id) ?? [])
        : [];
      const customerId      = input.shipToCustomerId
        ? (customerIdByCode.get(input.shipToCustomerId) ?? null)
        : null;

      const r = await upsertObd(
        input, "manual-sap", batchId, batchRef, userId, now,
        { dryRun: false, preloaded: { order: existingOrder, summary: existingSummary, lines: existingLines, customerId } },
      );

      counters[r.outcome] += 1;
      if (r.outcome === "errored" && r.errors.length > 0) {
        errors.push({ obdNumber: r.obdNumber, message: r.errors.join(" | ") });
      }
      results.push({ obdNumber: r.obdNumber, outcome: r.outcome, orderId: r.orderId, effects: r.effects });
    }

    // Reserve a challan-number range from the current DB max, once.
    const challanEffectCount = results.reduce(
      (acc, r) => acc + r.effects.filter((e) => e.type === "challan-create").length,
      0,
    );
    let nextChallanSeq = 1;
    if (challanEffectCount > 0) {
      const lastChallan = await prisma.delivery_challans.findFirst({
        orderBy: { id: "desc" },
        select: { challanNumber: true },
      });
      if (lastChallan?.challanNumber) {
        const parts   = lastChallan.challanNumber.split("-");
        const lastNum = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(lastNum)) nextChallanSeq = lastNum + 1;
      }
    }
    const challanYear = new Date().getFullYear();
    const nextSeqClosure = (): number => nextChallanSeq++;

    // Effect dispatch — sequential, per OBD, every effect wrapped in try/catch.
    for (const r of results) {
      if (r.outcome === "errored") continue;
      for (const eff of r.effects) {
        try {
          switch (eff.type) {
            case "mail-order-enrichment":
              await applyMailOrderEnrichment([eff.payload.soNumber as string]);
              break;
            case "challan-create":
              await createChallanForOrder(eff.orderId, nextSeqClosure, challanYear);
              break;
            case "query-summary-rebuild":
              await rebuildQuerySummaryForOrder(
                eff.orderId,
                String(eff.payload.obdNumber ?? r.obdNumber),
              );
              break;
            case "customer-resolved":
              console.log("[manual-sap] customer-resolved effect", eff);
              break;
            case "order-type-mismatch":
              console.log("[manual-sap] order-type-mismatch effect", eff);
              break;
            default: {
              // TODO: implement when slot-recalc effect is emitted (currently buildEffects does not)
              console.log("[manual-sap] slot-recalc effect (no-op)", eff);
            }
          }
        } catch (effErr) {
          console.error("[manual-sap] effect failed", { type: eff.type, orderId: eff.orderId }, effErr);
        }
      }
    }

    // Update batch status.
    // - totalObds   = parser-skipped + (created + patched + unchanged + errored)
    // - skippedObds = parser-skipped only (unchanged is a no-op patch, not a skip)
    // - failedObds  = errored only
    await prisma.import_batches
      .update({
        where: { id: batchId },
        data: {
          status:      "completed",
          totalObds:   parseResult.skipped.length + results.length,
          skippedObds: parseResult.skipped.length,
          failedObds:  counters.errored,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({
      ok:       true,
      batchId,
      batchRef,
      summary:  counters,
      errors,
    });
  } catch (err) {
    await prisma.import_batches
      .update({ where: { id: batchId }, data: { status: "failed" } })
      .catch(() => undefined);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Manual-SAP confirm failed" },
      { status: 500 },
    );
  }
}

// ── Manual-SAP form parsing helper (shared by preview + confirm) ─────────────

type ParsedManualSapForm =
  | {
      kind:                 "ok";
      fileName:             string;
      buffer:               Buffer;
      fallbackObdEmailDate: Date;
      dateStr:              string;
    }
  | { kind: "error"; response: NextResponse };

async function parseManualSapForm(req: Request): Promise<ParsedManualSapForm> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return { kind: "error", response: NextResponse.json(
      { ok: false, error: "Failed to parse multipart form data" }, { status: 400 },
    )};
  }

  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File)) {
    return { kind: "error", response: NextResponse.json(
      { ok: false, error: "file is required" }, { status: 400 },
    )};
  }
  if (fileEntry.size > MANUAL_SAP_MAX_BYTES) {
    return { kind: "error", response: NextResponse.json(
      { ok: false, error: "File too large (max 10MB)" }, { status: 400 },
    )};
  }
  if (!fileEntry.name.toLowerCase().endsWith(".xlsx")) {
    return { kind: "error", response: NextResponse.json(
      { ok: false, error: "Only .xlsx files accepted" }, { status: 400 },
    )};
  }

  const dateStr = formData.get("obdEmailDate");
  if (typeof dateStr !== "string" || dateStr.trim() === "") {
    return { kind: "error", response: NextResponse.json(
      { ok: false, error: "obdEmailDate is required" }, { status: 400 },
    )};
  }
  const fallbackObdEmailDate = new Date(dateStr.trim());
  if (isNaN(fallbackObdEmailDate.getTime())) {
    return { kind: "error", response: NextResponse.json(
      { ok: false, error: "obdEmailDate is not a valid date" }, { status: 400 },
    )};
  }

  const buffer = Buffer.from(await fileEntry.arrayBuffer());

  return {
    kind: "ok",
    fileName: fileEntry.name,
    buffer,
    fallbackObdEmailDate,
    dateStr: dateStr.trim(),
  };
}

// ── HMAC verification ─────────────────────────────────────────────────────────

function verifyHmacSignature(req: Request): boolean {
  const secret = process.env.IMPORT_HMAC_SECRET;
  if (!secret) return false;

  const keyId = req.headers.get("x-import-key-id");
  const sig   = req.headers.get("x-import-signature");

  if (keyId !== "auto-import-v1") return false;
  if (!sig) return false;

  const expectedSig = createHmac("sha256", secret)
    .update("auto-import-v1")
    .digest("hex");

  try {
    const expectedBuf = Buffer.from(expectedSig, "utf8");
    const actualBuf   = Buffer.from(sig,          "utf8");
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

// ── Shadow-mode runner (Step 4B — manual-template confirm only) ─────────────
//
// Runs upsertObd in dryRun=true mode for every OBD just confirmed via the
// manual-template handler, comparing what handleConfirm actually wrote vs
// what upsertObd would have written. Output goes to import_shadow_log with
// source = "manual-template".
//
// Gated by IMPORT_SHADOW_MODE env var (same flag as Step 4A — one flip
// enables both shadow paths). Default-OFF: only runs when the env var is
// the literal string "true". Outer try/catch ensures this can never affect
// the confirm response.
//
// Differences from Step 4A:
// - Duplicates are filtered at preview (rowStatus="duplicate" excluded from
//   `rawSummaries` at line 671). Shadow only iterates OBDs that confirm
//   actually attempted to write — created or errored. Skipped is impossible.
//   `metadata.batchDuplicatesSkipped` records the preview-time duplicate
//   count for context.
// - `existingOrder` will reflect the row that confirm just wrote (created
//   moments ago). upsertObd's dryRun will therefore take the patch path
//   and report `unchanged` (success — confirm wrote what upsertObd would
//   have written) or `patched` (divergence — investigate). Per-field
//   divergence detail is recorded in `metadata.noteworthy`.
async function runManualTemplateShadow(args: {
  rawSummaries:        Array<{
    id:                  number;
    obdNumber:           string;
    sapStatus:           string | null;
    smu:                 string | null;
    smuCode:             string | null;
    materialType:        string | null;
    natureOfTransaction: string | null;
    warehouse:           string | null;
    obdEmailDate:        Date | null;
    obdEmailTime:        string | null;
    totalUnitQty:        number | null;
    grossWeight:         number | null;
    volume:              number | null;
    billToCustomerId:    string | null;
    billToCustomerName:  string | null;
    shipToCustomerId:    string | null;
    shipToCustomerName:  string | null;
    invoiceNo:           string | null;
    invoiceDate:         Date | null;
    soNumber:            string | null;
    rowStatus:           string;
    rawLineItems:        Array<{
      id:         number;
      obdNumber:  string;
      lineId:     number;
      skuCodeRaw: string;
      unitQty:    number;
      volumeLine: number | null;
      isTinting:  boolean;
      article:    number | null;
      articleTag: string | null;
      rowStatus:  string;
    }>;
  }>;
  confirmedObdNumbers:    string[];
  batchDuplicatesSkipped: number;
  batchId:                number;
  batchRef:               string;
  userId:                 number;
}): Promise<void> {
  if (process.env.IMPORT_SHADOW_MODE !== "true") return;

  try {
    const { rawSummaries, confirmedObdNumbers, batchDuplicatesSkipped,
            batchId, batchRef, userId } = args;

    const obdNumbers = rawSummaries.map((s) => s.obdNumber);
    if (obdNumbers.length === 0) return;

    // Bulk preload (3 reads). The orders rows we just created live in DB now;
    // upsertObd will see them and route to the patch path under dryRun.
    const [shadowOrders, shadowFullLines, shadowCustomers] = await Promise.all([
      prisma.orders.findMany({
        where: { obdNumber: { in: obdNumbers } },
        select: {
          id: true, obdNumber: true, customerId: true, shipToCustomerName: true,
          customerMissing: true, orderType: true, workflowStage: true, slotId: true,
          invoiceNo: true, invoiceDate: true, soNumber: true,
          obdEmailDate: true, orderDateTime: true, smu: true, sapStatus: true,
          materialType: true, natureOfTransaction: true, warehouse: true,
          totalUnitQty: true, grossWeight: true, volume: true,
        },
      }),
      // Re-fetch raw_line_items with full ExistingLine shape (the in-scope
      // include from handleConfirm has a narrower select). NO lineStatus
      // filter — shadow needs to see soft-removed too.
      prisma.import_raw_line_items.findMany({
        where: { rawSummaryId: { in: rawSummaries.map((s) => s.id) } },
        select: {
          id: true, rawSummaryId: true, lineId: true, skuCodeRaw: true,
          unitQty: true, volumeLine: true, isTinting: true, lineStatus: true,
        },
      }),
      prisma.delivery_point_master.findMany({
        where:  { customerCode: { in: rawSummaries.map((s) => s.shipToCustomerId).filter((c): c is string => c !== null) } },
        select: { id: true, customerCode: true },
      }),
    ]);

    const orderByObd = new Map<string, ExistingOrder>();
    for (const o of shadowOrders) {
      const { obdNumber, ...existing } = o;
      orderByObd.set(obdNumber, existing as ExistingOrder);
    }

    const linesBySummaryId = new Map<number, ExistingLine[]>();
    for (const l of shadowFullLines) {
      if (!linesBySummaryId.has(l.rawSummaryId)) linesBySummaryId.set(l.rawSummaryId, []);
      linesBySummaryId.get(l.rawSummaryId)!.push(l as ExistingLine);
    }

    const customerIdByCode = new Map(shadowCustomers.map((c) => [c.customerCode, c.id]));
    const confirmedSet     = new Set(confirmedObdNumbers);
    const now              = new Date();

    for (const summary of rawSummaries) {
      const obdNumber = summary.obdNumber;

      let actualOutcome: "created" | "errored";
      if (confirmedSet.has(obdNumber)) actualOutcome = "created";
      else if (summary.rowStatus === "error") actualOutcome = "errored";
      else continue; // unrecognised — defensive skip (duplicates already filtered upstream)

      try {
        const input = summaryToObdInput(summary);
        const existingOrder   = orderByObd.get(obdNumber) ?? null;
        const existingSummary: ExistingSummary = {
          id:           summary.id,
          obdEmailTime: summary.obdEmailTime,
          smuCode:      summary.smuCode,
        };
        const existingLines = linesBySummaryId.get(summary.id) ?? [];
        const customerId    = input.shipToCustomerId
          ? (customerIdByCode.get(input.shipToCustomerId) ?? null)
          : null;

        const result = await upsertObd(
          input, "manual-template", batchId, batchRef, userId, now,
          { dryRun: true, preloaded: { order: existingOrder, summary: existingSummary, lines: existingLines, customerId } },
        );

        const divisionResolved = resolveSmuFromDivision(summary.smuCode);
        const noteworthy: string[] = [];

        // Per-adjustment 2: list each diverged field in noteworthy when shadow
        // would patch. Header field divergences carry actual=oldValue and
        // shadow=newValue. Line-level divergences reuse the audit-formatted
        // detail (minus the [type] prefix).
        if (result.outcome === "patched") {
          for (const change of result.applied) {
            if (change.type === "header_patched" || change.type === "header_overwritten") {
              noteworthy.push(`divergence: ${change.field} actual=${fmtForNoteworthy(change.oldValue)} shadow=${fmtForNoteworthy(change.newValue)}`);
            } else {
              const detail = change.note.replace(/^\[[^\]]+\] /, "");
              noteworthy.push(`divergence: ${detail}`);
            }
          }
        }

        if (summary.smu && divisionResolved.smu && summary.smu !== divisionResolved.smu) {
          noteworthy.push("smu_mismatch_file_vs_map");
        }
        if (!summary.smuCode || !divisionResolved.smu) {
          noteworthy.push("division_unmapped");
        }
        if (result.errors.length > 0) noteworthy.push("shadow_errors_present");

        const decision = {
          actualHeader: existingOrder,
          actualLines:  existingLines,
          incomingHeader: {
            obdNumber:           input.obdNumber,
            division:            input.division,
            sapStatus:           input.sapStatus,
            materialType:        input.materialType,
            natureOfTransaction: input.natureOfTransaction,
            warehouse:           input.warehouse,
            obdEmailDate:        input.obdEmailDate,
            obdEmailTime:        input.obdEmailTime,
            totalUnitQty:        input.totalUnitQty,
            grossWeight:         input.grossWeight,
            volume:              input.volume,
            billToCustomerId:    input.billToCustomerId,
            billToCustomerName:  input.billToCustomerName,
            shipToCustomerId:    input.shipToCustomerId,
            shipToCustomerName:  input.shipToCustomerName,
            invoiceNo:           input.invoiceNo,
            invoiceDate:         input.invoiceDate,
            soNumber:            input.soNumber,
          },
          incomingLines:        input.lines,
          shadowAppliedChanges: result.applied,
          shadowEffects:        result.effects,
          metadata: {
            smuFromFile:            summary.smu,
            smuFromMap:             divisionResolved.smu,
            batchDuplicatesSkipped,
            noteworthy,
          },
        };

        await prisma.import_shadow_log.create({
          data: {
            batchId,
            obdNumber,
            source:        "manual-template",
            actualOutcome,
            shadowOutcome: result.outcome,
            decision:      decision as unknown as Prisma.InputJsonValue,
            errors:        result.errors.length > 0 ? result.errors.join(" | ") : null,
          },
        });
      } catch (err) {
        console.error(`[SHADOW] manual-template OBD ${obdNumber} failed:`, err);
      }
    }
  } catch (outer) {
    console.error("[SHADOW] runManualTemplateShadow outer failure:", outer);
  }
}

/**
 * Format a value for inclusion in a noteworthy divergence string.
 * Mirrors lib/import-upsert/helpers fmt() but lives here to keep the
 * route file self-contained — same rules: Date → ISO, string → quoted,
 * null/undefined → literal "null".
 */
function fmtForNoteworthy(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (v instanceof Date)              return v.toISOString();
  if (typeof v === "string")          return JSON.stringify(v);
  return String(v);
}

/**
 * Convert the in-memory `rawSummaries[i]` shape (with included rawLineItems)
 * from handleConfirm into the ObdInput shape consumed by upsertObd. Sister
 * helper to headerRowToObdInput; both are internal, neither exported.
 *
 * `division` is populated from `summary.smuCode` so resolveSmuFromDivision
 * can map back to a label and surface mismatches against the operator-typed
 * `summary.smu` via metadata.noteworthy.
 *
 * `skuDescriptionRaw` and `batchCode` are not in the in-scope rawLineItems
 * select and are passed as null. patchLines treats nulls as "no opinion"
 * for non-authoritative sources, so this does not cause spurious divergence.
 */
function summaryToObdInput(summary: {
  obdNumber:           string;
  smu:                 string | null;
  smuCode:             string | null;
  sapStatus:           string | null;
  materialType:        string | null;
  natureOfTransaction: string | null;
  warehouse:           string | null;
  obdEmailDate:        Date | null;
  obdEmailTime:        string | null;
  totalUnitQty:        number | null;
  grossWeight:         number | null;
  volume:              number | null;
  billToCustomerId:    string | null;
  billToCustomerName:  string | null;
  shipToCustomerId:    string | null;
  shipToCustomerName:  string | null;
  invoiceNo:           string | null;
  invoiceDate:         Date | null;
  soNumber:            string | null;
  rawLineItems:        Array<{
    lineId:     number;
    skuCodeRaw: string;
    unitQty:    number;
    volumeLine: number | null;
    isTinting:  boolean;
    article:    number | null;
    articleTag: string | null;
  }>;
}): ObdInput {
  return {
    obdNumber:           summary.obdNumber,
    division:            summary.smuCode,
    sapStatus:           summary.sapStatus,
    materialType:        summary.materialType,
    natureOfTransaction: summary.natureOfTransaction,
    warehouse:           summary.warehouse,
    obdEmailDate:        summary.obdEmailDate,
    obdEmailTime:        summary.obdEmailTime,
    totalUnitQty:        summary.totalUnitQty,
    grossWeight:         summary.grossWeight,
    volume:              summary.volume,
    billToCustomerId:    summary.billToCustomerId,
    billToCustomerName:  summary.billToCustomerName,
    shipToCustomerId:    summary.shipToCustomerId,
    shipToCustomerName:  summary.shipToCustomerName,
    invoiceNo:           summary.invoiceNo,
    invoiceDate:         summary.invoiceDate,
    soNumber:            summary.soNumber,
    lines: summary.rawLineItems.map((l) => ({
      lineId:            l.lineId,
      skuCodeRaw:        l.skuCodeRaw,
      skuDescriptionRaw: null,
      batchCode:         null,
      unitQty:           l.unitQty,
      volumeLine:        l.volumeLine,
      isTinting:         l.isTinting,
      article:           l.article,
      articleTag:        l.articleTag,
    })),
  };
}

// ── Shadow-mode runner (Step 4A — auto-import only) ─────────────────────────
//
// Runs upsertObd in dryRun=true mode for every OBD seen in this auto-import
// run, after the existing handler has finished its real writes. Captures a
// "decision log" comparing what auto-import actually did vs what upsertObd
// would have done. Output goes to import_shadow_log.
//
// Gated by IMPORT_SHADOW_MODE env var. Default-OFF: only runs when set to
// the literal string "true". Outer try/catch ensures this can never crash
// the auto-import response.
//
// Pre-loads existing orders / summaries / lines / customers in 4 bulk reads
// up-front (mirrors the existingObdSet pattern around line 1102) so the
// shadow loop doesn't fan out to per-OBD reads inside upsertObd.
async function runAutoImportShadow(args: {
  headerRows:          RawHeaderRow[];
  lineRows:            RawLineRow[];
  existingObdSet:      Set<string>;
  confirmedObdNumbers: string[];
  errorObdNumbers:     string[];
  batchId:             number;
  batchRef:            string;
}): Promise<void> {
  if (process.env.IMPORT_SHADOW_MODE !== "true") return;

  try {
    const { headerRows, lineRows, existingObdSet,
            confirmedObdNumbers, errorObdNumbers, batchId, batchRef } = args;

    const confirmedSet = new Set(confirmedObdNumbers);
    const errorSet     = new Set(errorObdNumbers);
    const allObdNumbers = headerRows.map((r) => toStr(r["OBD Number"])).filter(Boolean);
    if (allObdNumbers.length === 0) return;

    // Bulk preload (4 reads, one per table).
    const [shadowOrders, shadowSummaries, shadowCustomers] = await Promise.all([
      prisma.orders.findMany({
        where: { obdNumber: { in: allObdNumbers } },
        select: {
          id: true, obdNumber: true, customerId: true, shipToCustomerName: true,
          customerMissing: true, orderType: true, workflowStage: true, slotId: true,
          invoiceNo: true, invoiceDate: true, soNumber: true,
          obdEmailDate: true, orderDateTime: true, smu: true, sapStatus: true,
          materialType: true, natureOfTransaction: true, warehouse: true,
          totalUnitQty: true, grossWeight: true, volume: true,
        },
      }),
      prisma.import_raw_summary.findMany({
        where:   { obdNumber: { in: allObdNumbers } },
        orderBy: { id: "asc" },
        select:  { id: true, obdNumber: true, obdEmailTime: true, smuCode: true },
      }),
      prisma.delivery_point_master.findMany({
        where:  { customerCode: { in: headerRows.map((r) => toStr(r["ShipToCustomerId"])).filter(Boolean) } },
        select: { id: true, customerCode: true },
      }),
    ]);

    const orderByObd = new Map<string, ExistingOrder>();
    for (const o of shadowOrders) {
      const { obdNumber, ...existing } = o;
      orderByObd.set(obdNumber, existing as ExistingOrder);
    }

    const summaryByObd = new Map<string, ExistingSummary>();
    for (const s of shadowSummaries) {
      if (!summaryByObd.has(s.obdNumber)) {
        summaryByObd.set(s.obdNumber, { id: s.id, obdEmailTime: s.obdEmailTime, smuCode: s.smuCode });
      }
    }

    const summaryIds = Array.from(summaryByObd.values()).map((s) => s.id);
    const shadowLines = summaryIds.length > 0
      ? await prisma.import_raw_line_items.findMany({
          where:  { rawSummaryId: { in: summaryIds } }, // intentionally NO lineStatus filter — shadow needs to see soft-removed too
          select: {
            id: true, rawSummaryId: true, lineId: true, skuCodeRaw: true,
            unitQty: true, volumeLine: true, isTinting: true, lineStatus: true,
          },
        })
      : [];
    const linesBySummaryId = new Map<number, ExistingLine[]>();
    for (const l of shadowLines) {
      if (!linesBySummaryId.has(l.rawSummaryId)) linesBySummaryId.set(l.rawSummaryId, []);
      linesBySummaryId.get(l.rawSummaryId)!.push(l as ExistingLine);
    }

    const customerIdByCode = new Map(shadowCustomers.map((c) => [c.customerCode, c.id]));

    // Group line rows by OBD for incoming-input building.
    const linesByObd = new Map<string, RawLineRow[]>();
    for (const lr of lineRows) {
      const obd = toStr(lr["obd_number"]);
      if (!obd) continue;
      if (!linesByObd.has(obd)) linesByObd.set(obd, []);
      linesByObd.get(obd)!.push(lr);
    }

    const now = new Date();

    for (const hr of headerRows) {
      const obdNumber = toStr(hr["OBD Number"]);
      if (!obdNumber) continue;

      let actualOutcome: "created" | "skipped" | "errored";
      if (existingObdSet.has(obdNumber))      actualOutcome = "skipped";
      else if (confirmedSet.has(obdNumber))   actualOutcome = "created";
      else if (errorSet.has(obdNumber))       actualOutcome = "errored";
      else continue; // unrecognised — skip defensively

      try {
        const smuFromFile = toStr(hr["SMU"]) || null;
        const smuCodeRaw  = toStr(hr["SMU Code"]) || null;
        const obdLines    = linesByObd.get(obdNumber) ?? [];

        const input = headerRowToObdInput(hr, obdLines);
        const existingOrder   = orderByObd.get(obdNumber) ?? null;
        const existingSummary = summaryByObd.get(obdNumber) ?? null;
        const existingLines   = existingSummary
          ? (linesBySummaryId.get(existingSummary.id) ?? [])
          : [];
        const customerId      = input.shipToCustomerId
          ? (customerIdByCode.get(input.shipToCustomerId) ?? null)
          : null;

        const result = await upsertObd(
          input, "auto-import", batchId, batchRef, /* userId */ 1, now,
          { dryRun: true, preloaded: { order: existingOrder, summary: existingSummary, lines: existingLines, customerId } },
        );

        const divisionResolved = resolveSmuFromDivision(smuCodeRaw);
        const noteworthy: string[] = [];
        if (smuFromFile && divisionResolved.smu && smuFromFile !== divisionResolved.smu) {
          noteworthy.push("smu_mismatch_file_vs_map");
        }
        if (!smuCodeRaw || !divisionResolved.smu) {
          noteworthy.push("division_unmapped");
        }
        if (actualOutcome === "skipped" && (result.outcome === "patched" || result.outcome === "created")) {
          noteworthy.push(`actual_${actualOutcome}_but_shadow_${result.outcome}`);
        }
        if (result.errors.length > 0) noteworthy.push("shadow_errors_present");

        const decision = {
          actualHeader: existingOrder,
          actualLines:  existingLines,
          incomingHeader: {
            obdNumber:           input.obdNumber,
            division:            input.division,
            sapStatus:           input.sapStatus,
            materialType:        input.materialType,
            natureOfTransaction: input.natureOfTransaction,
            warehouse:           input.warehouse,
            obdEmailDate:        input.obdEmailDate,
            obdEmailTime:        input.obdEmailTime,
            totalUnitQty:        input.totalUnitQty,
            grossWeight:         input.grossWeight,
            volume:              input.volume,
            billToCustomerId:    input.billToCustomerId,
            billToCustomerName:  input.billToCustomerName,
            shipToCustomerId:    input.shipToCustomerId,
            shipToCustomerName:  input.shipToCustomerName,
            invoiceNo:           input.invoiceNo,
            invoiceDate:         input.invoiceDate,
            soNumber:            input.soNumber,
          },
          incomingLines:        input.lines,
          shadowAppliedChanges: result.applied,
          shadowEffects:        result.effects,
          metadata: {
            smuFromFile,
            smuFromMap: divisionResolved.smu,
            noteworthy,
          },
        };

        await prisma.import_shadow_log.create({
          data: {
            batchId,
            obdNumber,
            source:        "auto-import",
            actualOutcome,
            shadowOutcome: result.outcome,
            decision:      decision as unknown as Prisma.InputJsonValue,
            errors:        result.errors.length > 0 ? result.errors.join(" | ") : null,
          },
        });
      } catch (err) {
        console.error(`[SHADOW] OBD ${obdNumber} failed:`, err);
      }
    }
  } catch (outer) {
    console.error("[SHADOW] runAutoImportShadow outer failure:", outer);
  }
}

/**
 * Convert a parsed RawHeaderRow + its grouped RawLineRow[] into the
 * ObdInput shape consumed by upsertObd. Used by the shadow runner only —
 * the real auto-import path builds its own interim structures.
 */
function headerRowToObdInput(hr: RawHeaderRow, lineRows: RawLineRow[]): ObdInput {
  return {
    obdNumber:           toStr(hr["OBD Number"]),
    division:            toStr(hr["SMU Code"]) || null,
    sapStatus:           toStr(hr["Status"]) || null,
    materialType:        toStr(hr["MaterialType"]) || null,
    natureOfTransaction: toStr(hr["NatureOfTransaction"]) || null,
    warehouse:           toStr(hr["Warehouse"]) || null,
    obdEmailDate:        parseDateCell(hr["OBD Email Date"]),
    obdEmailTime:        parseTimeCell(hr["OBD Email Time"]),
    totalUnitQty:        toInt(hr["UnitQty"]),
    grossWeight:         toNum(hr["GrossWeight"]),
    volume:              toNum(hr["Volume"]),
    billToCustomerId:    toStr(hr["Bill To Customer Id"]) || null,
    billToCustomerName:  toStr(hr["Bill To Customer Name"]) || null,
    shipToCustomerId:    toStr(hr["ShipToCustomerId"]) || null,
    shipToCustomerName:  toStr(hr["Ship To Customer Name"]) || null,
    invoiceNo:           toStr(hr["InvoiceNo"]) || null,
    invoiceDate:         parseDateCell(hr["InvoiceDate"]),
    soNumber:            toStr(hr["SONum"]) || null,
    lines: lineRows.map((lr) => ({
      lineId:            toInt(lr["line_id"]) ?? 0,
      skuCodeRaw:        toStr(lr["sku_codes"]),
      skuDescriptionRaw: toStr(lr["sku_description"]) || null,
      batchCode:         toStr(lr["batch_code"]) || null,
      unitQty:           toInt(lr["unit_qty"]) ?? 0,
      volumeLine:        toNum(lr["volume_line"]),
      isTinting:         parseBooleanCell(lr["Tinting"]),
      article:           lr["article"] != null ? parseInt(String(lr["article"]), 10) : null,
      articleTag:        lr["article_tag"] != null ? String(lr["article_tag"]).trim() || null : null,
    })),
  };
}

// ── AUTO-IMPORT handler ───────────────────────────────────────────────────────
//
// Thin entry point: HMAC verify → parse XLSX → delegate to processAutoImportRows().
// All create/guard/effect logic lives in processAutoImportRows so the v2 JSON
// handler (?action=auto-json) can reuse it without duplication.

async function handleAutoImport(req: Request): Promise<NextResponse> {
  if (!verifyHmacSignature(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Failed to parse multipart form data" }, { status: 400 });
  }

  const combinedEntry = formData.get("combinedFile");
  if (!(combinedEntry instanceof File)) {
    return NextResponse.json({ error: "combinedFile is required" }, { status: 400 });
  }

  // ── Parse combined file (LogisticsTrackerWareHouse + LineItems) ───────────
  let headerRows: RawHeaderRow[];
  let lineRows:   RawLineRow[] = [];

  try {
    const buf = Buffer.from(await combinedEntry.arrayBuffer());
    const wb  = XLSX.read(buf, { type: "buffer", cellDates: false });
    headerRows = parseSheet<RawHeaderRow>(wb, "LogisticsTrackerWareHouse");
    const lineSheet = wb.Sheets["LineItems"];
    if (lineSheet) {
      lineRows = XLSX.utils.sheet_to_json<RawLineRow>(lineSheet, { raw: true, defval: null });
    }
  } catch {
    return NextResponse.json(
      { error: "Cannot parse file. Check sheet names." },
      { status: 400 },
    );
  }

  if (headerRows.length === 0) {
    return NextResponse.json({ error: "Header sheet has no data rows" }, { status: 422 });
  }

  return processAutoImportRows(headerRows, lineRows, combinedEntry.name);
}

// ── processAutoImportRows — shared create core ────────────────────────────────
//
// Called by handleAutoImport (?action=auto, multipart XLSX) and will be called by
// handleAutoImportJson (?action=auto-json, JSON body). Owns all DB work: validation
// queries → batch create → interims → inserts → guards → orders → challans →
// enrichment → shadow. Returns the final NextResponse.

async function processAutoImportRows(
  headerRows: RawHeaderRow[],
  lineRows:   RawLineRow[],
  fileName:   string,
): Promise<NextResponse> {
  // ── STEP B — Validate headers (2 bulk queries) ────────────────────────────
  const allObdNumbers    = headerRows.map((r) => toStr(r["OBD Number"])).filter(Boolean);
  const allCustomerCodes = headerRows.map((r) => toStr(r["ShipToCustomerId"])).filter(Boolean);

  const [existingOrders, existingCustomers] = await Promise.all([
    // NO isRemoved filter — must see soft-removed orders so we can mark a
    // re-imported OBD as "previously_removed" and skip it (no auto-restore).
    prisma.orders.findMany({
      where:  { obdNumber: { in: allObdNumbers } },
      select: { obdNumber: true, isRemoved: true },
    }),
    prisma.delivery_point_master.findMany({
      where:  { customerCode: { in: allCustomerCodes } },
      select: { customerCode: true },
    }),
  ]);

  const existingObdSet  = new Set(existingOrders.map((o) => o.obdNumber));
  const removedObdSet   = new Set(existingOrders.filter((o) => o.isRemoved).map((o) => o.obdNumber));
  const existingCustSet = new Set(existingCustomers.map((c) => c.customerCode));

  // ── STEP C — Validate line items (1 bulk query) ───────────────────────────
  let existingSkuSet = new Set<string>();

  if (lineRows.length > 0) {
    const allSkuCodes = lineRows.map((r) => toStr(r["sku_codes"])).filter(Boolean);
    const existingSkus = await prisma.sku_master.findMany({
      where:  { skuCode: { in: allSkuCodes } },
      select: { skuCode: true },
    });
    existingSkuSet = new Set(existingSkus.map((s) => s.skuCode));
  }

  const linesByObd = new Map<string, RawLineRow[]>();
  for (const lr of lineRows) {
    const obd = toStr(lr["obd_number"]);
    if (!obd) continue;
    if (!linesByObd.has(obd)) linesByObd.set(obd, []);
    linesByObd.get(obd)!.push(lr);
  }

  // ── STEP D — Generate batchRef ────────────────────────────────────────────
  const batchRef = await generateBatchRef();

  // ── STEP E1 — Create import_batches row ───────────────────────────────────
  let batchId: number;
  try {
    const batch = await createBatchWithRetry({
      batchRef,
      importedBy:   { connect: { id: 1 } },
      headerFile:   `[auto-import] ${fileName}`,
      lineFile:     "",
      status:       "processing",
    });
    batchId = batch.id;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create batch" },
      { status: 500 },
    );
  }

  // ── STEP E2 — Build in-memory interims ────────────────────────────────────
  interface AutoLineInterim {
    lineId:            number;
    skuCodeRaw:        string;
    skuDescriptionRaw: string | null;
    batchCode:         string | null;
    unitQty:           number;
    volumeLine:        number | null;
    isTinting:         boolean;
    article:           number | null;
    articleTag:        string | null;
    rowStatus:         "valid" | "error";
    rowError:          string | null;
  }

  interface AutoObdInterim {
    obdNumber:          string;
    shipToId:           string | null;
    shipToCustomerName: string | null;
    emailDate:          Date | null;
    totalUnitQty:       number | null;
    grossWeight:        number | null;
    rowStatus:          "valid" | "duplicate" | "previously_removed" | "error" | "warning";
    rowError:           string | null;
    lines:              AutoLineInterim[];
  }

  const obdInterims:  AutoObdInterim[] = [];
  const summaryData: Prisma.import_raw_summaryCreateManyInput[] = [];

  for (const hr of headerRows) {
    const obdNumber = toStr(hr["OBD Number"]);
    if (!obdNumber) continue;

    // Skip duplicates entirely in auto-import — no need to store raw data for existing OBDs
    if (existingObdSet.has(obdNumber)) continue;

    const shipToId           = toStr(hr["ShipToCustomerId"]) || null;
    const shipToCustomerName = toStr(hr["Ship To Customer Name"]) || null;
    const emailDate          = parseDateCell(hr["OBD Email Date"]);
    const emailTime          = parseTimeCell(hr["OBD Email Time"]);
    const invoiceDate        = parseDateCell(hr["InvoiceDate"]);

    let rowStatus: "valid" | "duplicate" | "previously_removed" | "error" | "warning" = "valid";
    let rowError:  string | null = null;

    if (shipToId && !existingCustSet.has(shipToId)) {
      rowStatus = "warning";
      rowError  = `Unknown customer: ${shipToId}`;
    }

    const obdLines = linesByObd.get(obdNumber) ?? [];
    const lines: AutoLineInterim[] = obdLines.map((lr) => {
      const skuCodeRaw = toStr(lr["sku_codes"]);
      const lineIdRaw  = toInt(lr["line_id"]) ?? 0;
      const unitQty    = toInt(lr["unit_qty"]) ?? 0;
      const volumeLine = toNum(lr["volume_line"]);
      const isTinting  = parseBooleanCell(lr["Tinting"]);
      const article    = lr["article"]     != null ? parseInt(String(lr["article"]), 10)  : null;
      const articleTag = lr["article_tag"] != null ? String(lr["article_tag"]).trim()     : null;

      let lineStatus: "valid" | "error" = "valid";
      let lineError:  string | null     = null;
      if (!skuCodeRaw) {
        lineStatus = "error";
        lineError  = "Missing SKU code";
      } else if (!existingSkuSet.has(skuCodeRaw)) {
        lineError = `Unknown SKU: ${skuCodeRaw} — manual mapping required`;
      }

      return {
        lineId:            lineIdRaw,
        skuCodeRaw,
        skuDescriptionRaw: toStr(lr["sku_description"]) || null,
        batchCode:         toStr(lr["batch_code"])       || null,
        unitQty,
        volumeLine,
        isTinting,
        article:    isNaN(article as number) ? null : article,
        articleTag: articleTag || null,
        rowStatus:  lineStatus,
        rowError:   lineError,
      };
    });

    obdInterims.push({
      obdNumber, shipToId, shipToCustomerName, emailDate,
      totalUnitQty: toInt(hr["UnitQty"]),
      grossWeight:  toNum(hr["GrossWeight"]),
      rowStatus, rowError, lines,
    });

    summaryData.push({
      batchId,
      obdNumber,
      sapStatus:           toStr(hr["Status"])              || null,
      smu:                 toStr(hr["SMU"])                 || null,
      smuCode:             toStr(hr["SMU Code"])            || null,
      materialType:        toStr(hr["MaterialType"])        || null,
      natureOfTransaction: toStr(hr["NatureOfTransaction"]) || null,
      warehouse:           toStr(hr["Warehouse"])           || null,
      obdEmailDate:        emailDate,
      obdEmailTime:        emailTime,
      totalUnitQty:        toInt(hr["UnitQty"]),
      grossWeight:         toNum(hr["GrossWeight"]),
      volume:              toNum(hr["Volume"]),
      billToCustomerId:    toStr(hr["Bill To Customer Id"])   || null,
      billToCustomerName:  toStr(hr["Bill To Customer Name"]) || null,
      shipToCustomerId:    shipToId,
      shipToCustomerName,
      invoiceNo:           toStr(hr["InvoiceNo"]) || null,
      soNumber:            toStr(hr["SONum"]) || null,
      invoiceDate,
      rowStatus,
      rowError,
    });
  }

  // ── STEP E3 — Bulk insert summaries ──────────────────────────────────────
  try {
    await prisma.import_raw_summary.createMany({ data: summaryData });
  } catch (err) {
    await prisma.import_batches
      .update({ where: { id: batchId }, data: { status: "failed" } })
      .catch(() => undefined);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to write summaries" },
      { status: 500 },
    );
  }

  // ── STEP E4 — Fetch inserted summary IDs + rowStatus ─────────────────────
  const insertedSummaries = await prisma.import_raw_summary.findMany({
    where:  { batchId },
    select: { id: true, obdNumber: true, rowStatus: true },
  });
  const summaryIdMap = new Map(insertedSummaries.map((s) => [s.obdNumber, s.id]));

  // ── STEP E5 — Bulk insert line items ─────────────────────────────────────
  const lineItemData = obdInterims.flatMap((obd) => {
    const rawSummaryId = summaryIdMap.get(obd.obdNumber);
    if (!rawSummaryId) return [];
    return obd.lines.map((line) => ({
      rawSummaryId,
      obdNumber:         obd.obdNumber,
      lineId:            line.lineId,
      skuCodeRaw:        line.skuCodeRaw,
      skuDescriptionRaw: line.skuDescriptionRaw,
      batchCode:         line.batchCode,
      unitQty:           line.unitQty,
      volumeLine:        line.volumeLine,
      isTinting:         line.isTinting,
      article:           line.article,
      articleTag:        line.articleTag,
      rowStatus:         line.rowStatus,
      rowError:          line.rowError,
    }));
  });

  if (lineItemData.length > 0) {
    let lineInsertResult: { count: number };
    try {
      lineInsertResult = await prisma.import_raw_line_items.createMany({ data: lineItemData });
    } catch (err) {
      await prisma.import_batches
        .update({ where: { id: batchId }, data: { status: "failed" } })
        .catch(() => undefined);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to write line items" },
        { status: 500 },
      );
    }

    // GUARD 1 — verify createMany inserted every row we sent. Silent shortfalls
    // (transient pgbouncer/pooler issues) produced the CHN-2026-00062 zombie challan.
    if (lineInsertResult.count !== lineItemData.length) {
      const affectedObds = Array.from(new Set(lineItemData.map((l) => l.obdNumber)));
      console.error("[auto-import] GUARD 1 line-count mismatch", {
        batchId,
        batchRef,
        expected:   lineItemData.length,
        actual:     lineInsertResult.count,
        obdNumbers: affectedObds,
      });
      await prisma.import_batches
        .update({ where: { id: batchId }, data: { status: "failed" } })
        .catch(() => undefined);
      return NextResponse.json(
        {
          error: `Line item write count mismatch (expected ${lineItemData.length}, got ${lineInsertResult.count}) — batch ${batchRef} marked failed`,
        },
        { status: 500 },
      );
    }
  }

  // ── Determine valid / duplicate / error counts ────────────────────────────
  const validSummaryIds = insertedSummaries
    .filter((s) => s.rowStatus === "valid" || s.rowStatus === "warning")
    .map((s) => s.id);
  // Duplicates were skipped before writing — count from original header rows
  const duplicateCount = allObdNumbers.filter((obd) => existingObdSet.has(obd)).length;
  const errorCount     = insertedSummaries.filter((s) => s.rowStatus === "error").length;

  if (validSummaryIds.length === 0) {
    await prisma.import_batches
      .update({
        where: { id: batchId },
        data:  { status: "completed", totalObds: 0, skippedObds: duplicateCount, failedObds: errorCount },
      })
      .catch(() => undefined);
    return NextResponse.json({
      success:           true,
      batchRef,
      ordersCreated:     0,
      skippedDuplicates: duplicateCount,
      errors:            errorCount,
    });
  }

  // ── CONFIRM — load confirmed raw rows ─────────────────────────────────────
  const autoRawSummaries = await prisma.import_raw_summary.findMany({
    where: {
      id:        { in: validSummaryIds },
      batchId,
      // Whitelist insertable rowStatuses. Excludes "duplicate" and the new
      // "previously_removed" (re-imported soft-removed OBDs — admin restore required).
      rowStatus: { in: ["valid", "warning"] },
    },
    include: {
      rawLineItems: {
        where: { lineStatus: "active" },
        select: {
          id:         true,
          obdNumber:  true,
          lineId:     true,
          skuCodeRaw: true,
          unitQty:    true,
          volumeLine: true,
          isTinting:  true,
          article:    true,
          articleTag: true,
          rowStatus:  true,
        },
      },
    },
  });

  // GUARD 2 — read-side cross-verify: every OBD we intended to have lines must
  // come back from DB with the same line count. Independent of GUARD 1 — catches
  // any future regression where lines silently fail to persist.
  {
    const expectedByObd = new Map<string, number>();
    for (const obd of obdInterims) {
      if (obd.lines.length > 0) expectedByObd.set(obd.obdNumber, obd.lines.length);
    }

    const mismatches: { obdNumber: string; expected: number; actual: number }[] = [];
    for (const summary of autoRawSummaries) {
      const expected = expectedByObd.get(summary.obdNumber) ?? 0;
      const actual   = summary.rawLineItems.length;
      if (expected > 0 && actual !== expected) {
        mismatches.push({ obdNumber: summary.obdNumber, expected, actual });
      }
    }

    if (mismatches.length > 0) {
      console.error("[auto-import] GUARD 2 read-side line mismatch", {
        batchId,
        batchRef,
        mismatches,
      });
      await prisma.import_batches
        .update({ where: { id: batchId }, data: { status: "failed" } })
        .catch(() => undefined);
      return NextResponse.json(
        {
          error: `Line item read-back mismatch — batch ${batchRef} marked failed (${mismatches.length} OBD${mismatches.length === 1 ? "" : "s"} affected)`,
        },
        { status: 500 },
      );
    }
  }

  // ── CONFIRM — bulk preload for enrichment ─────────────────────────────────
  const confirmCustomerCodes = autoRawSummaries
    .map((s) => s.shipToCustomerId)
    .filter((c): c is string => c !== null);

  const confirmSkuCodes = autoRawSummaries
    .flatMap((s) => s.rawLineItems)
    .map((l) => l.skuCodeRaw)
    .filter((c): c is string => Boolean(c));

  const [confirmCustomers, confirmSkus] = await Promise.all([
    prisma.delivery_point_master.findMany({
      where:  { customerCode: { in: confirmCustomerCodes } },
      select: {
        id:                     true,
        customerCode:           true,
        isKeyCustomer:          true,
        isKeySite:              true,
        dispatchDeliveryTypeId: true,
        area: { select: { deliveryTypeId: true } },
      },
    }),
    prisma.sku_master.findMany({
      where:  { skuCode: { in: confirmSkuCodes } },
      select: { id: true, skuCode: true },
    }),
  ]);

  const confirmCustomerByCode = new Map(confirmCustomers.map((c) => [c.customerCode, c]));
  const confirmSkuByCode      = new Map(confirmSkus.map((s) => [s.skuCode, s]));

  // ── CONFIRM — build order interims ────────────────────────────────────────
  interface AutoOrderInterim {
    obdNumber:     string;
    orderType:     string;
    workflowStage: string;
    hasTinting:    boolean;
    validLines:    typeof autoRawSummaries[0]["rawLineItems"];
    totalLineQty:  number;
    totalVolume:   number;
    orderData:     Prisma.ordersCreateManyInput;
  }

  const autoOrderInterims: AutoOrderInterim[] = [];

  for (const summary of autoRawSummaries) {
    const customer = summary.shipToCustomerId
      ? (confirmCustomerByCode.get(summary.shipToCustomerId) ?? null)
      : null;

    const emailDateTime = mergeEmailDateTime(summary.obdEmailDate, summary.obdEmailTime);

    const validLines    = summary.rawLineItems;
    const hasTinting    = validLines.some((l) => l.isTinting);
    const orderType     = hasTinting ? "tint" : "non_tint";
    const workflowStage = orderType === "tint" ? "pending_tint_assignment" : "pending_support";

    // Tint orders: slot assigned at tinting completion, not import
    const { dispatchSlot, slotId } = orderType === "tint"
      ? { dispatchSlot: null as string | null, slotId: null as number | null }
      : resolveSlot(summary.obdEmailTime);

    const priorityLevel = (customer?.isKeyCustomer || customer?.isKeySite) ? 1 : 3;

    let totalLineQty = 0;
    let totalVolume  = 0;
    for (const line of validLines) {
      totalLineQty += line.unitQty;
      totalVolume  += line.volumeLine ?? 0;
    }

    autoOrderInterims.push({
      obdNumber: summary.obdNumber,
      orderType,
      workflowStage,
      hasTinting,
      validLines,
      totalLineQty,
      totalVolume,
      orderData: {
        obdNumber:           summary.obdNumber,
        batchId,
        customerId:          customer?.id ?? null,
        shipToCustomerId:    summary.shipToCustomerId ?? summary.obdNumber,
        shipToCustomerName:  summary.shipToCustomerName,
        orderType,
        workflowStage,
        dispatchSlot,
        slotId,
        originalSlotId:      slotId,
        priorityLevel,
        invoiceNo:           summary.invoiceNo,
        soNumber:            summary.soNumber,
        invoiceDate:         summary.invoiceDate,
        obdEmailDate:        emailDateTime,
        orderDateTime:       emailDateTime,
        smu:                 summary.smu,
        sapStatus:           summary.sapStatus,
        materialType:        summary.materialType,
        natureOfTransaction: summary.natureOfTransaction,
        warehouse:           summary.warehouse,
        totalUnitQty:        summary.totalUnitQty,
        grossWeight:         summary.grossWeight,
        volume:              summary.volume,
        customerMissing:     summary.rowStatus === "warning",
      },
    });
  }

  // ── CONFIRM D1 — Bulk create orders ───────────────────────────────────────
  const confirmedObdNumbers = autoOrderInterims.map((o) => o.obdNumber);
  let ordersCreated = 0;
  let linesEnriched = 0;

  try {
    await prisma.orders.createMany({ data: autoOrderInterims.map((o) => o.orderData) });
    ordersCreated = autoOrderInterims.length;
  } catch (err) {
    await prisma.import_batches
      .update({ where: { id: batchId }, data: { status: "failed" } })
      .catch(() => undefined);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create orders" },
      { status: 500 },
    );
  }

  // ── CONFIRM D1b — Mail-order enrichment hook ──────────────────────────────
  await applyMailOrderEnrichment(autoOrderInterims.map((o) => o.orderData.soNumber ?? null));

  // ── CONFIRM D2 — Fetch inserted order IDs ─────────────────────────────────
  const insertedOrders = await prisma.orders.findMany({
    where:  { obdNumber: { in: confirmedObdNumbers }, batchId },
    select: { id: true, obdNumber: true },
  });
  const orderIdMap = new Map(insertedOrders.map((o) => [o.obdNumber, o.id]));

  // ── CONFIRM D2b — Auto-create delivery challans ─────────────────────────
  {
    const CHALLAN_SMU_VALUES_AUTO = ["Retail Offtake", "Decorative Projects"];

    const challanOrders = autoOrderInterims
      .filter((o) => {
        const summary = autoRawSummaries.find((s) => s.obdNumber === o.obdNumber);
        const smu = summary?.smu ?? "";
        if (!CHALLAN_SMU_VALUES_AUTO.includes(smu)) return false;
        // GUARD 3 — never auto-create a challan for an order with zero line items.
        // Last line of defence; if GUARDs 1 & 2 work this never fires.
        if (o.validLines.length === 0) {
          console.warn("[auto-import] GUARD 3 skipping zero-line challan", {
            batchId,
            batchRef,
            obdNumber: o.obdNumber,
            smu,
          });
          return false;
        }
        return true;
      })
      .map((o) => ({
        orderId: orderIdMap.get(o.obdNumber) ?? 0,
        obdNumber: o.obdNumber,
        orderDateTime: o.orderData.orderDateTime,
      }))
      .filter((o) => o.orderId > 0)
      .sort((a, b) => {
        const tA = a.orderDateTime ? new Date(a.orderDateTime as Date).getTime() : 0;
        const tB = b.orderDateTime ? new Date(b.orderDateTime as Date).getTime() : 0;
        return tA - tB;
      });

    if (challanOrders.length > 0) {
      try {
        const lastChallan = await prisma.delivery_challans.findFirst({
          orderBy: { id: "desc" },
          select: { challanNumber: true },
        });

        let nextSeq = 1;
        if (lastChallan?.challanNumber) {
          const parts = lastChallan.challanNumber.split("-");
          const lastNum = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(lastNum)) nextSeq = lastNum + 1;
        }

        const year = new Date().getFullYear();

        for (const co of challanOrders) {
          const challanNumber = `CHN-${year}-${String(nextSeq).padStart(5, "0")}`;
          await prisma.delivery_challans.create({
            data: {
              orderId: co.orderId,
              challanNumber,
            },
          });
          nextSeq++;
        }

        console.log(`[auto-import] Auto-created ${challanOrders.length} delivery challan(s)`);
      } catch (err) {
        console.error("[auto-import] Challan auto-creation failed:", err);
      }
    }
  }

  // ── CONFIRM D3 — Bulk create import_obd_query_summary ────────────────────
  const querySummaryData: Prisma.import_obd_query_summaryCreateManyInput[] =
    autoOrderInterims.map((o) => {
      const orderId  = orderIdMap.get(o.obdNumber) ?? 0;
      const hasLines = o.validLines.length > 0;
      const rs       = autoRawSummaries.find((s) => s.obdNumber === o.obdNumber);

      const totalArticle = o.validLines.reduce((sum, l) => sum + (l.article ?? 0), 0);

      const tagTotals: Record<string, number> = {};
      for (const l of o.validLines) {
        if (!l.articleTag) continue;
        const parts = l.articleTag.split(" ");
        if (parts.length >= 2) {
          const qty  = parseInt(parts[0], 10);
          const type = parts.slice(1).join(" ");
          if (!isNaN(qty) && type) tagTotals[type] = (tagTotals[type] ?? 0) + qty;
        }
      }
      const typeOrder     = ["Drum", "Bag", "Carton", "Tin"];
      const articleTagStr = typeOrder
        .filter((t) => tagTotals[t] > 0)
        .map((t) => `${tagTotals[t]} ${t}`)
        .join(", ") || null;

      return {
        obdNumber:    o.obdNumber,
        orderId,
        totalLines:   o.validLines.length,
        totalUnitQty: hasLines ? o.totalLineQty : (rs?.totalUnitQty ?? 0),
        totalWeight:  rs?.grossWeight ?? 0,
        totalVolume:  hasLines ? o.totalVolume  : (rs?.volume ?? 0),
        hasTinting:   o.hasTinting,
        totalArticle,
        articleTag:   articleTagStr,
      };
    });

  try {
    await prisma.import_obd_query_summary.createMany({ data: querySummaryData });
  } catch (err) {
    await prisma.import_batches
      .update({ where: { id: batchId }, data: { status: "failed" } })
      .catch(() => undefined);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create query summaries" },
      { status: 500 },
    );
  }

  // ── CONFIRM D4 — Bulk create order_status_logs ────────────────────────────
  const statusLogData: Prisma.order_status_logsCreateManyInput[] =
    autoOrderInterims.map((o) => ({
      orderId:     orderIdMap.get(o.obdNumber) ?? 0,
      fromStage:   null,
      toStage:     o.workflowStage,
      changedById: 1,
      note:        `Created via auto-import batch ${batchRef}`,
    }));

  try {
    await prisma.order_status_logs.createMany({ data: statusLogData });
  } catch (err) {
    await prisma.import_batches
      .update({ where: { id: batchId }, data: { status: "failed" } })
      .catch(() => undefined);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create status logs" },
      { status: 500 },
    );
  }

  // ── CONFIRM D5 — Bulk create import_enriched_line_items ──────────────────
  const enrichedData: Prisma.import_enriched_line_itemsCreateManyInput[] = [];
  for (const o of autoOrderInterims) {
    for (const line of o.validLines) {
      const sku = confirmSkuByCode.get(line.skuCodeRaw);
      enrichedData.push({
        rawLineItemId: line.id,
        skuId:         sku?.id ?? null,
        unitQty:       line.unitQty,
        volumeLine:    line.volumeLine,
        lineWeight:    sku ? 0 : null,
        isTinting:     line.isTinting,
        note:          sku ? null : "Unknown SKU — manual mapping required",
      });
      linesEnriched++;
    }
  }

  if (enrichedData.length > 0) {
    try {
      await prisma.import_enriched_line_items.createMany({ data: enrichedData });
    } catch (err) {
      await prisma.import_batches
        .update({ where: { id: batchId }, data: { status: "failed" } })
        .catch(() => undefined);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to enrich line items" },
        { status: 500 },
      );
    }
  }

  // ── CONFIRM D6 — Update import_batches status ─────────────────────────────
  await prisma.import_batches
    .update({
      where: { id: batchId },
      data: {
        status:      "completed",
        totalObds:   validSummaryIds.length,
        skippedObds: duplicateCount,
        failedObds:  errorCount,
      },
    })
    .catch(() => undefined);

  // ── Step 4A — Shadow upsertObd in dry-run mode (no behaviour change) ─────
  // Gated by IMPORT_SHADOW_MODE env var, default off. Outer try/catch ensures
  // shadow can never crash the auto-import response.
  await runAutoImportShadow({
    headerRows,
    lineRows,
    existingObdSet,
    confirmedObdNumbers,
    errorObdNumbers: insertedSummaries
      .filter((s) => s.rowStatus === "error")
      .map((s) => s.obdNumber),
    batchId,
    batchRef,
  });

  return NextResponse.json({
    success:           true,
    batchRef,
    ordersCreated,
    skippedDuplicates: duplicateCount,
    errors:            errorCount,
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<NextResponse> {
  const url = new URL(req.url, "http://localhost");
  const action = url.searchParams.get("action");

  if (action === "auto") return handleAutoImport(req);

  // All other actions require session auth
  const session = await auth();
  requireRole(session, [
    ROLES.ADMIN,
    ROLES.DISPATCHER,
    ROLES.SUPPORT,
    ROLES.BILLING_OPERATOR,
    ROLES.TINT_MANAGER,
    ROLES.OPERATION_MANAGER,
  ]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "import_obd", "canImport");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  if (action === "preview") return handlePreview(req, session!);
  if (action === "confirm") return handleConfirm(req, session!);
  if (action === "manual-sap-preview") return handleManualSapPreview(req, session!);
  if (action === "manual-sap-confirm") return handleManualSapConfirm(req, session!);

  return NextResponse.json(
    { error: "Invalid action. Use ?action=preview, ?action=confirm, ?action=manual-sap-preview, or ?action=manual-sap-confirm" },
    { status: 400 },
  );
}
