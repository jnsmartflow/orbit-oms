# Claude Code Prompt — /place-order: cell typing = units, +/- = box shortcut

Session date: 2026-05-12
Session type: behaviour change (cart semantics + cell input + cart panel display)
Branch: main (direct push per May 2026 strategy)
Target version bumps: CLAUDE_MAIL_ORDERS.md §19 (note new keyboard binding + cart semantics), CLAUDE_UI.md §51 (note "N box" subtle display)

────────────────────────────────────────────────────────────────────────────
GOAL
────────────────────────────────────────────────────────────────────────────

Change quantity input behaviour on the /place-order catalog grid.

- Today: typing a number in a cell means BOXES (cart stores boxes, email
  builder multiplies × packStep to emit units to depot)
- After this change: typing a number means UNITS (cart stores units
  directly, email builder strips the multiplication, mailto stays
  byte-identical)
- +/- keys (and small hover/focus buttons in the cell) add or subtract
  one BOX worth of units as a shortcut
- Cell display: primary = unit count, subtle secondary = "N box" if
  total is a clean multiple of box size
- Cart panel pack chips display: "×12 · 1 box" — units primary, box
  count secondary when clean multiple

This is a coordinated change across:
  - lib/place-order/email.ts        (strip × packStep)
  - lib/place-order/draft-storage   (wipe old draft once)
  - app/(place-order)/place-order/types.ts (rewrite CartLine comment)
  - app/(place-order)/place-order/place-order-page.tsx (no logic change
    expected — qty values just flow through; verify only)
  - The cell input component (typing, +/-, display)
  - The cart panel (pack chip rendering)
  - The keyboard hint bar at the bottom of the catalog grid

────────────────────────────────────────────────────────────────────────────
CONSTRAINTS (CLAUDE_CORE §3 — non-negotiable)
────────────────────────────────────────────────────────────────────────────

- No prisma.$transaction (irrelevant here — no DB writes — but applies
  to all sessions)
- All API routes: export const dynamic = "force-dynamic"
- npx tsc --noEmit must pass before commit
- Direct push to main after local smoke test (no PR, no feature branch)
- No new npm dependencies
- One teal element rule per UI v5.1 §6 — do NOT introduce teal on the
  +/- buttons; they stay neutral gray
- Follow UI v5.1 spacing/typography — the subtle "N box" line must be
  text-gray-400, ~10-11px, not bold
- Cell sizing 56×32 stays unchanged (no growth) — see place-order v5
  shipped notes
- Mailto output must remain byte-identical post-change. Verify with
  side-by-side string compare on at least 3 lines.

────────────────────────────────────────────────────────────────────────────
FILES TO READ FIRST — DO NOT WRITE CODE YET
────────────────────────────────────────────────────────────────────────────

Read these files fully and silently:

1. CLAUDE.md (repo root)
2. docs/CLAUDE_CORE.md §3 (engineering rules)
3. docs/CLAUDE_UI.md §51 (place-order v5 layout) — note cell sizing,
   typography, "one teal element" rule
4. docs/CLAUDE_MAIL_ORDERS.md §19 (current /place-order behaviour spec)
5. app/(place-order)/place-order/page.tsx
6. app/(place-order)/place-order/place-order-page.tsx (~739 lines —
   has setQty, qtyAt, lineKey)
7. app/(place-order)/place-order/types.ts (CartLine comment about
   BOXES is the critical artefact)
8. app/(place-order)/place-order/components/variant-grid.tsx (cell
   input + display + keyboard handling lives here)
9. The cart panel component — likely
   app/(place-order)/place-order/components/cart-panel.tsx
10. lib/place-order/email.ts (the × packStep multiplication site)
11. lib/place-order/draft-storage.ts (saveDraft/loadDraft/clearDraft —
    where we'll wipe old format once)
12. lib/place-order/pack.ts (formatPack + likely the packStep/box
    size lookup)
13. app/api/place-order/data/route.ts (already read in planning;
    note pack metadata flow)

After reading say only "All files read. Ready." and then WAIT for my
confirmation. Do not start STEP 1 until I respond.

────────────────────────────────────────────────────────────────────────────
STEP 1 — AUDIT (no code)
────────────────────────────────────────────────────────────────────────────

After I confirm, run the audit and present findings as plain prose.
Specifically answer these questions — do not propose code:

A. Cell input layer
   - Where exactly is the cell <input> element defined? File + line range.
   - How does typing currently set state? Trace the chain from
     onChange → setQty(product, pack, qty).
   - Is there ANY × packStep multiplication on the input side, or is
     the number written to packQtys exactly as the operator typed it?
     (Expected answer: stored as typed, i.e. boxes today.)
   - Is there existing keyboard handling for + and - keys? If yes,
     what does it do today?

B. Cell display layer
   - How is the number rendered today? Plain text? Conditional formatting?
   - Is there any secondary line per cell today?

C. Cart panel display layer
   - How does the cart panel render packQtys today? Pack chip format,
     wording, exact JSX.
   - Where does "box" or "carton" wording appear, if anywhere?

D. Email builder
   - lib/place-order/email.ts — find the exact line/loop that multiplies
     packQtys[pack] × packStep to emit units to the mailto body.
   - What is the packStep source — a lookup table, a hardcoded map,
     a function call? File + line.
   - How does packStep know that 50ML = box of 12 vs 4L = box of 4?
     (i.e. confirm the box size per pack is data-driven.)

E. Pack metadata
   - In the /api/place-order/data route response, each product has
     packs: string[]. Is the box size for each pack carried in this
     response, or fetched separately, or hardcoded?
   - Confirm there are no packs with unknown box sizes (would crash
     after the flip if we silently default to 1).

F. Draft persistence
   - What localStorage key does draft-storage use today?
   - Confirm there is no schema/version flag in the saved object.

G. Keyboard hint bar
   - Where is the keyboard hint bar rendered? Which component, which
     file? Find the exact JSX of the hints row shown in the screenshot
     ("1-5 switch / nav / 0-9 qty / Esc back to search").

Present findings. Wait for confirmation before STEP 2.

────────────────────────────────────────────────────────────────────────────
STEP 2 — DESIGN (no code)
────────────────────────────────────────────────────────────────────────────

After audit confirmed, present the implementation design in prose:

2.1 Cart semantics flip
    - CartLine.packQtys values become UNITS (not boxes)
    - types.ts comment block rewritten — propose exact new wording
    - place-order-page.tsx setQty/qtyAt — confirm no code change needed
      (values flow through unchanged; only the semantic interpretation
      flips)

2.2 Cell input — typing
    - onChange handler: write qty directly to packQtys (no multiplier)
    - "Normal type behaviour" — leave the browser's default input
      behaviour in place (focus selects no text by default; cursor
      lands where clicked; backspace deletes). Do NOT add custom
      select-on-focus logic in this prompt.
    - parseInt safety: empty string → 0 (removes the line entry per
      existing setQty behaviour)

2.3 Cell input — +/- keys
    - onKeyDown:
        - "+" or "=" (the unshifted plus key on most keyboards):
          increment qty by boxSize, set state, keep focus
        - "-" or "_": decrement qty by boxSize, floor at 0
    - "=" handling is important: on most keyboards "+" requires Shift,
      so e.key === "+" comes through but e.code === "Equal". Handle
      both e.key === "+" || e.key === "=" with appropriate intent
      detection. Same for "-": e.key === "-".
    - Preserve other existing key handlers (arrows for nav, digit
      keys for direct entry, Esc, etc.).

2.4 Cell input — +/- BUTTONS (UI)
    - Subtle 14×14 or 16×16px buttons, visible on cell hover OR cell
      focus only (not always-visible).
    - Position: one on the left side of the cell, one on the right —
      OR stacked tightly at the right edge. Pick whichever fits the
      56×32 cell without overflowing.
    - Style: neutral gray, no teal (one teal element rule). Icons:
      simple `+` and `−` glyphs in text-gray-400, hover text-gray-700.
    - onClick: same effect as the keyboard handler (increment/decrement
      by boxSize, floor 0).
    - Buttons must NOT steal focus from the cell — onMouseDown
      preventDefault.

2.5 Cell display
    - Line 1: large unit count (current cell size + font preserved)
    - Line 2: if qty > 0 AND qty % boxSize === 0, render subtle
      "N box" line below — text-gray-400, ~10px, no extra cell
      growth. If qty === 0 or qty % boxSize !== 0, render nothing
      on line 2.
    - The cell must not grow vertically. Use absolute positioning or
      shrink the primary number font slightly to make room.
    - When boxSize === 1 (e.g. 20L drum), suppress the "N box" line
      entirely (1 unit = 1 box = redundant).

2.6 Cart panel pack chip
    - Current format (boxes): "×1, ×2, ×3"
    - New format:
        - If qty % boxSize === 0 AND boxSize > 1: "×12 · 1 box"
          (units primary; box count secondary in muted gray)
        - If qty % boxSize !== 0: "×N" only (no box suffix)
        - If boxSize === 1: "×N" only (suppress redundant box display)
    - Confirm the exact JSX before writing it. Match UI v5.1 typography:
      primary text-gray-700, secondary text-gray-400.

2.7 Email builder change
    - lib/place-order/email.ts — REMOVE the × packStep multiplication.
      The packQtys values are now already units, so emit them as-is.
    - Verify mailto byte-identical: build before/after for the
      Stainer Black 1/2/3 boxes test case. Before: "50ML*12, 100ML*24,
      200ML*36" (from 1×12, 2×12, 3×12). After: cart now stores
      12/24/36 directly, builder emits same string.

2.8 Draft wipe
    - lib/place-order/draft-storage.ts — on loadDraft, do a one-time
      clear of the existing localStorage key, then return null.
    - Simplest implementation: bump a DRAFT_FORMAT_VERSION constant
      from 1 → 2. Save it inside the draft object. If loadDraft reads
      a draft missing the v2 marker, call clearDraft() and return
      null. Going forward, v2+ drafts read normally.
    - This is one-time wipe by design — accept that operators with an
      in-flight draft at deploy time will see an empty cart on next
      load. Per locked decision.

2.9 Keyboard hint bar
    - Add "+/- box" between "0-9 qty" and the nav arrows.
    - Match existing hint styling (the small kbd-like chips visible
      in the screenshot bottom row).

2.10 Edge cases — confirm handling
    - boxSize === 1: typing 5 stores 5, "+" adds 1, no "N box"
      display. Cart shows "×5".
    - User types 13 in a 12-box pack: cell shows "13" with no
      subtle display. Cart shows "×13" only.
    - User clears the field: qty → 0, removes the entry from
      packQtys per existing setQty logic.
    - Holding "+" with key-repeat: each repeat fires onKeyDown,
      incrementing by boxSize each time. Acceptable.

Present the design. Wait for explicit approval before STEP 3.

────────────────────────────────────────────────────────────────────────────
STEP 3 — IMPLEMENTATION
────────────────────────────────────────────────────────────────────────────

Phase by phase. Run npx tsc --noEmit after EACH phase. Do not start the
next phase until tsc passes.

PHASE 3.1 — Email builder (foundation)
   - Strip × packStep from lib/place-order/email.ts
   - Add an inline comment marking the May 12 2026 semantics change
   - tsc check

PHASE 3.2 — Draft wipe
   - Add DRAFT_FORMAT_VERSION = 2 to draft-storage.ts
   - loadDraft: if no v2 marker, clearDraft + return null
   - saveDraft: stamp v2 marker
   - tsc check

PHASE 3.3 — types.ts comment rewrite
   - Rewrite the CartLine comment block in types.ts to state
     packQtys = UNITS (not boxes). Reference this prompt's date.
   - tsc check

PHASE 3.4 — Cell display (units primary, "N box" secondary)
   - Update the cell rendering in variant-grid.tsx
   - Compute boxSize from pack metadata
   - Render line 1 (units) + conditional line 2 ("N box")
   - Cell must not grow — adjust font size or use absolute
     positioning for the secondary line
   - tsc check

PHASE 3.5 — Cell input (+/- keyboard + buttons)
   - onKeyDown handlers for "+", "=", "-", "_"
   - Hover/focus-visible +/- buttons inside the cell
   - onMouseDown preventDefault on the buttons to preserve focus
   - tsc check

PHASE 3.6 — Cart panel pack chips
   - Update the pack chip render in cart-panel.tsx
   - "×N · N box" format when clean multiple AND boxSize > 1
   - "×N" only otherwise
   - tsc check

PHASE 3.7 — Keyboard hint bar
   - Add "+/- box" hint between "0-9 qty" and nav
   - Match existing chip style
   - tsc check

PHASE 3.8 — Smoke test (local browser)
   - Type 9 in a 50ML cell → cart shows "×9", no box suffix,
     mailto includes "50ML*9"
   - Type 0 then press "+" once on a 50ML cell → cart shows
     "×12 · 1 box", mailto includes "50ML*12"
   - Press "+" again → "×24 · 2 box", "50ML*24"
   - Press "-" twice → back to 0, line removed from cart
   - Try a 20L drum (boxSize = 1): type 3, no "N box" subtle line,
     cart shows "×3", mailto "20L*3"
   - Confirm pagination + sub-product switching still work
   - Confirm search-to-cell still focuses correctly
   - Confirm customer pill dropdown still works (do not regress
     the v5 overflow-hidden fix)

PHASE 3.9 — Context file updates
   - CLAUDE_MAIL_ORDERS.md §19 — note the units flip + new +/- binding
   - CLAUDE_UI.md §51 — note "N box" subtle display rule for cells
     and pack chips
   - No version bump on the canonical docs (consolidation cycle
     handles that)

PHASE 3.10 — Commit and push
   - Commit message:
       /place-order: cell typing = units; +/- = box shortcut

       - Cart packQtys now stores units (was boxes). Email builder
         strips × packStep — mailto output byte-identical.
       - Cell typing writes units directly. "+" / "-" keys and
         hover/focus buttons add or remove one box worth of units.
       - Cell shows unit count primary, "N box" subtle when clean
         multiple. Cart panel chips: "×12 · 1 box".
       - Draft format bumped to v2; pre-v2 drafts wiped on load.
       - Hint bar gains "+/- box" between "0-9 qty" and nav.
   - Push to main, Vercel auto-deploys

────────────────────────────────────────────────────────────────────────────
WHAT TO DO FIRST
────────────────────────────────────────────────────────────────────────────

1. Read all listed files
2. Reply "All files read. Ready." — then STOP
3. Wait for my "go"
4. Run STEP 1 audit, present findings, wait for confirmation
5. Run STEP 2 design, present, wait for approval
6. Execute STEP 3 phase by phase with tsc gates between each
