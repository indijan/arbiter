export default function TopNav() {
  return (
    <nav
      className="sticky top-0 z-50 border-b"
      style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--bg) 88%, transparent)" }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <a href="/dashboard" className="text-xs font-semibold uppercase tracking-[0.3em]" style={{ color: "var(--accent)" }}>
          Arbiter v2
        </a>
        <a
          href="/dashboard"
          className="rounded-full px-3 py-1.5 text-sm font-medium"
          style={{ background: "var(--accent)", color: "#ffffff" }}
        >
          Watcher
        </a>
      </div>
    </nav>
  );
}
