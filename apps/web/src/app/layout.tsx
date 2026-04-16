import "./globals.css";
import type { Metadata } from "next";
import TopNav from "@/components/TopNav";

export const metadata: Metadata = {
  title: "Arbiter v2 Watcher",
  description: "Watcher-first market decision support"
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
        <main>{children}</main>
      </body>
    </html>
  );
}
