/**
 * Signature / footer / mail-header junk filter for mail-order NOTES.
 *
 * The parser turns every non-product line into a remark row, so email
 * signatures, "Sent from…" footers and forwarded-mail headers reach
 * mo_order_remarks (the purple NOTES strip). Ingest drops those lines here.
 * Anything not matched below is kept — product lines, customer names,
 * addresses, other phone numbers and every real instruction stay untouched.
 */

// Owner-approved 2026-09-26. Signatures only — do not widen without a review of live notes.
const JUNK_EXACT = [
  "sunil nishad",
  "thanks",
  "thank you",
  "thanks and regards",
  "regards",
  "--",
  "bhaven upadhyay wc",
] as const;

// Owner-approved 2026-09-26. Signatures only — do not widen without a review of live notes.
const JUNK_PREFIXES = ["sent using ", "sent from ", "get outlook for"] as const;

// Owner-approved 2026-09-26. Signatures only — do not widen without a review of live notes.
const JUNK_CONTAINS = ["forwarded message"] as const;

// Owner-approved 2026-09-26. Signatures only — do not widen without a review of live notes.
const JUNK_SIGNATURE_PHONES = ["9662625517"] as const;

/** Mail-header line — anchored, so "Ship To:" / "Bill To:" never match. */
const MAIL_HEADER_RE = /^(from|to|cc|date)\s*:/;

/** The whole line is one email address (optionally <mailto:…>-wrapped). */
const EMAIL_ONLY_RE = /^<?(mailto:)?[\w.+-]+@[\w-]+(\.[\w-]+)+>?$/;

/** The whole line is one @mention: "@(JSW) Jaymin Shah <mailto:…>", nothing after. */
const MENTION_ONLY_RE = /^@\S+(\s+[a-z.]+){0,3}(\s*<[^>]*>)*$/;

/** A phone label ("Mo:", "Mo.", "Mob -", "Phone") followed by the number, nothing else. */
const PHONE_LABEL_RE = /^(mo|mob|mobile|m|ph|phone|cell)\s*\.?\s*(no\.?)?\s*[:.\-]?\s*(\+?91[\s-]?)?(\d{10})$/;

function collapse(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalise(text: string): string {
  return collapse(text).replace(/[\s.*,:\-]+$/, "");
}

export function isSignatureJunk(text: string, soName?: string | null): boolean {
  if (!text) return false;
  const collapsed = collapse(text);
  const norm = normalise(text);

  // a. the sender's own name on a line by itself
  if (soName) {
    const so = normalise(soName);
    if (so.length >= 4 && norm === so) return true;
  }

  // b. exact sign-offs ("--" is checked pre-strip, since stripping empties it)
  for (const s of JUNK_EXACT) {
    if (norm === s || collapsed === s) return true;
  }

  // c. mail-client footers
  for (const p of JUNK_PREFIXES) {
    if (norm.startsWith(p)) return true;
  }

  // d. forwarded-mail marker, or a bare email / @mention line
  for (const c of JUNK_CONTAINS) {
    if (norm.includes(c)) return true;
  }
  if (EMAIL_ONLY_RE.test(norm) || MENTION_ONLY_RE.test(norm)) return true;

  // e. mail headers
  if (MAIL_HEADER_RE.test(norm)) return true;

  // f. signature phone with only a label in front
  const phone = PHONE_LABEL_RE.exec(norm);
  if (phone && (JUNK_SIGNATURE_PHONES as readonly string[]).includes(phone[4])) return true;

  return false;
}
