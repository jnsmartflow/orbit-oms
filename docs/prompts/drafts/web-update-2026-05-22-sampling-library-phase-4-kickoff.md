# Sampling Library Phase 4 — Kickoff: Discovery Before Wiring

**Drafted:** 2026-05-22 (after Phase 3 shipped)
**Purpose:** Plan how Sampling Library connects to the live Tint Operator TI workflow. **No wiring design yet.** First two sessions are pure discovery — map the existing system, then design Phase 4 against the actual workflow (not assumed workflow).

---

## Session kickoff message (paste this in the next Claude.ai session)

> Sampling Library Phase 4 — Discovery + Wiring Plan.
>
> Phase 3 shipped to production today (commits ad69e281, e38b2c1d, ccb568df on `main`). Three handoff docs are attached:
> - `docs/prompts/drafts/code-update-2026-05-22-sampling-library-phase-1-handoff.md`
> - `docs/prompts/drafts/code-update-2026-05-22-sampling-library-phase-2-handoff.md`
> - `docs/prompts/drafts/code-update-2026-05-22-sampling-library-phase-3-shipped.md`
> - `docs/prompts/drafts/web-update-2026-05-22-sampling-library-phase-4-kickoff.md` ← this doc
>
> Read all 7 canonical files + the 4 handoff docs. Then reply with the 3-line Ready format and wait.
>
> Phase 4 mission: wire Sampling Library to the live Tint Operator TI workflow so every TI submit writes to `sampling_usage_log`, new shades created in the operator screen flow into `sampling_register`, and operators get shade suggestions backed by historical sampling data.
>
> **CRITICAL — DO NOT START WIRING DESIGN YET.** Phase 4 must begin with discovery. The existing system has a shade suggestion feature on the Tint Operator screen (`/tint/operator`) plus a "Save shade" toggle that creates new shades. We must understand exactly how these work today before designing how Sampling Library augments them.
>
> Discovery is split into two tracks. Track 1 = existing system. Track 2 = operator decision context. Work through them in order, one question at a time, before any wiring proposal.

---

## Track 1 — Existing system (how things work today)

Goal: map the current code paths. The next-session assistant will read the relevant files and confirm understanding before any change is designed.

### Question 1.1 — How are new shades currently added to Shade Master?

Investigate:
- File: `app/api/admin/shades/route.ts` and any related Shade Master pages
- What triggers a shade creation? Admin form? Auto-creation from TI flow? Both?
- Where does a new shade's recipe (pigment values) come from when created via admin?
- Is there a uniqueness constraint on shade name?
- How does this relate to `sampling_register` (if at all)?

### Question 1.2 — How does a TI entry get created in Tinter Issue?

Investigate:
- Tables involved: `tinter_issue_entries` (and any related TI tables)
- Where does a TI start? Tint Manager screen? Auto-assigned from a sales order? Manual entry by operator?
- What fields does a TI row carry — does it currently carry `samplingNo` or any link to a sampling? (Phase 1 handoff says no, but verify against current schema.)
- What's the lifecycle — pending → assigned → in-progress → done? Who triggers each transition?
- Where does the delivery number on a TI come from? (Important — this is the same `deliveryNumber` field we just added to `sampling_usage_log`.)

### Question 1.3 — How does the existing shade name suggestion work on the Tint Operator screen?

This is the key discovery. The screenshot from end-of-Phase-3 shows the operator page (`/tint/operator`) suggesting a shade like `02YY 32/054` next to an "All shades..." button.

Investigate:
- File: `app/(tint)/tint/operator/page.tsx` and the corresponding component(s) in `components/tint/operator/` (or wherever they live)
- What input drives the suggestion? Site name? Customer name? Material code? Pack code? Previous TI history?
- Where does the suggestion data come from? `shade_master` table? Some other lookup?
- Is it a single shade or a ranked list?
- Does it return the recipe (pigment values) automatically, or just the shade name?
- What happens when the operator clicks "All shades..."? Modal? Dropdown? Search?
- What's the data flow from suggestion → pigment chip values getting populated?

### Question 1.4 — How does the "Save shade" toggle work?

When the operator turns on "Save shade" (the toggle in the top-right of the recipe area), a SHADE NAME input appears.

Investigate:
- What table does this write to? `shade_master`? `sampling_register`? Both?
- Does it create a new shade, or update an existing one?
- How does the operator-entered shade name relate to the suggested shade name?
- What if a shade with that name already exists?
- Does it preserve pigment values from the operator's recipe?

### Question 1.5 — Where do recipe values come from for an operator's TI?

This is the upstream question for shade recipes. Three possible sources from Smart Flow's note:
- **From the Sales Officer (SO)** — manually communicated to the operator via paper or message
- **From company software** — a JSW Dulux system that knows recipes (need to confirm what this is and how it currently flows into OrbitOMS)
- **From the existing sampling register** — paper-based historical lookup (which is exactly what Sampling Library digitises)

Investigate:
- Are there any other input fields on the operator screen for recipe entry that aren't obvious from the screenshot?
- How does the operator know the recipe right now — do they ask Chandresh, look at paper, use the suggestion, or something else?
- This question is partly system-discovery and partly Smart Flow describing depot reality. Ask Smart Flow directly.

---

## Track 2 — Operator decision context (questions a human asks when starting a job)

Goal: understand the mental model the operator/manager uses when a new TI lands. This determines what information Sampling Library needs to surface and when.

### Question 2.1 — Is this site brand-new?

When operator opens a TI for site X:
- How do they know if any tinting has ever happened at site X before?
- Currently: do they remember? Ask manager? Check paper register?
- After Phase 4: Sampling Library can answer this in milliseconds (count rows in `sampling_usage_log` where any `dealerNameRaw` matches site X). What's the UX trigger — automatic flag on TI open, or a button?

### Question 2.2 — Has this site used any shade before?

Even if site has tinting history, the manager wants to know specifically:
- Was this exact shade used here before? (look up: `samplingNo` + `siteId/siteNameRaw` in `sampling_usage_log`)
- If yes — show last recipe used, last operator, last quantity, last date. Operator can replicate.
- If no — show "first time" indicator and let operator either pick a similar past shade for this site OR create a new one.

This is where Sampling Library becomes valuable in real-time decision-making.

### Question 2.3 — Where do recipe values come from?

Repeated from Track 1.5 but framed as a decision-context question:
- When recipe comes from SO recommendation → operator enters values manually → "Save shade" toggle decides if it gets logged
- When recipe comes from company software → currently no direct integration → flagged for future Phase 5+
- When recipe is historical (sampling register / library) → Sampling Library auto-fills it

The wiring design must support all three sources without forcing the operator into a single flow.

---

## Track 3 — Wiring design (only after Track 1 + Track 2 complete)

DO NOT START THIS UNTIL TRACK 1 + TRACK 2 ARE FULLY MAPPED. The wiring design below is a placeholder list of what the next session might propose, but every item below is conditional on what we discover in Track 1 + Track 2.

Likely wiring points (subject to change based on discovery):

1. **TI completion → `sampling_usage_log` write**
   - Add `samplingNo` column to `tinter_issue_entries` (or rely on the lookup at TI-done time)
   - On TI mark-done, write a new `sampling_usage_log` row with: samplingNo, recipeId (matched by SKU+pack), usageDate=today, operatorId=current user, tinQty (from TI), dealerName (from sales order), siteName (from sales order ship-to), skuCode (from TI), packCode (from TI), deliveryNumber (from OBD that TI belongs to)

2. **Shade suggestion on operator screen → backed by Sampling Library**
   - When operator opens a TI for site X with SKU Y + pack Z, query `sampling_usage_log` for matching combos at this site
   - Rank suggestions by: same site + same SKU + same pack → same site + same SKU → same site → same shade at any site
   - Surface top 5 with recipe values pre-filled in pigment chips on selection

3. **"Save shade" toggle → write to `sampling_register` + `sampling_recipes`**
   - If operator enters a new shade name AND turns on Save shade, allocate next samplingNo = MAX+1
   - Write parent row to `sampling_register` + first variant to `sampling_recipes` + first usage to `sampling_usage_log`
   - All in one TI submit transaction (sequential, no `prisma.$transaction`)

4. **Auto-create new variant when SKU+pack is new**
   - On TI done, if (samplingNo, skuCode, packCode) doesn't exist in `sampling_recipes`, create a new variant row with the recipe entered by the operator
   - Flag `needsReview: true` so TM can validate later

5. **Wire the 3 detail-pane ActionButtons**
   - Edit (pencil) → PATCH `/api/sampling-library/:samplingNo` modal
   - Deactivate (ban) → PATCH with `{ isActive: false }` confirmation
   - Mark for review (alert-triangle) → POST `/api/sampling-library/:samplingNo/review`

6. **"Is this site new?" indicator on Tint Operator screen**
   - When operator opens a TI, query `sampling_usage_log` for any row with matching site
   - Surface a small badge: "New site" (gray) or "Used N times before" (with link to filter Sampling Library by this site)

---

## Phase 4 deliverables (planned, not committed)

After Track 1 + Track 2 + Track 3 are designed:

- Schema additions (likely `tinter_issue_entries.samplingNo` or equivalent)
- API additions (likely a new suggestion endpoint, maybe `/api/sampling-library/suggest?siteId=X&skuCode=Y&packCode=Z`)
- UI changes on Tint Operator screen (shade suggestion replaced/augmented, "Save shade" rewired, new site indicator added)
- TI completion code path updated to write `sampling_usage_log`
- Detail pane ActionButtons wired
- Smoke test plan covering all new write paths
- Production push + verification

Effort estimate: 3-5 sessions. Schema + API in session 1. Shade suggestion rewrite in session 2. "Save shade" rewrite + new variant auto-create in session 3. Detail pane ActionButtons in session 4. Final integration + push in session 5.

---

## Files for the next session to investigate first

In order of investigation:

1. **`app/(tint)/tint/operator/page.tsx`** — the page entry point
2. **`components/tint/operator/`** (or wherever the operator UI components live) — the shade suggestion + Save shade toggle implementations
3. **`app/api/tint/operator/start/route.ts`**, `pause`, `resume`, `split/start`, `split/done` — the existing TI lifecycle write paths
4. **`prisma/schema.prisma`** — `tinter_issue_entries`, `shade_master`, `tint_assignments`, related tables
5. **`app/api/admin/shades/route.ts`** — current shade creation path
6. **`docs/CLAUDE_TINT.md`** — canonical tint module docs

---

## Workflow for the next session

Same as Phase 1/2/3:
- One Claude Code prompt per turn (plain English wrapper + `Est:` line + fenced block)
- Wait for output before drafting next
- Discovery before design (no code-write prompts until Track 1 + Track 2 are mapped)
- Smart Flow answers depot-reality questions inline
- Schema bumps via Supabase SQL Editor + `npx prisma generate`
- Sequential awaits everywhere, no `prisma.$transaction`

---

## Open questions for Smart Flow (to answer in next session)

The next-session assistant will ask these one at a time:

1. Where do recipe values come from when an SO sends them — paper, message, email?
2. What is "company software" exactly — a JSW Dulux web app, an Excel tool, a desktop app? Any integration possible?
3. Currently when an operator opens a TI, what's the very first thing they do — check site history? Ask Chandresh? Look at the TI ticket? Open paper register?
4. What's the workflow when site has been tinted before with a different SKU+pack — does operator try to find the closest match, or always create new?
5. How often does "Save shade" toggle get used today? Daily? Weekly? Rarely?
6. Who decides the official shade name when "Save shade" is used — operator? Manager? SO?
7. Is there any concept of "draft" vs "approved" recipes today, or is every recipe entered considered final?

---

*Phase 4 kickoff plan · Sampling Library · drafted 2026-05-22*
