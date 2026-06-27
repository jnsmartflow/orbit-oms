# code-update · 2026-06-19 · Order email — proper-case names + column alignment

**Repo destination:** `docs/prompts/drafts/code-update-2026-06-19-email-propercase-alignment.md`
**Fold into:** `CLAUDE_PLACE_ORDER.md` (email section) at next consolidation.
**Status:** Live on all three email surfaces (desktop `/place-order`, mobile `/po`, `/order`). Verified in a real Outlook draft.

Order-email product names now render in uniform proper case (codes stay caps), and line numbers align in a fixed column past 9 items even in proportional mail fonts. All done inside the one shared body builder, so every surface inherited it.

**Commits (this session):**
- `email: proper-case product names in order email (codes/short/digit words stay caps)`
- `build: exclude scratch scripts from typecheck gate`
- `b629800b` — `email: right-align line numbers so product names align past 9 items`
- `email: figure-space line-number padding so columns align in proportional mail fonts` (latest push)

---

## 1. Proper-case product names — `emailCase()`

New pure helper in `lib/place-order/email.ts`, applied in `renderOrderBody` to **only the per-line product name** (the `emailLineLabel(...)` output). Header lines (Bill To / Ship To / Dispatch / Remark / Note), the customer name, and the pack string are **untouched**.

**Rule** — split the name on runs of non-alphanumeric chars (keeping separators: space, `-`, `/`, `()`, `.`), then for each alphanumeric token, in order:
1. contains a digit → **UPPERCASE** (5IN1, M900, 3IN1, 10MM, BU1, 2K, 1K…)
2. else ≤ 2 letters → **UPPERCASE** (WS, VT, PU, PO, NC, UP, DA…)
3. else its uppercase form is in `KEEP_CAPS_3` → **UPPERCASE**
4. else → title-case (first letter up, rest down)

```
KEEP_CAPS_3 = ["GVA","FBC","IBC","WBC","FFR","GRN","LFY","MAG","OXR","TBL","YOX","NCR","VAF","WRP"]
```

**Why this rule:** the 2-letter and digit-bearing codes are handled by the *rule* (no list to maintain). The only maintained list is the **3-letter, no-digit** codes that collide with real 3-letter words. That list was derived from a full audit of all 464 distinct email names (not guesswork). Real 3-letter words correctly go proper — Red, Oak, Int, Ext, Max, Gun, Neo, Off, Pro, Sky, Bus, Glo.

**Scope:** email display only — no data change, no reseed. It's a transform on the rendered string.

**One audit gotcha worth remembering:** `NCR` looked like a colourant code but is actually "Delhi **NCR**" (region) — correctly kept caps. That's why we ran the full before→after dump before committing: a length rule alone can't tell a code from a word, so the dump is the safety net.

## 2. Line-number alignment — figure space, NOT regular space

`renderOrderBody` right-aligns the serial number per bill:
```
padWidth = String(bill.lines.length).length
out.push(`${String(i + 1).padStart(padWidth, "\u2007")}. ${emailCase(line.name)} - ${line.packString}`)
```
- Sr No still **restarts per bill**; `padWidth` is per-bill (its own line count). ≤9 lines → no pad; 10+ → pad to 2; 100+ → 3.
- **Pad char is `\u2007` (FIGURE SPACE), not a regular space.**

**The lesson (important, reusable):** a regular space lines up in the in-app **preview** (monospace font) but **fails in the actual mail client**, because the email body is plain text rendered in a *proportional* font (Outlook/Gmail) where a normal space is narrower than a digit — so " 9." never reaches the "10." column. **Figure space (U+2007) is exactly one digit wide and non-collapsing**, so it aligns in proportional mail fonts. First attempt used a normal space (commit `b629800b`) and looked right only in preview; the figure-space commit is what actually fixed the live draft. → For any future plain-text email column alignment, **use figure space, and test the real mail client, not the preview.**

All three mailto builders encode the body (so `\u2007` serializes as `%E2%80%87` and survives the mailto handoff).

## 3. All three surfaces share one builder (confirmed)

Every email body comes from the single `renderOrderBody` — so emailCase + figure-space padding apply uniformly with no per-surface work:
- **Desktop `/place-order`:** `buildEmail` → `renderOrderBody`; preview and mailto read the *same* memoized `emailOutput.body`; mailto wrapped by `buildMailtoUrl`.
- **Mobile `/po`:** `buildEmailParts` → `renderOrderBody` (call ~line 160); mailto assembled inline in `handleSend`.
- **`/order`:** local `buildEmail` closure → `renderOrderBody` (~line 846); mailto inline in `handleSend`.

> If `/po` ever *looks* unchanged after an email-format deploy, suspect the **PWA cache** (force-close / reinstall) — not the code. It shares the builder.

## 4. Build-gate fix (housekeeping, done)

`next build` type-checks **every** `**/*.ts`, including ~40 untracked scratch scripts from old sessions (several with type errors) — this had blocked the build gate ~3 times. Fixed non-destructively by adding to `tsconfig.json` `exclude`:
```
"scripts/_*.ts"
"scripts/_tmp/**"
```
Convention going forward: **underscore-prefixed = scratch = excluded from the typecheck gate.** No scratch files were deleted.

---

## Suggested CLAUDE_PLACE_ORDER.md edits (at consolidation)
- Document `emailCase()` + the 4-step rule + `KEEP_CAPS_3` list; note it's email-display only (no data change), applied to the line name inside `renderOrderBody`.
- Document line-number alignment: per-bill `padWidth`, **figure space `\u2007`** (record *why* — regular space fails in proportional mail fonts; preview is monospace and misleading).
- Confirm the three-surface table (desktop/`/po`/`/order` all via `renderOrderBody`; `/po` + `/order` mailto inline, desktop via `buildMailtoUrl`).
- Add the convention: `scripts/_*` and `scripts/_tmp/**` are scratch, excluded from typecheck.

## Still open / parked
- Rich formatting (bold labels) still needs a server-sent HTML email — mailto is plain-text only. Parked.
- `5IN1` Phiroza SAP codes `IN56000473 / IN56000471` — still need creating in SAP to bill (roadmap).
- If a brand-new 3-letter code appears in the catalog later, add it to `KEEP_CAPS_3` (the before→after dump will surface any mangled name).
