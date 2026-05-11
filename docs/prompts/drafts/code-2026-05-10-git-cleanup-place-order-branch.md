# Claude Code prompt — Move untracked place-order work onto its proper branch

**Why this prompt:** ~2,500 lines of working place-order code, the taxonomy translator, all Phase 1 scripts, and 19 design drafts have been sitting untracked on `feat/attendance-feature-complete` for 4 days. They were always meant to live on `feat/place-order-page`. This prompt moves them there safely, commits them in clean logical chunks, and leaves the attendance branch untouched.

**Backup is in place:** `C:\Users\HP\OneDrive\VS Code\orbit-oms-backup-2026-05-10-1104` — full working copy with `.git`. If anything goes wrong, restore from there.

---

## CONSTRAINTS — read carefully

1. **No code changes to any source file.** This is a git-organisation prompt only. Do not edit `.tsx`, `.ts`, `.sql`, `.md`, `.prisma`, or any application file.
2. **No `prisma db push`, no `prisma migrate`, no `npm install`, no schema changes.**
3. **Do not delete files.** `pass.tx`, `test/`, and similar stray files get added to `.gitignore` (or left alone), not removed.
4. **One step at a time.** Each numbered section below is one operation. After each section, **stop and report back**: what was done, current branch, current `git status` summary. Wait for me to say **"go"** before the next section.
5. **No force-push.** No `git push --force` ever. Use `git push` (with `-u` first time only).
6. **No rewriting history.** No `git rebase -i`, no `git reset --hard` on commits we didn't make this session.
7. **Read-and-confirm gate at the top.** Before running ANY git command, read this prompt end to end, summarise the 7-step plan back in 4-6 lines, and wait for me to say **"go"** before starting Step 1.

---

## CONTEXT — what the audit found

- Current branch: `feat/attendance-feature-complete`
- 2 commits unpushed on it (attendance ops_admin + layout fixes) — these are good, just need pushing
- Modified tracked files: `.claude/settings.local.json`, `docs/prompts/context-update-code-template.md` (these belong with attendance work, not place-order)
- Untracked files belonging to place-order/taxonomy work:
  - `app/(place-order)/` (entire route group, 13 files, 2,388 lines)
  - `lib/place-order/` (3 files: `pack.ts`, `email.ts`, `draft-storage.ts`)
  - `lib/mail-orders/taxonomy-mapping.ts` (858 lines)
  - `scripts/phase1-*.ts`, `scripts/phase1-*.sql`, `scripts/preview-new-taxonomy*.ts`, `scripts/backup-mo-order-form-index.ts` (9 files total)
  - `docs/prompts/drafts/*.md` and `*.json` and `*.csv` (20 design files)
- Stray files unrelated to either branch: `pass.tx`, `test/`, `public/JSW DULUX.png`, `public/JSW LOGO.png`
- Target branch `feat/place-order-page` exists locally and on origin, currently sits at `c6e3ab3f` (docs/photos/plan only, no code)

---

## THE 7-STEP PLAN

### Step 1 — Confirm baseline and push attendance commits

```bash
git status
git log --oneline -5
git branch -vv
```

Report back:
- Current branch (must be `feat/attendance-feature-complete`)
- Number of unpushed commits (must be 2)
- List of tracked-modified files
- Summary count of untracked files (don't paste the full list — too long)

Then push attendance work to origin:

```bash
git push origin feat/attendance-feature-complete
```

Confirm push succeeded. **STOP. Report. Wait for "go".**

---

### Step 2 — Update `.gitignore` for stray files

The stray files (`pass.tx`, `test/`) shouldn't be committed to either branch. Read current `.gitignore`. Then:

- If `pass.tx` is not already ignored, append `pass.tx` to `.gitignore`
- If `test/` is not already ignored, append `/test/` to `.gitignore`

(The leading `/` on `/test/` ensures we ignore only the repo-root `test/` directory, not any future `test/` folders inside subpaths.)

Do NOT add `node_modules`, `.next`, etc. — those are already there.

After editing, run `git status` to confirm the stray files have disappeared from the untracked list. Commit just the .gitignore change on the current branch (attendance), since this is a repo-wide hygiene change, not place-order specific:

```bash
git add .gitignore
git commit -m "chore: ignore stray pass.tx and root /test/ directory"
git push origin feat/attendance-feature-complete
```

**STOP. Report. Wait for "go".**

---

### Step 3 — Stash the tracked attendance edits

The two tracked-modified files (`.claude/settings.local.json`, `docs/prompts/context-update-code-template.md`) belong with attendance work. We don't want them travelling to the place-order branch. Stash them:

```bash
git stash push -m "WIP: attendance settings + context template" -- .claude/settings.local.json docs/prompts/context-update-code-template.md
```

Confirm via `git status` that those two files are no longer in the modified list. Untracked files (place-order code) should remain untracked — they will travel with us when we switch branches.

**Report what stashed. Wait for "go".**

---

### Step 4 — Switch to `feat/place-order-page`

```bash
git checkout feat/place-order-page
git status
```

Report:
- Current branch (must be `feat/place-order-page`)
- Whether all the untracked place-order files are still in the untracked list (they should be — git carries untracked files across branches when there's no conflict)
- The current `git log --oneline -5` of this branch

The branch already has commit `c6e3ab3f docs: add place-order mockup, photos, and implementation plan` from before. Photos may or may not be in the working tree right now. Run `ls public/category-images/` and report what's there. If empty, that's fine — Step 7 will handle it.

**STOP. Report. Wait for "go".**

---

### Step 5 — Commit in 4 logical chunks

We commit in chunks so the history is readable later. **Do not combine into one giant commit.**

#### 5a. Taxonomy translator + Phase 1 scripts

```bash
git add lib/mail-orders/taxonomy-mapping.ts
git add scripts/preview-new-taxonomy.ts
git add scripts/preview-new-taxonomy-from-csv.ts
git add scripts/phase1-backup-current-index.ts
git add scripts/phase1-seed-mo-order-form-index.ts
git add scripts/phase1-restore-from-backup.ts
git add scripts/phase1-taxonomy-unique-constraint.sql
git add scripts/phase1-schema-changes.sql
git add scripts/phase1-spotcheck-tmp.ts
git add scripts/phase1-rollback-verify-tmp.ts
git add scripts/backup-mo-order-form-index.ts

git commit -m "feat(taxonomy): Phase 1 translator + reseed/restore scripts (rolled-back state)

- mapLegacyToNew translator for 33-family taxonomy redesign
- CSV-driven preview generator (560 triples → 512 rows, 0 warnings)
- Phase 1 deploy scripts: backup, seed, restore, schema migration SQL
- Includes rollback temp scripts from 2026-05-06 deploy/rollback cycle

Phase 1 was deployed and rolled back on 2026-05-06 — see
docs/prompts/drafts/session-end-2026-05-06-taxonomy-phase1-summary.md.
Production restored to legacy 481-row 15-family state. Stages A/B/C
designed the proper fix (subVariant column on mo_sku_lookup).
Stage D not yet started."
```

Report back, wait for **"go"**.

#### 5b. `/place-order` page code

```bash
git add app/\(place-order\)/
git add lib/place-order/

git commit -m "feat(place-order): desktop order entry page (7-phase build)

- Route: /place-order, gated by 'place_order' page-key permission
- Roles allowed: admin, billing_operator, tint_manager, support, dispatcher
- Photo-first category grid (with letter-monogram fallback when photo missing)
- Excel-style variant grid, numpad-only keyboard navigation
- Cell stores box count; email emits unit count via packStep multiplication
- localStorage drafts per customer, 24h TTL
- mailto submit to surat.order@outlook.com — byte-compatible with mobile /order

Built 2026-05-06. Held back from main pending taxonomy cleanup
(Stages A-G). Page renders against legacy 15-family taxonomy."
```

Report back, wait for **"go"**.

#### 5c. Design drafts and data files

```bash
git add docs/prompts/drafts/

git commit -m "docs(taxonomy+place-order): design drafts, audit reports, data backups

Includes:
- Master taxonomy redesign (33 families locked)
- Phase 1 deploy/rollback summary
- Stage A audit (6 read-only passes + final report)
- Stage B schema design (3 new columns locked)
- Stage C data migration design (splitLegacyProduct spec)
- /place-order build update + 7-phase implementation plan
- SO order form build update
- Data: taxonomy-preview.json (512 rows, 0 warnings),
  mo_order_form_index pre-rollback backup (481 rows, JSON + partial CSV),
  mo_sku_lookup-triples CSV (560 unique triples)

All drafts dated 2026-05-06 through 2026-05-09."
```

Report back, wait for **"go"**.

#### 5d. Stray PNGs in /public (separate commit, intent unclear)

The two stray PNGs `public/JSW DULUX.png` and `public/JSW LOGO.png` were noted in the audit. They likely relate to a logo swap session on 2026-05-09. Don't commit them on this branch — they belong elsewhere.

Run:
```bash
git status
```

If those PNGs still appear in the untracked list, leave them alone — they'll travel with us when we switch back to the attendance branch in Step 6, and we can decide their proper home there.

**Report final `git status` of `feat/place-order-page` branch. Wait for "go".**

---

### Step 6 — Push place-order branch and switch back

```bash
git push -u origin feat/place-order-page
```

Confirm push succeeded. The branch now has 4 new commits beyond `c6e3ab3f`.

Switch back to attendance branch:

```bash
git checkout feat/attendance-feature-complete
git stash pop
git status
```

Report:
- Current branch (must be `feat/attendance-feature-complete`)
- Whether the stashed files came back as modified (they should)
- That the place-order untracked files are GONE (they're now committed on the other branch)
- Whether the stray PNGs are still untracked here

**STOP. Report. Wait for "go".**

---

### Step 7 — Report any photos missing in the working tree

The `public/category-images/` folder was empty on the current branch per the audit. The category grid component expects photos at `/category-images/{slug}.png`. The photos exist on commit `c6e3ab3f` of `feat/place-order-page`.

Do NOT copy or restore them in this session — that's a separate decision for later. Just confirm:

```bash
git show c6e3ab3f --stat | grep category-images
```

Report what files (if any) the commit added under `public/category-images/`. This gives us the recovery list for whenever we want to restore them.

---

## FINAL OUTPUT

After Step 7, write a brief summary message:

- Attendance branch: synced to origin, 2 commits pushed, gitignore updated, stash restored
- Place-order branch: 4 new commits pushed, taxonomy + page + drafts all tracked
- Photos: list of files available on commit `c6e3ab3f` for future restore
- Stray files (PNGs): still untracked on attendance branch, decision deferred
- Anything unexpected encountered

Do NOT modify any context .md (CLAUDE_CORE.md, CLAUDE_MAIL_ORDERS.md, CLAUDE_UI.md). That's a separate consolidation session.

---

## DO NOT START YET

Read this prompt end to end. Summarise the 7-step plan back to me in 4-6 lines:

- Which branch we start on, end on, and visit in between
- Which commits go to which branch
- What stashing accomplishes
- What the constraints forbid
- Any concern about the plan

Then wait for me to say **"go"** before Step 1.
