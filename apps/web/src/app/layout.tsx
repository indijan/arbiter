import "./globals.css";
import type { Metadata } from "next";
import TopNav from "@/components/TopNav";

export const metadata: Metadata = {
  title: "Arbiter",
  description: "Supabase auth starter"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="hu">
      <body>
        <TopNav />
        <main className="bg-gradient-to-br from-brand-900 via-brand-700 to-brand-900">
          {children}
        </main>
      </body>
    </html>
  );
}
