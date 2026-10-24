// lib/order-invoices/load-dialog.ts — SPLIT LOAD, the dialog's arithmetic
// (phase 3 commit 2, 2026-10-24). PURE: no Prisma, no React — safe in the
// browser. Tests: lib/order-invoices/load-dialog.test.ts
// (npx tsx --test lib/order-invoices/load-dialog.test.ts).
//
// The look and rules: docs/mockups/split-load/split-load-mockup.html. One row
// per product line of the SOURCE row; Truck A … the second-to-last are TYPED,
// the LAST truck takes the REST (auto). "+ Add truck" inserts a typed truck
// before the last; ✕ on Truck C and later; "Split evenly". Save is enabled only
// when the SERVER's own rule (load-plan.ts planLoadSplit) accepts the trucks —
// the Add invoices / validateSplit pattern. Kg per truck is the BOARD's ladder
// (lib/floor/invoice-rows.ts invoiceKg), never the header kg alone.

import { invoiceKg, type InvoiceLineFacts } from "@/lib/floor/invoice-rows";
import { lineLitres } from "./entry";
import { planLoadSplit, type LoadRow, type TruckInput } from "./load-plan";
import type { ActiveLine } from "./rules";

/** A split starts with two trucks (mockup). */
export const START_TRUCKS = 2;

/** "Truck A", "Truck B", … */
export function truckName(t: number): string {
  return `Truck ${String.fromCharCode(65 + t)}`;
}

/** What was typed per line, per TYPED truck (trucks 0 … n-2): raw text. */
export type Typed = string[][];

/** One product line of the source row: its raw line and the tins it carries. */
export interface DialogLine {
  rawLineItemId: number;
  tins: number;
}

/** A typed cell → tins. "" = 0; a whole number ≥ 0 → it; anything else → null. */
export function parseTins(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return 0;
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}

/** The opening state: Truck A takes half (rounded up), Truck B the rest. */
export function startTyped(lines: readonly DialogLine[]): Typed {
  return lines.map((l) => [String(Math.ceil(l.tins / 2))]);
}

/** "+ Add truck": a new typed truck BEFORE the last (it starts at 0). */
export function addTruck(typed: Typed): Typed {
  return typed.map((row) => [...row, "0"]);
}

/**
 * ✕ on truck `t` (Truck C or later). A typed truck's column goes; removing the
 * LAST truck drops the last typed column, which then becomes the rest.
 */
export function removeTruck(typed: Typed, t: number, trucks: number): Typed {
  if (trucks <= START_TRUCKS || t < 2) return typed;
  const col = Math.min(t, trucks - 2);
  return typed.map((row) => row.filter((_, i) => i !== col));
}

/** "Split evenly": every typed truck gets floor(tins / trucks), the last the rest. */
export function splitEvenly(lines: readonly DialogLine[], trucks: number): Typed {
  return lines.map((l) => Array.from({ length: trucks - 1 }, () => String(Math.floor(l.tins / trucks))));
}

/** The REST of a line — its tins minus what the typed trucks take (bad cells count 0). */
export function restOf(line: DialogLine, row: readonly string[]): number {
  return line.tins - row.reduce((s, raw) => s + (parseTins(raw) ?? 0), 0);
}

/** Tins of line `i` on truck `t` — typed, or the rest on the last truck. */
export function onTruck(lines: readonly DialogLine[], typed: Typed, i: number, t: number, trucks: number): number {
  return t === trucks - 1 ? restOf(lines[i], typed[i]) : parseTins(typed[i][t] ?? "") ?? 0;
}

/** The trucks as the POST sends them (trucks[0] = what the source keeps). */
export function trucksOf(lines: readonly DialogLine[], typed: Typed, trucks: number): TruckInput[] {
  return Array.from({ length: trucks }, (_, t) => ({
    lines: lines.map((l, i) => ({ rawLineItemId: l.rawLineItemId, qty: onTruck(lines, typed, i, t, trucks) })),
  }));
}

// ── Kg and litres — the board's ladder ───────────────────────────────────────

/** What invoiceKg needs, built once from the GET (activeLines + kg). */
export interface KgFacts {
  activeById: ReadonlyMap<number, InvoiceLineFacts>;
  unitKgBySku: ReadonlyMap<string, number>;
  obdKg: number | null;
  obdLitres: number;
}

export function kgFactsOf(
  active: ReadonlyArray<{ rawLineItemId: number; lineId: number; skuCodeRaw: string; unitQty: number; volumeLine: number | null }>,
  kg: { obdKg: number | null; lines: ReadonlyArray<{ rawLineItemId: number; totalWeight: number | null; unitKg: number | null }> },
): KgFacts {
  const kgById = new Map(kg.lines.map((l) => [l.rawLineItemId, l]));
  const unitKgBySku = new Map<string, number>();
  const activeById = new Map<number, InvoiceLineFacts>();
  for (const a of active) {
    const k = kgById.get(a.rawLineItemId);
    activeById.set(a.rawLineItemId, { ...a, totalWeight: k?.totalWeight ?? null });
    if (k?.unitKg && k.unitKg > 0) unitKgBySku.set(a.skuCodeRaw, k.unitKg);
  }
  return { activeById, unitKgBySku, obdKg: kg.obdKg, obdLitres: active.reduce((s, a) => s + (a.volumeLine ?? 0), 0) };
}

/** One line's kg per tin by rules 1 / 2 (null = only the shared "~" rule 3 is left). */
export function kgPerTinOf(rawLineItemId: number, facts: KgFacts): number | null {
  const l = facts.activeById.get(rawLineItemId);
  if (!l || l.unitQty <= 0) return null;
  if ((l.totalWeight ?? 0) > 0) return l.totalWeight! / l.unitQty;
  return facts.unitKgBySku.get(l.skuCodeRaw) ?? null;
}

export interface TruckTotal {
  tins: number;
  litres: number;
  kg: number | null;
  /** false = the header kg shared by litres — show "~". */
  kgExact: boolean;
}

/** One truck's tins · litres · kg (lines with 0 or fewer tins carry nothing). */
export function truckTotalOf(truck: TruckInput, facts: KgFacts): TruckTotal {
  const lines = truck.lines.filter((l) => l.qty > 0);
  const tins = lines.reduce((s, l) => s + l.qty, 0);
  const litres = lines.reduce((s, l) => {
    const a = facts.activeById.get(l.rawLineItemId);
    return s + (a ? lineLitres(a.volumeLine, a.unitQty, l.qty) : 0);
  }, 0);
  if (tins === 0) return { tins, litres, kg: 0, kgExact: true };
  const { kg, kgExact } = invoiceKg(lines, facts.activeById, facts.unitKgBySku, facts.obdKg, litres, facts.obdLitres);
  return { tins, litres, kg, kgExact };
}

// ── Why Save is grey ─────────────────────────────────────────────────────────

/**
 * The FIRST reason these trucks cannot be saved, in the mockup's words, or
 * null. The dialog's own checks first (they name trucks by letter), then the
 * server's rule — planLoadSplit over the GET's rows — so Save is never enabled
 * for a split the server would refuse.
 */
export function splitErrorOf(input: {
  rows: readonly LoadRow[];
  sourceRowId: number;
  lines: readonly DialogLine[];
  typed: Typed;
  trucks: number;
  active: readonly ActiveLine[];
}): string | null {
  const { lines, typed, trucks } = input;
  if (typed.some((row) => row.some((raw) => parseTins(raw) === null))) return "Whole tins only, no negatives.";
  if (lines.some((l, i) => restOf(l, typed[i]) < 0)) return "More tins typed than this invoice has.";
  for (let t = 0; t < trucks; t++) {
    if (lines.every((_, i) => onTruck(lines, typed, i, t, trucks) === 0)) return `${truckName(t)} has no tins.`;
  }
  const planned = planLoadSplit({
    rows: input.rows,
    sourceRowId: input.sourceRowId,
    trucks: trucksOf(lines, typed, trucks),
    active: input.active,
    obdHeld: false, // hold is copied, never checked — it cannot refuse a split
  });
  return planned.ok ? null : planned.errors[0];
}

/**
 * The GET's rows (design §G LoadView.rows) as the rules read them. `lines` are
 * already resolved (an unsplit seq 1 lists every active line).
 */
export function loadRowsOfView(
  rows: ReadonlyArray<{
    id: number;
    seq: number;
    source: string;
    rootId: number;
    invoiceNo: string | null;
    invoiceDate: string | null;
    tripDropId: number | null;
    tripNumber: string | null;
    isHeld: boolean;
    isDispatched: boolean;
    lines: ReadonlyArray<{ rawLineItemId: number; qty: number }>;
  }>,
): LoadRow[] {
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    source: r.source,
    loadParentId: r.rootId === r.id ? null : r.rootId,
    invoiceNo: r.invoiceNo,
    invoiceDate: r.invoiceDate === null ? null : new Date(r.invoiceDate),
    tripDropId: r.tripDropId,
    tripNumber: r.tripNumber,
    isHeld: r.isHeld,
    heldAt: null,
    heldById: null,
    isDispatched: r.isDispatched,
    lines: r.lines.map((l) => ({ rawLineItemId: l.rawLineItemId, qty: l.qty })),
  }));
}
