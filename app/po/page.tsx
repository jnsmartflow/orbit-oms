import PoPage from "./po-page";

// New public mobile order page at /po (Phase 1 skeleton). Server wrapper so
// `force-dynamic` is honoured — route segment config is ignored inside a
// "use client" module, so the interactive UI lives in po-page.tsx. Mirrors
// the desktop /place-order server/client split (CLAUDE_PLACE_ORDER §17).
//
// /order (app/order/page.tsx) is the FROZEN backup and is not touched.

export const dynamic = "force-dynamic";

export default function Page() {
  return <PoPage />;
}
