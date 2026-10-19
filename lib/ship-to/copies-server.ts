// lib/ship-to/copies-server.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 ONE OWNER FOR DEALER / SO CHALLAN COPIES (ship_to_copies, Schema v27.73)
// ═══════════════════════════════════════════════════════════════════════════
//
// Upload, row insert, the compensating delete, soft-remove, counting — and THE
// rule for when a Billing copy shows on a bill. Billing's and Floor's save
// routes, the copies list and the signed-URL route all call these; step 7's
// read sites must call billingCopiesVisibleWhere too, never re-derive it.
//
// Write order (lib/mrn/photo.ts pattern, CLAUDE_MRN.md §4.4):
//   1. upload the objects            — a failure removes the ones already up
//   2. insert one row per object     — a failure removes rows + objects
//   3. the caller writes the ship-to — a failure calls discardNewCopies
// No $transaction (CORE §3), and none could help: Storage is not in Postgres.
//
// A SAVED copy is never deleted: picking a dealer, Reset, or ✕ in the modal
// SOFT-REMOVES it (removedAt + removedById, both or neither —
// chk_ship_to_copies_removed_complete). The object stays in the bucket. Only
// rows and objects created by a save that then FAILED are hard-deleted here.
//
// Server-only (Prisma + the service-role Supabase client).

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/supabase";
import { SHIP_TO_BUCKET, buildCopyPath, type ShipToCopyOwner } from "@/lib/ship-to/copy";
import type { ParsedCopyFile } from "@/lib/ship-to/parse-form";

// ── Which Billing copies a bill shows ─────────────────────────────────────

/** The bill fields the visibility rule reads. */
export interface BillShipToState {
  soNumber: string | null;
  shipToOverrideCustomerId: number | null;
  shipToText: string | null;
  shipToAreaId: number | null;
}

/**
 * 🔴 A BILL SHOWS A BILLING (mail-order) COPY ONLY WHILE IT STILL HAS
 * BILLING'S SHIP-TO (owner, 2026-10-19):
 *   bill has no dealer redirect, has typed text, and its text AND area equal
 *   the mail order's.
 * Floor changing that one bill to a dealer (or another name, or Reset) hides
 * the SO's copy on that bill only — the copy itself is untouched.
 */
export function billingCopyVisibleOnBill(
  bill: Omit<BillShipToState, "soNumber">,
  mo: { shipToText: string | null; shipToAreaId: number | null },
): boolean {
  return (
    bill.shipToOverrideCustomerId === null &&
    bill.shipToText !== null &&
    bill.shipToText === mo.shipToText &&
    bill.shipToAreaId === mo.shipToAreaId
  );
}

/**
 * The same rule as a WHERE on ship_to_copies: the active Billing copies a bill
 * shows. `null` = none can show (no SO, a dealer redirect, or no typed text) —
 * the caller skips the read. The mail orders are found by the bill's SO, the
 * same key enrichment carries the ship-to by.
 */
export function billingCopiesVisibleWhere(bill: BillShipToState): Prisma.ship_to_copiesWhereInput | null {
  const so = bill.soNumber?.trim() ?? "";
  if (so === "" || bill.shipToOverrideCustomerId !== null || bill.shipToText === null) return null;
  return {
    removedAt: null,
    moOrderId: { not: null },
    moOrder: { soNumber: so, shipToText: bill.shipToText, shipToAreaId: bill.shipToAreaId },
  };
}

export async function countBillingCopiesVisible(bill: BillShipToState): Promise<number> {
  const where = billingCopiesVisibleWhere(bill);
  return where === null ? 0 : prisma.ship_to_copies.count({ where });
}

// ── Owner-scoped reads ────────────────────────────────────────────────────

/** The active copies an owner holds: a mail order's (Billing) or a bill's own (Floor). */
export function activeOwnCopiesWhere(owner: ShipToCopyOwner, ownerId: number): Prisma.ship_to_copiesWhereInput {
  return owner === "billing" ? { moOrderId: ownerId, removedAt: null } : { orderId: ownerId, removedAt: null };
}

export async function countActiveOwnCopies(owner: ShipToCopyOwner, ownerId: number): Promise<number> {
  return prisma.ship_to_copies.count({ where: activeOwnCopiesWhere(owner, ownerId) });
}

/**
 * Every id in `ids` must be an ACTIVE copy THIS caller owns: Billing owns its
 * mail order's copies, Floor owns its bill's own copies. Floor may view a
 * Billing copy but never remove it (owner, 2026-10-19) → 403.
 */
export async function checkRemovable(
  ids: number[],
  owner: ShipToCopyOwner,
  ownerId: number,
): Promise<{ status: number; error: string } | null> {
  if (ids.length === 0) return null;
  const rows = await prisma.ship_to_copies.findMany({
    where: { id: { in: ids } },
    select: { id: true, orderId: true, moOrderId: true, removedAt: true },
  });
  for (const id of ids) {
    const r = rows.find((x) => x.id === id);
    if (!r) return { status: 404, error: `Copy ${id} not found` };
    const mine = owner === "billing" ? r.moOrderId === ownerId : r.orderId === ownerId;
    if (!mine) {
      return {
        status: 403,
        error:
          owner === "floor" && r.moOrderId !== null
            ? "That copy belongs to Billing (the whole SO) — remove it from Billing."
            : "That copy belongs to another order.",
      };
    }
    if (r.removedAt !== null) return { status: 409, error: `Copy ${id} was already removed` };
  }
  return null;
}

// ── Writes ────────────────────────────────────────────────────────────────

/** Soft-remove: hide, keep the file. Only rows still active are touched. */
export async function softRemoveCopies(where: Prisma.ship_to_copiesWhereInput, userId: number): Promise<number> {
  const r = await prisma.ship_to_copies.updateMany({
    where: { ...where, removedAt: null },
    data: { removedAt: new Date(), removedById: userId },
  });
  return r.count;
}

/** Best-effort object delete; its own failure is logged, never thrown — the
 *  caller's real error must not be replaced by a cleanup error. */
async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await getSupabaseAdmin().storage.from(SHIP_TO_BUCKET).remove(paths);
  if (error) {
    console.error(`[ship-to/copies] ORPHANED OBJECTS — compensating delete failed: ${paths.join(", ")} · ${error.message}`);
  }
}

/** The compensating delete for a save that failed AFTER its copies were
 *  recorded: the new rows, then the new objects. Never called on saved copies. */
export async function discardNewCopies(ids: number[], paths: string[]): Promise<void> {
  try {
    if (ids.length > 0) await prisma.ship_to_copies.deleteMany({ where: { id: { in: ids } } });
  } catch (err) {
    console.error(`[ship-to/copies] could not delete new copy rows ${ids.join(", ")}:`, err);
  }
  await removeObjects(paths);
}

export type RecordCopiesResult =
  | { ok: true; ids: number[]; paths: string[] }
  | { ok: false; status: number; error: string };

/**
 * Steps 1 + 2: upload every file, then insert one row per file. On any failure
 * everything this call created is undone and nothing is left visible.
 */
export async function uploadAndRecordCopies(args: {
  files: ParsedCopyFile[];
  owner: ShipToCopyOwner;
  ownerId: number;
  /** A snapshot only — readers find Billing copies via moOrderId (v27.73). */
  soNumber: string | null;
  uploadedById: number;
}): Promise<RecordCopiesResult> {
  const { files, owner, ownerId, soNumber, uploadedById } = args;
  if (files.length === 0) return { ok: true, ids: [], paths: [] };

  const supabase = getSupabaseAdmin();
  const uploaded: { path: string; file: ParsedCopyFile }[] = [];
  for (const file of files) {
    const path = buildCopyPath(owner, ownerId, file.contentType);
    const { error } = await supabase.storage
      .from(SHIP_TO_BUCKET)
      // upsert false: the path carries a fresh UUID — a collision must fail, not overwrite.
      .upload(path, file.bytes, { contentType: file.contentType, upsert: false });
    if (error) {
      await removeObjects(uploaded.map((u) => u.path));
      return { ok: false, status: 500, error: `Copy upload failed: ${error.message}` };
    }
    uploaded.push({ path, file });
  }

  const ids: number[] = [];
  try {
    for (const u of uploaded) {
      const row = await prisma.ship_to_copies.create({
        data: {
          soNumber: soNumber?.trim() || null,
          orderId: owner === "floor" ? ownerId : null,
          moOrderId: owner === "billing" ? ownerId : null,
          storagePath: u.path,
          contentType: u.file.contentType,
          sizeBytes: u.file.size,
          uploadedById,
        },
        select: { id: true },
      });
      ids.push(row.id);
    }
  } catch (err) {
    console.error(`[ship-to/copies] row insert failed for ${owner} ${ownerId}:`, err);
    await discardNewCopies(ids, uploaded.map((u) => u.path));
    return { ok: false, status: 500, error: "The copy could not be saved. Please try again." };
  }

  return { ok: true, ids, paths: uploaded.map((u) => u.path) };
}
