import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // ── Orbit palette ────────────────────────────────────────────────────
        // Source of truth: docs/prompts/drafts/web-update-2026-09-06-orbit-colour-spec-v2.md §1.
        // Added 2026-09-08 (rebrand step 1). NOTHING reads these yet — the use
        // sites are converted in step 2. Adding the tokens without converting
        // the use sites is exactly the state globals.css's dead `--violet` /
        // `--red` / `--green` tokens are in, which is why the spec (§4) insists
        // the two jobs ship together. Step 1 is the token half, on purpose.
        //
        // 🔴 The neutral family is `ink`, NOT `neutral` or `gray`. Tailwind ships
        // its own `neutral-*` and `gray-*` scales and this palette is a different
        // ramp (violet-tinted, and it skips 300 and 800). A collision would be
        // silent: `bg-gray-100` would keep working and mean something else.
        //
        // 🔴 `data.*` are IDENTITIES, never states. `data.teal` #0D9488 is the IGT
        // delivery type and keeps the exact hex teal already had — those seven
        // sites need no edit, ever (spec §1). Never reassign a shipped data colour.
        brand: {
          50:  "#F5F3FF",
          100: "#EDE9FE",
          200: "#DDD6FE",
          300: "#C4B5FD",
          400: "#A78BFA",
          500: "#8B5CF6",
          600: "#7C3AED",
          700: "#6D28D9",
          800: "#5B21B6",
          900: "#43168B",
        },
        // Violet-tinted neutral. Deliberately has no 300 and no 800 — the spec
        // defines ten steps and these are they; do not invent the gaps.
        ink: {
          0:   "#FFFFFF",
          25:  "#FAFAFC",
          50:  "#F4F3F8",
          100: "#E9E7F0",
          200: "#D6D3E0",
          400: "#9C99AC",
          500: "#74718A",
          600: "#514E63",
          700: "#3A3748",
          900: "#1B1826",
        },
        // Sky. Replaces every violet that means TINT (spec §0.2: sky not cyan,
        // because cyan sits ~15° from the teal IGT keeps and the two appear in
        // the same tables). Nothing but tint may use this family.
        tint: {
          bg:  "#F0F9FF",
          bd:  "#BAE6FD",
          600: "#0284C7",
          700: "#0369A1",
        },
        // Status. Fixed meanings, never brand, never tint.
        ok: {
          DEFAULT: "#059669",
          bg:      "#ECFDF5",
          text:    "#047857",
        },
        warn: {
          DEFAULT: "#D97706",
          bg:      "#FFFBEB",
          text:    "#B45309",
        },
        // 🔴 NAMED `danger`, NOT `urgent`, AND THE NAME IS THE RULE.
        // CLAUDE_UI.md v5.21 (2026-09-08): red is ERROR AND DESTRUCTIVE ONLY —
        // a failed send, a bounced order, a blocked dealer, Delete/Clear/Replace,
        // Voided/Removed, Hold. **Never a priority.** Urgency is amber (`warn`),
        // because red spent on a priority has nothing left to say when something
        // actually breaks. The colour spec v2 predates that ruling and still calls
        // this token `urgent`; the spec is being corrected, not this file.
        // ⚠ Twelve live sites still paint Urgent in red. That migration is
        // DEFERRED BY DECISION and is NOT part of the rebrand — its own session,
        // after the predicate is settled. See
        // docs/prompts/drafts/code-discovery-2026-09-08-urgent-red-migration.md.
        danger: {
          DEFAULT: "#E11D48",
          bg:      "#FFF1F2",
          text:    "#BE123C",
          bd:      "#FECDD3",
        },
        // The favourite star, and nothing else.
        fav: "#F59E0B",
        data: {
          teal:   "#0D9488", // IGT delivery type — the ONE colour the rebrand does not move
          blue:   "#2563EB", // Local delivery type
          orange: "#EA580C", // Upcountry delivery type · role: floor_supervisor
          rose:   "#E11D48", // Cross delivery type. ⚠ Same hex as `danger` — pre-existing,
                             // not caused by the rebrand, and deliberately left alone
                             // (colour spec §6 item 2). Do not "resolve" it here.
          cyan:   "#0891B2", // Retail Offtake SMU · mail-order remark type "customer"
          lime:   "#65A30D", // role: picker
          pink:   "#DB2777", // Decorative Projects SMU (moves off #4F46E5) · role: support
                             // · mail-order remark type "cross" (ruled 2026-09-09, applied in step 3)
          slate:  "#475569", // role: admin · unknown-category fallback
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      backgroundColor: {
        DEFAULT: "var(--bg)",
      },
      keyframes: {
        "cart-flash": {
          "0%":   { backgroundColor: "#F5F3FF" },
          "100%": { backgroundColor: "transparent" },
        },
      },
      animation: {
        "cart-flash": "cart-flash 1.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
