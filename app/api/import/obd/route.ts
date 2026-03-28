import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import type { Session } from "next-auth";
import type { Prisma } from "@prisma/client";
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
  [key: string]:            unknown;
}

interface RawLineRow {
  "obd_number"?:      unknown;
  "line_id"?:         unknown;
  "sku_codes"?:       unknown;
  "sku_description"?: unknown;
  "batch_code"?:      unknown;
  "unit_qty"?:        unknown;
  "volume_line"?:     unknown;
  "Tinting"?:         unknown;
  [key: string]:      unknown;
}

type SlotConfig = {
  slotRuleType: string;
  windowStart:  string | null;
  windowEnd:    string | null;
  isDefault:    boolean;
  slot: { name: string; slotTime: string; isNextDay: boolean };
};

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
  configs: SlotConfig[],
  emailTime: string | null,
  emailDate: Date | null,
): { dispatchSlot: string | null; dispatchSlotDeadline: Date | null } {
  if (!emailDate) {
    const defaultCfg = configs.find((c) => c.isDefault) ?? null;
    if (!defaultCfg) return { dispatchSlot: null, dispatchSlotDeadline: null };
    return { dispatchSlot: defaultCfg.slot.name, dispatchSlotDeadline: null };
  }

  let matched: SlotConfig | null = null;

  if (emailTime) {
    for (const cfg of configs) {
      if (
        cfg.slotRuleType === "time_based" &&
        cfg.windowStart &&
        cfg.windowEnd &&
        emailTime >= cfg.windowStart &&
        emailTime <= cfg.windowEnd
      ) {
        matched = cfg;
        break;
      }
    }
  }

  if (!matched) {
    matched = configs.find((c) => c.isDefault) ?? null;
  }

  if (!matched) return { dispatchSlot: null, dispatchSlotDeadline: null };

  const [slotH, slotM] = matched.slot.slotTime.split(":").map(Number);
  const deadline = new Date(emailDate);
  deadline.setHours(slotH, slotM, 0, 0);
  if (matched.slot.isNextDay) deadline.setDate(deadline.getDate() + 1);

  return { dispatchSlot: matched.slot.name, dispatchSlotDeadline: deadline };
}

// ── batchRef generation ───────────────────────────────────────────────────────

async function generateBatchRef(): Promise<string> {
  const now     = new Date();
  const y       = now.getFullYear();
  const mo      = String(now.getMonth() + 1).padStart(2, "0");
  const d       = String(now.getDate()).padStart(2, "0");
  const dateStr = `${y}${mo}${d}`;

  const startOfToday = new Date(y, now.getMonth(), now.getDate());
  const todayCount   = await prisma.import_batches.count({
    where: { createdAt: { gte: startOfToday } },
  });

  return `BATCH-${dateStr}-${String(todayCount + 1).padStart(3, "0")}`;
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
    prisma.orders.findMany({
      where:  { obdNumber: { in: allObdNumbers } },
      select: { obdNumber: true },
    }),
    prisma.delivery_point_master.findMany({
      where:  { customerCode: { in: allCustomerCodes } },
      select: { customerCode: true },
    }),
  ]);

  const existingObdSet  = new Set(existingOrders.map((o) => o.obdNumber));
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
    const batch = await prisma.import_batches.create({
      data: {
        batchRef,
        importedById: userId,
        headerFile:   `[${templateId}] ${batchFileName}`,
        lineFile:     lineFileName,
        status:       "processing",
      },
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
    rowStatus:          "valid" | "duplicate" | "error" | "warning";
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

    let rowStatus: "valid" | "duplicate" | "error" | "warning" = "valid";
    let rowError:  string | null = null;

    if (existingObdSet.has(obdNumber)) {
      rowStatus = "duplicate";
    } else if (shipToId && !existingCustSet.has(shipToId)) {
      rowStatus = "warning";
      rowError  = `Unknown customer: ${shipToId}`;
    }

    // Build line interims for this OBD
    const obdLines   = linesByObd.get(obdNumber) ?? [];
    const lines: LineInterim[] = obdLines.map((lr) => {
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
        // Warning only — unknown SKUs are enriched with skuId=null (best-effort)
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
        where:  { rawSummaryId: { in: summaryIds } },
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
  const validObds     = previewObds.filter((o) => o.rowStatus === "valid").length;
  const duplicateObds = previewObds.filter((o) => o.rowStatus === "duplicate").length;
  const errorObds     = previewObds.filter((o) => o.rowStatus === "error").length;
  const warningObds   = previewObds.filter((o) => o.rowStatus === "warning").length;
  const allLines      = previewObds.flatMap((o) => o.lines);
  const validLines    = allLines.filter((l) => l.rowStatus === "valid").length;
  const errorLines    = allLines.filter((l) => l.rowStatus === "error").length;

  const payload: ImportPreviewResponse = {
    batchId,
    batchRef,
    summary: {
      totalObds:     previewObds.length,
      validObds,
      duplicateObds,
      errorObds,
      warningObds,
      totalLines:    allLines.length,
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
      rowStatus: { not: "duplicate" },
    },
    include: {
      rawLineItems: {
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

  const [customers, skus, slotConfigs, localDeliveryType] = await Promise.all([
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
    prisma.delivery_type_slot_config.findMany({
      where:   { isActive: true },
      include: { slot: { select: { name: true, slotTime: true, isNextDay: true } } },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.delivery_type_master.findFirst({
      where:  { name: "Local" },
      select: { id: true },
    }),
  ]);

  const customerByCode      = new Map(customers.map((c) => [c.customerCode, c]));
  const skuByCode           = new Map(skus.map((s) => [s.skuCode, s]));
  const localDeliveryTypeId = localDeliveryType?.id ?? null;

  const slotsByDeliveryType = new Map<number, SlotConfig[]>();
  for (const cfg of slotConfigs) {
    if (!slotsByDeliveryType.has(cfg.deliveryTypeId)) {
      slotsByDeliveryType.set(cfg.deliveryTypeId, []);
    }
    slotsByDeliveryType.get(cfg.deliveryTypeId)!.push({
      slotRuleType: cfg.slotRuleType,
      windowStart:  cfg.windowStart,
      windowEnd:    cfg.windowEnd,
      isDefault:    cfg.isDefault,
      slot:         cfg.slot,
    });
  }

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

    const deliveryTypeId =
      customer?.dispatchDeliveryTypeId ??
      customer?.area?.deliveryTypeId ??
      localDeliveryTypeId;

    const configs = deliveryTypeId
      ? (slotsByDeliveryType.get(deliveryTypeId) ?? [])
      : [];

    const { dispatchSlot, dispatchSlotDeadline } = resolveSlot(
      configs,
      summary.obdEmailTime,
      summary.obdEmailDate,
    );

    const validLines    = summary.rawLineItems; // already filtered to rowStatus=valid
    const hasTinting    = validLines.some((l) => l.isTinting);
    const orderType     = hasTinting ? "tint" : "non_tint";
    const workflowStage = orderType === "tint"
      ? "pending_tint_assignment"
      : "pending_support";

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
        dispatchSlotDeadline,
        priorityLevel,
        invoiceNo:           summary.invoiceNo,
        invoiceDate:         summary.invoiceDate,
        obdEmailDate:        summary.obdEmailDate,
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

  // ── STEP D2 — Fetch inserted order IDs ───────────────────────────────────
  const insertedOrders = await prisma.orders.findMany({
    where:  { obdNumber: { in: confirmedObdNumbers }, batchId: batch.id },
    select: { id: true, obdNumber: true },
  });
  const orderIdMap = new Map(insertedOrders.map((o) => [o.obdNumber, o.id]));

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

// ── AUTO-IMPORT handler ───────────────────────────────────────────────────────

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

  // ── STEP B — Validate headers (2 bulk queries) ────────────────────────────
  const allObdNumbers    = headerRows.map((r) => toStr(r["OBD Number"])).filter(Boolean);
  const allCustomerCodes = headerRows.map((r) => toStr(r["ShipToCustomerId"])).filter(Boolean);

  const [existingOrders, existingCustomers] = await Promise.all([
    prisma.orders.findMany({
      where:  { obdNumber: { in: allObdNumbers } },
      select: { obdNumber: true },
    }),
    prisma.delivery_point_master.findMany({
      where:  { customerCode: { in: allCustomerCodes } },
      select: { customerCode: true },
    }),
  ]);

  const existingObdSet  = new Set(existingOrders.map((o) => o.obdNumber));
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
    const batch = await prisma.import_batches.create({
      data: {
        batchRef,
        importedById: 1,
        headerFile:   `[auto-import] ${combinedEntry.name}`,
        lineFile:     "",
        status:       "processing",
      },
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
    rowStatus:          "valid" | "duplicate" | "error" | "warning";
    rowError:           string | null;
    lines:              AutoLineInterim[];
  }

  const obdInterims:  AutoObdInterim[] = [];
  const summaryData: Prisma.import_raw_summaryCreateManyInput[] = [];

  for (const hr of headerRows) {
    const obdNumber = toStr(hr["OBD Number"]);
    if (!obdNumber) continue;

    const shipToId           = toStr(hr["ShipToCustomerId"]) || null;
    const shipToCustomerName = toStr(hr["Ship To Customer Name"]) || null;
    const emailDate          = parseDateCell(hr["OBD Email Date"]);
    const emailTime          = parseTimeCell(hr["OBD Email Time"]);
    const invoiceDate        = parseDateCell(hr["InvoiceDate"]);

    let rowStatus: "valid" | "duplicate" | "error" | "warning" = "valid";
    let rowError:  string | null = null;

    if (existingObdSet.has(obdNumber)) {
      rowStatus = "duplicate";
    } else if (shipToId && !existingCustSet.has(shipToId)) {
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

  // ── Determine valid / duplicate / error counts ────────────────────────────
  const validSummaryIds = insertedSummaries
    .filter((s) => s.rowStatus === "valid" || s.rowStatus === "warning")
    .map((s) => s.id);
  const duplicateCount = insertedSummaries.filter((s) => s.rowStatus === "duplicate").length;
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
      rowStatus: { not: "duplicate" },
    },
    include: {
      rawLineItems: {
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

  // ── CONFIRM — bulk preload for enrichment ─────────────────────────────────
  const confirmCustomerCodes = autoRawSummaries
    .map((s) => s.shipToCustomerId)
    .filter((c): c is string => c !== null);

  const confirmSkuCodes = autoRawSummaries
    .flatMap((s) => s.rawLineItems)
    .map((l) => l.skuCodeRaw)
    .filter((c): c is string => Boolean(c));

  const [confirmCustomers, confirmSkus, confirmSlotConfigs, confirmLocalDeliveryType] =
    await Promise.all([
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
      prisma.delivery_type_slot_config.findMany({
        where:   { isActive: true },
        include: { slot: { select: { name: true, slotTime: true, isNextDay: true } } },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.delivery_type_master.findFirst({
        where:  { name: "Local" },
        select: { id: true },
      }),
    ]);

  const confirmCustomerByCode      = new Map(confirmCustomers.map((c) => [c.customerCode, c]));
  const confirmSkuByCode           = new Map(confirmSkus.map((s) => [s.skuCode, s]));
  const confirmLocalDeliveryTypeId = confirmLocalDeliveryType?.id ?? null;

  const confirmSlotsByDeliveryType = new Map<number, SlotConfig[]>();
  for (const cfg of confirmSlotConfigs) {
    if (!confirmSlotsByDeliveryType.has(cfg.deliveryTypeId)) {
      confirmSlotsByDeliveryType.set(cfg.deliveryTypeId, []);
    }
    confirmSlotsByDeliveryType.get(cfg.deliveryTypeId)!.push({
      slotRuleType: cfg.slotRuleType,
      windowStart:  cfg.windowStart,
      windowEnd:    cfg.windowEnd,
      isDefault:    cfg.isDefault,
      slot:         cfg.slot,
    });
  }

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

    const deliveryTypeId =
      customer?.dispatchDeliveryTypeId ??
      customer?.area?.deliveryTypeId ??
      confirmLocalDeliveryTypeId;

    const configs = deliveryTypeId
      ? (confirmSlotsByDeliveryType.get(deliveryTypeId) ?? [])
      : [];

    const { dispatchSlot, dispatchSlotDeadline } = resolveSlot(
      configs,
      summary.obdEmailTime,
      summary.obdEmailDate,
    );

    const validLines    = summary.rawLineItems;
    const hasTinting    = validLines.some((l) => l.isTinting);
    const orderType     = hasTinting ? "tint" : "non_tint";
    const workflowStage = orderType === "tint" ? "pending_tint_assignment" : "pending_support";
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
        dispatchSlotDeadline,
        priorityLevel,
        invoiceNo:           summary.invoiceNo,
        invoiceDate:         summary.invoiceDate,
        obdEmailDate:        summary.obdEmailDate,
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

  // ── CONFIRM D2 — Fetch inserted order IDs ─────────────────────────────────
  const insertedOrders = await prisma.orders.findMany({
    where:  { obdNumber: { in: confirmedObdNumbers }, batchId },
    select: { id: true, obdNumber: true },
  });
  const orderIdMap = new Map(insertedOrders.map((o) => [o.obdNumber, o.id]));

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
  requireRole(session, [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.SUPPORT]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "import_obd", "canImport");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  if (action === "preview") return handlePreview(req, session!);
  if (action === "confirm") return handleConfirm(req, session!);

  return NextResponse.json(
    { error: "Invalid action. Use ?action=preview or ?action=confirm" },
    { status: 400 },
  );
}
