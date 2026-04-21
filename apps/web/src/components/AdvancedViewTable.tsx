import type React from "react";

type Row = {
  ts: string;
  strategy: string;
  symbol: string;
  score: number;
  decision: string;
  reason: string;
};

function formatTs(value: string) {
  return new Date(value).toLocaleString("hu-HU");
}

export default function AdvancedViewTable({ rows }: { rows: Row[] }) {
  return (
    <details className="mt-3 rounded-xl border" style={{ borderColor: "var(--line)" }}>
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold" style={{ color: "var(--text)" }}>
        Advanced View tábla megnyitása
      </summary>
      <div className="overflow-x-auto border-t" style={{ borderColor: "var(--line)" }}>
        <table className="min-w-full text-sm">
          <thead style={{ background: "color-mix(in oklab, var(--bg-alt) 55%, transparent)" }}>
            <tr>
              <th className="px-3 py-2 text-left">Idő</th>
              <th className="px-3 py-2 text-left">Strategy</th>
              <th className="px-3 py-2 text-left">Symbol</th>
              <th className="px-3 py-2 text-left">Score</th>
              <th className="px-3 py-2 text-left">Decision</th>
              <th className="px-3 py-2 text-left">Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row, idx) => (
                <tr key={`${row.ts}-${idx}`} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="px-3 py-2">{formatTs(row.ts)}</td>
                  <td className="px-3 py-2">{row.strategy}</td>
                  <td className="px-3 py-2">{row.symbol}</td>
                  <td className="px-3 py-2">{row.score.toFixed(1)}</td>
                  <td className="px-3 py-2">{row.decision}</td>
                  <td className="px-3 py-2">{row.reason}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-3 py-4" style={{ color: "var(--muted)" }}>
                  Nincs friss pipeline advanced output.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}
