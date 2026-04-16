"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(path: "/auth/sign-in" | "/auth/sign-up") {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Auth request failed.");
        return;
      }
      window.location.href = "/dashboard";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center px-6 py-16">
      <div className="card w-full">
        <h1 className="text-2xl font-semibold">Belépés</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Watcher dashboard hozzáférés.
        </p>

        <label className="mt-4 block text-sm">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-xl border px-3 py-2"
          style={{ borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" }}
        />

        <label className="mt-3 block text-sm">Jelszó</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-xl border px-3 py-2"
          style={{ borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" }}
        />

        {error ? (
          <p className="mt-3 text-sm" style={{ color: "#dc2626" }}>
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => submit("/auth/sign-in")}
            disabled={loading || !email || !password}
            className="rounded-xl px-4 py-2 text-sm font-semibold"
            style={{ background: "var(--accent)", color: "#fff", opacity: loading ? 0.6 : 1 }}
          >
            Belépés
          </button>
          <button
            type="button"
            onClick={() => submit("/auth/sign-up")}
            disabled={loading || !email || !password}
            className="rounded-xl border px-4 py-2 text-sm font-semibold"
            style={{ borderColor: "var(--line)", color: "var(--text)", opacity: loading ? 0.6 : 1 }}
          >
            Regisztráció
          </button>
        </div>
      </div>
    </div>
  );
}
