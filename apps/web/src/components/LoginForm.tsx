"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAuth = async (path: "/auth/sign-in" | "/auth/sign-up") => {
    setError(null);
    setLoading(true);

    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    setLoading(false);

    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error ?? "Ismeretlen hiba történt.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void handleAuth("/auth/sign-in");
      }}
      className="card w-full max-w-md space-y-5"
    >
      <div>
        <p className="text-sm uppercase tracking-[0.3em] text-brand-300">
          Belépés
        </p>
        <h1 className="text-3xl font-semibold">Üdv újra</h1>
        <p className="text-sm text-brand-100/70">
          Jelentkezz be az email címeddel és jelszavaddal.
        </p>
      </div>

      <div className="space-y-4">
        <label className="block text-sm font-medium text-brand-100">
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 w-full rounded-xl border border-brand-300/30 bg-brand-900/60 px-3 py-2 text-white"
            required
          />
        </label>
        <label className="block text-sm font-medium text-brand-100">
          Jelszó
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 w-full rounded-xl border border-brand-300/30 bg-brand-900/60 px-3 py-2 text-white"
            required
          />
        </label>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading}
        >
          {loading ? "Belépés..." : "Belépés"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void handleAuth("/auth/sign-up")}
          disabled={loading}
        >
          {loading ? "Fiók létrehozása..." : "Regisztráció"}
        </button>
      </div>
    </form>
  );
}
