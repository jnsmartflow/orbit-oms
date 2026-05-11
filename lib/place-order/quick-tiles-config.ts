// Speed-dial v1 — locked configuration for the 9-tile dial above the
// variant grid. Served by /api/place-order/quick-tiles. Changing this list
// is a server-side edit — no frontend changes needed (clients re-fetch on
// mount). Future modes (by order volume, per-user, family-filtered) swap
// the source behind the same endpoint contract.

export type QuickTile = {
  position:        number;                                // 1-9
  type:            "sub-product" | "family" | "section";
  label:           string;                                // "GLOSS", "VT GLO", "WOODCARE"
  parentLabel:     string | null;                        // "ENAMELS" / null for sections
  familyName?:     string;                                // when type === "family"
  subProductName?: string;                                // when type === "sub-product"
  sectionName?:    string;                                // when type === "section"
};

export const QUICK_TILES_V1: ReadonlyArray<QuickTile> = [
  { position: 1, type: "family",      label: "GLOSS",          parentLabel: "ENAMELS",   familyName:     "GLOSS"          },
  { position: 2, type: "family",      label: "SATIN",          parentLabel: "ENAMELS",   familyName:     "SATIN"          },
  { position: 3, type: "sub-product", label: "PROMISE ENAMEL", parentLabel: "ENAMELS",   subProductName: "PROMISE ENAMEL" },
  { position: 4, type: "family",      label: "MAX",            parentLabel: "EXTERIORS", familyName:     "MAX"            },
  { position: 5, type: "family",      label: "VT GLO",         parentLabel: "INTERIORS", familyName:     "VT GLO"         },
  { position: 6, type: "section",     label: "WOODCARE",       parentLabel: null,        sectionName:    "WOODCARE"       },
  { position: 7, type: "family",      label: "STAINER",        parentLabel: "UTILITY",   familyName:     "STAINER"        },
  { position: 8, type: "family",      label: "PRIMER",         parentLabel: "UTILITY",   familyName:     "PRIMER"         },
  { position: 9, type: "family",      label: "AQUATECH",       parentLabel: "UTILITY",   familyName:     "AQUATECH"       },
];
