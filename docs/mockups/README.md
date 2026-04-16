# mockups/
HTML mockups and their design specs. Used as visual reference when
prompting Claude Code for UI changes.

Each subfolder holds one mockup:
  - planning-board/    — Dispatch Planning Board (Phase 4, frozen design, blocked)
  - review-view/       — Mail Orders Review View layout (live)
  - sidebar-hover/     — Hover-expand overlay sidebar (live)
  - support/           — Support board (frozen design, Phase 1 blocked)
  - tint-operator/     — Tint Operator v4 redesign (live, pigment shade grid)
  - warehouse/         — Warehouse board (frozen design, Phase 1 blocked)

When asking Claude Code for UI work, reference the mockup path
explicitly: "See docs/mockups/review-view/final.html for target."

Status key:
  - live             → mockup reflects current production code
  - frozen design    → mockup is the committed spec, implementation pending
  - blocked          → feature behind PHASE1_BLOCKED in middleware.ts
