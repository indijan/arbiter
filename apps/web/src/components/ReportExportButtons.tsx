"use client";

import { useState } from "react";

type ExportButton = {
  label: string;
  url: string;
  file: string;
};

const BUTTONS: ExportButton[] = [
  { label: "FULL 24H", url: "/api/report/export?type=full&window=24h", file: "arbiter-report-full-24h.json" },
  { label: "FULL 7D", url: "/api/report/export?type=full&window=7d", file: "arbiter-report-full-7d.json" }
];

export default function ReportExportButtons() {
  const [state, setState] = useState<string>("");
  const [loading, setLoading] = useState<string | null>(null);

  async function handleDownload(button: ExportButton) {
    setLoading(button.label);
    setState("");
    try {
      const res = await fetch(button.url, { method: "GET" });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(body || `Export failed (${res.status})`);
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = button.file;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      setState(`${button.label} letöltve.`);
    } catch (err) {
      setState(err instanceof Error ? `Hiba: ${err.message}` : "Hiba export közben.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {BUTTONS.map((button) => (
        <button
          key={button.label}
          type="button"
          className="tag"
          disabled={loading !== null}
          onClick={() => handleDownload(button)}
          title="JSON report letöltése"
        >
          {loading === button.label ? "Letöltés..." : button.label}
        </button>
      ))}
      <span style={{ color: "var(--muted)" }}>{state}</span>
    </div>
  );
}
