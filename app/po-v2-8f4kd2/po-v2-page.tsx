"use client";

// Hidden v2 salesman order page — placeholder only. Proves the route resolves
// and renders; nothing else is built yet.
//
// Deliberately has NO fetch, NO localStorage, and NO imports from app/po/*.
// Violet is Tailwind's built-in `violet-700` utility — no token added to
// globals.css, no change to tailwind.config.ts, so this cannot disturb any
// existing screen (CLAUDE_UI.md §2-§3: teal is the brand, actions only).

export default function PoV2Page(): React.JSX.Element {
  return (
    <main className="min-h-screen bg-white flex flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="text-violet-700 text-[28px] font-semibold tracking-tight">
        Orbit v2
      </h1>
      <p className="text-[14px] text-gray-500">
        Route is live. Nothing built yet.
      </p>
    </main>
  );
}
