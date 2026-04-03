import { prisma } from "@/lib/prisma";

// ── extractCustomerFromSubject ──────────────────────────────────────────────
//
// Test cases:
//   "FW: Order : Shivam Paints."           → "Shivam Paints"
//   "FW: Order for Ambika Paints"          → "Ambika Paints"
//   "Fwd: Nakoda colours and hardware -order" → "Nakoda colours and hardware"
//   "FW: Order-3436174 REYANSH ENTERPRISES" → "REYANSH ENTERPRISES"
//   "FW: RE: Order : Akshar Marble"        → "Akshar Marble"
//   "FW: Order:Jay Ambe Hardware"          → "Jay Ambe Hardware"
//   "RE: FW: Order : Balaji Paints"        → "Balaji Paints"
//
// Code-prefixed subjects (after prefix stripping):
//   "FW: Order:3128017"                       → code "3128017" → exact match if in DB
//   "FW: Order:109725 Polishwala Trading Co"  → code "109725" → exact if found, else name match "Polishwala Trading Co"
//   "FW: Order:999999"                        → code "999999" → not found → unmatched
//   "FW: Order:312817"                        → typo code → not found → unmatched (correct, no fuzzy)

export function extractCustomerFromSubject(subject: string): string {
  const original = subject.trim();
  let s = original;

  // 1. Strip forwarding prefixes (FW:, Fwd:, RE:, Re:) — repeated
  s = s.replace(/^(?:(?:fw|fwd|re)\s*:\s*)+/i, "").trim();

  // 2. Strip "Order" prefix patterns
  if (/^order\s*:/i.test(s)) {
    s = s.replace(/^order\s*:\s*/i, "").trim();
  } else if (/^order\s+for\s+/i.test(s)) {
    s = s.replace(/^order\s+for\s+/i, "").trim();
  } else if (/^order-\d+\s*/i.test(s)) {
    s = s.replace(/^order-\d+\s*/i, "").trim();
  } else if (/^order\s+/i.test(s)) {
    s = s.replace(/^order\s+/i, "").trim();
  }

  // 3. Strip trailing noise
  s = s.replace(/\s*-\s*order$/i, "").trim();
  s = s.replace(/-order$/i, "").trim();
  s = s.replace(/\.+$/, "").trim();

  // 4. Fallback
  return s || original;
}

// ── matchCustomer ───────────────────────────────────────────────────────────

interface CustomerMatchResult {
  customerCode: string | null;
  customerName: string | null;
  customerMatchStatus: "exact" | "multiple" | "unmatched";
  customerCandidates: string | null;
}

const UNMATCHED: CustomerMatchResult = {
  customerCode: null,
  customerName: null,
  customerMatchStatus: "unmatched",
  customerCandidates: null,
};

export async function matchCustomer(
  extractedName: string,
): Promise<CustomerMatchResult> {
  try {
    const trimmed = extractedName.trim();
    if (!trimmed) return UNMATCHED;

    // ── Step 0: Check if extractedName starts with a customer code ──────
    const codeMatch = trimmed.match(/^(\d{4,})\s*(.*)?$/);
    if (codeMatch) {
      const codePrefix = codeMatch[1];
      const namePart = (codeMatch[2] ?? "").trim();

      const codeRows = await prisma.mo_customer_keywords.findMany({
        where: { customerCode: codePrefix },
      });

      if (codeRows.length > 0) {
        // All rows share the same customerCode — exact match
        return {
          customerCode: codeRows[0].customerCode,
          customerName: codeRows[0].customerName,
          customerMatchStatus: "exact",
          customerCandidates: null,
        };
      }

      // Code not found — fall through with namePart if available
      if (namePart) {
        return matchByKeywords(namePart);
      }
      // Bare code with no name — will likely be unmatched
    }

    // ── Step 1+: Keyword/name matching ─────────────────────────────────
    return matchByKeywords(trimmed);
  } catch (error) {
    console.error("[Customer Match] Error:", error);
    return UNMATCHED;
  }
}

// ── Internal keyword/name matching logic ────────────────────────────────────

async function matchByKeywords(name: string): Promise<CustomerMatchResult> {
  const rows = await prisma.mo_customer_keywords.findMany();
  const nameUpper = name.trim().toUpperCase();

  if (!nameUpper) return UNMATCHED;

  // Find candidates and score them
  const scored: { row: (typeof rows)[number]; score: number }[] = [];

  for (const row of rows) {
    const kwUpper = row.keyword.trim().toUpperCase();
    const cnUpper = row.customerName.trim().toUpperCase();

    let bestScore = -1;

    // keyword matches
    if (nameUpper === kwUpper) {
      bestScore = Math.max(bestScore, 100);
    }
    if (nameUpper.includes(kwUpper) && kwUpper.length > 0) {
      bestScore = Math.max(bestScore, kwUpper.length);
    }
    if (kwUpper.includes(nameUpper) && nameUpper.length > 0) {
      bestScore = Math.max(bestScore, nameUpper.length - 10);
    }

    // customerName matches
    if (nameUpper === cnUpper) {
      bestScore = Math.max(bestScore, 90);
    }
    if (nameUpper.includes(cnUpper) && cnUpper.length > 0) {
      bestScore = Math.max(bestScore, cnUpper.length - 5);
    }
    if (cnUpper.includes(nameUpper) && nameUpper.length > 0) {
      bestScore = Math.max(bestScore, nameUpper.length - 15);
    }

    if (bestScore > 0) {
      scored.push({ row, score: bestScore });
    }
  }

  if (scored.length === 0) return UNMATCHED;

  // Sort by score DESC
  scored.sort((a, b) => b.score - a.score);

  // Deduplicate by customerCode — keep highest score per code
  const seen = new Set<string>();
  const deduped: typeof scored = [];
  for (const entry of scored) {
    if (!seen.has(entry.row.customerCode)) {
      seen.add(entry.row.customerCode);
      deduped.push(entry);
    }
  }

  // 1 unique code → exact
  if (deduped.length === 1) {
    return {
      customerCode: deduped[0].row.customerCode,
      customerName: deduped[0].row.customerName,
      customerMatchStatus: "exact",
      customerCandidates: null,
    };
  }

  // 2+ codes — check if top candidate is decisive
  if (deduped[0].score >= 90 && deduped[1].score < 50) {
    return {
      customerCode: deduped[0].row.customerCode,
      customerName: deduped[0].row.customerName,
      customerMatchStatus: "exact",
      customerCandidates: null,
    };
  }

  // Multiple candidates
  const candidates = deduped.slice(0, 10).map((e) => ({
    code: e.row.customerCode,
    name: e.row.customerName,
    area: e.row.area,
    deliveryType: e.row.deliveryType,
    route: e.row.route,
  }));

  return {
    customerCode: null,
    customerName: null,
    customerMatchStatus: "multiple",
    customerCandidates: JSON.stringify(candidates),
  };
}
