import { prisma } from "@/lib/prisma";

// ── Subject signal patterns ────────────────────────────────────────────────

interface SubjectSignal {
  pattern: RegExp;
  remarkType: string;
  label: string;
}

// Order matters: longer/more specific patterns first to avoid partial matches
const SUBJECT_SIGNALS: SubjectSignal[] = [
  // Cross billing (with optional code)
  { pattern: /\bcross\s+billing\s+\w*/i, remarkType: "cross", label: "Cross billing" },
  { pattern: /\bcross\s+bill\b/i, remarkType: "cross", label: "Cross bill" },
  { pattern: /\bdo\s+cross\b/i, remarkType: "cross", label: "Do cross" },

  // Timing
  { pattern: /\bbill\s+tomorrow\b/i, remarkType: "timing", label: "Bill Tomorrow" },
  { pattern: /\b7\s*days?\b/i, remarkType: "timing", label: "7 Days" },
  { pattern: /\bextension\b/i, remarkType: "timing", label: "Extension" },

  // Blockers
  { pattern: /\bbounce\b/i, remarkType: "blocker", label: "Bounce" },
  { pattern: /\boverdue\b/i, remarkType: "blocker", label: "Overdue" },
  { pattern: /\bCIC\b/, remarkType: "blocker", label: "CIC" },
  { pattern: /\bCI\b/, remarkType: "blocker", label: "CI" },
  { pattern: /\bOD\b/, remarkType: "blocker", label: "OD" },

  // Instructions
  { pattern: /\bsave\s+and\s+share\s+(?:dpl|value)\b/i, remarkType: "instruction", label: "Share DPL" },
  { pattern: /\bshare\s+dpl\s*(?:value)?\b/i, remarkType: "instruction", label: "Share DPL" },
  { pattern: /\bshare\s+value\b/i, remarkType: "instruction", label: "Share Value" },
  { pattern: /\bcall\s+(?:to\s+)?so\b/i, remarkType: "instruction", label: "Call SO" },
  { pattern: /\bcall\s+(?:to\s+)?dealer\b/i, remarkType: "instruction", label: "Call Dealer" },

  // Context
  { pattern: /\btruck\s+order\b/i, remarkType: "context", label: "Truck" },
  { pattern: /\btruck\b/i, remarkType: "context", label: "Truck" },
  { pattern: /\bchallan\b/i, remarkType: "context", label: "Challan" },
];

interface SubjectParseResult {
  customerCode: string | null;
  customerName: string;
  remarks: Array<{
    text: string;
    remarkType: string;
  }>;
}

export function parseSubject(subject: string): SubjectParseResult {
  let s = subject.trim();

  // Step 1: Strip forwarding prefixes (FW:, Fwd:, RE:, Re:) -- repeated
  s = s.replace(/^(?:(?:fw|fwd|re)\s*:\s*)+/i, "").trim();

  // Step 1b: Strip leading "Urgent" (noise -- not a remark worth storing)
  s = s.replace(/^urgent\s+/i, "").trim();

  // Step 2: Strip "Order" prefix and extract code if present
  let customerCode: string | null = null;

  if (/^order\s*:/i.test(s)) {
    s = s.replace(/^order\s*:\s*/i, "").trim();
  } else if (/^order\s+for\s+/i.test(s)) {
    s = s.replace(/^order\s+for\s+/i, "").trim();
  } else if (/^order-(\d+)\s*/i.test(s)) {
    const m = s.match(/^order-(\d+)\s*/i);
    if (m) customerCode = m[1];
    s = s.replace(/^order-\d+\s*/i, "").trim();
  } else if (/^order\s+-\s*/i.test(s)) {
    s = s.replace(/^order\s+-\s*/i, "").trim();
  } else if (/^order\s+/i.test(s)) {
    s = s.replace(/^order\s+/i, "").trim();
  }

  // Step 2b: Strip trailing noise
  s = s.replace(/\s*-\s*order$/i, "").trim();
  s = s.replace(/-order$/i, "").trim();
  s = s.replace(/\.+$/, "").trim();

  // Step 2c: Leading code (e.g. "3128017 Polishwala Trading Co")
  if (!customerCode) {
    const leadCode = s.match(/^(\d{4,})\s+/);
    if (leadCode) {
      customerCode = leadCode[1];
      s = s.replace(/^\d{4,}\s+/, "").trim();
    }
    // Also check bare code (e.g. "3128017" with nothing else)
    if (!customerCode && /^\d{4,}$/.test(s)) {
      customerCode = s;
      s = "";
    }
  }

  // Step 2d: Trailing code (e.g. "Shivam Paints 549434")
  if (!customerCode) {
    const trailCode = s.match(/\s+(\d{4,})$/);
    if (trailCode) {
      customerCode = trailCode[1];
      s = s.replace(/\s+\d{4,}$/, "").trim();
    }
  }

  // Step 2e: Parenthesized code (e.g. "Shivam Paints (549434)")
  if (!customerCode) {
    const parenCode = s.match(/\s*\((\d{4,})\)\s*/);
    if (parenCode) {
      customerCode = parenCode[1];
      s = s.replace(/\s*\(\d{4,}\)\s*/, " ").trim();
    }
  }

  // Step 2f: Trailing dash-code (e.g. "aai Shree Khodiyar-549434")
  if (!customerCode) {
    const dashCode = s.match(/-(\d{4,})$/);
    if (dashCode) {
      customerCode = dashCode[1];
      s = s.replace(/-\d{4,}$/, "").trim();
    }
  }

  // Step 3: Scan for remark signals and strip them from string
  const remarks: Array<{ text: string; remarkType: string }> = [];
  const seenLabels = new Set<string>();

  for (const signal of SUBJECT_SIGNALS) {
    const match = s.match(signal.pattern);
    if (match && !seenLabels.has(signal.label)) {
      seenLabels.add(signal.label);
      remarks.push({
        text: match[0].trim(),
        remarkType: signal.remarkType,
      });
      // Strip the matched signal from the string
      s = s.replace(signal.pattern, " ").trim();
    }
  }

  // Step 4: Clean remaining string = customer name
  // Strip leftover noise: "Save and", "value", dangling punctuation
  s = s.replace(/\bsave\s+and\b/i, "").trim();
  s = s.replace(/\bvalue\b/i, "").trim();
  s = s.replace(/^[\s\-:.,]+|[\s\-:.,]+$/g, "").trim();
  // Collapse multiple spaces
  s = s.replace(/\s{2,}/g, " ").trim();

  return {
    customerCode,
    customerName: s,
    remarks,
  };
}

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

  // 1b. Strip leading "Urgent"
  s = s.replace(/^urgent\s+/i, "").trim();

  // 2. Strip "Order" prefix patterns
  if (/^order\s*:/i.test(s)) {
    s = s.replace(/^order\s*:\s*/i, "").trim();
  } else if (/^order\s+for\s+/i.test(s)) {
    s = s.replace(/^order\s+for\s+/i, "").trim();
  } else if (/^order-(\d+)\s*/i.test(s)) {
    const codeNumMatch = s.match(/^order-(\d+)\s*/i);
    const codeNum = codeNumMatch ? codeNumMatch[1] : '';
    s = s.replace(/^order-\d+\s*/i, "").trim();
    // Prepend the code so matchCustomer() Step 0 can do exact code lookup
    if (codeNum) s = s ? `${codeNum} ${s}` : codeNum;
  } else if (/^order\s+-\s*/i.test(s)) {
    s = s.replace(/^order\s+-\s*/i, "").trim();
  } else if (/^order\s+/i.test(s)) {
    s = s.replace(/^order\s+/i, "").trim();
  }

  // 3. Strip trailing noise
  s = s.replace(/\s*-\s*order$/i, "").trim();
  s = s.replace(/-order$/i, "").trim();
  s = s.replace(/\.+$/, "").trim();

  // 4a. Trailing code → prepend for matchCustomer Step 0
  const trailingCode = s.match(/\s+(\d{4,})$/);
  if (trailingCode) {
    const code = trailingCode[1];
    const nameOnly = s.replace(/\s+\d{4,}$/, "").trim();
    s = nameOnly ? `${code} ${nameOnly}` : code;
  }

  // 5. Fallback
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

// ── Token-based keyword matching engine (v2) ───────────────────────────────
//
// Scoring algorithm:
//   1. Build token frequency table from all keyword rows (rarity = weight)
//   2. Tokenize input into uppercase words, strip noise
//   3. Score each candidate by matched token weights + bonuses/penalties
//   4. Classify: exact (decisive winner), multiple (ambiguous), unmatched
//
// Special cases preserve fast paths for exact string matches and
// substring containment of long keywords.

const NOISE_WORDS = new Set([
  "AND", "OF", "THE", "FOR", "ORDER", "MR", "MRS", "SIR",
  "WITH", "FROM", "TO", "IN", "AT", "BY",
]);

/** Split a string into uppercase tokens, stripping noise words and punctuation */
function tokenize(s: string): string[] {
  return s
    .toUpperCase()
    .split(/[\s&.,\-:]+/)
    .map(t => t.replace(/[^A-Z0-9/]/g, ""))
    .filter(t => t.length > 0 && !NOISE_WORDS.has(t));
}

/** Simple Levenshtein distance for short strings (area fuzzy match) */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 1) return 2; // early exit — distance > 1
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Check if two tokens match with area-level fuzziness (exact, prefix, or edit distance ≤ 1) */
function fuzzyAreaMatch(token: string, area: string): boolean {
  if (token.length < 4 || area.length < 4) return token === area;
  if (token === area) return true;
  if (token.startsWith(area) || area.startsWith(token)) return true;
  return levenshtein(token, area) <= 1;
}

async function matchByKeywords(name: string): Promise<CustomerMatchResult> {
  const rows = await prisma.mo_customer_keywords.findMany();
  const nameUpper = name.trim().toUpperCase();

  if (!nameUpper) return UNMATCHED;

  // ── Special case: exact string match (fast path, score 200) ──────────
  for (const row of rows) {
    if (
      nameUpper === row.keyword.trim().toUpperCase() ||
      nameUpper === row.customerName.trim().toUpperCase()
    ) {
      return {
        customerCode: row.customerCode,
        customerName: row.customerName,
        customerMatchStatus: "exact",
        customerCandidates: null,
      };
    }
  }

  // ── Step 1: Build token frequency table (rarity weighting) ───────────
  // Count how many unique customerCodes each token appears in.
  const tokenCustomerSets = new Map<string, Set<string>>();
  for (const row of rows) {
    const allTokens = [
      ...tokenize(row.customerName),
      ...tokenize(row.keyword),
    ];
    const unique = new Set(allTokens);
    for (const t of Array.from(unique)) {
      let s = tokenCustomerSets.get(t);
      if (!s) { s = new Set(); tokenCustomerSets.set(t, s); }
      s.add(row.customerCode);
    }
  }

  function tokenWeight(t: string): number {
    const count = tokenCustomerSets.get(t)?.size ?? 0;
    if (count <= 2) return 10;  // very rare — area names, unique words
    if (count <= 5) return 5;   // rare
    if (count <= 15) return 3;  // moderate
    return 1;                   // common — HARDWARE, PAINTS, COLOUR
  }

  // ── Step 2: Tokenize input ───────────────────────────────────────────
  const inputTokens = tokenize(nameUpper);
  if (inputTokens.length === 0) return UNMATCHED;

  // ── Step 3: Score each candidate row ─────────────────────────────────
  // Best score per customerCode (one customer can have multiple keyword rows)
  const bestPerCode = new Map<string, { row: (typeof rows)[number]; score: number }>();

  for (const row of rows) {
    const kwTokens = tokenize(row.keyword);
    const cnTokens = tokenize(row.customerName);
    const areaTokens = row.area ? tokenize(row.area) : [];

    // Score against keyword tokens and customerName tokens, take the better one
    const kwScore = scoreTokens(inputTokens, kwTokens, areaTokens, tokenWeight);
    const cnScore = scoreTokens(inputTokens, cnTokens, areaTokens, tokenWeight);
    let score = Math.max(kwScore, cnScore);

    // ── Substring containment bonuses ──────────────────────────────
    const kwUpper = row.keyword.trim().toUpperCase();
    const cnUpper = row.customerName.trim().toUpperCase();

    // Input contains full keyword (keyword ≥ 10 chars)
    if (kwUpper.length >= 10 && nameUpper.includes(kwUpper)) score += 15;
    else if (cnUpper.length >= 10 && nameUpper.includes(cnUpper)) score += 15;

    // Keyword contains full input (input ≥ 8 chars)
    if (nameUpper.length >= 8 && kwUpper.includes(nameUpper)) score += 10;
    else if (nameUpper.length >= 8 && cnUpper.includes(nameUpper)) score += 10;

    if (score > 0) {
      const existing = bestPerCode.get(row.customerCode);
      if (!existing || score > existing.score) {
        bestPerCode.set(row.customerCode, { row, score });
      }
    }
  }

  // ── Step 4: Rank and classify ────────────────────────────────────────
  const deduped = Array.from(bestPerCode.values()).sort((a, b) => b.score - a.score);

  if (deduped.length === 0) return UNMATCHED;

  const topScore = deduped[0].score;
  const secondScore = deduped.length > 1 ? deduped[1].score : 0;
  const topMatchedRatio = getMatchedRatio(inputTokens, deduped[0].row, tokenize);

  // Exact: score ≥ 15, at least 1.5× second, and ≥ 50% input tokens matched
  if (topScore >= 15 && topScore >= secondScore * 1.5 && topMatchedRatio >= 0.5) {
    return {
      customerCode: deduped[0].row.customerCode,
      customerName: deduped[0].row.customerName,
      customerMatchStatus: "exact",
      customerCandidates: null,
    };
  }

  // Multiple: score ≥ 8 but not decisive
  if (topScore >= 8) {
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

  // Unmatched: top score < 8
  return UNMATCHED;
}

/** Calculate the ratio of input tokens that match any token in the candidate row */
function getMatchedRatio(
  inputTokens: string[],
  row: { keyword: string; customerName: string },
  tokenizeFn: (s: string) => string[],
): number {
  const candidateTokens = new Set([
    ...tokenizeFn(row.keyword),
    ...tokenizeFn(row.customerName),
  ]);
  const matched = inputTokens.filter(t => candidateTokens.has(t)).length;
  return inputTokens.length > 0 ? matched / inputTokens.length : 0;
}

/**
 * Score input tokens against candidate tokens.
 *
 * Base score = sum of rarity weights for matched tokens.
 * Bonuses: +5 first-token match, +3 per consecutive pair, +8 area match, +3 length match.
 * Penalties: -5 if < 50% input matched, -3 if < 50% candidate matched.
 */
function scoreTokens(
  inputTokens: string[],
  candidateTokens: string[],
  areaTokens: string[],
  weightFn: (t: string) => number,
): number {
  if (candidateTokens.length === 0) return 0;

  const candidateSet = new Set(candidateTokens);
  const inputSet = new Set(inputTokens);

  // Base score: sum of weights for each input token that matches a candidate token
  let score = 0;
  const matchedInput: boolean[] = inputTokens.map(t => {
    if (candidateSet.has(t)) { score += weightFn(t); return true; }
    return false;
  });

  if (score === 0) return 0;

  // +5 first meaningful token match
  if (inputTokens.length > 0 && candidateTokens.length > 0 &&
      inputTokens[0] === candidateTokens[0]) {
    score += 5;
  }

  // +3 per consecutive matched token pair in input that also appears consecutive in candidate
  for (let i = 0; i < inputTokens.length - 1; i++) {
    if (!matchedInput[i] || !matchedInput[i + 1]) continue;
    const a = inputTokens[i], b = inputTokens[i + 1];
    for (let j = 0; j < candidateTokens.length - 1; j++) {
      if (candidateTokens[j] === a && candidateTokens[j + 1] === b) {
        score += 3;
        break;
      }
    }
  }

  // +8 area match (any input token fuzzy-matches an area token)
  if (areaTokens.length > 0) {
    for (const it of inputTokens) {
      if (areaTokens.some(at => fuzzyAreaMatch(it, at))) {
        score += 8;
        break; // only one area bonus per candidate
      }
    }
  }

  // +3 token count match
  if (inputTokens.length === candidateTokens.length) {
    score += 3;
  }

  // Penalties
  const inputMatchCount = matchedInput.filter(Boolean).length;
  const candidateMatchCount = candidateTokens.filter(t => inputSet.has(t)).length;

  if (inputMatchCount / inputTokens.length < 0.5) score -= 5;
  if (candidateMatchCount / candidateTokens.length < 0.5) score -= 3;

  return Math.max(0, score);
}
