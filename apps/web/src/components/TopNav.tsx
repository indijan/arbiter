export default function TopNav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-brand-300/10 bg-brand-900/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <a href="/dashboard" className="text-sm font-semibold uppercase tracking-[0.34em] text-brand-300">
          Arbiter
        </a>
        <div className="flex items-center gap-2 text-sm">
          <a
            href="/dashboard"
            className="rounded-full bg-brand-300 px-3 py-1.5 text-brand-900 transition hover:bg-white"
          >
            Cockpit
          </a>
          <a
            href="/ops"
            className="rounded-full px-3 py-1.5 text-brand-100/70 transition hover:text-white"
          >
            Ops
          </a>
        </div>
      </div>
    </nav>
  );
}
