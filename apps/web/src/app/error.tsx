"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="card max-w-lg space-y-4">
        <h1 className="text-2xl font-semibold">Hiba történt</h1>
        <p className="text-sm text-brand-100/70">
          {error.message}
        </p>
        {error.digest ? (
          <p className="text-xs text-brand-100/50">Digest: {error.digest}</p>
        ) : null}
        <button className="btn btn-primary" onClick={reset}>
          Újrapróbálás
        </button>
      </div>
    </div>
  );
}
