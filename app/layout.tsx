import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/components/shared/session-provider";
import { Toaster } from "@/components/ui/sonner";

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
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Orbit OMS",
  description: "Depot-level Order Management System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${jakarta.variable} ${mono.variable} font-sans`}>
        <SessionProvider>{children}</SessionProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
