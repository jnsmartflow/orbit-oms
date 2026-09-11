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
  /**
   * Section grouping in the Tags admin UI. The Tags tab groups by this value in
   * FIRST-SEEN order, so a new group appears simply by using it on an entry —
   * there is no second list to keep in step.
   */
  group:       "Mail Orders" | "Violet band (Billing)";
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
  // ── Added 2026-09-11 — the Billing face's un-switchable badges ────────────
  // Every one of these renders OUTSIDE getOrderSignals(), so each is gated at
  // its own render call site rather than by that function's filter. Evidence:
  // docs/prompts/drafts/code-discovery-2026-09-11-hide-tags-billing.md §A.
  keyCustomer:      "mail_orders.key_customer",
  matchChip:        "mail_orders.match_chip",
  punchedBy:        "mail_orders.punched_by",
  notesBand:        "mail_orders.notes_band",
  deliveryLine:     "mail_orders.delivery_line",
  billLine:         "mail_orders.bill_line",
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
  // ⚠ NOT a cosmetic switch, which is why it is `important`. Turning this off
  // makes the Ship To card show the BILL-TO dealer in place of the real delivery
  // dealer, with nothing on the card saying the bill was redirected — the card
  // falls back to the bill-to identity wholesale (ship-to-card.tsx:90-95). On the
  // Billing face the redirect is something the operator set with the ✎ pencil
  // minutes earlier, so this is a screen disagreeing with the database, not a pill
  // being hidden. Reworded + flagged 2026-09-11.
  { tagKey: MO_TAG.captured,       label: "Ship-to captured", group: "Mail Orders", description: "The ⚑ pill and amber bar marking a redirected delivery. Turning it off makes the Ship To card show the BILL-TO dealer instead of the real delivery dealer.", important: true  },
  { tagKey: MO_TAG.keyCustomer,    label: "Key dealer (★)",   group: "Mail Orders", description: "Amber star on the inbox row and the “Key” pill on the Bill To card.", important: false },
  { tagKey: MO_TAG.matchChip,      label: "Match chip",       group: "Mail Orders", description: "The ✓ 6/6 readiness chip above the SKU lines, counting matched lines.", important: false },
  { tagKey: MO_TAG.punchedBy,      label: "Punched-by line",  group: "Mail Orders", description: "“punched by Bankim 14:20” on the order ribbon, once an order is punched.", important: false },

  // ── The violet instruction band, one switch per row ───────────────────────
  // Three separate keys, not one: the rows come from three different places and
  // an operator who wants the delivery line may still want the notes line gone.
  { tagKey: MO_TAG.notesBand,      label: "Notes line",       group: "Violet band (Billing)", description: "The NOTES row of the violet band — remarks the parser found in the email. Does NOT affect the operator’s own note, which stays on the Notes button.", important: false },
  { tagKey: MO_TAG.deliveryLine,   label: "Delivery line",    group: "Violet band (Billing)", description: "The DELIVERY row of the violet band, from the email’s delivery remark.", important: false },
  { tagKey: MO_TAG.billLine,       label: "Bill line",        group: "Violet band (Billing)", description: "The BILL row of the violet band, from the email’s billing remark.", important: false },
];
