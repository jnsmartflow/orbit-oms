// ─────────────────────────────────────────────────────────────────────────────
// Tag catalog (Feature B) — the toggleable UI badges, one entry per tag.
//
// Leaf module: no imports from the mail-orders feature, so utils.ts / ship-to-card
// / the Tags admin UI can all import these stable keys without a cycle.
//
// Default-ON: a tag with no app_tag_settings row renders normally. Only an
// explicit isEnabled=false hides it (see lib/hide/tag-settings.ts).
// ─────────────────────────────────────────────────────────────────────────────

export interface TagCatalogEntry {
  /** Stable key — matches app_tag_settings.tagKey and OrderSignal.tagKey. */
  tagKey:      string;
  /** Human label shown in the Tags admin UI. */
  label:       string;
  /** Section grouping in the Tags admin UI. */
  group:       "Mail Orders";
  /** One-line description of what the badge means. */
  description: string;
  /** Important tags prompt a confirm before turning OFF; cosmetic ones don't. */
  important:   boolean;
}

// Stable key constants — reference these instead of string literals.
export const MO_TAG = {
  od:               "mail_orders.od",
  ci:               "mail_orders.ci",
  bounce:           "mail_orders.bounce",
  billTomorrow:     "mail_orders.bill_tomorrow",
  cross:            "mail_orders.cross",
  urgent:           "mail_orders.urgent",
  sevenDays:        "mail_orders.seven_days",
  extension:        "mail_orders.extension",
  bill:             "mail_orders.bill",
  dpl:              "mail_orders.dpl",
  challan:          "mail_orders.challan",
  truckOrder:       "mail_orders.truck_order",
  splitLabel:       "mail_orders.split_label",
  splitSuggestion:  "mail_orders.split_suggestion",
  hold:             "mail_orders.hold",
  captured:         "mail_orders.captured",
} as const;

export const TAG_CATALOG: TagCatalogEntry[] = [
  { tagKey: MO_TAG.hold,            label: "Hold",             group: "Mail Orders", description: "Red badge when the order's dispatch status is Hold.",        important: true  },
  { tagKey: MO_TAG.od,             label: "OD (Overdue)",     group: "Mail Orders", description: "Red blocker when the bill is overdue.",                       important: true  },
  { tagKey: MO_TAG.ci,             label: "CI (Credit Issue)", group: "Mail Orders", description: "Red blocker when the order is on credit hold / block.",      important: true  },
  { tagKey: MO_TAG.bounce,         label: "Bounce",           group: "Mail Orders", description: "Red blocker when a cheque/payment bounce is flagged.",        important: false },
  { tagKey: MO_TAG.billTomorrow,   label: "Bill Tomorrow",    group: "Mail Orders", description: "Amber badge when billing is deferred to the next day.",       important: false },
  { tagKey: MO_TAG.cross,          label: "Cross Billing",    group: "Mail Orders", description: "Amber badge when the order is a cross-billing.",              important: false },
  { tagKey: MO_TAG.urgent,         label: "Urgent",           group: "Mail Orders", description: "Amber badge when dispatch priority is Urgent.",               important: false },
  { tagKey: MO_TAG.sevenDays,      label: "7 Days",           group: "Mail Orders", description: "Gray badge for a 7-day credit note.",                         important: false },
  { tagKey: MO_TAG.extension,      label: "Extension",        group: "Mail Orders", description: "Gray badge when a credit extension is noted.",                important: false },
  { tagKey: MO_TAG.bill,           label: "Bill N",           group: "Mail Orders", description: "Blue badge carrying the parser bill number.",                 important: false },
  { tagKey: MO_TAG.dpl,            label: "DPL",              group: "Mail Orders", description: "Gray badge when DPL is referenced.",                          important: false },
  { tagKey: MO_TAG.challan,        label: "Challan",          group: "Mail Orders", description: "Gray badge when a challan attachment is present.",            important: false },
  { tagKey: MO_TAG.truckOrder,     label: "Truck Order",      group: "Mail Orders", description: "Violet truck pill — punch when material is received.",        important: false },
  { tagKey: MO_TAG.splitLabel,     label: "Split (✂ Bill)",   group: "Mail Orders", description: "Purple badge on the split halves of a bill.",                 important: false },
  { tagKey: MO_TAG.splitSuggestion, label: "Split suggestion", group: "Mail Orders", description: "Amber-dot badge suggesting a large order be split.",        important: false },
  { tagKey: MO_TAG.captured,       label: "Ship-to captured", group: "Mail Orders", description: "Amber ⚑ pill when a delivery override is detected.",         important: false },
];
