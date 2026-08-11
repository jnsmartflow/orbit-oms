import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/components/shared/session-provider";
import { Toaster } from "@/components/ui/sonner";
// The NODE auth entry (lib/auth.ts), not the Edge config — this layout renders
// on the server runtime. The Node/Edge split stays exactly as it is (CORE §3);
// nothing here merges them.
import { auth } from "@/lib/auth";

export const dynamic = 'force-dynamic';

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Orbit OMS",
  description: "Depot Management Application",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "OrbitOMS",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
};

export const viewport: Viewport = {
  themeColor: "#0d9488",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Tells Chromium 108+ to shrink the layout viewport when the soft keyboard
  // opens, instead of overlaying it. Pairs with the visualViewport-driven
  // --vvh CSS variable in /po so <main> bottom aligns with the keyboard
  // top on Android. iOS Safari already shrinks visualViewport natively.
  // (Said "/order" until 2026-07-27; that page was retired —
  // archive/2026-07-order/. Behaviour unchanged, /po owns --vvh now.)
  interactiveWidget: "resizes-content",
};

// ASYNC as of 2026-08-10 so the session can be resolved server-side and handed
// to the provider. Safe here: this layout is already `force-dynamic` (above),
// so it was never statically rendered and gains no new rendering constraint.
//
// auth() runs on EVERY page including the public ones (/po, /demo, /login) —
// there it simply finds no cookie and returns null, which is exactly the value
// the provider should start from for an anonymous visitor. The win is that an
// authenticated page no longer makes the browser ask GET /api/auth/session for
// something this render already knows. See session-provider.tsx for the full
// reasoning and the accepted trade.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html lang="en">
      <body className={`${jakarta.variable} ${mono.variable} font-sans`}>
        <SessionProvider session={session}>{children}</SessionProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
