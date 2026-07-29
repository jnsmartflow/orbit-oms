---
name: verify-before-claiming
description: Apply before CONCLUDING or ACTING on anything during diagnosis, investigation, code audits, retirement or archive planning, or answering questions like "is X still used", "is it safe to remove", "does this ever run", "is this board always empty". Loads the checking discipline that stops wrong facts from being written into canon or acted on. Use whenever a claim about how the live OrbitOMS system behaves is about to be stated or used as the basis for a change.
---

# Check, Don't Trust (OrbitOMS)

The most expensive mistakes in this project were not bad code — they were believing something instead
of opening it and looking. Before you STATE or ACT on any claim about how the live system behaves,
prove it the right way.

## The core rule
Every claim about what the system *does* must be verified against the thing itself — not against a
name, a document, a code comment, a seed file, or memory. If you cannot point to the exact file, line,
row, or query that proves it, you have NOT verified it — say so plainly rather than asserting it.

## The specific traps that have already bitten here
- **AN IMPORT IS NOT A CALL.** Finding a name `import`ed in a file does not mean it runs. Open the
  actual call site — the call may be commented out or headed `// DISABLED` a few lines below. Grep
  finds the name; only the call site tells you whether it executes.
- **CAPABILITY IS NOT REACHABILITY.** A code branch that *can* do something does not mean it *does*.
  Read the handler for what is possible; read the caller for what actually happens. A branch no client
  ever triggers is dead, however impressive it looks.
- **SEED IS NOT LIVE.** The seed file predicts a fresh database; live production is the authority.
  SELECT the live rows before believing any count, permission, or "this is empty" claim.
- **CODE WINS OVER DOCS.** When a doc, draft, or these notes disagree with the code, the code is right.
  Read the real file and settle it — do not trust the prose.
- **A STALE COMMENT LIES LIKE A STALE DOC.** A code comment stating a fact about live data (e.g. "zero
  orders ever reach this stage") can be out of date. Verify it against the data before repeating it.
- **A ROUTE GROUP IS NOT A MODULE.** A folder can hold live files unrelated to the thing being
  retired. List a folder's contents before assuming what it holds; move named files only.
- **A PAGE KEY AND A ROLE CAN SHARE A WORD.** The same word can be a live role AND a retired page key —
  they are different things. Always state which one you mean.

## Searching safely
- Git Bash rewrites search terms containing a slash before `rg`/`git` ever see them, so a "clean"
  result can be a false clean. When a sweep comes back suspiciously empty, **re-run it a second way and
  reconcile the two.** Use a character-class on every branch (`[/]warehouse`, not `/warehouse`), and
  cross-check word boundaries (a char-class prefix will also match `/warehouse/pickers`).
- When sweeping for a URL or link, search it as PLAIN TEXT everywhere — not only in `href=`,
  `redirect(`, and `push(`. It hides in default function arguments and component props too.

## A gate has not passed until it has been tested
- A gate that has only ever passed is not evidence it is unnecessary — it is evidence it has not yet met
  the case it exists for. Run it before EVERY irreversible move (archive, delete, remove a permission,
  repoint a link). It must PROVE the thing and then STOP: the successor exists AND does at least as
  much; the expected compile errors are listed before the removal; the target's permissions are checked
  before a link is repointed.
- Move the people out before you demolish the building: repoint login landings and redirects to the
  successor FIRST, in their own commit, then archive the old screen.

## When correcting a wrong fact
- A wrong claim usually sits in more than one place. Fix every copy, not just the one you found.
- A correction can introduce its own error. Apply this same checking discipline to the fix you are
  about to write — corrections are not exempt.
