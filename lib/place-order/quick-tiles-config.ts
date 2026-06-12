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
  familyName?:     string;                                // when type === "family" (primary family — drives tile highlight)
  familyNames?:    string[];                              // OPTIONAL multi-family group (e.g. PRIMER + DISTEMPER under one tile).
                                                          // When set, the desktop panel renders all listed families' rows as one
                                                          // flat tab-set (tabs come from each family's uiGroup). UI/nav grouping
                                                          // ONLY — families stay separate in data/section/search. familyName must
                                                          // be one of these (it keeps the existing single-family highlight working).
  subProductName?: string;                                // when type === "sub-product"
  sectionName?:    string;                                // when type === "section"
};

export const QUICK_TILES_V1: ReadonlyArray<QuickTile> = [
  { position: 1, type: "family",      label: "GLOSS",          parentLabel: "ENAMELS",   familyName:     "GLOSS"          },
  { position: 2, type: "family",      label: "SATIN",          parentLabel: "ENAMELS",   familyName:     "SATIN"          },
  { position: 3, type: "family",      label: "PROMISE",        parentLabel: "PROMISE",   familyName:     "PROMISE"        },
  { position: 4, type: "family",      label: "WS",             parentLabel: "EXTERIORS", familyName:     "WS"             },
  { position: 5, type: "family",      label: "VELVET TOUCH",   parentLabel: "INTERIORS", familyName:     "VELVET TOUCH"   },
  { position: 6, type: "family",      label: "SADOLIN",        parentLabel: "WOODCARE",  familyName:     "SADOLIN"        },
  { position: 7, type: "family",      label: "STAINER",        parentLabel: "UTILITY",   familyName:     "STAINER"        },
  { position: 8, type: "family",      label: "Putty & Primer", parentLabel: "UTILITY", familyName: "PRIMER", familyNames: ["PRIMER", "DISTEMPER", "PUTTY", "TEXTURE"] },
  { position: 9, type: "family",      label: "AQUATECH",       parentLabel: "UTILITY",   familyName:     "AQUATECH"       },
];
