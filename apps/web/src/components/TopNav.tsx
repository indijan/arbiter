"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/simple", label: "Egyszerű" },
  { href: "/profit", label: "Profit" },
  { href: "/settings", label: "Beállítások" }
];

export default function TopNav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b border-brand-300/10 bg-brand-900/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/dashboard" className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-300">
          Arbiter
        </Link>
        <div className="flex items-center gap-4 text-sm">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative rounded-full px-3 py-1 transition ${
                  active
                    ? "bg-brand-300 text-brand-900"
                    : "text-brand-100/80 hover:text-white"
                }`}
              >
                {link.label}
                {active ? (
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-300" />
                ) : null}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
