"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend
} from "recharts";

export type ProfitSeries = {
  key: string;
  label: string;
  color: string;
};

type ProfitChartsProps = {
  data: Array<Record<string, number | string>>;
  series: ProfitSeries[];
};

function formatValue(value: number) {
  return `${value.toFixed(2)} USD`;
}

export default function ProfitCharts({ data, series }: ProfitChartsProps) {
  if (!data || data.length === 0 || series.length === 0) {
    return (
      <div className="rounded-2xl border border-brand-300/20 bg-brand-900/40 p-6 text-sm text-brand-100/70">
        Nincs elég adat a grafikonhoz.
      </div>
    );
  }

  return (
    <div className="h-[360px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 24, left: 0, bottom: 10 }}>
          <CartesianGrid stroke="rgba(148, 163, 184, 0.2)" strokeDasharray="4 4" />
          <XAxis dataKey="day" stroke="#cbd5f5" tick={{ fontSize: 12 }} />
          <YAxis stroke="#cbd5f5" tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(value) => formatValue(Number(value))}
            contentStyle={{
              background: "rgba(15, 23, 42, 0.95)",
              border: "1px solid rgba(148, 163, 184, 0.25)",
              borderRadius: "12px",
              fontSize: "12px"
            }}
            labelStyle={{ color: "#e2e8f0" }}
          />
          <Legend wrapperStyle={{ fontSize: "12px" }} />
          {series.map((item) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={item.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
