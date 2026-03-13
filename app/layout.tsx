import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/components/shared/session-provider";
import { Toaster } from "@/components/ui/sonner";

export const dynamic = 'force-dynamic';

const inter = Inter({ subsets: ["latin"] });

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
      <body className={inter.className}>
        <SessionProvider>{children}</SessionProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
