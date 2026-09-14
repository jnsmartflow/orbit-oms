// lib/sap-paste/resolve-names.ts
//
// Repairs the customer names SAP's on-screen list cuts short, by looking the
// full name up by customer CODE (which the paste carries complete).
//
// READS THE DATABASE (one read-only findMany) — which is exactly why it lives
// here and not in read-paste.ts / lib/sap-parser, both of which stay pure.
//
// CREATE PATH ONLY. On the patch path the names are already safe:
// lib/import-upsert/header.ts:74 only fills a NULL ship-to name, and bill-to is
// never patched at all — so a shortened name can only ever be STORED by
// createPath (lib/import-upsert.ts:171, :227-230).
//
// Returns NEW objects; never mutates the input.

import { prisma } from "../prisma";
import type { ObdInput } from "../import-upsert/types";

type NameField = "billToCustomerName" | "shipToCustomerName";

/**
 * The on-screen column width of each name. A cut name keeps the column's
 * trailing space, which is then trimmed — so it arrives at WIDTH-2 or WIDTH-1
 * characters, while a name exactly WIDTH long is COMPLETE. Hence length only
 * decides whether to LOOK (>= WIDTH-2); the starts-with test decides whether to
 * REPLACE. 🔴 Never test "was this cut?" by exact length.
 */
const WIDTH: Record<NameField, number> = {
  billToCustomerName: 22,
  shipToCustomerName: 25,
};

const CODE_FOR: Record<NameField, "billToCustomerId" | "shipToCustomerId"> = {
  billToCustomerName: "billToCustomerId",
  shipToCustomerName: "shipToCustomerId",
};

const FIELDS: NameField[] = ["billToCustomerName", "shipToCustomerName"];

/**
 * A name that was looked up and could NOT be completed. Only real problems are
 * recorded — a name the master merely agrees with is kept silently (see (d2)).
 */
export interface KeptName {
  obdNumber: string;
  field:     NameField;
  /** The customer code the lookup used — the de-duplication key for callers. */
  code:      string;
  text:      string;
  reason:    "not-in-master" | "no-match";
}

export interface ResolvePasteNamesResult {
  obds:     ObdInput[];
  repaired: number;
  kept:     KeptName[];
}

/** Case-insensitive, whitespace-run-collapsed form used ONLY for comparison. */
function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

/** Would this field be looked up at all? Rules (a) and (b). */
function needsLookup(obd: ObdInput, field: NameField): boolean {
  const text = obd[field];
  const code = obd[CODE_FOR[field]];
  if (!text || text.trim() === "" || !code || code.trim() === "") return false;
  return text.length >= WIDTH[field] - 2;
}

export async function resolvePasteCustomerNames(
  obds:             ObdInput[],
  createObdNumbers: Set<string>,
): Promise<ResolvePasteNamesResult> {
  // Codes that actually need a lookup — nothing else is queried.
  const codes = new Set<string>();
  for (const o of obds) {
    if (!createObdNumbers.has(o.obdNumber)) continue;
    for (const f of FIELDS) {
      if (needsLookup(o, f)) codes.add(o[CODE_FOR[f]] as string);
    }
  }

  if (codes.size === 0) {
    return { obds: obds.map((o) => ({ ...o })), repaired: 0, kept: [] };
  }

  // ONE read. customerCode is @unique, so each code maps to at most one name.
  const masterRows = await prisma.delivery_point_master.findMany({
    where:  { customerCode: { in: Array.from(codes) } },
    select: { customerCode: true, customerName: true },
  });
  const masterByCode = new Map(masterRows.map((r) => [r.customerCode, r.customerName]));

  let repaired = 0;
  const kept: KeptName[] = [];

  const out = obds.map((o): ObdInput => {
    const next: ObdInput = { ...o };
    if (!createObdNumbers.has(o.obdNumber)) return next;

    for (const f of FIELDS) {
      if (!needsLookup(o, f)) continue;                     // (a) (b)
      const text = o[f] as string;
      const code = o[CODE_FOR[f]] as string;

      const master = masterByCode.get(code);
      if (master === undefined) {                           // (c)
        kept.push({ obdNumber: o.obdNumber, field: f, code, text, reason: "not-in-master" });
        continue;
      }

      // (d) 🔴 THE STARTS-WITH TEST IS THE SAFETY, NOT A REDUNDANCY.
      // Customer code 899199 is the depot's own counter code: one institutional
      // label in the master, the real walk-in buyer's name in SAP, and many
      // different names per code. Without this test every counter sale would be
      // renamed to that one label, and a stale or mistyped master row would
      // silently rename a real customer. It covers 899199 and any future
      // bucket code by itself — do NOT hardcode a code here.
      const m = norm(master);
      const t = norm(text);
      if (m.startsWith(t) && m.length > t.length) {
        next[f] = master; // the master's own spelling and casing
        repaired += 1;
        continue;
      }

      // (d2) QUIET KEEP. The master says the same name — the pasted text was
      // never cut, it just sits at the width limit. Not a problem, so nothing
      // is recorded. Measured on the 12.09 fixture: 35 of the 36 former
      // "no-match" entries were exactly this.
      if (m === t) continue;

      // (e) The master genuinely disagrees (e.g. counter code 899199, whose
      // master label is not the walk-in buyer's name). Keep the pasted text.
      kept.push({ obdNumber: o.obdNumber, field: f, code, text, reason: "no-match" });
    }
    return next;
  });

  return { obds: out, repaired, kept };
}
