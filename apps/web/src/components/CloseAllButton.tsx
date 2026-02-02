"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type CloseAllButtonProps = {
  positionIds: string[];
};

export default function CloseAllButton({ positionIds }: CloseAllButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirm = async () => {
    if (positionIds.length === 0) {
      setError("Nincs nyitott pozicio.");
      setConfirmOpen(false);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    let closed = 0;
    let failed = 0;

    for (const id of positionIds) {
      const response = await fetch("/api/execute/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position_id: id })
      });

      if (response.ok) {
        closed += 1;
      } else {
        failed += 1;
      }
    }

    setSuccess(`Zarva: ${closed} / ${positionIds.length}`);
    if (failed > 0) {
      setError(`Sikertelen: ${failed}`);
    }
    setLoading(false);
    setConfirmOpen(false);
    router.refresh();
  };

  return (
    <>
      <div className="flex flex-col items-start gap-1">
        <button className="btn btn-ghost" onClick={() => setConfirmOpen(true)} disabled={loading}>
          {loading ? "Zaras..." : "Close all"}
        </button>
        {error ? <span className="text-xs text-red-200">{error}</span> : null}
        {success ? <span className="text-xs text-emerald-200">{success}</span> : null}
      </div>
      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-brand-300/20 bg-brand-900/95 p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Biztosan lezarod az osszes nyitott poziciot?</h3>
            <p className="mt-2 text-sm text-brand-100/70">
              Ez a muvelet azonnal zarja az osszes open poziciot.
            </p>
            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                className="btn btn-ghost"
                onClick={() => setConfirmOpen(false)}
                disabled={loading}
              >
                Megse
              </button>
              <button
                className="btn btn-primary"
                onClick={handleConfirm}
                disabled={loading}
              >
                {loading ? "Zaras..." : "Igen, zaras"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
