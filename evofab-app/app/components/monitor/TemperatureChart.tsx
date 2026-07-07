"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  decimateTemperatureSeries,
  type TemperaturePoint,
} from "@/app/lib/temperature-series";

interface TemperatureChartProps {
  series: TemperaturePoint[];
}

export function TemperatureChart({ series }: TemperatureChartProps) {
  const data = decimateTemperatureSeries(series);

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
          Temperatures
        </h2>
        <span className="font-mono text-xs text-muted">
          {data.length} samples
        </span>
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 12, left: -18, bottom: 0 }}
          >
            <CartesianGrid
              stroke="rgba(255,255,255,0.05)"
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="label"
              tick={{
                fill: "#5A6480",
                fontSize: 10,
                fontFamily: "var(--font-mono)",
              }}
              axisLine={false}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis
              tick={{
                fill: "#5A6480",
                fontSize: 10,
                fontFamily: "var(--font-mono)",
              }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip
              contentStyle={{
                background: "#0F1525",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 8,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
              }}
              labelStyle={{ color: "#5A6480" }}
            />
            <Line
              type="monotone"
              dataKey="hotend_actual"
              name="Hotend actual"
              stroke="#00D4B4"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="hotend_target"
              name="Hotend target"
              stroke="#00D4B4"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="bed_actual"
              name="Bed actual"
              stroke="#3B82F6"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="bed_target"
              name="Bed target"
              stroke="#3B82F6"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
