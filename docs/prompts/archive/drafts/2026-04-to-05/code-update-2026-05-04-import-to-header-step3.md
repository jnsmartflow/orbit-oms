# Code update — Step 3 — Import to Header implementation

**Session goal (this prompt only):** Implement the Import-in-Header feature
phase by phase. Approved mockups in `docs/mockups/import-modal/` are the
binding visual contract.

Run with **Opus** — multi-file, schema-aware, touches auth and shared brain.

---

## ─── READ FIRST ─────────────────────────────────────────────────────────────

Read these files fully and silently before any code:

1. `CLAUDE.md` (repo root)
2. `docs/CLAUDE_CORE.md`
3. `docs/CLAUDE_UI.md`
4. `docs/prompts/drafts/web-update-2026-05-01-sap-import-architecture.md`
5. `components/universal-header.tsx`
6. `components/import/import-page-content.tsx`
7. `components/import/sap-preview.tsx`
8. `components/tint/manual-tint-entry-modal.tsx` (modal pattern we copy)
9. `app/api/import/obd/route.ts` (server gate update lives here)
10. `lib/rbac.ts` (the `requireRole` and `ROLES` constants)
11. `lib/permissions.ts` (`PAGE_NAV_MAP`, `checkPermission`)
12. `lib/auth.ts` and `auth.config.ts` (session shape)
13. `docs/mockups/import-modal/01-header-with-button.html`
14. `docs/mockups/import-modal/02-modal-idle-empty.html`
15. `docs/mockups/import-modal/03-modal-preview-mixed.html`
16. `docs/mockups/import-modal/04-modal-confirm-intent.html`
17. `docs/mockups/import-modal/05-modal-result-success.html`
18. `docs/mockups/import-modal/06-modal-file-loaded-preview-off.html`

After reading say only:

```
Files read: [list]
Schema v26.5 · UI v5.1 · Modal precedent: manual-tint-entry-modal · Mockups 01–06 reviewed
Ready for Phase 1.
```

Then wait for me to say "go Phase 1".

---

## ─── DECISIONS LOCKED — DO NOT RE-LITIGATE ──────────────────────────────────

### Role gate (server + UI)
Allowed: `admin`, `dispatcher`, `support`, `billing_operator`, `tint_manager`.
Server `requireRole` enforces this; header button visibility mirrors it.
Permission check (`checkPermission(role, "import_obd", "canImport")`) for
non-admins continues unchanged.

### Click flow
One click on the header Import button → modal opens. Inside the modal:
SAP / Manual Template toggle. Default = SAP.

### Preview toggle
Single boolean state in the modal, default OFF. Applies to both formats.
- OFF: file → click "Import" (red CTA) → server writes directly → result
- ON: file → click "Preview" → parse → preview table → "Confirm Import"
  (gray-900) → red "Yes, Confirm" intent step → server writes → result

### Header button
Position: **leftmost in Row 1 right cluster, before Clock**.
Style: `bg-gray-50` neutral utility (matches Shortcuts). Not teal.
Icon: `Upload` from lucide-react, size 13.
New props on `UniversalHeader`: `showImport?: boolean`, `onImportClick?: () => void`.
**Each board page** computes `showImport` from `useSession()` and passes it in.
The header itself does not read session.

### Modal placement
Owns its own state inside `UniversalHeader.tsx`. No layout-level portal,
no provider, no createPortal. Same z-index management as Shortcuts/Filter
dropdowns. 520px wide, `bg-black/40` backdrop.

### Modal colour
Primary CTA: `bg-gray-900` for safe actions ("Preview", "Confirm Import",
"Done"). `bg-red-600` for destructive write actions ("Import" with preview
OFF, "Yes, Confirm" after preview). **No teal anywhere in the modal.**

### Download blank template
Link in the modal idle stage, top-right of the format toggle row.
Format-aware: SAP toggle → SAP blank file; Template toggle → manual template
blank file. Files served from `/public/import-templates/` if they exist,
otherwise endpoint `/api/import/blank-template?format={sap|manual}`.

### Backend reuse
**No new API endpoints.** Modal POSTs to the existing `/api/import/obd`
with `?action=` exactly as `import-page-content.tsx` does today. The four
existing actions (`preview`, `confirm`, `manual-sap-preview`, `manual-sap-confirm`)
serve both old admin page and new modal. Audit Task 6 confirmed
library-level reuse is moot — endpoints are the integration surface.

### Existing admin page
Stays working. **Do not delete or break** `/admin/import` or `/import`
routes. Engineering rule: never delete files unless explicitly instructed.

---

## ─── PHASE 1 — Server gate update ──────────────────────────────────────────

**Goal:** Loosen the server gate to the new role set. Pure backend change.
Self-contained, testable in isolation before any UI work.

### Files
- `app/api/import/obd/route.ts`

### Changes
Locate the gate at the top of `POST` (audit reported this around lines
2971–2988). Current:

```typescript
const session = await auth();
requireRole(session, [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.SUPPORT]);
if (session!.user.role !== "admin") {
  const allowed = await checkPermission(session!.user.role, "import_obd", "canImport");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
}
```

Update to:

```typescript
const session = await auth();
requireRole(session, [
  ROLES.ADMIN,
  ROLES.DISPATCHER,
  ROLES.SUPPORT,
  ROLES.BILLING_OPERATOR,
  ROLES.TINT_MANAGER,
]);
if (session!.user.role !== "admin") {
  const allowed = await checkPermission(session!.user.role, "import_obd", "canImport");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
}
```

### Constraint check
- Verify `ROLES.BILLING_OPERATOR` and `ROLES.TINT_MANAGER` exist in `lib/rbac.ts`. If they don't, **add them** matching the existing `ROLES.*` pattern (snake_case slug values). Stop and report if there's a mismatch with the values in `lib/auth.ts:47-58` normalization.
- Do NOT change the HMAC bypass branch for `?action=auto`.
- Do NOT change `SAP_IMPORT_ENABLED` env var check.
- Do NOT touch the per-action handlers — gate only.

### Database
For `billing_operator` and `tint_manager` to actually pass the
`checkPermission` call, rows must exist in `role_permissions` with
`pageKey="import_obd", canImport=true` for those role slugs.

**Do NOT run any SQL in this phase.** Output the SQL I need to run via
Supabase SQL Editor as a code block at the end of Phase 1, marked clearly:

```sql
-- Run via Supabase SQL Editor — Phase 1 grants
INSERT INTO role_permissions (...) VALUES (...);
```

I'll run this manually before deploying Phase 1.

### Run before stopping
- `npx tsc --noEmit` — must pass
- Report the exact line numbers changed in `route.ts`

### Output for Phase 1
1. Diff of `route.ts` changes (or full updated function if cleaner)
2. Diff of `lib/rbac.ts` if `ROLES.BILLING_OPERATOR` / `ROLES.TINT_MANAGER` were added
3. SQL block for `role_permissions` grants
4. `tsc --noEmit` result

Then **stop**. Wait for me to confirm before Phase 2.

---

## ─── PHASE 2 — Build ImportModal component ─────────────────────────────────

**Goal:** New self-contained modal component, no header wiring yet.
Mockups 02–06 are the binding visual contract.

### Files
- New: `components/import/import-modal.tsx`
- Possibly new: `components/import/import-modal-types.ts` (if types get long)

### Component shape

```typescript
interface ImportModalProps {
  open: boolean;
  onClose: () => void;
}

export function ImportModal({ open, onClose }: ImportModalProps): React.JSX.Element | null;
```

Returns `null` when `!open`, like `manual-tint-entry-modal.tsx`.

### Internal state machine

```typescript
type Stage =
  | "idle"
  | "parsing"
  | "preview"
  | "confirm-intent"
  | "submitting"
  | "result"
  | "error";

type Format = "sap" | "manual-template";

const [stage, setStage] = useState<Stage>("idle");
const [format, setFormat] = useState<Format>("sap");
const [previewEnabled, setPreviewEnabled] = useState<boolean>(false);
const [file, setFile] = useState<File | null>(null);
const [obdEmailDate, setObdEmailDate] = useState<Date>(getTodayIST());
const [previewData, setPreviewData] = useState<SapPreviewResponse | ImportPreviewResponse | null>(null);
const [batchId, setBatchId] = useState<number | null>(null);
const [resultData, setResultData] = useState<SapConfirmResponse | ImportConfirmResponse | null>(null);
const [errorMessage, setErrorMessage] = useState<string | null>(null);
```

### Stage transition rules

| From | Trigger | To |
|---|---|---|
| idle | Pick file, click Preview (preview ON) | parsing |
| idle | Pick file, click Import (preview OFF) | submitting |
| parsing | Server response ok | preview |
| parsing | Server response error | error |
| preview | Click Confirm Import | confirm-intent |
| preview | Click Cancel | idle (clear all state) |
| confirm-intent | Click Yes Confirm | submitting |
| confirm-intent | Click Cancel | preview |
| submitting | Server response ok | result |
| submitting | Server response error | error |
| result | Click Done | closed (call onClose) |
| result | Click Import Another File | idle (clear all state) |
| error | Click Try Again | idle (preserve format and previewEnabled) |
| error | Click Cancel | closed |

### API calls

- Preview SAP: POST `/api/import/obd?action=manual-sap-preview` with FormData `{ file, obdEmailDate }`
- Confirm SAP: POST `/api/import/obd?action=manual-sap-confirm` with FormData `{ file, obdEmailDate }` — **same file blob, server re-parses**
- Preview Template: POST `/api/import/obd?action=preview` with FormData `{ templateId: "combined_v2", combinedFile: file }`
- Confirm Template: POST `/api/import/obd?action=confirm` with JSON `{ batchId, confirmedObdIds: [all from previewData] }`
- Direct Import (preview OFF): same as Confirm path but skips the preview step. For SAP this means going straight to `manual-sap-confirm`. For Template this is **not natively supported** — manual-template confirm needs the `batchId` from a prior preview. **Solution: when preview OFF + Template, the modal still calls preview internally first to obtain `batchId`, then immediately calls confirm with all obd IDs from the response. The user does not see the preview UI.** This keeps the API contract intact.

### Visual contract

Match the 6 mockups byte-for-byte. Use Tailwind classes from CLAUDE_UI.md.

Required structural elements per stage (mockups are authoritative):

- **Backdrop**: `fixed inset-0 z-50 bg-black/40 flex items-center justify-center`
- **Modal shell**: `w-[520px] bg-white rounded-lg shadow-xl flex flex-col` with `max-height: calc(100vh - 80px)` style attr
- **Header bar**: title left, X close right, `border-b border-gray-200`
- **Body**: `flex-1 overflow-y-auto p-5` (preview stage adds `max-height: 65vh`)
- **Footer**: `flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200`

Color rule per stage:

| Stage | Primary CTA | CTA color |
|---|---|---|
| idle (preview ON, file ready) | "Preview" | gray-900 |
| idle (preview OFF, file ready) | "Import" | red-600 |
| preview | "Confirm Import (N OBDs)" | gray-900 |
| confirm-intent | "Yes, Confirm" | red-600 |
| result | "Done" | gray-900 |
| error | "Try Again" | gray-900 |

Inline amber notice strip:
- preview-OFF idle stage: above footer, "Preview is off. Clicking Import will write to live tables immediately. Recommended for SAP imports..."
- confirm-intent stage: above footer, "This will write to live tables and cannot be undone. N OBDs will be patched."

### Close behaviour

| Stage | Backdrop click | X button | Esc |
|---|---|---|---|
| idle | closes | closes | closes |
| parsing | blocked | confirm prompt | blocked |
| preview | confirm prompt | confirm prompt | confirm prompt |
| confirm-intent | confirm prompt | confirm prompt | reverts to preview |
| submitting | blocked | blocked | blocked |
| result | closes | closes | closes |
| error | closes | closes | closes |

Use native `window.confirm("Discard this import? Your file will be cleared.")` — no custom dialog.

### Do NOT in this phase

- Do not edit `universal-header.tsx`
- Do not edit any board page
- Do not implement the "Download blank template" link — make it a no-op `<button>` for now and leave a `// TODO Phase 4` comment

### Run before stopping

- `npx tsc --noEmit` — must pass
- Verify the file lives at `components/import/import-modal.tsx`
- Verify imports resolve (`SapPreviewResponse`, `ImportPreviewResponse` etc. from `lib/import-types.ts`)

### Output for Phase 2

1. Path of new file
2. LOC count
3. `tsc --noEmit` result
4. Confirmation: "Component renders nothing without `open`. Not yet wired into header."

Then **stop**. Wait for me to test render in Storybook-style isolation if I want, then say "go Phase 3".

---

## ─── PHASE 3 — Wire modal into UniversalHeader ─────────────────────────────

**Goal:** Add the Import button to Row 1 right cluster, mount the modal
inside the header, manage open/close.

### Files
- `components/universal-header.tsx`

### Changes

**1. New props** on `UniversalHeaderProps`:

```typescript
showImport?: boolean;
```

No `onImportClick` — open/close is managed internally by the header (single
modal instance, single open boolean). `showImport` is the only external
control.

**2. Internal state**:

```typescript
const [importOpen, setImportOpen] = useState(false);
```

**3. Button rendering** — leftmost in Row 1 right cluster, before Clock.

Mockup 01 lines 27–37 are the source of truth. Reproduce the exact markup
including the Upload icon SVG (lucide), `bg-gray-50 rounded-[5px] p-[4px_8px]`,
13×13 icon `text-gray-400`, label `text-[10px] text-gray-500 font-medium`,
`title="Import OBDs"` attribute.

Conditional: `{showImport && (<button .../><Separator />)}` — separator
appears only when button is shown.

Use the existing `Upload` import from lucide-react if present; otherwise
add it to the existing import block at the top of the file.

**4. Modal mount** — render `<ImportModal open={importOpen} onClose={() => setImportOpen(false)} />` at the **bottom of the component's return JSX**, after the Row 2 closing `</div>`.

Import: `import { ImportModal } from "@/components/import/import-modal";`

### Constraint check

- Do NOT add `useSession()` to the header. The header stays role-agnostic.
- Do NOT add `onImportClick` prop — keeping the API minimal per audit Task 3.5.
- Do NOT touch any other Row 1 element (Clock, Shortcuts, Download, Search).
- Do NOT touch any Row 2 element.

### Run before stopping

- `npx tsc --noEmit` — must pass
- Manual visual check: open any page that already uses `UniversalHeader`,
  confirm nothing changed (since no page passes `showImport=true` yet).

### Output for Phase 3

1. Diff of `universal-header.tsx`
2. `tsc --noEmit` result
3. Confirmation that no existing board page is affected

Then **stop**. Wait for me to say "go Phase 4".

---

## ─── PHASE 4 — Wire showImport per board + Download Blank Template ─────────

**Goal:** Pass `showImport` from each board page based on the user's role.
Implement the Download blank template link.

### Sub-task 4.1 — Board page wiring

Boards that use `<UniversalHeader />` (per CORE §10):
- `/mail-orders` → `components/mail-orders/mail-orders-content.tsx` (or wherever the header is mounted)
- `/tint/manager` → `components/tint/tint-manager-content.tsx`
- `/tint/operator` → `components/tint/tint-operator-content.tsx`
- `/support` → `components/support/support-content.tsx` (currently Phase 1 blocked, but wire anyway)
- `/planning` → `components/planning/planning-content.tsx`
- `/warehouse` → `components/warehouse/warehouse-content.tsx`
- `/operations/*` → operations sub-route components
- `/tint/ti-report`, `/tint/shades`, `/tint/delivery-challans` → respective components

For each:

```typescript
// Read at top of component
const { data: session } = useSession();
const role = session?.user?.role;
const canImportOBDs = role
  ? ["admin", "dispatcher", "support", "billing_operator", "tint_manager"].includes(role)
  : false;

// Pass to header
<UniversalHeader
  ... existing props
  showImport={canImportOBDs}
/>
```

**Do not invent a hook.** Inline the role check on each page. If the role
list grows, refactor later — premature abstraction.

If a board page is a server component, the role check moves up: read
session in the server component, pass `showImport` as a prop down to the
client component that mounts the header.

### Sub-task 4.2 — Download blank template

In `components/import/import-modal.tsx`, replace the Phase 2 TODO with a
real download trigger.

**Approach:** static files in `/public/import-templates/`:
- `sap-blank.xlsx` — empty SAP OBT export structure
- `manual-template-blank.xlsx` — empty manual-template combined_v2 structure

The link triggers a browser download via:

```typescript
function handleDownloadTemplate() {
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

**File creation:** Do not generate the blank xlsx files — those are content,
not code. Stub the public directory with a README:

```
/public/import-templates/README.md
```

Content: instructions for me on what blank files to drop in, what columns
they need (reference the parser's expected headers).

If the files don't exist when clicked, browser will 404 — acceptable
graceful failure. Do NOT add error handling for this case in the modal.

### Run before stopping

- `npx tsc --noEmit` — must pass
- Visual check: log in as admin, open `/mail-orders`, confirm Import button
  appears in Row 1 left of Clock
- Visual check: log in as picker, open `/warehouse`, confirm NO Import
  button (no `showImport` passed there since picker isn't in the allow list)

### Output for Phase 4

1. List of board files modified with diff per file
2. New file: `/public/import-templates/README.md`
3. `tsc --noEmit` result
4. Manual visual confirmation list

Then **stop**. Wait for me to test all boards before Phase 5.

---

## ─── PHASE 5 — End-to-end test pass ────────────────────────────────────────

**Goal:** Manual test the full flow on dev branch. No new code unless a
bug surfaces.

### Test matrix

| Test | Expected |
|---|---|
| Admin on `/mail-orders` clicks Import | Modal opens at idle stage, SAP toggle, preview OFF |
| Pick SAP file `EXPORT_29_04_2026.XLSX`, leave preview OFF | Modal moves to file-loaded state, red Import button visible, amber notice |
| Click Import (preview OFF, SAP) | Posts to `manual-sap-confirm`, shows result with batch ref |
| Reopen modal, switch preview ON | Toggle visual flips, footer CTA changes to "Preview" |
| Pick same SAP file, click Preview | Posts to `manual-sap-preview`, shows preview table |
| Click Confirm Import in preview | Footer flips to red "Yes, Confirm", amber notice appears |
| Click Yes, Confirm | Posts to `manual-sap-confirm`, shows result |
| Switch to Manual Template format, preview OFF, pick file, click Import | Posts to `preview` then `confirm` back-to-back, result |
| Login as billing_operator | Import button visible on `/mail-orders` |
| Login as tint_manager | Import button visible on `/tint/manager` |
| Login as picker | Import button NOT visible on `/warehouse` |
| Picker tries to call `/api/import/obd?action=preview` directly | 403 |
| Esc during parsing | Blocked |
| Esc during preview | Confirm prompt |
| Backdrop click during result | Closes |

### Output for Phase 5

Pass/fail table for each. If any fail, report and stop. Do not silently
fix — surface for review.

---

## ─── CONSTRAINTS — apply to every phase ────────────────────────────────────

- Read CORE §3 engineering rules. Every one applies.
- `npx tsc --noEmit` must pass before stopping each phase. Show output.
- All API routes touched must keep `export const dynamic = 'force-dynamic'`.
- No `prisma.$transaction` — sequential awaits only.
- Never delete files unless explicitly told.
- No new libraries.
- No schema changes (this work is UI + auth gate only).
- camelCase column names — no `@map`.
- Stop at end of each phase. Wait for confirmation.
- If something doesn't match the audit's reported file structure, **stop and report** — don't guess.

---

## ─── EXECUTION ORDER ───────────────────────────────────────────────────────

1. Read all 18 files
2. Say "Files read … Ready for Phase 1."
3. I say "go Phase 1"
4. Phase 1 → stop → I confirm SQL ran
5. I say "go Phase 2"
6. Phase 2 → stop → I review component
7. I say "go Phase 3"
8. Phase 3 → stop → I confirm header unchanged for non-import boards
9. I say "go Phase 4"
10. Phase 4 → stop → I test on dev
11. I say "go Phase 5"
12. Phase 5 → report test matrix → stop

End state: Header Import button live for the 5 allowed roles, modal works
end to end, `/admin/import` and `/import` legacy pages still work,
`tsc --noEmit` clean throughout.
