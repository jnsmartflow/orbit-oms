import PoV2Page from "./po-v2-page";

// Hidden v2 salesman order page — placeholder shell.
//
// Server wrapper so `force-dynamic` is honoured: route segment config is
// ignored inside a "use client" module, so the interactive UI lives in
// po-v2-page.tsx. Same server/client split as app/po/page.tsx.
//
// PUBLIC WITH NO MIDDLEWARE EDIT. middleware.ts:36 is
// `PUBLIC_PATHS.some((p) => pathname.startsWith(p))` — a PREFIX match — and
// PUBLIC_PATHS already carries "/po" (middleware.ts:26). "/po-v2-8f4kd2"
// starts with "/po", so it is waved through. Nothing was added to that list.
// ⚠ The address is UNGUESSABLE, not protected: there is no session here.
//
// 🔴 CONTAINMENT RULE — v2 must never modify anything outside this folder.
// If v2 needs a shared helper changed, COPY it in here rather than editing the
// original, so the whole experiment stays deletable in one command. app/po/ is
// off limits: no imports from it, no edits to it.
//
// No PWA manifest / appleWebApp metadata yet — deliberately omitted, so this
// route inherits app/layout.tsx's global manifest and does NOT claim an
// installable identity of its own the way /po does.

export const dynamic = "force-dynamic";

export default function Page() {
  return <PoV2Page />;
}
