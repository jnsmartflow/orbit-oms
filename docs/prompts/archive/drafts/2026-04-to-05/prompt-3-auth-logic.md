# Claude Code Prompt 3 — Auth logic: accept email OR mobile

**Model:** Sonnet 4.6 (single-file, low-risk edit)
**Where to run:** Claude Code in `C:\Users\HP\OneDrive\VS Code\orbit-oms`
**Type:** Code change — credentials provider update
**Risk:** Low — backward-compatible. Email login keeps working.

---

## Copy this prompt into Claude Code

```
================================================================
TASK: Update NextAuth credentials provider to accept email OR
      10-digit mobile number as login identifier
================================================================

CONTEXT:
- We've added `phone String? @unique` to the User model
- Database has 9 users with phone numbers populated
- Login form currently only accepts email
- We want users to be able to enter EITHER their email OR their
  10-digit mobile number in the same input field
- Backward compatibility: email login must keep working

================================================================
CONSTRAINTS — READ BEFORE TOUCHING ANY FILE
================================================================

1. DO NOT modify auth.config.ts (that's the Edge/middleware-only
   config — must stay free of Node-only imports like Prisma)

2. DO NOT introduce any new dependencies — no new npm packages

3. DO NOT change the credentials provider's name, the input field
   name in the credentials schema, or the session/JWT structure.
   Only the lookup logic changes.

4. Do NOT touch the login UI yet (that's Prompt 4 — separate)

5. After edits, `npx tsc --noEmit` MUST pass clean. No new errors.

6. Do NOT commit yet — we test after Prompt 4 ships the UI.

7. Sequential awaits only — no `prisma.$transaction`

================================================================
STEP 1 — READ-ONLY: Locate and review the credentials provider
================================================================

Read these files and confirm you understand them:

  - lib/auth.ts                         (Node-side auth config — Prisma access)
  - auth.config.ts                      (Edge-side config — KEEP UNTOUCHED)
  - middleware.ts                       (for cross-reference only — KEEP UNTOUCHED)

After reading, REPLY with:
  - "Files read"
  - The exact line range inside lib/auth.ts where the
    `authorize` function lives (start line → end line)
  - The current logic in plain English (1–2 sentences)
  - Whether the file uses `prisma.user.findUnique` or
    `prisma.user.findFirst` today

Then STOP and wait for me to confirm before editing.

================================================================
STEP 2 — DESIGN (write nothing yet, just confirm the plan)
================================================================

The plan is to modify ONLY the `authorize` function inside the
credentials provider. The new logic:

  1. Take credentials.email (the input field — keep the field name
     "email" in the credentials schema; we'll relabel in UI later)
  2. Trim whitespace
  3. If input matches /^\d{10}$/ → look up by phone
     Else → look up by lowercased email
  4. If no user found → return null (same as today)
  5. If user found → bcrypt.compare(input password, user.password)
     (unchanged from today)
  6. Return user object on success, null on failure
     (same shape as today)

Pseudo-code (do NOT paste into the file as-is; adapt to the file's
actual structure):

  async authorize(credentials) {
    if (!credentials?.email || !credentials?.password) return null

    const input = String(credentials.email).trim()
    const isPhone = /^\d{10}$/.test(input)

    const user = await prisma.users.findFirst({
      where: isPhone
        ? { phone: input, isActive: true }
        : { email: input.toLowerCase(), isActive: true }
    })

    if (!user) return null

    const valid = await bcrypt.compare(
      String(credentials.password),
      user.password
    )
    if (!valid) return null

    return {
      id: String(user.id),
      email: user.email,
      name: user.name,
      // ... whatever fields the existing code returns — KEEP IDENTICAL
    }
  }

Adapt to the actual existing structure — do NOT remove any field
the existing return statement provides (role, roleId, permissions,
multi-role data, etc.). Just change the lookup, not the shape.

After confirming you understand, REPLY with:
  - The exact diff you plan to apply (before/after for the
    `authorize` function only)

Then STOP and wait for my approval before writing to the file.

================================================================
STEP 3 — APPLY THE EDIT (only after I approve the diff)
================================================================

After I say "go":
  - Apply the edit to lib/auth.ts
  - Use str_replace, not file rewrite (preserves all other code)
  - Verify the edit by re-reading the affected lines

================================================================
STEP 4 — VERIFY
================================================================

Run:
  npx tsc --noEmit

Expected: clean exit, no new errors.

If any errors → STOP, paste them. Do not try to fix.

================================================================
STEP 5 — REPORT
================================================================

Reply with:
  ✅ lib/auth.ts edited (authorize function only)
  ✅ tsc --noEmit passed clean
  ✅ auth.config.ts untouched
  ✅ middleware.ts untouched
  ⏸  No commit yet

Then STOP. Do not run dev server, do not commit, do not move to
any other task. Wait for my next prompt (Prompt 4 — UI).
```

---

## What this prompt does — plain English

1. Tells Claude Code to **read** the auth file structure first (no edits)
2. Wait for Claude Code to **summarize** what it found
3. **Approve** the diff before edit
4. **Apply** the change — ONLY the `authorize` function inside credentials provider
5. **Verify** with `tsc --noEmit`
6. **Stop** and wait for Prompt 4

---

## Why this is safe

- **No new dependencies** — uses existing Prisma + bcrypt
- **No schema changes** — phone column already exists with `@unique`
- **No UI changes** — keeps the credentials field name `email` so frontend doesn't break
- **Backward compatible** — old email logins keep working unchanged
- **Single-file edit** — blast radius is just the `authorize` function inside `lib/auth.ts`
- **Adds `isActive: true` filter** — small bonus, prevents deactivated users from logging in (if any of the test accounts get deactivated later)

---

## What happens after Prompt 3 ships

You'll be able to test mobile login **via API/Postman**, even though the UI still says "Email":

```
POST /api/auth/callback/credentials
  email: "9456402356"
  password: "deepanshu9456"
```

This would work and log Deepanshu in.

But via the login **form**, the field is labeled "Email", which would be confusing. **Prompt 4 fixes the UI label** so users see "Email or Mobile".

---

## What to do now

1. **Open Claude Code** in `C:\Users\HP\OneDrive\VS Code\orbit-oms`
2. **Paste the entire `TASK:` block** (everything from `TASK: Update NextAuth...` down to the final `Wait for my next prompt`)
3. Claude Code will read files and report back the line ranges + current logic
4. **Paste that report back to me here** — I'll review and tell you to approve the diff
5. Once approved, Claude Code applies the edit and runs tsc
6. Report back final status here

---

## Why I'm asking Claude Code to STOP twice (Steps 1 and 2)

This is a critical auth file. I want **two checkpoints** to make sure:
1. After Step 1 — Claude Code understood the current code correctly
2. After Step 2 — the planned diff is right BEFORE writing

These gates take 2 extra minutes but prevent a wrong edit on an auth file. If it gets edited badly, NOBODY can log in until we fix it.

---

## After this is done

| Step | Status |
|---|---|
| 1.1 — DB schema | ✅ Done |
| 1.2 — User cleanup + phones + passwords | ✅ Done |
| 1.3 — Auth logic | 📝 This prompt |
| 1.4 — Login UI (relabel field) | 📝 Next |
| 1.5 — Admin form (add phone field) | 📝 After |

Each subsequent prompt waits for confirmation of the previous.
