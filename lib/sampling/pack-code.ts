// lib/sampling/pack-code.ts — ONE copy of the per-tin pack table and the exact
// match that turns a raw line (volumeLine / unitQty) into a PackCode ENUM value.
//
// Extracted 2026-10-02 (bulk TI step 0 — docs/prompts/drafts/
// code-discovery-2026-10-02-bulk-tinter-issue.md §C, §G) from the two copies
// that had drifted apart only in their labels: components/tint/tint-operator-
// content.tsx and components/tint/manager/base-ti-panel.tsx. The bulk TI route
// (app/api/tint/manager/ti-bulk) is the third reader, so it had to become a lib
// rather than a third copy. Pure — no Prisma, no React — so client and server
// both import it.
//
// ⚠ This returns the PackCode ENUM value ("L_20"), which is what the TI POST
// requires. It is NOT the human label base-pending computes for display
// ("20 L") — two different things, never to be swapped.

/** Ascending by actual litres. `litres` is the authoritative per-unit size
 *  derivePackCode matches against; `label` is the operator screen's display. */
export const PACK_CODES = [
  { value: "ml_500",  label: "500ml",  litres: 0.5   },
  { value: "L_0_9",   label: "0.9L",   litres: 0.9   },
  { value: "L_0_925", label: "0.925L", litres: 0.925 },
  { value: "L_1",     label: "1L",     litres: 1     },
  { value: "L_3_6",   label: "3.6L",   litres: 3.6   },
  { value: "L_3_7",   label: "3.7L",   litres: 3.7   },
  { value: "L_4",     label: "4L",     litres: 4     },
  { value: "L_9",     label: "9L",     litres: 9     },
  { value: "L_9_25",  label: "9.25L",  litres: 9.25  },
  { value: "L_10",    label: "10L",    litres: 10    },
  { value: "L_15",    label: "15L",    litres: 15    },
  { value: "L_18",    label: "18L",    litres: 18    },
  { value: "L_18_5",  label: "18.5L",  litres: 18.5  },
  { value: "L_20",    label: "20L",    litres: 20    },
  { value: "L_22",    label: "22L",    litres: 22    },
  { value: "L_30",    label: "30L",    litres: 30    },
  { value: "L_40",    label: "40L",    litres: 40    },
] as const;

/**
 * Exact-match lookup against PACK_CODES.litres (tolerance 0.005 L — 5× smaller
 * than the smallest adjacent gap, 0.025 L between 0.9 L and 0.925 L). Returns
 * null when the per-unit volume is not a known pack: the caller shows "—" /
 * refuses the line, and never guesses.
 */
export function derivePackCode(volumeLine: number | null, unitQty: number): string | null {
  if (unitQty <= 0 || volumeLine == null) return null;
  const perUnit = volumeLine / unitQty;
  const match = PACK_CODES.find((p) => Math.abs(perUnit - p.litres) < 0.005);
  return match ? match.value : null;
}
