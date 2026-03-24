## Step-by-step Claude Code prompts

Run these **one at a time**. Do not combine. Confirm each step works before moving to the next.

---

### Prompt 1 — Update context file + schema migration SQL
```
Read CLAUDE_CONTEXT_v13.md fully.

We are adding a new feature: Delivery Challan. Before writing any app code,
do the following two things only:

1. Append the new sections from the challan spec to CLAUDE_CONTEXT_v13.md
   (sections 24 + updated folder structure + checklist items 44–50).
   Rename the file to CLAUDE_CONTEXT_v14.md and update the version line at
   the top to: "Version: Phase 3 · Schema v14 · Config Master v2 · Updated March 2026"

2. Generate the SQL migration for Schema v14. Do NOT run it — output it as a
   plain .sql file at /prisma/migrations/v14_delivery_challans.sql containing:
   - CREATE TABLE delivery_challans
   - CREATE TABLE delivery_challan_formulas
   - ALTER TABLE import_raw_summary ADD COLUMN smuNumber TEXT
   Include IF NOT EXISTS guards on all CREATE statements.

Do not touch schema.prisma yet. Do not write any app code.
Report: file names written + SQL contents for review.
```

---

### Prompt 2 — Apply migration + update Prisma schema
```
Read CLAUDE_CONTEXT_v14.md fully.

The SQL in /prisma/migrations/v14_delivery_challans.sql has been applied
in Supabase SQL Editor successfully.

Now:
1. Add the two new models (DeliveryChallan, DeliveryChallanFormula) and the
   new smuNumber field to /prisma/schema.prisma
2. Run: npx prisma generate
3. Run: npx tsc --noEmit
Report any type errors. Do not write any API or UI code yet.
```

---

### Prompt 3 — API: challan list endpoint
```
Read CLAUDE_CONTEXT_v14.md fully.

Create the challan list API route:
GET /api/tint/manager/challans

Requirements:
- Auth: TM + Admin roles only (use requireRole())
- Filter orders where import_raw_summary.smu = 'Retail Offtake' OR 'Project'
- Join: import_raw_summary, orders, delivery_challans (LEFT JOIN — null if not generated)
- Query params supported: date (obdEmailDate), route, smu, search (obdNumber or billToCustomerName ILIKE)
- Response shape: array of { orderId, obdNumber, billToCustomerName, smu,
  obdEmailDate, route, slot, challanNumber | null }
- Follow existing API patterns in /api/tint/manager/orders

Run npx tsc --noEmit after. Report clean or list errors.
```

---

### Prompt 4 — API: single challan GET + auto-create
```
Read CLAUDE_CONTEXT_v14.md fully.

Create:
GET /api/tint/manager/challans/[orderId]

Requirements:
- Auth: TM + Admin roles only
- If no delivery_challans row exists for this orderId → auto-create one:
    challanNumber = CHN-{currentYear}-{MAX(id)+1 padded to 5 digits}
    All other fields null
- Return full challan data joining ALL tables listed in section 24 data sources:
    import_raw_summary, orders, delivery_point_master (bill-to + ship-to),
    delivery_point_contacts, sales_officer_master (via group),
    import_raw_line_items, import_obd_query_summary,
    delivery_challans, delivery_challan_formulas
- Response shape must include all fields needed to render the challan document
  as specified in section 24 — no frontend joins, everything resolved server-side

Run npx tsc --noEmit after. Report clean or list errors.
```

---

### Prompt 5 — API: save challan edits
```
Read CLAUDE_CONTEXT_v14.md fully.

Create:
PATCH /api/tint/manager/challans/[orderId]

Requirements:
- Auth: TM + Admin roles only
- Body type: { transporter?: string, vehicleNo?: string,
  formulas?: { rawLineItemId: number, formula: string }[],
  printedAt?: string, printedBy?: number }
- Upsert delivery_challans: update transporter, vehicleNo, updatedAt
  (and printedAt, printedBy if provided)
- For each item in formulas array: upsert delivery_challan_formulas
  ON CONFLICT (challanId, rawLineItemId) DO UPDATE formula, updatedAt
- Validate: formulas may only reference rawLineItemIds where isTinting = true
  for this order — reject with 400 if not
- Return updated delivery_challans row

Run npx tsc --noEmit after. Report clean or list errors.
```

---

### Prompt 6 — Challan document component
```
Read CLAUDE_CONTEXT_v14.md fully.
Read the approved challan mockup at challan-mockup-v5.html carefully —
this is the exact design to implement.

Create /components/tint/challan-document.tsx

Requirements:
- Pure presentational component — receives all data as props, no fetching
- Props type: ChallanDocumentProps (define fully — all fields from API response)
- isEditing: boolean prop — when true, formula inputs + transporter + vehicleNo
  are active inputs; when false they render as plain text
- onFormulaChange(rawLineItemId, value): callback
- onTransporterChange(value): callback
- onVehicleNoChange(value): callback
- Implement the exact layout from challan-mockup-v5.html:
    S1: navy header — company name left, DELIVERY CHALLAN center, Challan No. right (NO date)
    S2: reference strip — SMU Number | OBD No | OBD Date | Warehouse (4 fields only)
    S3: party grid — Bill To (customer contact) | Ship To (SO + site contacts)
    S5: line items table — # | SKU | Description | Formula | Pack | Qty | Volume | Tinting
    Footer: Terms + editable Transporter/Vehicle | Dispatched By sig | Receiver sig
    Bottom bar: registered office + GSTIN
- Tinting summary badge beside "Line Items" label (only if hasTinting = true)
- Formula column: editable input (amber left border, #fffdf0 bg) only for isTinting rows
- Print CSS via <style> tag with @media print rules embedded in component
- Use Tailwind classes where possible; inline styles only for print-specific rules
- No hardcoded config values — all company details come from props (sourced from system_config)

Run npx tsc --noEmit after. Report clean or list errors.
```

---

### Prompt 7 — Challan page + split panel
```
Read CLAUDE_CONTEXT_v14.md fully.
Read /components/tint/tint-operator-content.tsx for the 65/35 split panel pattern.

Create two files:

1. /components/tint/challan-content.tsx
   - 65/35 split panel, mirrors tint-operator-content.tsx structure
   - Left panel: order list with search + 3 filters (date, route, SMU)
     fetches from GET /api/tint/manager/challans with query params
   - Right panel: renders <ChallanDocument /> for selected order
     fetches from GET /api/tint/manager/challans/[orderId] on selection
   - Action bar: Edit button → Save button (toggle) + Print button + challan number badge
   - Edit mode: passes isEditing=true + change callbacks to ChallanDocument
   - Save: calls PATCH /api/tint/manager/challans/[orderId] with accumulated edits
   - Print: saves first if dirty, then window.print()
   - Empty state: "Select an order to preview challan"
   - Loading + error states on both panels
   - Selected card: navy left border + light blue bg
   - Cards with existing challan: green left border indicator

2. /app/(tint)/challan/page.tsx
   - requireRole(['TINT_MANAGER', 'ADMIN'])
   - Renders <ChallanContent />
   - Page title: "Delivery Challans"

Run npx tsc --noEmit after. Report clean or list errors.
```

---

### Prompt 8 — Sidebar nav entry
```
Read CLAUDE_CONTEXT_v14.md fully.

Add "Delivery Challans" navigation entry to the Tint Manager sidebar.
Find the existing TM sidebar component (check /(tint) layout files).
Add the entry after the existing nav items with:
- Label: "Delivery Challans"
- Icon: document/file icon (consistent with existing icons)
- href: /challan (within the tint route group)
- Active state when pathname starts with /challan

Do not modify any other nav items.
Run npx tsc --noEmit after. Report clean or list errors.
```

---

### Prompt 9 — Final check
```
Read CLAUDE_CONTEXT_v14.md fully.

Final verification pass for the Delivery Challan feature:

1. Run npx tsc --noEmit — must be clean
2. Verify these routes exist and are reachable:
   - GET /api/tint/manager/challans
   - GET /api/tint/manager/challans/[orderId]
   - PATCH /api/tint/manager/challans/[orderId]
   - /app/(tint)/challan/page.tsx
3. Verify print CSS is in place — @media print hides sidebar, topbar,
   left panel, action bar
4. Verify formula editable only on isTinting = true rows
5. Verify smuNumber shows placeholder text (not error) when null
6. Verify challanNumber is never generated client-side
7. Check CLAUDE_CONTEXT_v14.md version line is updated

Report any issues found. If clean, confirm "Delivery Challan feature complete".


Read CLAUDE_CONTEXT_v14.md fully.

We need to add a professional black-and-white print stylesheet to the
existing challan component. The screen version stays exactly as-is —
only @media print rules change the appearance.

Open /components/tint/challan-document.tsx and add the following
@media print behaviour:

── GLOBAL PRINT RULES ──────────────────────────────────────────────
- Page size: A4 portrait
- Margins: 12mm all sides
- Hide: sidebar, topbar, left panel, action bar, any UI chrome
- Only #challan-print-area (or whatever the challan wrapper id is)
  should be visible, full page width

── HEADER ──────────────────────────────────────────────────────────
- Remove navy background → white
- Company name: black, bold, left aligned
- DELIVERY CHALLAN: black, large, bold, centered
- Challan No.: black, right aligned
- Add a single 1.5pt solid black bottom border under the header
- Remove all colored text → black

── REFERENCE STRIP ─────────────────────────────────────────────────
- Remove background color → white
- Remove navy bottom border → replace with 0.5pt solid black
- All text black
- Labels remain small uppercase gray (use #555)
- Vertical dividers between fields: 0.5pt solid #aaa

── PARTY BOXES (Bill To / Ship To) ─────────────────────────────────
- Remove all background fills → white
- Keep black box borders (0.7pt solid black)
- Section header (BILL TO / SHIP TO): remove background →
  just bold uppercase text with a thin bottom border
- Contact strip: remove tint background → white
  keep thin top border, role labels in bold uppercase #333
- All text black

── LINE ITEMS TABLE ─────────────────────────────────────────────────
- Table header row: background black, text white (prints well on B&W)
- Body rows: alternating white / #f7f7f7 (very light gray — visible on B&W)
- All gridlines: 0.4pt solid #888
- Outer border: 0.8pt solid black
- Totals row: background #eeeeee, bold text, 1.2pt solid black top border
- Tinting badge → replace with plain text "[TINT]" in bold, no background,
  no border, no color
- Tinting summary badge next to "Line Items" label → plain text,
  no background, no amber color, just bold black text in brackets
- Formula column editable inputs → plain text, no dashed border,
  no background tint

── ORDER INFO / EDITABLE FIELDS ────────────────────────────────────
- Transporter + Vehicle No inputs → show as plain text with a simple
  underline (border-bottom: 1pt solid black), no dashed style,
  no background

── FOOTER ───────────────────────────────────────────────────────────
- Remove background → white
- Top border: 0.8pt solid black
- Signature lines: plain black underline
- All text black
- Terms text: black

── BOTTOM BAR ───────────────────────────────────────────────────────
- Remove navy background → white
- Top border: 0.5pt solid black
- All text black, small font

── TYPOGRAPHY ───────────────────────────────────────────────────────
- Base font size: 11px minimum for all printed text
- Font family: Arial, Helvetica, sans-serif (safe for all printers)
- No color anywhere except black and grays (#333, #555, #888)

After adding the print styles:
1. Run npx tsc --noEmit — must be clean
2. Confirm the print styles do not affect screen rendering at all
   (everything must be inside @media print only)
3. Report done




Paste this into Claude Code:
```
