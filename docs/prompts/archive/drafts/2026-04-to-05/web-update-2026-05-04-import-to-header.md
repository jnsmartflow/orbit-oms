# Web update — Import to Header migration (2026-05-04)

Target file: `docs/prompts/drafts/web-update-2026-05-04-import-to-header.md`

Companion to: `web-update-2026-05-01-sap-import-architecture.md` (the SAP brain
this work consumes), `code-update-2026-05-04-import-to-header-step3.md`
(the implementation prompt that produced the work).

---

## Section 1 — What this work shipped

OBD imports are now triggered from a header button on every operator-facing
board, opening a single 520px modal that handles both SAP file imports and
manual-template imports. Replaces the "go to /admin/import or /import"
workflow for trained operators while keeping the legacy pages intact as a
fallback.

Five roles can now import:

- `admin`
- `dispatcher`
- `support`
- `billing_operator` (newly granted — the daily SAP-punching operators)
- `tint_manager` (newly granted — patches via manual template)

Other roles (`tint_operator`, `picker`, `floor_supervisor`, `operations`) see
no Import button and are rejected by `requireRole` if they call the API
directly.

Production live since 2026-05-04. Verified end-to-end via batches
`BATCH-20260504-012` (preview OFF, direct write) and `BATCH-20260504-013`
(preview ON, full preview-confirm flow), both run by Chandresh Kolgha
(tint_manager) on https://www.orbitoms.in.

---

## Section 2 — Header button — `UniversalHeader`

Component: `components/universal-header.tsx`

New optional props (mirror the `showDownload` / `onDownload` pattern):

```typescript
showImport?: boolean;
```

No `onImportClick` — open/close is owned internally by the header. When
`showImport === true`, the header renders:

1. The Import button — leftmost in Row 1 right cluster, before Clock
2. The `<ImportModal />` instance, gated on the same `showImport`

Button markup (matches mockup `01-header-with-button.html` byte-for-byte):

```tsx
<button
  type="button"
  title="Import OBDs"
  onClick={() => setImportOpen(true)}
  className="bg-gray-50 rounded-[5px] p-[4px_8px] cursor-pointer hover:bg-gray-100 transition-colors flex items-center gap-[4px]"
>
  <Upload size={13} className="text-gray-400" />
  <span className="text-[10px] text-gray-500 font-medium">Import</span>
</button>
```

Style is **gray-50 neutral utility** (matches Shortcuts), not teal. Per
CLAUDE_UI.md §6 colour rule, teal is reserved — Download stays the only teal
element in Row 1. Import sits visually with Shortcuts/Filter as a tool
button, not a CTA. The CTA lives inside the modal.

Header itself does NOT read session — stays role-agnostic. Each board page
computes `showImport` from `useSession()` and passes it in. Keeps the
header's API minimal and consistent with the existing `canImport` prop
pattern from admin pages.

---

## Section 3 — Per-board wiring

Nine board files updated. Pattern is uniform: read session at the top of the
component, derive `canImportOBDs` from an inline allow-list, pass to header.

```typescript
const { data: session } = useSession();
const canImportOBDs = ["admin", "dispatcher", "support", "billing_operator", "tint_manager"]
  .includes(session?.user?.role ?? "");

<UniversalHeader
  ...existing props
  showImport={canImportOBDs}
/>
```

Allow-list is **inlined per board** — no `useCanImport()` hook, no shared
helper. Audit confirmed this is the prevalent pattern in the codebase (server
pages compute booleans, pass as props). Premature DRY here would obscure the
single line of role logic.

Files modified:

- `app/(mail-orders)/mail-orders/mail-orders-page.tsx`
- `components/support/support-page-content.tsx`
- `components/planning/planning-page.tsx` (reused existing `useSession`)
- `components/warehouse/warehouse-page.tsx` (reused existing `useSession`)
- `components/tint/tint-manager-content.tsx`
- `components/tint/tint-operator-content.tsx`
- `components/tint/ti-report-content.tsx`
- `components/tint/shade-master-content.tsx`
- `components/tint/challan-content.tsx`

Operations sub-routes (`/operations/{support,tinting,tint-operator,dispatch,warehouse}`)
inherit automatically — they re-render the existing content components above.
Operations role is intentionally outside the allow-list, so the button stays
hidden when an operations user views these screens.

---

## Section 4 — `ImportModal` component

File: `components/import/import-modal.tsx` · 1,131 LOC · single file.

Self-contained. Returns null when `!open`. Mounted inside
`UniversalHeader`'s return JSX, gated by `showImport`. No portal, no
context provider, no layout-level state.

### State machine

```typescript
type Stage = "idle" | "parsing" | "preview" | "confirm-intent" | "submitting" | "result" | "error";
type Format = "sap" | "manual-template";
```

Internal state:

```typescript
const [stage, setStage] = useState<Stage>("idle");
const [format, setFormat] = useState<Format>("sap");
const [previewEnabled, setPreviewEnabled] = useState<boolean>(false);  // default OFF
const [file, setFile] = useState<File | null>(null);
const [obdEmailDate, setObdEmailDate] = useState<string>(getTodayIST());  // YYYY-MM-DD string, not Date
const [previewData, setPreviewData] = useState<...>(null);
const [batchId, setBatchId] = useState<number | null>(null);
const [resultData, setResultData] = useState<...>(null);
const [errorMessage, setErrorMessage] = useState<string | null>(null);
```

`obdEmailDate` is a string (YYYY-MM-DD), not a `Date`. Matches what
`getTodayIST()` from `lib/dates.ts` returns and what the server FormData
contract expects. The implementation prompt's `useState<Date>` was a typo,
caught and corrected during Phase 2.

### Stage transitions

Two flow paths controlled by `previewEnabled`:

**Preview ON (recommended for SAP):**

```
idle → click "Preview" → parsing → preview → click "Confirm Import"
  → confirm-intent (red CTA + amber notice) → click "Yes, Confirm"
  → submitting → result
```

**Preview OFF (direct write):**

```
idle → click "Import" (red CTA + amber notice) → submitting → result
```

Either path can branch to `error` on a failed fetch. From `error`, "Try
Again" returns to `idle` preserving format and previewEnabled; "Cancel"
closes.

### Preview-OFF Manual Template — silent two-call

Manual-template confirm requires a `batchId` from a prior preview call.
When `previewEnabled === false` and `format === "manual-template"`, the
modal silently runs both calls back-to-back without showing the preview
UI:

```typescript
async function runDirectImport() {
  setStage("submitting");

  // 1. Silent preview to obtain batchId
  const previewRes = await fetch("/api/import/obd?action=preview", { method: "POST", body: fd });
  const preview = await previewRes.json();

  // 2. Filter out errored OBDs (matches legacy admin behaviour)
  const validIds = preview.obds
    .filter((o) => o.rowStatus === "valid" || o.rowStatus === "warning")
    .map((o) => o.rawSummaryId);

  if (validIds.length === 0) throw new Error("No valid OBDs found — nothing was imported");

  // 3. Confirm with all valid IDs
  await fetch("/api/import/obd?action=confirm", {
    method: "POST",
    body: JSON.stringify({ batchId: preview.batchId, confirmedObdIds: validIds }),
  });
}
```

Two sequential awaits, single `submitting` stage throughout. User sees one
spinner, no flicker between the two calls. `valid` and `warning` row
statuses both get imported (warnings are customer-missing OBDs that import
with the flag set); `duplicate` and `error` rows are excluded.

For SAP preview-OFF, only one call (`?action=manual-sap-confirm`) since the
SAP server endpoint accepts the file directly without a prior preview step.

### Visual states

Each stage maps to a specific footer CTA colour, enforced by the mockups as
the binding visual contract:

| Stage | CTA | Colour |
|---|---|---|
| idle (preview ON, file ready) | "Preview" | gray-900 |
| idle (preview OFF, file ready) | "Import" | **red-600** (destructive) |
| preview | "Confirm Import (N OBDs)" | gray-900 |
| confirm-intent | "Yes, Confirm" | **red-600** |
| submitting | spinner + "Importing..." | disabled |
| result | "Done" | gray-900 |
| error | "Try Again" | gray-900 |

Inline amber notice strips appear in two states:

- **Preview-OFF idle (file selected):** inside the body, full border, "Preview is off. Clicking Import will write to live tables immediately. Recommended for SAP imports — switch on to review changes first."
- **Confirm-intent:** between body and footer, top-border only strip, "This will write to live tables and cannot be undone. N OBDs will be patched."

No teal anywhere in the modal. Primary CTAs use gray-900 for safe actions,
red-600 for destructive writes. Matches `manual-tint-entry-modal.tsx`
precedent.

### Close behaviour matrix

| Stage | Backdrop | X button | Esc |
|---|---|---|---|
| idle | closes | closes | closes |
| parsing | blocked | confirm prompt | blocked |
| preview | confirm prompt | confirm prompt | confirm prompt |
| confirm-intent | confirm prompt | confirm prompt | reverts to preview |
| submitting | blocked | blocked | blocked |
| result | closes | closes | closes |
| error | closes | closes | closes |

"Confirm prompt" = native `window.confirm("Discard this import? Your file will be cleared.")`. No custom dialog.

---

## Section 5 — Server gate update

File: `app/api/import/obd/route.ts`

Single change to the auth gate at the top of `POST` (around lines 2977–2989):

```typescript
const session = await auth();
requireRole(session, [
  ROLES.ADMIN,
  ROLES.DISPATCHER,
  ROLES.SUPPORT,
  ROLES.BILLING_OPERATOR,  // added
  ROLES.TINT_MANAGER,      // added
]);
if (session!.user.role !== "admin") {
  const allowed = await checkPermission(session!.user.role, "import_obd", "canImport");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
}
```

`ROLES.BILLING_OPERATOR` and `ROLES.TINT_MANAGER` already existed in
`lib/rbac.ts` — no constant additions needed.

HMAC bypass for `?action=auto` and `SAP_IMPORT_ENABLED` env-var checks
inside `handleManualSapPreview` / `handleManualSapConfirm` are untouched.

### Permission denial paths

Two distinct denial mechanisms after this work:

- **Roles outside allow-list** (`tint_operator`, `picker`, `floor_supervisor`, `operations`) → `requireRole` redirects to `/unauthorized`, response is **307**, not 403. Pre-existing behaviour, not introduced by this work.
- **Roles in allow-list but with `canImport: false`** in `role_permissions` → `checkPermission` returns false, response is **403** with `{ error: "Permission denied" }`.

Both paths achieve denial. The 307 vs 403 inconsistency is documented but
not a regression — same behaviour existed before the gate widening.

---

## Section 6 — Schema and role grants

No schema changes in this work.

`role_permissions` rows added/updated via Supabase SQL Editor (Phase 1 SQL):

```sql
INSERT INTO role_permissions ("roleSlug", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete")
VALUES
  ('billing_operator', 'import_obd', false, true, false, false, false),
  ('tint_manager',     'import_obd', false, true, false, false, false)
ON CONFLICT ("roleSlug", "pageKey") DO UPDATE
  SET "canImport" = EXCLUDED."canImport";
```

`canView: false` is deliberate — keeps `/import` and `/admin/import` out of
the sidebar nav for billing/TM. They access import only via the new header
button. Admin's row had `canView: true` already; existing rows for
dispatcher and support unchanged.

Final state on production `role_permissions`:

| roleSlug | canView | canImport |
|---|---|---|
| admin | true | true |
| billing_operator | false | true |
| dispatcher | true | true |
| floor_supervisor | false | false |
| picker | false | false |
| support | true | true |
| tint_manager | false | true |
| tint_operator | false | false |

---

## Section 7 — API contract

**No new endpoints.** Modal POSTs to the existing `/api/import/obd` actions
exactly as `import-page-content.tsx` does today:

| Action | Trigger | Body | Response |
|---|---|---|---|
| `?action=manual-sap-preview` | preview ON + SAP | `FormData {file, obdEmailDate}` | `SapPreviewResponse` |
| `?action=manual-sap-confirm` | preview ON confirm + SAP / preview OFF SAP | `FormData {file, obdEmailDate}` | `SapConfirmResponse` |
| `?action=preview` | preview ON + Template / preview OFF Template (silent) | `FormData {templateId, combinedFile}` | `ImportPreviewResponse` |
| `?action=confirm` | preview ON confirm + Template / preview OFF Template (silent) | `JSON {batchId, confirmedObdIds}` | `ImportConfirmResponse` |

SAP file is uploaded twice in the preview-ON path (once for preview, once
for confirm). Server re-parses on each call. Modal holds the `File` blob in
component state across the preview → confirm-intent → submitting transitions
without losing it. Backdrop click and Esc are blocked or guarded to prevent
accidental file drop mid-flow.

`createBatchWithRetry` (the P2002 collision-safe batch creator from May 1)
handles all three call sites unchanged — preview, manual-sap-confirm,
auto-import.

---

## Section 8 — Download blank template

Link top-right of the format toggle row inside the modal idle stage.
Format-aware:

```typescript
function handleDownloadTemplate(): void {
  const url = format === "sap"
    ? "/import-templates/sap-blank.xlsx"
    : "/import-templates/manual-template-blank.xlsx";
  const a = document.createElement("a");
  a.href = url;
  a.download = url.split("/").pop()!;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
```

Files served from `/public/import-templates/`. The folder contains a
`README.md` with the column specs derived from `lib/sap-parser/` and from
the `RawHeaderRow` / `RawLineRow` types in `route.ts:32-63`.

**The actual `.xlsx` blank files are not in the repo and need to be added
manually.** Until they exist the link 404s — graceful failure, modal stays
open, no error handling beyond the browser default. Tracked as a pending
item.

---

## Section 9 — Production verification

Both paths verified on https://www.orbitoms.in 2026-05-04 by Chandresh Kolgha
(tint_manager).

### BATCH-20260504-012 — preview OFF, direct write

- File: `EXPORT 04.05.2026.XLSX`
- obdEmailDate: 2026-05-04
- 69 totalObds, 16 skipped (returns), 0 errored
- Counts: 0 created, **7 patched**, 46 unchanged, 0 errored
- importedById: 21 (Chandresh)
- Status: completed
- Audit log shows 11 line-level changes (line_patched, line_removed) prefixed `via manual-sap batch BATCH-20260504-012`

### BATCH-20260504-013 — preview ON, full flow

- Same file, same date, same operator
- 69 totalObds, 16 skipped, 0 errored
- Counts: 0 created, **3 patched**, 50 unchanged, 0 errored
- importedById: 21 (Chandresh)
- Status: completed
- Audit log shows 3 line-level changes also prefixed with the new batch ref

The non-zero patch count on the second pass is **not** a bug in this work —
it surfaced pre-existing data corruption in `import_raw_line_items` (see
Section 11).

### What this proves

- Server gate accepts `tint_manager` (Phase 1 SQL grant flowed through)
- Header button visible to TM on `/tint/manager` (Phase 4 wiring)
- Modal opens, format toggle, file upload, OBD date, both paths, result modal — all functional
- `userId` propagated through `upsertObd` into `import_batches.importedById` — full attribution intact
- 53 importable OBDs (69 minus 16 returns) processed in each pass with no errors
- Brain integrates cleanly with the May 1 SAP architecture (parser, upsert, audit, effects, batchRef)

---

## Section 10 — Critical operational notes

### Environment

No new environment variables. `SAP_IMPORT_ENABLED=true` (existing) gates
the SAP path on production. `IMPORT_SHADOW_MODE` remains unset (dormant).

### Operator workflow change

Before: `/admin/import` or `/import` → template picker → upload → preview → confirm.

After: any board → header Import button → modal opens at idle → toggle SAP/Template → optional Preview toggle → upload → either Preview→Confirm→Yes-Confirm OR direct red Import → result.

Both `/admin/import` and `/import` legacy pages remain functional and
unmodified — fallback for admin if the modal fails for any reason.

### Daily users

- **Deepanshu Thakur, Bankim** (billing_operator) — primary SAP punching, will use this daily on `/mail-orders`
- **Chandresh Kolgha** (tint_manager) — patches via manual template, will use on `/tint/manager`
- Pickers, floor supervisors, tint operators — no Import button visible, no API access

### Monitoring queries (production)

```sql
-- Recent imports by all paths
SELECT id, "batchRef", "headerFile", "totalObds", "skippedObds", "failedObds",
       "importedById",
       (SELECT name FROM users WHERE id = ib."importedById") AS imported_by,
       status, "createdAt"
FROM import_batches ib
ORDER BY id DESC LIMIT 10;

-- Audit attribution check (every batch has a user)
SELECT COUNT(*) FROM import_batches WHERE "importedById" IS NULL;
-- Should be 0 for manual-sap and manual-template; auto-import may differ
```

---

## Section 11 — Pending / on the horizon

### Active-row duplicate cleanup (NEW, surfaced 2026-05-04)

**261 duplicate active rows across 260 (obdNumber, skuCodeRaw) groups in
`import_raw_line_items`.** Surfaced during back-to-back SAP imports
(BATCH-20260504-012 / 013) showing non-deterministic patch counts on
duplicates — the brain matches by `skuCodeRaw` and picks an unspecified
"first row" when multiple active rows exist with the same SKU on the same
OBD.

Distinct from the **phantom-row cleanup** completed May 1, which only
addressed `lineStatus='removed_by_import'` ghost rows. This is a different
class of corruption: legitimate `active` rows that are duplicates of each
other.

Worst-case observed: OBD `9106693439`, SKU `IN68010872` — two active rows
with **different qty values** (9 and 12). Naive "keep first row per group"
will pick wrong values for these cases.

Diagnosis SQL:
```sql
SELECT "obdNumber", "skuCodeRaw", COUNT(*) AS dup_count
FROM import_raw_line_items
WHERE "lineStatus" = 'active'
GROUP BY "obdNumber", "skuCodeRaw"
HAVING COUNT(*) > 1
ORDER BY dup_count DESC, "obdNumber";
```

Total impact:
```
total_dup_groups: 260
total_dup_rows:   521
rows_to_remove:   261
```

Needs its own session: diagnosis prompt → merge strategy (especially for
qty-mismatched duplicates) → cleanup SQL with backup → verification SAP
re-import showing zero patches on second pass. Tracked in companion prompt
`code-update-2026-05-XX-active-row-dedup-step1.md` (next session).

### Blank xlsx template files

`/public/import-templates/sap-blank.xlsx` and
`/public/import-templates/manual-template-blank.xlsx` need to be created
manually and dropped in. Until then, Download blank template link 404s
(graceful). README in that folder has column specs.

### Manual-template path still on legacy code

Per the SAP architecture doc Section 11, Step 5B — manual-template path
hasn't been cut over to `upsertObd` live yet. Modal supports it via the
existing inline parser in `route.ts`. When 5B lands, no modal changes
needed — the API contract stays the same.

### Auto-import audit prefix

Auto-import (PowerShell HMAC pipeline) doesn't yet write the new audit
prefixes (`[obd_created]`, `[line_patched]`, etc.). Tracked in SAP
architecture doc Step 4B. Modal users see neat prefixed audit; auto-import
users see legacy "Created via auto-import batch ..." notes.

### `/admin/import` UI consistency

The legacy admin page still shows the older SAP preview UI (different from
the new modal's unified preview layout). User flagged this is acceptable
for now ("will update later"). Future consolidation: either retire the
legacy pages or update them to match the modal's preview design.

### Edge cases not yet tested in production

- **billing_operator real import** — gate verified for tint_manager via batches 012/013, but no production batch yet from Deepanshu or Bankim. First daily punch will surface any role-specific issue.
- **Manual-template silent two-call** — verified in code review (runDirectImport is sequential, single submitting state, errored OBDs excluded), but no production batch yet via the modal.

---

## Section 12 — Files inventory

Modified:
- `app/api/import/obd/route.ts` — server gate widening (Phase 1)
- `components/universal-header.tsx` — `showImport` prop, button, modal mount (Phase 3)
- `app/(mail-orders)/mail-orders/mail-orders-page.tsx` (Phase 4)
- `components/support/support-page-content.tsx` (Phase 4)
- `components/planning/planning-page.tsx` (Phase 4)
- `components/warehouse/warehouse-page.tsx` (Phase 4)
- `components/tint/tint-manager-content.tsx` (Phase 4)
- `components/tint/tint-operator-content.tsx` (Phase 4)
- `components/tint/ti-report-content.tsx` (Phase 4)
- `components/tint/shade-master-content.tsx` (Phase 4)
- `components/tint/challan-content.tsx` (Phase 4)

Created:
- `components/import/import-modal.tsx` — 1,131 LOC self-contained modal (Phase 2)
- `public/import-templates/README.md` — column specs for blank xlsx files (Phase 4)
- `docs/mockups/import-modal/01-header-with-button.html`
- `docs/mockups/import-modal/02-modal-idle-empty.html`
- `docs/mockups/import-modal/03-modal-preview-mixed.html`
- `docs/mockups/import-modal/04-modal-confirm-intent.html`
- `docs/mockups/import-modal/05-modal-result-success.html`
- `docs/mockups/import-modal/06-modal-file-loaded-preview-off.html`
- `docs/prompts/drafts/code-update-2026-05-04-import-to-header-step3.md` — implementation prompt

Untouched (preserved as fallback):
- `app/(admin)/admin/import/page.tsx`
- `app/(import)/import/page.tsx`
- `app/(import)/import/layout.tsx`
- `components/import/import-page-content.tsx` (1,021 LOC legacy admin page)
- `components/import/sap-preview.tsx` (legacy SAP preview component)

Build verification:
- `npx tsc --noEmit` — EXIT 0 across all 5 phases
- `npm run build` — clean, 67/67 static pages generated, no size regressions

Single commit on `main`: "Import to Header migration: 5-role gate, modal in
UniversalHeader, preview toggle". Vercel auto-deployed `bom1` region.

---

## Section 13 — Bug history during this work

All caught and resolved in-session:

- **PowerShell paren-eating** — `git add app/(mail-orders)/...` was parsed by PowerShell as a subexpression. Fix: quote the path. Note for future PS commands: any path with `()` needs double-quotes.
- **`obdEmailDate` Date vs string** — implementation prompt specified `useState<Date>`, but `getTodayIST()` returns string and the FormData contract expects string. Caught in Phase 2, used string throughout.
- **Mockup vs prompt conflict on amber notice** — prompt described "above footer", mockup placed it inside body for the preview-OFF idle state. Followed mockup as the binding visual contract; reserved the strip-style notice for confirm-intent.

---

*Web update v1 · Import to Header · 2026-05-04 · Smart Flow*
