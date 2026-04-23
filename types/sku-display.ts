import type { FiniPair } from "@/lib/fini-resolver";
import type { SkuDisplayMode } from "@/lib/hooks/use-sku-display-mode";

export type SkuDisplay = {
  sap: {
    code:        string;
    description: string | null;
  };
  fini: {
    code:        string;
    description: string | null;
  } | null;
};

export function buildSkuDisplay(
  skuCodeRaw:        string,
  skuDescriptionRaw: string | null,
  finiMap:           Map<string, FiniPair>,
): SkuDisplay {
  const hit = finiMap.get(skuCodeRaw);
  return {
    sap:  { code: skuCodeRaw, description: skuDescriptionRaw },
    fini: hit ? { code: hit.material, description: hit.description } : null,
  };
}

export function pickSkuDisplay(
  skuDisplay: SkuDisplay,
  mode:       SkuDisplayMode,
): { code: string; description: string | null } {
  if (mode === "fini" && skuDisplay.fini) return skuDisplay.fini;
  return skuDisplay.sap;
}
