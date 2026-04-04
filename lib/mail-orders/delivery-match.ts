import { prisma } from "@/lib/prisma";

const STRIP_PREFIXES = [
  /^delivery\s+to\s+/i,
  /^deliver\s+to\s+/i,
  /^dispatch\s+to\s+/i,
  /^send\s+to\s+/i,
  /^challan\s+in\s+name\s+of\s+/i,
  /^challan\s+/i,
];

const SKIP_WORDS = new Set([
  "attachment", "attached", "copy", "required", "urgent",
  "asap", "please", "today", "tomorrow",
]);

function cleanDeliveryRemarks(raw: string): string {
  let text = raw.trim();

  // Strip known prefixes
  for (const re of STRIP_PREFIXES) {
    text = text.replace(re, "").trim();
  }

  // If remaining text is a single skip-word, discard
  if (SKIP_WORDS.has(text.toLowerCase())) return "";

  // Strip trailing punctuation
  text = text.replace(/[.,;:!]+$/, "").trim();

  return text;
}

/**
 * Search deliveryRemarks against delivery_point_master
 * to detect ship-to override.
 *
 * Returns matched customer if found AND different from
 * the main order customer. Returns null otherwise.
 */
export async function matchDeliveryCustomer(
  deliveryRemarks: string,
  mainCustomerCode: string | null,
): Promise<{
  customerCode: string;
  customerName: string;
  isOverride: boolean;
} | null> {
  if (!deliveryRemarks || !deliveryRemarks.trim()) return null;

  const cleaned = cleanDeliveryRemarks(deliveryRemarks);
  if (!cleaned || cleaned.length < 3) return null;

  // Search delivery_point_master with ILIKE
  const matches = await prisma.delivery_point_master.findMany({
    where: {
      customerName: { contains: cleaned, mode: "insensitive" },
      isActive: true,
    },
    select: { customerCode: true, customerName: true },
    take: 5,
  });

  // Only proceed on exactly 1 match (unambiguous)
  if (matches.length !== 1) return null;

  const match = matches[0];

  // If main customer not yet matched → flag as override (conservative)
  if (!mainCustomerCode) {
    return {
      customerCode: match.customerCode,
      customerName: match.customerName,
      isOverride: true,
    };
  }

  // Same customer → not an override
  if (match.customerCode === mainCustomerCode) return null;

  return {
    customerCode: match.customerCode,
    customerName: match.customerName,
    isOverride: true,
  };
}
